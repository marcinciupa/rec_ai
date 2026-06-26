/**
 * PlaybackScreen — tryb PLAYBACK: dwa widoki.
 *  • LIST (Figma 214:4132): lista nagrań; wybór (slider/tap), DELETE (tap=prompt/hold=usuń), TRANS-CRIBE.
 *  • PLAYER (Figma 218:4890, wersja bez AI): dedykowany odtwarzacz — LOADING → STOPPED/PLAYING/PAUSED.
 *    Waveform + pozycja/długość + storage; transport STOP/PLAY-PAUSE; DELETE/TRANS-CRIBE/RECORDINGS,
 *    2X SPEED (gdy gra), ABORT (gdy ładuje). PLAY na liście otwiera PLAYER.
 * Pliki: z transkrypcją = tytuł (AI) + aktywna ikona AI; bez = generyczna nazwa z daty + wygaszona ikona.
 */
import { ReactNode, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { usePlayer } from '../hooks/usePlayer';
import { hapticKnob, hapticContinuous } from '../lib/haptics';
import { getTranscript } from '../lib/db';
import type { Transcript } from '../lib/types';
import { color, font, screen } from '../theme/tokens';
import type { KeyboardConfig } from '../components/chrome/Keyboard';
import type { SliderConfig } from '../components/chrome/SeekSlider';
import { ScreenTopBar, BottomBar, Mode } from './ScreenChrome';
import type { Rec, RecordingsStore } from '../hooks/useRecordings';
import { genericName } from '../hooks/useRecordings';
import type { TranscriptionStore } from '../hooks/useTranscription';
import { useChatView } from './ChatView';

type Phase = 'LIST' | 'CONFIRM' | 'DELETED';
type View2 = 'LIST' | 'PLAYER' | 'CHAT';
type PlayerState = 'LOADING' | 'STOPPED' | 'PLAYING' | 'PAUSED';

// nazwa: AI → tytuł; bez transkrypcji → generyczna z daty + numer (stały seq, fallback: pozycja w dniu)
const dayOrdinal = (list: Rec[], r: Rec) => list.filter((x) => x.date === r.date).findIndex((x) => x.id === r.id) + 1;
const displayName = (r: Rec, list: Rec[]) =>
  r.transcribed && r.title ? r.title : genericName(r.date, r.seq ?? dayOrdinal(list, r));

// Seeker (shuttle): wychylenie knoba kwantowane do biegów przewijania. Środek (level 0) = brak scrubu =
// normalne granie 1×. Dalej wg spec: 25%→2.5×, 50%→5×, 75%→7.5×, 100%→10× (krotność realtime).
const SCRUB_STEPS = [0, 2.5, 5, 7.5, 10]; // index = bieg (level)
const SCRUB_TICK_S = 0.1; // knob woła onScrub co ~100 ms
const quantizeScrub = (ratio: number) => {
  const level = Math.round(Math.min(1, Math.abs(ratio)) * 4); // 0..4
  return { level, speed: SCRUB_STEPS[level], dir: ratio < 0 ? -1 : 1 };
};

// rozmiar pliku: realny (sizeBytes) lub mock z długości (≈72 kbps → 12.6MB dla 23:11)
const MB_PER_SEC = 0.00906;
const fileSize = (r: Rec) => {
  const mb = r.sizeBytes != null ? r.sizeBytes / 1048576 : r.lengthSec * MB_PER_SEC;
  return `${(Math.round(mb * 10) / 10).toFixed(1)}MB`;
};

const fmt = (sec: number) => {
  const s = Math.floor(sec);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
};
const glow = (c: string) => ({ textShadowColor: c, textShadowRadius: 4, textShadowOffset: { width: 0, height: 0 } });

// waveform odtwarzania: stałe „nagrane" słupki; zagrana część jasna, reszta wygaszona
const WAVE_N = 48;
// mock (pliki demo bez nagranej obwiedni)
const WAVE_H = Array.from({ length: WAVE_N }, (_, i) => 0.18 + 0.82 * Math.abs(Math.sin(i * 1.1) * Math.sin(i * 0.41 + 0.6)));
// realna obwiednia z nagrania (samples) albo mock; zagrana część jasna, reszta wygaszona
function PlayWaveform({ ratio, dim, samples }: { ratio: number; dim?: boolean; samples?: number[] }) {
  const bars = samples && samples.length ? samples : WAVE_H;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', height: 53 }}>
      {bars.map((h, i) => {
        const played = !dim && i / bars.length <= ratio;
        return (
          <View key={i} style={{ width: 3, height: 4 + Math.max(0.06, h) * 44, borderRadius: 1.5, backgroundColor: played ? screen.olive.primary : screen.olive.inactive }} />
        );
      })}
    </View>
  );
}

