import { uid, el, fmtDate, toast, shuffle, askText, askConfirm } from './util.js';
import {
  initStore, decks, getDeck, addDeck, removeDeck, save,
  settings, saveSettings, pickWorksheet, exportDeckFile, onOcrProgress,
} from './store.js';
import { freshSrs, schedule, deckStats } from './srs.js';
import { renderMath, renderExpr, renderQuestion } from './mathfmt.js';
import { splitProblems, offlineHints, classify } from './parser.js';
import { solve, steps as solveSteps } from './solve.js';
import { simplify } from './exponents.js';
import { candidates as readingCandidates } from './reconstruct.js';
import { worksheetToPages } from './ocr.js';
import { aiEnabled, aiCardsFromPage, aiHint } from './ai.js';
import { initCalculator } from './calc.js';

// Work out an answer offline: equations via the solver, exponent expressions
// via the simplifier.
function autoAnswer(question) {
  return solve(question) || simplify(question);
}

const main = document.getElementById('main');
let ocrStatusCb = null;
onOcrProgress((m) => {
  if (ocrStatusCb && m.status === 'recognizing text') {
    ocrStatusCb(`Recognizing text… ${Math.round((m.progress || 0) * 100)}%`, m.progress);
  }
});

function setActiveNav(view) {
  document.querySelectorAll('.navbtn[data-view]').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
}

function route(view, arg) {
  setActiveNav(view);
  main.scrollTop = 0;
  if (view === 'library') return renderLibrary();
  if (view === 'import') return renderImport();
  if (view === 'settings') return renderSettings();
  if (view === 'deck') return renderDeck(arg);
  if (view === 'study') return renderStudy(arg);
}

document.querySelectorAll('.navbtn[data-view]').forEach((b) => {
  b.addEventListener('click', () => route(b.dataset.view));
});

// ---------------- Library ----------------
function renderLibrary() {
  main.innerHTML = '';
  main.append(
    el('h1', { text: 'Your decks' }),
    el('div', { class: 'sub', text: 'Each worksheet you import becomes a deck of flashcards.' })
  );

  const list = decks();
  if (!list.length) {
    main.append(
      el('div', { class: 'empty' },
        el('p', { text: 'No decks yet.' }),
        el('button', { class: 'btn', onclick: () => route('import') }, 'Import your first worksheet')
      )
    );
    return;
  }

  const grid = el('div', { class: 'deck-grid' });
  for (const d of list) {
    const st = deckStats(d);
    const pct = st.total ? Math.round((st.mastered / st.total) * 100) : 0;
    grid.append(
      el('div', { class: 'deck-card', onclick: () => route('deck', d.id) },
        el('h3', { text: d.name }),
        el('div', { class: 'meta', text: `${st.total} cards · ${st.due} due · ${pct}% mastered` }),
        el('div', { class: 'meta', text: `added ${fmtDate(d.created)}` }),
        el('div', { class: 'bar' }, el('i', { style: `width:${pct}%` }))
      )
    );
  }
  main.append(grid);
}

// Quietly repair a deck: drop empty cards, collapse a question that got split
// over several lines when it's really one expression, trim stray fragments.
function tidyDeck(d) {
  let changed = false;
  const before = d.cards.length;
  d.cards = d.cards.filter((c) => (c.question || '').trim());
  if (d.cards.length !== before) changed = true;
  for (const c of d.cards) {
    if (/\n/.test(c.question)) {
      const lines = c.question.split('\n').map((l) => l.trim()).filter(Boolean);
      // trailing short crumbs after a real first line
      while (lines.length > 1 && lines[0].replace(/\s/g, '').length >= 12 &&
             lines[lines.length - 1].replace(/\s/g, '').length <= 8 && !/=/.test(lines[lines.length - 1])) lines.pop();
      const joined = lines.join(' ').replace(/\s+/g, ' ').trim();
      if (joined !== c.question) { c.question = joined; changed = true; }
    }
    if (!c.number) c.number = d.cards.indexOf(c) + 1;
    if (!Array.isArray(c.alts)) c.alts = [];
  }
  if (changed) save();
  return changed;
}

