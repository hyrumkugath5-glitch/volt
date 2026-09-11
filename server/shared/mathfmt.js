import katex from '/vendor/katex/katex.mjs';

// Argon keeps rendering conservative: plain algebra ("2x + 4 = 10", "(x-3)(x+3)")
// stays literal and predictable; only notation that is genuinely hard to read in
// plain text — exponents, roots, fractions, symbols — is typeset with KaTeX.

function tokenToTex(raw) {
  let s = raw.trim();
  s = s.replace(/sqrt\s*\(([^()]*)\)/gi, '\\sqrt{$1}');
  s = s.replace(/cbrt\s*\(([^()]*)\)/gi, '\\sqrt[3]{$1}');
  s = s.replace(/√\s*\(([^()]*)\)/g, '\\sqrt{$1}');
  s = s.replace(/√\s*([0-9.]+)/g, '\\sqrt{$1}');
  s = s.replace(/\^\s*\(([^()]*)\)/g, '^{$1}');
  s = s.replace(/\^\s*(-?[0-9a-zA-Z.]+)/g, '^{$1}');
  s = s.replace(/(\d+)\s*\/\s*(\d+)/g, '\\frac{$1}{$2}');
  s = s.replace(/\bpi\b/gi, '\\pi');
  s = s.replace(/<=/g, '\\le').replace(/>=/g, '\\ge').replace(/\+\/-|±/g, '\\pm');
  s = s.replace(/°/g, '^{\\circ}');
  s = s.replace(/\*/g, '\\cdot ');
  return s;
}

// A token worth typesetting: has an exponent, root, fraction, or a math symbol.
const TOKEN_RE = /(\$[^$]+\$|\b[0-9a-zA-Z().]*\^[0-9a-zA-Z().{}\-]+|sqrt\s*\([^()]*\)|√\s*\(?[0-9a-zA-Z.]+\)?|\b\d+\/\d+\b|[a-zA-Z0-9.]+°|≤|≥|±)/g;

function renderTokenInto(span, token) {
  const tex = token.startsWith('$') && token.endsWith('$') ? token.slice(1, -1) : token;
  try {
    katex.render(tokenToTex(tex), span, { throwOnError: false, displayMode: false, output: 'html' });
  } catch {
    span.textContent = token;
  }
}

export function looksMathy(str) {
  return /[=^]|sqrt|√|\d\/\d|≤|≥|±|°/.test(str || '');
}

// Render a whole string as one equation (used where we know it is one, e.g. the
// candidate-readings panel). Handles (a)/(b) fractions.
// split "A / B" at the top level (ignoring / inside parentheses)
function splitTopSlash(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '/' && depth === 0) return [s.slice(0, i), s.slice(i + 1)];
  }
  return null;
}
function stripOuterParens(s) {
  s = s.trim();
  if (s[0] !== '(' || s[s.length - 1] !== ')') return s;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (depth === 0 && i < s.length - 1) return s; }
  }
  return stripOuterParens(s.slice(1, -1));
}
function toTexExpr(raw) {
  let s = String(raw || '').trim();
  // only fold "a/b" into a fraction when the whole thing is one expression —
  // never across an "=" ("x = -7/2" is an equation, not a fraction)
  if (!/=/.test(s)) {
    const parts = splitTopSlash(s);
    if (parts && !/=/.test(parts[0]) && !/=/.test(parts[1])) {
      return `\\frac{${toTexExpr(stripOuterParens(parts[0]))}}{${toTexExpr(stripOuterParens(parts[1]))}}`;
    }
  }
  s = s.replace(/(\d+)\s*\/\s*(\d+)/g, '\\frac{$1}{$2}'); // simple numeric fractions inline
  s = s.replace(/sqrt\s*\(([^()]*)\)/gi, '\\sqrt{$1}').replace(/√\s*\(?([0-9a-z.]+)\)?/gi, '\\sqrt{$1}');
  // an exponent is a (...) group, a {..} group, a signed number, OR a single
  // letter — NOT a greedy run ("p^2q^2" is p²·q², not p^(2q)^2)
  s = s.replace(/\^\s*\(([^()]*)\)/g, '^{$1}');
  s = s.replace(/\^\s*(-?\d+(?:\.\d+)?)/g, '^{$1}');
  s = s.replace(/\^\s*(-?)([a-z])/gi, '^{$1$2}');
  s = s.replace(/\bpi\b/gi, '\\pi').replace(/±/g, '\\pm ').replace(/[*·∙⋅]/g, '\\cdot ');
  s = s.replace(/<=/g, '\\le ').replace(/>=/g, '\\ge ');
  return s;
}
export function renderExpr(container, str) {
  container.innerHTML = '';
  // throwOnError:true so a bad expression falls through to readable plain text
  // instead of KaTeX's red raw-source rendering
  try {
    katex.render(toTexExpr(str), container, { throwOnError: true, displayMode: false, output: 'html' });
    return;
  } catch {}
  try {
    katex.render(toTexExpr(str), container, { throwOnError: false, output: 'html' });
    if (!container.querySelector('.katex-error')) return;
  } catch {}
  // last resort: light plain-text formatting (^ -> superscript, keep it legible)
  container.innerHTML = '';
  container.append(prettyText(String(str || '')));
}

function prettyText(s) {
  const frag = document.createDocumentFragment();
  const re = /\^(\(-?\d+\)|-?\d+|[a-z])/gi;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) frag.append(document.createTextNode(s.slice(last, m.index)));
    const sup = document.createElement('sup');
    sup.textContent = m[1].replace(/[()]/g, '');
    frag.append(sup);
    last = m.index + m[0].length;
  }
  if (last < s.length) frag.append(document.createTextNode(s.slice(last)));
  return frag;
}

// Best rendering for a flashcard question/answer. A bare expression (no prose)
// is typeset whole; a worded problem keeps its layout.
export function renderQuestion(container, str) {
  const s = String(str || '').replace(/\s*\n\s*/g, ' ').trim();
  const hasProse = /[a-z]{3,}/.test(s.replace(/\b(sqrt|cbrt|sin|cos|tan|log|ln|pi|abs|and|or|deg|no|real|solution|unique)\b/gi, ''));
  // whole-expression typeset only for a bare expression: no prose, no "=",
  // no "x = 5 or x = -2" style answers
  const isExpr = !hasProse && !/=|≤|≥| or |≈|solution/i.test(s) && /[\^/]|·|∙|⋅|√/.test(s);
  if (isExpr) renderExpr(container, s);
  else renderMath(container, s);
}

export function renderMath(container, str) {
  container.innerHTML = '';
  if (str == null || str === '') return;
  const lines = String(str).split(/\n/);

  lines.forEach((line, li) => {
    const div = document.createElement('div');
    let last = 0;
    let m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(line))) {
      if (m.index > last) div.append(document.createTextNode(line.slice(last, m.index)));
      const span = document.createElement('span');
      renderTokenInto(span, m[0]);
      div.append(span);
      last = m.index + m[0].length;
    }
    if (last < line.length) div.append(document.createTextNode(line.slice(last)));
    if (!line) div.append(document.createTextNode('\u00a0'));
    container.append(div);
  });
}
