const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const HTML = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 900, height: 1250, show: false, webPreferences: { offscreen: true } });
  await w.loadFile(HTML);
  await new Promise((r) => setTimeout(r, 1200));
  const img = await w.webContents.capturePage();
  fs.writeFileSync(OUT, img.toPNG());
  console.log('wrote', OUT, fs.statSync(OUT).size);
  app.quit();
});