// ---------------- Deck detail ----------------
function renderDeck(id) {
  const d = getDeck(id);
  if (!d) return route('library');
  tidyDeck(d);
  main.innerHTML = '';

  const altCount = d.cards.reduce((m, c) => Math.max(m, (c.alts || []).length), 0);
  const withAns = d.cards.filter((c) => (c.answer || '').trim()).length;
  const studyBtn = () => el('button', { class: 'btn', style: 'font-size:15px;padding:11px 22px', onclick: () => route('study', d.id) }, `▶ Study${d.cards.length ? ` (${d.cards.length} cards)` : ''}`);

  const header = el('div', { class: 'deck-head' },
    el('div', { class: 'row', style: 'justify-content:space-between; align-items:flex-start' },
      el('div', {},
        el('h1', { style: 'margin-bottom:2px', text: d.name }),
        el('div', { class: 'sub', style: 'margin:0', text: `${d.cards.length} cards · ${withAns} with answers${altCount ? ` · ${altCount} alternate version${altCount > 1 ? 's' : ''}` : ''}` })
      ),
      studyBtn()
    ),
    el('div', { class: 'row', style: 'margin-top:12px' },
      el('button', { class: 'btn ghost small', onclick: () => {
        let n = 0;
        for (const c of d.cards) { if (c.answer && c.answer.trim()) continue; const r = autoAnswer(c.question); if (r) { c.answer = r.answer; c.answerSource = 'solved'; n++; } }
        save();
        toast(n ? `Solved ${n} blank answer${n > 1 ? 's' : ''}.` : 'Nothing else to solve.');
        renderDeck(d.id);
      } }, '⚡ Solve blanks'),
      el('button', { class: 'btn ghost small', onclick: () => addAlternate(d) }, '➕ Alternate worksheet'),
      el('button', { class: 'btn ghost small', onclick: () => renameDeck(d) }, 'Rename'),
      el('button', { class: 'btn ghost small', onclick: () => addCard(d) }, '+ Card'),
      el('button', { class: 'btn danger small', onclick: () => delDeck(d) }, 'Delete')
    )
  );
  main.append(header);
  main.append(el('h2', { style: 'margin-top:20px', text: 'Cards' }),
    el('div', { class: 'sub', text: 'Edit anything below, then hit ▶ Study above. Changes save automatically.' }));

  if (altCount) {
    const t = el('input', { type: 'checkbox' });
    t.checked = !!d.antiGuess;
    t.addEventListener('change', () => { d.antiGuess = t.checked; save(); });
    main.append(el('label', { class: 'card-box row', style: 'gap:10px' }, t,
      el('span', {}, el('b', { text: 'Anti-guessing' }),
        el('span', { class: 'sub', style: 'margin:0 0 0 8px', text: 'When a student misses a problem, the next time they see it it uses a different version (different numbers) from the alternate worksheet.' }))));
  }

  for (const [i, c] of d.cards.entries()) {
    main.append(cardEditor(d, c, i));
  }
  if (d.cards.length > 3) {
    main.append(el('div', { style: 'text-align:center; margin:24px 0 8px' }, studyBtn()));
  }
}

// Import another worksheet and attach each problem as an alternate version of the
// matching card (paired by problem number) — powers anti-guessing.
async function addAlternate(d) {
  const file = await pickWorksheet();
  if (!file) return;
  const box = el('div', { class: 'card-box' });
  const status = el('div', { class: 'status-line', text: 'Reading alternate worksheet…' });
  box.append(status);
  main.querySelector('h1').after(box);
  ocrStatusCb = (m) => (status.textContent = m);
  try {
    const { candidates } = await readWorksheet(file, (m) => (status.textContent = m));
    const byNum = new Map(candidates.map((c) => [c.number, c]));
    let paired = 0;
    for (const card of d.cards) {
      const alt = byNum.get(card.number);
      if (!alt || !alt.question.trim()) continue;
      const s = alt.answer ? null : autoAnswer(alt.question);
      card.alts = card.alts || [];
      card.alts.push({
        question: (s && s.question) || alt.question.trim(),
        answer: (alt.answer || (s ? s.answer : '')).trim(),
        hint: (alt.hint || '').trim(),
      });
      paired++;
    }
    d.antiGuess = true;
    save();
    toast(`Paired ${paired} of ${d.cards.length} problems. Anti-guessing is on.`);
    renderDeck(d.id);
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
  }
}

