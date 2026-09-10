// Pure text-layout reconstruction for worksheet PDFs — no pdf.js, no DOM, so it
// runs in the renderer, in Node tests, and in a future server unchanged.
//
// Input everywhere is an array of positioned glyph runs:
//   { x, y, w, scale, s }   (pdf coords: bigger y = higher up the page)
//
// textFromItems(items, pageWidth) -> a single reading-order string with columns
// un-interleaved, exponents folded in as "base^n", and stacked fractions rebuilt.

/* --------------------------- column detection ------------------------ */
export function columnCuts(items, pageWidth) {
  const W = Math.ceil(pageWidth) + 2;
  const allY = items.map((it) => it.y);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const headerCut = maxY - 0.12 * (maxY - minY);
  const body = items.filter((it) => it.y <= headerCut);
  if (body.length < 8) return [];

  const rowKeys = [...new Set(body.map((it) => Math.round(it.y)))];
  const cov = new Float32Array(W);
  let minX = W;
  let maxX = 0;
  for (const rk of rowKeys) {
    const mark = new Uint8Array(W);
    for (const it of body) {
      if (Math.abs(Math.round(it.y) - rk) > 2) continue;
      const a = Math.max(0, Math.floor(it.x));
      const b = Math.min(W - 1, Math.ceil(it.x + (it.w || 0)));
      for (let x = a; x <= b; x++) mark[x] = 1;
      minX = Math.min(minX, a);
      maxX = Math.max(maxX, b);
    }
    for (let x = 0; x < W; x++) cov[x] += mark[x];
  }
  for (let x = 0; x < W; x++) cov[x] /= rowKeys.length;

  const span = maxX - minX;
  if (span < 100) return [];
  const minGut = Math.max(8, span * 0.035);
  const cuts = [];
  let run = -1;
  for (let x = minX; x <= maxX; x++) {
    if (cov[x] < 0.06) { if (run < 0) run = x; }
    else {
      if (run >= 0 && x - run >= minGut && run - minX > span * 0.12 && maxX - x > span * 0.08) {
        cuts.push(Math.round((run + x) / 2));
      }
      run = -1;
    }
  }
  return cuts;
}

/* ----------------------------- superscripts -------------------------- */
// Fold each small, raised glyph into the base directly to its lower-left.
export function attachSuperscripts(items, bodyScale) {
  const arr = items.map((it) => ({ ...it, gone: false }));
  // exponents first, left to right, so "(x^2)^3" chains correctly
  const exps = arr
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it.scale && it.scale < bodyScale * 0.85)
    .sort((a, b) => a.it.x - b.it.x);

  for (const { it: E } of exps) {
    if (E.gone) continue;
    let best = null;
    let bestGap = Infinity;
    for (const A of arr) {
      if (A === E || A.gone) continue;
      const rightEdge = A.x + (A.w || 0);
      const dy = E.y - A.y; // raised above A
      if (dy < 1 || dy > bodyScale * 0.95) continue;
      const gap = E.x - rightEdge; // ideally small (slightly negative to a few pt)
      if (gap < -(A.w || 4) || gap > Math.max(5, bodyScale * 0.5)) continue;
      const cost = Math.abs(gap) + Math.abs(dy - bodyScale * 0.35);
      if (cost < bestGap) { bestGap = cost; best = A; }
    }
    if (!best) continue;
    let exp = E.s.replace(/[−–—]/g, '-').replace(/\s+/g, '').trim();
    if (!/^-?\d+$/.test(exp)) exp = exp.replace(/[^\d-]/g, '');
    if (!exp || exp === '-') continue;
    best.s = best.s.trimEnd() + '^' + (exp.length > 1 || exp[0] === '-' ? `(${exp})` : exp);
    best.w = Math.max((best.x + (best.w || 0)), E.x + (E.w || 0)) - best.x;
    E.gone = true;
  }
  return arr.filter((it) => !it.gone);
}

