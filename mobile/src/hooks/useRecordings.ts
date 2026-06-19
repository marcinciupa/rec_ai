/**
 * useRecordings — wspólny store nagrań (lifted do App), dzielony przez RecordingScreen (zapis)
 * i PlaybackScreen (lista/odtwarzanie/usuwanie/transkrypcja).
 * Rec.uri = realny plik (nagrane); brak uri = pozycja demo (mock). lengthSec/sizeBytes — metadane.
 */
import { useState } from 'react';

export type Rec = {
  id: string;
  uri?: string; // realny plik audio (nagrane); brak = demo/mock
  title?: string; // tytuł od AI (po transkrypcji)
  date: string; // DD/MM/YY
  lengthSec: number;
  sizeBytes?: number; // realny rozmiar pliku (jeśli znany)
  seq?: number; // numer porządkowy w obrębie dnia (przydzielony przy zapisie; stabilny)
  samples?: number[]; // obwiednia amplitudy 0..1 (z meteringu nagrania) — do waveformu odtwarzania
  transcribed: boolean;
};

// generyczna nazwa pliku z daty + numeru: 10/06/26 + 1 → 10_06_26_REC01
export const genericName = (date: string, n: number) => `${date.replace(/\//g, '_')}_REC${String(n).padStart(2, '0')}`;
// kolejny numer porządkowy dla daty = liczba nagrań tego dnia + 1
export const nextSeq = (recordings: Rec[], date: string) => recordings.filter((r) => r.date === date).length + 1;

// dane demonstracyjne (bez uri → mock); realne nagrania dochodzą na górę
const INITIAL: Rec[] = [
  { id: 'r1', date: '10/06/26', lengthSec: 23 * 60 + 11, transcribed: false },
  { id: 'r2', title: 'SKEUMORPHIC UI IDEA', date: '9/06/26', lengthSec: 54 * 60 + 23, transcribed: true },
  { id: 'r3', title: 'REC_AI DESIGN IDEAS', date: '7/06/26', lengthSec: 12 * 60 + 3, transcribed: true },
  { id: 'r4', date: '7/06/26', lengthSec: 8 * 60 + 45, transcribed: false },
];

export function useRecordings() {
  const [recordings, setRecordings] = useState<Rec[]>(INITIAL);
  const add = (r: Rec) => setRecordings((prev) => [r, ...prev]); // nowe na górze
  const removeById = (id: string) => setRecordings((prev) => prev.filter((r) => r.id !== id));
  const insertAt = (r: Rec, index: number) =>
    setRecordings((prev) => {
      const a = prev.slice();
      a.splice(Math.max(0, Math.min(a.length, index)), 0, r);
      return a;
    });
  const update = (id: string, patch: Partial<Rec>) =>
    setRecordings((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return { recordings, add, removeById, insertAt, update };
}

export type RecordingsStore = ReturnType<typeof useRecordings>;