function cardEditor(deck, card, i) {
  const box = el('div', { class: 'card-box' });
  const q = el('textarea', { class: 'field', rows: 2 }); q.value = card.question || '';
  const a = el('textarea', { class: 'field', rows: 1 }); a.value = card.answer || '';
  const h = el('textarea', { class: 'field', rows: 1 }); h.value = card.hint || '';
  const commit = () => {
    card.question = q.value.trim();
    card.answer = a.value.trim();
    card.hint = h.value.trim();
    card.typeLabel = classify(card.question).label;
    save();
  };
  [q, a, h].forEach((t) => t.addEventListener('change', commit));

  const actions = el('div', { class: 'row', style: 'margin-top:8px' },
    el('button', { class: 'btn small ghost', onclick: () => {
      const r = autoAnswer(q.value);
      if (!r) return toast("Couldn't solve that one — check the question against the worksheet.");
      a.value = r.answer; commit(); toast('Solved.');
    } }, '⚡ Solve'),
    el('button', { class: 'btn small danger', onclick: () => {
      deck.cards = deck.cards.filter((x) => x.id !== card.id);
      save();
      renderDeck(deck.id);
    } }, 'Delete card')
  );
  // "3 readings" only helps a garbled question with no answer — hide it otherwise
  if (!(card.answer || '').trim()) {
    actions.insertBefore(el('button', { class: 'btn small ghost', onclick: () => {
      const existing = box.querySelector('.readings');
      if (existing) return existing.remove();
      const p = readingsPanel(q.value, (o) => {
        q.value = o.question; a.value = o.answer; commit();
        box.querySelector('.readings')?.remove();
      });
      if (!p) return toast('Volt couldn’t reconstruct that one — type the answer in from the worksheet.');
      box.append(p);
    } }, '🔀 3 readings'), actions.lastChild);
  }

  box.append(
    el('div', { class: 'row', style: 'justify-content:space-between' },
      el('span', { class: 'n', text: `Card ${i + 1}` }),
      el('span', { class: 'tag', text: card.typeLabel || classify(card.question).label })
    ),
    el('label', { class: 'lbl', text: 'Question' }), q,
    el('label', { class: 'lbl', text: 'Answer' }), a,
    el('label', { class: 'lbl', text: 'Hint (optional — shown when the student clicks 💡)' }), h,
    actions
  );
  return box;
}

async function renameDeck(d) {
  const name = await askText('Deck name:', d.name);
  if (name && name.trim()) { d.name = name.trim(); save(); renderDeck(d.id); }
}
function addCard(d) {
  const number = d.cards.reduce((m, c) => Math.max(m, c.number || 0), 0) + 1;
  d.cards.push({ id: uid(), number, question: '', answer: '', hint: '', alts: [], srs: freshSrs(), typeLabel: 'General problem' });
  save();
  renderDeck(d.id);
}
async function delDeck(d) {
  if (await askConfirm(`Delete "${d.name}" and its ${d.cards.length} cards?`, 'Delete')) {
    removeDeck(d.id);
    route('library');
  }
}

// ---------------- Import ----------------
function renderImport() {
  main.innerHTML = '';
  main.append(
    el('h1', { text: 'New deck from a worksheet' }),
    el('div', { class: 'sub', text: 'Pick a PDF or image. Volt reads it, splits it into problems, solves the equations it can, and lets you review before saving.' })
  );

  const aiBadge = aiEnabled()
    ? el('div', { class: 'sub', html: '🤖 AI assist is <b>on</b> — every problem and answer is filled in by Claude.' })
    : el('div', { class: 'sub', html: '⚙ Offline mode. <b>Tip:</b> import the <b>PDF</b> if you have one — screenshots of fraction-heavy sheets read poorly. Volt still solves linear equations, quadratics and systems on its own.' });
  main.append(aiBadge);

  const dz = el('div', { class: 'dropzone', text: '📄  Click to choose a worksheet file (PDF, PNG, JPG)' });
  const bar = el('div', { class: 'progress' }, el('i'));
  const status = el('div', { class: 'status-line' });
  bar.style.display = 'none';
  main.append(dz, bar, status);
  const stage = el('div');
  main.append(stage);

  const setStatus = (msg, frac) => {
    status.textContent = msg;
    if (typeof frac === 'number') { bar.style.display = 'block'; bar.firstChild.style.width = `${Math.round(frac * 100)}%`; }
  };
  ocrStatusCb = setStatus;

  dz.addEventListener('click', async () => {
    const file = await pickWorksheet();
    if (!file) return;
    dz.textContent = `📄  ${file.name}`;
    stage.innerHTML = '';
    bar.style.display = 'block';
    try {
      const { pages, candidates } = await readWorksheet(file, setStatus);
      setStatus(`Found ${candidates.length} problems. Review below, then save.`, 1);
      reviewStage(stage, file, pages, candidates);
    } catch (err) {
      setStatus('Error: ' + err.message);
      console.error(err);
    }
  });
}

