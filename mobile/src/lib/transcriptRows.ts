/**
 * Wspólna maszyneria dzielenia transkryptu na wiersze — używana i przez rozdzielanie mówców
 * (lib/speakerSplit), i przez podział kontekstowy (lib/segmentSplit).
 *
 * Dlaczego jedno miejsce: OBA podziały pytają model o to samo — GDZIE ciąć — i oba muszą dawać tę
 * samą gwarancję: wyświetlany tekst pochodzi wyłącznie z odpowiedzi deAPI, a każdy wiersz niesie
 * prawdziwy czas ze słów. Gdyby ta logika istniała w dwóch kopiach, gwarancja trzymałaby się tylko
 * w tej, którą akurat przetestowano.
 *
 * Podział pracy:
 *   • `buildChunks` — kandydaci na cięcie (granice słów: koniec zdania, pauza, limit słów). To JEDYNE
 *     miejsca, które mają prawdziwy czas, więc model może wybierać wyłącznie spośród nich;
 *   • `chunkPrompt` — ponumerowana lista dla modelu (model dostaje numery, oddaje numery);
 *   • `assembleRows` — złożenie wierszy z fragmentów; tnie oryginalny `text` po znakach.
 *
 * BEZ importów React Native — uruchamiane w testach (tools/test-speaker-split.mjs, test-segment-split.mjs).
 */
import type { Segment, Word } from './types';

export const CHUNK_DEFAULTS = {
  gapSec: 0.45,
  maxWords: 24, // dłuższy fragment i tak nie zmieści się w jednej turze
  maxChunks: 180, // sufit długości promptu; wyżej scalamy, bo lepiej zgrubnie niż wcale
};
// Świadomie NIE ma progu „za krótki fragment": krótka tura („Tak.", „Dobrze, dziękuję.") to
// najczystszy sygnał zmiany mówcy, jaki w ogóle dostajemy — doklejenie jej do sąsiada kasowałoby
// dokładnie tę granicę, którą próbujemy znaleźć.

/** Prompt większy niż to okno = długie nagranie; wołający decyduje, czy pominąć pytanie do modelu. */
export const MAX_PROMPT_CHARS = 12000;

export type Chunk = {
  seg: number; // indeks segmentu źródłowego
  from: number; // offset znakowy w `segment.text` (włącznie)
  to: number; // offset znakowy końca (wyłącznie) — sąsiednie fragmenty stykają się bez luk
  start: number | null;
  end: number | null;
  text: string;
  words: Word[];
  speaker: string | null; // mówca WG SŁÓW (deAPI etykietuje każde słowo osobno), nie wg segmentu
};

type Placed = { w: Word; at: number; to: number };

/** deAPI → „SPEAKER_00", „SPEAKER_01"… — ta sama konwencja, co przy udanej diaryzacji, żeby reszta
 *  apki (speakerNumbers, speakerLabels, rozpoznawanie imion) nie musiała wiedzieć, skąd wziął się podział. */
export function speakerId(no: number): string {
  return `SPEAKER_${String(Math.max(0, no - 1)).padStart(2, '0')}`;
}

/**
 * Nałóż słowa na tekst segmentu (monotoniczny indexOf — ten sam mechanizm co spokenCutFromWords
 * w lib/transcript). Zwraca null, gdy KTÓREGOKOLWIEK słowa nie da się osadzić: częściowe mapowanie
 * dałoby fragment z brakującymi słowami, czyli karaoke urwane w połowie zdania.
 */
export function placeWords(text: string, words: Word[] | null | undefined): Placed[] | null {
  const list = (words ?? []).filter((w) => w.word);
  if (!list.length) return null;
  const out: Placed[] = [];
  let cursor = 0;
  for (const w of list) {
    const at = text.indexOf(w.word, cursor);
    if (at < 0) return null;
    out.push({ w, at, to: at + w.word.length });
    cursor = at + w.word.length;
  }
  return out;
}

