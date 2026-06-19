/**
 * useAudioCapture (web) — no-op. Na web nie nagrywamy (podgląd); RecordingScreen używa mocka.
 * Brak importu expo-audio/expo-file-system, by web-bundle nie wciągał natywnych modułów.
 */
export function useAudioCapture() {
  return {
    start: async () => false,
    stop: async () => null as { uri: string; sizeBytes?: number } | null,
    discard: async () => {},
    suspend: async () => {},
    resumeCapture: async () => {},
    level: null as number | null,
    real: false,
  };
}
