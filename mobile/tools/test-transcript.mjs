/**
 * Testy czystej logiki widoku transkryptu (src/lib/transcript.ts).
 * Uruchomienie (dwie komendy — projekt nie ma runnera testów, a ta logika jest zbyt subtelna,
 * żeby sprawdzać ją „na oko" w emulatorze):
 *
 *   npx tsc src/lib/transcript.ts --ignoreConfig --outDir /tmp/rec_ai_test --module esnext --target es2022
 *   node tools/test-transcript.mjs
 *
 * Dane wejściowe w testach to PRAWDZIWA odpowiedź deAPI (WhisperLargeV3Ct2, diarize=true,
 * ts_level=word), nie zmyślony kształt.
 */
import { speakerNumbers, spokenCutFromWords, segmentStep, transcriptScrollY } from '/tmp/rec_ai_test/transcript.js';

let pass = 0;
let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    console.log(`  ✗ ${name}\n      dostałem: ${JSON.stringify(got)}\n      oczekiwane: ${JSON.stringify(want)}`);
  }
};

// ── Dane PRAWDZIWE: odpowiedź deAPI dla WhisperLargeV3Ct2 z diarize=true, ts_level=word ──
const TEXT = 'Artificial intelligence is revolutionizing various industries and daily life.';
const WORDS = [
  { word: 'Artificial', start: 0.491, end: 0.972, speaker: 'SPEAKER_00' },
  { word: 'intelligence', start: 1.072, end: 1.693, speaker: 'SPEAKER_00' },
  { word: 'is', start: 1.953, end: 2.013, speaker: 'SPEAKER_00' },
  { word: 'revolutionizing', start: 2.114, end: 2.975, speaker: 'SPEAKER_00' },
  { word: 'various', start: 3.095, end: 3.456, speaker: 'SPEAKER_00' },
  { word: 'industries', start: 3.556, end: 4.117, speaker: 'SPEAKER_00' },
  { word: 'and', start: 4.257, end: 4.397, speaker: 'SPEAKER_00' },
  { word: 'daily', start: 4.497, end: 4.798, speaker: 'SPEAKER_00' },
  { word: 'life.', start: 4.898, end: 5.62, speaker: 'SPEAKER_00' },
];

console.log('spokenCutFromWords — realne dane deAPI');
eq('przed pierwszym słowem nic nie jest jasne', spokenCutFromWords(TEXT, WORDS, 0), 0);
eq('w trakcie 1. słowa całe jest jasne', spokenCutFromWords(TEXT, WORDS, 0.6), 'Artificial'.length);
eq('między słowami — do końca poprzedniego', spokenCutFromWords(TEXT, WORDS, 1.9), 'Artificial intelligence'.length);
eq('po ostatnim słowie — cały tekst', spokenCutFromWords(TEXT, WORDS, 99), TEXT.length);
eq('cięcie zawsze wypada na granicy słowa', TEXT[spokenCutFromWords(TEXT, WORDS, 3.2)], ' ');

console.log('spokenCutFromWords — degradacja');
eq('brak słów → null (wołający użyje przybliżenia)', spokenCutFromWords(TEXT, null, 3), null);
eq('pusta lista → null', spokenCutFromWords(TEXT, [], 3), null);
eq(
  'słowa nie pasują do tekstu → null zamiast udawanej precyzji',
  spokenCutFromWords('Zupełnie inny tekst', WORDS, 99),
  null
);
eq(
  'rozjazd w połowie → zatrzymanie na ostatnim dopasowanym',
  spokenCutFromWords('Artificial intelligence CZEGOŚ BRAKUJE', WORDS, 99),
  'Artificial intelligence'.length
);
// powtórzone słowo: kursor musi iść do przodu, a nie łapać wciąż pierwszego wystąpienia
eq(
  'powtórzone słowo mapuje się na KOLEJNE wystąpienie',
  spokenCutFromWords('bardzo bardzo dobrze', [
    { word: 'bardzo', start: 0, end: 1 },
    { word: 'bardzo', start: 1, end: 2 },
    { word: 'dobrze', start: 2, end: 3 },
  ], 99),
  'bardzo bardzo dobrze'.length
);

console.log('speakerNumbers — numeracja wg kolejności wejścia');
eq(
  'pierwszy mówiący dostaje 1, nawet gdy to SPEAKER_01',
  [...speakerNumbers([{ speaker: 'SPEAKER_01' }, { speaker: 'SPEAKER_00' }]).entries()],
  [['SPEAKER_01', 1], ['SPEAKER_00', 2]]
);
eq(
  'ten sam mówca wraca z tym samym numerem',
  [...speakerNumbers([
    { speaker: 'SPEAKER_00' }, { speaker: 'SPEAKER_01' }, { speaker: 'SPEAKER_00' }, { speaker: 'SPEAKER_02' },
  ]).entries()],
  [['SPEAKER_00', 1], ['SPEAKER_01', 2], ['SPEAKER_02', 3]]
);
eq('brak diaryzacji → pusta mapa (widok chowa kolumnę)', speakerNumbers([{}, {}]).size, 0);
eq('jeden mówca → 1 pozycja, czyli poniżej progu 2 → kolumna schowana', speakerNumbers([{ speaker: 'SPEAKER_00' }]).size, 1);