// Kuta proportions: "num_L / den_L  =  num_R / den_R" laid out as three rows —
// numerators just above the "=", denominators just below, the "N)" label centred
// on the "=". Re-assemble each into one line: "N) (num_L)/(den_L) = (num_R)/(den_R)".
// A numerator/denominator can be a binomial ("x + 7"), so we join every token in
// the row on the correct side of the "=".
export function assembleProportions(items, bodyScale) {
  const arr = items.map((it) => ({ ...it, gone: false }));
  const band = (bodyScale || 12) * 1.4;
  const cx = (it) => it.x + (it.w || 0) / 2;
  const out = [];

  for (const eq of arr) {
    if (eq.gone || eq.s.trim() !== '=') continue;
    const ex = cx(eq);
    const near = (it) => !it.gone && it !== eq && !it.s.trim().startsWith('{');
    const above = arr.filter((it) => near(it) && it.y > eq.y + 1.5 && it.y < eq.y + band);
    const below = arr.filter((it) => near(it) && it.y < eq.y - 1.5 && it.y > eq.y - band);
    if (!above.length || !below.length) continue; // a plain equation, not a stacked fraction

    const side = (g, left) => g.filter((it) => (left ? cx(it) < ex : cx(it) >= ex)).sort((a, b) => a.x - b.x);
    const join = (g) => g.map((it) => it.s.trim()).join(' ').replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
    const frac = (n, d) => {
      const N = join(n);
      const D = join(d);
      if (N && D) return `(${N})/(${D})`;
      return N || (D ? `1/(${D})` : '?');
    };
    const lNum = side(above, true), lDen = side(below, true);
    const rNum = side(above, false), rDen = side(below, false);
    if ((!lNum.length && !lDen.length) || (!rNum.length && !rDen.length)) continue;

    const label = arr.find((it) => !it.gone && /^\d{1,3}\)$/.test(it.s.trim()) && it.x < eq.x && Math.abs(it.y - eq.y) < band);
    const text = `${label ? label.s.trim() + ' ' : ''}${frac(lNum, lDen)} = ${frac(rNum, rDen)}`;

    for (const it of [...above, ...below]) it.gone = true;
    eq.gone = true;
    if (label) label.gone = true;
    out.push({ x: (label || eq).x, y: eq.y, w: 220, s: text });
  }
  for (const it of arr) if (!it.gone) out.push(it);
  return out;
}

/* ------------------------------- fractions --------------------------- */
export function pairFractions(items) {
  const live = items.map((it) => ({ ...it, dead: false }));
  const result = [];
  for (let i = 0; i < live.length; i++) {
    const A = live[i];
    if (A.dead) continue;
    if (A.s.trim().startsWith('{')) continue; // never fold an answer-key "{ … }"
    const acx = A.x + A.w / 2;
    let best = null;
    for (let j = 0; j < live.length; j++) {
      const B = live[j];
      if (B.dead || B === A) continue;
      const bcx = B.x + B.w / 2;
      const dy = A.y - B.y;
      if (dy < 3 || dy > 24) continue;
      if (B.w > A.w * 1.4 + 6) continue;
      if (bcx < A.x - 3 || bcx > A.x + A.w + 3) continue;
      if (!/^[-+]?\(?[\dA-Za-z][\dA-Za-z^ +\-()]*\)?$/.test(B.s.trim())) continue;
      if (Math.abs(bcx - acx) > A.w * 0.6 + 8) continue;
      if (!best || dy < best.dy) best = { B, dy };
    }
    if (best) {
      best.B.dead = true;
      A.dead = true;
      result.push({
        x: A.x, y: (A.y + best.B.y) / 2, w: Math.max(A.w, best.B.w),
        s: `(${A.s.trim().replace(/^\(|\)$/g, '')})/(${best.B.s.trim().replace(/^\(|\)$/g, '')})`,
      });
    }
  }
  for (const it of live) if (!it.dead) result.push(it);
  return result;
}

// Kuta puts the problem number at the vertical centre of a stacked fraction, so
// the label row sits between the numerator row (above) and denominator row
// (below). Re-assemble those into "N) (numerator)/(denominator)".
function assembleStackedProblems(lines, bodyScale) {
  const near = (a, b) => a && b && Math.abs(a.bbox.y0 - b.bbox.y0) < bodyScale * 2.6;
  const xOverlap = (a, b) => a && b && Math.min(a.bbox.x1, b.bbox.x1) - Math.max(a.bbox.x0, b.bbox.x0) > 4;
  const isProblem = (t) => /^\s*\d{1,3}\)/.test(t);
  const plain = (l) => l && !l.text.includes('=') && !isProblem(l.text) && !ANSWER_LINE.test(l.text);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const m = L.text.match(/^\s*(\d{1,3})\)\s*(.*)$/);
    if (m && !m[2].trim()) {
      const prev = out[out.length - 1];
      const next = lines[i + 1];
      const numOk = plain(prev) && near(prev, L);
      const denOk = plain(next) && near(L, next);
      if (numOk && denOk && xOverlap(prev, next)) {
        out.pop();
        out.push({ text: `${m[1]}) (${prev.text.trim()})/(${next.text.trim()})`, bbox: { ...prev.bbox } });
        i++;
        continue;
      }
      if (denOk) {
        out.push({ text: `${m[1]}) ${next.text.trim()}`, bbox: { ...next.bbox } });
        i++;
        continue;
      }
      if (numOk) {
        out.pop();
        out.push({ text: `${m[1]}) ${prev.text.trim()}`, bbox: { ...prev.bbox } });
        continue;
      }
    }
    out.push(L);
  }
  return out;
}

