import { solve } from '../src/solve.js';

// The exact worksheet the user imported (Cazoom "Solving Linear Equations 15-min A")
const cases = [
  ['x + 9 = 17', 'x = 8'],
  ['2x = 1.8', 'x = 9/10'],
  ['x - 5 = 4', 'x = 9'],
  ['x/7 = -4', 'x = -28'],
  ['4x + 7 = 3', 'x = -1'],
  ['1 - 4x = -19', 'x = 5'],
  ['3x/5 = 9', 'x = 15'],
  ['7(3x - 2) = -77', 'x = -3'],
  ['(9 + 7x)/3 = -11', 'x = -6'],
  ['2(9 - 4x) + 1 = 3', 'x = 2'],
  ['4(x + 1) + 2(x - 8) = -33', 'x = -7/2'],
  ['8 + 9x = 6 + 5x', 'x = -1/2'],
  ['7x + 3 = 9 - 5x', 'x = 1/2'],
  ['5 - 7x = 4 - 6x', 'x = 1'],
  ['(7x + 5)/9 = 6', 'x = 7'],
  ['(8 - 9x)/5 = 7', 'x = -3'],
  ['4(2x - 3) = 5(3x - 8)', 'x = 4'],
  ['(3x - 1)/5 = (4x + 2)/3', 'x = -13/11'],
  ['(x + 9)/(x + 7) = 1.2', 'x = 3'],
  ['6/(7x + 1) = 3/(x - 2)', 'x = -1'],
  ['4x + 6y = -38 and x + 7y = -48', 'x = 1,  y = -7'],
];

// quadratics / extras
const extra = [
  ['x^2 - 3x - 10 = 0', 'x = 5 or x = -2'],
  ['x^2 - 9 = 0', 'x = 3 or x = -3'],
  ['x^2 = 49', 'x = 7 or x = -7'],
  ['2x^2 + 5x - 3 = 0', 'x = 1/2 or x = -3'],
  ['x^2 + 4x + 4 = 0', 'x = -2'],
  ['Solve for x:  3x + 7 = 22', 'x = 5'],
  ['12 = 4x', 'x = 3'],
];

let pass = 0, fail = 0;
for (const [q, want] of [...cases, ...extra]) {
  const r = solve(q);
  const got = r ? r.answer : '(null)';
  const ok = got === want;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${q.padEnd(36)} => ${got}${ok ? '' : `   (want ${want})`}`);
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
