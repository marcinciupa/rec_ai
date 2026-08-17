/**
 * Testy rozdzielania mówców z treści (src/lib/speakerSplit.ts + wspólna maszyneria transcriptRows.ts).
 *
 *   npx tsc src/lib/speakerSplit.ts src/lib/segmentSplit.ts --ignoreConfig --outDir /tmp/rec_ai_test --module esnext --target es2022
 *   sed -i "s#from './\\([a-zA-Z]*\\)'#from './\\1.js'#g" /tmp/rec_ai_test/*.js   # tsc nie dopisuje rozszerzeń, node ESM ich wymaga
 *   node tools/test-speaker-split.mjs
 *
 * Najważniejsze, czego pilnują: suma fragmentów = DOKŁADNIE oryginalny tekst, a każdy fragment
 * niesie prawdziwy czas ze słów. Gdyby to puściło, seek i karaoke pokazywałyby nie to miejsce.
 */
import { buildChunks, chunkPrompt, placeWords, snapSpeakersToSentences } from '/tmp/rec_ai_test/transcriptRows.js';
import { needsSpeakerSplit, applySpeakerTurns, speakerId, turnsToSpeakers, splitByWordSpeakers } from '/tmp/rec_ai_test/speakerSplit.js';
import { matchAnchor } from '/tmp/rec_ai_test/transcriptRows.js';

let pass = 0;
let fail = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.log(`  ✗ ${name}\n      dostałem: ${JSON.stringify(got)}\n      oczekiwane: ${JSON.stringify(want)}`);
  }
};
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
  }
};

/** Buduje segment z listy [słowo, start, end] — tekst sklejany spacjami, jak w odpowiedzi deAPI. */
const seg = (triples, speaker = 'SPEAKER_00') => ({
  start: triples[0][1],
  end: triples[triples.length - 1][2],
  text: triples.map((t) => t[0]).join(' '),
  speaker,
  words: triples.map(([word, start, end]) => ({ word, start, end, speaker })),
});

// ── Rozmowa dwóch osób, którą diaryzacja zlepiła w jednego SPEAKER_00 (realny objaw z produkcji) ──
const DIALOG = seg([
  ['Cześć,', 0.5, 0.9],
  ['jak', 1.0, 1.2],
  ['leci?', 1.2, 1.6],
  ['Dobrze,', 2.4, 2.9], // 0,8 s pauzy → granica tury
  ['dziękuję.', 3.0, 3.6],
]);

console.log('placeWords');
eq('mapuje każde słowo na pozycję w tekście', placeWords(DIALOG.text, DIALOG.words).map((p) => p.at), [0, 7, 11, 17, 25]);
eq('brak słów → null', placeWords(DIALOG.text, null), null);
eq('rozjazd słów z tekstem → null (nie mapujemy połowicznie)', placeWords('Zupełnie co innego', DIALOG.words), null);

console.log('buildChunks — gdzie tnie');
const chunks = buildChunks([DIALOG]);
eq('koniec zdania + pauza dały 2 fragmenty', chunks.length, 2);
eq('fragment 1', chunks[0].text, 'Cześć, jak leci?');
eq('fragment 2 (od spacji po znaku zapytania)', chunks[1].text, ' Dobrze, dziękuję.');
eq('czasy fragmentu 1 ze słów', [chunks[0].start, chunks[0].end], [0.5, 1.6]);
eq('czasy fragmentu 2 ze słów', [chunks[1].start, chunks[1].end], [2.4, 3.6]);
ok(
  'suma fragmentów = dokładnie oryginalny tekst',
  chunks.map((c) => c.text).join('') === DIALOG.text,
  `sklejone: ${JSON.stringify(chunks.map((c) => c.text).join(''))}`
);
ok('fragmenty stykają się bez luk', chunks.every((c, i) => (i === 0 ? c.from === 0 : c.from === chunks[i - 1].to)));

