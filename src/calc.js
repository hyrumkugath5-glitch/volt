// Small safe expression evaluator. Tokenises, shunting-yard to RPN, evaluates.
// Trig works in degrees. No use of eval / Function.
import katex from '../node_modules/katex/dist/katex.mjs';

// normalise pretty math symbols a user might type or paste
function normalize(src) {
  return String(src)
    .replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/·/g, '*')
    .replace(/√/g, 'sqrt').replace(/π/g, 'pi').replace(/∞/g, 'Infinity')
    .replace(/²/g, '^2').replace(/³/g, '^3').replace(/⁴/g, '^4')
    .replace(/(\d)\s*,\s*(\d{3}\b)/g, '$1$2'); // 1,000 -> 1000
}

// expression -> TeX for the live preview
function toTex(src) {
  let s = normalize(src);
  s = s.replace(/\bsqrt\s*\(([^()]*)\)/g, '√{$1}');
  s = s.replace(/\b(a?sin|a?cos|a?tan|log|ln|abs|round|floor|ceil|cbrt)\s*\(/g, '\\$1(');
  s = s.replace(/\^\(?([-\d.]+)\)?/g, '^{$1}');
  s = s.replace(/√\{([^{}]*)\}/g, '\\sqrt{$1}');
  s = s.replace(/\*/g, '\\times ');
  s = s.replace(/\bpi\b/g, '\\pi ');
  s = s.replace(/\bInfinity\b/g, '\\infty ');
  return s;
}

const FUNCS = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  ln: Math.log,
  log: (x) => Math.log10(x),
  sin: (x) => Math.sin((x * Math.PI) / 180),
  cos: (x) => Math.cos((x * Math.PI) / 180),
  tan: (x) => Math.tan((x * Math.PI) / 180),
  asin: (x) => (Math.asin(x) * 180) / Math.PI,
  acos: (x) => (Math.acos(x) * 180) / Math.PI,
  atan: (x) => (Math.atan(x) * 180) / Math.PI,
};
const CONSTS = { pi: Math.PI, e: Math.E };
const OPS = {
  '+': { prec: 2, fn: (a, b) => a + b },
  '-': { prec: 2, fn: (a, b) => a - b },
  '*': { prec: 3, fn: (a, b) => a * b },
  '/': { prec: 3, fn: (a, b) => a / b },
  '%': { prec: 3, fn: (a, b) => a % b },
  '^': { prec: 4, right: true, fn: (a, b) => Math.pow(a, b) },
};

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const s = normalize(src).replace(/\s+/g, '');
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let num = '';
      while (i < s.length && /[0-9.]/.test(s[i])) num += s[i++];
      tokens.push({ t: 'num', v: parseFloat(num) });
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let name = '';
      while (i < s.length && /[a-zA-Z]/.test(s[i])) name += s[i++];
      name = name.toLowerCase();
      if (FUNCS[name]) tokens.push({ t: 'func', v: name });
      else if (name in CONSTS) tokens.push({ t: 'num', v: CONSTS[name] });
      else throw new Error(`Unknown name: ${name}`);
      continue;
    }
    if (c === '(') { tokens.push({ t: 'lp' }); i++; continue; }
    if (c === ')') { tokens.push({ t: 'rp' }); i++; continue; }
    if (c === ',') { tokens.push({ t: 'comma' }); i++; continue; }
    if (c in OPS) {
      const prev = tokens[tokens.length - 1];
      const unary = (c === '-' || c === '+') && (!prev || prev.t === 'lp' || prev.t === 'op' || prev.t === 'comma');
      if (unary) { tokens.push({ t: 'num', v: 0 }); }
      tokens.push({ t: 'op', v: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected "${c}"`);
  }
  return tokens;
}

function toRpn(tokens) {
  const out = [];
  const stack = [];
  for (const tok of tokens) {
    if (tok.t === 'num') out.push(tok);
    else if (tok.t === 'func') stack.push(tok);
    else if (tok.t === 'op') {
      while (
        stack.length &&
        stack[stack.length - 1].t === 'op' &&
        (OPS[stack[stack.length - 1].v].prec > OPS[tok.v].prec ||
          (OPS[stack[stack.length - 1].v].prec === OPS[tok.v].prec && !OPS[tok.v].right))
      ) {
        out.push(stack.pop());
      }
      stack.push(tok);
    } else if (tok.t === 'lp') stack.push(tok);
    else if (tok.t === 'rp') {
      while (stack.length && stack[stack.length - 1].t !== 'lp') out.push(stack.pop());
      if (!stack.length) throw new Error('Mismatched parentheses');
      stack.pop();
      if (stack.length && stack[stack.length - 1].t === 'func') out.push(stack.pop());
    } else if (tok.t === 'comma') {
      while (stack.length && stack[stack.length - 1].t !== 'lp') out.push(stack.pop());
    }
  }
  while (stack.length) {
    const s = stack.pop();
    if (s.t === 'lp') throw new Error('Mismatched parentheses');
    out.push(s);
  }
  return out;
}

function evalRpn(rpn) {
  const st = [];
  for (const tok of rpn) {
    if (tok.t === 'num') st.push(tok.v);
    else if (tok.t === 'op') {
      const b = st.pop();
      const a = st.pop();
      if (a === undefined || b === undefined) throw new Error('Malformed expression');
      st.push(OPS[tok.v].fn(a, b));
    } else if (tok.t === 'func') {
      const a = st.pop();
      if (a === undefined) throw new Error('Malformed expression');
      st.push(FUNCS[tok.v](a));
    }
  }
  if (st.length !== 1) throw new Error('Malformed expression');
  return st[0];
}

export function evaluate(src) {
  if (!src || !src.trim()) return '';
  const val = evalRpn(toRpn(tokenize(src)));
  if (!isFinite(val)) return 'undefined';
  return Math.abs(val - Math.round(val)) < 1e-10 ? String(Math.round(val)) : String(Number(val.toFixed(8)));
}

export function initCalculator() {
  const panel = document.getElementById('calcPanel');
  const display = document.getElementById('calcDisplay');
  const result = document.getElementById('calcResult');
  const preview = document.getElementById('calcPreview');
  const toggle = document.getElementById('calcToggle');

  const show = () => { panel.classList.remove('hidden'); display.focus(); };
  const hide = () => panel.classList.add('hidden');
  const isOpen = () => !panel.classList.contains('hidden');

  const recompute = () => {
    const raw = display.value;
    if (preview) {
      try { katex.render(toTex(raw), preview, { throwOnError: false, output: 'html' }); }
      catch { preview.textContent = raw; }
    }
    try {
      const v = evaluate(raw);
      result.textContent = v === '' ? '0' : v;
      result.style.color = 'var(--accent-2)';
    } catch (e) {
      result.textContent = raw.trim() ? '…' : '0';
      result.style.color = 'var(--text-dim)';
    }
  };

  toggle.addEventListener('click', () => (isOpen() ? hide() : show()));
  document.getElementById('calcClose').addEventListener('click', hide);
  document.getElementById('calcClear').addEventListener('click', () => { display.value = ''; recompute(); display.focus(); });
  document.getElementById('calcBack').addEventListener('click', () => { display.value = display.value.slice(0, -1); recompute(); display.focus(); });
  document.getElementById('calcEq').addEventListener('click', () => {
    try {
      const v = evaluate(display.value);
      display.value = v;
      result.textContent = v;
    } catch (e) { result.textContent = 'error: ' + e.message; result.style.color = 'var(--danger)'; }
  });

  panel.querySelectorAll('.calc-keys button[data-k]').forEach((b) => {
    b.addEventListener('click', () => {
      display.value += b.dataset.k;
      recompute();
      display.focus();
    });
  });

  display.addEventListener('input', recompute);
  display.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('calcEq').click();
    if (e.key === 'Escape') hide();
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      isOpen() ? hide() : show();
    }
  });
}
