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
      out.push({ seg: si, from: 0, to: text.length, start: seg.start, end: seg.end, text, words: seg.words ?? [] });
      return;
    }
    let from = 0;
    let acc: Placed[] = [];
    for (let k = 0; k < placed.length; k++) {
      acc.push(placed[k]);
      const isLast = k === placed.length - 1;
      const next = placed[k + 1];
      const gap = !isLast && placed[k].w.end != null && next.w.start != null ? next.w.start! - placed[k].w.end! : 0;
      if (!isLast && !SENTENCE_END.test(placed[k].w.word.trim()) && gap < gapSec && acc.length < maxWords) continue;
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
    if (prev && prev.seg === c.seg && run < f) {
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