console.log('buildChunks — degradacja i limity');
const noWords = { start: 0, end: 5, text: 'Tekst bez słów.', speaker: null, words: null };
eq('segment bez słów → jeden fragment (da się oznaczyć, nie da się rozciąć)', buildChunks([noWords]).length, 1);
eq('pusty segment pomijany', buildChunks([{ start: 0, end: 1, text: '   ', words: [] }]).length, 0);
const long = seg(Array.from({ length: 120 }, (_, i) => [`s${i}`, i * 0.2, i * 0.2 + 0.15]));
ok('limit maxWords tnie monolog bez interpunkcji', buildChunks([long]).length >= 5);
ok('sufit maxChunks respektowany', buildChunks([long], { maxWords: 1, maxChunks: 10 }).length <= 10);
ok(
  'po scaleniu do sufitu tekst nadal się zgadza',
  buildChunks([long], { maxWords: 1, maxChunks: 10 })
    .map((c) => c.text)
    .join('') === long.text
);
// krótka tura MUSI zostać osobnym fragmentem — to najczystszy sygnał zmiany mówcy, jaki mamy
const short = seg([
  ['Aha.', 0, 0.3],
  ['No', 1.5, 1.7],
  ['dobrze,', 1.7, 2.1],
  ['zaczynajmy', 2.2, 2.9],
  ['spotkanie.', 3.0, 3.6],
]);
eq('jednosłowna tura nie jest doklejana do sąsiada', buildChunks([short]).length, 2);
eq('…i to ona jest pierwszym fragmentem', buildChunks([short])[0].text, 'Aha.');

console.log('chunkPrompt');
eq('ponumerowane wiersze, białe znaki zwinięte', chunkPrompt(chunks), '1. Cześć, jak leci?\n2. Dobrze, dziękuję.');

console.log('needsSpeakerSplit — kiedy w ogóle próbować');
eq('jeden mówca + słowa → tak', needsSpeakerSplit([DIALOG]), true);
eq('diaryzacja rozdzieliła (≥2) → nie poprawiamy jej', needsSpeakerSplit([DIALOG, { ...DIALOG, speaker: 'SPEAKER_01' }]), false);
eq('brak słów → nie (nie ma prawdziwych czasów cięcia)', needsSpeakerSplit([noWords]), false);
eq('brak segmentów → nie', needsSpeakerSplit(null), false);

console.log('snapSpeakersToSentences — korekta SPÓŹNIENIA diaryzacji');
// PRZYPADEK Z REALNEGO NAGRANIA (zgłoszony przez użytkownika): druga osoba wchodzi bez pauzy,
// więc deAPI przełącza etykietę dopiero po dwóch jej słowach („No bo").
const late = (spk) => (w, i) => ({ word: w, start: 123.0 + i * 0.2, end: 123.15 + i * 0.2, speaker: spk[i] });
const LATE_WORDS = ['Na', 'swojej', 'spotkaniu.', 'No', 'bo', 'jeszcze', 'jest', 'tak,'].map(
  late(['SPEAKER_01', 'SPEAKER_01', 'SPEAKER_01', 'SPEAKER_01', 'SPEAKER_01', 'SPEAKER_00', 'SPEAKER_00', 'SPEAKER_00'])
);
const LATE = { start: 123.0, end: 124.6, text: 'Na swojej spotkaniu. No bo jeszcze jest tak,', speaker: 'SPEAKER_01', words: LATE_WORDS };
const fixed = snapSpeakersToSentences([LATE])[0];
eq(
  'granica przesunięta na koniec zdania — „No bo" wraca do drugiej osoby',
  fixed.words.map((w) => w.speaker.slice(-2)),
  ['01', '01', '01', '00', '00', '00', '00', '00']
);
ok('tekst segmentu nietknięty', fixed.text === LATE.text);
ok('słowa i czasy nietknięte', fixed.words.map((w) => `${w.word}@${w.start}`).join('|') === LATE_WORDS.map((w) => `${w.word}@${w.start}`).join('|'));
const rowsLate = splitByWordSpeakers([fixed], buildChunks([fixed]));
eq('po korekcie wiersze łamią się we właściwym miejscu', rowsLate.map((r) => r.text.trim()), ['Na swojej spotkaniu.', 'No bo jeszcze jest tak,']);

// zmiana w ŚRODKU zdania (realne wejście w słowo) — nie ma czego przyciągać, zostaje jak było
const MID_WORDS = ['ale', 'oni', 'zagrają', 'z', 'Legacy,', 'jeżeli', 'ktoś'].map(
  late(['SPEAKER_01', 'SPEAKER_01', 'SPEAKER_01', 'SPEAKER_01', 'SPEAKER_00', 'SPEAKER_00', 'SPEAKER_00'])
);
const MID = { start: 123.0, end: 124.4, text: 'ale oni zagrają z Legacy, jeżeli ktoś', speaker: 'SPEAKER_01', words: MID_WORDS };
eq('brak końca zdania w oknie → etykiety bez zmian', snapSpeakersToSentences([MID])[0].words.map((w) => w.speaker), MID_WORDS.map((w) => w.speaker));

