/**
 * Wspólne typy danych. BEZ importów runtime — dzięki temu db.ts (native), db.web.ts
 * i useRecordings korzystają z nich bez cykli importów.
 */

// Pojedyncze nagranie. uri = realny plik (nagrane); brak uri = pozycja demo (mock).
export type Rec = {
  id: string;
  uri?: string;
  title?: string; // tytuł od AI (po transkrypcji)
  date: string; // DD/MM/YY
  lengthSec: number;
  sizeBytes?: number;
  seq?: number; // numer porządkowy w obrębie dnia (stabilny, do nazwy)
  samples?: number[]; // obwiednia amplitudy 0..1 (do waveformu odtwarzania)
  transcribed: boolean;
  sortOrder?: number; // wewn. kolejność listy (malejąco = najnowsze na górze); nadawane przy zapisie
};

// Transkrypt notatki (Faza 3: realna treść z backendu zamiast mocka).
export type Transcript = {
  recordingId: string;
  text: string | null;
  segments: { start: number | null; end: number | null; text: string }[] | null;
  language: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  jobId: string | null;
};

// Wiadomość czatu o notatce (Faza 3).
export type ChatMessage = {
  id?: number;
  recordingId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number; // ms epoch
};
