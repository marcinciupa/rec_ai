/**
 * Rozdzielenie mówców Z TREŚCI — ratunek na wypadek, gdy diaryzacja akustyczna deAPI zawiedzie
 * (nagranie usera z TRZEMA osobami wróciło z jednym `SPEAKER_00` na wszystkich słowach).
 *
 * ZASADA, która trzyma całą tę ścieżkę: **model nigdy nie dotyka tekstu.** Gdyby oddawał tekst
 * z powrotem, najmniejsza zmiana (przecinek, wielkość litery) zrywałaby powiązanie ze słowami,
 * a więc z CZASEM — i segment przestawałby wiedzieć, kiedy się zaczyna. Cały widok transkrypcji
 * (tap-to-seek, karaoke) leży na znacznikach czasu. Dlatego model dostaje ponumerowane fragmenty
 * (lib/transcriptRows) i oddaje WYŁĄCZNIE numer mówcy dla każdego z nich.
 *
 * BEZ importów React Native — uruchamiane w testach (tools/test-speaker-split.mjs).
 */
import type { Segment } from './types';
import { assembleRows, matchAnchor, speakerId, type Chunk } from './transcriptRows';

export { speakerId };

/**
 * Czy w ogóle próbować. Warunki są celowo wąskie:
 *  • diaryzacja dała ≥2 mówców → NIE poprawiamy jej treścią (akustyka wie lepiej, kto mówi);
 *  • brak `words` (silnik standard) → nie ma prawdziwych czasów cięcia, a zgadywanie ich rozwaliłoby seek.
 */
export function needsSpeakerSplit(segments: Segment[] | null | undefined): boolean {
  if (!segments?.length) return false;
  const distinct = new Set(segments.map((s) => s.speaker).filter(Boolean));
  if (distinct.size >= 2) return false;
  return segments.some((s) => (s.words?.length ?? 0) > 0);
}

/**
 * Rozdzielenie mówców Z DANYCH deAPI — dokładnie tam, gdzie zmienia się mówca przy SŁOWIE.
 *
 * Po co, skoro segmenty mają `speaker`: bo to etykieta ZBIORCZA całego, ~25-sekundowego segmentu.
 * Na realnym nagraniu użytkownika (2026-08-14) 4 z 8 segmentów miały zmianę mówcy w środku, więc
 * granica wiersza wypadała 1–17 s od miejsca, w którym druga osoba naprawdę zaczyna mówić, a 16%
 * słów było podpisanych nie tą osobą. Objaw: „blisko, ale nie trafia".
 *
 * To jest podział CZYSTO MECHANICZNY — żadnego LLM, wyłącznie dane z deAPI, więc działa zawsze,
 * offline i bez dodatkowego kosztu. Zwraca null, gdy nie ma czego poprawiać (etykiety słów zgodne
 * z etykietą segmentu albo w ogóle ich brak).
 */
export function splitByWordSpeakers(segments: Segment[], chunks: Chunk[]): Segment[] | null {
  if (!chunks.length) return null;
  const labelled = chunks.filter((c) => c.speaker);
  if (!labelled.length) return null;
  // czy którykolwiek segment ma w środku więcej niż jedną etykietę
  const perSeg = new Map<number, Set<string>>();
  for (const c of chunks) {
    if (!c.speaker) continue;
    if (!perSeg.has(c.seg)) perSeg.set(c.seg, new Set());
    perSeg.get(c.seg)!.add(c.speaker);
  }
  if (![...perSeg.values()].some((s) => s.size >= 2)) return null;
  return assembleRows(
    segments,
    chunks,
    (i) => chunks[i].speaker !== chunks[i - 1].speaker,
    (i) => chunks[i].speaker ?? segments[chunks[i].seg]?.speaker ?? null
  );
}

/** Tura z odpowiedzi modelu: od którego fragmentu mówi dana osoba (+ cytat początku do weryfikacji). */
export type Turn = { from: number; speaker: number; quote?: string | null };

