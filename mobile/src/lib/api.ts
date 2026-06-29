/**
 * Klient backendu REC_AI: upload audio do transkrypcji + czat o notatce.
 * Nagłówek `X-Device-Id` (anonimowy id). Baza z `EXPO_PUBLIC_API_URL`. Retry z backoffem
 * (tylko błędy sieci i 5xx). Faza 3 podłącza to do UI; teraz scaffolding z kontraktem backendu.
 */
import { getDeviceId } from './deviceId';
import { uploadMultipart } from './multipartUpload';

const BASE = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8001').replace(/\/+$/, '');

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export type Segment = { start: number | null; end: number | null; text: string };

// Kontrakt /api/v1/transcriptions (backend: schemas.TranscriptionResponse)
export type TranscriptionResult = {
  job_id: string;
  status: 'completed' | 'processing' | 'failed';
  recording_id?: string;
  transcript?: string | null;
  segments?: Segment[] | null;
  language?: string | null;
};

// Kontrakt /api/v1/chat (backend: schemas.ChatResponse / ChatRequest)
export type ChatTurn = { role: 'user' | 'assistant'; content: string };
export type ChatResult = { answer: string; model: string; usage?: Record<string, unknown> | null };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** fetch z retry: ponawia tylko błędy sieci i 5xx (4xx zwraca od razu). Wykładniczy backoff. */
async function request(path: string, makeInit: () => RequestInit, retries = 2, baseDelay = 600): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, makeInit());
      if (res.status >= 500 && attempt < retries) {
        await sleep(baseDelay * 2 ** attempt);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(baseDelay * 2 ** attempt);
    }
  }
  throw new ApiError(0, `network error: ${String(lastErr)}`);
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof (data as any).detail === 'string') return (data as any).detail;
    return JSON.stringify(data);
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

/** Upload pliku audio do transkrypcji. makeInit buduje świeży FormData na każdą próbę (retry-safe). */
export async function transcribe(opts: {
  uri: string;
  recordingId: string;
  mimeType?: string;
  fileName?: string;
  language?: string;
}): Promise<TranscriptionResult> {
  const deviceId = await getDeviceId();
  const url = `${BASE}/api/v1/transcriptions`;
  const fields: Record<string, string> = { recording_id: opts.recordingId };
  if (opts.language) fields.language = opts.language;
  const headers = { 'X-Device-Id': deviceId, Accept: 'application/json' };

  // Upload natywnym uploaderem (expo/fetch + File-Blob); legacy {uri,name,type} nie działa na New Arch.
  // Retry tylko dla błędów sieci i 5xx (4xx zwracamy od razu). Świeży FormData budowany w uploaderze co próbę.
  let lastErr: unknown;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const { status, text } = await uploadMultipart({ url, fileUri: opts.uri, fieldName: 'audio', fields, headers });
      if (status >= 500 && attempt < 2) {
        await sleep(600 * 2 ** attempt);
        continue;
      }
      if (status >= 400) {
        let detail = text;
        try {
          const j = JSON.parse(text);
          if (j && typeof (j as any).detail === 'string') detail = (j as any).detail;
        } catch {}
        throw new ApiError(status, detail);
      }
      return JSON.parse(text) as TranscriptionResult;
    } catch (e) {
      if (e instanceof ApiError) throw e; // 4xx — nie ponawiamy
      lastErr = e;
      if (attempt < 2) await sleep(600 * 2 ** attempt);
    }
  }
  throw new ApiError(0, `network error: ${String(lastErr)}`);
}

/** Czat o pojedynczej notatce (transkrypt + historia + pytanie). */
export async function chat(opts: { transcript: string; question: string; messages?: ChatTurn[]; language?: string }): Promise<ChatResult> {
  const deviceId = await getDeviceId();
  const res = await request('/api/v1/chat', () => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId, Accept: 'application/json' },
    body: JSON.stringify({ transcript: opts.transcript, question: opts.question, messages: opts.messages ?? [], language: opts.language }),
  }));
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  return (await res.json()) as ChatResult;
}

export function apiBaseUrl(): string {
  return BASE;
}
