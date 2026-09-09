// When a problem comes out of OCR garbled or ambiguous, guess what the equation
// was. Generates candidate readings, solves each, and returns the 3 most
// plausible {question, answer} pairs for the student to pick from (they have the
// original page image to compare against).

import { solve, clean } from './solve.js';

// A gentle pre-clean that keeps the OCR noise (capitals, stray glyphs) intact so
// the swap rules below can reinterpret it. solve() does the strict clean itself.
function lightClean(input) {
  let s = String(input).replace(/\r/g, ' ').replace(/\n+/g, '\n');
  s = s.replace(/^\s*\(?\d{1,2}\)?[.)]\s*/, '');
  s = s.replace(/solve(\s+the\s+equation)?(\s+for\s+[a-z])?\s*[:.]?/i, '');
  s = s.replace(/[·∙×]/g, '*').replace(/÷/g, '/');
  s = s.replace(/(?:[,;]?\s*[a-zA-Z]\s*=\s*_*\s*)+$/,'');       // trailing "x ="
  s = s.replace(/(?:\n|\s{2,})[a-zA-Z]\s*$/, '');
  return s.replace(/\s*\n\s*/g, ' ').trim();
}

/* ----------------------------- edit distance -------------------------- */
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[n];
}

/* --------------------- single-swap OCR corrections ------------------- */
// Each entry: a regex of a commonly-misread glyph and what it probably should be.
const SWAPS = [
  [/[lI](?=\d)|(?<=\d)[lI]/g, '1'],
  [/\b[lI]\b/g, '1'],
  [/[lI|](?=\s*\d)/g, '='],                 // a vertical stroke misread for "="
  [/[oO]/g, '0'],
  [/\bS\b/g, '5'],
  [/(?<=[-+*/(=]\s?)S|S(?=\s?[-+*/)=])/g, '5'],
  [/\bS(?=\d)|(?<=\d)S\b/g, '5'],
  [/[Zz](?=\s*\d)|(?<=\d)\s*[Zz]/g, '2'],
  [/[Bß](?=\s|=|$)/g, '8'],
  [/\bg\b/g, '9'],
  [/(?<=\d)\s*g|g\s*(?=\d)/g, '9'],
  [/\?/g, '7'],
  [/[Tt](?=[a-z])/g, ''],                   // "7Tx" -> "7x"
  [/(?<=\d)[lI](?=\d)/g, ''],               // "l" dropped: "l3" -> "3"
  [/(?<=[\d)])\s*[Tt]\s*(?=[\d(])/g, ' - '],
  [/(?<=[\d)])\s*[Tt]\s*(?=[\d(])/g, ' + '],
  [/[—–]/g, '-'],
  [/(?<=\d) (?=\d\b)/g, '.'],               // "1 8" -> "1.8"
];