// koniec zdania DALEJ niż okno → też bez zmian (korygujemy spóźnienie, nie przenosimy granic)
const FAR_WORDS = ['koniec.', 'raz', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć'].map(
  late(['SPEAKER_01', 'SPEAKER_01', 'SPEAKER_01', 'SPEAKER_01', 'SPEAKER_01', 'SPEAKER_00', 'SPEAKER_00'])
);
const FAR = { start: 123.0, end: 124.4, text: 'koniec. raz dwa trzy cztery pięć sześć', speaker: 'SPEAKER_01', words: FAR_WORDS };
eq('koniec zdania poza oknem → bez zmian', snapSpeakersToSentences([FAR])[0].words.map((w) => w.speaker), FAR_WORDS.map((w) => w.speaker));
eq('segmenty bez słów przechodzą bez zmian', snapSpeakersToSentences([{ start: 0, end: 1, text: 'x', words: null }])[0].words, null);

console.log('splitByWordSpeakers — cięcie tam, gdzie deAPI zmienia mówcę PRZY SŁOWIE');
// Kształt z realnego nagrania: segment ma JEDNĄ etykietę zbiorczą, a słowa w środku należą do dwóch osób.
const mixWords = [
  { word: 'Pewnie', start: 51.1, end: 51.5, speaker: 'SPEAKER_00' },
  { word: 'faworyt', start: 51.6, end: 52.0, speaker: 'SPEAKER_00' },
  { word: 'jest.', start: 52.1, end: 52.6, speaker: 'SPEAKER_00' },
  { word: 'A', start: 59.8, end: 59.9, speaker: 'SPEAKER_01' },
  { word: 'jeżeli', start: 60.0, end: 60.4, speaker: 'SPEAKER_01' },
  { word: 'drużyna', start: 60.5, end: 61.0, speaker: 'SPEAKER_01' },
];
const MIX = { start: 51.1, end: 61.0, text: 'Pewnie faworyt jest. A jeżeli drużyna', speaker: 'SPEAKER_01', words: mixWords };
const mixRows = splitByWordSpeakers([MIX], buildChunks([MIX]));
eq('segment rozcięty na dwa wiersze', mixRows.length, 2);
eq('etykiety wg SŁÓW, nie wg etykiety zbiorczej segmentu', mixRows.map((r) => r.speaker), ['SPEAKER_00', 'SPEAKER_01']);
eq('granica dokładnie tam, gdzie zaczyna druga osoba', mixRows[1].start, 59.8);
eq('teksty', mixRows.map((r) => r.text.trim()), ['Pewnie faworyt jest.', 'A jeżeli drużyna']);
ok('tekst 1:1', mixRows.map((r) => r.text).join('') === MIX.text);
ok('żaden wiersz nie miesza mówców', mixRows.every((r) => new Set(r.words.map((w) => w.speaker)).size === 1));
eq('żadne słowo nie zginęło', mixRows.reduce((n, r) => n + r.words.length, 0), mixWords.length);
// zero roboty tam, gdzie etykiety słów zgadzają się z segmentem
const clean = { ...MIX, text: 'Pewnie faworyt jest.', words: mixWords.slice(0, 3), speaker: 'SPEAKER_00', end: 52.6 };
eq('spójny segment → null (nic do poprawiania)', splitByWordSpeakers([clean], buildChunks([clean])), null);
const noSpk = { start: 0, end: 3, text: 'Bez etykiet w słowach.', speaker: null, words: [{ word: 'Bez', start: 0, end: 0.4 }, { word: 'etykiet', start: 0.5, end: 1.0 }, { word: 'w', start: 1.1, end: 1.2 }, { word: 'słowach.', start: 1.3, end: 2.0 }] };
eq('słowa bez etykiet → null', splitByWordSpeakers([noSpk], buildChunks([noSpk])), null);
// sufit fragmentów NIE MOŻE scalać przez granicę mówcy — inaczej po cichu wraca naprawiany błąd
const capped = buildChunks([MIX], { maxChunks: 1 });
ok('scalanie do sufitu nie łączy różnych mówców', capped.every((c) => new Set(c.words.map((w) => w.speaker)).size === 1), JSON.stringify(capped.map((c) => c.speaker)));