// Transkrypt w playerze (Figma 161:12290): tekst Mono/Body; wypowiedziana część jasna (phosphor),
// reszta wygaszona — analogicznie do waveformu (zagrane = jasne). Auto-scroll podąża za odtwarzaniem.
function TranscriptView({ transcript, ratio, posSec }: { transcript: Transcript; ratio: number; posSec: number }) {
  const segs = transcript.segments;
  let played = '';
  let rest = '';
  if (segs && segs.length) {
    // segmenty z czasami: wypowiedziane = te, których start już minął
    const parts = segs.map((s) => s.text.trim());
    const cut = segs.findIndex((s) => (s.start ?? Infinity) > posSec);
    const k = cut === -1 ? segs.length : cut;
    played = parts.slice(0, k).join(' ');
    rest = (k > 0 && k < parts.length ? ' ' : '') + parts.slice(k).join(' ');
  } else {
    // brak czasów: podział proporcjonalny po znakach (ratio = pozycja/długość)
    const text = transcript.text ?? '';
    const at = Math.max(0, Math.min(text.length, Math.round(text.length * ratio)));
    played = text.slice(0, at);
    rest = text.slice(at);
  }
  const scrollRef = useRef<ScrollView>(null);
  const sizes = useRef({ content: 0, view: 0 });
  const pct = Math.round(ratio * 100); // przewijaj skokowo co ~1% (bez janku przy każdym ticku pozycji)
  useEffect(() => {
    const max = Math.max(0, sizes.current.content - sizes.current.view);
    scrollRef.current?.scrollTo({ y: max * (pct / 100), animated: true });
  }, [pct]);
  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, alignSelf: 'stretch' }}
      onLayout={(e) => { sizes.current.view = e.nativeEvent.layout.height; }}
      onContentSizeChange={(_w, h) => { sizes.current.content = h; }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={{ fontFamily: font.monoBody.family, fontSize: font.monoBody.size, lineHeight: Math.round(font.monoBody.size * 1.5) }}>
        <Text style={{ color: screen.olive.primary }}>{played}</Text>
        <Text style={{ color: screen.olive.inactive }}>{rest}</Text>
      </Text>
    </ScrollView>
  );
}

/** Chip „AI" przy nagraniu (c = kolor obrysu/tekstu). */
function AiBadge({ c }: { c: string }) {
  return (
    <View style={{ borderWidth: 1, borderColor: c, borderRadius: 3, paddingHorizontal: 4, height: 20, justifyContent: 'center' }}>
      <Text style={{ fontFamily: font.monoLabel.family, fontSize: 10, color: c }}>AI</Text>
    </View>
  );
}

/** Wiersz listy: [AI] nazwa … data. Zaznaczony = tło phosphor + ciemny tekst + glow. */
function Row({ rec, name, selected, onPress }: { rec: Rec; name: string; selected: boolean; onPress: () => void }) {
  const fg = selected ? color.dark21 : screen.olive.primary;
  const iconColor = selected
    ? rec.transcribed
      ? color.dark21
      : 'rgba(26,26,26,0.25)'
    : rec.transcribed
      ? screen.olive.primary
      : screen.olive.inactive;
  return (
    <Pressable onPress={onPress}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 4,
          paddingHorizontal: 6,
          borderRadius: 2,
          backgroundColor: selected ? screen.olive.primary : 'transparent',
          ...(selected ? { boxShadow: `0px 0px 4px 0px rgba(226,255,228,0.25)` } : null),
        } as any}
      >
        <AiBadge c={iconColor} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.monoBody.family, fontSize: font.monoBody.size, color: fg }}>
          {name}
        </Text>
        <Text style={{ fontFamily: font.monoBody.family, fontSize: font.monoBody.size, color: fg }}>{rec.date}</Text>
      </View>
    </Pressable>
  );
}

