import * as pdfjsLib from '../node_modules/pdfjs-dist/build/pdf.min.mjs';
import { ocrRecognize } from './store.js';
import { textFromItems, itemsFromContent, reflowColumns } from './pdftext.js';

export { reflowColumns };

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href;

function b64ToUint8(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

async function renderPageToDataUrl(page, scale = 2.4) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/png');
}

function toDisplayJpeg(dataUrl, maxW = 1100) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/* ------------------------ column-aware OCR for images ------------------- */
// Look at the vertical whitespace of the page and split it into column bands,
// so a 2- or 3-column worksheet is read one column at a time instead of straight
// across (which scrambles the problems).
function detectColumnBands(canvas) {
  const { width: W, height: H } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, W, H).data;
  const y0 = Math.floor(H * 0.14); // skip the title band
  const y1 = Math.floor(H * 0.97);
  const ink = new Float32Array(W);
  const rows = Math.max(1, Math.floor((y1 - y0) / 2));
  for (let x = 0; x < W; x++) {
    let dark = 0;
    for (let y = y0; y < y1; y += 2) {
      const idx = (y * W + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      if (lum < 165 && data[idx + 3] > 10) dark++;
    }
    ink[x] = dark / rows;
  }
  let left = 0;
  while (left < W && ink[left] < 0.004) left++;
  let right = W - 1;
  while (right > left && ink[right] < 0.004) right--;
  const span = right - left;
  if (span < 60) return [[0, W]];

  const minGutter = Math.max(14, span * 0.028);
  const raw = [];
  let bandStart = left;
  let runStart = -1;
  for (let x = left; x <= right; x++) {
    const blank = ink[x] < 0.005;
    if (blank) { if (runStart < 0) runStart = x; }
    else {
      if (runStart >= 0 && x - runStart >= minGutter && runStart - bandStart > span * 0.12) {
        raw.push([bandStart, runStart]);
        bandStart = x;
      }
      runStart = -1;
    }
  }
  raw.push([bandStart, right]);
  const bands = raw.filter(([a, b]) => b - a > span * 0.12);
  if (bands.length <= 1) return [[left, right]];
  // give each column the full gutter on both sides so nothing gets clipped
  return bands.map(([a, b], i) => [
    i > 0 ? Math.round((bands[i - 1][1] + a) / 2) : Math.max(0, a - 12),
    i < bands.length - 1 ? Math.round((b + bands[i + 1][0]) / 2) : Math.min(W, b + 12),
  ]);
}

async function ocrImageSmart(dataUrl, onStatus) {
  const img = await loadImage(dataUrl);
  const up = img.width < 1600 ? 2 : 1;
  const base = document.createElement('canvas');
  base.width = img.width * up;
  base.height = img.height * up;
  const bctx = base.getContext('2d');
  bctx.fillStyle = '#fff';
  bctx.fillRect(0, 0, base.width, base.height);
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(img, 0, 0, base.width, base.height);

  const bands = detectColumnBands(base);

  if (bands.length <= 1) {
    onStatus('Reading worksheet…', 0.4);
    const r = await ocrRecognize(base.toDataURL('image/png'));
    return r.text || '';
  }

  onStatus(`Reading ${bands.length} columns…`, 0.15);
  const parts = [];
  for (let i = 0; i < bands.length; i++) {
    const [a, b] = bands[i];
    const pad = 10;
    const x0 = Math.max(0, a - pad);
    const w = Math.min(base.width, b + pad) - x0;
    const strip = document.createElement('canvas');
    strip.width = w;
    strip.height = base.height;
    const sctx = strip.getContext('2d');
    sctx.fillStyle = '#fff';
    sctx.fillRect(0, 0, w, base.height);
    sctx.drawImage(base, x0, 0, w, base.height, 0, 0, w, base.height);
    onStatus(`Reading column ${i + 1} of ${bands.length}…`, (i + 1) / (bands.length + 1));
    const r = await ocrRecognize(strip.toDataURL('image/png'), 4); // PSM 4: single column, variable sizes
    if (r.text && r.text.trim()) parts.push(r.text.trim());
  }
  return parts.join('\n\n');
}


/* ------------------------------- entry -------------------------------- */
export async function worksheetToPages(file, onStatus) {
  const pages = [];

  if (file.ext === '.pdf') {
    onStatus('Opening PDF…', 0.05);
    const pdf = await pdfjsLib.getDocument({ data: b64ToUint8(file.data) }).promise;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      let text = textFromItems(itemsFromContent(content), page.getViewport({ scale: 1 }).width);
      const image = await renderPageToDataUrl(page);

      if (text.replace(/\s/g, '').length < 40) {
        onStatus(`Page ${p}/${pdf.numPages}: scanned page, running OCR…`, p / pdf.numPages);
        text = await ocrImageSmart(image, (m, f) => onStatus(`Page ${p}/${pdf.numPages}: ${m}`, f));
      } else {
        onStatus(`Page ${p}/${pdf.numPages}: read embedded text`, p / pdf.numPages);
      }
      pages.push({ index: p, text, image, display: await toDisplayJpeg(image) });
    }
    flagAnswerKeyPages(pages);
  } else {
    const dataUrl = `data:image/${file.ext.replace('.', '')};base64,${file.data}`;
    const text = await ocrImageSmart(dataUrl, onStatus);
    pages.push({ index: 1, text, image: dataUrl, display: await toDisplayJpeg(dataUrl) });
  }

  onStatus('Done reading worksheet.', 1);
  return pages;
}

// Kuta (and similar) PDFs append answer-key pages that repeat the problem
// numbers. Mark those so they don't become a second set of cards.
function flagAnswerKeyPages(pages) {
  const nums = (t) => {
    const s = new Set();
    for (const m of (t || '').matchAll(/(?:^|\n)\s*(\d{1,3})[.)]/g)) s.add(m[1]);
    return s;
  };
  const sets = pages.map((p) => nums(p.text));
  for (let i = 1; i < pages.length; i++) {
    if (sets[i].size < 3) continue;
    for (let j = 0; j < i; j++) {
      if (pages[j].isAnswerKey) continue;
      let common = 0;
      for (const n of sets[i]) if (sets[j].has(n)) common++;
      if (common / sets[i].size > 0.6) { pages[i].isAnswerKey = true; break; }
    }
  }
}
