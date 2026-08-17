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
 * Dokąd przewinąć widok transkryptu w trakcie odtwarzania.
 *
 * Reguła (ustalona z użytkownikiem): **pierwszy wiersz bieżącego bloku stoi przy GÓRNEJ krawędzi**,
 * a w miarę czytania blok przesuwa się tylko tyle, żeby pod wypowiadanym wierszem zostawały zawsze
 * `spareLines` wiersze zapasu — czyli oko zawsze widzi, co zaraz padnie. Koniec bloku = następny blok
 * wskakuje na górę (dzieje się samo, bo zmienia się `rowTop`).
 *
 * Zapas wygrywa z przypięciem do góry tylko wtedy, gdy blok NIE MIEŚCI SIĘ w szybie — inaczej krótki
 * blok „uciekałby" do góry bez powodu.
 */
export function transcriptScrollY(o: {
  rowTop: number; // y bieżącego bloku w treści scrolla
  rowHeight: number;
  spokenFrac: number; // ile bloku już wypowiedziane (0..1) — z czasów słów albo z upływu czasu
  lineHeight: number;
  viewportH: number;
  maxScroll: number;
  spareLines?: number;
  padTop?: number;
}): number {
  const { rowTop, rowHeight, spokenFrac, lineHeight, viewportH, maxScroll, spareLines = 2, padTop = 0 } = o;
  const pinned = rowTop - padTop; // blok przypięty do górnej krawędzi
  const frac = Math.max(0, Math.min(1, spokenFrac));
  // dolna krawędź wypowiadanego wiersza + wymagany zapas pod nim musi się zmieścić w szybie
  const needed = rowTop + rowHeight * frac + lineHeight * (1 + spareLines) - viewportH;
  return Math.max(0, Math.min(maxScroll, Math.max(pinned, needed)));
}

/**
 * Krok po segmentach transkryptu: dokąd skoczyć z pozycji `posSec` w kierunku `dir`.
 * Zwraca **null, gdy nie ma dokąd** — i to jest tu najważniejsze, bo wołający (joystick w playerze)
 * traktuje null jako sygnał „koniec treści tego nagrania" i dopiero wtedy przechodzi do sąsiedniego
 * nagrania. Bez tego rozróżnienia gałka albo grzęzłaby na ostatnim fragmencie, albo przeskakiwała
 * nagranie w środku transkryptu.
 *
 * W tył zachowuje się jak w odtwarzaczu CD: gdy jesteśmy głębiej niż `restartAfterSec` w bieżącym
 * fragmencie, pierwsze cofnięcie wraca na jego początek, a dopiero kolejne idzie do poprzedniego.
 */
export function segmentStep(starts: number[], posSec: number, dir: -1 | 1, restartAfterSec = 2): number | null {
  if (!starts.length) return null;
  let ci = 0;
  for (let i = 0; i < starts.length; i++) if (posSec >= starts[i] - 0.05) ci = i;
  if (dir === 1) return ci + 1 < starts.length ? starts[ci + 1] : null;
  if (posSec - starts[ci] > restartAfterSec) return starts[ci];
  return ci > 0 ? starts[ci - 1] : null;
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
