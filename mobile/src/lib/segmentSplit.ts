/**
 * Podział długich segmentów na czytelne wiersze — KONTEKST NAD MECHANIKĄ.
 *
 * Problem: deAPI tnie transkrypt po własnych oknach (~30 s, ~440 znaków), nie po sensie. W widoku
 * daje to wiersz-moloch z jedną parą czasów, a tap-to-seek skacze co pół minuty zamiast co myśl.
 *
 * Kolejność ważności granic — świadoma decyzja użytkownika (2026-08-14):
 *   1. **granica segmentu źródłowego** — łamie zawsze (nie sklejamy tekstu spoza jednego segmentu);
 *   2. **kontekst** — model wskazuje, gdzie zaczyna się nowa myśl/wątek; to jest podział właściwy;
 *   3. **długość** — TYLKO zabezpieczenie. Nigdy nie unieważnia granicy kontekstowej: akapit
 *      wskazany przez model może być dłuższy niż `maxChars` i zostaje w całości. Mechanika wchodzi,
 *      gdy kontekstu NIE MA (model odmówił, brak sieci, notatka za długa na jedno pytanie) albo gdy
 *      blok urósł do rozmiaru, który znów jest molochem (`hardMaxChars`).
 *
 * Dzięki temu brak sieci nie oznacza braku podziału — oznacza podział gorszy, ale wciąż czytelny
 * i policzony wyłącznie z danych deAPI.
 */
import type { Segment } from './types';
import { assembleRows, type Chunk } from './transcriptRows';

export const BLOCK_DEFAULTS = {
  // ~40 znaków w linii przy monoBody na 390 px → 220 znaków to ok. 5 linii. Molochy z produkcji
  // miały ~440 znaków (≈11 linii), więc to połowa tego, co dziś uchodzi za jeden wiersz.
  maxChars: 220,
  // sufit dla bloku WSKAZANEGO przez model — kontekst ma pierwszeństwo, ale nie do nieskończoności
  hardMaxChars: 440,
};

/**
 * Odpowiedź modelu → zbiór indeksów fragmentów rozpoczynających nowy wiersz (0-based).
 * Tolerancyjnie: pojedynczy śmieć w tablicy jest pomijany, bo każda kotwica jest niezależna —
 * w najgorszym razie w tym miejscu zadziała mechanika. Odrzucamy dopiero odpowiedź bez ani jednej
 * sensownej kotwicy oraz taką, która oznacza KAŻDY fragment (to nie jest grupowanie, tylko sieczka —
 * dokładnie to, czego podział kontekstowy ma unikać).
 */
export function normalizeStarts(raw: unknown, count: number): Set<number> | null {
  if (!Array.isArray(raw) || count < 2) return null;
  const out = new Set<number>();
  for (const v of raw) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 2 && n <= count) out.add(n - 1); // fragment 1 i tak zaczyna pierwszy wiersz
  }
  if (!out.size) return null;
  if (out.size >= count - 1) return null;
  return out;
}

/** Czy jest co dzielić: mechanika rusza tylko molochy, kontekst — gdy w ogóle jest z czego wybierać. */
export function needsBlockSplit(segments: Segment[] | null | undefined, maxChars = BLOCK_DEFAULTS.maxChars): boolean {
  return !!segments?.some((s) => (s.text ?? '').trim().length > maxChars);
}

/** Gdzie łamać wiersz. Liczone z góry (a nie w trakcie składania), żeby reguła długości była
 *  jawną funkcją danych, a nie skutkiem ubocznym kolejności wywołań. */
function computeBreaks(chunks: Chunk[], starts: Set<number> | null, maxChars: number, hardMaxChars: number): boolean[] {
  const brk = new Array(chunks.length).fill(false);
  const limit = starts ? hardMaxChars : maxChars; // z kontekstem mechanika tylko ratuje skrajności
  let acc = 0;
  for (let i = 0; i < chunks.length; i++) {
    const len = chunks[i].text.length;
    if (i === 0 || chunks[i].seg !== chunks[i - 1].seg) {
      acc = len; // granica segmentu łamie zawsze (assembleRows i tak jej pilnuje)
      continue;
    }
    if (starts?.has(i) || acc + len > limit) {
      brk[i] = true;
      acc = len;
    } else acc += len;
  }
  return brk;
}

/**
 * Złóż wiersze. `starts` = kotwice od modelu (null → sam podział mechaniczny).
 * Zwraca null, gdy nic się nie zmieniło — wołający ma wtedy zostawić segmenty w spokoju zamiast
 * zapisywać identyczne dane.
 */
export function buildBlocks(
  segments: Segment[],
  chunks: Chunk[],
  opts: { starts?: Set<number> | null; maxChars?: number; hardMaxChars?: number } = {}
): Segment[] | null {
  const { starts = null, maxChars = BLOCK_DEFAULTS.maxChars, hardMaxChars = BLOCK_DEFAULTS.hardMaxChars } = opts;
  if (chunks.length < 2) return null;
  const brk = computeBreaks(chunks, starts, maxChars, hardMaxChars);
  const rows = assembleRows(segments, chunks, (i) => brk[i]);
  return rows && rows.length > segments.length ? rows : null;
}
