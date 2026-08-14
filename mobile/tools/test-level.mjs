/**
 * Testy adaptacyjnego skalowania poziomu (src/lib/level.ts).
 *
 *   npx tsc src/lib/level.ts --ignoreConfig --outDir /tmp/rec_ai_test --module esnext --target es2022
 *   node tools/test-level.mjs
 */
import { createLevelScaler, percentile } from '/tmp/rec_ai_test/level.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
  }
};

// stara formuła — dla porównania, to ją naprawiamy
const oldLevel = (db) => Math.max(0, Math.min(1, Math.max(0, Math.min(1, (db + 50) / 50)) * 1.7));

const feed = (scaler, dbs) => dbs.map((d) => scaler.push(d));
const last = (scaler, dbs) => feed(scaler, dbs).at(-1);

console.log('percentile');
ok('mediana', percentile([1, 2, 3, 4, 5], 0.5) === 3);
ok('dolny percentyl', percentile([1, 2, 3, 4, 5], 0) === 1);
ok('górny percentyl', percentile([1, 2, 3, 4, 5], 1) === 5);
ok('pusta tablica nie wywala', percentile([], 0.5) === 0);

console.log('diagnoza starej formuły (to naprawiamy)');
ok('stara: -20 dBFS już na suficie', oldLevel(-20) >= 1, `-20 → ${oldLevel(-20)}`);
ok('stara: -10 dBFS też sufit', oldLevel(-10) >= 1);
ok('stara: -6 dBFS też sufit', oldLevel(-6) >= 1);
ok(
  'stara: cały zakres mowy -20…-6 to JEDNA wartość (brak gradacji)',
  oldLevel(-20) === oldLevel(-6)
);

console.log('nowa: mowa w zakresie -20…-6 daje RÓŻNE wysokości');
{
  // realistyczne wejście: mowa oscylująca między -28 a -8 dBFS
  const s = createLevelScaler();
  const speech = [];
  for (let i = 0; i < 60; i++) speech.push(-28 + 20 * Math.abs(Math.sin(i / 3)));
  feed(s, speech);
  const quiet = s.push(-20);
  const loud = s.push(-8);
  ok('cichsza próbka niższa niż głośniejsza', quiet < loud, `-20 → ${quiet?.toFixed(2)}, -8 → ${loud?.toFixed(2)}`);
  ok('cichsza NIE jest już na suficie', quiet < 0.95, `-20 → ${quiet?.toFixed(2)}`);
  ok('różnica jest wyraźna (>0.2)', loud - quiet > 0.2, `Δ=${(loud - quiet).toFixed(2)}`);
}

console.log('nowa: gradacja przy CICHEJ mowie (stara formuła spłaszczała ją przy dnie)');
{
  const s = createLevelScaler();
  const quietSpeech = [];
  for (let i = 0; i < 60; i++) quietSpeech.push(-40 + 8 * Math.abs(Math.sin(i / 3)));
  feed(s, quietSpeech);
  const lo = s.push(-40);
  const hi = s.push(-32);
  ok('skala dopasowuje się do cichej mowy', hi - lo > 0.3, `-40 → ${lo?.toFixed(2)}, -32 → ${hi?.toFixed(2)}`);
  ok('głośniejszy fragment wyraźnie wysoki', hi > 0.6, `${hi?.toFixed(2)}`);
}

console.log('cisza NIE może wyglądać jak mowa (najważniejsze zabezpieczenie adaptacji)');
{
  const s = createLevelScaler();
  const roomTone = Array.from({ length: 60 }, (_, i) => -54 + (i % 3)); // szum pokoju
  const out = feed(s, roomTone).slice(-20);
  ok('szum pokoju zostaje nisko', Math.max(...out) < 0.2, `max=${Math.max(...out).toFixed(2)}`);
  ok('i nie jest wyzerowany do martwego zera', Math.max(...out) > 0, `max=${Math.max(...out).toFixed(3)}`);
}

console.log('po GŁOŚNYM fragmencie cicha mowa musi być widoczna OD RAZU');
{
  // Regresja: przy minSpanDb=12 dno lądowało tuż pod sufitem, cicha mowa wypadała POD skalą
  // i słupki stały na dokładnym zerze przez ~4 s (do wyjścia głośnych próbek z okna).
  const s = createLevelScaler();
  feed(s, Array(80).fill(-10)); // głośny fragment
  const first = s.push(-32); // natychmiast po nim cicha mowa
  ok('nie zapada się do zera', first > 0.05, `pierwsza próbka po głośnym → ${(first * 100).toFixed(0)}%`);
  const afterSecond = feed(s, Array(11).fill(-32)).at(-1);
  ok('i nie znika przez kolejną sekundę', afterSecond > 0.05, `po 1 s → ${(afterSecond * 100).toFixed(0)}%`);
  const recovered = feed(s, Array(60).fill(-32)).at(-1);
  ok('a po kilku sekundach wraca do pełnej skali', recovered > 0.8, `po ~6 s → ${(recovered * 100).toFixed(0)}%`);
}

console.log('odporność na pojedynczy trzask (dlatego percentyl, nie max)');
{
  const s = createLevelScaler();
  const speech = Array.from({ length: 60 }, (_, i) => -25 + 6 * Math.sin(i / 2));
  feed(s, speech);
  const before = s.push(-20);
  s.push(0); // jeden trzask na 0 dBFS
  const after = s.push(-20);
  ok('trzask nie zapada reszty skali', after > before * 0.5, `przed ${before?.toFixed(2)}, po ${after?.toFixed(2)}`);
}

console.log('sufit rośnie szybko, opada wolno');
{
  const s = createLevelScaler();
  feed(s, Array(40).fill(-40));
  const quietCeil = s.range().ceiling;
  feed(s, Array(5).fill(-6));
  ok('głośne wejście szybko podnosi sufit', s.range().ceiling > quietCeil + 10, `${quietCeil.toFixed(1)} → ${s.range().ceiling.toFixed(1)}`);
  const loudCeil = s.range().ceiling;
  feed(s, Array(5).fill(-40));
  ok('ale nie opada skokowo', s.range().ceiling > loudCeil - 10, `${loudCeil.toFixed(1)} → ${s.range().ceiling.toFixed(1)}`);
}

console.log('przypadki brzegowe');
{
  const s = createLevelScaler();
  ok('null przechodzi jako null', s.push(null) === null);
  ok('undefined przechodzi jako null', s.push(undefined) === null);
  ok('NaN przechodzi jako null', s.push(NaN) === null);
  ok('-Infinity (cisza absolutna) nie wywala', s.push(-Infinity) === null);
  const s2 = createLevelScaler();
  const v = s2.push(-30);
  ok('pierwsza próbka daje sensowną wartość 0..1', v !== null && v >= 0 && v <= 1, `${v}`);
  s2.reset();
  ok('reset czyści skalę', s2.range().ceiling === 0);
}

console.log('wynik zawsze w 0..1');
{
  const s = createLevelScaler();
  const wild = [-60, 0, -30, -5, -55, -12, -60, 0, -25];
  const out = feed(s, wild.concat(wild, wild));
  ok('nic nie wychodzi poza zakres', out.every((v) => v === null || (v >= 0 && v <= 1)));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} zdane ${pass}, oblane ${fail}`);
process.exit(fail === 0 ? 0 : 1);
