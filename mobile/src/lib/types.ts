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

// Słowo z własnym czasem — tylko silnik `advanced` (deAPI ts_level=word). Pozwala podświetlać
// transkrypt CO DO SŁOWA; bez tego dzielimy tekst proporcjonalnie po znakach (przybliżenie).
export type Word = { word: string; start: number | null; end: number | null; speaker?: string | null };

// Segment transkryptu. `speaker` ("SPEAKER_00"…) i `words` przychodzą tylko z silnika `advanced`
// z włączoną diaryzacją — dla `standard` są puste i widok chowa kolumnę rozmówców.
export type Segment = {
  start: number | null;
  end: number | null;
  text: string;
  speaker?: string | null;
  words?: Word[] | null;
};

// Silnik transkrypcji: standard = WhisperLargeV3 (tekst), advanced = WhisperLargeV3Ct2
// (segmenty + rozmówcy + słowa). Nazwa, NIE slug modelu — backend trzyma zamkniętą listę.
export type Engine = 'standard' | 'advanced';

// Transkrypt notatki (Faza 3: realna treść z backendu zamiast mocka).
export type Transcript = {
  recordingId: string;
  text: string | null;
  segments: Segment[] | null;
  language: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  jobId: string | null;
  // Czym policzone. Notatki sprzed wprowadzenia silników mają null → traktujemy jak `standard`.
  engine?: Engine | null;
  // Imiona rozmówców rozpoznane przez AI z treści: { "SPEAKER_00": "Marc" }. Tylko gdy imię
  // NAPRAWDĘ padło w nagraniu; nierozpoznani są nieobecni w mapie i zostają przy numerze.
  speakerNames?: Record<string, string> | null;
};

// Wiadomość czatu o notatce (Faza 3).
export type ChatMessage = {
  id?: number;
  recordingId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number; // ms epoch
};
