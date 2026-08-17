/**
 * Wolne miejsce — wariant web. Przeglądarka NIE widzi dysku urządzenia: `navigator.storage.estimate()`
 * zwraca limit dla origin (quota piaskownicy), a nie miejsce na telefonie — pokazanie tego jako
 * „AVAILABLE" byłoby wprost mylące. Zwracamy null i ekran po prostu nie rysuje tej linijki.
 * Web służy u nas do podglądu/QA UI, więc brak jednej etykiety jest akceptowalny; zmyślona liczba nie.
 *
 * Ten sam interfejs co useStorage.ts.
 */
import type { Quality } from '../lib/storage';

export type { Quality };

export function readFreeBytes(): number | null {
  return null;
}

export function useStorageLabel(_quality: Quality = 'HIGH', _refreshKey?: unknown): string | null {
  return null;
}
