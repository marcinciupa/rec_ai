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
import { ScreenTopBar, BottomBar, Mode } from './ScreenChrome';
import { useBlink } from '../theme/BlinkContext';
import { useAudioCapture } from '../hooks/useAudioCapture';
import { usePlayer } from '../hooks/usePlayer';
import type { Rec } from '../hooks/useRecordings';
import { genericName, nextSeq } from '../hooks/useRecordings';

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

type RecState = 'READY' | 'RECORDING' | 'MUTED' | 'PAUSED' | 'SAVED';

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
          style={{ width: 3, height: active ? 4 + v * 44 : 3, borderRadius: 1.5, backgroundColor: tint }}
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

/** Baner MUTED (czerwony) migający nad wygaszonym waveformem. */
function MutedBanner() {
  const on = useBlink();
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center', opacity: on ? 1 : 0 }}
    >
      <Banner text="MUTED" tone="red" />
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
  mode = 'RECORDING',
  onCycleMode,
  onOpenSettings,
  onOpenRecordings,
  onSave,
  recordings = [],
}: {
  aiEnabled: boolean;
  mono?: boolean;
  mode?: Mode;
  onCycleMode?: () => void;
  onOpenSettings?: () => void;
  onOpenRecordings?: () => void;
  onSave?: (rec: Rec) => void;
  recordings?: Rec[];
}) {
  const capture = useAudioCapture();
  // odtwarzacz do szybkiego podglądu właśnie zapisanego pliku (klawisz PLAY/PAUSE w stanie SAVED)
  const { player, status: pstatus } = usePlayer();
  const [savedUri, setSavedUri] = useState<string | undefined>(undefined);
  const playerLoaded = useRef(false);
  // nazwa pliku, który teraz powstaje: generyczna z dzisiejszej daty + kolejny numer dnia
  const recDate = today();
  const recSeq = nextSeq(recordings, recDate);
  const recName = genericName(recDate, recSeq);
  const [state, setState] = useState<RecState>('READY');
  const [elapsed, setElapsed] = useState(0);
  // transkrypcja w tle (niezależna od ekranu): null = brak/idle, 0..100 = postęp.
  const [transcribePct, setTranscribePct] = useState<number | null>(null);
  // przerwanie nagrania: baner „RECORDING ABORTED" przez 3 s (plik NIE zapisany)
  const [abortedFlash, setAbortedFlash] = useState(false);
  const timers = useRef<{ connect?: any; prog?: any; ret?: any; abort?: any }>({});
  // obwiednia amplitudy: próbkujemy realny poziom w trakcie nagrywania → zapisujemy z plikiem
  const levelRef = useRef(capture.level);
  levelRef.current = capture.level;
  const samplesRef = useRef<number[]>([]);
  useEffect(() => {
    if (state !== 'RECORDING' && state !== 'MUTED') return; // PAUSED zamraża zbieranie
    const id = setInterval(() => {
      // MUTED = mikrofon zatrzymany (cisza) → 0; inaczej realny poziom (lub mock na web)
      const v = state === 'MUTED' ? 0 : levelRef.current != null ? levelRef.current : Math.random();
      samplesRef.current.push(v);
    }, 150);
    return () => clearInterval(id);
  }, [state]);

  // timer leci podczas nagrywania (też w mute)
  useEffect(() => {
    if (state !== 'RECORDING' && state !== 'MUTED') return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  // sprzątanie timerów przy odmontowaniu
  useEffect(
    () => () => {
      const t = timers.current;
      clearTimeout(t.connect);
      clearInterval(t.prog);
      clearTimeout(t.ret);
      clearTimeout(t.abort);
    },
    []
  );

  // SAVED → READY: zatrzymaj i zwolnij podgląd, wyczyść uri
  const goReady = () => {
    if (playerLoaded.current) {
      player.pause();
      playerLoaded.current = false;
    }
    setSavedUri(undefined);
    setState('READY');
  };
  // uzbrój auto-powrót do ready (3 s) — chyba że użytkownik odpali podgląd
  const armReturn = () => {
    clearTimeout(timers.current.ret);
    timers.current.ret = setTimeout(goReady, 3000);
  };
  // PLAY/PAUSE w stanie SAVED — podgląd właśnie zapisanego pliku przez krótkie okno SAVED
  const togglePlaySaved = () => {
    if (!savedUri) return;
    clearTimeout(timers.current.ret); // w trakcie obsługi nie wracaj do ready
    if (!playerLoaded.current) {
      player.replace({ uri: savedUri });
      playerLoaded.current = true;
      player.play();
    } else if (pstatus.playing) {
      player.pause();
      armReturn(); // pauza → znów odlicz powrót
    } else {
      player.play();
    }
  };
  // koniec odtwarzania → wróć na start i uzbrój powrót do ready
  useEffect(() => {
    if (state === 'SAVED' && (pstatus as any).didJustFinish) {
      player.seekTo(0);
      player.pause();
      armReturn();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(pstatus as any).didJustFinish, state]);

  const start = () => {
    clearTimeout(timers.current.ret); // przerwij auto-powrót do ready
    if (playerLoaded.current) {
      player.pause(); // zatrzymaj ewentualny podgląd
      playerLoaded.current = false;
    }
    setSavedUri(undefined);
    setAbortedFlash(false);
    setElapsed(0);
    samplesRef.current = []; // nowa obwiednia
    setState('RECORDING');
    capture.start(); // realne nagrywanie (natywnie; web → no-op, mock)
  };
  // PAUSE: zamraża timer; MUTE: timer leci. Oba REALNIE zatrzymują mikrofon (suspend = koniec segmentu).
  const pause = () => {
    setState('PAUSED');
    capture.suspend();
  };
  const mute = () => {
    setState('MUTED');
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
    setSavedUri(captured?.uri); // udostępnij pod klawiszem PLAY/PAUSE w oknie SAVED
    onSave?.({
      id: `rec_${Date.now()}`,
      uri: captured?.uri,
      date: recDate,
      lengthSec: Math.max(1, lengthSec),
      sizeBytes: captured?.sizeBytes,
      seq: recSeq, // stabilny numer dnia (zgodny z wyświetlaną nazwą)
      samples: samplesRef.current.length ? downsample(samplesRef.current, 48) : undefined, // obwiednia do waveformu
      transcribed: false,
    });
  };
  const stop = () => {
    setAbortedFlash(false);
    setState('SAVED');
    saveRecording(elapsed); // async zapis pliku (nie blokuje UI)
    // „STOPPED AND SAVED" przez 3 s, potem auto-powrót do ready (chyba że odpalisz podgląd PLAY)
    armReturn();
    // transkrypcja w tle (jeśli AI): connect ~1.5 s → procenty rosną do 100, działa też po powrocie do ready
    if (aiEnabled) {
      clearTimeout(timers.current.connect);
      clearInterval(timers.current.prog);
      setTranscribePct(null); // faza „connecting" → label ACTIVE ON DEAPI
      timers.current.connect = setTimeout(() => {
        setTranscribePct(0);
        timers.current.prog = setInterval(() => {
          setTranscribePct((p) => {
            const np = (p ?? 0) + 4;
            if (np >= 100) {
              clearInterval(timers.current.prog);
              setTimeout(() => setTranscribePct(null), 1000); // pokaż 100% chwilę, potem idle
              return 100;
            }
            return np;
          });
        }, 600);
      }, 1500);
    }
  };

  const saved = state === 'SAVED';
  const tint = saved ? screen.olive.primary : color.recordRed;
  const tintSecondary = saved ? screen.olive.secondary : screen.red.secondary;
  const glowC = saved ? 'rgba(226,255,228,0.25)' : 'rgba(255,76,76,0.25)';

  // klawiatura zależna od stanu (środkowy klawisz "screen" w nagrywaniu/mute jest pusty — wg projektu)
  // podczas nagrywania DELETE → ABORT (przerwij nagranie; [HOLD] = długie przytrzymanie)
  const abortKey = { label: 'ABORT', supporting: '[HOLD]', variant: 'risk' as const, onHoldComplete: abort, holdMs: 2000 };
  const stopActive = { type: 'label' as const, upper: 'STOP', active: true, onPress: stop };
  const stopInactive = { type: 'label' as const, upper: 'STOP', active: false };
  const playInactive = { type: 'label' as const, upper: 'PLAY', lower: 'PAUSE', active: false };
  // w stanie SAVED, gdy jest realny plik (uri): PLAY/PAUSE aktywny → podgląd nagrania
  const playSaved =
    savedUri
      ? { type: 'label' as const, upper: 'PLAY', lower: 'PAUSE', active: true, onPress: togglePlaySaved }
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
      // MUTE: wycisza (zatrzymuje mikrofon), timer leci. ⏺ pauzuje (timer zamrożony).
      screen: [abortKey, { label: '' }, { label: 'MUTE', variant: 'risk', onPress: mute }],
      metal: [stopActive, { type: 'record', onPress: pause }, playInactive],
    };
  } else if (state === 'MUTED') {
    keyboard = {
      screen: [abortKey, { label: '' }, { label: 'UNMUTE', variant: 'highRisk', onPress: resume }],
      metal: [stopActive, { type: 'record', onPress: pause }, playInactive],
    };
  } else if (state === 'PAUSED') {
    keyboard = {
      // ⏺ wznawia; MUTE z pauzy → MUTED (mikrofon i tak zatrzymany, zmienia się tylko timer/banner)
      screen: [abortKey, { label: '' }, { label: 'MUTE', variant: 'risk', onPress: () => setState('MUTED') }],
      metal: [stopActive, { type: 'record', onPress: resume }, playInactive],
    };
  } else {
    // SAVED
    keyboard = {
      screen: [{ label: '' }, { label: 'SETTINGS', onPress: onOpenSettings }, recordingsKey],
      metal: [stopInactive, { type: 'record', onPress: start }, playSaved],
    };
  }

  // transkrypcja aktywna (procenty) → „TRANSCRIBING (X%)"; inaczej (idle/connecting) → „ACTIVE ON DEAPI"
  const ai: [string, string] | undefined = aiEnabled
    ? transcribePct != null
      ? ['AI TRANSCRIBING', `IN BACKGROUND (${transcribePct}%)`]
      : ['AI TRANSCRIPTION', 'ACTIVE ON DEAPI']
    : undefined;

  // waveform: recording = animowany, pełna czerwień; muted = animowany 0 (cisza); ready/paused = kropki
  const waveActive = state === 'RECORDING' || state === 'MUTED';
  const waveTint = state === 'RECORDING' ? color.recordRed : screen.red.secondary;
  const slot: ReactNode = abortedFlash ? (
    <Banner text="RECORDING ABORTED" tone="red" />
  ) : saved ? (
    <Banner text="STOPPED AND SAVED" tone="phosphor" />
  ) : (
    <Waveform active={waveActive} tint={waveTint} level={state === 'MUTED' ? 0 : capture.level} />
  );

  const content = (
    <>
      <ScreenTopBar
        mode={mode}
        // podczas nagrywania/mute/pauzy zmiana trybu zablokowana (pill nieklikalny)
        onCycleMode={state === 'RECORDING' || state === 'MUTED' || state === 'PAUSED' ? undefined : onCycleMode}
        ai={ai}
        labelActive={state === 'RECORDING' || state === 'MUTED'}
        labelBlink={state === 'RECORDING'}
      />
      {/* content_area: gap 24, padding 0 16 */}
      <View style={{ flex: 1, alignSelf: 'stretch', justifyContent: 'center', gap: 24, paddingHorizontal: 16 }}>
        <View style={{ height: 53, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }}>
          {slot}
          {state === 'MUTED' ? <MutedBanner /> : null}
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
          {state === 'RECORDING' || state === 'MUTED' || state === 'PAUSED' ? (
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
      <BottomBar active={state === 'RECORDING' || state === 'MUTED'} mono={mono} muted={state === 'MUTED'} level={state === 'MUTED' ? 0 : capture.level} />
    </>
  );

  return {
    content,
    keyboard,
    isRecording: state === 'RECORDING' || state === 'MUTED',
    isMuted: state === 'MUTED',
  };
}