// Read a worksheet file -> { pages, candidates } where candidates are in
// problem-number order with answers worked out where possible.
async function readWorksheet(file, setStatus) {
  const allPages = await worksheetToPages(file, setStatus);
  const pages = allPages.filter((p) => !p.isAnswerKey);
  const keyPages = allPages.filter((p) => p.isAnswerKey);
  if (keyPages.length) setStatus(`Skipped ${keyPages.length} answer-key page${keyPages.length > 1 ? 's' : ''}.`);

  const candidates = [];
  if (aiEnabled()) {
    for (const [idx, page] of pages.entries()) {
      setStatus(`AI reading page ${idx + 1}/${pages.length}…`, (idx + 1) / pages.length);
      try {
        (await aiCardsFromPage(page)).forEach((c) => candidates.push({ ...c, page: page.index }));
      } catch (err) {
        setStatus(`AI failed on page ${idx + 1} (${err.message}) — falling back to offline split.`);
        splitProblems(page.text).forEach((c) => candidates.push({ ...c, page: page.index }));
      }
    }
  } else {
    for (const page of pages) splitProblems(page.text).forEach((c) => candidates.push({ ...c, page: page.index }));
    const key = {};
    for (const kp of keyPages) for (const c of splitProblems(kp.text)) if (c.answer) key[c.number] = c.answer;
    for (const c of candidates) if (!c.answer && key[c.number]) c.answer = key[c.number];
  }
  // worksheets number problems 1,2,3… — order the cards that way, not the
  // column-reading order (which gives 1,3,5,… then 2,4,6,…)
  candidates.sort((a, b) => (a.number || 1e6) - (b.number || 1e6));
  return { pages, candidates };
}

function reviewStage(stage, file, pages, candidates) {
  stage.innerHTML = '';
  const nameInput = el('input', { class: 'field', value: file.name.replace(/\.[^.]+$/, '') });
  stage.append(
    el('label', { class: 'lbl', text: 'Deck name' }), nameInput,
    el('h2', { text: 'Review cards' })
  );

  const wrap = el('div', { class: 'pagewrap' });
  const preview = el('div', { class: 'page-preview' });
  const showImg = el('button', { class: 'btn small ghost', onclick: () => paintPreview('img') }, 'Image');
  const showTxt = el('button', { class: 'btn small ghost', onclick: () => paintPreview('txt') }, 'Raw text');
  let pv = 'img';
  function paintPreview(mode) {
    pv = mode;
    preview.innerHTML = '';
    preview.append(el('div', { class: 'row', style: 'margin-bottom:8px' }, showImg, showTxt));
    for (const p of pages) {
      if (mode === 'img' && p.image) preview.append(el('img', { src: p.image }));
      else preview.append(el('pre', { text: `— page ${p.index} —\n` + (p.text || '(no text)') }));
    }
  }
  paintPreview('img');

  const cardsCol = el('div', { class: 'cards-edit' });
  const pageText = pages.map((p) => (p.text || '').toLowerCase());
  const guessPage = (q) => {
    const probe = (q || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 24);
    if (probe.length >= 6) {
      const hit = pageText.findIndex((t) => t.replace(/\s+/g, ' ').includes(probe));
      if (hit !== -1) return pages[hit].index;
    }
    return pages[0] ? pages[0].index : 1;
  };
  const model = candidates.map((c, i) => {
    const s = !c.answer ? autoAnswer(c.question || '') : null;
    const question = (s && s.question) || c.question || '';
    return {
      id: uid(),
      number: c.number || i + 1,
      question,
      answer: c.answer || (s ? s.answer : ''),
      answerSource: c.answer ? 'key' : s ? 'solved' : '',
      hint: c.hint || '',
      typeLabel: c.type || c.typeLabel || classify(question).label,
      page: c.page || guessPage(c.question),
    };
  });
  const solvedCount = model.filter((c) => c.answerSource === 'solved').length;
  if (solvedCount) setTimeout(() => toast(`Volt solved ${solvedCount} problem${solvedCount > 1 ? 's' : ''} for you — double-check them.`), 400);

  function paintCards() {
    cardsCol.innerHTML = '';
    model.forEach((c, i) => {
      const q = el('textarea', { class: 'field', rows: 2 }); q.value = c.question;
      const a = el('textarea', { class: 'field', rows: 1 }); a.value = c.answer;
      const h = el('textarea', { class: 'field', rows: 1 }); h.value = c.hint;
      q.addEventListener('input', () => { c.question = q.value; });
      a.addEventListener('input', () => { c.answer = a.value; c.answerSource = 'edited'; });
      h.addEventListener('input', () => (c.hint = h.value));
      const srcTag = el('span', { class: 'tag', hidden: c.answerSource !== 'solved' && c.answerSource !== 'key' && c.answerSource !== 'reconstructed',
        text: c.answerSource === 'key' ? 'from answer key' : c.answerSource === 'reconstructed' ? 'reading you picked' : 'solved by Volt' });
      const row = el('div', { class: 'card-row' });
      const applyReading = (o) => {
        c.question = o.question; c.answer = o.answer; c.answerSource = 'reconstructed';
        q.value = o.question; a.value = o.answer;
        c.typeLabel = classify(o.question).label;
        paintCards();
      };
      const solveBtn = el('button', { class: 'btn small ghost', onclick: () => {
        const r = autoAnswer(c.question);
        if (!r) return toast("Couldn't solve that one — try '3 readings' or type the answer in.");
        c.answer = r.answer; c.answerSource = 'solved'; a.value = r.answer;
        srcTag.textContent = 'solved by Volt'; srcTag.hidden = false;
      } }, '⚡ Solve');
      const readingsBtn = el('button', { class: 'btn small ghost', onclick: () => {
        const p = readingsPanel(c.question, applyReading);
        const existing = row.querySelector('.readings');
        if (existing) { existing.remove(); return; }
        if (!p) return toast("Volt couldn't come up with a clean reading — type the answer in.");
        row.append(p);
      } }, '🔀 3 readings');

      row.append(
        el('div', { class: 'row', style: 'justify-content:space-between' },
          el('span', { class: 'n', text: `Problem ${c.number}` }),
          el('span', { class: 'tag', text: c.typeLabel })
        ),
        el('label', { class: 'lbl', text: 'Question' }), q,
        el('div', { class: 'row', style: 'justify-content:space-between;align-items:center' },
          el('label', { class: 'lbl', text: 'Answer' }), srcTag),
        a,
        el('label', { class: 'lbl', text: 'Hint' }), h,
        el('div', { class: 'actions' }, solveBtn, readingsBtn,
          el('button', { class: 'btn small danger', onclick: () => { model.splice(i, 1); paintCards(); } }, 'Remove'))
      );
      // if we couldn't get an answer, surface the 3 readings straight away
      if (!c.answer) {
        const p = readingsPanel(c.question, applyReading);
        if (p) row.append(p);
      }
      cardsCol.append(row);
    });
  }
  paintCards();

  wrap.append(preview, cardsCol);
  stage.append(wrap);

  stage.append(
    el('div', { class: 'row', style: 'margin-top:16px' },
      el('button', { class: 'btn ghost', onclick: () => {
        let n = 0;
        for (const c of model) {
          if (c.answer.trim()) continue;
          const r = autoAnswer(c.question);
          if (r) { c.answer = r.answer; c.answerSource = 'solved'; n++; }
        }
        paintCards();
        toast(n ? `Solved ${n} more.` : 'Nothing left that Volt can solve automatically.');
      } }, '⚡ Solve all blank answers'),
      el('button', { class: 'btn ghost', onclick: () => { model.push({ id: uid(), question: '', answer: '', hint: '', typeLabel: 'General problem' }); paintCards(); } }, '+ Add blank card'),
      el('button', { class: 'btn', onclick: () => {
        const keep = model.filter((c) => c.question.trim());
        if (!keep.length) return toast('Add at least one card with a question.');
        const deck = {
          id: uid(),
          name: nameInput.value.trim() || 'Untitled worksheet',
          source: file.name,
          created: Date.now(),
          pages: pages.map((p) => ({ index: p.index, image: p.display || p.image })),
          cards: keep.map((c, i) => ({
            id: uid(),
            number: c.number || i + 1,
            question: c.question.trim(),
            answer: c.answer.trim(),
            hint: c.hint.trim(),
            typeLabel: c.typeLabel,
            page: c.page || 1,
            alts: [],
            srs: freshSrs(),
          })),
        };
        addDeck(deck).then(() => { toast('Deck saved.'); route('deck', deck.id); });
      } }, `Save deck (${model.length} cards)`)
    )
  );
}

