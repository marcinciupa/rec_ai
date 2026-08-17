/**
 * Skróty rozmówców — „Marc" → „MRC", „Tabitha" → „TBT". Czysta logika, BEZ importów RN,
 * uruchamiana w testach (tools/test-speaker-label.mjs).
 *
 * Po co: numer („1", „2") jest uczciwie anonimowy, ale nic nie mówi. Skrót imienia czyta się od razu.
 * Cena: numer, gdy się myli, myli się WIDOCZNIE; imię myli się PRZEKONUJĄCO — czytelnik uwierzy, że
 * dane zdanie powiedział Marek. Dlatego imię pojawia się wyłącznie wtedy, gdy naprawdę padło
 * w nagraniu i model jest pewny; w każdym innym przypadku zostaje numer.
 */

// Samogłoski PL+EN (y traktujemy jako samogłoskę — „Krystyna" → KRS, nie KYS).
const VOWELS = new Set('AĄEĘIOÓUYÀÁÂÄÅÃÈÉÊËÌÍÎÏÒÓÔÖÕÙÚÛÜ'.split(''));

/** Czy string wygląda na imię, a nie na wymówkę modelu („nieznane", „brak", „speaker 1"). */
export function isUsableName(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const s = raw.trim();
  if (s.length < 2 || s.length > 40) return false;
  if (/\d/.test(s)) return false; // „Speaker 1", „Osoba 2"
  if (!/^[\p{L}][\p{L}\s'’-]*$/u.test(s)) return false; // tylko litery + typowe łączniki
  const low = s.toLowerCase();
  const junk = ['unknown', 'nieznany', 'nieznana', 'nieznane', 'brak', 'none', 'null', 'n/a', 'osoba', 'speaker', 'mówca', 'rozmówca', 'null'];
  return !junk.includes(low);
}

/**
 * Imię → maksymalnie 3 znaki, wersaliki, z zachowaniem diakrytyków (font Kode Mono je ma).
 * Reguła: pierwsza litera + kolejne SPÓŁGŁOSKI („Łukasz" → ŁKS, „Marc" → MRC).
 * Za mało spółgłosek → pierwsze 3 litery („Ewa" → EWA, „Ala" → ALA), bo „EW" czyta się gorzej niż „EWA".
 * Imiona krótsze niż 3 litery zwracają tyle, ile mają („Bo" → BO) — nie da się wyprodukować
 * trzeciego znaku z niczego, a dopisywanie cyfry robiłoby z imienia numer.
 */
export function abbreviateName(name: string): string {
  const letters = name.trim().replace(/[^\p{L}]/gu, '').toUpperCase();
  if (!letters) return '';
  const consonants = [...letters.slice(1)].filter((c) => !VOWELS.has(c));
  const byConsonant = (letters[0] + consonants.join('')).slice(0, 3);
  return byConsonant.length >= 3 ? byConsonant : letters.slice(0, 3);
}

/**
 * Rozstrzyga kolizje: „Marc" i „Marcin" dają oba MRC, a dwie osoby z jednym identyfikatorem to
 * dokładnie ten błąd, którego skróty miały uniknąć. Kolejność prób dla kolidującego:
 * pierwsze 3 litery imienia → podmiana ostatniego znaku na numer rozmówcy.
 * `order` wyznacza, kto zachowuje pierwotny skrót (pierwszy zgłoszony wygrywa).
 */
export function resolveCollisions(entries: { id: string; name: string; no: number }[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const { id, name, no } of entries) {
    const letters = name.trim().replace(/[^\p{L}]/gu, '').toUpperCase();
    const candidates = [abbreviateName(name), letters.slice(0, 3)];
    let label = candidates.find((c) => c && !taken.has(c));
    if (!label) {
      const base = candidates[0] || letters.slice(0, 2) || String(no);
      label = (base.slice(0, 2) + no).slice(0, 3); // np. MRC → MR2
    }
    taken.add(label);
    out.set(id, label);
  }
  return out;
}

/**
 * Finalne etykiety kolumny rozmówców: skrót imienia tam, gdzie znane i pewne, numer w pozostałych.
 * Mieszanka („MRC", „2", „TBT") jest w porządku — lepsza niż zmyślenie imienia dla kogoś, kogo
 * model nie rozpoznał.
 *
 * @param numbers  mapa id → numer wg kolejności wejścia (speakerNumbers z lib/transcript)
 * @param names    mapa id → imię z AI; wpisy nieprzechodzące isUsableName są ignorowane
 */
export function speakerLabels(numbers: Map<string, number>, names?: Record<string, unknown> | null): Map<string, string> {
  const named = [...numbers.entries()]
    .filter(([id]) => isUsableName(names?.[id]))
    .map(([id, no]) => ({ id, name: String(names![id]).trim(), no }))
    .sort((a, b) => a.no - b.no); // pierwszy mówiący zachowuje swój skrót przy kolizji
  const resolved = resolveCollisions(named);
  const out = new Map<string, string>();
  for (const [id, no] of numbers) out.set(id, resolved.get(id) ?? String(no));
  return out;
}
