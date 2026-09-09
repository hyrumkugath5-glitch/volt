const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const wsB64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'ws.png')).toString('base64');

fs.writeFileSync(
  path.join(app.getPath('userData'), 'data.json'),
  JSON.stringify({
    decks: [
      {
        id: 'd', name: 'Geometry — Right Triangles', source: 'kuta.pdf', created: Date.now(),
        pages: [{ index: 1, image: 'data:image/png;base64,' + wsB64 }],
        cards: [
          { id: 'a', question: 'Solve the quadratic equation:  x^2 - 3x - 10 = 0', answer: 'x = 5 or x = -2', hint: '', typeLabel: 'Quadratic equation', srs: { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: Date.now(), last: 0 } },
          { id: 'b', question: 'A right triangle has legs of length 5 and 12. Find the length of the hypotenuse.', answer: 'c = 13', hint: '', typeLabel: 'Pythagorean theorem', srs: { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: Date.now(), last: 0 } },
          { id: 'c', question: 'Find the area of a circle with radius 4 cm. Leave your answer in terms of pi.', answer: '16π cm^2', hint: 'Area = pi r^2', typeLabel: 'Area / perimeter', srs: { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: Date.now(), last: 0 } },
        ],
      },
    ],
  })
);
fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ apiKey: '', model: 'claude-haiku-4-5-20251001', useAI: false }));
require('../main.js');

const OUT = path.join(__dirname, '..', '_shots');
fs.mkdirSync(OUT, { recursive: true });

app.whenReady().then(async () => {
  let win;
  for (let i = 0; i < 50 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; if (!win) await new Promise((r) => setTimeout(r, 100)); }
  if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));
  win.setContentSize(1200, 850);
  const $ = (js) => win.webContents.executeJavaScript(js, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const snap = async (name) => { await wait(700); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG()); console.log('shot', name); };

  await wait(1200);
  await snap('01-library');

  await $(`document.querySelector('.deck-card').click()`); await wait(400);
  await snap('02-deck');

  await $(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Study')).click()`); await wait(500);
  await snap('03-study-question');

  await $(`document.querySelector('.lightbulb').click()`); await wait(400);
  await snap('04-study-hint');

  await $(`[...document.querySelectorAll('.iconbtn')].find(b=>b.textContent.includes('Worksheet')).click()`); await wait(500);
  await snap('04b-worksheet-peek');

  await $(`document.querySelector('.flashcard').click()`); await wait(400);
  await snap('05-study-answer');

  // clear the deck
  for (let i = 0; i < 12; i++) {
    if (await $(`!!document.querySelector('.done-screen')`)) break;
    await $(`document.querySelector('.flashcard') && document.querySelector('.flashcard').click()`); await wait(150);
    await $(`(document.querySelector('.grade-row .good')||{click(){}}).click()`); await wait(200);
  }
  await snap('06-report');

  await $(`document.getElementById('calcToggle').click(); const d=document.getElementById('calcDisplay'); d.value='16*pi/4 + sqrt(144)'; d.dispatchEvent(new Event('input'))`); await wait(400);
  await snap('07-calculator');

  await $(`document.querySelector('.navbtn[data-view=settings]').click()`); await wait(400);
  await snap('08-settings');

  await $(`document.querySelector('.navbtn[data-view=import]').click()`); await wait(400);
  await snap('09-import');

  app.exit(0);
});
