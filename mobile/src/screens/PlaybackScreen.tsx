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
import { shareRecording } from '../lib/share';
import type { Transcript } from '../lib/types';
import { color, font, screen } from '../theme/tokens';
import type { KeyboardConfig, ScreenKeyDef } from '../components/chrome/Keyboard';
import type { SliderConfig } from '../components/chrome/SeekSlider';
import { ScreenTopBar, BottomBar, Mode, stopBackKey } from './ScreenChrome';
import type { Rec, RecordingsStore } from '../hooks/useRecordings';
import { genericName } from '../hooks/useRecordings';
import { deriveAiStatus, type TranscriptionStore } from '../hooks/useTranscription';
import { useChatView } from './ChatView';

type Phase = 'LIST' | 'CONFIRM' | 'DELETED' | 'DETAILS';
type View2 = 'LIST' | 'PLAYER' | 'CHAT';
type PlayerState = 'LOADING' | 'STOPPED' | 'PLAYING' | 'PAUSED';

// nazwa: AI → tytuł; bez transkrypcji → generyczna z daty + numer (stały seq, fallback: pozycja w dniu)
const dayOrdinal = (list: Rec[], r: Rec) => list.filter((x) => x.date === r.date).findIndex((x) => x.id === r.id) + 1;
const displayName = (r: Rec, list: Rec[]) =>
  r.transcribed && r.title ? r.title : genericName(r.date, r.seq ?? dayOrdinal(list, r));

// Seeker = PRZEWIJANIE (nie tempo audio): wychylenie ustawia prędkość przesuwania playheada
// przez nagranie (audio milknie na czas przewijania). Środek (level 0) = brak przewijania = normalne
// granie 1×. Dalej wg spec: 25%→2.5×, 50%→5×, 75%→7.5×, 100%→10× (krotność realtime, przód/tył).
const SCRUB_STEPS = [0, 2.5, 5, 7.5, 10]; // index = bieg (level) prędkości przewijania
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

// Prędkość odtwarzania: biegi i odpowiadające im wypełnienie pierścienia na klawiszu SPEED.
const SPEED_LEVELS = [1, 1.5, 2, 3];
const speedFill = (s: number) => Math.max(0, SPEED_LEVELS.indexOf(s)) * 0.25; // 1×=0, 1.5×=.25, 2×=.5, 3×=.75
// timestamp segmentu transkryptu w formacie M:SS (Figma „0:00", „0:12")
const fmtShort = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

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

// Pojedynczy segment transkryptu w playerze (Figma 288:3568): kolumna timestampów [start/koniec]
// + tekst Mono/Body. Tekst (karaoke) wg pozycji: odtworzony = jasny; bieżący = wypowiedziana część
// jasna, reszta przyciemniona; nadchodzący = cały przyciemniony. Timestampy NIEZALEŻNIE od karaoke:
// cała para rozjaśnia się z chwilą rozpoczęcia sekcji (posSec ≥ startN); bieżąca sekcja = glow (kursor).
// Tap w kolumnę timestampów → seek do startu sekcji + odtwarzanie (onSeek).
function TranscriptRow({ startN, endN, endLabel, text, posSec, onSeek }: { startN: number; endN: number; endLabel: string; text: string; posSec: number; onSeek?: (sec: number) => void }) {
  const bright = screen.olive.primary;
  const dim = screen.olive.secondary;
  const played = posSec >= endN; // segment w całości za nami
  const current = posSec >= startN && posSec < endN;
  const cap = { fontFamily: font.monoCaption.family, fontSize: font.monoCaption.size } as const;
  const body = { fontFamily: font.monoBody.family, fontSize: font.monoBody.size, lineHeight: Math.round(font.monoBody.size * 1.5) } as const;
  // podział tekstu bieżącego segmentu po znakach proporcjonalnie do upływu czasu w jego obrębie
  let bodyNode: ReactNode;
  if (played) {
    bodyNode = <Text style={{ color: bright }}>{text}</Text>;
  } else if (current && isFinite(endN) && endN > startN) {
    const frac = Math.max(0, Math.min(1, (posSec - startN) / (endN - startN)));
    const cut = Math.round(text.length * frac);
    bodyNode = (
      <>
        <Text style={{ color: bright }}>{text.slice(0, cut)}</Text>
        <Text style={{ color: dim }}>{text.slice(cut)}</Text>
      </>
    );
  } else if (current) {
    bodyNode = <Text style={{ color: bright }}>{text}</Text>; // bieżący bez czasu końca → cały jasny
  } else {
    bodyNode = <Text style={{ color: dim }}>{text}</Text>;
  }
  // timestampy niezależnie od tekstu: cała para jasna gdy sekcja się zaczęła; bieżąca = glow
  const started = posSec >= startN;
  return (
    <View style={{ flexDirection: 'row', alignSelf: 'stretch', gap: 8 }}>
      <Pressable onPress={() => onSeek?.(startN)} hitSlop={6} style={{ justifyContent: 'center' }}>
        <Text style={{ ...cap, color: started ? bright : dim, ...(current ? glow('rgba(226,255,228,0.25)') : null) }}>{fmtShort(startN)}</Text>
        <Text style={{ ...cap, color: started ? bright : dim, marginTop: -2 }}>{endLabel}</Text>
      </Pressable>
      <Text style={{ ...body, flex: 1 }}>{bodyNode}</Text>
    </View>
  );
}

