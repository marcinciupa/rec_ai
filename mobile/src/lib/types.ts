/**
 * Wspólne typy danych + dane demonstracyjne (seed). BEZ importów runtime — dzięki temu
 * db.ts (native), db.web.ts i useRecordings korzystają z nich bez cykli importów.
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

// Dane demonstracyjne — seed przy PIERWSZYM uruchomieniu (pusta baza). Bez uri → mock.
// sortOrder malejąco: r1 na górze; nowe realne nagrania dostają wyższy sortOrder (ponad demo).
export const SEED_RECORDINGS: Rec[] = [
  { id: 'r1', date: '10/06/26', lengthSec: 23 * 60 + 11, transcribed: false, sortOrder: 4 },
  { id: 'r2', title: 'SKEUMORPHIC UI IDEA', date: '9/06/26', lengthSec: 54 * 60 + 23, transcribed: true, sortOrder: 3 },
  { id: 'r3', title: 'REC_AI DESIGN IDEAS', date: '7/06/26', lengthSec: 12 * 60 + 3, transcribed: true, sortOrder: 2 },
  { id: 'r4', date: '7/06/26', lengthSec: 8 * 60 + 45, transcribed: false, sortOrder: 1 },
];
