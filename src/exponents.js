// Simplifier for the single-term expressions on "properties of exponents"
// worksheets (Kuta et al.): products, quotients and powers of monomials, with
// negative and zero exponents. Output is in "positive exponents only" form.
//
//   simplify("(x^-2 * x^-3)^4")        -> "1/x^20"
//   simplify("(n^3)^3 * 2n^-1")        -> "2n^8"
//   simplify("2x^2y^4 * 2xy^3 * 3x")   -> "12x^4y^7"

const igcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; };

class Q {
  constructor(n, d = 1) {
    if (d < 0) { n = -n; d = -d; }
    const g = igcd(n, d) || 1;
    this.n = Math.trunc(n / g);
    this.d = Math.trunc(d / g);
  }
  mul(o) { return new Q(this.n * o.n, this.d * o.d); }
  div(o) { return new Q(this.n * o.d, this.d * o.n); }
  powInt(k) {
    let r = new Q(1);
    const base = k < 0 ? new Q(this.d, this.n) : this;
    for (let i = 0; i < Math.abs(k); i++) r = r.mul(base);
    return r;
  }
}

class Mono {
  constructor(coeff, vars) { this.c = coeff || new Q(1); this.v = vars || new Map(); }
  _clean() { for (const [k, e] of [...this.v]) if (e === 0) this.v.delete(k); return this; }
  mul(o) {
    const v = new Map(this.v);
    for (const [k, e] of o.v) v.set(k, (v.get(k) || 0) + e);
    return new Mono(this.c.mul(o.c), v)._clean();
  }
  div(o) {
    const v = new Map(this.v);
    for (const [k, e] of o.v) v.set(k, (v.get(k) || 0) - e);
    return new Mono(this.c.div(o.c), v)._clean();
  }
  powInt(k) {
    const v = new Map();
    for (const [key, e] of this.v) v.set(key, e * k);
    return new Mono(this.c.powInt(k), v)._clean();
  }
}

/* -------------------------------- parser ----------------------------- */
function tokenize(src) {
  const s = src
    .replace(/[·∙⋅×]/g, '*')
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { i++; continue; }
    if (/[0-9]/.test(c)) { let n = ''; while (i < s.length && /[0-9.]/.test(s[i])) n += s[i++]; out.push({ t: 'num', v: parseFloat(n) }); continue; }
    if (/[a-zA-Z]/.test(c)) { out.push({ t: 'var', v: c.toLowerCase() }); i++; continue; }
    if ('*/^()'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    if (c === '-' || c === '+') { out.push({ t: 'op', v: c }); i++; continue; }
    throw new Error('bad char ' + c);
  }
  return out;
}

export function parseMono(src) {
  const tk = tokenize(src);
  let p = 0;
  const peek = () => tk[p];
  const eat = (v) => { if (!tk[p] || (v && tk[p].v !== v)) throw new Error('parse'); return tk[p++]; };
  const startsAtom = () => { const t = peek(); return t && (t.t === 'num' || t.t === 'var' || (t.t === 'op' && t.v === '(')); };

  function expr() {
    let m = term();
    for (;;) {
      const t = peek();
      if (t && t.t === 'op' && (t.v === '*' || t.v === '/')) { const op = eat().v; const r = term(); m = op === '*' ? m.mul(r) : m.div(r); }
      else if (startsAtom()) m = m.mul(term()); // implicit multiplication
      else break;
    }
    return m;
  }
  function term() {
    const t = peek();
    if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) {
      eat();
      const m = power();
      return t.v === '-' ? new Mono(new Q(-1)).mul(m) : m;
    }
    return power();
  }
  function power() {
    let base = atom();
    if (peek() && peek().t === 'op' && peek().v === '^') {
      eat();
      let neg = 1;
      if (peek() && peek().t === 'op' && (peek().v === '-' || peek().v === '+')) { if (eat().v === '-') neg = -1; }
      let k;
      if (peek() && peek().t === 'op' && peek().v === '(') {
        eat('(');
        let s2 = 1;
        if (peek() && peek().t === 'op' && (peek().v === '-' || peek().v === '+')) { if (eat().v === '-') s2 = -1; }
        k = s2 * Math.round(eat().v);
        eat(')');
      } else {
        k = neg * Math.round(eat().v);
        neg = 1;
      }
      base = base.powInt(neg * k);
    }
    return base;
  }
  function atom() {
    const t = peek();
    if (!t) throw new Error('eof');
    if (t.t === 'num') { eat(); return new Mono(new Q(t.v)); }
    if (t.t === 'var') { eat(); return new Mono(new Q(1), new Map([[t.v, 1]])); }
    if (t.t === 'op' && t.v === '(') { eat('('); const e = expr(); eat(')'); return e; }
    throw new Error('atom');
  }

  const m = expr();
  if (p !== tk.length) throw new Error('trailing');
  return m;
}

/* ------------------------------ formatting --------------------------- */
function fmtPow(k, e) { return e === 1 ? k : `${k}^${e}`; }

function formatPositive(m) {
  const p = m.c.n;
  const q = m.c.d;
  const numV = [];
  const denV = [];
  for (const [k, e] of [...m.v].sort()) {
    if (e > 0) numV.push(fmtPow(k, e));
    else if (e < 0) denV.push(fmtPow(k, -e));
  }
  const sign = p < 0 ? '-' : '';
  const absP = Math.abs(p);
  const numParts = [];
  if (absP !== 1 || numV.length === 0) numParts.push(String(absP));
  numParts.push(...numV);
  const denParts = [];
  if (q !== 1) denParts.push(String(q));
  denParts.push(...denV);

  const numStr = numParts.join('');
  if (!denParts.length) return sign + numStr;
  const denStr = denParts.length > 1 ? `(${denParts.join('')})` : denParts[0];
  const wrapNum = numParts.length > 1 ? `(${numStr})` : numStr;
  return `${sign}${wrapNum}/${denStr}`;
}

// Tidy a reconstructed expression for display: "x^(-2)" -> "x^-2", tidy spacing.
export function tidy(expr) {
  return String(expr || '')
    .replace(/\^\((-?\d+)\)/g, '^$1')
    .replace(/[·∙⋅]/g, ' · ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Parse a monomial expression and return its positive-exponent canonical form,
// or null if it isn't a single term. No "did it change" guard — use for
// comparing two expressions for equality.
export function canonical(input) {
  let s = String(input || '').trim();
  s = s.replace(/^\s*\d{1,3}[.)]\s+/, ''); // strip "N)" label, but not a "(N)" group
  s = s.replace(/[=?]\s*$/, '').trim();
  if (!s || /=/.test(s)) return null;
  try {
    return formatPositive(parseMono(s)) || null;
  } catch {
    return null;
  }
}

/**
 * Simplify a monomial expression to positive-exponent form.
 * Returns { answer, question } or null if it can't be parsed, or if it's already
 * in simplest form (nothing to do).
 */
export function simplify(input) {
  let s = String(input || '').trim();
  s = s.replace(/^\s*\d{1,3}[.)]\s+/, '');
  s = s.replace(/simplify[^\n:]*[:.]?/i, '');
  s = s.replace(/your answer.*$/i, '');
  s = s.replace(/[=?]\s*$/, '').trim();
  if (!s || /[=]/.test(s)) return null;
  if (!/\^/.test(s) && !/[·∙⋅×*/]/.test(s)) return null; // no exponent, no operation
  if (!/[a-z]/i.test(s) && !/\^/.test(s)) return null;
  const answer = canonical(s);
  if (!answer || answer === s.replace(/\s+/g, '')) return null;
  return { answer, question: tidy(s), kind: 'exponent' };
}
