const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const Tesseract = require('tesseract.js');

// pdftext.js is ESM; this Electron's Node can't require() ESM, so load it lazily.
let _pdftext = null;
const pdftext = async () => (_pdftext ||= await import('./src/pdftext.js'));

const DATA_DIR = app.getPath('userData');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const TESS_CACHE = path.join(DATA_DIR, 'tessdata');

// tesseract.js's node worker tries to `fetch()` the language file when it thinks
// it is running under Electron (which it is). We sidestep that entirely by
// decompressing the bundled traineddata into tesseract's cache dir first — the
// worker then loads it straight from disk and never touches the network.
function ensureTessData() {
  fs.mkdirSync(TESS_CACHE, { recursive: true });
  const out = path.join(TESS_CACHE, 'eng.traineddata');
  if (!fs.existsSync(out) || fs.statSync(out).size < 1000000) {
    const gz = fs.readFileSync(path.join(__dirname, 'assets', 'eng.traineddata.gz'));
    fs.writeFileSync(out, zlib.gunzipSync(gz));
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0f1420',
    title: 'Argon',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (process.env.ARGON_DEBUG) {
    win.webContents.openDevTools({ mode: 'detach' });
    win.webContents.on('render-process-gone', (_e, d) => console.error('renderer gone:', d));
  }

  // ARGON_SELFTEST=<pdf/img> — headless: read a worksheet through the real
  // pipeline, print the result, exit. Proves a packaged build actually works.
  if (process.env.ARGON_SELFTEST) {
    win.webContents.once('did-finish-load', async () => {
      const p = process.env.ARGON_SELFTEST;
      try {
        const data = fs.readFileSync(p).toString('base64');
        const file = { path: p, name: path.basename(p), ext: path.extname(p).toLowerCase(), data };
        const out = await win.webContents.executeJavaScript(
          `(async () => {
             const { worksheetToPages } = await import('./ocr.js');
             const { splitProblems } = await import('./parser.js');
             const { solve } = await import('./solve.js');
             const { simplify } = await import('./exponents.js');
             const pages = await worksheetToPages(${JSON.stringify(file)}, () => {});
             const cards = [];
             for (const pg of pages.filter(x => !x.isAnswerKey)) for (const c of splitProblems(pg.text)) cards.push(c);
             const solved = cards.filter(c => c.answer || solve(c.question) || simplify(c.question)).length;
             return { pages: pages.length, cards: cards.length, solved, first: (cards[0]||{}).question };
           })()`, true);
        console.log('SELFTEST_OK ' + JSON.stringify(out));
        app.exit(out.cards > 0 && out.solved > 0 ? 0 : 1);
      } catch (e) {
        console.log('SELFTEST_FAIL ' + (e && e.message));
        app.exit(1);
      }
    });
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: persistence ----
ipcMain.handle('data:load', () => readJson(DATA_FILE, { decks: [] }));
ipcMain.handle('data:save', (_e, data) => {
  writeJson(DATA_FILE, data);
  return true;
});
ipcMain.handle('settings:load', () =>
  readJson(SETTINGS_FILE, { apiKey: '', model: 'claude-haiku-4-5-20251001', useAI: false })
);
ipcMain.handle('settings:save', (_e, s) => {
  writeJson(SETTINGS_FILE, s);
  return true;
});

// ---- IPC: file picking ----
ipcMain.handle('pick:worksheet', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose a worksheet (PDF or image)',
    properties: ['openFile'],
    filters: [
      { name: 'Worksheets', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp'] },
    ],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const p = res.filePaths[0];
  const buf = fs.readFileSync(p);
  return { path: p, name: path.basename(p), ext: path.extname(p).toLowerCase(), data: buf.toString('base64') };
});

ipcMain.handle('export:deck', async (_e, { name, text }) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Export deck',
    defaultPath: `${name || 'deck'}.txt`,
    filters: [{ name: 'Text', extensions: ['txt'] }],
  });
  if (res.canceled || !res.filePath) return false;
  fs.writeFileSync(res.filePath, text, 'utf8');
  shell.showItemInFolder(res.filePath);
  return true;
});

// ---- IPC: offline OCR (runs in main / Node so language data loads from disk) ----
let ocrWorker = null;
async function getOcrWorker(onProgress) {
  if (ocrWorker) return ocrWorker;
  ensureTessData();
  ocrWorker = await Tesseract.createWorker('eng', 1, {
    langPath: path.join(__dirname, 'assets'),
    cachePath: TESS_CACHE,
    gzip: true,
    logger: (m) => {
      if (onProgress && m.status) onProgress(m);
    },
  });
  return ocrWorker;
}

let ocrChain = Promise.resolve();
ipcMain.handle('ocr:recognize', (e, { dataUrl, psm }) => {
  const run = async () => {
    const send = (m) => { try { e.sender.send('ocr:progress', m); } catch {} };
    const worker = await getOcrWorker(send);
    await worker.setParameters({ tessedit_pageseg_mode: String(psm || 3) });
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    const { data } = await worker.recognize(buf, {}, { text: true, blocks: true });
    const lines = (data.lines || []).map((l) => ({ text: l.text, bbox: l.bbox }));
    // For a whole-page pass, still try to un-interleave columns from line boxes.
    let text = data.text;
    if (!psm || psm === 3) {
      try { text = (await pdftext()).reflowColumns(lines) || data.text; } catch {}
    }
    return { text, rawText: data.text, confidence: data.confidence };
  };
  ocrChain = ocrChain.then(run, run);
  return ocrChain;
});

app.on('before-quit', async () => {
  if (ocrWorker) { try { await ocrWorker.terminate(); } catch {} }
});

// ---- IPC: optional AI passthrough (main process avoids CORS) ----
ipcMain.handle('ai:call', async (_e, { apiKey, model, system, content }) => {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content }],
    }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error ? json.error.message : `HTTP ${resp.status}`);
  return json.content.map((c) => c.text || '').join('');
});