// ---------------- Study session (requeue wrong cards until all correct) ----------------
function renderStudy(deckId) {
  const deck = getDeck(deckId);
  if (!deck) return route('library');
  tidyDeck(deck);
  const studyCards = deck.cards.filter((c) => (c.question || '').trim());
  if (!studyCards.length) { toast('This deck has no usable cards yet — add or fix some first.'); return route('deck', deckId); }
  main.innerHTML = '';

  // session state
  const session = {
    queue: shuffle(studyCards.map((c) => c.id)),
    attempts: {},        // cardId -> attempts this session
    version: {},         // cardId -> which version to show (0 = original, 1+ = alts)
    wrongOnce: new Set(),
    correct: 0,
    startedAt: Date.now(),
  };
  studyCards.forEach((c) => { session.attempts[c.id] = 0; session.version[c.id] = 0; });

  const antiGuess = !!deck.antiGuess;
  const total = studyCards.length;

  // the content to show right now for a card — its original, or an alternate
  // version if the student has missed it and anti-guessing is on
  function view(card) {
    const v = session.version[card.id] || 0;
    if (v === 0 || !card.alts || !card.alts[v - 1]) return card;
    const alt = card.alts[v - 1];
    return { ...card, question: alt.question, answer: alt.answer, hint: alt.hint };
  }
  function rotateVersion(card) {
    if (!antiGuess || !card.alts || !card.alts.length) return;
    session.version[card.id] = ((session.version[card.id] || 0) + 1) % (card.alts.length + 1);
  }

  function next() {
    if (!session.queue.length) return finish();
    const base = studyCards.find((c) => c.id === session.queue[0]);
    paintCard(base, view(base));
  }

  function paintCard(base, card) {
    main.innerHTML = '';
    let flipped = false;
    let hintLevel = 0;
    const oh = offlineHints(card);
    const vLabel = (session.version[base.id] || 0) > 0 ? ` · version ${session.version[base.id] + 1}` : '';

    const top = el('div', { class: 'study-top' },
      el('button', { class: 'iconbtn', onclick: () => confirmQuit() }, '← Quit'),
      el('span', { text: `${session.correct}/${total} correct · ${session.queue.length} in queue${vLabel}` }),
      el('span', { class: 'tag', text: card.typeLabel || oh.typeLabel })
    );

    const face = el('div', { class: 'flashcard' });
    const sideLabel = el('div', { class: 'side-label', text: 'QUESTION' });
    const faceInner = el('div');
    face.append(faceInner);
    renderQuestion(faceInner, card.question);

    const outer = el('div', { class: 'flashcard-outer' }, sideLabel, face);

    const hintBox = el('div', { class: 'hintbox hidden' });
    const hintContent = el('div');
    hintBox.append(el('div', { class: 'h', text: 'HINT' }), hintContent);

    const lightbulb = el('button', { class: 'iconbtn lightbulb', title: 'Hint', onclick: async () => {
      hintBox.classList.remove('hidden');
      hintLevel++;
      if (card.hint && hintLevel === 1) {
        hintContent.textContent = card.hint;
        return;
      }
      if (aiEnabled() && hintLevel >= (card.hint ? 2 : 1)) {
        hintContent.textContent = 'Thinking of a hint…';
        try {
          hintContent.textContent = await aiHint(card, hintLevel);
        } catch (e) {
          hintContent.textContent = fallbackHint(oh, hintLevel);
        }
        return;
      }
      hintContent.textContent = fallbackHint(oh, hintLevel);
    } }, '💡 Hint');

    const pageImg = deckPageImage(deck, card.page);
    const pageBox = el('div', { class: 'pagepeek hidden' },
      pageImg ? el('img', { src: pageImg, alt: `Worksheet page ${card.page}` }) : el('div', { class: 'sub', text: 'No page image saved for this deck.' })
    );
    const pageBtn = pageImg
      ? el('button', { class: 'iconbtn', title: 'Show the original worksheet page (useful for graphs & diagrams)',
          onclick: () => { pageBox.classList.toggle('hidden'); pageBtn.classList.toggle('active'); } }, '📄 Worksheet')
      : null;

    const flipBtn = el('button', { class: 'btn ghost', onclick: doFlip }, 'Show answer');
    function doFlip() {
      flipped = true;
      sideLabel.textContent = 'ANSWER';
      let ans = card.answer;
      const work = solveSteps(card.question);
      if (!ans) {
        const r = autoAnswer(card.question);
        if (r) { ans = r.answer; if (card === base) { base.answer = ans; save(); } }
      }
      renderQuestion(faceInner, ans || '(no answer saved — check the worksheet)');
      controls.innerHTML = '';
      if (work.length) {
        const wbox = el('div', { class: 'hintbox hidden', style: 'border-color:var(--accent)' },
          el('div', { class: 'h', style: 'color:var(--accent)', text: 'WORKING' }),
          el('div', { html: work.map((s) => `<div>${s}</div>`).join('') }));
        pageBox.after(wbox);
        controls.append(el('div', { class: 'row', style: 'justify-content:center' },
          el('button', { class: 'iconbtn', onclick: () => wbox.classList.toggle('hidden') }, '📝 Show working')));
      }
      controls.append(gradeRow());
    }
    face.addEventListener('click', () => { if (!flipped) doFlip(); });

    const controls = el('div', { class: 'grade-row' });
    controls.append(
      el('div', { class: 'row', style: 'justify-content:center;gap:10px' }, lightbulb, pageBtn, flipBtn)
    );

    function gradeRow() {
      const row = el('div', { class: 'grade-row' });
      const mark = (correct, grade) => {
        session.attempts[base.id]++;
        base.srs = schedule(base.srs || freshSrs(), grade);
        session.queue.shift();
        if (correct) {
          session.correct++;
        } else {
          session.wrongOnce.add(base.id);
          rotateVersion(base);           // next time, a different version
          session.queue.push(base.id);   // back of the line
        }
        save();
        next();
      };
      const altNote = antiGuess && base.alts && base.alts.length ? 'different version next time' : 'back of the deck';
      row.append(
        el('button', { class: 'again', onclick: () => mark(false, 0) }, 'Got it wrong', el('small', { text: altNote })),
        el('button', { class: 'good', onclick: () => mark(true, 4) }, 'Got it right', el('small', { text: 'remove from deck' })),
        el('button', { class: 'easy', onclick: () => mark(true, 5) }, 'Easy', el('small', { text: 'knew it instantly' }))
      );
      return row;
    }

    async function confirmQuit() {
      if (await askConfirm('Quit this session? You need a full run to see the report.', 'Quit')) route('deck', deck.id);
    }

    main.append(top, outer, hintBox, pageBox, controls);

    // keyboard: space = flip, 1 = wrong, 2 = right, h = hint
    const onKey = (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); if (!flipped) doFlip(); }
      else if (e.key === 'h') lightbulb.click();
      else if (flipped && e.key === '1') controls.querySelector('.again')?.click();
      else if (flipped && e.key === '2') controls.querySelector('.good')?.click();
    };
    window.addEventListener('keydown', onKey);
    const obs = new MutationObserver(() => {
      if (!document.body.contains(top)) { window.removeEventListener('keydown', onKey); obs.disconnect(); }
    });
    obs.observe(main, { childList: true });
  }

  function finish() {
    const secs = Math.round((Date.now() - session.startedAt) / 1000);
    const perfect = session.wrongOnce.size === 0;
    main.innerHTML = '';
    main.append(
      el('div', { class: 'done-screen' },
        el('div', { class: 'big', text: perfect ? '🏆' : '✅' }),
        el('h1', { text: perfect ? 'Perfect run!' : 'Deck cleared!' }),
        el('div', { class: 'sub', text: `${total} cards · ${session.wrongOnce.size} needed a retry · ${Math.floor(secs / 60)}m ${secs % 60}s` })
      )
    );
    main.append(reportView(deck, session, studyCards));
  }

  next();
}

