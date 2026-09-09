// Offline solver for the equations that actually show up on algebra worksheets:
// linear equations in one variable, simple quadratics, proportions (a/b = c/d),
// and 2x2 linear systems. Exact fractions and simplified radicals where possible.
// No dependencies — a tiny purpose-built CAS.

/* ------------------------------- rationals ------------------------------- */
const igcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; };
const decimals = (x) => { const t = String(x); const i = t.indexOf('.'); return i < 0 ? 0 : t.length - i - 1; };

class F {
  constructor(n, d = 1) {
    if (d === 0) throw new Error('division by zero');
    const p = Math.max(decimals(n), decimals(d));
    if (p > 0) { const m = 10 ** p; n = Math.round(n * m); d = Math.round(d * m); }
    if (d < 0) { n = -n; d = -d; }
    const g = igcd(n, d);
    this.n = Math.trunc(n / g);
    this.d = Math.trunc(d / g);
  }
  static c(x) { return x instanceof F ? x : new F(x); }
  add(o) { o = F.c(o); return new F(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { o = F.c(o); return new F(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { o = F.c(o); return new F(this.n * o.n, this.d * o.d); }
  div(o) { o = F.c(o); return new F(this.n * o.d, this.d * o.n); }
  neg() { return new F(-this.n, this.d); }
  get zero() { return this.n === 0; }
  get val() { return this.n / this.d; }
  eq(o) { o = F.c(o); return this.n === o.n && this.d === o.d; }
  toString() { return this.d === 1 ? String(this.n) : `${this.n}/${this.d}`; }
}

/* ---------------------------- monomial helpers --------------------------- */
function parseMon(k) {
  if (!k) return [];
  return k.split('*').map((p) => { const [v, e] = p.split('^'); return [v, e ? +e : 1]; });
}
function mkMon(map) {
  return Object.entries(map).filter(([, e]) => e !== 0).sort()
    .map(([v, e]) => (e === 1 ? v : `${v}^${e}`)).join('*');
}
function mulMon(a, b) {
  const m = {};
  for (const [v, e] of parseMon(a)) m[v] = (m[v] || 0) + e;
  for (const [v, e] of parseMon(b)) m[v] = (m[v] || 0) + e;
  return mkMon(m);
}

/* ------------------------------ polynomials ------------------------------ */
class Poly {
  constructor(terms) { this.t = terms || new Map(); this._clean(); }
  static K(f) { const m = new Map(); const v = F.c(f); if (!v.zero) m.set('', v); return new Poly(m); }
  static V(name) { return new Poly(new Map([[name, new F(1)]])); }
  _clean() { for (const [k, v] of [...this.t]) if (v.zero) this.t.delete(k); }
  add(o) { const r = new Map(this.t); for (const [k, v] of o.t) r.set(k, (r.get(k) || new F(0)).add(v)); return new Poly(r); }
  sub(o) { return this.add(o.mul(Poly.K(-1))); }
  neg() { return this.mul(Poly.K(-1)); }
  mul(o) {
    const r = new Map();
    for (const [k1, v1] of this.t) for (const [k2, v2] of o.t) {
      const k = mulMon(k1, k2);
      r.set(k, (r.get(k) || new F(0)).add(v1.mul(v2)));
    }
    return new Poly(r);
  }
  vars() { const s = new Set(); for (const k of this.t.keys()) for (const [v] of parseMon(k)) s.add(v); return s; }
  coeff(k) { return this.t.get(k) || new F(0); }
  get isZero() { return this.t.size === 0; }
}

class R {
  constructor(n, d) { this.n = n; this.d = d || Poly.K(1); }
  static c(x) { return x instanceof R ? x : new R(x instanceof Poly ? x : Poly.K(F.c(x))); }
  add(o) { o = R.c(o); return new R(this.n.mul(o.d).add(o.n.mul(this.d)), this.d.mul(o.d)); }
  sub(o) { o = R.c(o); return new R(this.n.mul(o.d).sub(o.n.mul(this.d)), this.d.mul(o.d)); }
  mul(o) { o = R.c(o); return new R(this.n.mul(o.n), this.d.mul(o.d)); }
  div(o) { o = R.c(o); return new R(this.n.mul(o.d), this.d.mul(o.n)); }
  neg() { return new R(this.n.neg(), this.d); }
  pow(k) { let r = R.c(1); for (let i = 0; i < k; i++) r = r.mul(this); return r; }
}

/* ------------------------------- parser --------------------------------- */
function tokenize(src) {
  const s = src.replace(/\s+/g, ' ').trim();
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { i++; continue; }
    if (/[0-9.]/.test(c)) { let n = ''; while (i < s.length && /[0-9.]/.test(s[i])) n += s[i++]; out.push({ t: 'num', v: n }); continue; }
    if (/[a-zA-Z]/.test(c)) { out.push({ t: 'var', v: c.toLowerCase() }); i++; continue; }
    if ('+-*/^()'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    if (c === '×') { out.push({ t: 'op', v: '*' }); i++; continue; }
    if (c === '÷') { out.push({ t: 'op', v: '/' }); i++; continue; }
    throw new Error('bad char ' + c);
  }
  return out;
}

function parse(src) {
  const tk = tokenize(src);
  let p = 0;
  const peek = () => tk[p];
  const eat = (v) => { if (!tk[p] || (v && tk[p].v !== v)) throw new Error('parse'); return tk[p++]; };
  const startsFactor = () => { const t = peek(); return t && (t.t === 'num' || t.t === 'var' || (t.t === 'op' && t.v === '(')); };

  function expr() {
    let node = term();
    while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = eat().v;
      const rhs = term();
      node = op === '+' ? node.add(rhs) : node.sub(rhs);
    }
    return node;
  }
  function term() {
    let node = factor();
    for (;;) {
      const t = peek();
      if (t && t.t === 'op' && (t.v === '*' || t.v === '/')) { const op = eat().v; const rhs = factor(); node = op === '*' ? node.mul(rhs) : node.div(rhs); }
      else if (startsFactor()) { node = node.mul(factor()); } // implicit multiplication
      else break;
    }
    return node;
  }
  function factor() {
    const t = peek();
    if (t && t.t === 'op' && (t.v === '+' || t.v === '-')) { eat(); const f = factor(); return t.v === '-' ? f.neg() : f; }
    return power();
  }
  function power() {
    let base = atom();
    if (peek() && peek().t === 'op' && peek().v === '^') { eat(); const e = atom(); const k = Math.round(e.n.coeff('').val); base = base.pow(k); }
    return base;
  }
  function atom() {
    const t = peek();
    if (!t) throw new Error('eof');
    if (t.t === 'num') { eat(); return R.c(new F(Number(t.v))); }
    if (t.t === 'var') { eat(); return new R(Poly.V(t.v)); }
    if (t.t === 'op' && t.v === '(') { eat('('); const e = expr(); eat(')'); return e; }
    throw new Error('atom');
  }

  const node = expr();
  if (p !== tk.length) throw new Error('trailing');
  return node; // R
}

/* ------------------------------ radicals -------------------------------- */
function isqrt(n) { const r = Math.floor(Math.sqrt(n)); return [r, r + 1].find((x) => x * x === n); }
function simpRad(nInt) {
  // sqrt(nInt) = out * sqrt(inr)
  let out = 1, inr = nInt;
  for (let f = 2; f * f <= inr; f++) { while (inr % (f * f) === 0) { inr /= f * f; out *= f; } }
  return { out, inr };
}

/* --------------------------- equation solving --------------------------- */
function clean(input) {
  let s = String(input).replace(/\r/g, ' ').replace(/\n+/g, '\n');
  s = s.replace(/^\s*\d{1,2}[.)]\s+/, ''); // "N)" label, not a "(N)" group
  s = s.replace(/^\s*\(\d{1,2}\)\s+(?=[a-z(])/i, ''); // "(N) " label style too
  s = s.replace(/solve(\s+the\s+(equation|inequality))?(\s+for\s+[a-z])?\s*[:.]?/i, '');
  s = s.replace(/\bfind\s+(the\s+value\s+of\s+)?[a-z]\s*[:.]?/i, '');
  s = s.replace(/[·∙×]/g, '*').replace(/[–—]/g, '-').replace(/÷/g, '/').replace(/√/g, 'sqrt');
  // OCR noise: X/Y are really x/y; any other capital letter is a misread artifact
  s = s.replace(/[A-Z]/g, (m) => ('XY'.includes(m) ? m.toLowerCase() : ''));
  // stray letter wedged between a digit and the variable ("7Tx" -> "7x", handled
  // above for capitals; catch lowercase too, e.g. "7tx")
  s = s.replace(/(\d)[a-wz](x|y)\b/g, '$1$2');
  // drop trailing answer blanks like "  x =" / "x = ______" / "x =   y ="
  s = s.replace(/(?:[,;]?\s*[a-z]\s*=\s*_*\s*)+$/i, '');
  s = s.replace(/(?:\n|\s{2,})[a-z]\s*$/i, ''); // a lone leftover "x" from the blank
  s = s.replace(/\s*\n\s*/g, ' ').trim();
  // cut trailing prose (a run of real words) — usually a worksheet title or the
  // next problem's text that bled into this block
  s = s.replace(/\s+[A-Za-z]{3,}(?:\s+[A-Za-z()]{2,}){2,}.*$/, '');
  s = s.replace(/(?:[,;]?\s*[a-z]\s*=\s*_*\s*)+$/i, ''); // re-trim blanks exposed by the cut
  s = s.replace(/([\d)])\s+[a-z]{1,3}$/i, '$1'); // trailing OCR crumbs from the next problem
  return s.trim();
}

function splitEquations(s) {
  let parts = s.split(/\s*(?:\n|;|,| and )\s*/i).map((x) => x.trim()).filter(Boolean);
  if (parts.length === 1) {
    const eqCount = (s.match(/=/g) || []).length;
    if (eqCount === 2) {
      const m = s.match(/^(.+?=\s*-?[\d.]+(?:\/[\d.]+)?)\s+(.+=.+)$/);
      if (m) parts = [m[1].trim(), m[2].trim()];
    }
  }
  return parts
    .filter((p) => (p.match(/=/g) || []).length === 1)
    .map((p) => p.split('=').map((x) => x.trim()))
    .filter(([l, r]) => l && r);
}

function solvePolyZero(poly, v) {
  const allowed = new Set(['', v, `${v}^2`]);
  for (const k of poly.t.keys()) if (!allowed.has(k)) return null; // degree >2 or extra var
  const a = poly.coeff(`${v}^2`);
  const b = poly.coeff(v);
  const c = poly.coeff('');

  if (a.zero) {
    if (b.zero) return null;
    const x = c.neg().div(b);
    return { vars: [v], solutions: [{ [v]: x }], answer: `${v} = ${x}`, kind: 'linear', coeffs: { a: b, b: c } };
  }
  // quadratic: disc = b^2 - 4ac
  const disc = b.mul(b).sub(a.mul(c).mul(4));
  const twoA = a.mul(2);
  if (disc.zero) {
    const x = b.neg().div(twoA);
    return { vars: [v], solutions: [{ [v]: x }], answer: `${v} = ${x}`, kind: 'quadratic' };
  }
  if (disc.val > 0) {
    // rational sqrt?
    const sn = isqrt(disc.n);
    const sd = isqrt(disc.d);
    if (sn !== undefined && sd !== undefined) {
      const root = new F(sn, sd);
      const r1 = b.neg().add(root).div(twoA);
      const r2 = b.neg().sub(root).div(twoA);
      return { vars: [v], solutions: [{ [v]: r1 }, { [v]: r2 }], answer: `${v} = ${r1} or ${v} = ${r2}`, kind: 'quadratic' };
    }
    // irrational: (-b ± sqrt(disc)) / 2a  with disc = dn/dd  -> sqrt = sqrt(dn*dd)/dd
    const under = disc.n * disc.d;
    const { out, inr } = simpRad(under);
    const approx1 = (b.neg().val + Math.sqrt(disc.val)) / twoA.val;
    const approx2 = (b.neg().val - Math.sqrt(disc.val)) / twoA.val;
    const radStr = `${out === 1 ? '' : out}√${inr}${disc.d === 1 ? '' : `/${disc.d}`}`;
    return {
      vars: [v], kind: 'quadratic', irrational: true,
      solutions: [{ [v]: approx1 }, { [v]: approx2 }],
      answer: `${v} = (${b.neg()} ± ${radStr}) / ${twoA}  ≈  ${round(approx1)} or ${round(approx2)}`,
    };
  }
  return { vars: [v], kind: 'quadratic', answer: 'no real solution', solutions: [] };
}

function solveSystem(eqPairs) {
  // each: A x + B y + K = 0
  const rows = [];
  const varSet = new Set();
  for (const [L, Rr] of eqPairs) {
    let lhs, rhs;
    try { lhs = parse(L); rhs = parse(Rr); } catch { return null; }
    const poly = lhs.sub(rhs).n;
    if (![...poly.t.keys()].every((k) => k === '' || /^[a-z]$/.test(k))) return null; // must be linear
    for (const v of poly.vars()) varSet.add(v);
    rows.push(poly);
  }
  const vs = [...varSet];
  if (vs.length !== 2 || rows.length !== 2) return null;
  const [x, y] = vs;
  const A1 = rows[0].coeff(x), B1 = rows[0].coeff(y), K1 = rows[0].coeff('');
  const A2 = rows[1].coeff(x), B2 = rows[1].coeff(y), K2 = rows[1].coeff('');
  const D = A1.mul(B2).sub(A2.mul(B1));
  if (D.zero) return { vars: vs, answer: 'no unique solution', solutions: [] };
  const xv = K1.neg().mul(B2).sub(K2.neg().mul(B1)).div(D);
  const yv = A1.mul(K2.neg()).sub(A2.mul(K1.neg())).div(D);
  return { vars: vs, kind: 'system', solutions: [{ [x]: xv, [y]: yv }], answer: `${x} = ${xv},  ${y} = ${yv}` };
}

const round = (n) => (Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : String(Number(n.toFixed(3))));

/**
 * solve("3(x - 2) = 9")  ->  { answer: "x = 5", ... }  |  null if it can't.
 */
export function solve(input) {
  const s = clean(input);
  if (!s || !s.includes('=')) return null;
  let eqs;
  try { eqs = splitEquations(s); } catch { return null; }
  if (eqs.length === 2) { try { return solveSystem(eqs); } catch { return null; } }
  if (eqs.length !== 1) return null;
  try {
    const [L, Rr] = eqs[0];
    const combined = parse(L).sub(parse(Rr)); // R, want numerator = 0
    const poly = combined.n;
    const vs = [...poly.vars()];
    if (vs.length !== 1) return null;
    return solvePolyZero(poly, vs[0]);
  } catch { return null; }
}

/**
 * Human-readable steps for a linear solve (best-effort; returns [] otherwise).
 */
export function steps(input) {
  const r = solve(input);
  if (!r || r.kind !== 'linear') return [];
  const a = r.coeffs.a, b = r.coeffs.b, v = r.vars[0];
  const out = [`Bring every term to one side: ${fmtLin(a, b, v)} = 0`];
  if (!b.zero) out.push(`${a.eq(1) ? '' : ''}${fmtLin(a, new F(0), v)} = ${b.neg()}`);
  out.push(`Divide both sides by ${a}:  ${v} = ${b.neg()}${a.eq(1) ? '' : ` / ${a}`}`);
  out.push(`${v} = ${b.neg().div(a)}`);
  return out;
}
function fmtLin(a, b, v) {
  const av = a.eq(1) ? v : a.eq(-1) ? `-${v}` : `${a}${v}`;
  if (b.zero) return av;
  return `${av} ${b.val < 0 ? '-' : '+'} ${b.val < 0 ? b.neg() : b}`;
}

export { clean };
export const _internal = { F, Poly, R, parse, clean, splitEquations };
