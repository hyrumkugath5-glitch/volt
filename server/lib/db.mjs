// Tiny JSON-file store with atomic writes. One file per collection under data/.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(here, '..', 'data');
const SRC_DIR = path.join(DATA_DIR, 'sources');
fs.mkdirSync(SRC_DIR, { recursive: true });

function file(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

export function load(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return fallback;
  }
}

export function save(name, value) {
  const tmp = file(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file(name));
}

// source worksheet files (the original PDF / images), kept out of the JSON
export function saveSource(deckId, ext, buffer) {
  const name = `${deckId}${ext}`;
  fs.writeFileSync(path.join(SRC_DIR, name), buffer);
  return name;
}
export function sourcePath(name) {
  const p = path.join(SRC_DIR, path.basename(name));
  return fs.existsSync(p) ? p : null;
}
export function deleteSource(name) {
  if (!name) return;
  try { fs.unlinkSync(path.join(SRC_DIR, path.basename(name))); } catch {}
}

export { DATA_DIR };
