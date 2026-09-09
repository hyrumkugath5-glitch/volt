// Verifies the "3 readings" UI: a garbled card offers candidate readings and
// picking one updates the card's question + answer.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

fs.writeFileSync(path.join(app.getPath('userData'), 'data.json'), JSON.stringify({
  decks: [{
    id: 'd', name: 'Garbled', created: Date.now(),
    cards: [
      { id: 'a', question: '7Tx + 3 = 9 - 5x', answer: '', hint: '', typeLabel: 'Linear equation', page: 1, srs: { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: Date.now(), last: 0 } },
    ],
  }],
}));
fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ useAI: false, apiKey: '', model: 'x' }));
require('../main.js');

app.whenReady().then(async () => {
  let w;
  for (let i = 0; i < 50 && !w; i++) { w = BrowserWindow.getAllWindows()[0]; if (!w) await new Promise((r) => setTimeout(r, 100)); }
  if (w.webContents.isLoading()) await new Promise((r) => w.webContents.once('did-finish-load', r));
  const $ = (j) => w.webContents.executeJavaScript(j, true);
  const wf = async (j, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await $(`!!(${j})`)) return true; } catch {} await new Promise((r) => setTimeout(r, 100)); } return false; };
  const ok = (n, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));

  await wf(`document.querySelector('.deck-card')`);
  await $(`document.querySelector('.deck-card').click()`);
  await wf(`document.querySelector('.card-box')`);

  await $(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('3 readings')).click()`);
  ok('readings panel appears', await wf(`document.querySelector('.readings')`));
  const n = await $(`document.querySelectorAll('.reading').length`);
  ok('offers 2-3 readings', n >= 2 && n <= 3, `${n} shown`);
  const anns = await $(`[...document.querySelectorAll('.reading .r-ans')].map(r=>r.textContent)`);
  console.log('   answers: ' + JSON.stringify(anns));
  ok('first reading is "as read"', (await $(`document.querySelector('.reading .tag').textContent`)) === 'as read');

  await $(`document.querySelector('.reading').click()`); // pick the top one
  await new Promise((r) => setTimeout(r, 300));
  const q = await $(`document.querySelector('.card-box textarea').value`);
  const a = await $(`document.querySelectorAll('.card-box textarea')[1].value`);
  ok('picking updates the question', /7x \+ 3/.test(q), JSON.stringify(q));
  ok('picking fills the answer', /x = 1\/2/.test(a), JSON.stringify(a));
  const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'data.json'), 'utf8'));
  ok('persisted', saved.decks[0].cards[0].answer === 'x = 1/2', saved.decks[0].cards[0].answer);
  app.exit(0);
});
