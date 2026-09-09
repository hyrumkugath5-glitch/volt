const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const HTML = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await w.loadFile(HTML);
  await new Promise((r) => setTimeout(r, 800));
  const pdf = await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0.3, bottom: 0.3, left: 0.3, right: 0.3 } });
  fs.writeFileSync(OUT, pdf);
  console.log('wrote', OUT, fs.statSync(OUT).size);
  app.quit();
});