/* ------------------ structural / grouping ambiguities ---------------- */
function structuralAlts(s) {
  const alts = new Set();

  // a bare 2-digit integer might be a dropped decimal: 18 -> 1.8
  let mm;
  const numRe = /(?<![\d.])(\d)(\d)(?![\d.])/g;
  while ((mm = numRe.exec(s))) {
    alts.add(s.slice(0, mm.index) + mm[1] + '.' + mm[2] + s.slice(mm.index + 2));
  }

  // "a / b + c"  could be  "a / (b + c)"
  const frac = s.match(/([\d(][\w+\-() ]*?)\s*\/\s*([\w]+)\s*([+\-])\s*([\w]+)/);
  if (frac) alts.add(s.replace(frac[0], `${frac[1]}/(${frac[2]} ${frac[3]} ${frac[4]})`));

  // missing operator between two terms: "3x 5 = 9" -> "3x + 5" / "3x - 5"
  const gap = s.match(/([a-z0-9)])\s+([a-z0-9(])/i);
  if (gap && !/[-+*/=]/.test(s[s.indexOf(gap[0]) + 1] || '')) {
    for (const op of [' + ', ' - ', ' * ']) alts.add(s.replace(gap[0], gap[1] + op + gap[2]));
  }

  // exponent forms: "x2" / "x*2" <-> "x^2"
  if (/[a-z]\s*\*?\s*2\b/i.test(s) && !/\^/.test(s)) alts.add(s.replace(/([a-z])\s*\*?\s*2\b/gi, '$1^2'));

  // a stray "=" was dropped: "3x + 7 22" -> "3x + 7 = 22"
  if (!s.includes('=')) {
    const tail = s.match(/^(.*[a-z].*?)\s+(-?\d+(?:\.\d+)?)\s*$/i);
    if (tail) alts.add(`${tail[1]} = ${tail[2]}`);
  }

  return [...alts];
}

// Looser "what else could this have been" variants — each single operator or
// sign flipped. Kept only if they produce a tidy answer, so the 2nd/3rd option
// is still something a student might plausibly see on the sheet.
function loosenAlts(s) {
  const out = new Set();
  const ops = [...s.matchAll(/[-+*/]/g)];
  for (const m of ops) {
    const swap = { '+': '-', '-': '+', '*': '/', '/': '*' }[m[0]];
    out.add(s.slice(0, m.index) + swap + s.slice(m.index + 1));
  }
  // flip the sign of a stand-alone RHS number
  const rhs = s.match(/=\s*(-?)(\d+(?:\.\d+)?)\s*$/);
  if (rhs) out.add(s.replace(/=\s*-?\d+(?:\.\d+)?\s*$/, `= ${rhs[1] ? '' : '-'}${rhs[2]}`));
  return [...out];
}

/* ------------------------------- scoring ----------------------------- */
function answerNiceness(ans) {
  if (!ans) return 9;
  if (/no (real )?solution|no unique/i.test(ans)) return 6;
  if (/≈/.test(ans)) return 4;
  if (/√/.test(ans)) return 3;
  if (/=\s*-?\d+\s*(,|$| or )/.test(ans) || /^\s*[a-z]\s*=\s*-?\d+\s*$/.test(ans)) return 0; // integer
  if (/-?\d+\/\d+/.test(ans)) {
    const den = Math.abs(+(ans.match(/\/(\d+)/) || [])[1] || 1);
    return den <= 12 ? 1 : 2;
  }
  return 2;
}

/**
 * candidates("(3x)/(5) = 9  x =")  ->
 *   [ { question: "(3x)/(5) = 9", answer: "x = 15", note: "as read" }, ... ]
 * Up to 3, most plausible first. Empty array if nothing solves.
 */
export function candidates(raw, limit = 3) {
  const base = lightClean(raw || '');
  if (!base) return [];

  const variants = new Map(); // string -> {edits}
  const add = (str, edits) => {
    const k = str.replace(/\s+/g, ' ').trim();
    if (k && (!variants.has(k) || variants.get(k).edits > edits)) variants.set(k, { edits });
  };

  add(base, 0);

  const swapVariants = [base];
  for (const [re, to] of SWAPS) {
    re.lastIndex = 0;
    if (re.test(base)) {
      re.lastIndex = 0;
      const v = base.replace(re, to);
      add(v, lev(base, v) || 1);
      swapVariants.push(v);
    }
  }
  // all swaps together (aggressive)
  let all = base;
  for (const [re, to] of SWAPS) { re.lastIndex = 0; all = all.replace(re, to); }
  add(all, lev(base, all) + 1);
  swapVariants.push(all);

  // structural tweaks on every swap variant
  for (const seed of swapVariants) {
    for (const s of structuralAlts(seed)) add(s, lev(base, s) + 1);
  }
  // looser alternatives, marked so we only keep them if the answer is tidy
  const loose = new Set();
  for (const s of loosenAlts(base)) { loose.add(s.replace(/\s+/g, ' ').trim()); add(s, lev(base, s) + 3); }

  const scored = [];
  const seenQ = new Set();
  for (const [q, { edits }] of variants) {
    let r;
    try { r = solve(q); } catch { r = null; }
    if (!r || !r.answer || /no (real )?solution|no unique/i.test(r.answer)) continue;
    const nice = answerNiceness(r.answer);
    if (loose.has(q) && nice > 1) continue; // loose guess must land on a clean answer
    const display = clean(q) || q;
    const key = display + ' || ' + r.answer;
    if (seenQ.has(key)) continue;
    seenQ.add(key);
    scored.push({ question: display, answer: r.answer, edits, _score: nice * 4 + edits });
  }

  scored.sort((a, b) => a._score - b._score);
  const out = [];
  const seenA = new Set();
  for (const c of scored) {
    if (seenA.has(c.answer) && out.length) continue; // don't show the same answer twice
    seenA.add(c.answer);
    out.push({ question: c.question, answer: c.answer, note: c.edits === 0 ? 'as read' : 'adjusted' });
    if (out.length >= limit) break;
  }
  return out;
}