/** Wielki panel-nakładka nad listą: CONFIRM (czerwony) / DELETED (phosphor). */
function OverlayPanel({ tone, title, sub }: { tone: 'red' | 'phosphor'; title: string; sub?: string }) {
  const bg = tone === 'phosphor' ? screen.olive.primary : color.recordRed;
  const sh = tone === 'phosphor' ? 'rgba(226,255,228,0.25)' : 'rgba(255,76,76,0.25)';
  return (
    <View
      style={
        {
          position: 'absolute',
          top: 48,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: 4,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          gap: 8,
          boxShadow: `0px 0px 8px 0px ${sh}`,
        } as any
      }
    >
      <Text style={{ fontFamily: font.timer.family, fontSize: 24, lineHeight: 30, color: color.dark21, textAlign: 'center' }}>{title}</Text>
      {sub ? <Text style={{ fontFamily: font.monoBody.family, fontSize: 12, color: color.dark21, textAlign: 'center' }}>{sub}</Text> : null}
    </View>
  );
}

export function usePlaybackScreen({
  store,
  mono = false,
  mode = 'PLAYBACK',
  onCycleMode,
  onOpenSettings,
  onStartRecording,
  transcription,
  pendingPlayId,
  onConsumePending,
}: {
  store: RecordingsStore;
  mono?: boolean;
  mode?: Mode;
  onCycleMode?: () => void;
  onOpenSettings?: () => void;
  onStartRecording?: () => void;
  transcription?: TranscriptionStore;
  // żądanie z ekranu nagrywania: otwórz PLAYER dla tego nagrania i od razu graj (autostart)
  pendingPlayId?: string | null;
  onConsumePending?: () => void;
}) {
  const { recordings: recs, removeById, insertAt } = store;
  const [rawSel, setSelId] = useState<string>('');
  // selId zawsze ważne (po dodaniu/usunięciu nagrań fallback na pierwsze)
  const selId = recs.some((r) => r.id === rawSel) ? rawSel : recs[0]?.id ?? '';
  const [phase, setPhase] = useState<Phase>('LIST'); // nakładki delete (widok LIST)
  const [view, setView] = useState<View2>('LIST');
  const [playerState, setPlayerState] = useState<PlayerState>('STOPPED');
  const [pos, setPos] = useState(0); // sekundy w bieżącym nagraniu
  const [loadPct, setLoadPct] = useState(0);
  const [speed, setSpeed] = useState(1); // 1× / 2×
  const [transcript, setTranscript] = useState<Transcript | null>(null); // treść transkryptu w playerze
  const lastDeleted = useRef<{ rec: Rec; index: number; name: string } | null>(null);
  const timers = useRef<{ ret?: any }>({});
  // scrub realnego pliku: pauza na czas przewijania, lokalna pozycja, wznowienie po puszczeniu
  const scrubbing = useRef(false);
  const wasPlaying = useRef(false);
  const scrubPos = useRef(0);
  const scrubLevel = useRef(0); // ostatni bieg (haptyka „mocniej na wyższym biegu")
  const continuousOn = useRef(false); // trwa ciągła wibracja (granica / zatrzymane odtwarzanie)
  const reachedStart = useRef(false); // w tej sesji scrubu dobiliśmy do początku
  const reachedEnd = useRef(false); // …lub do końca

  const idx = Math.max(0, recs.findIndex((r) => r.id === selId));
  const sel: Rec | undefined = recs[idx];
  const len = sel?.lengthSec ?? 0;

  // realny odtwarzacz pliku (gdy nagranie ma uri); demo (bez uri) = mock niżej. Web → stub no-op.
  const { player, status: pstatus } = usePlayer();
  const realMode = view === 'PLAYER' && !!sel?.uri;
  // pod-widok czatu o notatce (hook zawsze zamontowany; aktywny dopiero w view==='CHAT')
  const chatView = useChatView({ rec: sel, active: view === 'CHAT', mode, mono, onBack: () => setView('PLAYER') });

  // ── PLAYER: ładowanie (tylko demo/mock; realny plik ma własny status) ──
  useEffect(() => {
    if (view !== 'PLAYER' || playerState !== 'LOADING' || sel?.uri) return;
    setLoadPct(0);
    const id = setInterval(() => {
      setLoadPct((p) => {
        const np = p + 7;
        if (np >= 100) {
          clearInterval(id);
          setPlayerState('PLAYING'); // po załadowaniu odtwarzanie startuje od razu
          return 100;
        }
        return np;
      });
    }, 120);
    return () => clearInterval(id);
  }, [view, playerState]);

  // ── PLAYER: odtwarzanie mock (pozycja rośnie ×speed; tylko demo bez uri) ──
  useEffect(() => {
    if (view !== 'PLAYER' || playerState !== 'PLAYING' || sel?.uri) return;
    const id = setInterval(() => {
      setPos((p) => {
        const np = p + speed;
        if (np >= len) {
          clearInterval(id);
          setPlayerState('STOPPED');
          return len;
        }
        return np;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [view, playerState, speed, len]);

  useEffect(
    () => () => {
      const t = timers.current;
      clearTimeout(t.ret);
    },
    []
  );

  // ── PLAYER: wczytaj transkrypt zaznaczonego nagrania (gdy transcribed) → wariant z tekstem ──
  useEffect(() => {
    let alive = true;
    if (view === 'PLAYER' && sel?.transcribed && sel?.id) {
      getTranscript(sel.id)
        .then((t) => {
          if (alive) setTranscript(t);
        })
        .catch(() => {});
    } else {
      setTranscript(null);
    }
    return () => {
      alive = false;
    };
  }, [view, sel?.id, sel?.transcribed]);

  // ── wybór na liście ──
  const selectRec = (id: string) => {
    setSelId(id);
    setPos(0);
  };
  const moveSel = (d: -1 | 1) => {
    const n = recs.length;
    if (!n) return;
    selectRec(recs[(idx + d + n) % n].id); // cyklicznie (ostatni → pierwszy)
  };

  // wczytaj realny plik i graj (auto-play po załadowaniu)
  const loadAndPlay = (r?: Rec) => {
    if (r?.uri) {
      try {
        player.replace({ uri: r.uri });
        player.play();
      } catch {}
    }
  };

  // ── nawigacja do/z odtwarzacza ──
  const openPlayer = () => {
    setView('PLAYER');
    setPos(0);
    setSpeed(1);
    if (sel?.uri) {
      setPlayerState('PLAYING');
      loadAndPlay(sel);
    } else {
      setPlayerState('LOADING');
    }
  };
  // otwórz PLAYER dla KONKRETNEGO nagrania (po id) + autostart — używane po zapisie z ekranu nagrywania
  const openPlayerById = (id: string) => {
    const r = recs.find((x) => x.id === id);
    setSelId(id);
    setPos(0);
    setSpeed(1);
    setView('PLAYER');
    if (r?.uri) {
      setPlayerState('PLAYING');
      loadAndPlay(r);
    } else {
      setPlayerState('LOADING');
    }
  };
  // po nagraniu: ekran nagrywania prosi (przez App) o przeniesienie do playera tego pliku
  useEffect(() => {
    if (!pendingPlayId) return;
    openPlayerById(pendingPlayId);
    onConsumePending?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPlayId]);
  const backToList = () => {
    if (sel?.uri) {
      try {
        player.pause();
      } catch {}
    }
    setView('LIST');
    setPlayerState('STOPPED');
    setPos(0);
  };

  // ── transport odtwarzacza ──
  const playerPlayPause = () => {
    if (sel?.uri) {
      try {
        pstatus.playing ? player.pause() : player.play();
      } catch {}
      return;
    }
    if (playerState === 'LOADING') return;
    setPlayerState((s) => (s === 'PLAYING' ? 'PAUSED' : 'PLAYING'));
  };
  const playerStop = () => {
    if (sel?.uri) {
      try {
        player.pause();
        player.seekTo(0);
      } catch {}
      return;
    }
    setPlayerState('STOPPED');
    setPos(0);
  };
  const toggleSpeed = () => {
    const next = speed === 1 ? 2 : 1;
    setSpeed(next);
    if (sel?.uri) {
      try {
        player.setPlaybackRate(next);
      } catch {}
    }
  };
  const playerSkip = (d: -1 | 1) => {
    const n = recs.length;
    if (!n) return;
    const target = recs[(idx + d + n) % n]; // cyklicznie

    setSelId(target.id);
    setPos(0);
    setSpeed(1);
    if (target.uri) {
      setPlayerState('PLAYING');
      loadAndPlay(target);
    } else {
      try {
        player.pause();
      } catch {}
      setPlayerState('LOADING');
    }
  };

  // zatrzymaj realne odtwarzanie (np. przy usuwaniu/wyjściu z odtwarzacza)
  const haltPlayer = () => {
    scrubbing.current = false;
    if (sel?.uri) {
      try {
        player.pause();
      } catch {}
    }
  };

  // ── delete (tap=prompt, hold=usuń od razu); z PLAYERa wraca na listę i pokazuje nakładkę ──
  const askDelete = () => {
    if (sel) {
      haltPlayer(); // zatrzymaj odtwarzanie usuwanego pliku
      setView('LIST');
      setPhase('CONFIRM');
    }
  };
  const cancelDelete = () => setPhase('LIST');
  const confirmDelete = () => {
    if (!sel) return;
    haltPlayer(); // zatrzymaj odtwarzanie usuwanego pliku
    const index = idx;
    const rec = sel;
    lastDeleted.current = { rec, index, name: displayName(rec, recs) }; // nazwa sprzed usunięcia (ordinal!)
    const next = recs.filter((r) => r.id !== rec.id);
    removeById(rec.id);
    if (next.length) setSelId(next[Math.min(index, next.length - 1)].id);
    setView('LIST');
    setPlayerState('STOPPED');
    setPos(0);
    setPhase('DELETED');
    armDeletedDismiss();
  };
  // okno auto-zamknięcia panelu DELETED (3 s). Reset, by zdążyć dokończyć hold UNDO.
  const armDeletedDismiss = () => {
    clearTimeout(timers.current.ret);
    timers.current.ret = setTimeout(() => setPhase('LIST'), 3000);
  };
  const undo = () => {
    const d = lastDeleted.current;
    clearTimeout(timers.current.ret);
    if (d) {
      insertAt(d.rec, d.index);
      setSelId(d.rec.id);
      lastDeleted.current = null;
    }
    setPhase('LIST');
  };

  // ── TRANS-CRIBE: realna transkrypcja przez manager (upload → backend). Wymaga pliku (uri). ──
  const transcribe = () => {
    if (!sel || sel.transcribed || !sel.uri) return; // demo bez pliku → nie ma czego transkrybować
    transcription?.start(sel);
  };

  // realny stan transkrypcji zaznaczonego nagrania (z managera)
  const tState = transcription?.stateOf(selId);
  const transcribePct = tState && (tState.status === 'uploading' || tState.status === 'processing') ? tState.pct ?? 0 : null;
  const ai: [string, string] | undefined =
    transcribePct != null
      ? ['AI TRANSCRIBING', `IN BACKGROUND (${transcribePct}%)`]
      : tState?.status === 'failed'
        ? ['AI TRANSCRIPTION', 'FAILED']
        : undefined;

  // systemowy back: zamknij prompt/panel → wyjdź z odtwarzacza → (false = App cofa do nagrywania)
  const goBack = (): boolean => {
    if (phase !== 'LIST') {
      clearTimeout(timers.current.ret);
      setPhase('LIST');
      return true;
    }
    if (view === 'CHAT') {
      setView('PLAYER');
      return true;
    }
    if (view === 'PLAYER') {
      backToList();
      return true;
    }
    return false;
  };

  // ════════════ WIDOK: CHAT ════════════
  if (view === 'CHAT') {
    return { content: chatView.content, keyboard: chatView.keyboard, goBack };
  }

  // ════════════ WIDOK: PLAYER ════════════
  if (view === 'PLAYER') {
    // realny plik → stan ze statusu odtwarzacza; demo → mock state
    // realny plik (lokalny) ładuje się błyskawicznie → bez ekranu „Loading" (migał przy wejściu
    // i przy przewijaniu); pokazujemy od razu odtwarzacz. „Loading" zostaje tylko dla demo (mock).
    const loading = realMode ? false : playerState === 'LOADING';
    const playing = realMode ? pstatus.playing : playerState === 'PLAYING';
    const started = realMode ? pstatus.playing || pstatus.currentTime > 0 : playerState === 'PLAYING' || playerState === 'PAUSED';
    const uiPos = realMode ? pstatus.currentTime : pos;
    const uiLen = realMode ? pstatus.duration || sel?.lengthSec || 0 : len;
    const deleteKey = { label: 'DELETE', supporting: '[HOLD]', variant: 'risk' as const, onPress: askDelete, onHoldComplete: confirmDelete, holdMs: 2000 };
    const recordKey = { type: 'record' as const, onPress: onStartRecording };

    let keyboard: KeyboardConfig;
    if (loading) {
      keyboard = {
        screen: [{ label: '' }, { label: 'ABORT', onPress: backToList }, { label: '' }],
        metal: [{ type: 'label', upper: 'STOP', active: false }, recordKey, { type: 'label', upper: 'PLAY', lower: 'PAUSE', active: false }],
      };
    } else {
      keyboard = {
        screen: [
          deleteKey,
          sel?.transcribed && sel?.uri
            ? { label: 'ASK\nAI', variant: 'primary' as const, onPress: () => { haltPlayer(); setView('CHAT'); } }
            : sel?.uri && !sel?.transcribed
              ? { label: 'TRANS-\nCRIBE', onPress: transcribe }
              : { label: '' },
          // gra → toggle prędkości (label = co zrobi klik: przy 1× „2X SPEED", przy 2× „1X SPEED"); inaczej → RECORDINGS
          playing ? { label: speed === 1 ? '2X\nSPEED' : '1X\nSPEED', onPress: toggleSpeed } : { label: 'RECORD-\nINGS', onPress: backToList },
        ],
        metal: [
          { type: 'label', upper: 'STOP', active: started, onPress: started ? playerStop : undefined },
          recordKey,
          { type: 'label', upper: 'PLAY', lower: 'PAUSE', active: !playing, lowerActive: playing, onPress: playerPlayPause },
        ],
      };
    }

    // Seeker shuttle: knob woła onScrub(ratio -1..1) co ~100 ms. Kwantujemy do biegu prędkości,
    // przesuwamy playhead (przód=prawo / tył=lewo), pauzujemy audio na czas przewijania.
    const total = uiLen;
    const onScrub = (ratio: number) => {
      const { level, speed, dir } = quantizeScrub(ratio);
      // start sesji scrubu: zapamiętaj stan, zatrzymaj realne odtwarzanie
      if (!scrubbing.current) {
        scrubbing.current = true;
        reachedStart.current = false;
        reachedEnd.current = false;
        scrubLevel.current = 0;
        if (realMode) {
          wasPlaying.current = pstatus.playing;
          scrubPos.current = pstatus.currentTime;
          try {
            player.pause();
          } catch {}
        } else {
          wasPlaying.current = playerState === 'PLAYING';
          scrubPos.current = pos;
        }
      }
      // przesuwaj playhead tylko poza martwą strefą środka (level ≥ 1); level 0 = trzymanie pozycji (1×)
      if (level >= 1 && total > 0) {
        let np = scrubPos.current + dir * speed * SCRUB_TICK_S;
        np = Math.max(0, Math.min(total, np));
        scrubPos.current = np;
        if (np <= 0) reachedStart.current = true;
        if (np >= total) reachedEnd.current = true;
        if (realMode) {
          try {
            player.seekTo(np);
          } catch {}
        } else {
          setPos(np);
        }
      }
      // ── haptyka ──
      const atBoundary = total > 0 && (scrubPos.current <= 0 || scrubPos.current >= total);
      // ciągła wibracja: na granicy nagrania ORAZ gdy odtwarzanie było zatrzymane/zpauzowane
      const wantContinuous = atBoundary || !wasPlaying.current;
      if (wantContinuous) {
        if (!continuousOn.current) {
          hapticContinuous(true);
          continuousOn.current = true;
        }
      } else {
        if (continuousOn.current) {
          hapticContinuous(false);
          continuousOn.current = false;
        }
        // mocniejszy impuls na każdym wyższym biegu (level/4 = 0.25…1.0)
        if (level > scrubLevel.current && level >= 1) hapticKnob(level / 4);
      }
      scrubLevel.current = level;
    };
    const onScrubEnd = () => {
      if (!scrubbing.current) return;
      scrubbing.current = false;
      if (continuousOn.current) {
        hapticContinuous(false);
        continuousOn.current = false;
      }
      if (reachedStart.current) {
        // przewinięto na początek → po puszczeniu START odtwarzania
        if (realMode) {
          try {
            player.seekTo(0);
            player.play();
          } catch {}
        } else {
          setPos(0);
          setPlayerState('PLAYING');
        }
      } else if (reachedEnd.current) {
        // przewinięto na koniec → wróć na początek, ale NIE odtwarzaj
        if (realMode) {
          try {
            player.seekTo(0);
            player.pause();
          } catch {}
        } else {
          setPos(0);
          setPlayerState('PAUSED');
        }
      } else {
        // zwykłe puszczenie w środku → wznów to co było, z bieżącej pozycji
        if (realMode) {
          try {
            player.seekTo(scrubPos.current);
            if (wasPlaying.current) player.play();
          } catch {}
        } else {
          setPos(scrubPos.current);
          setPlayerState(wasPlaying.current ? 'PLAYING' : 'PAUSED');
        }
      }
    };
    const slider: SliderConfig | undefined = loading
      ? undefined
      : { highlighted: true, onPrev: () => playerSkip(-1), onNext: () => playerSkip(1), onScrub, onScrubEnd };

    // dolny wiersz info: nazwa pliku + zaokrąglony rozmiar (lewo)
    const nameSize = sel ? `${displayName(sel, recs)} (${fileSize(sel)})` : '';
    const capStyle = { fontFamily: font.caption.family, fontSize: font.caption.size, color: screen.olive.secondary } as const;
    // nagranie transkrybowane → zamiast waveformu pokaż tekst transkryptu (Figma 161:12290)
    const showTranscript = !loading && !!sel?.transcribed && !!transcript?.text;
    // nagłówek AI: w trakcie/po błędzie z managera (ai), inaczej dla transkrybowanego „AI TRANSCRIBED WITH DEAPI"
    const playerAi: [string, string] | undefined = ai ?? (sel?.transcribed ? ['AI TRANSCRIBED', 'WITH DEAPI'] : undefined);

    const content = (
      <>
        <ScreenTopBar mode={mode} onCycleMode={undefined} ai={playerAi} labelActive={playing} />
        <View style={{ flex: 1, alignSelf: 'stretch', justifyContent: showTranscript ? 'flex-start' : 'center', gap: 24, paddingHorizontal: 16, paddingTop: showTranscript ? 8 : 0 }}>
          {showTranscript ? (
            <TranscriptView transcript={transcript!} ratio={uiLen > 0 ? uiPos / uiLen : 0} posSec={uiPos} />
          ) : (
            <PlayWaveform ratio={uiLen > 0 ? uiPos / uiLen : 0} dim={loading} samples={sel?.samples} />
          )}
          <View style={{ alignSelf: 'stretch', gap: 8 }}>
            {loading ? (
              <>
                <View style={{ alignSelf: 'stretch', alignItems: 'center' }}>
                  <Text style={{ fontFamily: font.timer.family, fontSize: 24, color: screen.olive.primary, ...glow('rgba(226,255,228,0.25)') }}>Loading...</Text>
                  <View style={{ alignSelf: 'stretch', height: 2, borderRadius: 2, backgroundColor: screen.olive.primary, boxShadow: '0px 0px 4px 0px rgba(226,255,228,0.25)' } as any} />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={capStyle}>{nameSize}</Text>
                  <Text style={capStyle}>{realMode ? '' : `${loadPct}%`}</Text>
                </View>
              </>
            ) : (
              <>
                <View style={{ alignSelf: 'stretch' }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                    <Text style={{ fontFamily: font.timer.family, fontSize: 24, color: screen.olive.primary, ...glow('rgba(226,255,228,0.25)') }}>{fmt(uiPos)}</Text>
                    <Text style={{ fontFamily: font.timer.family, fontSize: 20, color: screen.olive.inactive }}>{fmt(uiLen)}</Text>
                  </View>
                  <View style={{ alignSelf: 'stretch', height: 2, borderRadius: 2, backgroundColor: screen.olive.primary, boxShadow: '0px 0px 4px 0px rgba(226,255,228,0.25)', marginTop: 8 } as any} />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={capStyle}>{nameSize}</Text>
                  <Text style={capStyle}>~311h/32.3GB AVAILABLE</Text>
                </View>
              </>
            )}
          </View>
        </View>
        <BottomBar active={playing} mono={mono} muted={false} level={sel?.samples && uiLen > 0 ? sel.samples[Math.min(sel.samples.length - 1, Math.floor((uiPos / uiLen) * sel.samples.length))] : null} />
      </>
    );
    return { content, keyboard, slider, goBack };
  }

  // ════════════ WIDOK: LIST — pusto ════════════
  // brak nagrań → prosty komunikat „No recordings." (DELETE/PLAY nieaktywne, tylko SETTINGS)
  if (recs.length === 0) {
    const keyboard: KeyboardConfig = {
      screen: [{ label: '' }, { label: 'SETTINGS', onPress: onOpenSettings }, { label: '' }],
      metal: [
        { type: 'label', upper: 'STOP', active: false },
        { type: 'record', onPress: onStartRecording },
        { type: 'label', upper: 'PLAY', lower: 'PAUSE', active: false },
      ],
    };
    const content = (
      <>
        <ScreenTopBar mode={mode} onCycleMode={onCycleMode} ai={undefined} labelActive={false} />
        <View style={{ flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: font.timer.family, fontSize: 22, color: screen.olive.inactive }}>No recordings.</Text>
        </View>
        <BottomBar active={false} mono={mono} muted={false} />
      </>
    );
    return { content, keyboard };
  }

  // ════════════ WIDOK: LIST ════════════
  const overlay = phase !== 'LIST';
  let keyboard: KeyboardConfig;
  if (phase === 'CONFIRM') {
    keyboard = {
      screen: [
        { label: 'YES', supporting: '[HOLD]', variant: 'highRisk', onHoldComplete: confirmDelete, holdMs: 2000 },
        { label: '' },
        { label: 'CANCEL', onPress: cancelDelete },
      ],
      metal: [{ type: 'label', upper: 'STOP', active: false }, { type: 'record', onPress: onStartRecording }, { type: 'label', upper: 'PLAY', lower: 'PAUSE', active: false }],
    };
  } else if (phase === 'DELETED') {
    keyboard = {
      screen: [{ label: '' }, { label: 'UNDO', supporting: '[HOLD]', variant: 'primary', onHoldStart: armDeletedDismiss, onHoldComplete: undo, holdMs: 2000 }, { label: '' }],
      metal: [{ type: 'label', upper: 'STOP', active: false }, { type: 'record', onPress: onStartRecording }, { type: 'label', upper: 'PLAY', lower: 'PAUSE', active: false }],
    };
  } else {
    keyboard = {
      screen: [
        { label: 'DELETE', supporting: '[HOLD]', variant: 'risk', onPress: askDelete, onHoldComplete: confirmDelete, holdMs: 2000 },
        { label: 'SETTINGS', onPress: onOpenSettings },
        sel && !sel.transcribed && sel.uri ? { label: 'TRANS-\nCRIBE', onPress: transcribe } : { label: '' },
      ],
      metal: [
        { type: 'label', upper: 'STOP', active: false },
        { type: 'record', onPress: onStartRecording },
        // PLAY otwiera dedykowany odtwarzacz dla zaznaczonego nagrania
        { type: 'label', upper: 'PLAY', lower: 'PAUSE', active: true, onPress: sel ? openPlayer : undefined },
      ],
    };
  }

  const slider: SliderConfig | undefined =
    phase === 'LIST' ? { highlighted: true, onPrev: () => moveSel(-1), onNext: () => moveSel(1) } : undefined;

  const content = (
    <>
      <ScreenTopBar mode={mode} onCycleMode={overlay ? undefined : onCycleMode} ai={ai} labelActive={false} />
      <View style={{ flex: 1, alignSelf: 'stretch', paddingHorizontal: 16, paddingTop: 8 }}>
        <View style={{ gap: 8, opacity: overlay ? 0.35 : 1 }}>
          {recs.map((r) => (
            <Row key={r.id} rec={r} name={displayName(r, recs)} selected={r.id === selId} onPress={() => selectRec(r.id)} />
          ))}
        </View>
        {phase === 'CONFIRM' && sel ? <OverlayPanel tone="red" title={`DELETE “${displayName(sel, recs)}”?`} sub={`RECORDED ON ${sel.date}`} /> : null}
        {phase === 'DELETED' && lastDeleted.current ? <OverlayPanel tone="phosphor" title={`“${lastDeleted.current.name}” DELETED`} /> : null}
      </View>
      {/* stopka listy: długość zaznaczonego (pozycja 0 — odtwarzanie jest na osobnym ekranie) */}
      <View style={{ alignSelf: 'stretch', paddingHorizontal: 16, gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontFamily: font.monoHeading.family, fontSize: font.monoHeading.size, color: screen.olive.primary, ...glow('rgba(226,255,228,0.25)') }}>{fmt(0)}</Text>
          <Text style={{ fontFamily: font.monoHeading.family, fontSize: font.monoHeading.size, color: screen.olive.inactive }}>{fmt(len)}</Text>
        </View>
        <View style={{ alignSelf: 'stretch', height: 2, borderRadius: 2, backgroundColor: screen.olive.primary, boxShadow: '0px 0px 4px 0px rgba(226,255,228,0.25)' } as any} />
      </View>
      <BottomBar active={false} mono={mono} muted={false} />
    </>
  );

  return { content, keyboard, slider };
}
