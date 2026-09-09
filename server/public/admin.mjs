import { el, toast } from '/shared/util.js';
import { renderMath, renderExpr } from '/shared/mathfmt.js';
import { classify } from '/shared/parser.js';
import { solve } from '/shared/solve.js';
import { simplify } from '/shared/exponents.js';
import { candidates as readingCandidates } from '/shared/reconstruct.js';
import { runStudy } from '/study.mjs';

const app = document.getElementById('app');
const whoName = document.getElementById('whoName');
const logoutBtn = document.getElementById('logoutBtn');
const autoAnswer = (q) => solve(q) || simplify(q);

async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const r = await fetch(path, { headers: isForm ? {} : { 'content-type': 'application/json' }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

logoutBtn.addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); location.reload(); });

/* ------------------------------- login ---------------------------- */
function loginView() {
  whoName.textContent = '';
  logoutBtn.hidden = true;
  app.innerHTML = '';
  const u = el('input', { class: 'field', placeholder: 'Username', autocomplete: 'username' });
  const p = el('input', { class: 'field', type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const err = el('div', { class: 'err' });
  const go = async () => {
    err.textContent = '';
    try { await api('/api/teacher/login', { method: 'POST', body: JSON.stringify({ username: u.value, password: p.value }) }); boot(); }
    catch (e) { err.textContent = e.message; }
  };
  p.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  app.append(el('div', { class: 'card center-card' },
    el('h1', {}, 'Teacher sign in'),
    el('div', { class: 'sub', text: 'Your account is created by the site owner.' }),
    el('div', { class: 'stack' }, u, p),
    el('div', { style: 'margin-top:12px' }, el('button', { class: 'btn', onclick: go }, 'Sign in')),
    err,
    el('div', { class: 'muted', style: 'margin-top:16px;font-size:12px' }, 'Owner? ', el('a', { href: '/owner' }, 'Owner panel'))));
  u.focus();
}

/* ----------------------------- deck list -------------------------- */
async function deckListView(me) {
  app.innerHTML = '';
  app.append(el('div', { class: 'row', style: 'justify-content:space-between' },
    el('h1', {}, 'Your decks', me.role === 'owner' ? el('span', { class: 'badge', text: '(owner)' }) : null),
    el('button', { class: 'btn', onclick: importView }, '➕ New from worksheet')));

  const list = el('div', { class: 'stack' });
  app.append(list, el('div', { class: 'muted', id: 'lm', text: 'Loading…' }));
  let decks;
  try { decks = await api('/api/teacher/decks'); } catch (e) { document.getElementById('lm').textContent = e.message; return; }
  document.getElementById('lm').remove();
  if (!decks.length) { list.append(el('div', { class: 'muted', text: 'No decks yet — import a worksheet to make one.' })); return; }

  for (const d of decks) {
    const pub = el('span', { class: 'pill ' + (d.published ? 'on' : 'off'), text: d.published ? 'published' : 'draft' });
    const meta = `${d.subject ? d.subject + ' · ' : ''}${d.cardCount} cards · ${d.runs} student run${d.runs === 1 ? '' : 's'}` +
      (d.altVersions ? ` · ${d.altVersions} alternate version${d.altVersions > 1 ? 's' : ''}` : '');
    const altFile = el('input', { type: 'file', accept: '.pdf,.png,.jpg,.jpeg,.webp,.bmp', style: 'display:none' });
    altFile.addEventListener('change', () => altFile.files[0] && addAlternate(d, altFile.files[0]));
    const row = el('div', { class: 'card' },
      el('div', { class: 'row', style: 'justify-content:space-between' },
        el('div', {}, el('h3', { style: 'margin:0', text: d.name }),
          el('div', { class: 'meta muted', text: meta })),
        el('div', { class: 'row' }, d.antiGuess ? el('span', { class: 'pill on', text: 'anti-guess' }) : null, pub)),
      el('div', { class: 'row', style: 'margin-top:12px' },
        el('button', { class: 'btn small', onclick: () => editView(d.id) }, 'Edit'),
        el('button', { class: 'btn small ghost', onclick: () => previewDeck(d.id) }, '▶ Preview'),
        el('button', { class: 'btn small ghost', onclick: () => resultsView(d) }, 'Results'),
        el('button', { class: 'btn small ghost', onclick: () => { altFile.click(); }, title: 'Add a second worksheet so missed problems come back with different numbers' }, '➕ Alternate'),
        el('button', { class: 'btn small ghost', onclick: () => togglePublish(d) }, d.published ? 'Unpublish' : 'Publish'),
        el('button', { class: 'btn small danger', onclick: () => delDeck(d) }, 'Delete')),
      altFile);
    list.append(row);
  }
}

async function togglePublish(d) {
  let code = d.classCode || '';
  if (!d.published) {
    const c = prompt('Optional class code students must enter (leave blank for open access):', code);
    if (c === null) return;
    code = c.trim();
  }
  try {
    await api(`/api/teacher/decks/${d.id}/publish`, { method: 'POST', body: JSON.stringify({ published: !d.published, classCode: code }) });
    boot();
  } catch (e) { toast(e.message); }
}
async function addAlternate(d, file) {
  toast('Reading alternate worksheet…');
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await api(`/api/teacher/decks/${d.id}/alternate`, { method: 'POST', body: fd });
    toast(`Paired ${r.paired} of ${r.total} problems. Anti-guessing is on.`);
    boot();
  } catch (e) { toast(e.message); }
}
async function delDeck(d) {
  if (!confirm(`Delete "${d.name}"? Student progress on it is removed too.`)) return;
  try { await api('/api/teacher/decks/' + d.id, { method: 'DELETE' }); boot(); } catch (e) { toast(e.message); }
}

/* ------------------------------ import ---------------------------- */
function importView() {
  app.innerHTML = '';
  app.append(el('button', { class: 'link', onclick: boot }, '← back'),
    el('h1', {}, 'New deck from a worksheet'),
    el('div', { class: 'sub', text: 'Upload a PDF or image. Volt reads it, splits it into problems and solves the ones it can. PDFs work best.' }));

  const input = el('input', { type: 'file', accept: '.pdf,.png,.jpg,.jpeg,.webp,.bmp', style: 'display:none' });
  const drop = el('div', { class: 'dropzone', text: '📄  Choose a worksheet file (PDF, PNG, JPG)' });
  const status = el('div', { class: 'status-line' });
  const stage = el('div');
  drop.addEventListener('click', () => input.click());
  input.addEventListener('change', () => input.files[0] && doImport(input.files[0]));
  app.append(drop, input, status, stage);

  async function doImport(file) {
    drop.textContent = '📄  ' + file.name;
    status.textContent = 'Uploading & reading… (a big PDF can take a minute)';
    stage.innerHTML = '';
    const fd = new FormData();
    fd.append('file', file);
    let res;
    try { res = await api('/api/teacher/import', { method: 'POST', body: fd }); }
    catch (e) { status.textContent = 'Error: ' + e.message; return; }
    status.textContent = `Found ${res.candidates.length} problems` +
      (res.keyPageCount ? ` (skipped ${res.keyPageCount} answer-key page${res.keyPageCount > 1 ? 's' : ''})` : '') + '. Review, then save.';
    reviewStage(stage, file.name, res);
  }
}

function reviewStage(stage, fileName, res) {
  stage.innerHTML = '';
  const nameInput = el('input', { class: 'field', value: fileName.replace(/\.[^.]+$/, '') });
  const subjInput = el('input', { class: 'field', placeholder: 'Subject (optional) — e.g. Algebra 1' });
  stage.append(el('label', { class: 'lbl', text: 'Deck name' }), nameInput,
    el('label', { class: 'lbl', text: 'Subject' }), subjInput, el('h2', {}, 'Review cards'));

  const model = res.candidates.map((c, i) => ({
    id: rid(), number: c.number || i + 1, question: c.question || '', answer: c.answer || '', answerSource: c.answerSource || '',
    hint: c.hint || '', typeLabel: c.typeLabel || classify(c.question || '').label, page: c.page || 1,
  }));
  const solved = model.filter((c) => c.answerSource === 'solved').length;
  if (solved) setTimeout(() => toast(`Volt solved ${solved} problem${solved > 1 ? 's' : ''} — double-check them.`), 300);

  const wrap = el('div', { class: 'pagewrap' });
  const preview = el('div', { class: 'page-preview' });
  for (const p of res.pages) preview.append(el('img', { src: p.image, alt: 'page ' + p.index }));
  const col = el('div', { class: 'cards-edit' });
  wrap.append(preview, col);
  stage.append(wrap);
  paintCards();

  function paintCards() {
    col.innerHTML = '';
    model.forEach((c, i) => {
      const q = el('textarea', { class: 'field', rows: 2 }); q.value = c.question;
      const a = el('textarea', { class: 'field', rows: 1 }); a.value = c.answer;
      const h = el('textarea', { class: 'field', rows: 1 }); h.value = c.hint;
      q.addEventListener('input', () => { c.question = q.value; });
      a.addEventListener('input', () => { c.answer = a.value; c.answerSource = 'edited'; });
      h.addEventListener('input', () => { c.hint = h.value; });
      const srcTag = el('span', { class: 'tag', hidden: !['key', 'solved', 'reconstructed'].includes(c.answerSource),
        text: c.answerSource === 'key' ? 'from key' : c.answerSource === 'reconstructed' ? 'reading picked' : 'solved by Volt' });
      const row = el('div', { class: 'card-row' });
      const applyReading = (o) => { c.question = o.question; c.answer = o.answer; c.answerSource = 'reconstructed'; q.value = o.question; a.value = o.answer; paintCards(); };
      row.append(
        el('div', { class: 'row', style: 'justify-content:space-between' },
          el('span', { class: 'n', text: `Problem ${c.number}` }), el('span', { class: 'tag', text: c.typeLabel })),
        el('label', { class: 'lbl', text: 'Question' }), q,
        el('div', { class: 'row', style: 'justify-content:space-between;align-items:center' },
          el('label', { class: 'lbl', text: 'Answer' }), srcTag), a,
        el('label', { class: 'lbl', text: 'Hint' }), h,
        el('div', { class: 'actions' },
          el('button', { class: 'btn small ghost', onclick: () => {
            const r = autoAnswer(c.question);
            if (!r) return toast("Couldn't solve — try '3 readings' or type it in.");
            c.answer = r.answer; c.answerSource = 'solved'; a.value = r.answer; srcTag.hidden = false; srcTag.textContent = 'solved by Volt';
          } }, '⚡ Solve'),
          el('button', { class: 'btn small ghost', onclick: () => {
            if (row.querySelector('.readings')) return row.querySelector('.readings').remove();
            const p = readingsPanel(c.question, applyReading);
            if (!p) return toast('No clean reading found — edit by hand.');
            row.append(p);
          } }, '🔀 3 readings'),
          el('button', { class: 'btn small danger', onclick: () => { model.splice(i, 1); paintCards(); } }, 'Remove')));
      if (!c.answer) { const p = readingsPanel(c.question, applyReading); if (p) row.append(p); }
      col.append(row);
    });
  }

  stage.append(el('div', { class: 'row', style: 'margin-top:16px' },
    el('button', { class: 'btn ghost', onclick: () => {
      let n = 0;
      for (const c of model) { if (c.answer.trim()) continue; const r = autoAnswer(c.question); if (r) { c.answer = r.answer; c.answerSource = 'solved'; n++; } }
      paintCards(); toast(n ? `Solved ${n} more.` : 'Nothing else Volt can solve.');
    } }, '⚡ Solve all blanks'),
    el('button', { class: 'btn ghost', onclick: () => { model.push({ id: rid(), question: '', answer: '', hint: '', typeLabel: 'General problem', page: 1 }); paintCards(); } }, '+ Add card'),
    el('button', { class: 'btn', onclick: () => saveDeck() }, `Save deck (${model.length} cards)`)));

  async function saveDeck() {
    const keep = model.filter((c) => c.question.trim());
    if (!keep.length) return toast('Add at least one card.');
    try {
      await api('/api/teacher/decks', { method: 'POST', body: JSON.stringify({
        name: nameInput.value.trim(), subject: subjInput.value.trim(),
        stashId: res.stashId, ext: res.ext, pages: res.pages,
        cards: keep.map((c) => ({ id: c.id, number: c.number, question: c.question.trim(), answer: c.answer.trim(), hint: c.hint.trim(), typeLabel: c.typeLabel, page: c.page })),
      }) });
      toast('Deck saved as a draft.');
      boot();
    } catch (e) { toast(e.message); }
  }
}

/* ------------------------------- edit ---------------------------- */
async function editView(id) {
  app.innerHTML = '';
  app.append(el('div', { class: 'muted', text: 'Loading…' }));
  let d;
  try { d = await api('/api/teacher/decks/' + id); } catch (e) { app.innerHTML = ''; app.append(el('div', { class: 'err', text: e.message })); return; }
  app.innerHTML = '';
  const nameInput = el('input', { class: 'field', value: d.name });
  const subjInput = el('input', { class: 'field', value: d.subject || '', placeholder: 'Subject' });
  app.append(el('button', { class: 'link', onclick: boot }, '← back'),
    el('h1', {}, 'Edit deck'),
    el('label', { class: 'lbl', text: 'Name' }), nameInput,
    el('label', { class: 'lbl', text: 'Subject' }), subjInput);

  const model = d.cards.map((c) => ({ ...c }));
  const col = el('div', { class: 'stack', style: 'margin-top:16px' });
  app.append(col);
  paint();
  function paint() {
    col.innerHTML = '';
    model.forEach((c, i) => {
      const q = el('textarea', { class: 'field', rows: 2 }); q.value = c.question;
      const a = el('textarea', { class: 'field', rows: 1 }); a.value = c.answer;
      const h = el('textarea', { class: 'field', rows: 1 }); h.value = c.hint || '';
      q.addEventListener('input', () => { c.question = q.value; });
      a.addEventListener('input', () => { c.answer = a.value; });
      h.addEventListener('input', () => { c.hint = h.value; });
      col.append(el('div', { class: 'card-box' },
        el('div', { class: 'row', style: 'justify-content:space-between' },
          el('span', { class: 'n', text: `Card ${i + 1}` }), el('span', { class: 'tag', text: c.typeLabel || classify(c.question).label })),
        el('label', { class: 'lbl', text: 'Question' }), q,
        el('label', { class: 'lbl', text: 'Answer' }), a,
        el('label', { class: 'lbl', text: 'Hint' }), h,
        el('div', { class: 'row', style: 'margin-top:8px' },
          el('button', { class: 'btn small ghost', onclick: () => { const r = autoAnswer(q.value); if (!r) return toast("Couldn't solve."); a.value = r.answer; c.answer = r.answer; } }, '⚡ Solve'),
          el('button', { class: 'btn small danger', onclick: () => { model.splice(i, 1); paint(); } }, 'Delete card'))));
    });
  }
  app.append(el('div', { class: 'row', style: 'margin-top:16px' },
    el('button', { class: 'btn ghost', onclick: () => { model.push({ id: rid(), question: '', answer: '', hint: '', typeLabel: 'General problem', page: 1 }); paint(); } }, '+ Add card'),
    el('button', { class: 'btn', onclick: async () => {
      try {
        await api('/api/teacher/decks', { method: 'POST', body: JSON.stringify({
          id: d.id, name: nameInput.value.trim(), subject: subjInput.value.trim(),
          cards: model.filter((c) => c.question.trim()).map((c) => ({ id: c.id, question: c.question.trim(), answer: c.answer.trim(), hint: (c.hint || '').trim(), typeLabel: classify(c.question).label, page: c.page || 1 })),
        }) });
        toast('Saved.'); boot();
      } catch (e) { toast(e.message); }
    } }, 'Save changes')));
}

/* ------------------------------ preview -------------------------- */
async function previewDeck(id) {
  let d;
  try { d = await api('/api/teacher/decks/' + id); } catch (e) { return toast(e.message); }
  if (!d.cards.length) return toast('No cards to preview.');
  app.innerHTML = '';
  const holder = el('div', { class: 'study-wrap' });
  app.append(holder);
  runStudy(holder, { id: d.id, name: d.name, cards: d.cards, pages: d.pages || [], antiGuess: !!d.antiGuess }, { onQuit: boot, onFinish: () => {} });
}

/* ------------------------------ results ------------------------- */
async function resultsView(d) {
  app.innerHTML = '';
  app.append(el('button', { class: 'link', onclick: boot }, '← back'), el('h1', {}, `Results — ${d.name}`));
  let rows;
  try { rows = await api(`/api/teacher/decks/${d.id}/results`); } catch (e) { app.append(el('div', { class: 'err', text: e.message })); return; }
  if (!rows.length) { app.append(el('div', { class: 'muted', text: 'No student has finished this deck yet.' })); return; }
  const t = el('table', { class: 'rows' });
  t.append(el('tr', {}, el('th', { text: 'Student' }), el('th', { text: 'Result' }), el('th', { text: 'Retries' }), el('th', { text: 'Time' }), el('th', { text: 'When' })));
  for (const r of rows) {
    t.append(el('tr', {},
      el('td', { text: r.student }),
      el('td', { text: r.perfect ? '🏆 perfect' : '✅ cleared' }),
      el('td', { text: String(r.retried ?? '—') }),
      el('td', { text: r.seconds != null ? `${Math.floor(r.seconds / 60)}m ${r.seconds % 60}s` : '—' }),
      el('td', { text: r.finishedAt ? new Date(r.finishedAt).toLocaleString() : '—' })));
  }
  app.append(t);
}

/* --------------------------- readings panel --------------------- */
function readingsPanel(rawText, onPick) {
  const opts = readingCandidates(rawText, 3);
  if (!opts.length) return null;
  const box = el('div', { class: 'readings' }, el('div', { class: 'h', text: 'POSSIBLE READINGS — pick the one that matches the worksheet' }));
  opts.forEach((o) => {
    const eq = el('div', { class: 'r-eq' }); renderExpr(eq, o.question);
    const ans = el('div', { class: 'r-ans' }); renderMath(ans, o.answer);
    box.append(el('button', { class: 'reading', onclick: () => onPick(o) },
      el('div', { class: 'r-main' }, eq, el('span', { class: 'r-arrow', text: '→' }), ans),
      el('span', { class: 'tag', text: o.note })));
  });
  return box;
}

const rid = () => Math.random().toString(36).slice(2, 10);

/* ------------------------------- boot --------------------------- */
async function boot() {
  let me;
  try { me = await api('/api/me'); } catch { me = { role: null }; }
  if (me.role !== 'teacher' && me.role !== 'owner') return loginView();
  whoName.textContent = me.name ? me.name : 'owner';
  logoutBtn.hidden = false;
  deckListView(me);
}
boot();
