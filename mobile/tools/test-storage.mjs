/**
 * Testy formatowania etykiety wolnego miejsca (src/lib/storage.ts).
 *
 *   npx tsc src/lib/storage.ts --ignoreConfig --outDir /tmp/rec_ai_test --module esnext --target es2022
 *   node tools/test-storage.mjs
 */
import { storageLabel, formatBytes, formatDuration, REC_BITRATE } from '/tmp/rec_ai_test/storage.js';

let pass = 0;
let fail = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.log(`  ✗ ${name}\n      dostałem: ${JSON.stringify(got)}\n      oczekiwane: ${JSON.stringify(want)}`);
  }
};

console.log('formatBytes');
eq('32.3 GB', formatBytes(32.3e9), '32.3GB');
eq('okrągłe 64 GB', formatBytes(64e9), '64.0GB');
eq('poniżej GB → MB', formatBytes(870e6), '870MB');
eq('zero', formatBytes(0), '0MB');

console.log('formatDuration');
eq('godziny', formatDuration(3600 * 373.8), '~374h');
eq('dokładnie godzina', formatDuration(3600), '~1h');
eq('poniżej godziny → minuty', formatDuration(2700), '~45min');
eq('poniżej minuty', formatDuration(20), '<1min');

console.log('storageLabel — spójność z bitrate z useAudioCapture');
// 32.3 GB przy 192 kbps: 32.3e9 / (192000/8) = 1 345 833 s = 373.8 h
eq('HIGH (192 kbps)', storageLabel(32.3e9, 'HIGH'), '~374h/32.3GB AVAILABLE');
// ten sam dysk przy 64 kbps mieści 3× więcej
eq('LOW (64 kbps) — 3× dłużej', storageLabel(32.3e9, 'LOW'), '~1122h/32.3GB AVAILABLE');
eq(
  'LOW to dokładnie 3× HIGH',
  REC_BITRATE.HIGH / REC_BITRATE.LOW,
  3
);

console.log('storageLabel — degradacja (NIE zmyślamy liczby)');
eq('null → null', storageLabel(null, 'HIGH'), null);
eq('NaN → null', storageLabel(NaN, 'HIGH'), null);
eq('Infinity → null', storageLabel(Infinity, 'HIGH'), null);
eq('wartość ujemna → null', storageLabel(-1, 'HIGH'), null);
eq('dysk pełny (0 bajtów) → etykieta, nie null', storageLabel(0, 'HIGH'), '<1min/0MB AVAILABLE');

console.log(`\n${fail === 0 ? '✅' : '❌'} zdane ${pass}, oblane ${fail}`);
process.exit(fail === 0 ? 0 : 1);
