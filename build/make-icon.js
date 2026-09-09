// Rasterises build/icon.svg via Electron's offscreen renderer:
//   build/icon.ico       (Windows, multi-res PNG-embedded ICO)
//   build/icon.png        (1024 — electron-builder derives .icns / linux from it)
//   assets/icon.png       (256 — the runtime window icon)
// Run:  npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SVG = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const BASE = 1024;

function packIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const parts = [header, entries];
  images.forEach((img, i) => {
    const e = i * 16;
    entries.writeUInt8(img.size >= 256 ? 0 : img.size, e + 0);
    entries.writeUInt8(img.size >= 256 ? 0 : img.size, e + 1);
    entries.writeUInt16LE(1, e + 4);
    entries.writeUInt16LE(32, e + 6);
    entries.writeUInt32LE(img.buf.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += img.buf.length;
    parts.push(img.buf);
  });
  return Buffer.concat(parts);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const htmlPath = path.join(os.tmpdir(), 'volt-icon.html');
  fs.writeFileSync(
    htmlPath,
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${BASE}px;height:${BASE}px}</style>${SVG}`
  );

  const win = new BrowserWindow({
    width: BASE,
    height: BASE,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  await win.loadFile(htmlPath);
  await new Promise((r) => setTimeout(r, 800));
  const full = await win.webContents.capturePage();
  win.destroy();

  const images = SIZES.map((size) => ({
    size,
    buf: full.resize({ width: size, height: size, quality: 'best' }).toPNG(),
  }));

  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.png'), full.resize({ width: 256, height: 256, quality: 'best' }).toPNG());
  fs.writeFileSync(path.join(__dirname, 'icon.png'), full.resize({ width: 1024, height: 1024, quality: 'best' }).toPNG());
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), packIco(images));
  console.log('sizes:', images.map((i) => `${i.size}(${i.buf.length}b)`).join(' '));
  console.log('wrote build/icon.ico, build/icon.png (1024), assets/icon.png (256)');
  app.quit();
});
