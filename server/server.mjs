// Argon server — a teacher tool.
//   owner  (master key)      -> creates teacher accounts, sees everything
//   teacher (username/pass)  -> imports worksheets, builds & publishes decks
//   student (no login)       -> joins, studies a teacher's published deck
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import express from 'express';
import fileUpload from 'express-fileupload';

import { hashPassword, verifyPassword, makeToken, readToken, randomId } from './lib/auth.mjs';
import { load, save, saveSource, sourcePath, deleteSource } from './lib/db.mjs';
import { importWorksheet, shutdown as ocrShutdown } from './lib/import.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------- config ---------------------------- */
const CONFIG_FILE = path.join(here, 'config.json');
function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}
  let changed = false;
  if (cfg.masterKey && !cfg.masterKeyHash) {
    cfg.masterKeyHash = hashPassword(cfg.masterKey);
    delete cfg.masterKey;
    changed = true;
  }
  if (!cfg.masterKeyHash) {
    const gen = randomId(12);
    cfg.masterKeyHash = hashPassword(gen);
    console.log('\n*** No master key set. Generated one — put it somewhere safe: ***\n    ' + gen + '\n');
    changed = true;
  }
  if (!cfg.sessionSecret) { cfg.sessionSecret = crypto.randomBytes(32).toString('hex'); changed = true; }
  cfg.port ||= Number(process.env.PORT) || 3200;
  cfg.host ||= '0.0.0.0';
  if (changed) {
    delete cfg._comment;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  }
  return cfg;
}
const CONFIG = loadConfig();

/* ------------------------------- data ------------------------------ */
const db = {
  teachers: () => load('teachers', []),
  decks: () => load('decks', []),
  progress: () => load('progress', {}),
};
const saveTeachers = (v) => save('teachers', v);
const saveDecks = (v) => save('decks', v);
const saveProgress = (v) => save('progress', v);

const publicDeck = (d) => ({
  id: d.id, name: d.name, subject: d.subject || '', cardCount: d.cards.length,
  teacher: (db.teachers().find((t) => t.id === d.ownerTeacherId) || {}).name || 'Teacher',
  needsCode: !!d.classCode,
});
const teacherView = (d) => ({ ...d, cards: d.cards, pages: (d.pages || []).map((p) => ({ index: p.index })) });

/* ------------------------------- app ------------------------------- */
const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(fileUpload({ limits: { fileSize: 40 * 1024 * 1024 } }));
app.use('/vendor/katex', express.static(path.join(here, 'node_modules', 'katex', 'dist')));
app.use('/shared', express.static(path.join(here, 'shared'), { setHeaders: (r) => r.setHeader('Content-Type', 'text/javascript') }));
app.use(express.static(path.join(here, 'public')));

