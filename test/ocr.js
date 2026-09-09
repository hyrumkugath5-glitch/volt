// Runs the real renderer OCR pipeline (column detection + per-column OCR +
// split + solve) on a fixture worksheet image.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

fs.writeFileSync(path.join(app.getPath('userData'), 'data.json'), JSON.stringify({ decks: [] }));
fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ useAI: false, apiKey: '', model: 'x' }));
require('../main.js');

const IMG = path.resolve(process.argv[2] || 'test/fixtures/ws3col.png');

app.whenReady().then(async () => {
  ipcMain.removeHandler('pick:worksheet');
  ipcMain.handle('pick:worksheet', () => ({
    path: IMG, name: path.basename(IMG), ext: path.extname(IMG).toLowerCase(),
    data: fs.readFileSync(IMG).toString('base64'),
  }));

  let win;
  for (let i = 0; i < 50 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; if (!win) await new Promise((r) => setTimeout(r, 100)); }
  if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));
  const $ = (js) => win.webContents.executeJavaScript(js, true);
  const wf = async (js, ms = 120000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await $(`!!(${js})`)) return true; } catch {} await new Promise((r) => setTimeout(r, 400)); } return false; };

  await wf(`document.querySelector('.navbtn')`, 8000);
  await $(`document.querySelector('.navbtn[data-view="import"]').click()`);
  await wf(`document.querySelector('.dropzone')`, 5000);
  await $(`document.querySelector('.dropzone').click()`);
  console.log('...OCR running');

  const ok = await wf(`document.querySelectorAll('.card-row').length >= 8`, 120000);
  console.log(ok ? 'PASS review list built' : 'FAIL no review list');
  if (ok) {
    const rows = await $(`[...document.querySelectorAll('.card-row')].map(r=>{
      const t=r.querySelectorAll('textarea');
      return { q: t[0].value, a: t[1].value };
    })`);
    let solved = 0;
    rows.forEach((r, i) => { if (r.a) solved++; console.log(`#${i + 1}  Q: ${JSON.stringify(r.q.slice(0, 55))}  A: ${JSON.stringify(r.a)}`); });
    console.log(`\n${rows.length} cards, ${solved} with answers auto-filled`);
  } else {
    console.log('main text:', (await $(`document.getElementById('main').innerText`).catch(() => '?')).slice(0, 400));
  }
  app.exit(0);
});
