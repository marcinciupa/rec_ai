/**
 * useRecordings — wspólny store nagrań z TRWAŁOŚCIĄ (SQLite natywnie, AsyncStorage na web).
 * API niezmienione (add/removeById/insertAt/update), więc ekrany nie wymagają zmian.
 * UI aktualizuje się natychmiast (stan w pamięci), zapis do bazy leci w tle.
 * Pliki audio kasowane są LENIWIE (GC przy starcie) → UNDO zachowuje audio w tej samej sesji.
 *
 * Rec.uri = realny plik (nagrane); brak uri = pozycja demo (mock). lengthSec/sizeBytes — metadane.
 */
import { useState, useEffect, useRef } from 'react';
import type { Rec } from '../lib/types';
import * as db from '../lib/db';
import { cleanupOrphanFiles } from '../lib/recordingFiles';

export type { Rec } from '../lib/types';

// generyczna nazwa pliku z daty + numeru: 10/06/26 + 1 → 10_06_26_REC01
export const genericName = (date: string, n: number) => `${date.replace(/\//g, '_')}_REC${String(n).padStart(2, '0')}`;
// kolejny numer porządkowy dla daty = liczba nagrań tego dnia + 1
export const nextSeq = (recordings: Rec[], date: string) => recordings.filter((r) => r.date === date).length + 1;

export function useRecordings() {
  const [recordings, setRecordings] = useState<Rec[]>([]);
  const maxOrder = useRef(0); // najwyższy sortOrder — nowe nagrania dostają +1 (trafiają na górę)
  const recsRef = useRef<Rec[]>([]); // bieżąca lista (do odczytu poza updaterem stanu)
  recsRef.current = recordings;
  // serializacja zapisów do bazy w KOLEJNOŚCI wywołań — np. delete musi trafić przed późniejszym
  // upsert z UNDO (withTransactionAsync nie gwarantuje porządku przy współbieżnych zapytaniach)
  const dbQueue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = (fn: () => Promise<unknown>) => {
    dbQueue.current = dbQueue.current.then(() => fn().catch(() => {}));
  };

  // start: wczytaj z bazy, ustaw licznik kolejności, posprzątaj osierocone pliki
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await db.initDb();
        const recs = await db.loadRecordings();
        if (!alive) return;
        maxOrder.current = recs.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0);
        setRecordings(recs);
        cleanupOrphanFiles(recs.map((r) => r.id)).catch(() => {});
      } catch {
        // awaryjnie (np. błąd bazy): pusta lista (widok „No recordings."), bez mocków
        if (!alive) return;
        setRecordings([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // nowe nagranie: nadaj kolejność (na górę), zapisz w bazie
  const add = (r: Rec) => {
    const rec: Rec = { ...r, sortOrder: ++maxOrder.current };
    setRecordings((prev) => [rec, ...prev]);
    enqueue(() => db.upsertRecording(rec));
  };

  // usuń wiersz z bazy; pliku NIE kasujemy od razu (GC przy starcie) → UNDO zachowuje audio
  const removeById = (id: string) => {
    setRecordings((prev) => prev.filter((r) => r.id !== id));
    enqueue(() => db.deleteRecording(id));
  };

  // UNDO: wstaw z powrotem na pozycję; zachowany sortOrder → ta sama kolejność po restarcie
  const insertAt = (r: Rec, index: number) => {
    setRecordings((prev) => {
      const a = prev.slice();
      a.splice(Math.max(0, Math.min(a.length, index)), 0, r);
      return a;
    });
    enqueue(() => db.upsertRecording(r));
  };

  // zmiana pól (np. transkrypcja → title/transcribed): policz nowy rec z bieżącej listy i zapisz
  const update = (id: string, patch: Partial<Rec>) => {
    const current = recsRef.current.find((r) => r.id === id);
    if (!current) return;
    const updated: Rec = { ...current, ...patch };
    setRecordings((prev) => prev.map((r) => (r.id === id ? updated : r)));
    enqueue(() => db.upsertRecording(updated));
  };

  return { recordings, add, removeById, insertAt, update };
}

export type RecordingsStore = ReturnType<typeof useRecordings>;
