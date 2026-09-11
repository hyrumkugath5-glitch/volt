import { el, toast } from '/shared/util.js';
import { runStudy } from '/study.mjs';
import { initCalculator } from '/calc.mjs';

const app = document.getElementById('app');
const whoName = document.getElementById('whoName');
const changeBtn = document.getElementById('changeName');

const LS = 'argon_student_name';
let name = '';
try { name = localStorage.getItem(LS) || ''; } catch {}

initCalculator();

function setName(n) {
  name = (n || '').trim().slice(0, 40);
  try { localStorage.setItem(LS, name); } catch {}
  whoName.textContent = name ? `Hi, ${name}` : '';
  changeBtn.hidden = !name;
}
setName(name);
changeBtn.addEventListener('click', () => { const n = prompt('Your name:', name); if (n != null) { setName(n); routeHome(); } });

async function api(path, opts) {
  const r = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

async function routeHome() {
  app.innerHTML = '';
  if (!name) {
    const input = el('input', { class: 'field', placeholder: 'Type your name to start', maxlength: 40 });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) { setName(input.value); routeHome(); } });
    app.append(el('div', { class: 'card center-card' },
      el('h1', {}, '✨ Argon'),
      el('div', { class: 'sub', text: 'Practice the worksheets your teacher set. Cards you miss come back until you get them right.' }),
      input,
      el('div', { style: 'margin-top:12px' },
        el('button', { class: 'btn', onclick: () => { if (input.value.trim()) { setName(input.value); routeHome(); } } }, 'Start'))));
    input.focus();
    return;
  }

  app.append(el('h1', {}, 'Choose a deck'));
  const grid = el('div', { class: 'grid' });
  app.append(grid, el('div', { class: 'muted', id: 'loadmsg', text: 'Loading…' }));
  try {
    const decks = await api('/api/decks');
    document.getElementById('loadmsg').remove();
    if (!decks.length) { grid.replaceWith(el('div', { class: 'muted', text: 'No decks published yet. Check back later.' })); return; }
    for (const d of decks) {
      grid.append(el('div', { class: 'tile', onclick: () => openDeck(d) },
        el('h3', { text: d.name }),
        el('div', { class: 'meta', text: `${d.subject ? d.subject + ' · ' : ''}${d.cardCount} cards` }),
        el('div', { class: 'meta', text: `by ${d.teacher}${d.needsCode ? ' · class code needed' : ''}` })));
    }
  } catch (e) {
    document.getElementById('loadmsg').textContent = 'Could not load decks: ' + e.message;
  }
}

async function openDeck(summary) {
  let code = '';
  if (summary.needsCode) {
    code = prompt(`"${summary.name}" needs a class code:`) || '';
    if (!code) return;
  }
  let deck;
  try {
    deck = await api('/api/decks/' + summary.id, { method: 'POST', body: JSON.stringify({ code }) });
  } catch (e) {
    return toast(e.message);
  }
  if (!deck.cards.length) return toast('That deck has no cards yet.');
  startStudy(deck);
}

function startStudy(deck) {
  app.innerHTML = '';
  const holder = el('div', { class: 'study-wrap' });
  app.append(holder);
  runStudy(holder, deck, {
    onQuit: routeHome,
    onFinish: (summary) => {
      api('/api/progress', {
        method: 'POST',
        body: JSON.stringify({ student: name, deckId: deck.id, run: {
          deckName: deck.name, total: summary.total, retried: summary.retried,
          seconds: summary.seconds, perfect: summary.perfect,
        } }),
      }).catch(() => {});
    },
  });
}

routeHome();
