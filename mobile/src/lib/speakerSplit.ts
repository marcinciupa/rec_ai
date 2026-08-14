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
import { assembleRows, speakerId, type Chunk } from './transcriptRows';

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