const SENTENCE_END = /[.!?…]["'”’)]?$/;

/**
 * Przyciągnij zmianę mówcy do granicy zdania — poprawka na SPÓŹNIENIE diaryzacji.
 *
 * Diaryzacja potrzebuje kawałka audio, żeby rozpoznać, że mówi już kto inny. Gdy rozmówcy wchodzą
 * sobie w słowo (bez pauzy), etykieta przełącza się dopiero po 1–3 słowach nowej wypowiedzi.
 * Zmierzone na realnym nagraniu: z 8 zmian mówcy aż 3 wypadły DOKŁADNIE 2 słowa za późno — np.
 * „Na swojej spotkaniu. No bo | jeszcze jest tak", gdzie „No bo" należy już do drugiej osoby.
 *
 * Interpunkcja Whispera jest w tych miejscach poprawna, więc jeśli w promieniu `maxShift` słów od
 * zmiany jest koniec zdania, przesuwamy ją tam. Okno jest wąskie celowo: korygujemy spóźnienie
 * o kilka słów, a nie przenosimy granicy w inne miejsce rozmowy. Zmiany bez końca zdania w pobliżu
 * (wejście w słowo w środku zdania) zostają tam, gdzie były.
 *
 * PRZESUWAMY WYŁĄCZNIE GRANICE — liczba tur i ich etykiety są nienaruszalne. Wcześniejsza wersja
 * snapowała każdą granicę niezależnie i nadpisywała etykiety w przesuwanym zakresie, więc dwie
 * granice bliższe sobie niż `maxShift` potrafiły spotkać się w tym samym końcu zdania i skasować
 * turę między nimi: „S0 S0 | S1(„Tak.") | S0" wychodziło jako jednolite S0, a „S0 | S1 | S2" —
 * jako S0 S0 S1 S1 S2, czyli słowa przypisane osobie, która ich nie powiedziała. Dlatego każda
 * granica ma teraz sufit i podłogę wyznaczone przez sąsiadki (`lo`/`hi`): w każdej turze zostaje
 * co najmniej jedno słowo, a etykiety odtwarzamy z ORYGINALNEJ listy tur, nie z łatania zakresów.
 * Krótkie tury i wtrącenia („Tak.", „No?") są w rozmowie normalne, a ta funkcja chodzi bezwarunkowo
 * przed całą resztą — więc nie może psuć danych, które diaryzacja dała poprawnie.
 */
export function snapSpeakersToSentences(segments: Segment[], maxShift = 3, maxSec = 1.5): Segment[] {
  const flat: { w: Word; seg: number; i: number }[] = [];
  segments.forEach((s, si) => (s.words ?? []).forEach((w, i) => flat.push({ w, seg: si, i })));
  if (flat.length < 2) return segments;

  const speakers = flat.map((f) => f.w.speaker ?? null);
  const endsSentence = (k: number) => SENTENCE_END.test((flat[k].w.word ?? '').trim());

  // tury = etykieta + granica startowa; granica 0 jest domyślna i nie podlega przesuwaniu
  const bounds: number[] = [];
  for (let k = 1; k < flat.length; k++) if (speakers[k] !== speakers[k - 1]) bounds.push(k);
  if (!bounds.length) return segments;
  const labels = [speakers[0], ...bounds.map((k) => speakers[k])];

  const moved: number[] = [];
  bounds.forEach((k, bi) => {
    // podłoga: za już USTALONĄ poprzednią granicą (+1 słowo dla poprzedniej tury);
    // sufit: przed ORYGINALNĄ następną (−1 słowo dla tej tury). Zakres zawsze zawiera samo `k`.
    const lo = (moved[bi - 1] ?? 0) + 1;
    const hi = (bounds[bi + 1] ?? flat.length) - 1;
    let best: number | null = null;
    // najbliższa pozycja, PRZED którą kończy się zdanie (czyli słowo j-1 ma kropkę)
    for (let j = Math.max(lo, k - maxShift); j <= Math.min(hi, k + maxShift); j++) {
      if (!endsSentence(j - 1)) continue;
      const dt = Math.abs((flat[j].w.start ?? 0) - (flat[k].w.start ?? 0));
      if (dt > maxSec) continue;
      if (best === null || Math.abs(j - k) < Math.abs(best - k)) best = j;
    }
    moved.push(best ?? k);
  });
  if (moved.every((k, i) => k === bounds[i])) return segments;

  // etykiety odtworzone z tur — żadna tura nie może zniknąć ani zmienić mówcy
  const next = [...speakers];
  const starts = [0, ...moved];
  starts.forEach((from, t) => {
    const to = starts[t + 1] ?? flat.length;
    for (let j = from; j < to; j++) next[j] = labels[t];
  });

  let p = 0;
  return segments.map((s) => {
    const ws = s.words ?? null;
    if (!ws) return s;
    const out = ws.map((w) => ({ ...w, speaker: next[p++] }));
    return { ...s, words: out };
  });
}

/** Fragmenty-kandydaci: cięcie na końcu zdania, na pauzie i po `maxWords`. Segment bez użytecznych
 *  słów zostaje jednym fragmentem — da się go oznaczyć w całości, ale nie da się go rozciąć. */
export function buildChunks(segments: Segment[], opts: Partial<typeof CHUNK_DEFAULTS> = {}): Chunk[] {
  const { gapSec, maxWords, maxChunks } = { ...CHUNK_DEFAULTS, ...opts };
  const out: Chunk[] = [];

  segments.forEach((seg, si) => {
    const text = seg.text ?? '';
    if (!text.trim()) return;
    const placed = placeWords(text, seg.words);
    if (!placed || placed.length < 2) {
      out.push({ seg: si, from: 0, to: text.length, start: seg.start, end: seg.end, text, words: seg.words ?? [], speaker: seg.speaker ?? null });
      return;
    }
    let from = 0;
    let acc: Placed[] = [];
    for (let k = 0; k < placed.length; k++) {
      acc.push(placed[k]);
      const isLast = k === placed.length - 1;
      const next = placed[k + 1];
      const gap = !isLast && placed[k].w.end != null && next.w.start != null ? next.w.start! - placed[k].w.end! : 0;
      // ZMIANA MÓWCY MIĘDZY SŁOWAMI łamie fragment zawsze i bez negocjacji. deAPI etykietuje każde
      // słowo osobno, a `segment.speaker` to tylko etykieta zbiorcza — na realnym nagraniu 4 z 8
      // segmentów miały zmianę mówcy W ŚRODKU, przez co 16% słów szło na konto niewłaściwej osoby.
      const turn = !isLast && (placed[k].w.speaker ?? null) !== (next.w.speaker ?? null);
      if (!isLast && !turn && !SENTENCE_END.test(placed[k].w.word.trim()) && gap < gapSec && acc.length < maxWords) continue;
      // ostatni fragment sięga końca tekstu — suma fragmentów MUSI dać dokładnie oryginał
      const to = isLast ? text.length : placed[k].to;
      out.push({
        seg: si,
        from,
        to,
        start: acc[0].w.start,
        end: placed[k].w.end,
        text: text.slice(from, to),
        words: acc.map((p) => p.w),
        speaker: acc[0].w.speaker ?? seg.speaker ?? null,
      });
      from = to;
      acc = [];
    }
  });

  return capChunks(out, maxChunks);
}

/** Scal dwa sąsiednie fragmenty TEGO SAMEGO segmentu (a → a+b). */
function join(a: Chunk, b: Chunk): Chunk {
  return { ...a, to: b.to, end: b.end ?? a.end, text: a.text + b.text, words: [...a.words, ...b.words] };
}

/** Sufit liczby fragmentów: scalaj po `f` sąsiadów w obrębie segmentu. Zgrubniejszy podział na długim
 *  nagraniu jest gorszy niż dokładny, ale wciąż lepszy niż brak podziału. */
function capChunks(chunks: Chunk[], maxChunks: number): Chunk[] {
  if (chunks.length <= maxChunks) return chunks;
  const f = Math.ceil(chunks.length / maxChunks);
  const out: Chunk[] = [];
  let run = 0;
  for (const c of chunks) {
    const prev = out[out.length - 1];
    // NIE scalamy przez granicę mówcy — inaczej sufit fragmentów po cichu przywracałby błąd,
    // który cały ten podział naprawia (dwie osoby w jednym wierszu).
    if (prev && prev.seg === c.seg && prev.speaker === c.speaker && run < f) {
      out[out.length - 1] = join(prev, c);
      run++;
    } else {
      out.push(c);
      run = 1;
    }
  }
  return out;
}

/** Ponumerowana lista dla modelu. Zwijamy białe znaki — model i tak nie dostaje tekstu do zwrotu,
 *  a wiersz na fragment jest jednoznaczny przy parsowaniu odpowiedzi. */
export function chunkPrompt(chunks: Chunk[]): string {
  return chunks.map((c, i) => `${i + 1}. ${c.text.replace(/\s+/g, ' ').trim()}`).join('\n');
}

/** Do porównywania cytatów: same litery i cyfry, małymi, bez interpunkcji i podwójnych spacji. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Znajdź fragment, od którego naprawdę zaczyna się nowa tura/akapit.
 *
 * Model podaje NUMER fragmentu i krótki CYTAT jego początku. Numer bywa przesunięty o jeden (model
 * przelicza pozycje w tablicy i łatwo się myli), cytat — nie, bo pochodzi wprost z tekstu, który
 * dostał. Dlatego numer traktujemy jako podpowiedź, a rozstrzyga cytat: sprawdzamy podpowiedziany
 * fragment, a potem jego sąsiadów w promieniu `window`. Gdy cytatu nie ma (albo nie pasuje nigdzie
 * w pobliżu), zostaje sam numer.
 */
export function matchAnchor(chunks: Chunk[], hint: number, quote?: string | null, window = 3): number | null {
  const inRange = Number.isInteger(hint) && hint >= 0 && hint < chunks.length;
  const q = norm(quote ?? '');
  if (!q) return inRange ? hint : null;
  const fits = (i: number) => i >= 0 && i < chunks.length && norm(chunks[i].text).startsWith(q.slice(0, 40));
  if (inRange && fits(hint)) return hint;
  for (let d = 1; d <= window; d++) {
    if (fits(hint - d)) return hint - d;
    if (fits(hint + d)) return hint + d;
  }
  return inRange ? hint : null;
}

/**
 * Złóż wiersze z fragmentów. `breakBefore(i)` mówi, czy przed fragmentem `i` zaczyna się nowy wiersz;
 * granica segmentu źródłowego łamie ZAWSZE (nie sklejamy tekstu spoza jednego segmentu — nie wiemy,
 * co deAPI zjadło pomiędzy nimi). `speakerAt` pozwala nadpisać etykietę mówcy (rozdzielanie mówców);
 * bez niej zostaje etykieta segmentu.
 *
 * Tekst wiersza to WYCINEK oryginalnego `segment.text` — stąd gwarancja, że model, cokolwiek zwróci,
 * nie jest w stanie zmienić ani jednego znaku treści.
 */
export function assembleRows(
  segments: Segment[],
  chunks: Chunk[],
  breakBefore: (i: number) => boolean,
  speakerAt?: (i: number) => string | null | undefined
): Segment[] | null {
  if (!chunks.length) return null;
  const out: Segment[] = [];
  for (let i = 0; i < chunks.length; ) {
    const first = chunks[i];
    const base = segments[first.seg];
    if (!base) return null;
    let j = i;
    while (j + 1 < chunks.length && chunks[j + 1].seg === first.seg && !breakBefore(j + 1)) j++;
    const last = chunks[j];
    const id = speakerAt ? speakerAt(i) : base.speaker;
    const whole = first.from === 0 && last.to === (base.text ?? '').length;
    const words = chunks.slice(i, j + 1).flatMap((c) => c.words.map((w) => (id ? { ...w, speaker: id } : w)));
    out.push({
      // kawałek pokrywający cały segment zachowuje ORYGINALNE czasy segmentu (czas pierwszego słowa
      // bywa o ułamek późniejszy niż start segmentu — nie ma powodu ich psuć)
      start: whole ? (base.start ?? first.start) : first.start,
      end: whole ? (base.end ?? last.end) : last.end,
      text: (base.text ?? '').slice(first.from, last.to),
      speaker: id ?? null,
      words: words.length ? words : (base.words ?? null),
    });
    i = j + 1;
  }
  return out;
}
