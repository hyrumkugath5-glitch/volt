// Copies the pure logic modules from ../src into ./shared so the server package
// is self-contained (for tarball deploys). Run: npm run sync
//
// These files are shared verbatim between the Electron app and the server's web
// client. The server itself imports only the DOM-free ones (solve, exponents,
// parser, pdftext, reconstruct); mathfmt/srs/util are for the browser.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', 'src');
const dst = path.join(here, 'shared');
const MODULES = ['solve.js', 'exponents.js', 'parser.js', 'pdftext.js', 'reconstruct.js', 'mathfmt.js', 'srs.js', 'util.js'];

fs.mkdirSync(dst, { recursive: true });
for (const m of MODULES) {
  const from = path.join(src, m);
  if (!fs.existsSync(from)) { console.warn('missing', from); continue; }
  let code = fs.readFileSync(from, 'utf8');
  // point the katex import at the path Express serves it from
  code = code.replace(
    /import katex from ['"][^'"]*katex[^'"]*['"];?/,
    "import katex from '/vendor/katex/katex.mjs';"
  );
  fs.writeFileSync(path.join(dst, m), code);
  console.log('synced', m);
}
console.log('done — server imports solve/exponents/parser/pdftext/reconstruct; the rest are client-only');
