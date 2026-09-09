// Volt study engine — flip cards, wrong answers go to the back of the deck, the
// session ends only when every card is right, then a full answer report.
// Shared by the student view and the teacher's "preview" button.
import { el, shuffle } from '/shared/util.js';
import { renderMath, renderQuestion } from '/shared/mathfmt.js';
import { offlineHints } from '/shared/parser.js';
import { solve, steps as solveSteps } from '/shared/solve.js';
import { simplify } from '/shared/exponents.js';
import { freshSrs, schedule } from '/shared/srs.js';

const autoAnswer = (q) => solve(q) || simplify(q);

function deckPageImage(deck, pageNum) {
  if (!deck || !Array.isArray(deck.pages) || !deck.pages.length) return null;
  const p = deck.pages.find((x) => x.index === pageNum) || deck.pages[0];
  return p && p.image ? p.image : null;
}
function fallbackHint(oh, level) {
  const arr = oh.hints || [];
  const i = Math.min(level - 1, arr.length - 1);
  return `(${oh.typeLabel}) ` + (arr[i] || arr[arr.length - 1] || 'Re-read the problem and write down the formula that applies.');
}

/**
 * runStudy(container, deck, { onQuit, onFinish })
 *  - deck: { id, name, cards:[{id,question,answer,hint,typeLabel,page}], pages }
 *  - onFinish(summary) where summary = { total, retried, seconds, perfect, attempts }
 */
