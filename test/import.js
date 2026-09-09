// End-to-end import test: feeds a real worksheet image through the renderer's
// OCR -> split -> review -> save pipeline and checks a deck is produced.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

process.on('unhandledRejection', (e) => { console.log('UNHANDLED ' + (e && e.stack || e)); });

fs.writeFileSync(path.join(app.getPath('userData'), 'data.json'), JSON.stringify({ decks: [] }));
fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ apiKey: '', model: 'x', useAI: false }));
require('../main.js');

const IMG = process.argv[2] || path.join(__dirname, 'fixtures', 'ws.png');

app.whenReady().then(async () => {
  ipcMain.removeHandler('pick:worksheet');
  ipcMain.handle('pick:worksheet', () => ({
    path: IMG, name: path.basename(IMG), ext: path.extname(IMG).toLowerCase(),
    data: fs.readFileSync(IMG).toString('base64'),
  }));

  let win;
  for (let i = 0; i < 50 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; if (!win) await new Promise((r) => setTimeout(r, 100)); }
  if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));
  win.webContents.on('console-message', (_e, _l, m) => console.log('  [renderer] ' + m));
  const $ = (js) => win.webContents.executeJavaScript(js, true);
  const waitFor = async (js, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await $(`!!(${js})`)) return true; } catch {} await new Promise((r) => setTimeout(r, 300)); }
    return false;
  };

  const R = [];
  const ok = (n, c, x = '') => { R.push(c); console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  — ' + x : '')); };

  try {
    await waitFor(`document.querySelector('.navbtn')`, 10000);
    await $(`document.querySelector('.navbtn[data-view="import"]').click()`);
    await waitFor(`document.querySelector('.dropzone')`, 5000);
    await $(`document.querySelector('.dropzone').click()`);
    console.log('  ...worksheet picked, running OCR (can take ~30s)');

    const gotList = await waitFor(`document.querySelectorAll('.card-row').length >= 3`, 90000);
    ok('OCR + parse produced a review list', gotList);
    if (!gotList) {
      console.log('  status line: ' + await $(`(document.querySelector('.status-line')||{}).textContent`).catch(() => '?'));
      console.log('  main text: ' + (await $(`document.getElementById('main').innerText`).catch(() => '?')).slice(0, 300));
    } else {
      const n = await $(`document.querySelectorAll('.card-row').length`);
      ok('found several problems', n >= 5, `${n} cards`);
      const firstQ = await $(`(document.querySelector('.card-row textarea')||{}).value || ''`);
      ok('first card has a question', firstQ.length > 4, JSON.stringify(firstQ.slice(0, 60)));
      const tags = await $(`[...document.querySelectorAll('.card-row .tag')].map(t=>t.textContent)`);
      ok('cards were classified', tags.some((t) => t && t !== 'General problem'), tags.join(' | '));

      await $(`[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Save deck')).click()`);
      ok('deck saved -> deck detail', await waitFor(`document.querySelector('.card-box')`, 5000));
      const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'data.json'), 'utf8'));
      ok('deck persisted to disk', saved.decks.length === 1 && saved.decks[0].cards.length >= 5, `${saved.decks[0] && saved.decks[0].cards.length} cards`);
    }
  } catch (e) {
    ok('no exception', false, e.stack || String(e));
  }

  console.log(`\n${R.filter(Boolean).length}/${R.length} passed`);
  app.exit(R.length && R.every(Boolean) ? 0 : 1);
});
