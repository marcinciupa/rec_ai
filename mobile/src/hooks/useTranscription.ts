/**
 * useTranscription — realna transkrypcja nagrań przez backend (api.transcribe → deAPI).
 * Maszyna stanów per nagranie: uploading → processing → done | failed. Wynik trafia do SQLite
 * (transcripts), a tytuł/flaga `transcribed` do store nagrań. Przerwane (processing) wznawiamy
 * przy następnym starcie apki. Postęp jest „pełzający" (backend nie raportuje %), snap do 100 na koniec.
 *
 * Lifted w App.tsx i współdzielony przez RecordingScreen (AUTO TRANSCRIBE) i PlaybackScreen (przycisk TRANS-CRIBE).
 */
import { useEffect, useRef, useState } from 'react';
import type { Rec, Engine, Segment } from '../lib/types';
import { isUsableName } from '../lib/speakerLabel';
import { buildChunks, chunkPrompt, snapSpeakersToSentences, MAX_PROMPT_CHARS } from '../lib/transcriptRows';
import { applySpeakerTurns, needsSpeakerSplit, splitByWordSpeakers, turnsToSpeakers } from '../lib/speakerSplit';
import { buildBlocks, normalizeStarts, needsBlockSplit } from '../lib/segmentSplit';
import type { RecordingsStore } from './useRecordings';
import * as api from '../lib/api';
import * as db from '../lib/db';

export type TransStatus = 'uploading' | 'processing' | 'done' | 'failed';
export type TransUiState = { status: TransStatus; pct: number | null; error?: string };

// ── Widok statusu AI na pasku (deApi label) ──
// REGUŁA: statusbar NIGDY nie jest czerwony i NIE informuje o błędzie (FAILED → IDLE/TRANSCRIBED).
export type AiTone = 'phosphor' | 'dim';
export type AiStatusView = { tone: AiTone; pulse: boolean; lines: [string, string] | null };

/**
 * Jeden punkt prawdy dla statusbara AI (wspólny dla Recording/Playback).
 *  - tState: stan joba transkrypcji danego nagrania (z managera)
 *  - transcribed: nagranie ma już transkrypt (trwały badge „TRANSCRIBED")
 *  - noSpeech: transkrypt pusty (tytuł „(NO SPEECH)")
 *  - aiArmed: ekran nagrywania z włączonym AUTO TRANSCRIBE (stan READY)
 * FAILED świadomie pominięte — pasek wraca do IDLE (retry przez opcję TRANSCRIBE).
 */
export function deriveAiStatus(opts: {
  tState?: TransUiState;
  transcribed?: boolean;
  noSpeech?: boolean;
  aiArmed?: boolean;
}): AiStatusView {
  const { tState, transcribed, noSpeech, aiArmed } = opts;
  switch (tState?.status) {
    case 'uploading':
      return { tone: 'phosphor', pulse: true, lines: ['AI TRANSCRIBING', 'UPLOADING…'] };
    case 'processing':
      return { tone: 'phosphor', pulse: true, lines: ['AI TRANSCRIBING', `PROCESSING (${tState.pct ?? 0}%)`] };
    case 'done':
      return { tone: 'phosphor', pulse: false, lines: ['AI TRANSCRIBED', 'DONE ✓'] };
    // 'failed' → spada niżej (IDLE/TRANSCRIBED); statusbar nie pokazuje błędu
  }
  if (transcribed) return { tone: 'phosphor', pulse: false, lines: ['AI TRANSCRIBED', noSpeech ? 'NO SPEECH' : 'WITH DEAPI'] };
  if (aiArmed) return { tone: 'phosphor', pulse: false, lines: ['AI TRANSCRIPTION', 'ACTIVE ON DEAPI'] };
  return { tone: 'dim', pulse: false, lines: null };
}

const TITLE_MAX = 30; // lista pokazuje 1 linię → krótki tytuł

