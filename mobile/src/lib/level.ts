/**
 * Skalowanie poziomu wejścia do waveformu — ADAPTACYJNE, zamiast sztywnego przeliczenia dB→0..1.
 *
 * Problem, który to naprawia: poprzednia formuła `min(1, ((dB+50)/50) * 1.7)` nasycała się przy
 * ~-20 dBFS, a normalna mowa siedzi w -20…-6 dBFS. Wszystko głośniejsze niż szept lądowało na
 * suficie, więc waveform pokazywał praktycznie tylko dwa stany: pełne wychylenie albo cisza.
 *
 * Rozwiązanie: w kroczącym oknie wyznaczamy percentylowy FLOOR i CEILING (a nie min/max — pojedynczy
 * trzask nie może rozjechać skali) i mapujemy bieżącą próbkę liniowo między nimi. Skala sama dopasowuje
 * się do tego, jak głośno faktycznie mówisz, więc gradacja jest widoczna i przy cichej, i przy głośnej
 * wypowiedzi. Mapowanie zostaje liniowe W DECYBELACH — dB jest już logarytmiczne, czyli zgodne
 * z tym, jak ucho odbiera głośność; dokładanie krzywej korekcyjnej tylko zaciemniałoby obraz.
 *
 * Czysta logika, BEZ importów RN — testy w tools/test-level.mjs.
 */

export type LevelConfig = {
  window: number; // ile próbek trzymamy do liczenia floor/ceiling (przy tiku 90 ms: 45 ≈ 4 s)
  floorPct: number; // percentyl na dole (0.10 = 10.)
  ceilPct: number; // percentyl na górze (0.95 = 95.)
  minSpanDb: number; // minimalna rozpiętość skali — chroni przed rozdmuchaniem szumu pokoju
  silenceCeilDb: number; // gdy szczyt okna jest poniżej, uznajemy że sygnału NIE MA
  absFloorDb: number; // twarde dno skali
  attack: number; // wygładzanie sufitu w GÓRĘ (szybkie — głośny dźwięk ma od razu podnieść skalę)
  release: number; // wygładzanie sufitu w DÓŁ (wolne — skala nie może opadać skokowo)
  floorSmooth: number; // wygładzanie dna (wolne w obie strony)
  softMax: number; // maksymalna wysokość dla próbek PONIŻEJ dna skali (0 = twarde przycięcie)
  softBelowSpans: number; // ile szerokości skali niżej gaśnie do zera
};

export const DEFAULTS: LevelConfig = {
  window: 45,
  floorPct: 0.1,
  ceilPct: 0.95,
  minSpanDb: 12,
  silenceCeilDb: -45,
  absFloorDb: -60,
  attack: 0.5,
  release: 0.1, // 0.05 wracało do pełnej skali dopiero po ~8 s; 0.1 nie kosztuje kontrastu
  floorSmooth: 0.1,
  // Miękkie dno. Bez niego próbka poniżej dna skali była przycinana do DOKŁADNEGO zera — a po głośnym
  // fragmencie (gdy całe okno jest głośne, więc dno stoi wysoko) cichsza mowa znikała całkowicie na
  // ~4 s, do wyjścia głośnych próbek z okna. Poszerzenie `minSpanDb` to naprawiało, ale kosztem
  // kontrastu w cichej mowie (zmierzone: Δ 0.40 → 0.28), czyli wracało do „prawie pełnych słupków".
  // Zamiast tego: to, co wypada pod skalą, dostaje niską ale WIDOCZNĄ wysokość, gasnącą do zera
  // dopiero `softBelowSpans` szerokości skali niżej.
  softMax: 0.25,
  softBelowSpans: 1.5,
};

/** Percentyl z posortowanej kopii — odporny na pojedyncze trzaski, inaczej niż min/max. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export type LevelScaler = {
  /** Kolejna próbka w dBFS → 0..1 do wysokości słupka. null (brak meteringu) przechodzi jako null. */
  push(db: number | null | undefined): number | null;
  /** Reset między nagraniami — inaczej nowe nagranie startuje ze skalą z poprzedniego. */
  reset(): void;
  /** Podgląd bieżącej skali (do testów/diagnostyki). */
  range(): { floor: number; ceiling: number };
};

export function createLevelScaler(cfg: Partial<LevelConfig> = {}): LevelScaler {
  const c: LevelConfig = { ...DEFAULTS, ...cfg };
  let buf: number[] = [];
  let floorS: number | null = null;
  let ceilS: number | null = null;

  const reset = () => {
    buf = [];
    floorS = null;
    ceilS = null;
  };

  const push = (db: number | null | undefined): number | null => {
    if (typeof db !== 'number' || !Number.isFinite(db)) return null;
    const v = Math.min(0, Math.max(c.absFloorDb, db));

    buf.push(v);
    if (buf.length > c.window) buf.shift();
    const sorted = [...buf].sort((a, b) => a - b);
    const rawFloor = percentile(sorted, c.floorPct);
    const rawCeil = percentile(sorted, c.ceilPct);

    // sufit: szybko w górę, wolno w dół — skala nadąża za głośnym wejściem, ale nie opada skokowo
    ceilS = ceilS == null ? rawCeil : ceilS + (rawCeil - ceilS) * (rawCeil > ceilS ? c.attack : c.release);
    floorS = floorS == null ? rawFloor : floorS + (rawFloor - floorS) * c.floorSmooth;

    // Cisza: w oknie nie ma realnego sygnału. Bez tego adaptacja rozdmuchałaby szum pokoju do pełnych
    // słupków i „cisza" wyglądałaby jak mowa. Mapujemy wtedy na STAŁEJ skali, więc słupki są niskie.
    if (ceilS < c.silenceCeilDb) {
      return clamp01((v - c.absFloorDb) / (c.silenceCeilDb - c.absFloorDb)) * 0.15;
    }

    // minimalna rozpiętość — przy monotonnym wejściu skala nie może się zapaść do zera
    const floor = Math.min(floorS, ceilS - c.minSpanDb);
    const t = (v - floor) / (ceilS - floor);
    if (t >= 0) return clamp01(t);
    // poniżej dna: miękkie zejście zamiast twardego zera (patrz komentarz przy softMax)
    return Math.max(0, c.softMax * (1 + t / c.softBelowSpans));
  };

  return { push, reset, range: () => ({ floor: floorS ?? c.absFloorDb, ceiling: ceilS ?? 0 }) };
}