function cookies(req) {
  const out = {};
  for (const p of (req.headers.cookie || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}
function setSession(res, payload) {
  const tok = makeToken(payload, CONFIG.sessionSecret);
  res.setHeader('Set-Cookie', `argon_session=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${14 * 24 * 3600}`);
}
function clearSession(res) {
  res.setHeader('Set-Cookie', 'argon_session=; HttpOnly; Path=/; Max-Age=0');
}
function session(req) {
  return readToken(cookies(req).argon_session, CONFIG.sessionSecret);
}
function requireOwner(req, res, next) {
  const s = session(req);
  if (s && s.role === 'owner') { req.session = s; return next(); }
  res.status(401).json({ error: 'owner login required' });
}
function requireTeacher(req, res, next) {
  const s = session(req);
  if (!s) return res.status(401).json({ error: 'login required' });
  if (s.role === 'owner') { req.session = s; req.teacher = null; return next(); }
  if (s.role === 'teacher') {
    const t = db.teachers().find((x) => x.id === s.tid && !x.disabled);
    if (!t) return res.status(401).json({ error: 'account disabled' });
    req.session = s; req.teacher = t; return next();
  }
  res.status(401).json({ error: 'login required' });
}

// ---- brute-force guard on the two login endpoints ----
const attempts = new Map();
function throttle(req, res, next) {
  const ip = req.ip;
  const rec = attempts.get(ip) || { n: 0, until: 0 };
  if (Date.now() < rec.until) return res.status(429).json({ error: 'too many attempts, wait a minute' });
  req._loginFail = () => {
    rec.n++;
    if (rec.n >= 6) { rec.until = Date.now() + 60000; rec.n = 0; }
    attempts.set(ip, rec);
  };
  req._loginOk = () => attempts.delete(ip);
  next();
}

/* --------------------------- auth routes -------------------------- */
app.post('/api/owner/login', throttle, (req, res) => {
  const ok = verifyPassword(req.body.key || '', CONFIG.masterKeyHash);
  if (!ok) { req._loginFail(); return res.status(403).json({ error: 'wrong master key' }); }
  req._loginOk();
  setSession(res, { role: 'owner' });
  res.json({ ok: true });
});

app.post('/api/teacher/login', throttle, (req, res) => {
  const { username, password } = req.body || {};
  const t = db.teachers().find((x) => x.username.toLowerCase() === String(username || '').toLowerCase());
  if (!t || t.disabled || !verifyPassword(password || '', t.passHash)) {
    req._loginFail();
    return res.status(403).json({ error: 'wrong username or password' });
  }
  req._loginOk();
  setSession(res, { role: 'teacher', tid: t.id });
  res.json({ ok: true, name: t.name });
});

app.post('/api/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

app.get('/api/me', (req, res) => {
  const s = session(req);
  if (!s) return res.json({ role: null });
  if (s.role === 'owner') return res.json({ role: 'owner' });
  const t = db.teachers().find((x) => x.id === s.tid);
  if (!t || t.disabled) { clearSession(res); return res.json({ role: null }); }
  res.json({ role: 'teacher', name: t.name, username: t.username });
});

/* --------------------------- owner routes ------------------------- */
app.get('/api/owner/teachers', requireOwner, (req, res) => {
  res.json(db.teachers().map((t) => ({
    id: t.id, username: t.username, name: t.name, disabled: !!t.disabled, created: t.created,
    deckCount: db.decks().filter((d) => d.ownerTeacherId === t.id).length,
  })));
});

app.post('/api/owner/teachers', requireOwner, (req, res) => {
  const { username, password, name } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const teachers = db.teachers();
  if (teachers.some((t) => t.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: 'username taken' });
  }
  const t = { id: randomId(), username: String(username).trim(), name: (name || username).trim(), passHash: hashPassword(password), created: Date.now(), disabled: false };
  teachers.push(t);
  saveTeachers(teachers);
  res.json({ ok: true, id: t.id });
});

app.post('/api/owner/teachers/:id', requireOwner, (req, res) => {
  const teachers = db.teachers();
  const t = teachers.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  if (typeof req.body.disabled === 'boolean') t.disabled = req.body.disabled;
  if (req.body.password) t.passHash = hashPassword(req.body.password);
  if (req.body.name) t.name = String(req.body.name).trim();
  saveTeachers(teachers);
  res.json({ ok: true });
});

app.delete('/api/owner/teachers/:id', requireOwner, (req, res) => {
  const teachers = db.teachers().filter((t) => t.id !== req.params.id);
  saveTeachers(teachers);
  // orphan their decks (unpublish, keep for records) — safest default
  const decks = db.decks();
  for (const d of decks) if (d.ownerTeacherId === req.params.id) d.published = false;
  saveDecks(decks);
  res.json({ ok: true });
});

app.get('/api/owner/decks', requireOwner, (req, res) => {
  const teachers = db.teachers();
  res.json(db.decks().map((d) => ({
    id: d.id, name: d.name, subject: d.subject, published: !!d.published, cardCount: d.cards.length,
    teacher: (teachers.find((t) => t.id === d.ownerTeacherId) || {}).name || '—', updated: d.updated,
  })));
});

/* -------------------------- teacher routes ------------------------ */
function ownsDeck(req, d) {
  return req.session.role === 'owner' || d.ownerTeacherId === req.teacher.id;
}

app.get('/api/teacher/decks', requireTeacher, (req, res) => {
  const mine = db.decks().filter((d) => req.session.role === 'owner' || d.ownerTeacherId === req.teacher.id);
  res.json(mine.map((d) => ({
    id: d.id, name: d.name, subject: d.subject, published: !!d.published, classCode: d.classCode || '',
    cardCount: d.cards.length, updated: d.updated, runs: Object.values(db.progress()).filter((p) => p[d.id]).length,
    antiGuess: !!d.antiGuess,
    altVersions: d.cards.reduce((m, c) => Math.max(m, (c.alts || []).length), 0),
  })));
});

app.get('/api/teacher/decks/:id', requireTeacher, (req, res) => {
  const d = db.decks().find((x) => x.id === req.params.id);
  if (!d || !ownsDeck(req, d)) return res.status(404).json({ error: 'not found' });
  res.json(d);
});

app.post('/api/teacher/import', requireTeacher, async (req, res) => {
  const f = req.files && (req.files.file || Object.values(req.files)[0]);
  if (!f) return res.status(400).json({ error: 'no file' });
  const ext = path.extname(f.name).toLowerCase();
  if (!['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext)) {
    return res.status(400).json({ error: 'need a PDF or image' });
  }
  try {
    const result = await importWorksheet({ buffer: f.data, name: f.name, ext });
    // stash the source so it can be attached to the deck on save
    const stashId = randomId();
    saveSource('stash-' + stashId, ext, f.data);
    res.json({ ...result, stashId, ext, name: f.name });
  } catch (e) {
    console.error('import failed', e);
    res.status(500).json({ error: 'could not read that file: ' + e.message });
  }
});

app.post('/api/teacher/decks', requireTeacher, (req, res) => {
  const decks = db.decks();
  const body = req.body || {};
  const prev = body.id && decks.find((x) => x.id === body.id);
  const cards = (body.cards || []).filter((c) => (c.question || '').trim()).map((c, i) => {
    const old = prev && prev.cards.find((x) => x.id === c.id);
    return {
      id: c.id || randomId(),
      number: c.number || (old && old.number) || i + 1,
      question: String(c.question).trim(), answer: String(c.answer || '').trim(),
      hint: String(c.hint || '').trim(), typeLabel: c.typeLabel || 'General problem',
      page: c.page || 1, answerSource: c.answerSource || '',
      alts: Array.isArray(c.alts) ? c.alts : (old && old.alts) || [],
    };
  });
  if (!cards.length) return res.status(400).json({ error: 'add at least one card' });

  let d = prev;
  if (d && !ownsDeck(req, d)) return res.status(403).json({ error: 'not your deck' });
  if (!d) {
    d = { id: randomId(), ownerTeacherId: req.teacher ? req.teacher.id : (body.ownerTeacherId || 'owner'), created: Date.now(), published: false };
    decks.push(d);
  }
  d.name = (body.name || 'Untitled worksheet').trim();
  d.subject = (body.subject || '').trim();
  if (typeof body.antiGuess === 'boolean') d.antiGuess = body.antiGuess;
  d.cards = cards;
  d.updated = Date.now();

  // attach stashed source + page images
  if (body.stashId) {
    const stash = sourcePath('stash-' + body.stashId + (body.ext || ''));
    if (stash) {
      deleteSource(d.source);
      d.source = saveSource(d.id, body.ext || path.extname(stash), fs.readFileSync(stash));
      deleteSource('stash-' + body.stashId + (body.ext || ''));
    }
  }
  if (Array.isArray(body.pages)) d.pages = body.pages.map((p) => ({ index: p.index, image: p.image }));

  saveDecks(decks);
  res.json({ ok: true, id: d.id });
});

app.post('/api/teacher/decks/:id/publish', requireTeacher, (req, res) => {
  const decks = db.decks();
  const d = decks.find((x) => x.id === req.params.id);
  if (!d || !ownsDeck(req, d)) return res.status(404).json({ error: 'not found' });
  d.published = !!req.body.published;
  d.classCode = (req.body.classCode || '').trim();
  d.updated = Date.now();
  saveDecks(decks);
  res.json({ ok: true, published: d.published });
});

// Import another worksheet and attach each problem as an alternate version of
// the matching card (paired by problem number) — powers anti-guessing.
app.post('/api/teacher/decks/:id/alternate', requireTeacher, async (req, res) => {
  const decks = db.decks();
  const d = decks.find((x) => x.id === req.params.id);
  if (!d || !ownsDeck(req, d)) return res.status(404).json({ error: 'not found' });
  const f = req.files && (req.files.file || Object.values(req.files)[0]);
  if (!f) return res.status(400).json({ error: 'no file' });
  const ext = path.extname(f.name).toLowerCase();
  try {
    const { candidates } = await importWorksheet({ buffer: f.data, name: f.name, ext });
    const byNum = new Map(candidates.map((c) => [c.number, c]));
    let paired = 0;
    for (const card of d.cards) {
      const alt = byNum.get(card.number);
      if (!alt || !alt.question.trim()) continue;
      card.alts = card.alts || [];
      card.alts.push({ question: alt.question.trim(), answer: (alt.answer || '').trim(), hint: '' });
      paired++;
    }
    d.antiGuess = true;
    d.updated = Date.now();
    saveDecks(decks);
    res.json({ ok: true, paired, total: d.cards.length });
  } catch (e) {
    res.status(500).json({ error: 'could not read that file: ' + e.message });
  }
});

app.delete('/api/teacher/decks/:id', requireTeacher, (req, res) => {
  const decks = db.decks();
  const d = decks.find((x) => x.id === req.params.id);
  if (!d || !ownsDeck(req, d)) return res.status(404).json({ error: 'not found' });
  deleteSource(d.source);
  saveDecks(decks.filter((x) => x.id !== d.id));
  const prog = db.progress();
  for (const k of Object.keys(prog)) delete prog[k][d.id];
  saveProgress(prog);
  res.json({ ok: true });
});

app.get('/api/teacher/decks/:id/results', requireTeacher, (req, res) => {
  const d = db.decks().find((x) => x.id === req.params.id);
  if (!d || !ownsDeck(req, d)) return res.status(404).json({ error: 'not found' });
  const rows = [];
  for (const [student, decksP] of Object.entries(db.progress())) {
    const p = decksP[d.id];
    if (p && p.lastRun) rows.push({ student, ...p.lastRun });
  }
  rows.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  res.json(rows);
});

/* -------------------------- student routes ----------------------- */
app.get('/api/decks', (req, res) => {
  res.json(db.decks().filter((d) => d.published).map(publicDeck));
});

app.post('/api/decks/:id', (req, res) => {
  const d = db.decks().find((x) => x.id === req.params.id && x.published);
  if (!d) return res.status(404).json({ error: 'not found' });
  if (d.classCode && String(req.body.code || '').trim() !== d.classCode) {
    return res.status(403).json({ error: 'wrong class code' });
  }
  res.json({
    id: d.id, name: d.name, subject: d.subject, antiGuess: !!d.antiGuess,
    cards: d.cards.map((c) => ({ id: c.id, number: c.number, question: c.question, answer: c.answer, hint: c.hint, typeLabel: c.typeLabel, page: c.page, alts: c.alts || [] })),
    pages: (d.pages || []).map((p) => ({ index: p.index, image: p.image })),
  });
});

app.post('/api/progress', (req, res) => {
  const { student, deckId, run } = req.body || {};
  if (!student || !deckId) return res.status(400).json({ error: 'student and deckId required' });
  const prog = db.progress();
  const key = String(student).slice(0, 40);
  prog[key] ||= {};
  prog[key][deckId] ||= { runs: 0 };
  prog[key][deckId].runs++;
  prog[key][deckId].lastRun = { ...run, finishedAt: Date.now() };
  saveProgress(prog);
  res.json({ ok: true });
});

/* --------------------------- page routes ------------------------- */
app.get('/admin', (req, res) => res.sendFile(path.join(here, 'public', 'admin.html')));
app.get('/owner', (req, res) => res.sendFile(path.join(here, 'public', 'owner.html')));

app.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`Argon server on http://${CONFIG.host}:${CONFIG.port}`);
  console.log(`  students  ->  /`);
  console.log(`  teachers  ->  /admin`);
  console.log(`  owner     ->  /owner`);
});

process.on('SIGINT', async () => { await ocrShutdown(); process.exit(0); });
process.on('SIGTERM', async () => { await ocrShutdown(); process.exit(0); });
