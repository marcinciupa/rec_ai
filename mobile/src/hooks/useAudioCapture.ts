/**
 * useAudioCapture — realne nagrywanie mikrofonem (expo-audio, SDK56). Tylko natywnie.
 *
 * Format = AAC w kontenerze MPEG-4 (.m4a) — SEEKOWALNY (ADTS .aac NIE jest: Android MediaPlayer nie
 * potrafi w nim przewijać i seekTo wraca do 0 → tap/prev-next/scrub „odtwarzają od początku").
 *
 * PAUSE = NATYWNA pauza MediaRecorder (expo-audio `recorder.pause()` → `record()` woła `resume()` na
 * tym samym pliku; wymaga API 24+, mamy minSdk 24). Jeden ciągły plik m4a — bez sklejania bajtów
 * (m4a/mp4 ma kontener z moov atom, więc bajtowo skleić się NIE da; dlatego porzucamy stare segmenty).
 */
import { Platform } from 'react-native';
import {
  useAudioRecorder,
  useAudioRecorderState,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useRef } from 'react';

const REAL = Platform.OS !== 'web';

// AAC w kontenerze MPEG-4 (.m4a) — seekowalny (indeks/moov atom). Android: outputFormat 'mpeg4' + enkoder
// 'aac'. iOS: 'aac ' (= MPEG4AAC) w .m4a. Mono wystarcza dyktafonowi (RECORD MODE STEREO nadpisuje kanały).
const REC_OPTIONS: any = {
  extension: '.m4a',
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 96000,
  isMeteringEnabled: true,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { outputFormat: 'aac ', audioQuality: 0x7f, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
};

// dBFS (~-55..0) → 0..1
const normLevel = (db: number | null | undefined) =>
  typeof db === 'number' && isFinite(db) ? Math.max(0, Math.min(1, (db + 55) / 55)) : null;

export function useAudioCapture() {
  const recorder = useAudioRecorder(REC_OPTIONS);
  const state = useAudioRecorderState(recorder);
  const level = normLevel(state?.metering);
  // PEŁNE opcje nagrania (RECORD MODE/COMPRESSION). MUSI być PEŁNY obiekt (REC_OPTIONS + nadpisania), bo
  // prepareToRecordAsync(Partial) gubił format/extension → plik w złym formacie i transkrypcja nie działała.
  const fmtRef = useRef<any>(REC_OPTIONS);

  // po nagraniu wróć do trybu ODTWARZANIA — inaczej sesja zostaje w „record" (iOS PlayAndRecord)
  // i odtwarzacz nie gra po powrocie z czatu (klawisz PLAY „nie działa"). Wołane na stop i discard.
  const restorePlayback = async () => {
    if (!REAL) return;
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    } catch {}
  };

  const start = async (opts?: { stereo?: boolean; quality?: 'HIGH' | 'LOW' }): Promise<boolean> => {
    if (!REAL) return false;
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) return false;
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      // RECORD MODE → kanały (stereo=2/mono=1); COMPRESSION → bitrate (HIGH=192k [BIG] / LOW=64k [SMALL]).
      // PEŁNE opcje (spread REC_OPTIONS) — zachowaj kontener/extension, nadpisz tylko kanały/bitrate.
      fmtRef.current = { ...REC_OPTIONS, numberOfChannels: opts?.stereo ? 2 : 1, bitRate: opts?.quality === 'LOW' ? 64000 : 192000 };
      await recorder.prepareToRecordAsync(fmtRef.current);
      recorder.record();
      return true;
    } catch {
      await restorePlayback(); // błąd prepare/record → przywróć tryb odtwarzania (inaczej sesja utyka w „record")
      return false;
    }
  };

  // PAUSE → natywna pauza MediaRecorder (ten sam plik). RESUME → record() woła resume() na tym samym pliku.
  const suspend = async () => {
    if (!REAL) return;
    try { recorder.pause(); } catch {}
  };
  const resumeCapture = async () => {
    if (!REAL) return;
    try { recorder.record(); } catch {}
  };

  // kończy nagranie: zatrzymaj recorder → jeden ciągły plik m4a {uri, sizeBytes}
  const stop = async (): Promise<{ uri: string; sizeBytes?: number } | null> => {
    if (!REAL) return null;
    try { await recorder.stop(); } catch {}
    const uri = recorder.uri ?? undefined;
    await restorePlayback(); // wróć do trybu odtwarzania (PLAY działa po powrocie z czatu)
    if (!uri) return null;
    let sizeBytes: number | undefined;
    try {
      const s = new File(uri).size;
      if (s && s > 0) sizeBytes = s;
    } catch {}
    return { uri, sizeBytes };
  };

  // przerwij i skasuj plik nagrania
  const discard = async (): Promise<void> => {
    if (!REAL) return;
    try { await recorder.stop(); } catch {}
    const uri = recorder.uri;
    if (uri) {
      try { new File(uri).delete(); } catch {}
    }
    await restorePlayback(); // wróć do trybu odtwarzania (PLAY działa po powrocie z czatu)
  };

  return { start, stop, discard, suspend, resumeCapture, level, real: REAL };
}
