/**
 * Trwałość danych (expo-sqlite, natywnie). Tabele: recordings, transcripts, messages.
 * Interfejs lustrzany do useRecordings (load/upsert/delete). Wariant .web.ts używa
 * AsyncStorage — bo expo-sqlite na web jest w alpha (wymaga wasm + nagłówków COEP/COOP).
 */
import * as SQLite from 'expo-sqlite';
import type { Rec, Transcript, ChatMessage } from './types';

const DB_NAME = 'recai.db';
const DB_VERSION = 2;

// stare nagrania demo (seed z wcześniejszych wersji) — jednorazowo czyszczone w migracji v2
const DEMO_IDS = ['r1', 'r2', 'r3', 'r4'];

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await migrate(db);
      return db;
    })();
  }
  return dbPromise;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  if (version >= DB_VERSION) return;
  if (version === 0) {
    await db.execAsync(`
      PRAGMA journal_mode = 'wal';
      CREATE TABLE IF NOT EXISTS recordings (
        id TEXT PRIMARY KEY NOT NULL,
        uri TEXT,
        title TEXT,
        date TEXT NOT NULL,
        length_sec INTEGER NOT NULL,
        size_bytes INTEGER,
        seq INTEGER,
        samples TEXT,
        transcribed INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS transcripts (
        recording_id TEXT PRIMARY KEY NOT NULL,
        text TEXT,
        segments TEXT,
        language TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        job_id TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recording_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_rec ON messages(recording_id);
    `);
    // brak seedu — apka startuje z pustą listą (widok „No recordings.")
    version = 1;
  }
  if (version < 2) {
    // jednorazowo: usuń stare nagrania demo (seed r1–r4), które mogły zostać z wcześniejszych wersji
    const ph = DEMO_IDS.map(() => '?').join(',');
    await db.runAsync(`DELETE FROM recordings WHERE id IN (${ph})`, ...DEMO_IDS);
    await db.runAsync(`DELETE FROM transcripts WHERE recording_id IN (${ph})`, ...DEMO_IDS);
    await db.runAsync(`DELETE FROM messages WHERE recording_id IN (${ph})`, ...DEMO_IDS);
    version = 2;
  }
  await db.execAsync(`PRAGMA user_version = ${DB_VERSION}`);
}

type Row = {
  id: string;
  uri: string | null;
  title: string | null;
  date: string;
  length_sec: number;
  size_bytes: number | null;
  seq: number | null;
  samples: string | null;
  transcribed: number;
  sort_order: number;
};

function rowToRec(r: Row): Rec {
  let samples: number[] | undefined;
  if (r.samples) {
    try {
      const a = JSON.parse(r.samples);
      if (Array.isArray(a)) samples = a;
    } catch {}
  }
  return {
    id: r.id,
    uri: r.uri ?? undefined,
    title: r.title ?? undefined,
    date: r.date,
    lengthSec: r.length_sec,
    sizeBytes: r.size_bytes ?? undefined,
    seq: r.seq ?? undefined,
    samples,
    transcribed: r.transcribed === 1,
    sortOrder: r.sort_order,
  };
}

async function upsertInto(db: SQLite.SQLiteDatabase, rec: Rec): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO recordings
       (id, uri, title, date, length_sec, size_bytes, seq, samples, transcribed, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    rec.id,
    rec.uri ?? null,
    rec.title ?? null,
    rec.date,
    Math.round(rec.lengthSec),
    rec.sizeBytes ?? null,
    rec.seq ?? null,
    rec.samples ? JSON.stringify(rec.samples) : null,
    rec.transcribed ? 1 : 0,
    rec.sortOrder ?? 0
  );
}

// ── Recordings ──
export async function initDb(): Promise<void> {
  await getDb();
}

export async function loadRecordings(): Promise<Rec[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>('SELECT * FROM recordings ORDER BY sort_order DESC, rowid DESC');
  return rows.map(rowToRec);
}

export async function upsertRecording(rec: Rec): Promise<void> {
  const db = await getDb();
  await upsertInto(db, rec);
}

export async function deleteRecording(id: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM recordings WHERE id = ?', id);
    await db.runAsync('DELETE FROM transcripts WHERE recording_id = ?', id);
    await db.runAsync('DELETE FROM messages WHERE recording_id = ?', id);
  });
}

// ── Transcripts (powierzchnia pod Fazę 3) ──
export async function saveTranscript(t: Transcript): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO transcripts (recording_id, text, segments, language, status, job_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    t.recordingId,
    t.text ?? null,
    t.segments ? JSON.stringify(t.segments) : null,
    t.language ?? null,
    t.status,
    t.jobId ?? null,
    Date.now()
  );
}

export async function getTranscript(recordingId: string): Promise<Transcript | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{
    recording_id: string;
    text: string | null;
    segments: string | null;
    language: string | null;
    status: string;
    job_id: string | null;
  }>('SELECT * FROM transcripts WHERE recording_id = ?', recordingId);
  if (!r) return null;
  let segments: Transcript['segments'] = null;
  if (r.segments) {
    try {
      const a = JSON.parse(r.segments);
      if (Array.isArray(a)) segments = a;
    } catch {}
  }
  return {
    recordingId: r.recording_id,
    text: r.text,
    segments,
    language: r.language,
    status: r.status as Transcript['status'],
    jobId: r.job_id,
  };
}

// id nagrań z niedokończoną transkrypcją (do wznowienia po restarcie apki)
export async function getResumableTranscriptions(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ recording_id: string }>(
    "SELECT recording_id FROM transcripts WHERE status IN ('processing', 'pending')"
  );
  return rows.map((r) => r.recording_id);
}

// ── Messages (powierzchnia pod Fazę 3) ──
export async function addMessage(m: Omit<ChatMessage, 'id'>): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO messages (recording_id, role, content, created_at) VALUES (?, ?, ?, ?)',
    m.recordingId,
    m.role,
    m.content,
    m.createdAt
  );
}

export async function getMessages(recordingId: string): Promise<ChatMessage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: number;
    recording_id: string;
    role: string;
    content: string;
    created_at: number;
  }>('SELECT * FROM messages WHERE recording_id = ? ORDER BY created_at ASC, id ASC', recordingId);
  return rows.map((r) => ({
    id: r.id,
    recordingId: r.recording_id,
    role: r.role as ChatMessage['role'],
    content: r.content,
    createdAt: r.created_at,
  }));
}
