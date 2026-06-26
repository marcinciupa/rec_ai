/**
 * ChatView — czat o notatce (pod-widok PLAYBACK). Wiadomości w stylu fosforu, 3 gotowe pytania
 * (SUMMARY / KEY POINTS / TASKS) na rzędzie "screen" oraz pytanie GŁOSEM na klawiszu ASK/VOICE
 * (klawisz ⏺ jest globalnie przejęty na „nowe nagranie", więc głos jest na metalu po prawej).
 *
 * Głos: tap ASK/VOICE → nagrywaj → STOP → transkrypcja pytania (api.transcribe) → wyślij do /chat.
 * Wymaga notatki z transkryptem (wejście tylko dla transcribed+uri) — patrz PlaybackScreen.
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { color, font, screen } from '../theme/tokens';
import type { KeyboardConfig } from '../components/chrome/Keyboard';
import { ScreenTopBar, BottomBar, Mode } from './ScreenChrome';
import type { Rec } from '../hooks/useRecordings';
import { useChat, ChatTurn } from '../hooks/useChat';
import { useAudioCapture } from '../hooks/useAudioCapture';
import * as api from '../lib/api';
import { deleteRecordingFile } from '../lib/recordingFiles';

const PRESETS: { label: string; q: string }[] = [
  { label: 'SUM-\nMARY', q: 'Streść tę notatkę w kilku zdaniach.' },
  { label: 'KEY\nPOINTS', q: 'Wypisz najważniejsze punkty tej notatki w formie krótkiej listy.' },
  { label: 'TASKS', q: 'Wypisz konkretne zadania (action items) wynikające z tej notatki.' },
];

const glow = (c: string) => ({ textShadowColor: c, textShadowRadius: 4, textShadowOffset: { width: 0, height: 0 } });
const PHOSPHOR_GLOW = glow('rgba(226,255,228,0.25)');

type Voice = 'idle' | 'listening' | 'transcribing';

/** Dymek wiadomości: asystent = fosfor po lewej; użytkownik = pastylka fosforowa po prawej (ciemny tekst). */
function Bubble({ turn }: { turn: ChatTurn }) {
  const isUser = turn.role === 'user';
  return (
    <View style={{ flexDirection: 'row', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <View
        style={
          {
            maxWidth: '88%',
            borderRadius: 4,
            paddingHorizontal: 8,
            paddingVertical: 4,
            backgroundColor: isUser ? screen.olive.primary : 'transparent',
            borderWidth: isUser ? 0 : 1,
            borderColor: screen.olive.inactive,
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
          {turn.content}
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
  onBack,
}: {
  rec?: Rec;
  active: boolean;
  mode?: Mode;
  mono?: boolean;
  onBack?: () => void;
}) {
  const chat = useChat(active ? rec?.id : undefined);
  const capture = useAudioCapture();
  const [voice, setVoice] = useState<Voice>('idle');
  const scrollRef = useRef<ScrollView>(null);

  // auto-scroll na dół przy nowej wiadomości / zmianie stanu
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
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
      const res = await api.transcribe({ uri: captured.uri, recordingId: `q_${Date.now()}` });
      const q = (res.transcript || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
      setVoice('idle');
      if (q) chat.ask(q);
    } catch {
      setVoice('idle');
    } finally {
      deleteRecordingFile(captured.uri).catch(() => {}); // pytanie jest jednorazowe — nie trzymamy pliku
    }
  };

  // etykieta AI (deAPI) w pasku — odzwierciedla bieżący stan czatu
  const ai: [string, string] =
    voice === 'listening'
      ? ['AI CHAT', 'LISTENING…']
      : voice === 'transcribing'
        ? ['AI CHAT', 'READING QUESTION…']
        : chat.phase === 'thinking'
          ? ['AI CHAT', 'THINKING…']
          : chat.phase === 'error'
            ? ['AI CHAT', 'ERROR']
            : ['AI CHAT', 'ASK ABOUT THIS NOTE'];

  const askKey = { type: 'label' as const, upper: 'ASK', lower: 'VOICE' };
  let keyboard: KeyboardConfig;
  if (voice === 'listening') {
    keyboard = {
      screen: [{ label: 'ABORT', supporting: '[TAP]', variant: 'risk', onPress: abortVoice }, { label: '' }, { label: '' }],
      metal: [{ type: 'label', upper: 'STOP', active: true, onPress: stopAndSend }, { type: 'record' }, { ...askKey, active: false }],
    };
  } else if (busy) {
    keyboard = {
      screen: [{ label: '' }, { label: '' }, { label: '' }],
      metal: [{ type: 'label', upper: 'BACK', active: true, onPress: onBack }, { type: 'record' }, { ...askKey, active: false }],
    };
  } else {
    keyboard = {
      screen: PRESETS.map((p, i) => ({ label: p.label, variant: i === 0 ? ('primary' as const) : undefined, onPress: () => chat.ask(p.q) })),
      metal: [{ type: 'label', upper: 'BACK', active: true, onPress: onBack }, { type: 'record' }, { ...askKey, active: true, onPress: startVoice }],
    };
  }

  const empty = chat.messages.length === 0 && !busy && voice === 'idle';
  const content = (
    <>
      <ScreenTopBar mode={mode} onCycleMode={undefined} ai={ai} labelActive={busy || voice === 'listening'} />
      <View style={{ flex: 1, alignSelf: 'stretch', paddingHorizontal: 16, paddingTop: 8 }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: font.caption.family, fontSize: font.caption.size, color: screen.olive.secondary, marginBottom: 8 }}
        >
          {`CHAT — ${rec?.title ?? 'NOTE'}`}
        </Text>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1, alignSelf: 'stretch' }}
          contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
        >
          {empty ? (
            <Text
              style={{
                fontFamily: font.caption.family,
                fontSize: font.caption.size,
                color: screen.olive.inactive,
                textAlign: 'center',
                marginTop: 24,
              }}
            >
              ASK ABOUT THIS NOTE — TAP A PRESET, OR “ASK / VOICE”.
            </Text>
          ) : null}
          {chat.messages.map((m, i) => (
            <Bubble key={i} turn={m} />
          ))}
          {voice === 'listening' ? <StatusLine text="LISTENING… TAP STOP" tone="red" /> : null}
          {voice === 'transcribing' ? <StatusLine text="READING QUESTION…" tone="phosphor" /> : null}
          {chat.phase === 'thinking' ? <StatusLine text="THINKING…" tone="phosphor" /> : null}
          {chat.phase === 'error' ? <StatusLine text={`ERROR: ${chat.error ?? 'try again'}`} tone="red" /> : null}
        </ScrollView>
      </View>
      <BottomBar active={voice === 'listening'} mono={mono} muted={false} level={voice === 'listening' ? capture.level : null} />
    </>
  );

  return { content, keyboard };
}