console.log('turnsToSpeakers — tury z cytatem zamiast tablicy N liczb');
// realny kształt rozmowy: 4 fragmenty, zmiana mówcy przy trzecim
const DIAL4 = seg([
  ['Cześć,', 0.5, 0.9], ['jak', 1.0, 1.2], ['leci?', 1.2, 1.6],
  ['Wszystko', 2.4, 2.9], ['dobrze.', 3.0, 3.6],
  ['A', 4.6, 4.8], ['u', 4.9, 5.0], ['ciebie?', 5.1, 5.6],
]);
const c4 = buildChunks([DIAL4]);
eq('fragmentów', c4.length, 3);
eq(
  'poprawne tury → mówca na każdy fragment',
  turnsToSpeakers(c4, [{ from: 1, quote: 'Cześć jak leci', speaker: 1 }, { from: 2, quote: 'Wszystko dobrze', speaker: 2 }]),
  [1, 2, 2]
);
// ⬇ OBJAW ZGŁOSZONY PRZEZ UŻYTKOWNIKA: model wskazuje granicę o jeden fragment za wcześnie,
//   ale cytat wskazuje właściwe miejsce → korygujemy numer, granica ląduje tam, gdzie trzeba.
eq(
  'numer o jeden za mały, cytat prawidłowy → granica skorygowana',
  turnsToSpeakers(c4, [{ from: 1, quote: 'Cześć jak leci', speaker: 1 }, { from: 1, quote: 'Wszystko dobrze', speaker: 2 }]),
  [1, 2, 2]
);
eq(
  'numer o jeden za duży, cytat prawidłowy → też skorygowany',
  turnsToSpeakers(c4, [{ from: 1, quote: 'Cześć jak leci', speaker: 1 }, { from: 3, quote: 'Wszystko dobrze', speaker: 2 }]),
  [1, 2, 2]
);
eq(
  'cytat z inną interpunkcją i wielkością liter nadal trafia',
  turnsToSpeakers(c4, [{ from: 1, quote: 'cześć, JAK', speaker: 1 }, { from: 1, quote: '  wszystko, dobrze!  ', speaker: 2 }]),
  [1, 2, 2]
);
eq(
  'bez cytatu zostaje sam numer (podpowiedź modelu)',
  turnsToSpeakers(c4, [{ from: 1, speaker: 1 }, { from: 3, speaker: 2 }]),
  [1, 1, 2]
);
eq('brak tur → null', turnsToSpeakers(c4, []), null);
eq('nie-tablica → null', turnsToSpeakers(c4, { from: 1 }), null);
eq('same śmieci → null', turnsToSpeakers(c4, [{ from: 'x', speaker: null }, 42, 'nope']), null);
eq('jedna tura = monolog → null (nie ruszamy segmentów)', turnsToSpeakers(c4, [{ from: 1, speaker: 1 }]), null);
eq('absurdalny numer mówcy pomijany → zostaje monolog → null', turnsToSpeakers(c4, [{ from: 1, speaker: 1 }, { from: 2, speaker: 99 }]), null);
eq('tury podane w złej kolejności są sortowane', turnsToSpeakers(c4, [{ from: 3, speaker: 2 }, { from: 1, speaker: 1 }]), [1, 1, 2]);

console.log('matchAnchor — cytat rozstrzyga, numer jest podpowiedzią');
eq('trafiony numer + zgodny cytat', matchAnchor(c4, 1, 'Wszystko dobrze'), 1);
eq('cytat wygrywa z numerem', matchAnchor(c4, 0, 'Wszystko dobrze'), 1);
eq('cytat spoza tekstu → zostaje numer', matchAnchor(c4, 2, 'zupełnie czegoś innego'), 2);
eq('numer poza zakresem i brak cytatu → null', matchAnchor(c4, 99, null), null);
eq('cytat poza oknem szukania → zostaje numer', matchAnchor(c4, 0, 'A u ciebie', 0), 0);

console.log('applySpeakerTurns — składanie segmentów');
const split = applySpeakerTurns([DIALOG], chunks, [1, 2]);
eq('dwa segmenty po jednym mówcy', split.length, 2);
eq('etykiety w konwencji deAPI', [split[0].speaker, split[1].speaker], ['SPEAKER_00', 'SPEAKER_01']);
eq('teksty', [split[0].text, split[1].text], ['Cześć, jak leci?', ' Dobrze, dziękuję.']);
eq('czasy pierwszego z segmentu/słów', [split[0].start, split[0].end], [0.5, 1.6]);
eq('czasy drugiego ze słów (prawdziwe, nie zgadnięte)', [split[1].start, split[1].end], [2.4, 3.6]);
eq('słowa rozdzielone między segmenty', [split[0].words.length, split[1].words.length], [3, 2]);
eq('słowa dostają etykietę swojego mówcy', split[1].words.map((w) => w.speaker), ['SPEAKER_01', 'SPEAKER_01']);
ok('sklejony tekst segmentów = oryginał', split.map((s) => s.text).join('') === DIALOG.text);

