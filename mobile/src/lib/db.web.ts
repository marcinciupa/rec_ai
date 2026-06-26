/**
 * Trwałość na web — AsyncStorage (zamiast SQLite; web służy do podglądu/QA UI).
 * Ten sam interfejs co db.ts. Kolejność listy z sortOrder (malejąco), jak natywnie.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Rec, Transcript, ChatMessage } from './types';

const K_REC = 'recai.db.recordings';
const K_TRANSCRIPTS = 'recai.db.transcripts';
const K_MESSAGES = 'recai.db.messages';

async function readArr<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const a = JSON.parse(raw);
      if (Array.isArray(a)) return a as T[];
    }
  } catch {}
  return [];
}

async function writeArr<T>(key: string, arr: T[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(arr));
  } catch {}
}

// ── Recordings ──
// brak seedu — apka startuje z pustą listą (widok „No recordings.")
export async function initDb(): Promise<void> {}

export async function loadRecordings(): Promise<Rec[]> {
  const arr = await readArr<Rec>(K_REC);
  return arr.slice().sort((a, b) => (b.sortOrder ?? 0) - (a.sortOrder ?? 0));
}

export async function upsertRecording(rec: Rec): Promise<void> {
  const arr = await readArr<Rec>(K_REC);
  const i = arr.findIndex((r) => r.id === rec.id);
  if (i >= 0) arr[i] = rec;
  else arr.push(rec);
  await writeArr(K_REC, arr);
}

export async function deleteRecording(id: string): Promise<void> {
  await writeArr(K_REC, (await readArr<Rec>(K_REC)).filter((r) => r.id !== id));
  await writeArr(K_TRANSCRIPTS, (await readArr<Transcript>(K_TRANSCRIPTS)).filter((t) => t.recordingId !== id));
  await writeArr(K_MESSAGES, (await readArr<ChatMessage>(K_MESSAGES)).filter((m) => m.recordingId !== id));
}

// ── Transcripts ──
export async function saveTranscript(t: Transcript): Promise<void> {
  const arr = await readArr<Transcript>(K_TRANSCRIPTS);
  const i = arr.findIndex((x) => x.recordingId === t.recordingId);
  if (i >= 0) arr[i] = t;
  else arr.push(t);
  await writeArr(K_TRANSCRIPTS, arr);
}

export async function getTranscript(recordingId: string): Promise<Transcript | null> {
  return (await readArr<Transcript>(K_TRANSCRIPTS)).find((t) => t.recordingId === recordingId) ?? null;
}

export async function getResumableTranscriptions(): Promise<string[]> {
  return (await readArr<Transcript>(K_TRANSCRIPTS))
    .filter((t) => t.status === 'processing' || t.status === 'pending')
    .map((t) => t.recordingId);
}

// ── Messages ──
export async function addMessage(m: Omit<ChatMessage, 'id'>): Promise<void> {
  const arr = await readArr<ChatMessage>(K_MESSAGES);
  const nextId = arr.reduce((mx, x) => Math.max(mx, x.id ?? 0), 0) + 1; // monotoniczne, bez kolizji po usunięciach
  arr.push({ ...m, id: nextId });
  await writeArr(K_MESSAGES, arr);
}

export async function getMessages(recordingId: string): Promise<ChatMessage[]> {
  return (await readArr<ChatMessage>(K_MESSAGES))
    .filter((m) => m.recordingId === recordingId)
    .sort((a, b) => a.createdAt - b.createdAt);
}
