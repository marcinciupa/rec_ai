/**
 * Formatowanie etykiety wolnego miejsca — czysta logika, BEZ importów React Native / expo, żeby
 * dała się uruchomić i przetestować poza aplikacją (tools/test-storage.mjs).
 * Odczyt z urządzenia i odświeżanie: hooks/useStorage.ts.
 */
export type Quality = 'HIGH' | 'LOW';

// Bitrate AAC wg ustawienia QUALITY — musi zgadzać się z useAudioCapture (HIGH=192k / LOW=64k).
// Godziny liczymy z niego, bo to jedyne, co realnie decyduje, ile nagrania się zmieści.
// `numberOfChannels` NIE wpływa: bitRate jest łączny dla strumienia, nie na kanał.
export const REC_BITRATE: Record<Quality, number> = { HIGH: 192000, LOW: 64000 };

/** Bajty → „32.3GB" / „870MB". Dziesiętne GB (1e9), tak jak liczy je system w ustawieniach telefonu. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  return `${Math.round(bytes / 1e6)}MB`;
}

/** Sekundy nagrania → „~373h" / „~45min". Poniżej minuty nie ma o czym mówić. */
export function formatDuration(seconds: number): string {
  const h = seconds / 3600;
  if (h >= 1) return `~${Math.round(h)}h`;
  const m = Math.round(seconds / 60);
  return m >= 1 ? `~${m}min` : '<1min';
}

/**
 * Etykieta wolnego miejsca, np. „~374h/32.3GB AVAILABLE".
 * `null` = nie dało się odczytać — wołający NIE rysuje wtedy linijki. Świadomie nie podstawiamy
 * żadnej liczby zastępczej: fałszywa informacja o wolnym miejscu jest gorsza niż jej brak
 * (użytkownik zaczyna nagrywać w przekonaniu, że ma zapas).
 */
export function storageLabel(freeBytes: number | null, quality: Quality): string | null {
  if (freeBytes == null || !Number.isFinite(freeBytes) || freeBytes < 0) return null;
  const seconds = freeBytes / (REC_BITRATE[quality] / 8);
  return `${formatDuration(seconds)}/${formatBytes(freeBytes)} AVAILABLE`;
}
