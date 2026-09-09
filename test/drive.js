// Headless-ish UI smoke test. Loads the real renderer, seeds a deck, then drives
// the study session + report through the DOM and asserts on the results.
//   npx electron test/drive.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// Seed BEFORE the app's renderer asks for it, then boot the real main process
// (registers every ipcMain handler and creates the window).
fs.writeFileSync(
  path.join(app.getPath('userData'), 'data.json'),
  JSON.stringify({
    decks: [
      {
        id: 'd', name: 'Test Deck', source: 'test', created: Date.now(),
        cards: [
          { id: 'a', question: 'Solve for x: 2x + 4 = 10', answer: 'x = 3', hint: 'Isolate x.', typeLabel: 'Linear equation', srs: { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: Date.now(), last: 0 } },
          { id: 'b', question: 'Factor: x^2 - 9', answer: '(x-3)(x+3)', hint: '', typeLabel: 'Factoring', srs: { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: Date.now(), last: 0 } },
        ],
      },
    ],
  })
);
fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ apiKey: '', model: 'claude-haiku-4-5-20251001', useAI: false }));
require('../main.js');

const results = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  — ' + extra : ''));
};

app.whenReady().then(async () => {
  // wait for main.js to create its window
  let win;
  for (let i = 0; i < 50 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0];
    if (!win) await new Promise((r) => setTimeout(r, 100));
  }
  if (!win) { console.log('FAIL no window created'); app.exit(1); return; }
  if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));
  const $ = (js) => win.webContents.executeJavaScript(js, true);

  const waitFor = async (js, ms = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await $(`!!(${js})`)) return true;
      await new Promise((r) => setTimeout(r, 120));
    }
    return false;
  };

  try {
    ok('renderer booted', await waitFor(`document.querySelector('.deck-card')`), '');
    ok('library shows seeded deck', (await $(`document.querySelector('.deck-card').innerText`)).includes('Test Deck'));

    // open deck
    await $(`document.querySelector('.deck-card').click()`);
    ok('deck detail lists cards', await waitFor(`document.querySelector('.card-box')`));

    // start study
    await $(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Study')).click()`);
    ok('study view: flashcard visible', await waitFor(`document.querySelector('.flashcard')`));
    ok('study shows QUESTION side', (await $(`document.querySelector('.side-label').innerText`)) === 'QUESTION');

    // hint (offline)
    await $(`document.querySelector('.lightbulb').click()`);
    ok('hint box reveals text', await waitFor(`document.querySelector('.hintbox') && !document.querySelector('.hintbox').classList.contains('hidden')`));
    const hintTxt = await $(`document.querySelector('.hintbox').innerText`);
    ok('hint is non-empty and not the answer', hintTxt.length > 10 && !hintTxt.toLowerCase().includes('x = 3'), JSON.stringify(hintTxt));

    // flip
    await $(`document.querySelector('.flashcard').click()`);
    ok('flip shows ANSWER side', await waitFor(`document.querySelector('.side-label').innerText === 'ANSWER'`));
    ok('grade buttons appear', await $(`!!document.querySelector('.grade-row .again')`));

    // card 1: get it WRONG -> should requeue
    await $(`document.querySelector('.grade-row .again').click()`);
    ok('after wrong: still in study, queue kept card', await waitFor(`document.querySelector('.flashcard')`));
    const qTop1 = await $(`document.querySelector('.study-top').innerText`);
    ok('queue count reflects requeue (2 in queue)', /2 in queue/.test(qTop1), qTop1.replace(/\n/g, ' '));

    // now answer everything correctly until report
    for (let i = 0; i < 8; i++) {
      if (await $(`!!document.querySelector('.done-screen')`)) break;
      await $(`document.querySelector('.flashcard') && document.querySelector('.flashcard').click()`);
      await waitFor(`document.querySelector('.grade-row .good')`, 2000);
      await $(`document.querySelector('.grade-row .good') && document.querySelector('.grade-row .good').click()`);
      await new Promise((r) => setTimeout(r, 200));
    }
    ok('session completes -> done screen', await waitFor(`document.querySelector('.done-screen')`));

    const reportTxt = (await $(`document.getElementById('main').innerText`)).replace(/[−– ]/g, (c) => (c === ' ' ? ' ' : '-'));
    ok('report lists every problem', /Problem 1/.test(reportTxt) && /Problem 2/.test(reportTxt));
    ok('report shows correct answers', /x\s*=\s*3/.test(reportTxt) && /\(x-3\)\s*\(x\+3\)/.test(reportTxt), reportTxt.replace(/\n/g, ' ').slice(0, 300));
    ok('report typesets exponent with KaTeX', await $(`!!document.querySelector('#main .katex')`));
    ok('report shows retry count for missed card', /2 tries/.test(reportTxt), reportTxt.match(/\d+ tr(y|ies)/g)?.join(','));
    ok('export + print + study-again buttons present', await $(`['Export report','Print','Study again'].every(t=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes(t)))`));

    // calculator
    await $(`document.getElementById('calcToggle').click()`);
    ok('calculator opens', await waitFor(`!document.getElementById('calcPanel').classList.contains('hidden')`));
    await $(`const d=document.getElementById('calcDisplay'); d.value='sqrt(3^2+4^2)'; d.dispatchEvent(new Event('input'))`);
    ok('calculator evaluates sqrt(3^2+4^2)=5', (await $(`document.getElementById('calcResult').innerText`)) === '5');

    // settings
    await $(`document.querySelector('.navbtn[data-view=settings]').click()`);
    ok('settings view renders', await waitFor(`document.getElementById('main').innerText.includes('Anthropic API key')`));
  } catch (e) {
    ok('no exception', false, e.stack || String(e));
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  app.exit(passed === results.length ? 0 : 1);
});