// Transkrypt w playerze (Figma 288:3568): lista segmentów z timestampami (karaoke). Bieżący segment
// jasny z podziałem wypowiedziano/reszta, kolejne przyciemnione; auto-scroll trzyma bieżący w widoku.
// Bez czasów segmentów → fallback: jeden blok z podziałem proporcjonalnym (jak dotąd).
function TranscriptView({ transcript, ratio, posSec, onSeek }: { transcript: Transcript; ratio: number; posSec: number; onSeek?: (sec: number) => void }) {
  const segs = transcript.segments;
  const scrollRef = useRef<ScrollView>(null);
  const sizes = useRef({ content: 0, view: 0 });
  const hasSegs = !!(segs && segs.length);

  // granice czasowe segmentów (koniec = własny end → start następnego → ∞ dla ostatniego)
  const rows = hasSegs
    ? segs!.map((s, i) => {
        const startN = s.start ?? 0;
        const nextStart = segs![i + 1]?.start ?? null;
        const endN = s.end ?? nextStart ?? Infinity;
        return { startN, endN, endLabel: s.end != null || nextStart != null ? fmtShort(s.end ?? nextStart!) : '', text: s.text.trim() };
      })
    : [];
  // indeks bieżącego segmentu (do auto-scrolla); poza zakresem → pierwszy/ostatni
  let curIdx = rows.findIndex((r) => posSec >= r.startN && posSec < r.endN);
  if (curIdx < 0) curIdx = posSec <= 0 ? 0 : rows.length - 1;

  const pct = hasSegs ? curIdx : Math.round(ratio * 100); // segmenty: scroll na zmianie segmentu; fallback: co ~1%
  useEffect(() => {
    const max = Math.max(0, sizes.current.content - sizes.current.view);
    const frac = hasSegs ? (rows.length > 1 ? curIdx / (rows.length - 1) : 0) : ratio;
    scrollRef.current?.scrollTo({ y: max * frac, animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct]);

  // fallback bez czasów: jeden blok, podział proporcjonalny po znakach
  const text = transcript.text ?? '';
  const at = Math.max(0, Math.min(text.length, Math.round(text.length * ratio)));

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, alignSelf: 'stretch' }}
      contentContainerStyle={hasSegs ? { gap: 4 } : undefined}
      onLayout={(e) => { sizes.current.view = e.nativeEvent.layout.height; }}
      onContentSizeChange={(_w, h) => { sizes.current.content = h; }}
      showsVerticalScrollIndicator={false}
    >
      {hasSegs ? (
        rows.map((r, i) => <TranscriptRow key={i} startN={r.startN} endN={r.endN} endLabel={r.endLabel} text={r.text} posSec={posSec} onSeek={onSeek} />)
      ) : (
        <Text style={{ fontFamily: font.monoBody.family, fontSize: font.monoBody.size, lineHeight: Math.round(font.monoBody.size * 1.5) }}>
          <Text style={{ color: screen.olive.primary }}>{text.slice(0, at)}</Text>
          <Text style={{ color: screen.olive.inactive }}>{text.slice(at)}</Text>
        </Text>
      )}
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

/** Opcja menu inline pod nazwą nagrania (Figma 161:12289 / 288:3942): aktywna = ciemna pigułka #212121
 *  z kropką + tekst z glow; nieaktywna = ciemny tekst #212121 na zielonym (zaznaczonym) wierszu.
 *  `risk` (DELETE) → tylko w stanie aktywnym czerwień #FF4C4C z poświatą zamiast phosphoru;
 *  nieaktywne pozostaje ciemne (#212121) jak reszta opcji. */
type RowActionDef = {
  label: string;
  run: () => void;
  risk?: boolean; // DELETE — czerwony styl w inline-menu + High Risk na klawiszu akcji
  keyLabel?: string; // etykieta na klawiszu akcji, gdy różna od label (DETAILS → SHOW DETAILS)
  supporting?: string; // dolny label klawisza akcji (DELETE → [HOLD])
  onHoldComplete?: () => void; // hold na klawiszu akcji (DELETE → confirmDelete)
  holdMs?: number;
};
const PHOSPHOR_TEXT_GLOW = { textShadowColor: 'rgba(226,255,228,0.25)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 0 } as const };
const RED_TEXT_GLOW = { textShadowColor: 'rgba(255,76,76,0.5)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 0 } as const };
function RowOption({ label, active, risk, onPress }: { label: string; active: boolean; risk?: boolean; onPress: () => void }) {
  const txt = { fontFamily: font.monoBody.family, fontSize: font.monoBody.size } as const;
  const activeColor = risk ? color.recordRed : screen.olive.primary;
  const activeGlow = risk ? RED_TEXT_GLOW : PHOSPHOR_TEXT_GLOW;
  return (
    <Pressable onPress={onPress} hitSlop={6}>
      {({ pressed }) =>
        active ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 2, paddingRight: 4, paddingVertical: 2, borderRadius: 3, backgroundColor: color.dark21, opacity: pressed ? 0.6 : 1 }}>
            <Text style={{ ...txt, color: activeColor, ...activeGlow }}>•</Text>
            <Text style={{ ...txt, color: activeColor, ...activeGlow }}>{label}</Text>
          </View>
        ) : (
          <Text style={{ ...txt, color: color.dark21, opacity: pressed ? 0.6 : 1 }}>{label}</Text>
        )
      }
    </Pressable>
  );
}