// Panel of up to 3 candidate readings of a garbled/ambiguous question.
// onPick({question, answer}) is called when the student chooses one.
function readingsPanel(rawText, onPick) {
  const opts = readingCandidates(rawText, 3);
  if (!opts.length) return null;
  const box = el('div', { class: 'readings' },
    el('div', { class: 'h', text: 'POSSIBLE READINGS — pick the one that matches the worksheet' })
  );
  opts.forEach((o) => {
    const eq = el('div', { class: 'r-eq' });
    renderExpr(eq, o.question);
    const ans = el('div', { class: 'r-ans' });
    renderMath(ans, o.answer);
    box.append(
      el('button', { class: 'reading', onclick: () => onPick(o) },
        el('div', { class: 'r-main' }, eq, el('span', { class: 'r-arrow', text: '→' }), ans),
        el('span', { class: 'tag', text: o.note })
      )
    );
  });
  return box;
}

function deckPageImage(deck, pageNum) {
  if (!deck || !Array.isArray(deck.pages) || !deck.pages.length) return null;
  const p = deck.pages.find((x) => x.index === pageNum) || deck.pages[0];
  return p ? p.image : null;
}

function fallbackHint(oh, level) {
  const arr = oh.hints || [];
  const i = Math.min(level - 1, arr.length - 1);
  return `(${oh.typeLabel}) ` + (arr[i] || arr[arr.length - 1] || 'Re-read the problem and write down the formula that applies.');
}

