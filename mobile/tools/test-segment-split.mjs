/**
 * Testy podziału długich segmentów na wiersze (src/lib/segmentSplit.ts).
 *
 *   npx tsc src/lib/speakerSplit.ts src/lib/segmentSplit.ts --ignoreConfig --outDir /tmp/rec_ai_test --module esnext --target es2022
 *   sed -i "s#from './\\([a-zA-Z]*\\)'#from './\\1.js'#g" /tmp/rec_ai_test/*.js   # tsc nie dopisuje rozszerzeń, node ESM ich wymaga
 *   node tools/test-segment-split.mjs
 *
 * Rzecz, o którą tu chodzi: najpierw dzieli MODEL (wg sensu), a dopiero jego za długie bloki tnie
 * mechanika — i nie jest w stanie skasować żadnej granicy modelu. Testy pilnują tej kolejności oraz
 * tego, że przy żadnej odpowiedzi modelu tekst nie przestaje być dokładnie tym, co przyszło z deAPI.
 */
import { buildChunks } from '/tmp/rec_ai_test/transcriptRows.js';
import { buildBlocks, normalizeStarts, needsBlockSplit, BLOCK_DEFAULTS } from '/tmp/rec_ai_test/segmentSplit.js';

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

/** Segment w kształcie odpowiedzi deAPI: zdania sklejone w jeden moloch, ze słowami co 0,3 s. */
let clock = 0.4;
const molochOf = (sentences) => {
  const words = [];
  for (const s of sentences) {
    for (const w of s.split(' ')) {
      words.push({ word: w, start: +clock.toFixed(2), end: +(clock + 0.24).toFixed(2), speaker: 'SPEAKER_00' });
      clock += 0.3;
    }
    clock += 0.5; // pauza między zdaniami
  }
  return { start: words[0].start, end: words[words.length - 1].end, text: sentences.join(' '), speaker: 'SPEAKER_00', words };
};

// Trzy wątki w jednym 30-sekundowym wierszu — dokładnie objaw z produkcji.
const ZDANIA = [
  'Zaczynamy od budżetu na przyszły kwartał.',
  'Wygląda na to, że zmieścimy się w planie.',
  'Druga sprawa to rekrutacja na stanowisko projektanta.',
  'Mamy trzech kandydatów po rozmowach.',
  'Na koniec logistyka wyjazdu na targi.',
  'Hotel jest zarezerwowany, brakuje biletów.',
];
const MOLOCH = molochOf(ZDANIA);
const chunks = buildChunks([MOLOCH]);

console.log('needsBlockSplit');
ok('moloch kwalifikuje się do podziału', needsBlockSplit([MOLOCH]));
eq('krótki segment zostawiamy w spokoju', needsBlockSplit([{ text: 'Krótka notatka.', words: null }]), false);
eq('brak segmentów → nie', needsBlockSplit(null), false);

console.log('normalizeStarts — walidacja odpowiedzi modelu');
eq('numery 1-based → indeksy 0-based, bez fragmentu 1', [...(normalizeStarts([1, 3, 5], 6) ?? [])], [2, 4]);
eq('śmieć w tablicy pomijany, reszta działa', [...(normalizeStarts([3, 'x', 99, null, 5], 6) ?? [])], [2, 4]);
eq('nie-tablica → null', normalizeStarts({ starts: [2] }, 6), null);
eq('sama jedynka → null (brak kotwicy, zostaje mechanika)', normalizeStarts([1], 6), null);
eq('każdy fragment osobno → null (to sieczka, nie grupowanie)', normalizeStarts([2, 3, 4, 5, 6], 6), null);

console.log('buildBlocks — kontekst wyznacza granice');
const starts = normalizeStarts([1, 3, 5], chunks.length); // trzy akapity po dwa zdania
const ctx = buildBlocks([MOLOCH], chunks, { starts });
eq('powstały trzy wiersze — po jednym na wątek', ctx.length, 3);
eq('wiersz 1', ctx[0].text.trim(), `${ZDANIA[0]} ${ZDANIA[1]}`);
eq('wiersz 2', ctx[1].text.trim(), `${ZDANIA[2]} ${ZDANIA[3]}`);
eq('wiersz 3', ctx[2].text.trim(), `${ZDANIA[4]} ${ZDANIA[5]}`);
ok('sklejony tekst = oryginał', ctx.map((r) => r.text).join('') === MOLOCH.text);
eq('pierwszy wiersz zachowuje start segmentu', ctx[0].start, MOLOCH.start);
eq('ostatni wiersz zachowuje koniec segmentu', ctx[2].end, MOLOCH.end);
ok('każdy wiersz ma własne, rosnące czasy', ctx.every((r, i) => i === 0 || r.start > ctx[i - 1].start));
ok('każdy wiersz niesie swoje słowa', ctx.every((r) => r.words.length > 0));
eq('żadne słowo nie zginęło', ctx.reduce((n, r) => n + r.words.length, 0), MOLOCH.words.length);

