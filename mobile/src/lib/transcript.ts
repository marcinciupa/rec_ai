/**
 * Czysta logika widoku transkryptu — BEZ importów React Native, żeby dała się uruchomić i przetestować
 * poza aplikacją (patrz tools/test-transcript.mjs). Renderowanie zostaje w PlaybackScreen.
 */
import type { Word, Segment } from './types';

/**
 * Numery rozmówców. deAPI daje etykiety „SPEAKER_00"/„SPEAKER_01", ale numerujemy WEDŁUG KOLEJNOŚCI
 * PIERWSZEGO WEJŚCIA W NAGRANIU (1 = osoba, która odezwała się pierwsza), a nie po cyfrze z etykiety —
 * deAPI nie gwarantuje, że SPEAKER_00 odzywa się jako pierwszy. Ten sam mówca w kolejnych segmentach
 * dostaje ten sam numer. Numeracja jest LOKALNA dla nagrania: „1" w dwóch notatkach to niekoniecznie
 * ta sama osoba.
 */
export function speakerNumbers(segs: Pick<Segment, 'speaker'>[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of segs) {
    const k = s.speaker;
    if (k && !map.has(k)) map.set(k, map.size + 1);
  }
  return map;
}

/**
 * Do którego ZNAKU tekst jest już wypowiedziany — policzone z czasów SŁÓW (silnik advanced,
 * ts_level=word). Zwraca null, gdy słów nie ma albo nie dają się nałożyć na tekst; wołający spada
 * wtedy na podział proporcjonalny po znakach.
 *
 * Słowo zapala się z chwilą, gdy PADA (posSec ≥ start), więc bieżące jest już jasne — tak czyta się
 * karaoke. Mapujemy przez indexOf zamiast sklejać słowa, żeby WYŚWIETLANY tekst pozostał dokładnie
 * tym z transkryptu: interpunkcja i odstępy w `text` bywają inne niż suma `words`.
 */
export function spokenCutFromWords(text: string, words: Word[] | null | undefined, posSec: number): number | null {
  if (!words || !words.length) return null;
  let cursor = 0;
  let cut = 0;
  for (const w of words) {
    if (!w.word) continue;
    const at = text.indexOf(w.word, cursor);
    if (at < 0) return cut || null; // rozjazd słów z tekstem → nie udawaj precyzji
    if (w.start != null && posSec >= w.start) {
      cut = at + w.word.length;
      cursor = cut;
    } else {
      return cut; // pierwsze jeszcze niewypowiedziane słowo kończy sprawę
    }
  }
  return cut;
}
