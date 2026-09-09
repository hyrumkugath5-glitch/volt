import { simplify } from '../src/exponents.js';

const cases = [
  ['(x^-2 * x^-3)^4', '1/x^20'],
  ['(n^3)^3 * 2n^-1', '2n^8'],
  ['2x^2y^4 * 2xy^3 * 3x', '12x^4y^7'],
  ['(x^4)^-3 * 2x^4', '2/x^8'],
  ['(2v)^2 * 2v^2', '8v^4'],
  ['m^2 * m^-4', '1/m^2'],
  ['x^3 / x^3', '1'],
  ['x^0', '1'],
  ['(2x^2 * 2x^-3)^2', '16/x^2'],
  ['4x^-2 / (2x^3)', '2/x^5'],
  ['(a^2b^-1)^-2', 'b^2/a^4'],
  ['3^2 * x', '9x'],
  // straight off the Kuta "More Properties of Exponents" sheet
  ['(x^3 y^3 * x^3)/(4 x^2)', '(x^4y^3)/4'],
  ['(2 x^2 y^4 * 4 x^2 y^4 * 3 x)/(3 x^-3 y^2)', '8x^8y^6'],
  ['b a^4 * ( 2 b a^4 )^-3', '1/(8a^8b^2)'],
  ['(( x^-3 )^4 x^4)/(2 x^-3)', '1/(2x^5)'],
];

let pass = 0;
for (const [q, want] of cases) {
  const r = simplify(q);
  const got = r ? r.answer : '(null)';
  const ok = got === want;
  if (ok) pass++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${q.padEnd(28)} -> ${got}${ok ? '' : `   (want ${want})`}`);
}
console.log(`\n${pass}/${cases.length} passed`);
process.exit(pass === cases.length ? 0 : 1);
