/**
 * useChat — czat o pojedynczej notatce (backend /api/v1/chat → OpenRouter).
 * Ładuje transkrypt + historię wiadomości z SQLite, wysyła pytania z kontekstem transkryptu,
 * trwale zapisuje każdą wiadomość. Fazy: idle | thinking | error.
 * `recordingId === undefined` (np. czat zamknięty) → hook bezczynny.
 */
import { useEffect, useRef, useState } from 'react';
import * as api from '../lib/api';
import * as db from '../lib/db';

export type ChatTurn = { role: 'user' | 'assistant'; content: string };
export type ChatPhase = 'idle' | 'thinking' | 'error';

export function useChat(recordingId: string | undefined) {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [phase, setPhase] = useState<ChatPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const transcriptRef = useRef<string>('');
  const phaseRef = useRef<ChatPhase>('idle');
  phaseRef.current = phase;
  const recRef = useRef<string | undefined>(recordingId);
  recRef.current = recordingId;

  // wczytaj transkrypt + historię przy zmianie notatki (lub wyzeruj, gdy zamknięto czat)
  useEffect(() => {
    let alive = true;
    setMessages([]);
    setPhase('idle');
    setError(null);
    transcriptRef.current = '';
    if (!recordingId) return;
    (async () => {
      try {
        const t = await db.getTranscript(recordingId);
        if (alive && t?.text) transcriptRef.current = t.text;
        const msgs = await db.getMessages(recordingId);
        if (alive) setMessages(msgs.map((m) => ({ role: m.role, content: m.content })));
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, [recordingId]);

  const ask = async (questionRaw: string) => {
    const question = (questionRaw || '').trim();
    const id = recRef.current;
    if (!question || !id || phaseRef.current === 'thinking') return;
    if (!transcriptRef.current) {
      setError('Brak transkryptu tej notatki.');
      setPhase('error');
      return;
    }
    const history = messages.slice();
    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setPhase('thinking');
    setError(null);
    db.addMessage({ recordingId: id, role: 'user', content: question, createdAt: Date.now() }).catch(() => {});
    try {
      const res = await api.chat({ transcript: transcriptRef.current, question, messages: history });
      if (recRef.current !== id) return; // przełączono notatkę w trakcie — porzuć odpowiedź
      setMessages((prev) => [...prev, { role: 'assistant', content: res.answer }]);
      setPhase('idle');
      db.addMessage({ recordingId: id, role: 'assistant', content: res.answer, createdAt: Date.now() }).catch(() => {});
    } catch (e: any) {
      if (recRef.current !== id) return;
      setError(String(e?.message ?? e));
      setPhase('error');
    }
  };

  const hasTranscript = () => !!transcriptRef.current;

  return { messages, phase, error, ask, hasTranscript };
}
