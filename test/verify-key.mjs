// Ground-truth check: read a Kuta PDF, solve every worksheet problem with Volt's
// math engine, then compare against the answer-key pages in the same PDF.
//
//   node test/verify-key.mjs test/fixtures/exponents.pdf

import * as pdfjs from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { textFromItems, itemsFromContent } from '../src/pdftext.js';
import { splitProblems } from '../src/parser.js';
import { simplify, canonical } from '../src/exponents.js';
import { solve } from '../src/solve.js';

pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs').href;

const file = process.argv[2] || 'test/fixtures/exponents.pdf';
const data = new Uint8Array(fs.readFileSync(file));
const pdf = await pdfjs.getDocument({ data }).promise;

// ---- read every page ----
const pages = [];
for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const content = await page.getTextContent();
  const w = page.getViewport({ scale: 1 }).width;
  pages.push(textFromItems(itemsFromContent(content), w));
}

// ---- which pages are answer keys (repeat earlier problem numbers) ----
const numSet = (t) => new Set([...t.matchAll(/(?:^|\n)\s*(\d{1,3})[.)]/g)].map((m) => m[1]));
const sets = pages.map(numSet);
const isKey = pages.map((_, i) => {
  if (i === 0 || sets[i].size < 3) return false;
  return sets.slice(0, i).some((s) => {
    let c = 0;
    for (const n of sets[i]) if (s.has(n)) c++;
    return c / sets[i].size > 0.6;
  });
});

// ---- questions from worksheet pages ----
const questions = {};
pages.forEach((t, i) => {
  if (isKey[i]) return;
  for (const c of splitProblems(t)) questions[c.number] = c.question;
});

// ---- answers from key pages: first line of a block is the (repeated) question,
// the rest is the answer (a bare expression, or a 2-line stacked fraction) ----
const keyAnswers = {};
pages.forEach((t, i) => {
  if (!isKey[i]) return;
  for (const c of splitProblems(t)) {
    const lines = c.question.split('\n')
      .map((l) => l.trim().replace(/\^\((-?\d+)\)/g, '^$1')) // ^(20) -> ^20
      .filter(Boolean)
      .filter((l) => !/^(name|date|period|create your own|worksheet by)/i.test(l));
    if (lines.length < 2) continue;
    const rest = lines.slice(1);
    // bare "num over den" fraction split across two lines
    const bare = (l) => !/[()/]/.test(l);
    let ans;
    if (rest.length >= 2 && bare(rest[0]) && bare(rest[1])) ans = `(${rest[0]})/(${rest[1]})`;
    else ans = rest.join(' ');
    keyAnswers[c.number] = ans;
  }
});

// ---- canonical form so "8x^8y^6" == "8 x^8 y^6" == "(8x^8y^6)/(1)" etc ----
const canon = (expr) => {
  if (!expr) return null;
  const c = canonical(expr);
  if (c) return c.replace(/\s+/g, '');
  const s = solve(expr);
  if (s) return s.answer.replace(/\s+/g, '');
  return String(expr).replace(/\s+/g, '').replace(/\^\((-?\d+)\)/g, '^$1');
};

// ---- compare ----
const nums = [...new Set([...Object.keys(questions), ...Object.keys(keyAnswers)])]
  .map(Number).sort((a, b) => a - b);

let pass = 0;
let checked = 0;
const misses = [];
for (const n of nums) {
  const q = questions[n];
  const key = keyAnswers[n];
  const mine = q ? (simplify(q) || solve(q)) : null;
  const myA = mine ? mine.answer : null;
  if (!q) { console.log(`#${String(n).padStart(2)}  ??  no question read`); continue; }
  if (!key) { console.log(`#${String(n).padStart(2)}  --  Volt: ${myA ?? '(unsolved)'}   (no key answer parsed)`); continue; }
  checked++;
  const ok = myA && canon(myA) === canon(key);
  if (ok) pass++;
  else misses.push(n);
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} #${String(n).padStart(2)}  Volt: ${String(myA ?? '(unsolved)').padEnd(16)}  key: ${key}`
  );
}

console.log(`\n${pass}/${checked} match the answer key` + (misses.length ? `   (misses: ${misses.join(', ')})` : ''));
process.exit(misses.length ? 1 : 0);