function mergeStackedFractions(colLines) {
  const out = [];
  for (let i = 0; i < colLines.length; i++) {
    const cur = colLines[i];
    const nxt = colLines[i + 1];
    if (nxt && cur.text && nxt.text) {
      const cw = cur.bbox.x1 - cur.bbox.x0 || 1;
      const denom = nxt.text.trim();
      const denomLike = /^-?\d{1,3}[a-z]?(\^\(?-?\d+\)?)?$|^\([^()]{1,16}\)$/.test(denom);
      const startsLeft = nxt.bbox.x0 <= cur.bbox.x0 + cw * 0.35;
      const contained = nxt.bbox.x1 <= cur.bbox.x1 + cw * 0.1;
      const numShort = cur.text.replace(/\s*=.*/, '').trim().length <= 18;
      if (denomLike && startsLeft && contained && numShort && /[a-z0-9]/i.test(cur.text)) {
        const m = cur.text.match(/^(.*?)(\s*=\s*.*)$/);
        const numer = (m ? m[1] : cur.text).trim();
        const tail = m ? m[2] : '';
        out.push({ text: `(${numer})/(${denom.replace(/^\(|\)$/g, '')})${tail}`, bbox: cur.bbox });
        i++;
        continue;
      }
    }
    out.push(cur);
  }
  return out;
}

/* ---------------------------- column reflow ------------------------- */
export function reflowColumns(lines, pageWidth) {
  const valid = lines.filter((l) => l.text && l.text.trim());
  if (valid.length < 5) return valid.sort((a, b) => a.bbox.y0 - b.bbox.y0).map((l) => l.text.trim()).join('\n');
  const pageW = pageWidth || (Math.max(...valid.map((l) => l.bbox.x1)) - Math.min(...valid.map((l) => l.bbox.x0)));
  const bodyLines = valid.filter((l) => l.bbox.x1 - l.bbox.x0 < pageW * 0.55);
  const xs = (bodyLines.length >= 4 ? bodyLines : valid).map((l) => l.bbox.x0).sort((a, b) => a - b);
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const gap = pageW * 0.1;
  const centers = [];
  let cur = [xs[0]];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] > gap) { centers.push(avg(cur)); cur = []; }
    cur.push(xs[i]);
  }
  centers.push(avg(cur));
  const single = centers.length < 2;
  const cols = (single ? [0] : centers).map(() => []);
  for (const l of valid) {
    if (single) { cols[0].push(l); continue; }
    let bi = 0, bd = Infinity;
    centers.forEach((c, ci) => { const d = Math.abs(l.bbox.x0 - c); if (d < bd) { bd = d; bi = ci; } });
    cols[bi].push(l);
  }
  return cols
    .map((col) => mergeStackedFractions(col.sort((a, b) => a.bbox.y0 - b.bbox.y0)).map((l) => l.text.trim()).join('\n'))
    .filter(Boolean)
    .join('\n\n');
}

// Drop the diagonal anti-copy watermark Kuta stamps along the page bottom, plus
// footers / page numbers that otherwise glue onto the last problem.
function dropPageFurniture(items) {
  if (!items.length) return items;
  const maxY = Math.max(...items.map((it) => it.y));
  const minY = Math.min(...items.map((it) => it.y));
  const bottom = minY + (maxY - minY) * 0.035;
  return items.filter((it) => {
    const s = String(it.s).trim();
    if (/worksheet by kuta|infinite (algebra|geometry|pre-?algebra)|kutasoftware\.com/i.test(s)) return false;
    if (/^-\s*\d+\s*-$/.test(s)) return false;
    if (/^(name|date|period|score|class|hour|teacher)[\s_]*_*$/i.test(s)) return false;
    if (/_{3,}/.test(s)) return false; // fill-in-the-blank rules
    // dense tiny text hugging the very bottom edge = watermark
    if (it.y <= bottom && (it.scale || 12) < 8) return false;
    return true;
  });
}