/**
 * Wiersz listy: [AI] nazwa … data. Zaznaczony = tło phosphor + ciemny tekst + glow, i rozwija POD nazwą
 * rząd opcji menu (Figma 161:12289) — aktywną przełącza knob lub klawisz MENU [CYCLE], tap wykonuje. Na web hover zaznacza.
 */
function Row({ rec, name, selected, onSelect, options, focus }: { rec: Rec; name: string; selected: boolean; onSelect: () => void; options: RowActionDef[]; focus: number }) {
  const fg = selected ? color.dark21 : screen.olive.primary;
  const iconColor = selected
    ? rec.transcribed
      ? color.dark21
      : 'rgba(26,26,26,0.25)'
    : rec.transcribed
      ? screen.olive.primary
      : screen.olive.inactive;
  return (
    <View
      style={{
        borderRadius: 2,
        padding: 4,
        gap: 8,
        backgroundColor: selected ? screen.olive.primary : 'transparent',
        ...(selected ? { boxShadow: `0px 0px 4px 0px rgba(226,255,228,0.25)` } : null),
      } as any}
    >
      <Pressable onPress={onSelect} onHoverIn={onSelect}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <AiBadge c={iconColor} />
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.monoBody.family, fontSize: font.monoBody.size, color: fg }}>
            {name}
          </Text>
          <Text style={{ fontFamily: font.monoBody.family, fontSize: font.monoBody.size, color: fg }}>{rec.date}</Text>
        </View>
      </Pressable>
      {selected && options.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch' }}>
          {options.map((o, i) => (
            <RowOption key={o.label} label={o.label} active={i === focus} risk={o.risk} onPress={o.run} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Nakładka DETAILS: info o nagraniu na zielonym ekranie (klucz→wartość). */
function DetailsPanel({ rows }: { rows: [string, string][] }) {
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
          backgroundColor: screen.olive.primary,
          padding: 24,
          gap: 12,
          justifyContent: 'center',
          boxShadow: `0px 0px 8px 0px rgba(226,255,228,0.25)`,
        } as any
      }
    >
      {rows.map(([k, v]) => (
        <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <Text style={{ fontFamily: font.monoLabel.family, fontSize: font.monoLabel.size, color: 'rgba(26,26,26,0.6)' }}>{k}</Text>
          <Text numberOfLines={1} style={{ flex: 1, textAlign: 'right', fontFamily: font.monoBody.family, fontSize: font.monoBody.size, color: color.dark21 }}>{v}</Text>
        </View>
      ))}
    </View>
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
  language = 'en',
  onTyping,
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
  language?: string;
  onTyping?: (on: boolean) => void; // czat wszedł/wyszedł z trybu pisania (klawiatura systemowa)
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
  const [phase, setPhase] = useState<Phase>('LIST'); // nakładki delete/details (widok LIST)
  const [menuFocus, setMenuFocus] = useState(0); // aktywna opcja menu inline (klawisz MENU [CYCLE])
  const [view, setView] = useState<View2>('LIST');
  const [playerState, setPlayerState] = useState<PlayerState>('STOPPED');
  const [pos, setPos] = useState(0); // sekundy w bieżącym nagraniu
  const [loadPct, setLoadPct] = useState(0);
  const [speed, setSpeed] = useState(1); // 1× / 2×
  const [transcript, setTranscript] = useState<Transcript | null>(null); // treść transkryptu w playerze
  const [scrubDisplay, setScrubDisplay] = useState<number | null>(null); // pozycja w trakcie przewijania (płynny waveform; null = czytaj z odtwarzacza)
  const lastDeleted = useRef<{ rec: Rec; index: number; name: string } | null>(null);
  const timers = useRef<{ ret?: any }>({});
  // scrub realnego pliku: pauza na czas przewijania, lokalna pozycja, wznowienie po puszczeniu
  const scrubbing = useRef(false);
  const wasPlaying = useRef(false);
  const scrubPos = useRef(0);
  const scrubStartPos = useRef(0); // pozycja na starcie przewijania (czy zaczęliśmy na 0)
  const scrubLevel = useRef(0); // ostatni bieg (haptyka „mocniej na wyższym biegu")
  const continuousOn = useRef(false); // trwa ciągła wibracja (granica / zatrzymane odtwarzanie)

  const idx = Math.max(0, recs.findIndex((r) => r.id === selId));
  const sel: Rec | undefined = recs[idx];
  const len = sel?.lengthSec ?? 0;

  // realny odtwarzacz pliku (gdy nagranie ma uri); demo (bez uri) = mock niżej. Web → stub no-op.
  const { player, status: pstatus } = usePlayer();
  const realMode = view === 'PLAYER' && !!sel?.uri;
  // pod-widok czatu o notatce (hook zawsze zamontowany; aktywny dopiero w view==='CHAT')
  const chatView = useChatView({ rec: sel, active: view === 'CHAT', mode, mono, language, nameLabel: sel ? `${displayName(sel, recs)} (${fileSize(sel)})` : '', onTypingChange: onTyping, onBack: () => setView('PLAYER') });

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
    setMenuFocus(0); // nowy wybór → reset aktywnej opcji menu na pierwszą
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
    setPhase('LIST'); // zamknij ewentualne menu/panel przed wejściem w odtwarzacz
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
  // Prędkość ODTWARZANIA (nie przewijania): cykl 1× → 1.5× → 2× → 3× → 1×, z pierścieniem
  // wypełnienia na klawiszu (0 / 25 / 50 / 75%). Klawisz pokazuje bieżącą prędkość.
  const cycleSpeed = () => {
    const i = SPEED_LEVELS.indexOf(speed);
    const next = SPEED_LEVELS[(i + 1) % SPEED_LEVELS.length];
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

  // statusbar AI zaznaczonego nagrania (wspólny deriver): job (UPLOADING/PROCESSING/DONE)
  // → trwały TRANSCRIBED/NO SPEECH → IDLE. FAILED i czerwień świadomie pominięte (deriveAiStatus).
  const ai = deriveAiStatus({
    tState: transcription?.stateOf(selId),
    transcribed: sel?.transcribed,
    noSpeech: sel?.title === '(NO SPEECH)',
  });

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
    return { content: chatView.content, keyboard: chatView.keyboard, slider: chatView.slider, goBack };
  }

  // ════════════ WIDOK: PLAYER ════════════
  if (view === 'PLAYER') {
    // realny plik → stan ze statusu odtwarzacza; demo → mock state
    // realny plik (lokalny) ładuje się błyskawicznie → bez ekranu „Loading" (migał przy wejściu
    // i przy przewijaniu); pokazujemy od razu odtwarzacz. „Loading" zostaje tylko dla demo (mock).
    const loading = realMode ? false : playerState === 'LOADING';
    const playing = realMode ? pstatus.playing : playerState === 'PLAYING';
    const started = realMode ? pstatus.playing || pstatus.currentTime > 0 : playerState === 'PLAYING' || playerState === 'PAUSED';
    // w trakcie przewijania pokazuj lokalną pozycję scrubu (płynnie), inaczej realną z odtwarzacza
    const uiPos = scrubDisplay != null ? scrubDisplay : realMode ? pstatus.currentTime : pos;
    const uiLen = realMode ? pstatus.duration || sel?.lengthSec || 0 : len;
    // segmenty transkryptu → prev/next nawiguje po timestampach (zamiast skoku między nagraniami)
    const segList = transcript?.segments ?? [];
    const hasSegNav = !!sel?.transcribed && segList.length > 0;
    const deleteKey = { label: 'DELETE', supporting: '[HOLD]', variant: 'risk' as const, onPress: askDelete, onHoldComplete: confirmDelete, holdMs: 2000 };
    const recordKey = { type: 'record' as const, onPress: onStartRecording };

    let keyboard: KeyboardConfig;
    if (loading) {
      keyboard = {
        screen: [{ label: '' }, { label: '' }, { label: '' }],
        metal: [stopBackKey({ canStop: false, onBack: backToList }), recordKey, { type: 'label', upper: 'PLAY', lower: 'PAUSE', active: false }],
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
          // gra → prędkość odtwarzania z pierścieniem biegu (1×/1.5×/2×/3×); pauza/stop → wolny slot (BACK jest na metalu)
          playing ? { label: `${speed}X\nSPEED`, onPress: cycleSpeed, progress: speedFill(speed) } : { label: '' },
        ],
        metal: [
          // gra/pauza → STOP (stop+seek0); zatrzymany → BACK (do listy)
          stopBackKey({ canStop: started, onStop: playerStop, onBack: backToList }),
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
        scrubStartPos.current = scrubPos.current; // zapamiętaj punkt startu (czy zaczęliśmy na 0)
      }
      // przesuwaj playhead tylko poza martwą strefą środka (level ≥ 1); level 0 = trzymanie pozycji (1×)
      if (level >= 1 && total > 0) {
        let np = scrubPos.current + dir * speed * SCRUB_TICK_S;
        np = Math.max(0, Math.min(total, np));
        scrubPos.current = np;
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
      setScrubDisplay(scrubPos.current); // waveform płynnie podąża za przewijaniem
    };
    const onScrubEnd = () => {
      if (!scrubbing.current) return;
      scrubbing.current = false;
      if (continuousOn.current) {
        hapticContinuous(false);
        continuousOn.current = false;
      }
      setScrubDisplay(null); // wróć do pozycji ze statusu odtwarzacza
      // decyzja po puszczeniu — rozstrzyga PUNKT STARTU przewijania (nie czy grało):
      //  • koniec → reset na 0, nie graj
      //  • zaczęliśmy na 0 i nadal jesteśmy na 0 (ruch w lewo z początku, donikąd) → zostań na 0, nie graj
      //  • z każdego innego punktu (też dojazd do 0 z dalszego miejsca) → graj od pozycji przewinięcia
      const atStart = scrubPos.current <= 0;
      const atEnd = total > 0 && scrubPos.current >= total;
      const startedAtZero = scrubStartPos.current <= 0;
      if (atEnd || (atStart && startedAtZero)) {
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
        if (realMode) {
          try {
            player.seekTo(scrubPos.current);
            player.play();
          } catch {}
        } else {
          setPos(scrubPos.current);
          setPlayerState('PLAYING');
        }
      }
    };
    // skok do sekundy: realny odtwarzacz seekTo, demo = setPos; opcjonalnie od razu graj (tap timestampa)
    const seekToSec = (sec: number, play = true) => {
      const t = uiLen > 0 ? Math.max(0, Math.min(uiLen, sec)) : Math.max(0, sec);
      setScrubDisplay(null);
      if (realMode) {
        try { player.seekTo(t); if (play) player.play(); } catch {}
      } else {
        setPos(t);
        if (play) setPlayerState('PLAYING');
      }
    };
    // prev/next między timestampami: bieżący segment = ostatni start ≤ pozycja.
    // next → początek następnego; prev → restart bieżącego (gdy >2 s w środku) lub poprzedni.
    const gotoSegment = (dir: -1 | 1) => {
      const starts = segList.map((s) => s.start ?? 0);
      if (!starts.length) return;
      let ci = 0;
      for (let i = 0; i < starts.length; i++) if (uiPos >= starts[i] - 0.05) ci = i;
      const target = dir === 1
        ? starts[Math.min(starts.length - 1, ci + 1)]
        : uiPos - starts[ci] > 2 ? starts[ci] : starts[Math.max(0, ci - 1)];
      seekToSec(target, true);
    };
    const slider: SliderConfig | undefined = loading
      ? undefined
      : {
          highlighted: true,
          onPrev: hasSegNav ? () => gotoSegment(-1) : () => playerSkip(-1),
          onNext: hasSegNav ? () => gotoSegment(1) : () => playerSkip(1),
          onScrub,
          onScrubEnd,
        };

    // dolny wiersz info: nazwa pliku + zaokrąglony rozmiar (lewo)
    const nameSize = sel ? `${displayName(sel, recs)} (${fileSize(sel)})` : '';
    const capStyle = { fontFamily: font.caption.family, fontSize: font.caption.size, color: screen.olive.secondary } as const;
    // nagranie transkrybowane → zamiast waveformu pokaż tekst transkryptu (Figma 161:12290)
    const showTranscript = !loading && !!sel?.transcribed && !!transcript?.text;
    const content = (
      <>
        <ScreenTopBar mode={mode} onCycleMode={undefined} ai={ai} labelActive={playing} />
        <View style={{ flex: 1, alignSelf: 'stretch', justifyContent: showTranscript ? 'flex-start' : 'center', gap: 24, paddingHorizontal: 16, paddingTop: showTranscript ? 8 : 0 }}>
          {showTranscript ? (
            <TranscriptView transcript={transcript!} ratio={uiLen > 0 ? uiPos / uiLen : 0} posSec={uiPos} onSeek={(s) => seekToSec(s, true)} />
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
        stopBackKey({ canStop: false, onBack: onStartRecording }),
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
  // opcje menu inline ZAZNACZONEGO nagrania (DELETE jest osobnym klawiszem). Slot 1 = akcja AI wg stanu.
  const menuOptions: RowActionDef[] = sel
    ? [
        ...(sel.uri && !sel.transcribed ? [{ label: 'TRANSCRIBE', run: transcribe }] : []),
        ...(sel.uri && sel.transcribed ? [{ label: 'ASK AI', run: () => { haltPlayer(); setView('CHAT'); } }] : []),
        ...(sel.uri ? [{ label: 'SHARE', run: () => { shareRecording(sel.uri, displayName(sel, recs)); } }] : []),
        { label: 'DETAILS', run: () => setPhase('DETAILS'), keyLabel: 'SHOW DETAILS' },
        // DELETE (Figma 288:3942): czerwona opcja inline + klawisz High Risk z pełną mechaniką:
        // tap → nakładka CONFIRM (YES[HOLD]/CANCEL), [HOLD] → usuń od razu (→ DELETED z UNDO).
        { label: 'DELETE', run: askDelete, risk: true, supporting: '[HOLD]', onHoldComplete: confirmDelete, holdMs: 2000 },
      ]
    : [];
  const menuLen = menuOptions.length;
  const mFocus = menuLen ? menuFocus % menuLen : 0; // zawsze w zakresie (opcje zależą od stanu nagrania)
  const cycleMenu = (dir: 1 | -1 = 1) => { if (menuLen) setMenuFocus((mFocus + dir + menuLen) % menuLen); };
  // pierwszy klawisz „odbija" aktywną opcję inline: label (DETAILS → SHOW DETAILS), wariant (DELETE → High Risk),
  // oraz hold (DELETE → confirmDelete). tap = wykonaj opcję.
  const focusedOpt = menuOptions[mFocus];
  const actionKey: ScreenKeyDef = focusedOpt
    ? {
        label: focusedOpt.keyLabel ?? focusedOpt.label,
        supporting: focusedOpt.supporting,
        variant: focusedOpt.risk ? 'highRisk' : 'primary',
        onPress: focusedOpt.run,
        onHoldComplete: focusedOpt.onHoldComplete,
        holdMs: focusedOpt.holdMs,
      }
    : { label: 'ACCEPT', variant: 'primary' };

  let keyboard: KeyboardConfig;
  // metal[0] = stały fizyczny STOP/BACK (label niezmienny); na liście STOP zgaszony, BACK świeci (powrót/zamknięcie).
  const recordKeyList = { type: 'record' as const, onPress: onStartRecording };
  const playKeyOff = { type: 'label' as const, upper: 'PLAY', lower: 'PAUSE', active: false };
  if (phase === 'CONFIRM') {
    keyboard = {
      screen: [
        { label: 'YES', supporting: '[HOLD]', variant: 'highRisk', onHoldComplete: confirmDelete, holdMs: 2000 },
        { label: '' },
        { label: 'CANCEL', onPress: cancelDelete },
      ],
      metal: [stopBackKey({ canStop: false, onBack: cancelDelete }), recordKeyList, playKeyOff],
    };
  } else if (phase === 'DELETED') {
    keyboard = {
      screen: [{ label: '' }, { label: 'UNDO', supporting: '[HOLD]', variant: 'primary', onHoldStart: armDeletedDismiss, onHoldComplete: undo, holdMs: 2000 }, { label: '' }],
      metal: [stopBackKey({ canStop: false, onBack: () => setPhase('LIST') }), recordKeyList, playKeyOff],
    };
  } else if (phase === 'DETAILS') {
    keyboard = {
      screen: [{ label: '' }, { label: '' }, { label: '' }],
      metal: [stopBackKey({ canStop: false, onBack: () => setPhase('LIST') }), recordKeyList, playKeyOff],
    };
  } else {
    keyboard = {
      // klawisz akcji = aktywna opcja inline (ASK AI / SHARE / SHOW DETAILS / DELETE[HOLD]) · SETTINGS · MENU[CYCLE].
      // DELETE niesie pełną mechanikę potwierdzania (tap→CONFIRM, hold→usuń) bezpośrednio na klawiszu akcji.
      screen: [
        actionKey,
        { label: 'SETTINGS', onPress: onOpenSettings },
        { label: 'MENU', supporting: '[CYCLE]', onPress: () => cycleMenu(1) },
      ],
      metal: [
        // nic nie gra → BACK świeci (do ekranu nagrywania)
        stopBackKey({ canStop: false, onBack: onStartRecording }),
        recordKeyList,
        // PLAY otwiera dedykowany odtwarzacz dla zaznaczonego nagrania
        { type: 'label', upper: 'PLAY', lower: 'PAUSE', active: true, onPress: sel ? openPlayer : undefined },
      ],
    };
  }

  // Slider jak w Settings: przyciski prev/next przechodzą między nagraniami, knob (discrete) cyklą opcje menu.
  const slider: SliderConfig | undefined =
    phase === 'LIST'
      ? { highlighted: true, discrete: true, onPrev: () => moveSel(-1), onNext: () => moveSel(1), onAdjust: (dir) => cycleMenu(dir) }
      : undefined;

  const content = (
    <>
      <ScreenTopBar mode={mode} onCycleMode={overlay ? undefined : onCycleMode} ai={ai} labelActive={false} />
      <View style={{ flex: 1, alignSelf: 'stretch', paddingHorizontal: 16, paddingTop: 8 }}>
        <View style={{ gap: 8, opacity: overlay ? 0.35 : 1 }}>
          {recs.map((r) => (
            <Row
              key={r.id}
              rec={r}
              name={displayName(r, recs)}
              selected={r.id === selId}
              onSelect={() => selectRec(r.id)}
              options={r.id === selId ? menuOptions : []}
              focus={mFocus}
            />
          ))}
        </View>
        {phase === 'DETAILS' && sel ? (
          <DetailsPanel
            rows={[
              ['NAME', displayName(sel, recs)],
              ['DATE', sel.date],
              ['LENGTH', fmt(sel.lengthSec)],
              ['SIZE', fileSize(sel)],
              ['AI', sel.transcribed ? 'TRANSCRIBED' : 'NOT TRANSCRIBED'],
            ]}
          />
        ) : null}
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
