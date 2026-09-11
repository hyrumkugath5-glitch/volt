// Regenerates the derived icon files from build/icon.png (the master artwork).
// To change the app icon: drop a new square PNG in as build/icon.png (1024x1024
// ideally, 512 minimum) and run:  npm run icon
//
// Outputs:
//   build/icon.ico    Windows, multi-resolution PNG-embedded ICO
//   assets/icon.png   256 — the runtime window icon
// build/icon.png is the macOS / Linux icon and is used as-is.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MASTER = path.join(__dirname, 'icon.png');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

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
app.whenReady().then(() => {
  const full = nativeImage.createFromPath(MASTER);
  if (full.isEmpty()) {
    console.error(`cannot read ${MASTER} — put a square PNG there first`);
    app.exit(1);
    return;
  }
  const images = SIZES.map((size) => ({
    size,
    buf: full.resize({ width: size, height: size, quality: 'best' }).toPNG(),
  }));

  fs.writeFileSync(
    path.join(ROOT, 'assets', 'icon.png'),
    full.resize({ width: 256, height: 256, quality: 'best' }).toPNG()
  );
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), packIco(images));
  console.log(`regenerated build/icon.ico + assets/icon.png from build/icon.png (${full.getSize().width}px)`);
  app.quit();
});