/**
 * Tury → numer mówcy dla KAŻDEGO fragmentu.
 *
 * Dlaczego nie prosimy modelu wprost o tablicę N liczb: tam całe znaczenie niesie POZYCJA, więc
 * pomyłka o jedną pozycję przesuwa wszystko po niej — objawia się to jako granica „o zdanie za
 * wcześnie", czyli ostatnie zdanie jednej osoby doklejone do wypowiedzi drugiej. Tury są odporne:
 * każda opisuje siebie samą (numer + cytat), pomyłka psuje jedną granicę zamiast całej reszty,
 * a cytat pozwala numer skorygować (matchAnchor).
 *
 * Zwraca null, gdy nie ma z czego zbudować sensownego podziału (brak tur, jeden mówca, śmieci).
 */
export function turnsToSpeakers(chunks: Chunk[], turns: unknown): number[] | null {
  if (!Array.isArray(turns) || !chunks.length) return null;
  const marks: { at: number; speaker: number }[] = [];
  for (const t of turns) {
    if (!t || typeof t !== 'object') continue;
    const raw = t as Record<string, unknown>;
    const speaker = Number(raw.speaker);
    const hint = Number(raw.from);
    if (!Number.isInteger(speaker) || speaker < 1 || speaker > 20) continue;
    if (!Number.isInteger(hint)) continue;
    const at = matchAnchor(chunks, hint - 1, typeof raw.quote === 'string' ? raw.quote : null);
    if (at == null) continue;
    marks.push({ at, speaker });
  }
  if (!marks.length) return null;
  marks.sort((a, b) => a.at - b.at);
  // WSTĘP przed pierwszą kotwicą. Tura to miejsce ZMIANY mówcy, więc jeśli model pominął turę
  // otwierającą (bywa — jest niejawna, a prompt pyta o miejsca, gdzie ktoś ZACZYNA mówić), to wstęp
  // z definicji należy do KOGOŚ INNEGO niż pierwsza tura. Wcześniej dostawał jej numer, czyli
  // wypowiedź osoby 1 była wyświetlana jako wypowiedź osoby 2 (i scalana z jej wierszem).
  // Bierzemy najmniejszego INNEGO mówcę, jakiego model zadeklarował; gdy nie zadeklarował żadnego,
  // sąsiedni numer — ktoś tam mówił, choć model go nie nazwał.
  const head = marks[0].speaker;
  const other = marks.map((m) => m.speaker).filter((s) => s !== head).sort((a, b) => a - b)[0];
  const prefix = marks[0].at === 0 ? head : other ?? (head < 20 ? head + 1 : head - 1);
  const out = new Array<number>(chunks.length).fill(prefix);
  for (const m of marks) for (let i = m.at; i < chunks.length; i++) out[i] = m.speaker;
  return new Set(out).size >= 2 ? out : null;
}

/**
 * Złóż segmenty wg numerów mówców przypisanych fragmentom. Tniemy WYŁĄCZNIE tam, gdzie zmienia się
 * mówca — grupowanie w czytelne wiersze robi osobno podział kontekstowy (lib/segmentSplit).
 * Zwraca null, gdy odpowiedź jest niepełna/niepoprawna albo gdy model uznał całość za monolog —
 * wtedy zostaje stan sprzed próby.
 */
export function applySpeakerTurns(segments: Segment[], chunks: Chunk[], speakers: number[]): Segment[] | null {
  if (!chunks.length || speakers.length !== chunks.length) return null;
  if (!speakers.every((n) => Number.isInteger(n) && n >= 1 && n <= 20)) return null;
  if (new Set(speakers).size < 2) return null;
  return assembleRows(
    segments,
    chunks,
    (i) => speakers[i] !== speakers[i - 1],
    (i) => speakerId(speakers[i])
  );
}