console.log('applySpeakerTurns — odrzucenia (zostaje stan sprzed próby)');
eq('monolog (same jedynki) → null, nie ruszamy segmentów', applySpeakerTurns([DIALOG], chunks, [1, 1]), null);
eq('za mało liczb → null', applySpeakerTurns([DIALOG], chunks, [1]), null);
eq('za dużo liczb → null', applySpeakerTurns([DIALOG], chunks, [1, 2, 1]), null);
eq('numer 0 → null (numerujemy od 1)', applySpeakerTurns([DIALOG], chunks, [0, 1]), null);
eq('nie-liczba → null', applySpeakerTurns([DIALOG], chunks, [1, NaN]), null);
eq('absurdalna liczba mówców → null', applySpeakerTurns([DIALOG], chunks, [1, 99]), null);

console.log('applySpeakerTurns — zmiana mówcy na granicy segmentów');
const A = seg([['Pierwszy', 0, 0.5], ['segment', 0.6, 1.0]]);
const B = seg([['Drugi', 2.0, 2.4], ['segment', 2.5, 3.0]]);
const ab = buildChunks([A, B]);
const abSplit = applySpeakerTurns([A, B], ab, ab.map((c) => c.seg + 1));
eq('każdy segment zostaje jednym wierszem', abSplit.length, 2);
eq('zachowane oryginalne czasy segmentów (kawałek = cały segment)', [abSplit[0].start, abSplit[0].end], [A.start, A.end]);
eq('teksty nietknięte', [abSplit[0].text, abSplit[1].text], [A.text, B.text]);

// ── NAJWAŻNIEJSZA WŁASNOŚĆ: cokolwiek odpowie model, tekst ma zostać 1:1 ze źródłem ──
// Model oddaje wyłącznie liczby, ale kolejność i grupowanie tych liczb decyduje o tym, GDZIE tniemy.
// Losujemy setki przypisań (w tym absurdalne) i za każdym razem żądamy: sklejone segmenty = oryginał,
// żadne słowo nie zniknęło, nie zdublowało się ani nie zmieniło pisowni.
console.log('własność: LLM nie jest w stanie zmienić tekstu');
let seed = 20260814;
const rnd = (n) => ((seed = (seed * 48271) % 2147483647) % n); // Lehmer, deterministycznie i bez utraty bitów
const CORPUS = [
  seg([['Cześć,', 0.2, 0.6], ['co', 0.7, 0.9], ['słychać?', 0.9, 1.4], ['Wszystko', 2.3, 2.8], ['dobrze.', 2.9, 3.4]]),
  seg([['Mam', 3.9, 4.1], ['pytanie', 4.2, 4.7], ['o', 4.8, 4.9], ['tę', 5.0, 5.2], ['fakturę.', 5.3, 5.9]]),
  seg([['Która', 7.0, 7.4], ['dokładnie?', 7.5, 8.1], ['Ta', 9.0, 9.2], ['z', 9.3, 9.4], ['marca.', 9.5, 10.0]]),
  { start: 11.0, end: 12.0, text: 'Segment bez słów — też musi przeżyć.', speaker: 'SPEAKER_00', words: null },
];
const originalText = CORPUS.map((s) => s.text).join('');
const originalWords = CORPUS.flatMap((s) => (s.words ?? []).map((w) => w.word)).join('|');
const fuzz = buildChunks(CORPUS);
let identical = 0;
let rejected = 0;
let broken = 0;
for (let round = 0; round < 500; round++) {
  const speakers = fuzz.map(() => 1 + rnd(4)); // od monologu po cztery osoby, w losowych układach
  const got = applySpeakerTurns(CORPUS, fuzz, speakers);
  if (!got) {
    rejected++;
    continue;
  }
  const text = got.map((s) => s.text).join('');
  const words = got.flatMap((s) => (s.words ?? []).map((w) => w.word)).join('|');
  if (text !== originalText || words !== originalWords) {
    broken++;
    if (broken === 1) console.log(`      pierwszy rozjazd przy ${JSON.stringify(speakers)}\n      ${JSON.stringify(text)}`);
  } else identical++;
}
console.log(`  (500 losowych odpowiedzi modelu: ${identical} × tekst 1:1, ${rejected} × odrzucone, ${broken} × rozjazd)`);
ok('żadna odpowiedź modelu nie zmieniła tekstu', broken === 0);
ok('losowanie objęło też przypadki przyjęte (nie wszystko odrzucone)', identical > 100, `przyjętych: ${identical}`);

console.log('speakerId');
eq('1 → SPEAKER_00', speakerId(1), 'SPEAKER_00');
eq('3 → SPEAKER_02', speakerId(3), 'SPEAKER_02');

console.log(`\n${pass} przeszło, ${fail} nie przeszło`);
process.exit(fail ? 1 : 0);
