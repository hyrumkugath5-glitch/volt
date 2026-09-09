// Card order + anti-guessing (alternate worksheet versions).
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const srs = { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: Date.now(), last: 0 };
const card = (n, q, a, alts) => ({ id: 'c' + n, number: n, question: q, answer: a, hint: '', typeLabel: 'Linear equation', page: 1, alts: alts || [], srs: { ...srs } });

fs.writeFileSync(path.join(app.getPath('userData'), 'data.json'), JSON.stringify({
  decks: [{
    id: 'ag', name: 'Anti-guess deck', created: Date.now(), antiGuess: true,
    cards: [
      card(1, 'x + 1 = 5', 'x = 4', [{ question: 'x + 2 = 9', answer: 'x = 7', hint: '' }]),
      card(2, 'x - 3 = 1', 'x = 4', [{ question: 'x - 5 = 2', answer: 'x = 7', hint: '' }]),
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
  const qtext = () => $(`document.querySelector('.flashcard div')?.innerText`);

  await wf(`document.querySelector('.deck-card')`);
  await $(`document.querySelector('.deck-card').click()`);
  await wf(`document.querySelector('.card-box')`);
  await $(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Study')).click()`);
  await wf(`document.querySelector('.flashcard')`);

  // remember the two original questions we might see
  const q1 = await qtext();
  ok('study starts', !!q1, JSON.stringify(q1));

  // grade the first card WRONG -> it should requeue with a different version
  await $(`document.querySelector('.flashcard').click()`); // flip
  await wf(`document.querySelector('.grade-row .again')`);
  const wrongLabel = await $(`document.querySelector('.grade-row .again small')?.textContent`);
  ok('wrong button says "different version next time"', /different version/i.test(wrongLabel || ''), wrongLabel);
  await $(`document.querySelector('.grade-row .again').click()`);
  await new Promise((r) => setTimeout(r, 200));

  // now on card 2 (the other original). answer it right.
  await $(`document.querySelector('.flashcard').click()`);
  await wf(`document.querySelector('.grade-row .good')`);
  await $(`document.querySelector('.grade-row .good').click()`);
  await new Promise((r) => setTimeout(r, 200));

  // the missed card comes back as an ALT version (one of the two alt questions)
  const q1b = await qtext();
  const topText = await $(`document.querySelector('.study-top')?.innerText.replace(/\\n/g,' ')`);
  const alts = ['x + 2 = 9', 'x - 5 = 2'];
  ok('missed card comes back as a different version', q1b && q1b !== q1, `was ${JSON.stringify(q1)} now ${JSON.stringify(q1b)}`);
  ok('it is one of the alternate questions', alts.some((a) => (q1b || '').includes(a)), JSON.stringify(q1b));
  ok('top bar shows "version 2"', /version 2/.test(topText || ''), topText);

  await $(`document.querySelector('.flashcard').click()`);
  await new Promise((r) => setTimeout(r, 200));
  const ans = await qtext();
  ok('alternate answer shown (x = 7)', /x = 7/.test(ans || ''), JSON.stringify(ans));
  await $(`document.querySelector('.grade-row .good').click()`);
  await wf(`document.querySelector('.done-screen')`);

  const report = await $(`document.getElementById('main').innerText`);
  ok('report reached', /Deck cleared|Perfect run/.test(report));
  ok('report marks the retried problem as version 2', /\(version 2\)/.test(report), report.replace(/\n/g, ' ').slice(80, 260));

  app.exit(0);
});
