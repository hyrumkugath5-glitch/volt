const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'ws.png')).toString('base64');
fs.writeFileSync(path.join(app.getPath('userData'), 'data.json'), JSON.stringify({
  decks: [{
    id: 'd', name: 'Graph WS', created: Date.now(),
    pages: [{ index: 1, image: 'data:image/png;base64,' + b64 }],
    cards: [{ id: 'a', question: 'Use the graph to find the slope of line f.', answer: 'm = 2', hint: '', typeLabel: 'Slope / line equations', page: 1, srs: { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: Date.now(), last: 0 } }],
  }],
}));
fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ useAI: false, apiKey: '', model: 'x' }));
require('../main.js');
app.whenReady().then(async () => {
  let win;
  for (let i = 0; i < 50 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; if (!win) await new Promise((r) => setTimeout(r, 100)); }
  if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));
  const $ = (j) => win.webContents.executeJavaScript(j, true);
  const wf = async (j, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await $(`!!(${j})`)) return true; } catch {} await new Promise((r) => setTimeout(r, 100)); } return false; };
  const ok = (n, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));

  await wf(`document.querySelector('.deck-card')`);
  await $(`document.querySelector('.deck-card').click()`);
  await wf(`document.querySelector('.card-box')`);
  await $(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Study')).click()`);
  await wf(`document.querySelector('.flashcard')`);

  const hasBtn = await $(`!!([...document.querySelectorAll('.iconbtn')].find(b=>b.textContent.includes('Worksheet')))`);
  ok('worksheet-peek button present', hasBtn);
  ok('peek hidden initially', await $(`document.querySelector('.pagepeek').classList.contains('hidden')`));
  await $(`[...document.querySelectorAll('.iconbtn')].find(b=>b.textContent.includes('Worksheet')).click()`);
  ok('peek shows after click', await wf(`!document.querySelector('.pagepeek').classList.contains('hidden')`));
  ok('peek contains the page image', await $(`!!document.querySelector('.pagepeek img') && document.querySelector('.pagepeek img').src.startsWith('data:image')`));
  await $(`[...document.querySelectorAll('.iconbtn')].find(b=>b.textContent.includes('Worksheet')).click()`);
  ok('peek toggles back off', await wf(`document.querySelector('.pagepeek').classList.contains('hidden')`));
  app.exit(0);
});