// ---------------- Report ----------------
function reportView(deck, session, cards) {
  cards = cards || deck.cards;
  const box = el('div', {});
  box.append(el('h2', { text: 'Answer report' }),
    el('div', { class: 'sub', text: 'Every problem in this deck with its correct answer.' }));

  cards.forEach((c, i) => {
    const tries = session ? session.attempts[c.id] : null;
    const v = session && session.version ? (session.version[c.id] || 0) : 0;
    const shown = v > 0 && c.alts && c.alts[v - 1] ? c.alts[v - 1] : c;
    const row = el('div', { class: 'card-box' });
    const qEl = el('div'); renderQuestion(qEl, shown.question);
    const aEl = el('div', { style: 'margin-top:6px' }); renderQuestion(aEl, shown.answer || '—');
    row.append(
      el('div', { class: 'row', style: 'justify-content:space-between' },
        el('span', { class: 'n', text: `Problem ${c.number || i + 1}${v > 0 ? ` (version ${v + 1})` : ''}` }),
        el('span', { class: 'tag', text: tries != null ? `${tries} ${tries === 1 ? 'try' : 'tries'}` : (c.typeLabel || '') })
      ),
      el('label', { class: 'lbl', text: 'Question' }), qEl,
      el('label', { class: 'lbl', text: 'Correct answer' }), aEl
    );
    box.append(row);
  });

  box.append(
    el('div', { class: 'row', style: 'margin-top:16px' },
      el('button', { class: 'btn', onclick: () => exportReport(deck, session, cards) }, '⬇ Export report (.txt)'),
      el('button', { class: 'btn ghost', onclick: () => window.print() }, '🖨 Print'),
      el('button', { class: 'btn ghost', onclick: () => route('library') }, 'Back to library'),
      el('button', { class: 'btn ghost', onclick: () => route('study', deck.id) }, 'Study again')
    )
  );
  return box;
}