console.log('dwa etapy: kontekst wyznacza bloki, mechanika tnie za długie WEWNĄTRZ nich');
// Blok wskazany przez model, który wyszedł za długi, ZOSTAJE podzielony — ale jego granica przeżywa.
const starts2 = normalizeStarts([1, 5], chunks.length); // dwa bloki po trzy zdania
const staged = buildBlocks([MOLOCH], chunks, { starts: starts2, maxChars: 150 });
ok('za długi blok kontekstowy jest dalej cięty maszynowo', staged.length > 2);
ok('żaden wiersz nie przekracza limitu', staged.every((r) => r.text.trim().length <= 150 || r.words.length <= 1));
// NAJWAŻNIEJSZE: podziału modelu nie wyrzucamy — każda jego kotwica nadal zaczyna wiersz
const anchorTexts = [...starts2].map((i) => chunks[i].text.trim());
ok(
  'każda kotwica modelu nadal zaczyna wiersz (mechanika jej nie skasowała)',
  anchorTexts.every((t) => staged.some((r) => r.text.trim().startsWith(t))),
  `kotwice: ${JSON.stringify(anchorTexts)}\n      wiersze: ${JSON.stringify(staged.map((r) => r.text.trim().slice(0, 30)))}`
);
ok('tekst nadal 1:1', staged.map((r) => r.text).join('') === MOLOCH.text);
// przy limicie, w który bloki się mieszczą, mechanika nie dokłada NIC
const untouched = buildBlocks([MOLOCH], chunks, { starts: starts2 });
eq('bloki mieszczące się w limicie zostają nietknięte', untouched.length, 2);
// bez kontekstu przy tym samym limicie granice wypadają GDZIE INDZIEJ — dowód, że etap 1 realnie rządzi
const mechOnly = buildBlocks([MOLOCH], chunks, { maxChars: 150 });
ok(
  'bez kontekstu granice wypadają w innych miejscach',
  JSON.stringify(mechOnly.map((r) => r.text)) !== JSON.stringify(staged.map((r) => r.text))
);

console.log('mechanika jako zabezpieczenie (brak kontekstu — offline / awaria modelu)');
const mech = buildBlocks([MOLOCH], chunks, {});
ok('moloch mimo wszystko podzielony', mech.length > 1);
ok('żaden wiersz nie przekracza maxChars', mech.every((r) => r.text.trim().length <= BLOCK_DEFAULTS.maxChars), JSON.stringify(mech.map((r) => r.text.trim().length)));
ok('wiersze kończą się na granicy zdania', mech.slice(0, -1).every((r) => /[.!?…]$/.test(r.text.trim())), JSON.stringify(mech.map((r) => r.text.trim().slice(-12))));
ok('tekst nadal 1:1', mech.map((r) => r.text).join('') === MOLOCH.text);

console.log('nie ruszamy tego, czego nie trzeba');
const shortSeg = { start: 0, end: 2, text: 'Krótka notatka.', speaker: null, words: [{ word: 'Krótka', start: 0, end: 0.4 }, { word: 'notatka.', start: 0.5, end: 1.0 }] };
eq('krótki segment → null (nic do zapisania)', buildBlocks([shortSeg], buildChunks([shortSeg]), {}), null);
const two = [MOLOCH, shortSeg];
const twoChunks = buildChunks(two);
const mixed = buildBlocks(two, twoChunks, {});
ok('w mieszance dzielony jest tylko moloch', mixed.some((r) => r.text.trim() === 'Krótka notatka.'));
ok('tekst nadal 1:1', mixed.map((r) => r.text).join('') === two.map((s) => s.text).join(''));

console.log('własność: żadna odpowiedź modelu nie zmienia tekstu');
let seed = 20260814;
const rnd = (n) => ((seed = (seed * 48271) % 2147483647) % n);
const originalText = MOLOCH.text;
const originalWords = MOLOCH.words.map((w) => w.word).join('|');
let identical = 0;
let rejected = 0;
let broken = 0;
for (let round = 0; round < 500; round++) {
  const raw = Array.from({ length: 1 + rnd(chunks.length + 3) }, () => rnd(chunks.length + 5)); // też numery spoza zakresu
  const rows = buildBlocks([MOLOCH], chunks, { starts: normalizeStarts(raw, chunks.length) });
  if (!rows) {
    rejected++;
    continue;
  }
  const textOk = rows.map((r) => r.text).join('') === originalText;
  const wordsOk = rows.flatMap((r) => (r.words ?? []).map((w) => w.word)).join('|') === originalWords;
  if (textOk && wordsOk) identical++;
  else {
    broken++;
    if (broken === 1) console.log(`      pierwszy rozjazd przy ${JSON.stringify(raw)}`);
  }
}
console.log(`  (500 losowych odpowiedzi modelu: ${identical} × tekst 1:1, ${rejected} × odrzucone, ${broken} × rozjazd)`);
ok('żadna odpowiedź modelu nie zmieniła tekstu', broken === 0);
ok('losowanie objęło przypadki przyjęte', identical > 100, `przyjętych: ${identical}`);

console.log(`\n${pass} przeszło, ${fail} nie przeszło`);
process.exit(fail ? 1 : 0);
