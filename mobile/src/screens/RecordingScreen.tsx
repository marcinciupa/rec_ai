/**
 * RecordingScreen — ekran nagrywania (node 161:12288), wariant AI on/off.
 * Mock flow: REC → timer leci + waveform animuje; NOTE → baner NOTES; MUTE/UNMUTE;
 * STOP → STOPPED AND SAVED; DELETE [HOLD] → kasuje (→ ready). Bez realnego audio.
 * Wariant AI (etykieta deAPI + „transcribing") wg ustawienia AUTO TRANSCRIBE.
 */
import { ReactNode, useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import { color, font, screen } from '../theme/tokens';
import type { KeyboardConfig } from '../components/chrome/Keyboard';
import { ScreenTopBar, BottomBar, Mode, stopBackKey } from './ScreenChrome';
import { useAudioCapture } from '../hooks/useAudioCapture';
import type { Rec } from '../hooks/useRecordings';
import { genericName, nextSeq } from '../hooks/useRecordings';
import { deriveAiStatus, type TranscriptionStore } from '../hooks/useTranscription';
import { persistRecording } from '../lib/recordingFiles';
import { uuidv4 } from '../lib/uuid';
import { hapticRecordStart, hapticRecordStop } from '../lib/haptics';

// redukcja obwiedni do N słupków (peak w każdym przedziale)
const downsample = (arr: number[], n: number): number[] => {
  if (arr.length <= n) return arr.slice();
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = Math.floor((i * arr.length) / n);
    const e = Math.max(s + 1, Math.floor(((i + 1) * arr.length) / n));
    let m = 0;
    for (let j = s; j < e; j++) m = Math.max(m, arr[j]);
    out.push(m);
  }
  return out;
};

// dzisiejsza data jako DD/MM/YY (format listy nagrań)
const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
};

type RecState = 'READY' | 'RECORDING' | 'PAUSED' | 'SAVED';

// odstęp, po którym gra buzz nagrywania — tyle, by haptik kliknięcia klawisza (press ~110 / release ~45 ms)
// zdążył wybrzmieć, więc buzz jest ODRĘBNYM, kolejnym sygnałem (sekwencja), a nie nakładką
const HAPTIC_AFTER_CLICK_MS = 90;

const fmt = (s: number) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
};
const glow = (c: string) => ({ textShadowColor: c, textShadowRadius: 4, textShadowOffset: { width: 0, height: 0 } });

/**
 * Waveform (full width, h53, space-between). active=true → przewijające się słupki: nowy po prawej.
 * `level` (0..1) = realny poziom z meteringu; gdy null → mock (losowo). active=false → równe kropki.
 */
function Waveform({ active, tint, level }: { active: boolean; tint: string; level: number | null }) {
  const N = 40;
  const [h, setH] = useState<number[]>(() => Array(N).fill(0));
  const levelRef = useRef(level);
  levelRef.current = level;
  useEffect(() => {
    if (!active) {
      setH(Array(N).fill(0));
      return;
    }
    const id = setInterval(() => {
      const v = levelRef.current != null ? levelRef.current : Math.random(); // realny lub mock
      setH((prev) => [...prev.slice(1), v]); // przewiń: nowy słupek po prawej
    }, 90);
    return () => clearInterval(id);
  }, [active]);
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', height: 53 }}
    >
      {h.map((v, i) => (
        <View
          key={i}
          style={{ width: 3, height: active ? 4 + v * 47 : 3, borderRadius: 1.5, backgroundColor: tint }}
        />
      ))}
    </View>
  );
}

/** Baner stanu — pigułka: NOTES (czerwona) / STOPPED AND SAVED (phosphor). */
function Banner({ text, tone }: { text: string; tone: 'red' | 'phosphor' }) {
  const bg = tone === 'phosphor' ? screen.olive.primary : color.recordRed;
  const shadow = tone === 'phosphor' ? 'rgba(226,255,228,0.25)' : 'rgba(255,76,76,0.25)';
  return (
    <View
      style={{
        alignSelf: 'stretch',
        alignItems: 'center',
        paddingVertical: 4,
        borderRadius: 2,
        backgroundColor: bg,
        boxShadow: `0px 0px 4px 0px ${shadow}`,
      }}
    >
      <Text style={{ fontFamily: font.timer.family, fontSize: 22, color: color.dark21, textAlign: 'center' }}>
        {text}
      </Text>
    </View>
  );
}

/** Baner PAUSED (czerwony, statyczny) nad zamrożonym waveformem. */
function PausedBanner() {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center' }}
    >
      <Banner text="PAUSED" tone="red" />
    </View>
  );
}

