// Import a real worksheet -> save -> study it end to end (the "does the flashcard
// feature actually work" test).
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

fs.writeFileSync(path.join(app.getPath('userData'), 'data.json'), JSON.stringify({ decks: [] }));
fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ useAI: false, apiKey: '', model: 'x' }));
require('../main.js');
const IMG = path.resolve(process.argv[2] || 'test/fixtures/exponents.pdf');

app.whenReady().then(async () => {
  ipcMain.removeHandler('pick:worksheet');
  ipcMain.handle('pick:worksheet', () => ({ path: IMG, name: path.basename(IMG), ext: path.extname(IMG).toLowerCase(), data: fs.readFileSync(IMG).toString('base64') }));

  let w;
  for (let i = 0; i < 50 && !w; i++) { w = BrowserWindow.getAllWindows()[0]; if (!w) await new Promise((r) => setTimeout(r, 100)); }
  if (w.webContents.isLoading()) await new Promise((r) => w.webContents.once('did-finish-load', r));
  const $ = (j) => w.webContents.executeJavaScript(j, true);
  const wf = async (j, ms = 120000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await $(`!!(${j})`)) return true; } catch {} await new Promise((r) => setTimeout(r, 300)); } return false; };
  const ok = (n, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));

  // import
  await wf(`document.querySelector('.navbtn')`, 8000);
  await $(`document.querySelector('.navbtn[data-view="import"]').click()`);
  await wf(`document.querySelector('.dropzone')`, 4000);
  await $(`document.querySelector('.dropzone').click()`);
  ok('import produced cards', await wf(`document.querySelectorAll('.card-row').length >= 10`));

  const order = await $(`[...document.querySelectorAll('.card-row .n')].map(e=>e.textContent)`);
  ok('cards are in 1,2,3… order', order.slice(0, 5).join(',') === 'Problem 1,Problem 2,Problem 3,Problem 4,Problem 5', order.slice(0, 6).join(' '));

  // save
  await $(`[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Save deck')).click()`);
  ok('deck saved -> deck detail', await wf(`document.querySelector('.card-box')`, 6000));

  // study
  await $(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('▶ Study')).click()`);
  ok('study view opens with a flashcard', await wf(`document.querySelector('.flashcard')`, 6000));
  ok('question is shown', !!(await $(`document.querySelector('.flashcard').innerText.trim()`)));

  // flip
  await $(`document.querySelector('.flashcard').click()`);
  ok('flip reveals the answer side', await wf(`document.querySelector('.side-label').textContent === 'ANSWER'`, 4000));
  ok('grade buttons appear', await $(`!!document.querySelector('.grade-row .good')`));

  // one wrong (requeues), then clear the whole deck
  await $(`document.querySelector('.grade-row .again').click()`);
  await new Promise((r) => setTimeout(r, 200));
  let guard = 0;
  while (guard++ < 60 && !(await $(`!!document.querySelector('.done-screen')`))) {
    await $(`document.querySelector('.flashcard') && document.querySelector('.flashcard').click()`);
    await new Promise((r) => setTimeout(r, 120));
    await $(`(document.querySelector('.grade-row .good')||{click(){}}).click()`);
    await new Promise((r) => setTimeout(r, 140));
  }
  ok('session completes -> done screen', await $(`!!document.querySelector('.done-screen')`));
  const report = await $(`document.getElementById('main').innerText`);
  ok('report lists every problem with an answer', /Problem 1\b/.test(report) && /Correct answer/.test(report));
  ok('requeued (wrong) card counted 2 tries somewhere', /2 tries/.test(report));

  app.exit(0);
});
