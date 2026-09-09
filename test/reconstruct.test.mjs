import { candidates } from '../src/reconstruct.js';

// garbled OCR strings -> we want the right reading among the top 3
const cases = [
  ['7Tx+3=9-5x\nX=', 'x = 1/2'],
  ['2x=18\nx=', 'x = 9/10'],          // dropped decimal: 18 -> 1.8
  ['4x + 7 l3\nx =', 'x = -1'],        // l -> 1  ("= 13"? no -> "4x+7 = 3"? tricky)
  ['(9 + 7x)/3 =-1l\nx=', 'x = -6'],   // -1l -> -11
  ['x - S = 4', 'x = 9'],              // S -> 5
  ['3x + 7 22', 'x = 5'],              // missing "="
  ['x^2 - 3x - 1O = 0', 'x = 5 or x = -2'], // O -> 0
];

let pass = 0;
for (const [q, want] of cases) {
  const opts = candidates(q);
  const hit = opts.some((o) => o.answer === want);
  if (hit) pass++;
  console.log(`${hit ? 'ok  ' : 'FAIL'}  ${JSON.stringify(q).padEnd(30)} -> [${opts.map((o) => `${o.question} => ${o.answer}`).join('  |  ')}]`);
}
console.log(`\n${pass}/${cases.length} found the right reading in the top 3`);
process.exit(pass >= cases.length - 1 ? 0 : 1);