export function useRecordingScreen({
  aiEnabled,
  mono = false,
  quality = 'HIGH',
  mode = 'RECORDING',
  onCycleMode,
  onOpenSettings,
  onOpenRecordings,
  onOpenPlayer,
  onSave,
  recordings = [],
  transcription,
}: {
  aiEnabled: boolean;
  mono?: boolean;
  quality?: 'HIGH' | 'LOW'; // COMPRESSION → bitrate nagrywania (HIGH [BIG] / LOW [SMALL])
  mode?: Mode;
  onCycleMode?: () => void;
  onOpenSettings?: () => void;
  onOpenRecordings?: () => void;
  // PLAY w stanie SAVED: przenieś do playera świeżo zapisanego nagrania (po id) + autostart
  onOpenPlayer?: (id: string) => void;
  onSave?: (rec: Rec) => void;
  recordings?: Rec[];
  transcription?: TranscriptionStore;
}) {
  const capture = useAudioCapture();
  // nazwa pliku, który teraz powstaje: generyczna z dzisiejszej daty + kolejny numer dnia
  const recDate = today();
  const recSeq = nextSeq(recordings, recDate);
  const recName = genericName(recDate, recSeq);
  const [state, setState] = useState<RecState>('READY');
  const [elapsed, setElapsed] = useState(0);
  // id ostatnio zapisanego nagrania — realny stan transkrypcji czytamy z managera (useTranscription)
  const [lastSavedId, setLastSavedId] = useState<string | undefined>(undefined);
  // przerwanie nagrania: baner „RECORDING ABORTED" przez 3 s (plik NIE zapisany)
  const [abortedFlash, setAbortedFlash] = useState(false);
  const timers = useRef<{ ret?: any; abort?: any }>({});
  // obwiednia amplitudy: próbkujemy realny poziom w trakcie nagrywania → zapisujemy z plikiem
  const levelRef = useRef(capture.level);
  levelRef.current = capture.level;
  const samplesRef = useRef<number[]>([]);
  useEffect(() => {
    if (state !== 'RECORDING') return; // PAUSED zamraża zbieranie
    const id = setInterval(() => {
      const v = levelRef.current != null ? levelRef.current : Math.random(); // realny poziom (lub mock na web)
      samplesRef.current.push(v);
    }, 150);
    return () => clearInterval(id);
  }, [state]);

  // timer leci podczas nagrywania (PAUSE zamraża)
  useEffect(() => {
    if (state !== 'RECORDING') return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  // referencje do najświeższego stanu/capture dla cleanupu odmontowania (efekt [] nie widzi aktualnych)
  const stateRef = useRef(state);
  stateRef.current = state;
  const captureRef = useRef(capture);
  captureRef.current = capture;
  // sprzątanie przy odmontowaniu: timery + jeśli wciąż nagrywamy/pauza → przerwij recorder (zwolnij mikrofon
  // i sesję audio, skasuj plik tymczasowy) — inaczej MediaRecorder zostaje aktywny po wyjściu z ekranu
  useEffect(
    () => () => {
      const t = timers.current;
      clearTimeout(t.ret);
      clearTimeout(t.abort);
      if (stateRef.current === 'RECORDING' || stateRef.current === 'PAUSED') {
        captureRef.current.discard().catch(() => {});
      }
    },
    []
  );

  // SAVED → READY (po oknie 3 s, jeśli nie klikniesz PLAY)
  const goReady = () => setState('READY');
  // uzbrój auto-powrót do ready (3 s) — chyba że klikniesz PLAY (przejście do playera)
  const armReturn = () => {
    clearTimeout(timers.current.ret);
    timers.current.ret = setTimeout(goReady, 3000);
  };
  // PLAY w oknie SAVED → przenieś do playera tego nagrania (autostart); anuluj auto-powrót
  const openSavedInPlayer = () => {
    if (!lastSavedId) return;
    clearTimeout(timers.current.ret);
    onOpenPlayer?.(lastSavedId);
  };

  // baner sygnalizujący że nagranie się NIE rozpoczęło (brak uprawnień / błąd recordera)
  const flashAborted = () => {
    setAbortedFlash(true);
    clearTimeout(timers.current.abort);
    timers.current.abort = setTimeout(() => setAbortedFlash(false), 3000);
  };
  const start = async () => {
    clearTimeout(timers.current.ret); // przerwij auto-powrót do ready
    setAbortedFlash(false);
    setElapsed(0);
    samplesRef.current = []; // nowa obwiednia
    setState('RECORDING');
    // buzz „start" PO kliknięciu klawisza (sekwencja jak w fizycznym urządzeniu: klik → buzz). Opóźnienie,
    // bo na Androidzie każdy Vibration.vibrate kasuje poprzedni — inaczej haptik klawisza i buzz zjadałyby się.
    setTimeout(hapticRecordStart, HAPTIC_AFTER_CLICK_MS);
    // RECORD MODE → stereo/mono, QUALITY → jakość (bitrate); web → no-op (mock, real=false)
    const ok = await capture.start({ stereo: !mono, quality });
    // natywnie: false = odmowa mikrofonu / błąd prepare → NIE udawaj nagrywania (inaczej zapis pustego pliku)
    if (capture.real && !ok) {
      setState('READY');
      setElapsed(0);
      flashAborted();
    }
  };
  // PAUSE: zamraża timer i REALNIE zatrzymuje mikrofon (suspend = koniec segmentu; resume = nowy segment).
  const pause = () => {
    setState('PAUSED');
    capture.suspend();
  };
  const resume = () => {
    setState('RECORDING');
    capture.resumeCapture();
  };
  // ABORT [HOLD] → przerwij nagranie BEZ zapisu; baner „RECORDING ABORTED" 3 s → ready
  const abort = () => {
    clearTimeout(timers.current.ret);
    clearTimeout(timers.current.abort);
    setElapsed(0);
    setState('READY');
    setAbortedFlash(true);
    timers.current.abort = setTimeout(() => setAbortedFlash(false), 3000);
    capture.discard(); // przerwij i skasuj plik tymczasowy
  };
  // zapisz nagranie do wspólnego store (realny plik z uri, albo mock bez uri na web)
  const saveRecording = async (lengthSec: number) => {
    const captured = await capture.stop();
    // natywnie: brak uri = stop nie zwrócił pliku (błąd recordera) → nie zapisuj pustego, niegrywalnego wpisu
    if (capture.real && !captured?.uri) {
      setState('READY');
      setElapsed(0);
      flashAborted();
      return;
    }
    const id = `rec_${uuidv4()}`; // unikalne (Date.now() kolidował przy 2 zapisach w tej samej ms → nadpisanie)
    // przenieś nagrany plik z cache do TRWAŁEGO katalogu (documentDirectory/recordings/<id>.<ext>);
    // bez tego OS może skasować cache i nagranie przepada po restarcie
    let uri = captured?.uri;
    let sizeBytes = captured?.sizeBytes;
    if (uri) {
      try {
        const persisted = await persistRecording(uri, id);
        uri = persisted.uri;
        if (persisted.sizeBytes != null) sizeBytes = persisted.sizeBytes;
      } catch {}
    }
    const rec: Rec = {
      id,
      uri,
      date: recDate,
      lengthSec: Math.max(1, lengthSec),
      sizeBytes,
      seq: recSeq, // stabilny numer dnia (zgodny z wyświetlaną nazwą)
      samples: samplesRef.current.length ? downsample(samplesRef.current, 48) : undefined, // obwiednia do waveformu
      transcribed: false,
    };
    setLastSavedId(id);
    onSave?.(rec);
    // AUTO TRANSCRIBE: od razu realna transkrypcja (tylko gdy mamy plik — natywnie)
    if (aiEnabled && uri) transcription?.start(rec);
  };
  const stop = () => {
    setAbortedFlash(false);
    setTimeout(hapticRecordStop, HAPTIC_AFTER_CLICK_MS); // podwójny buzz „koniec" PO kliknięciu (sekwencja, nie nakładka)
    setState('SAVED');
    saveRecording(elapsed); // async: zapis pliku + (gdy AUTO TRANSCRIBE) realna transkrypcja przez manager
    // „STOPPED AND SAVED" przez 3 s, potem auto-powrót do ready (chyba że odpalisz podgląd PLAY)
    armReturn();
  };

  const saved = state === 'SAVED';
  const tint = saved ? screen.olive.primary : color.recordRed;
  const tintSecondary = saved ? screen.olive.secondary : screen.red.secondary;
  const glowC = saved ? 'rgba(226,255,228,0.25)' : 'rgba(255,76,76,0.25)';

  // klawiatura zależna od stanu (środkowy klawisz "screen" w nagrywaniu/mute jest pusty — wg projektu)
  // podczas nagrywania DELETE → ABORT (przerwij nagranie; [HOLD] = długie przytrzymanie)
  const abortKey = { label: 'ABORT', supporting: '[HOLD]', variant: 'risk' as const, onHoldComplete: abort, holdMs: 2000 };
  // metal[0] = stały fizyczny STOP/BACK; przy nagrywaniu/pauzie STOP świeci (stop+zapis), w READY/SAVED oba zgaszone (korzeń, brak powrotu)
  const stopActive = stopBackKey({ canStop: true, onStop: stop });
  const stopInactive = stopBackKey({ canStop: false });
  const playInactive = { type: 'label' as const, upper: 'PLAY', lower: 'PAUSE', active: false };
  // w oknie SAVED: PLAY/PAUSE aktywny → przejście do playera świeżego nagrania (autostart)
  const playSaved =
    state === 'SAVED' && lastSavedId
      ? { type: 'label' as const, upper: 'PLAY', lower: 'PAUSE', active: true, onPress: openSavedInPlayer }
      : playInactive;
  // RECORDINGS → lista nagrań; widoczny tylko gdy nie nagrywamy (znika w RECORDING/MUTED/PAUSED)
  const recordingsKey = { label: 'RECORD-\nINGS', onPress: onOpenRecordings };

  let keyboard: KeyboardConfig;
  if (state === 'READY') {
    keyboard = {
      screen: [{ label: '' }, { label: 'SETTINGS', onPress: onOpenSettings }, recordingsKey],
      metal: [stopInactive, { type: 'record', onPress: start }, playInactive],
    };
  } else if (state === 'RECORDING') {
    keyboard = {
      // ⏺ pauzuje (timer zamrożony, mikrofon zatrzymany). Środkowy klawisz pusty (MUTE usunięty).
      screen: [abortKey, { label: '' }, { label: '' }],
      metal: [stopActive, { type: 'record', onPress: pause }, playInactive],
    };
  } else if (state === 'PAUSED') {
    keyboard = {
      // ⏺ wznawia nagrywanie (nowy segment).
      screen: [abortKey, { label: '' }, { label: '' }],
      metal: [stopActive, { type: 'record', onPress: resume }, playInactive],
    };
  } else {
    // SAVED
    keyboard = {
      screen: [{ label: '' }, { label: 'SETTINGS', onPress: onOpenSettings }, recordingsKey],
      metal: [stopInactive, { type: 'record', onPress: start }, playSaved],
    };
  }

  // statusbar AI ostatniego nagrania (wspólny deriver): READY → UPLOADING/PROCESSING → DONE.
  // FAILED i kolor czerwony świadomie pominięte (patrz deriveAiStatus). AI off → IDLE (dim).
  const ai = deriveAiStatus({ tState: transcription?.stateOf(lastSavedId), aiArmed: aiEnabled });

  // waveform: recording = animowany, pełna czerwień; muted = animowany 0 (cisza); ready/paused = kropki
  const waveActive = state === 'RECORDING';
  const waveTint = state === 'RECORDING' ? color.recordRed : screen.red.secondary;
  const slot: ReactNode = abortedFlash ? (
    <Banner text="RECORDING ABORTED" tone="red" />
  ) : saved ? (
    <Banner text="STOPPED AND SAVED" tone="phosphor" />
  ) : (
    <Waveform active={waveActive} tint={waveTint} level={capture.level} />
  );

  const content = (
    <>
      <ScreenTopBar
        mode={mode}
        // podczas nagrywania/mute/pauzy zmiana trybu zablokowana (pill nieklikalny)
        onCycleMode={state === 'RECORDING' || state === 'PAUSED' ? undefined : onCycleMode}
        ai={ai}
        labelActive={state === 'RECORDING'}
        labelBlink={state === 'RECORDING'}
      />
      {/* content_area: gap 24, padding 0 16 */}
      <View style={{ flex: 1, alignSelf: 'stretch', justifyContent: 'center', gap: 24, paddingHorizontal: 16 }}>
        <View style={{ height: 53, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }}>
          {slot}
          {state === 'PAUSED' ? <PausedBanner /> : null}
        </View>
        {/* timer + podkreślenie (2px, glow) + storage (lewo, secondary) */}
        <View style={{ alignSelf: 'stretch', gap: 8 }}>
          <View style={{ alignSelf: 'stretch', alignItems: 'center' }}>
            <Text
              style={{
                fontFamily: font.timer.family,
                fontSize: font.timer.size,
                color: tint,
                ...glow(glowC),
              }}
            >
              {fmt(elapsed)}
            </Text>
            <View
              style={
                { alignSelf: 'stretch', height: 2, borderRadius: 2, backgroundColor: tint, boxShadow: `0px 0px 4px 0px ${glowC}` } as any
              }
            />
          </View>
          {/* podczas nagrywania/pauzy: nazwa pliku (lewo) + storage (prawo); inaczej storage wyśrodkowany */}
          {state === 'RECORDING' || state === 'PAUSED' ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch' }}>
              <Text style={{ fontFamily: font.caption.family, fontSize: font.caption.size, color: tintSecondary }}>{recName}</Text>
              <Text style={{ fontFamily: font.caption.family, fontSize: font.caption.size, color: tintSecondary }}>~311h/32.3GB AVAILABLE</Text>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', justifyContent: 'center', alignSelf: 'stretch' }}>
              <Text style={{ fontFamily: font.caption.family, fontSize: font.caption.size, color: tintSecondary }}>~311h/32.3GB AVAILABLE</Text>
            </View>
          )}
        </View>
      </View>
      <BottomBar active={state === 'RECORDING'} mono={mono} quality={quality} muted={false} level={capture.level} />
    </>
  );

  return {
    content,
    keyboard,
    isRecording: state === 'RECORDING',
    isMuted: false,
  };
}
