/**
 * ChatView — czat o notatce (pod-widok PLAYBACK). Wiadomości w stylu fosforu. Rząd "screen" (Figma 289:6298):
 * KEYBOARD (systemowa klawiatura) · SUMMARY · KEY POINTS. Pytanie GŁOSEM na fizycznym ⏺ (RECORD).
 *
 * Pisanie: KEYBOARD → tryb `typing`: pole TextInput + systemowa klawiatura; App chowa dolną obudowę
 * (slider/klawiatura/mic) i wchodzi w fullscreen (ekran do górnej krawędzi klawiatury). ENTER/SEND wysyła,
 * blur kończy pisanie i wraca do poprzedniego widoku. Głos: tap ⏺ → STOP → api.transcribe → /chat.
 * Wymaga notatki z transkryptem (wejście tylko dla transcribed+uri) — patrz PlaybackScreen.
 */
import { ReactNode, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TextInput, Keyboard, PanResponder } from 'react-native';
import { color, font, screen } from '../theme/tokens';
import type { KeyboardConfig } from '../components/chrome/Keyboard';
import type { SliderConfig } from '../components/chrome/SeekSlider';
import { ScreenTopBar, BottomBar, Mode, stopBackKey } from './ScreenChrome';
import type { Rec } from '../hooks/useRecordings';
import { useChat, ChatTurn } from '../hooks/useChat';
import type { AiStatusView } from '../hooks/useTranscription';
import { useAudioCapture } from '../hooks/useAudioCapture';
import * as api from '../lib/api';
import { deleteRecordingFile } from '../lib/recordingFiles';

// Presety pytań per język (label klawisza stały; treść pytania w wybranym języku).
const PRESETS_BY_LANG: Record<string, { label: string; q: string }[]> = {
  en: [
    { label: 'SUM-\nMARY', q: 'Summarize this note in a few sentences.' },
    { label: 'KEY\nPOINTS', q: 'List the most important points of this note as a short bullet list.' },
    { label: 'TASKS', q: 'List the concrete action items from this note.' },
  ],
  pl: [
    { label: 'SUM-\nMARY', q: 'Streść tę notatkę w kilku zdaniach.' },
    { label: 'KEY\nPOINTS', q: 'Wypisz najważniejsze punkty tej notatki w formie krótkiej listy.' },
    { label: 'TASKS', q: 'Wypisz konkretne zadania (action items) wynikające z tej notatki.' },
  ],
};

// Wiadomość powitalna (pierwszy „dymek" asystenta, gdy brak historii) — Figma 289:6298. „•REC" (glif kropki,
// jak w projekcie) renderowane czerwienią; reszta phosphor. Tekst rozbity wokół „•REC" na pre/post, per język.
const REC_TOKEN = '•REC';
const WELCOME_BY_LANG: Record<string, { pre: string; post: string }> = {
  en: { pre: 'Hi! Ask me about this note — pick an option above, tap KEYBOARD to type, or press ', post: ' to ask with your voice.' },
  pl: { pre: 'Cześć! Zapytaj o tę notatkę — wybierz opcję powyżej, użyj KEYBOARD, by pisać, albo wciśnij ', post: ', by zapytać głosem.' },
};

const glow = (c: string) => ({ textShadowColor: c, textShadowRadius: 4, textShadowOffset: { width: 0, height: 0 } });
const PHOSPHOR_GLOW = glow('rgba(226,255,228,0.25)');

type Voice = 'idle' | 'listening' | 'transcribing';

/** Dymek wiadomości: użytkownik = pastylka fosforowa po LEWEJ (ciemny tekst); odpowiedź AI = fosfor po PRAWEJ. */
function Bubble({ turn, rich }: { turn: ChatTurn; rich?: ReactNode }) {
  const isUser = turn.role === 'user';
  return (
    <View style={{ flexDirection: 'row', justifyContent: isUser ? 'flex-start' : 'flex-end' }}>
      <View
        style={
          {
            maxWidth: '88%',
            borderRadius: 4,
            paddingHorizontal: 8,
            paddingVertical: 4,
            backgroundColor: isUser ? screen.olive.primary : 'transparent',
            ...(isUser ? { boxShadow: '0px 0px 4px 0px rgba(226,255,228,0.25)' } : null),
          } as any
        }
      >
        <Text
          style={{
            fontFamily: font.monoBody.family,
            fontSize: font.monoBody.size,
            color: isUser ? color.dark21 : screen.olive.primary,
            ...(isUser ? null : PHOSPHOR_GLOW),
          }}
        >
          {rich ?? turn.content}
        </Text>
      </View>
    </View>
  );
}

