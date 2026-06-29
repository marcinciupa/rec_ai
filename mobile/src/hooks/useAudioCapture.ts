/**
 * useAudioCapture — realne nagrywanie mikrofonem (expo-audio, SDK56). Tylko natywnie.
 *
 * MUTE/PAUSE = SEGMENTY: zamiast MediaRecorder.pause() (zawodne na Androidzie — nie zatrzymuje
 * realnie capture'u) faktycznie KOŃCZYMY segment (recorder.stop) i na wznowieniu startujemy nowy.
 * Dzięki temu mikrofon naprawdę przestaje nagrywać. Format = AAC ADTS (.aac), bo takie pliki
 * można skleić zwykłym złączeniem bajtów (m4a/mp4 NIE) — na stop() łączymy segmenty w jeden plik.
 *
 * TODO (po potwierdzeniu segmentów na urządzeniu): wstawianie ciszy o długości przerwy między
 * segmentami, żeby długość nagrania = czas na timerze (na razie „cut" — wyciszony fragment pominięty).
 */
import { Platform } from 'react-native';
import {
  useAudioRecorder,
  useAudioRecorderState,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useRef } from 'react';

const REAL = Platform.OS !== 'web';

// AAC ADTS mono — segmenty sklejalne bajtowo; mono upraszcza ewentualną ciszę i wystarcza dyktafonowi.
const REC_OPTIONS: any = {
  extension: '.aac',
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 96000,
  isMeteringEnabled: true,
  android: { outputFormat: 'aac_adts', audioEncoder: 'aac' },
  ios: { outputFormat: 'aac ', audioQuality: 0x7f, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
};

// dBFS (~-55..0) → 0..1
const normLevel = (db: number | null | undefined) =>
  typeof db === 'number' && isFinite(db) ? Math.max(0, Math.min(1, (db + 55) / 55)) : null;

export function useAudioCapture() {
  const recorder = useAudioRecorder(REC_OPTIONS);
  const state = useAudioRecorderState(recorder);
  const level = normLevel(state?.metering);
  const segments = useRef<string[]>([]); // uri kolejnych segmentów (między pauzami)
  // opcje formatu wybrane na start nagrania (RECORD MODE / COMPRESSION) — te same dla wszystkich segmentów,
  // żeby sklejanie AAC zadziałało. Nadpisują bazowe REC_OPTIONS przez prepareToRecordAsync(Partial).
  const fmtRef = useRef<{ numberOfChannels: number; bitRate: number }>({ numberOfChannels: 1, bitRate: 96000 });

  const beginSegment = async () => {
    await recorder.prepareToRecordAsync(fmtRef.current);
    recorder.record();
  };
  // zakończ bieżący segment i zachowaj jego uri
  const endSegment = async () => {
    try {
      await recorder.stop();
      if (recorder.uri) segments.current.push(recorder.uri);
    } catch {}
  };

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
      // RECORD MODE → kanały (stereo=2/mono=1); COMPRESSION → bitrate (HIGH=192k [BIG] / LOW=64k [SMALL])
      fmtRef.current = { numberOfChannels: opts?.stereo ? 2 : 1, bitRate: opts?.quality === 'LOW' ? 64000 : 192000 };
      segments.current = [];
      await beginSegment();
      return true;
    } catch {
      return false;
    }
  };

  // MUTE/PAUSE → realnie zatrzymaj mikrofon (zakończ segment). RESUME/UNMUTE → nowy segment.
  const suspend = async () => {
    if (!REAL) return;
    await endSegment();
  };
  const resumeCapture = async () => {
    if (!REAL) return;
    try {
      await beginSegment();
    } catch {}
  };

  // złącz wszystkie segmenty (ADTS AAC) w jeden plik przez konkatenację bajtów
  const concatSegments = async (uris: string[]): Promise<string | undefined> => {
    if (uris.length === 0) return undefined;
    if (uris.length === 1) return uris[0];
    try {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (const u of uris) {
        const bytes = await new File(u).bytes();
        chunks.push(bytes);
        total += bytes.length;
      }
      const merged = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.length;
      }
      const out = new File(Paths.cache, `rec_${Date.now()}_${total}.aac`);
      out.create({ overwrite: true });
      out.write(merged);
      // posprzątaj segmenty
      for (const u of uris) {
        try {
          new File(u).delete();
        } catch {}
      }
      return out.uri;
    } catch {
      return uris[0]; // fallback: przynajmniej pierwszy segment
    }
  };

  // kończy nagranie: domyka ostatni segment, skleja wszystkie → {uri, sizeBytes}
  const stop = async (): Promise<{ uri: string; sizeBytes?: number } | null> => {
    if (!REAL) return null;
    await endSegment();
    const uri = await concatSegments(segments.current);
    segments.current = [];
    await restorePlayback(); // wróć do trybu odtwarzania (PLAY działa po powrocie z czatu)
    if (!uri) return null;
    let sizeBytes: number | undefined;
    try {
      const s = new File(uri).size;
      if (s && s > 0) sizeBytes = s;
    } catch {}
    return { uri, sizeBytes };
  };

  // przerwij i skasuj wszystkie segmenty
  const discard = async (): Promise<void> => {
    if (!REAL) return;
    await endSegment();
    for (const u of segments.current) {
      try {
        new File(u).delete();
      } catch {}
    }
    segments.current = [];
    await restorePlayback(); // wróć do trybu odtwarzania (PLAY działa po powrocie z czatu)
  };

  return { start, stop, discard, suspend, resumeCapture, level, real: REAL };
}