// fallback: pierwsze słowa WIELKIMI literami (styl skeuomorficzny listy), gdy AI-tytuł niedostępny
function deriveTitle(text: string): string {
  const clean = text
    .replace(/\[[^\]]*\]/g, ' ') // usuń znaczniki czasu [m:ss - m:ss]
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return 'TRANSCRIBED NOTE';
  const head = clean.split(' ').slice(0, 5).join(' ');
  return (head.length > TITLE_MAX ? head.slice(0, TITLE_MAX) : head).toUpperCase();
}

// porządkowanie odpowiedzi LLM na tytuł: bez cudzysłowów/markdownu/przedrostka, 1 linia, WIELKIE litery, przycięte
function sanitizeTitle(raw: string): string {
  const clean = (raw || '')
    .split('\n')[0]
    .replace(/^(tytuł|title)\s*[:\-–]\s*/i, '') // „Tytuł: …"
    .replace(/[*_`"'“”„«»]/g, '') // markdown + cudzysłowy
    .replace(/\s+/g, ' ')
    .replace(/[.。!?]+$/, '') // znak końca zdania
    .trim();
  if (!clean) return '';
  const t = clean.length > TITLE_MAX ? clean.slice(0, TITLE_MAX).replace(/\s+\S*$/, '') : clean; // tnij na granicy słowa
  return t.toUpperCase();
}

// tytuł z CAŁOŚCI transkryptu przez LLM (backend /chat → OpenRouter); fallback = pierwsze słowa
async function generateTitle(text: string): Promise<string> {
  try {
    const res = await api.chat({
      transcript: text,
      question:
        'Wymyśl krótki, treściwy tytuł tej notatki głosowej (2–5 słów) oddający jej główny temat, w języku notatki. ' +
        'Zwróć wyłącznie sam tytuł — bez cudzysłowów, bez przedrostka „Tytuł:", bez kropki na końcu.',
    });
    return sanitizeTitle(res.answer) || deriveTitle(text);
  } catch {
    return deriveTitle(text);
  }
}

/** Transkrypt z etykietami mówców, sklejony do promptu. Sąsiadujące segmenty tej samej osoby
 *  łączymy w jedną kwestię — model dostaje dialog, a nie posiekane linijki. */
function taggedDialogue(segments: Segment[], maxChars = 12000): string {
  const lines: string[] = [];
  for (const s of segments) {
    const who = s.speaker ?? 'UNKNOWN';
    const text = s.text.trim();
    if (!text) continue;
    const prev = lines[lines.length - 1];
    if (prev && prev.startsWith(`${who}:`)) lines[lines.length - 1] = `${prev} ${text}`;
    else lines.push(`${who}: ${text}`);
  }
  const out = lines.join('\n');
  return out.length > maxChars ? out.slice(0, maxChars) : out;
}

/** Wyłuskaj obiekt JSON z odpowiedzi modelu — bywa opakowany w ```json ... ``` albo w zdanie. */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(body.slice(start, end + 1));
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Kto jest kim: mapa „SPEAKER_00" → imię, WYŁĄCZNIE gdy imię pada w nagraniu i da się je pewnie
 * przypisać. Świadomie restrykcyjne — błędne imię jest gorsze niż numer, bo brzmi wiarygodnie
 * i czytelnik uwierzy, że dana osoba coś powiedziała. Zwraca null, gdy nic pewnego nie ustalono.
 * Odsiew wymówek modelu („nieznany", „Speaker 2") robi isUsableName w lib/speakerLabel.
 */
async function identifySpeakers(segments: Segment[]): Promise<Record<string, string> | null> {
  const ids = [...new Set(segments.map((s) => s.speaker).filter(Boolean))] as string[];
  if (ids.length < 2) return null; // jedna osoba → nie ma czego rozpoznawać
  try {
    const res = await api.chat({
      transcript: taggedDialogue(segments),
      question:
        'To zapis rozmowy z etykietami mówców. Dla każdej etykiety podaj IMIĘ tej osoby, ale TYLKO jeśli ' +
        'pada ono w rozmowie i jednoznacznie wskazuje właśnie tego mówcę (np. ktoś się przedstawia albo ' +
        'jest do niego imiennie zwrócony). Jeśli masz jakąkolwiek wątpliwość — wpisz null. NIE ZGADUJ, ' +
        'nie wymyślaj imion i nie przypisuj imienia osobie tylko dlatego, że padło w rozmowie. ' +
        'Zachowaj oryginalną pisownię i znaki diakrytyczne. Zwróć WYŁĄCZNIE obiekt JSON w postaci ' +
        `{"SPEAKER_00": "Imię", "SPEAKER_01": null}, obejmujący dokładnie te etykiety: ${ids.join(', ')}.`,
    });
    const obj = extractJsonObject(res.answer);
    if (!obj) return null;
    const out: Record<string, string> = {};
    for (const id of ids) if (isUsableName(obj[id])) out[id] = String(obj[id]).trim();
    return Object.keys(out).length ? out : null;
  } catch {
    return null; // rozpoznanie imion to dodatek — jego brak nie może zepsuć transkrypcji
  }
}

/**
 * Kto mówi — ustalone z TREŚCI, gdy diaryzacja akustyczna deAPI zwróci jednego mówcę mimo rozmowy
 * kilku osób (realny objaw: nagranie z trzema osobami, wszystkie słowa z jednym `SPEAKER_00`).
 *
 * Model NIE DOTYKA TEKSTU: dostaje ponumerowane fragmenty wycięte przez nas na granicach słów
 * i oddaje wyłącznie numer mówcy dla każdego. Dzięki temu każdy kawałek zachowuje PRAWDZIWY czas
 * ze słów — inaczej rozjechałby się seek i karaoke, na których stoi cały widok transkrypcji.
 * Szczegóły cięcia i składania: lib/speakerSplit. Zwraca null (błąd, monolog, notatka za długa
 * na jedno wywołanie) → zostaje stan sprzed próby.
 */
async function inferSpeakerTurns(segments: Segment[]): Promise<Segment[] | null> {
  const chunks = buildChunks(segments);
  if (chunks.length < 2) return null;
  const body = chunkPrompt(chunks);
  if (body.length > MAX_PROMPT_CHARS) return null;
  try {
    const res = await api.chat({
      transcript: body,
      // Prompt dobrany POMIAREM na żywo (5 wariantów × 3 przebiegi przez /chat, porównywane do wzorca
      // granic na rozmowie 2 i 3 osób oraz na monologu):
      //  • tablica „mówca na każdy fragment" — 2 nadmiarowe granice; TURY z cytatem — 1;
      //  • wyliczenie „to NIE są sygnały zmiany" POGARSZAŁO wynik (model brał je za uzasadnienie);
      //  • tury jako zakresy od–do przesadzały w drugą stronę (scalały pół rozmowy w jedną turę);
      //  • wymaganie pola `why` i przykład z rozwiązaniem dały najlepszy wynik — i to jest ta wersja.
      // Objaw, który to naprawia: model otwierał turę przy PRAWIE KAŻDYM zdaniu, więc granica lądowała
      // „o zdanie za wcześnie" (ostatnie zdanie jednej osoby trafiało do wypowiedzi drugiej).
      // Zmierzona resztka błędu: ok. jedna nadmiarowa granica na 10 fragmentów, na wstępach, które i dla
      // człowieka są dwuznaczne. Pytanie modelu 3× i branie części wspólnej NIE pomaga (sprawdzone:
      // błędy są powtarzalne, a część wspólna gubi prawdziwe granice) — dlatego jedno wywołanie.
      question:
        'To zapis nagrania podzielony na ponumerowane fragmenty. Automatyczne rozdzielenie głosów ' +
        'zawiodło — ustal WYŁĄCZNIE Z TREŚCI, kto mówi w którym fragmencie.\n' +
        'Wypisz TURY, czyli miejsca, w których ktoś ZACZYNA mówić. Tura trwa aż do następnej — kilka, ' +
        'nawet kilkanaście fragmentów pod rząd należy zwykle do tej samej osoby.\n' +
        'Nową turę wolno otworzyć TYLKO wtedy, gdy w treści widać konkretny sygnał zmiany mówcy:\n' +
        '• odpowiedź na zadane wcześniej pytanie;\n' +
        '• zwrot do rozmówcy (imię, „a ty", „powiedz mi");\n' +
        '• przedstawienie się albo mówienie o sobie tam, gdzie przed chwilą mówiono o kimś innym.\n' +
        'Sama zmiana zdania, tematu czy wątku NIE jest sygnałem — jedna osoba potrafi powiedzieć kilka ' +
        'zdań pod rząd, także zadać pytanie po własnym wstępie.\n' +
        'Dla KAŻDEJ tury podaj „why" — który to sygnał i z którego fragmentu. Jeśli nie umiesz go nazwać, ' +
        'NIE otwieraj tury.\n' +
        'Przykład: fragmenty „Dobra, zaczynajmy." / „Aniu, jak tam raport?" / „Skończony, wysłałam wczoraj." ' +
        'to DWIE tury: 1 (osoba 1: wstęp i pytanie) oraz 3 (osoba 2: odpowiedź) — fragment 2 NIE zaczyna ' +
        'nowej tury.\n' +
        'Mówców numeruj od 1, wg kolejności pojawienia się; użyj najmniejszej liczby osób, jaka tłumaczy ' +
        'rozmowę. Monolog = jedna tura. Nie zwracaj tekstu poza krótkim cytatem.\n' +
        `Zwróć WYŁĄCZNIE JSON: {"count": ile osób, "turns": [{"from": 1, "quote": "pierwsze słowa ` +
        `fragmentu", "speaker": 1, "why": "sygnał"}]} — numery rosnąco, z zakresu 1–${chunks.length}.`,
    });
    const speakers = turnsToSpeakers(chunks, extractJsonObject(res.answer)?.turns);
    if (!speakers) return null;
    return applySpeakerTurns(segments, chunks, speakers);
  } catch {
    return null; // rozmówcy to dodatek — ich brak nie może zepsuć transkrypcji
  }
}

/**
 * Podział długiego segmentu na czytelne wiersze — GRANICE WYZNACZA KONTEKST, nie długość.
 * Model dostaje te same ponumerowane fragmenty co przy rozmówcach i oddaje wyłącznie numery
 * fragmentów, od których zaczyna się nowa myśl. Zwraca null (odmowa, śmieci, notatka za długa
 * na jedno pytanie) → wołający spada na podział mechaniczny, a nie na brak podziału.
 */
async function inferBlocks(segments: Segment[]): Promise<Segment[] | null> {
  const chunks = buildChunks(segments);
  if (chunks.length < 2) return null;
  const body = chunkPrompt(chunks);
  if (body.length > MAX_PROMPT_CHARS) return null;
  try {
    const res = await api.chat({
      transcript: body,
      question:
        'To zapis nagrania podzielony na ponumerowane fragmenty. Pogrupuj je w AKAPITY — bloki jednej ' +
        'myśli albo jednego wątku, tak żeby dało się to czytać.\n' +
        'Reguły:\n' +
        '• nowy akapit zaczynaj tam, gdzie zmienia się temat, wątek albo perspektywa;\n' +
        '• akapit to zwykle 2–6 fragmentów — NIE rób akapitu z każdego zdania, to daje sieczkę;\n' +
        '• kieruj się sensem, a nie długością — akapit może być dłuższy, jeśli to jedna myśl;\n' +
        '• nie zwracaj tekstu, nie scalaj ani nie dziel fragmentów.\n' +
        `Zwróć WYŁĄCZNIE JSON: {"starts": [1, 5, 12]} — numery fragmentów rozpoczynających akapity, ` +
        `rosnąco, z zakresu 1–${chunks.length}.`,
    });
    const starts = normalizeStarts(extractJsonObject(res.answer)?.starts, chunks.length);
    if (!starts) return null;
    return buildBlocks(segments, chunks, { starts });
  } catch {
    return null;
  }
}

/** @param opts.aiSpeakers Settings → AI SPEAKERS: pozwolenie na ustalanie rozmówców z treści,
 *  gdy diaryzacja deAPI zawiodła. Czytane w chwili transkrypcji (ref), więc zmiana w ustawieniach
 *  działa od razu, także dla wznowionych zleceń. */
export function useTranscription(store: RecordingsStore, settings?: { aiSpeakers?: boolean; aiParagraphs?: boolean }) {
  // Licznik zapisów transkryptu per nagranie. Player wczytuje transkrypt RAZ (efekt na [view, id,
  // transcribed]) — a rozmówcy i akapity dolatują w tle, JUŻ PO tym wczytaniu, więc bez tego sygnału
  // ekran pokazywał stary podział aż do wyjścia i ponownego wejścia w notatkę. To samo dotyczyło
  // RE-TRANSCRIBE, gdzie `transcribed` jest już true, więc żadna zależność efektu się nie zmieniała.
  const [revs, setRevs] = useState<Record<string, number>>({});
  const bumpRev = (id: string) => setRevs((p) => ({ ...p, [id]: (p[id] ?? 0) + 1 }));
  const aiSpeakersRef = useRef(!!settings?.aiSpeakers);
  aiSpeakersRef.current = !!settings?.aiSpeakers;
  // AI PARAGRAPHS dotyczy tylko granic KONTEKSTOWYCH; podział mechaniczny działa zawsze, bo nie jest
  // zgadywaniem — wynika wprost z czasów słów i interpunkcji deAPI.
  const aiParagraphsRef = useRef(!!settings?.aiParagraphs);
  aiParagraphsRef.current = !!settings?.aiParagraphs;
  const [states, setStates] = useState<Record<string, TransUiState>>({});
  const statesRef = useRef(states);
  statesRef.current = states;
  const timers = useRef<Record<string, any>>({}); // pełzający postęp / auto-czyszczenie po zakończeniu
  const resumedRef = useRef(false);

  const clearTimer = (id: string) => {
    const t = timers.current[id];
    if (t) {
      clearInterval(t);
      clearTimeout(t);
      delete timers.current[id];
    }
  };

  const setOne = (id: string, s: TransUiState | null) => {
    setStates((prev) => {
      const next = { ...prev };
      if (s === null) delete next[id];
      else next[id] = s;
      return next;
    });
  };

  // pełzający postęp do ~92% (backend nie podaje realnego %); snap do 100 dopiero na sukces
  const startCreep = (id: string) => {
    clearTimer(id);
    timers.current[id] = setInterval(() => {
      setStates((prev) => {
        const cur = prev[id];
        if (!cur || (cur.status !== 'uploading' && cur.status !== 'processing')) return prev;
        return { ...prev, [id]: { ...cur, pct: Math.min(92, (cur.pct ?? 0) + 3) } };
      });
    }, 600);
  };

  const finishLater = (id: string, ms: number) => {
    clearTimer(id);
    timers.current[id] = setTimeout(() => setOne(id, null), ms);
  };

  const start = (rec: Rec, opts?: { language?: string; engine?: Engine }) => {
    if (!rec.uri) return; // brak pliku (demo / web) → nie ma czego transkrybować
    const cur = statesRef.current[rec.id];
    if (cur && (cur.status === 'uploading' || cur.status === 'processing')) return; // już trwa

    setOne(rec.id, { status: 'uploading', pct: 0 });
    startCreep(rec.id);
    db.saveTranscript({
      recordingId: rec.id,
      text: null,
      segments: null,
      language: opts?.language ?? null,
      status: 'processing',
      jobId: null,
      engine: opts?.engine ?? 'standard',
    }).catch(() => {});

    (async () => {
      try {
        const res = await api.transcribe({ uri: rec.uri!, recordingId: rec.id, language: opts?.language, engine: opts?.engine });
        clearTimer(rec.id);
        if (res.status === 'completed') {
          const text = (res.transcript ?? '').trim();
          await db
            .saveTranscript({
              recordingId: rec.id,
              text: res.transcript ?? null,
              segments: res.segments ?? null,
              language: res.language ?? null,
              status: 'completed',
              jobId: res.job_id,
              // z odpowiedzi backendu — to on rozstrzyga, czym faktycznie policzył
              engine: res.engine ?? opts?.engine ?? 'standard',
            })
            .then(() => bumpRev(rec.id))
            .catch(() => {});
          // Rozmówcy — w tle, po zapisaniu transkryptu. Osobne wywołania (nie doklejone do promptu
          // o tytuł), żeby nieudane sparsowanie JSON-a nie zabrało przy okazji tytułu.
          const segs = res.segments ?? null;
          if (segs?.length) {
            (async () => {
              const save = (extra: { segments: Segment[]; speakerNames?: Record<string, string> }) =>
                db
                  .saveTranscript({
                    recordingId: rec.id,
                    text: res.transcript ?? null,
                    language: res.language ?? null,
                    status: 'completed',
                    jobId: res.job_id,
                    engine: res.engine ?? opts?.engine ?? 'standard',
                    ...extra,
                  })
                  .then(() => bumpRev(rec.id))
                  .catch(() => {});
              let working = segs;
              // 0. ROZMÓWCY Z DANYCH deAPI — zawsze, bez pytania kogokolwiek. `segment.speaker` to
              //    etykieta zbiorcza ~25-sekundowego segmentu, a mówca bywa zmieniony w jego środku;
              //    słowa mają własne etykiety, więc tniemy dokładnie tam, gdzie druga osoba zaczyna
              //    mówić. Na realnym nagraniu poprawiało to przypisanie 16% słów i przesuwało granice
              //    o 1–17 s. Mechanicznie, offline, bez kosztu — więc przed jakimkolwiek zapytaniem do AI.
              // najpierw korekta spóźnienia diaryzacji (granica → koniec zdania), potem cięcie
              const snapped = snapSpeakersToSentences(working);
              const byWords = splitByWordSpeakers(snapped, buildChunks(snapped));
              if (byWords) {
                working = byWords;
                await save({ segments: working });
              }
              // 1. diaryzacja deAPI zawiodła (jeden mówca na całym nagraniu) → spróbuj z treści.
              //    Gdy rozdzieliła poprawnie albo brak zgody w ustawieniach — pomijamy, więc
              //    dyktowanie nie generuje ani jednego dodatkowego zapytania.
              if (aiSpeakersRef.current && needsSpeakerSplit(working)) {
                const split = await inferSpeakerTurns(working);
                if (split) {
                  working = split;
                  await save({ segments: working });
                }
              }
              // 2. czytelne wiersze. KOLEJNOŚĆ WAŻNOŚCI: kontekst > długość. Najpierw pytamy model,
              //    gdzie kończy się myśl; dopiero gdy odmówi (brak zgody w ustawieniach, awaria,
              //    brak sieci, notatka za długa na jedno pytanie) wchodzi podział mechaniczny —
              //    gorszy, ale wciąż czytelny i policzony wyłącznie z danych deAPI.
              if (needsBlockSplit(working)) {
                const byContext = aiParagraphsRef.current ? await inferBlocks(working) : null;
                const rows = byContext ?? buildBlocks(working, buildChunks(working), {});
                if (rows) {
                  working = rows;
                  await save({ segments: working });
                }
              }
              // 3. imiona — na WYNIKU kroków 1–2, żeby pracowały na tym samym podziale, który widzi user
              if (working.some((s) => s.speaker)) {
                const names = await identifySpeakers(working);
                if (names) await save({ segments: working, speakerNames: names });
              }
            })().catch(() => {});
          }
          // tytuł tymczasowy od razu (pierwsze słowa / „(NO SPEECH)"), żeby nie blokować momentu „done"
          store.update(rec.id, { transcribed: true, title: text ? deriveTitle(text) : '(NO SPEECH)' });
          setOne(rec.id, { status: 'done', pct: 100 });
          finishLater(rec.id, 1500);
          // …a w tle podmień na tytuł z CAŁOŚCI transkryptu (AI). Fallback już ustawiony, więc błąd nie szkodzi.
          if (text) {
            generateTitle(text)
              .then((title) => {
                if (title) store.update(rec.id, { title });
              })
              .catch(() => {});
          }
        } else if (res.status === 'processing') {
          // deAPI jeszcze liczy (okno backendu minęło) — zostaw jako processing, wznowimy po restarcie
          db.saveTranscript({
            recordingId: rec.id,
            text: null,
            segments: null,
            language: res.language ?? null,
            status: 'processing',
            jobId: res.job_id,
          }).catch(() => {});
          setOne(rec.id, { status: 'processing', pct: statesRef.current[rec.id]?.pct ?? 90 });
          // NIE zostawiaj spinnera wiszącego na 90% w nieskończoność — zwolnij UI po chwili; wiersz DB
          // pozostaje 'processing', więc transkrypcja wznowi się przy następnym starcie apki.
          finishLater(rec.id, 2000);
        } else {
          db.saveTranscript({
            recordingId: rec.id,
            text: null,
            segments: null,
            language: null,
            status: 'failed',
            jobId: res.job_id ?? null,
          }).catch(() => {});
          setOne(rec.id, { status: 'failed', pct: null, error: 'transcription failed' });
          finishLater(rec.id, 3500);
        }
      } catch (e: any) {
        clearTimer(rec.id);
        db.saveTranscript({
          recordingId: rec.id,
          text: null,
          segments: null,
          language: null,
          status: 'failed',
          jobId: null,
        }).catch(() => {});
        setOne(rec.id, { status: 'failed', pct: null, error: String(e?.message ?? e) });
        finishLater(rec.id, 3500);
      }
    })();
  };

  const stateOf = (id?: string): TransUiState | undefined => (id ? states[id] : undefined);

  // wznów przerwane transkrypcje (status processing/pending) po wczytaniu nagrań — raz na sesję
  useEffect(() => {
    if (resumedRef.current || store.recordings.length === 0) return;
    resumedRef.current = true;
    (async () => {
      try {
        const ids = await db.getResumableTranscriptions();
        for (const id of ids) {
          const rec = store.recordings.find((r) => r.id === id);
          if (!rec?.uri || rec.transcribed) continue;
          // wznawiaj TYM SAMYM silnikiem, którym zaczęliśmy — inaczej notatka zaczęta jako
          // `advanced` dokończyłaby się starym modelem (bez rozmówców) po restarcie apki
          const prev = await db.getTranscript(id).catch(() => null);
          start(rec, { language: prev?.language ?? undefined, engine: prev?.engine ?? undefined });
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.recordings]);

  // sprzątanie timerów przy odmontowaniu
  useEffect(
    () => () => {
      Object.keys(timers.current).forEach((id) => clearTimer(id));
    },
    []
  );

  /** Ile razy transkrypt nagrania został zapisany — zależność do przeładowania widoku. */
  const revOf = (id?: string) => (id ? revs[id] ?? 0 : 0);

  return { start, stateOf, states, revOf };
}

export type TranscriptionStore = ReturnType<typeof useTranscription>;
