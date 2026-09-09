// Node worksheet import: PDF / image -> pages + candidate cards, with answers
// worked out by Volt's own math engine. Mirrors src/ocr.js but server-side.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';
import { createCanvas } from '@napi-rs/canvas';
import Tesseract from 'tesseract.js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import { textFromItems, itemsFromContent } from '../shared/pdftext.js';
import { splitProblems, classify } from '../shared/parser.js';
import { solve } from '../shared/solve.js';
import { simplify } from '../shared/exponents.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(here, '..', 'assets');
const TESS_CACHE = path.join(here, '..', 'data', '.tessdata');

pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(here, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs')
).href;

const autoAnswer = (q) => solve(q) || simplify(q);

/* ------------------------------- OCR (Node) --------------------------- */
let ocrWorker = null;
async function getOcr() {
  if (ocrWorker) return ocrWorker;
  fs.mkdirSync(TESS_CACHE, { recursive: true });
  const out = path.join(TESS_CACHE, 'eng.traineddata');
  if (!fs.existsSync(out) || fs.statSync(out).size < 1e6) {
    fs.writeFileSync(out, zlib.gunzipSync(fs.readFileSync(path.join(ASSETS, 'eng.traineddata.gz'))));
  }
  ocrWorker = await Tesseract.createWorker('eng', 1, { langPath: ASSETS, cachePath: TESS_CACHE, gzip: true });
  return ocrWorker;
}
export async function shutdown() {
  if (ocrWorker) { try { await ocrWorker.terminate(); } catch {} ocrWorker = null; }
}

async function ocrBuffer(buf, psm = 3) {
  const w = await getOcr();
  await w.setParameters({ tessedit_pageseg_mode: String(psm) });
  const { data } = await w.recognize(buf, {}, { text: true });
  return data.text || '';
}

/* --------------------------- PDF page rendering ---------------------- */
async function renderPage(page, scale = 2.2) {
  const vp = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvasFactory: nodeCanvasFactory }).promise;
  return canvas;
}
const nodeCanvasFactory = {
  create(w, h) { const canvas = createCanvas(w, h); return { canvas, context: canvas.getContext('2d') }; },
  reset(cc, w, h) { cc.canvas.width = w; cc.canvas.height = h; },
  destroy(cc) { cc.canvas.width = 0; cc.canvas.height = 0; },
};

function toJpeg(canvas, maxW = 1000) {
  const scale = Math.min(1, maxW / canvas.width);
  if (scale === 1) return 'data:image/jpeg;base64,' + canvas.toBuffer('image/jpeg', 0.72).toString('base64');
  const c = createCanvas(Math.round(canvas.width * scale), Math.round(canvas.height * scale));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  return 'data:image/jpeg;base64,' + c.toBuffer('image/jpeg', 0.72).toString('base64');
}

/* ---------------------- answer-key page detection ------------------- */
function flagAnswerKeys(texts) {
  const nums = (t) => new Set([...String(t).matchAll(/(?:^|\n)\s*(\d{1,3})[.)]/g)].map((m) => m[1]));
  const sets = texts.map(nums);
  return texts.map((_, i) => {
    if (i === 0 || sets[i].size < 3) return false;
    return sets.slice(0, i).some((s) => {
      let c = 0;
      for (const n of sets[i]) if (s.has(n)) c++;
      return c / sets[i].size > 0.6;
    });
  });
}

/* ------------------------------- entry ------------------------------ */
// file: { buffer, name, ext (".pdf"/".png"/…) }
// onStatus(msg)
export async function importWorksheet(file, onStatus = () => {}) {
  const ext = (file.ext || path.extname(file.name) || '').toLowerCase();
  const rawPages = [];

  if (ext === '.pdf') {
    onStatus('Reading PDF…');
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(file.buffer), canvasFactory: nodeCanvasFactory }).promise;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const w = page.getViewport({ scale: 1 }).width;
      let text = textFromItems(itemsFromContent(content), w);
      const canvas = await renderPage(page);
      if (text.replace(/\s/g, '').length < 40) {
        onStatus(`Page ${p}/${pdf.numPages}: scanned — running OCR…`);
        text = await ocrBuffer(canvas.toBuffer('image/png'));
      } else {
        onStatus(`Page ${p}/${pdf.numPages}: read`);
      }
      rawPages.push({ index: p, text, image: toJpeg(canvas) });
    }
  } else {
    onStatus('Running OCR…');
    const text = await ocrBuffer(file.buffer);
    const dataUrl = `data:image/${ext.replace('.', '') || 'png'};base64,` + Buffer.from(file.buffer).toString('base64');
    rawPages.push({ index: 1, text, image: dataUrl });
  }

  const keyFlags = flagAnswerKeys(rawPages.map((p) => p.text));
  const pages = rawPages.filter((_, i) => !keyFlags[i]);
  const keyPages = rawPages.filter((_, i) => keyFlags[i]);

  // answers from a dedicated key page (Kuta-style)
  const key = {};
  for (const kp of keyPages) {
    for (const c of splitProblems(kp.text)) {
      const lines = c.question.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length >= 2) key[c.number] = lines.slice(1).join(' ');
    }
  }

  const candidates = [];
  for (const page of pages) {
    for (const c of splitProblems(page.text)) {
      const solved = !c.answer ? autoAnswer(c.question) : null;
      const question = (solved && solved.question) || c.question;
      let answer = c.answer;
      let source = c.answer ? 'key' : '';
      if (!answer && solved) { answer = solved.answer; source = 'solved'; }
      if (!answer && key[c.number]) { answer = key[c.number]; source = 'key'; }
      candidates.push({ number: c.number, question, answer: answer || '', answerSource: source, hint: '', typeLabel: classify(question).label, page: page.index });
    }
  }
  // put cards in problem-number order (not column-reading order)
  candidates.sort((a, b) => (a.number || 1e6) - (b.number || 1e6));

  onStatus('Done.');
  return {
    pages: pages.map((p) => ({ index: p.index, image: p.image })),
    candidates,
    keyPageCount: keyPages.length,
  };
}