function StatusLine({ text, tone }: { text: string; tone: 'red' | 'phosphor' }) {
  const c = tone === 'red' ? color.recordRed : screen.olive.primary;
  return (
    <Text
      style={{
        fontFamily: font.caption.family,
        fontSize: font.caption.size,
        color: c,
        textAlign: 'center',
        ...(tone === 'phosphor' ? PHOSPHOR_GLOW : null),
      }}
    >
      {text}
    </Text>
  );
}

export function useChatView({
  rec,
  active,
  mode = 'PLAYBACK',
  mono = false,
  language = 'en',
  nameLabel = '',
  onTypingChange,
  onBack,
}: {
  rec?: Rec;
  active: boolean;
  mode?: Mode;
  mono?: boolean;
  language?: string;
  nameLabel?: string; // „nazwa (rozmiar)" wyświetlana pod chatem (Figma 289:6298)
  onTypingChange?: (on: boolean) => void; // wejście/wyjście trybu pisania (klawiatura systemowa → fullscreen)
  onBack?: () => void;
}) {
  const chat = useChat(active ? rec?.id : undefined, language);
  const PRESETS = PRESETS_BY_LANG[language] ?? PRESETS_BY_LANG.en;
  const welcome = WELCOME_BY_LANG[language] ?? WELCOME_BY_LANG.en;
  const capture = useAudioCapture();
  const [voice, setVoice] = useState<Voice>('idle');
  const [pairIdx, setPairIdx] = useState(0); // przeglądana para pytanie→odpowiedź (prev/next + swipe)
  const scrollRef = useRef<ScrollView>(null);
  // tryb pisania: pole tekstowe + systemowa klawiatura; App chowa dolną obudowę i wchodzi w fullscreen
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<TextInput>(null);
  useEffect(() => { onTypingChange?.(typing); }, [typing, onTypingChange]);
  // wyjście z czatu (lub start nagrywania głosem) → opuść tryb pisania
  useEffect(() => { if ((!active || voice !== 'idle') && typing) setTyping(false); }, [active, voice, typing]);
  // schowanie systemowej klawiatury (Android adjustNothing nie woła onBlur) → wyjście z trybu pisania,
  // żeby dolna obudowa wróciła do normalnego układu (slider + klawiatura + mik).
  useEffect(() => {
    if (!typing) return;
    const sub = Keyboard.addListener('keyboardDidHide', () => { setTyping(false); inputRef.current?.blur(); });
    return () => sub.remove();
  }, [typing]);
  const openKeyboard = () => { setTyping(true); inputRef.current?.focus(); };
  const sendDraft = () => {
    const q = draft.trim();
    if (!q) return;
    chat.ask(q);
    setDraft('');
  };

  // pokazujemy tylko ostatnią parę: ostatnie pytanie usera (góra) + odpowiedź na nie (pod spodem) →
  // scroll na górę, żeby pytanie było widoczne przy nowej wiadomości / zmianie stanu
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 50);
    return () => clearTimeout(t);
  }, [chat.messages.length, chat.phase, voice]);

  // wyjście z czatu w trakcie nagrywania pytania → porzuć nagranie
  useEffect(() => {
    if (!active && voice !== 'idle') {
      capture.discard();
      setVoice('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const busy = voice === 'transcribing' || chat.phase === 'thinking';

  const startVoice = async () => {
    if (voice !== 'idle' || busy) return;
    const ok = await capture.start();
    if (ok) setVoice('listening');
  };
  const abortVoice = async () => {
    await capture.discard();
    setVoice('idle');
  };
  const stopAndSend = async () => {
    if (voice !== 'listening') return;
    setVoice('transcribing');
    const captured = await capture.stop();
    if (!captured?.uri) {
      setVoice('idle');
      return;
    }
    try {
      const res = await api.transcribe({ uri: captured.uri, recordingId: `q_${Date.now()}`, language });
      const q = (res.transcript || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
      setVoice('idle');
      if (q) chat.ask(q);
    } catch {
      setVoice('idle');
    } finally {
      deleteRecordingFile(captured.uri).catch(() => {}); // pytanie jest jednorazowe — nie trzymamy pliku
    }
  };

  // etykieta AI (deAPI) w pasku — odzwierciedla bieżący stan czatu (zawsze phosphor; aktywne stany pulsują)
  const ai: AiStatusView =
    voice === 'listening'
      ? { tone: 'phosphor', pulse: true, lines: ['AI CHAT', 'LISTENING…'] }
      : voice === 'transcribing'
        ? { tone: 'phosphor', pulse: true, lines: ['AI CHAT', 'READING QUESTION…'] }
        : chat.phase === 'thinking'
          ? { tone: 'phosphor', pulse: true, lines: ['AI CHAT', 'THINKING…'] }
          : chat.phase === 'error'
            ? { tone: 'phosphor', pulse: false, lines: ['AI CHAT', 'ERROR'] }
            : { tone: 'phosphor', pulse: false, lines: ['AI CHAT', 'ASK ABOUT THIS NOTE'] };

  // metal stały: STOP/BACK · ⏺ (RECORD = nagraj pytanie głosem) · PLAY/PAUSE (wygaszony — brak odtwarzania w czacie).
  // ⏺ ma własny onPress (startVoice), więc App NIE nadpisze go na „nowe nagranie". startVoice sam się pilnuje (idle-only).
  const recordAsk = { type: 'record' as const, onPress: startVoice };
  const playPauseOff = { type: 'label' as const, upper: 'PLAY', lower: 'PAUSE', active: false };
  let keyboard: KeyboardConfig;
  if (voice === 'listening') {
    keyboard = {
      screen: [{ label: 'ABORT', supporting: '[TAP]', variant: 'risk', onPress: abortVoice }, { label: '' }, { label: '' }],
      // nagrywa pytanie → STOP świeci (stop+wyślij); inaczej BACK (do playera)
      metal: [stopBackKey({ canStop: true, onStop: stopAndSend, onBack }), recordAsk, playPauseOff],
    };
  } else if (busy) {
    keyboard = {
      screen: [{ label: '' }, { label: '' }, { label: '' }],
      metal: [stopBackKey({ canStop: false, onBack }), recordAsk, playPauseOff],
    };
  } else {
    // KEYBOARD (otwiera systemową klawiaturę) + 2 presety (SUMMARY / KEY POINTS) — Figma 289:6298.
    keyboard = {
      screen: [
        { label: 'KEY-\nBOARD', variant: 'primary' as const, onPress: openKeyboard },
        ...PRESETS.slice(0, 2).map((p) => ({ label: p.label, onPress: () => chat.ask(p.q) })),
      ],
      metal: [stopBackKey({ canStop: false, onBack }), recordAsk, playPauseOff],
    };
  }

  // pary pytanie→odpowiedź; przeglądane prev/next (slider) albo swipem konwersacji. Domyślnie najnowsza.
  const msgs = chat.messages;
  const pairs: { user: ChatTurn; answer: ChatTurn | null }[] = [];
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role === 'user') {
      pairs.push({ user: msgs[i], answer: msgs[i + 1]?.role === 'assistant' ? msgs[i + 1] : null });
    }
  }
  const pairsLen = pairs.length;
  const idx = pairsLen ? Math.min(pairIdx, pairsLen - 1) : 0;
  const cur = pairsLen ? pairs[idx] : null;
  // nowa para (zadane pytanie / wczytana historia z DB) → skok na najnowszą
  useEffect(() => { setPairIdx(Math.max(0, pairsLen - 1)); }, [pairsLen]);
  // zmiana pary → przewiń do góry, by pytanie było widoczne
  useEffect(() => { const t = setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 30); return () => clearTimeout(t); }, [idx]);
  const idxRef = useRef(0); idxRef.current = idx;
  const pairsLenRef = useRef(0); pairsLenRef.current = pairsLen;
  const goPair = (d: -1 | 1) => { const len = pairsLenRef.current; if (!len) return; setPairIdx(Math.min(len - 1, Math.max(0, idxRef.current + d))); };
  const goPairRef = useRef(goPair); goPairRef.current = goPair;
  // swipe całej konwersacji: poziomy gest → poprzednia/następna para (pionowy zostaje dla scrolla długich treści)
  const swipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderRelease: (_e, g) => {
        if (g.dx <= -40) goPairRef.current(1); // w lewo → nowsza para
        else if (g.dx >= 40) goPairRef.current(-1); // w prawo → starsza para
      },
    })
  ).current;
  // slider prev/next przegląda pary (gdy jest >1); knob (discrete) tak samo
  const slider: SliderConfig | undefined =
    pairsLen > 1 ? { highlighted: true, discrete: true, onPrev: () => goPair(-1), onNext: () => goPair(1), onAdjust: (dir) => goPair(dir) } : undefined;

  const content = (
    <>
      <ScreenTopBar mode={mode} onCycleMode={undefined} ai={ai} labelActive={busy || voice === 'listening'} />
      <View style={{ flex: 1, alignSelf: 'stretch', paddingHorizontal: 16, paddingTop: 8 }}>
        {/* konwersacja: swipe poziomy przełącza pary (jak prev/next), pionowy scroll dla długich treści */}
        <View style={{ flex: 1, alignSelf: 'stretch' }} {...swipe.panHandlers}>
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1, alignSelf: 'stretch' }}
            contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
          >
            {/* brak historii → wiadomość powitalna (Figma 289:6298); „•REC" czerwienią (jak w projekcie) */}
            {pairsLen === 0 ? (
              <Bubble
                turn={{ role: 'assistant', content: `${welcome.pre}${REC_TOKEN}${welcome.post}` }}
                rich={<>{welcome.pre}<Text style={{ color: color.recordRed }}>{REC_TOKEN}</Text>{welcome.post}</>}
              />
            ) : null}
            {/* bieżąca para: pytanie usera (góra) + odpowiedź na nie (pod spodem) */}
            {cur ? <Bubble turn={cur.user} /> : null}
            {cur?.answer ? <Bubble turn={cur.answer} /> : null}
            {voice === 'listening' ? <StatusLine text="LISTENING… TAP STOP" tone="red" /> : null}
            {voice === 'transcribing' ? <StatusLine text="READING QUESTION…" tone="phosphor" /> : null}
            {chat.phase === 'thinking' ? <StatusLine text="THINKING…" tone="phosphor" /> : null}
            {chat.phase === 'error' ? <StatusLine text={`ERROR: ${chat.error ?? 'try again'}`} tone="red" /> : null}
          </ScrollView>
        </View>
        {/* wskaźnik pary (gdy jest >1) — strzałki sugerują prev/next i swipe */}
        {pairsLen > 1 ? (
          <Text style={{ textAlign: 'center', fontFamily: font.caption.family, fontSize: font.caption.size, color: screen.olive.secondary, paddingTop: 4 }}>
            {`‹  ${idx + 1} / ${pairsLen}  ›`}
          </Text>
        ) : null}
        {/* pole tekstowe (Figma 289:5603): jasna pigułka phosphor + ciemny mono; systemowa klawiatura.
            Widoczne tylko w trybie pisania; ENTER/SEND wysyła i czyści, blur kończy pisanie. */}
        {typing ? (
          <View style={{ alignSelf: 'stretch', backgroundColor: screen.olive.primary, borderRadius: 2, padding: 4, marginTop: 8, boxShadow: '0px 0px 4px 0px rgba(226,255,228,0.25)' } as any}>
            <TextInput
              ref={inputRef}
              autoFocus
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={sendDraft}
              onBlur={() => setTyping(false)}
              blurOnSubmit={false}
              placeholder="Start typing..."
              placeholderTextColor={color.dark21}
              returnKeyType="send"
              style={{ fontFamily: font.monoBody.family, fontSize: font.monoBody.size, color: color.dark21, padding: 0 } as any}
            />
          </View>
        ) : null}
        {/* nazwa pliku (+rozmiar) i storage POD chatem (Figma 289:6298) — wyśrodkowane, przyciemnione */}
        {/* nazwa (+rozmiar) i wolne miejsce w JEDNEJ linii (Figma 289:6298) — nazwa lewo, storage prawo */}
        <View style={{ alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingVertical: 8 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: font.caption.family, fontSize: font.caption.size, color: screen.olive.secondary }}>{nameLabel}</Text>
          <Text numberOfLines={1} style={{ fontFamily: font.caption.family, fontSize: font.caption.size, color: screen.olive.secondary }}>~311h/32.3GB AVAILABLE</Text>
        </View>
      </View>
      <BottomBar active={voice === 'listening'} mono={mono} muted={false} level={voice === 'listening' ? capture.level : null} />
    </>
  );

  return { content, keyboard, slider };
}