console.log('segmentStep — joystick ↑↓ w playerze: najpierw fragmenty, potem nagrania');
// null = „nie ma dokąd" → dopiero to pozwala wołającemu zmienić nagranie
const ST = [0, 5, 12, 20];
eq('w połowie 1. fragmentu, w przód → początek 2.', segmentStep(ST, 2, 1), 5);
eq('dokładnie na starcie fragmentu, w przód → następny', segmentStep(ST, 12, 1), 20);
eq('na OSTATNIM fragmencie, w przód → null (koniec treści)', segmentStep(ST, 21, 1), null);
eq('tuż przed końcem ostatniego → też null', segmentStep(ST, 20, 1), null);
eq('głęboko w fragmencie, w tył → restart bieżącego (jak w odtwarzaczu CD)', segmentStep(ST, 15.5, -1), 12);
eq('płytko w fragmencie, w tył → poprzedni', segmentStep(ST, 13, -1), 12 - 7);
eq('na PIERWSZYM fragmencie, płytko, w tył → null (początek treści)', segmentStep(ST, 1, -1), null);
eq('na pierwszym, ale głęboko → restart, nie zmiana nagrania', segmentStep(ST, 4, -1), 0);
eq('pozycja przed pierwszym startem → traktowana jak pierwszy fragment', segmentStep([3, 9], 0, -1), null);
eq('tolerancja 50 ms na starcie fragmentu', segmentStep(ST, 4.97, 1), 12);
eq('brak segmentów → null', segmentStep([], 5, 1), null);
eq('jeden fragment → w obie strony null', [segmentStep([0], 0.5, 1), segmentStep([0], 0.5, -1)], [null, null]);

console.log('transcriptScrollY — blok przy górnej krawędzi + 2 wiersze zapasu pod karaoke');
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
  }
};
const LH = 27; // lineHeight monoBody (18 × 1.5)
const VP = 300; // wysokość szyby transkryptu
const base = { lineHeight: LH, viewportH: VP, maxScroll: 2000 };
// blok mieszczący się w szybie: przypięty do góry przez CAŁY czas jego trwania
eq('krótki blok na starcie → przypięty do góry', transcriptScrollY({ ...base, rowTop: 400, rowHeight: 100, spokenFrac: 0 }), 400);
eq('krótki blok pod koniec → nadal przypięty (zapas i tak się mieści)', transcriptScrollY({ ...base, rowTop: 400, rowHeight: 100, spokenFrac: 1 }), 400);
// blok WYŻSZY niż szyba: początek przypięty, potem przesuwa się tylko o tyle, ile trzeba
eq('wysoki blok na starcie → też przypięty', transcriptScrollY({ ...base, rowTop: 400, rowHeight: 600, spokenFrac: 0 }), 400);
const mid = transcriptScrollY({ ...base, rowTop: 400, rowHeight: 600, spokenFrac: 0.8 });
ok('wysoki blok w trakcie → przewinięty poniżej swojego początku', mid > 400, `dostałem ${mid}`);
ok(
  'pod wypowiadanym wierszem zostają dokładnie 2 wiersze zapasu',
  Math.abs((400 + 600 * 0.8 + LH) - (mid + VP - 2 * LH)) < 0.001,
  `spokenBottom=${400 + 600 * 0.8 + LH}, dolna krawędź zapasu=${mid + VP - 2 * LH}`
);
// następny blok = nowy rowTop → skok na górę, bez pamięci o poprzednim
eq('kolejny blok wskakuje na górę', transcriptScrollY({ ...base, rowTop: 1000, rowHeight: 120, spokenFrac: 0 }), 1000);
// ograniczenia
eq('nie przewijamy powyżej zera', transcriptScrollY({ ...base, rowTop: 0, rowHeight: 40, spokenFrac: 0 }), 0);
eq('nie przewijamy poniżej końca treści', transcriptScrollY({ ...base, rowTop: 5000, rowHeight: 100, spokenFrac: 1, maxScroll: 900 }), 900);
eq('padTop odsuwa blok od krawędzi', transcriptScrollY({ ...base, rowTop: 400, rowHeight: 100, spokenFrac: 0, padTop: 8 }), 392);
eq('spareLines konfigurowalne', transcriptScrollY({ ...base, rowTop: 400, rowHeight: 600, spokenFrac: 1, spareLines: 0 }), 400 + 600 + LH - VP);
eq('ułamek poza zakresem jest przycinany', transcriptScrollY({ ...base, rowTop: 400, rowHeight: 600, spokenFrac: 5 }), transcriptScrollY({ ...base, rowTop: 400, rowHeight: 600, spokenFrac: 1 }));

console.log(`\n${fail === 0 ? '✅' : '❌'} zdane ${pass}, oblane ${fail}`);
process.exit(fail === 0 ? 0 : 1);