function modeScale(items) {
  const hist = new Map();
  for (const it of items) {
    const k = Math.round(it.scale || 12);
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  let best = 12;
  let bestN = -1;
  for (const [k, n] of hist) if (n > bestN || (n === bestN && k > best)) { best = k; bestN = n; }
  return best;
}

// Kuta answer-key PDFs print the solution as "{ 36 }" on its own row, right
// under the problem. The braces and the number are separate glyph runs, so the
// bare number lines up under the equation and the fraction assemblers turn
// "20 = 1 + 5a + 4" over "{ 3 }" into "(20)/(3)". Fuse each "{ … }" run into one
// atom so nothing downstream can pair with the number inside it.
export function collapseBraces(items) {
  const rows = new Map();
  for (const it of items) {
    const yk = Math.round(it.y);
    let k = null;
    for (const key of rows.keys()) if (Math.abs(key - yk) <= 3) { k = key; break; }
    if (k == null) { k = yk; rows.set(yk, []); }
    rows.get(k).push(it);
  }
  const out = [];
  for (const parts of rows.values()) {
    parts.sort((a, b) => a.x - b.x);
    let i = 0;
    while (i < parts.length) {
      if (parts[i].s.trim() === '{') {
        let j = i + 1;
        while (j < parts.length && parts[j].s.trim() !== '}') j++;
        if (j < parts.length) {
          const run = parts.slice(i, j + 1);
          const inner = run.slice(1, -1).map((p) => p.s.trim()).join(' ').replace(/\s+/g, ' ').trim();
          const last = run[run.length - 1];
          out.push({ x: run[0].x, y: run[0].y, w: last.x + (last.w || 0) - run[0].x, scale: run[0].scale, s: `{${inner}}` });
          i = j + 1;
          continue;
        }
      }
      out.push(parts[i]);
      i++;
    }
  }
  return out;
}

const ANSWER_LINE = /^\s*(\{[^{}]*\}|No solutions?\.?|All real numbers\.?|Infinitely many solutions\.?)\s*$/i;

/* ------------------------------- top level -------------------------- */
export function textFromItems(items, pageWidth) {
  items = collapseBraces(dropPageFurniture(items.filter((it) => it.s && String(it.s).trim())));
  if (!items.length) return '';

  const bodyScale = modeScale(items);

  const cuts = columnCuts(items, pageWidth);
  const colOf = (x) => { let i = 0; while (i < cuts.length && x >= cuts[i]) i++; return i; };
  const buckets = Array.from({ length: cuts.length + 1 }, () => []);
  for (const it of items) buckets[colOf(it.x + it.w / 2)].push(it);

  // "Kuta-style" pages have real superscripts; there `assembleStackedProblems`
  // handles the fractions and item-level pairing only causes damage.
  const superHeavy = items.filter((it) => (it.scale || 12) < bodyScale * 0.85).length >= 6;

  const out = [];
  for (const colItems of buckets) {
    const supered = attachSuperscripts(assembleProportions(colItems, bodyScale), bodyScale);
    const glyphs = superHeavy ? supered : pairFractions(supered);
    const rows = new Map();
    for (const it of glyphs) {
      const yk = Math.round(it.y);
      let bucket = null;
      for (const key of rows.keys()) if (Math.abs(key - yk) <= 3) { bucket = key; break; }
      if (bucket == null) { bucket = yk; rows.set(yk, []); }
      rows.get(bucket).push(it);
    }
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([y, parts]) => {
        parts.sort((a, b) => a.x - b.x);
        const last = parts[parts.length - 1];
        return { text: parts.map((p) => p.s).join(' ').replace(/\s+/g, ' ').trim(), bbox: { x0: parts[0].x, x1: last.x + last.w, y0: -y } };
      })
      .filter((l) => l.text);
    const assembled = assembleStackedProblems(lines, bodyScale);
    const merged = mergeStackedFractions(assembled).map((l) => l.text.trim());
    if (merged.length) out.push(merged.join('\n'));
  }
  return out.join('\n\n');
}

// Convenience for callers holding a pdf.js textContent object.
export function itemsFromContent(content) {
  return content.items
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({
      x: it.transform[4],
      y: it.transform[5],
      w: it.width || 0,
      scale: Math.hypot(it.transform[2] || 0, it.transform[3] || 0) || 12,
      s: it.str,
    }));
}