export function runStudy(container, deck, opts = {}) {
  const cards = deck.cards
    .filter((c) => (c.question || '').trim())
    .map((c) => ({ ...c, question: String(c.question).replace(/\s*\n\s*/g, ' ').trim(), srs: freshSrs() }));
  if (!cards.length) { container.textContent = 'This deck has no usable cards yet.'; return; }
  const total = cards.length;
  const antiGuess = !!deck.antiGuess;
  const session = {
    queue: shuffle(cards.map((c) => c.id)),
    attempts: Object.fromEntries(cards.map((c) => [c.id, 0])),
    version: Object.fromEntries(cards.map((c) => [c.id, 0])),
    wrongOnce: new Set(),
    correct: 0,
    startedAt: Date.now(),
  };

  // the content to show right now — the original, or an alternate version if the
  // student missed this problem and anti-guessing is on
  const view = (base) => {
    const v = session.version[base.id] || 0;
    if (v === 0 || !base.alts || !base.alts[v - 1]) return base;
    const alt = base.alts[v - 1];
    return { ...base, question: alt.question, answer: alt.answer, hint: alt.hint };
  };
  const rotateVersion = (base) => {
    if (!antiGuess || !base.alts || !base.alts.length) return;
    session.version[base.id] = ((session.version[base.id] || 0) + 1) % (base.alts.length + 1);
  };

  let keyHandler = null;
  const cleanupKeys = () => { if (keyHandler) window.removeEventListener('keydown', keyHandler); keyHandler = null; };

  function next() {
    if (!session.queue.length) return finish();
    const base = cards.find((c) => c.id === session.queue[0]);
    paintCard(base, view(base));
  }

  function paintCard(base, card) {
    container.innerHTML = '';
    cleanupKeys();
    let flipped = false;
    let hintLevel = 0;
    const oh = offlineHints(card);
    const vLabel = (session.version[base.id] || 0) > 0 ? ` · version ${session.version[base.id] + 1}` : '';

    const top = el('div', { class: 'study-top' },
      el('button', { class: 'iconbtn', onclick: quit }, '← Quit'),
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
    const lightbulb = el('button', { class: 'iconbtn lightbulb', title: 'Hint', onclick: () => {
      hintBox.classList.remove('hidden');
      hintLevel++;
      if (card.hint && hintLevel === 1) { hintContent.textContent = card.hint; return; }
      hintContent.textContent = fallbackHint(oh, hintLevel - (card.hint ? 1 : 0) || 1);
    } }, '💡 Hint');

    const pageImg = deckPageImage(deck, card.page);
    const pageBox = el('div', { class: 'pagepeek hidden' },
      pageImg ? el('img', { src: pageImg, alt: `Worksheet page ${card.page}` }) : el('div', { class: 'sub', text: 'No page image for this deck.' }));
    const pageBtn = pageImg
      ? el('button', { class: 'iconbtn', title: 'Show the original worksheet page',
          onclick: () => { pageBox.classList.toggle('hidden'); pageBtn.classList.toggle('active'); } }, '📄 Worksheet')
      : null;

    const controls = el('div', { class: 'grade-row' });
    const flipBtn = el('button', { class: 'btn ghost', onclick: doFlip }, 'Show answer');

    function doFlip() {
      if (flipped) return;
      flipped = true;
      sideLabel.textContent = 'ANSWER';
      let ans = card.answer;
      const work = solveSteps(card.question);
      if (!ans) { const r = autoAnswer(card.question); if (r) { ans = r.answer; if (card === base) base.answer = ans; } }
      renderQuestion(faceInner, ans || '(no answer saved — check the worksheet)');
      controls.innerHTML = '';
      if (work.length) {
        const wbox = el('div', { class: 'hintbox hidden', style: 'border-color:var(--accent)' },
          el('div', { class: 'h', style: 'color:var(--accent)', text: 'WORKING' }),
          el('div', { html: work.map((s) => `<div>${escapeHtml(s)}</div>`).join('') }));
        pageBox.after(wbox);
        controls.append(el('div', { class: 'row', style: 'justify-content:center' },
          el('button', { class: 'iconbtn', onclick: () => wbox.classList.toggle('hidden') }, '📝 Show working')));
      }
      controls.append(gradeRow());
    }
    face.addEventListener('click', doFlip);

    controls.append(el('div', { class: 'row', style: 'justify-content:center;gap:10px' }, lightbulb, pageBtn, flipBtn));

    function gradeRow() {
      const row = el('div', { class: 'grade-row' });
      const mark = (correct, grade) => {
        session.attempts[base.id]++;
        base.srs = schedule(base.srs, grade);
        session.queue.shift();
        if (correct) session.correct++;
        else { session.wrongOnce.add(base.id); rotateVersion(base); session.queue.push(base.id); }
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

    container.append(top, outer, hintBox, pageBox, controls);

    keyHandler = (e) => {
      if (/^(TEXTAREA|INPUT)$/.test(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); doFlip(); }
      else if (e.key === 'h') lightbulb.click();
      else if (flipped && e.key === '1') controls.querySelector('.again')?.click();
      else if (flipped && e.key === '2') controls.querySelector('.good')?.click();
    };
    window.addEventListener('keydown', keyHandler);
  }

  function quit() {
    if (confirm('Quit this session? You will need a full run for the report.')) { cleanupKeys(); opts.onQuit && opts.onQuit(); }
  }

  function finish() {
    cleanupKeys();
    const secs = Math.round((Date.now() - session.startedAt) / 1000);
    const perfect = session.wrongOnce.size === 0;
    container.innerHTML = '';
    container.append(
      el('div', { class: 'done-screen' },
        el('div', { class: 'big', text: perfect ? '🏆' : '✅' }),
        el('h1', { text: perfect ? 'Perfect run!' : 'Deck cleared!' }),
        el('div', { class: 'sub', text: `${total} cards · ${session.wrongOnce.size} needed a retry · ${Math.floor(secs / 60)}m ${secs % 60}s` })
      ),
      reportView()
    );
    opts.onFinish && opts.onFinish({
      total, retried: session.wrongOnce.size, seconds: secs, perfect,
      attempts: { ...session.attempts },
    });
  }

  function reportView() {
    const box = el('div', {});
    box.append(el('h2', { text: 'Answer report' }),
      el('div', { class: 'sub', text: 'Every problem in this deck with its correct answer.' }));
    cards.forEach((c, i) => {
      const v = session.version[c.id] || 0;
      const shown = v > 0 && c.alts && c.alts[v - 1] ? c.alts[v - 1] : c;
      const qEl = el('div'); renderQuestion(qEl, shown.question);
      const aEl = el('div', { style: 'margin-top:6px' }); renderQuestion(aEl, shown.answer || '—');
      const tries = session.attempts[c.id];
      box.append(el('div', { class: 'card-box' },
        el('div', { class: 'row', style: 'justify-content:space-between' },
          el('span', { class: 'n', text: `Problem ${c.number || i + 1}${v > 0 ? ` (version ${v + 1})` : ''}` }),
          el('span', { class: 'tag', text: `${tries} ${tries === 1 ? 'try' : 'tries'}` })),
        el('label', { class: 'lbl', text: 'Question' }), qEl,
        el('label', { class: 'lbl', text: 'Correct answer' }), aEl));
    });
    box.append(el('div', { class: 'row', style: 'margin-top:16px' },
      el('button', { class: 'btn', onclick: () => downloadReport(deck, cards, session) }, '⬇ Download report (.txt)'),
      el('button', { class: 'btn ghost', onclick: () => window.print() }, '🖨 Print'),
      el('button', { class: 'btn ghost', onclick: () => opts.onQuit && opts.onQuit() }, 'Done'),
      el('button', { class: 'btn ghost', onclick: () => runStudy(container, deck, opts) }, 'Study again')));
    return box;
  }

  next();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function downloadReport(deck, cards, session) {
  const lines = [`ANSWER REPORT — ${deck.name}`, new Date().toLocaleString(), '='.repeat(50), ''];
  cards.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.question.replace(/\n/g, ' ')}`);
    lines.push(`   Answer: ${c.answer || '—'}`);
    lines.push(`   Attempts: ${session.attempts[c.id]}`);
    lines.push('');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${deck.name.replace(/[^\w-]+/g, '_')}-answers.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
