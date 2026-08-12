/**
 * Testy skrótów rozmówców (src/lib/speakerLabel.ts).
 *
 *   npx tsc src/lib/speakerLabel.ts --ignoreConfig --outDir /tmp/rec_ai_test --module esnext --target es2022
 *   node tools/test-speaker-label.mjs
 */
import { abbreviateName, isUsableName, speakerLabels, resolveCollisions } from '/tmp/rec_ai_test/speakerLabel.js';

let pass = 0;
let fail = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.log(`  ✗ ${name}\n      dostałem: ${JSON.stringify(got)}\n      oczekiwane: ${JSON.stringify(want)}`);
  }
};

console.log('abbreviateName — przykłady użytkownika');
eq('Marc → MRC', abbreviateName('Marc'), 'MRC');
eq('Tabitha → TBT', abbreviateName('Tabitha'), 'TBT');

console.log('abbreviateName — polskie imiona i diakrytyki');
eq('Łukasz → ŁKS', abbreviateName('Łukasz'), 'ŁKS');
eq('Piotr → PTR', abbreviateName('Piotr'), 'PTR');
eq('Grzegorz → GRZ', abbreviateName('Grzegorz'), 'GRZ');
eq('Krystyna → KRS (y jest samogłoską)', abbreviateName('Krystyna'), 'KRS');
eq('Zbigniew → ZBG', abbreviateName('Zbigniew'), 'ZBG');

console.log('abbreviateName — za mało spółgłosek → pierwsze 3 litery');
eq('Ewa → EWA', abbreviateName('Ewa'), 'EWA');
eq('Ala → ALA', abbreviateName('Ala'), 'ALA');
eq('Ola → OLA', abbreviateName('Ola'), 'OLA');
eq('Ida → IDA', abbreviateName('Ida'), 'IDA');

console.log('abbreviateName — przypadki brzegowe');
eq('imię 2-literowe zwraca 2 znaki', abbreviateName('Bo'), 'BO');
eq('spacje i myślnik ignorowane', abbreviateName('Anna-Maria'), 'ANN');
eq('apostrof ignorowany', abbreviateName("O'Brien"), 'OBR');
eq('pusty string', abbreviateName('   '), '');

console.log('isUsableName — odsiew wymówek modelu');
eq('zwykłe imię', isUsableName('Marc'), true);
eq('null', isUsableName(null), false);
eq('pusty', isUsableName(''), false);
eq('„nieznany"', isUsableName('nieznany'), false);
eq('„unknown"', isUsableName('unknown'), false);
eq('„Speaker 1" (ma cyfrę)', isUsableName('Speaker 1'), false);
eq('„osoba"', isUsableName('osoba'), false);
eq('zdanie zamiast imienia', isUsableName('nie wiem kto to jest, chyba ktoś z biura tego'), false);

console.log('speakerLabels — mieszanka imion i numerów');
const numbers = new Map([['SPEAKER_00', 1], ['SPEAKER_01', 2], ['SPEAKER_02', 3]]);
eq(
  'znane imiona → skróty, nieznane → numer',
  [...speakerLabels(numbers, { SPEAKER_00: 'Marc', SPEAKER_02: 'Tabitha' }).entries()],
  [['SPEAKER_00', 'MRC'], ['SPEAKER_01', '2'], ['SPEAKER_02', 'TBT']]
);
eq(
  'brak mapy imion → same numery',
  [...speakerLabels(numbers, null).entries()],
  [['SPEAKER_00', '1'], ['SPEAKER_01', '2'], ['SPEAKER_02', '3']]
);
eq(
  'wymówki modelu traktowane jak brak imienia',
  [...speakerLabels(numbers, { SPEAKER_00: 'unknown', SPEAKER_01: 'Speaker 2', SPEAKER_02: 'Ewa' }).entries()],
  [['SPEAKER_00', '1'], ['SPEAKER_01', '2'], ['SPEAKER_02', 'EWA']]
);

console.log('kolizje — dwie osoby NIE MOGĄ dostać tego samego identyfikatora');
const two = new Map([['A', 1], ['B', 2]]);
const collided = speakerLabels(two, { A: 'Marc', B: 'Marcin' });
eq('Marc zachowuje MRC (odezwał się pierwszy)', collided.get('A'), 'MRC');
eq('Marcin dostaje wariant', collided.get('B'), 'MAR');
eq('etykiety są różne', collided.get('A') !== collided.get('B'), true);

const three = new Map([['A', 1], ['B', 2], ['C', 3]]);
const c3 = speakerLabels(three, { A: 'Marc', B: 'Marcin', C: 'Marcelina' });
eq('trzy kolidujące imiona → trzy różne etykiety', new Set([c3.get('A'), c3.get('B'), c3.get('C')]).size, 3);

eq(
  'identyczne imiona dwóch osób też się rozjeżdżają',
  (() => {
    const m = speakerLabels(two, { A: 'Marc', B: 'Marc' });
    return m.get('A') !== m.get('B');
  })(),
  true
);

console.log('resolveCollisions — kolejność decyduje, kto zachowuje skrót');
eq(
  'pierwszy w kolejności wygrywa',
  [...resolveCollisions([
    { id: 'x', name: 'Marc', no: 1 },
    { id: 'y', name: 'Marcin', no: 2 },
  ]).entries()],
  [['x', 'MRC'], ['y', 'MAR']]
);

console.log(`\n${fail === 0 ? '✅' : '❌'} zdane ${pass}, oblane ${fail}`);
process.exit(fail === 0 ? 0 : 1);
