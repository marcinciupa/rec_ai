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
import { speakerNumbers, spokenCutFromWords } from '/tmp/rec_ai_test/transcript.js';

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

console.log(`\n${fail === 0 ? '✅' : '❌'} zdane ${pass}, oblane ${fail}`);
process.exit(fail === 0 ? 0 : 1);