function exportReport(deck, session, cards) {
  cards = cards || deck.cards;
  const lines = [`ANSWER REPORT — ${deck.name}`, new Date().toLocaleString(), ''.padEnd(50, '='), ''];
  cards.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.question.replace(/\n/g, ' ')}`);
    lines.push(`   Answer: ${c.answer || '—'}`);
    if (session) lines.push(`   Attempts this session: ${session.attempts[c.id]}`);
    lines.push('');
  });
  exportDeckFile(deck.name + '-answers', lines.join('\n')).then((ok) => ok && toast('Report saved.'));
}

// ---------------- Settings ----------------
function renderSettings() {
  main.innerHTML = '';
  const s = settings();
  main.append(
    el('h1', { text: 'Settings' }),
    el('div', { class: 'sub', text: 'The app works fully offline. AI assist is optional and uses your own Anthropic API key.' })
  );

  const useAI = el('input', { type: 'checkbox' });
  useAI.checked = !!s.useAI;
  const key = el('input', { class: 'field', type: 'password', placeholder: 'sk-ant-…' });
  key.value = s.apiKey || '';
  const model = el('select', { class: 'field' });
  [
    ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5 — cheapest, good enough for worksheets'],
    ['claude-sonnet-5', 'Claude Sonnet 5 — most accurate, costs more'],
  ].forEach(([v, label]) => {
    const o = el('option', { value: v, text: label });
    if (v === s.model) o.selected = true;
    model.append(o);
  });

  main.append(
    el('div', { class: 'card-box' },
      el('label', { class: 'row' }, useAI, el('span', { text: ' Use Claude AI assist (auto-generate cards & smarter hints)' })),
      el('label', { class: 'lbl', text: 'Anthropic API key' }), key,
      el('div', { class: 'sub', html: 'Billed separately from Claude Pro. Get one at <a href="https://console.anthropic.com">console.anthropic.com</a> → Billing (add ~$5 of credits). Roughly $0.01–0.04 per worksheet with Haiku. The key is stored only on this computer.' }),
      el('label', { class: 'lbl', text: 'Model' }), model,
      el('div', { class: 'row', style: 'margin-top:12px' },
        el('button', { class: 'btn', onclick: () => {
          saveSettings({ useAI: useAI.checked, apiKey: key.value.trim(), model: model.value }).then(() => toast('Settings saved.'));
        } }, 'Save settings')
      )
    ),
    el('div', { class: 'card-box' },
      el('h2', { text: 'How it works' }),
      el('p', { class: 'sub', html:
        '<b>Offline:</b> PDFs with real text are read directly; scans and images go through built-in OCR. ' +
        'Problems are split on their numbers, classified (linear equation, area, Pythagorean, …), and each gets ' +
        'strategy hints. You fill in answers, or import an answer key by including it in the file.<br><br>' +
        '<b>With AI:</b> each page is sent to Claude, which returns the problems, worked answers, and Socratic hints automatically.' })
    )
  );
}

// ---------------- boot ----------------
// surface any crash so it's not just a dead screen
function showCrash(where, err) {
  const msg = (err && (err.stack || err.message)) || String(err);
  main.innerHTML = '';
  main.append(
    el('h1', { text: 'Something went wrong' }),
    el('div', { class: 'sub', text: `while ${where}. This shouldn't happen — the details below help fix it.` }),
    el('pre', { class: 'crash', text: msg }),
    el('div', { class: 'row' },
      el('button', { class: 'btn', onclick: () => route('library') }, 'Back to library'),
      el('button', { class: 'btn ghost', onclick: () => location.reload() }, 'Reload Volt'))
  );
}
window.addEventListener('error', (e) => showCrash('running', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showCrash('running', e.reason));

const _route = route;
route = function (view, arg) {
  try { return _route(view, arg); }
  catch (err) { showCrash(`opening ${view}`, err); }
};

initStore().then(() => {
  initCalculator();
  route('library');
}).catch((err) => showCrash('starting up', err));
