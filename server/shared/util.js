export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
};

export const fmtDate = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export const daysFromNow = (n) => Date.now() + n * 86400000;

export function toast(msg, ms = 2200) {
  const t = el('div', { class: 'toast', text: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

// In-app modal replacements for window.prompt / window.confirm (Electron blocks
// prompt(), and native dialogs are ugly). Both return a Promise.
function modal(build) {
  return new Promise((resolve) => {
    const back = el('div', { class: 'modal-back' });
    const box = el('div', { class: 'modal-box' });
    back.append(box);
    document.body.append(back);
    const done = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    document.addEventListener('keydown', onKey);
    back.addEventListener('mousedown', (e) => { if (e.target === back) done(null); });
    build(box, done);
  });
}

export function askText(message, initial = '') {
  return modal((box, done) => {
    const input = el('input', { class: 'field', value: initial });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); });
    box.append(
      el('div', { class: 'modal-msg', text: message }),
      input,
      el('div', { class: 'modal-btns' },
        el('button', { class: 'btn ghost', onclick: () => done(null) }, 'Cancel'),
        el('button', { class: 'btn', onclick: () => done(input.value) }, 'OK'))
    );
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}

export function askConfirm(message, okLabel = 'OK') {
  return modal((box, done) => {
    box.append(
      el('div', { class: 'modal-msg', text: message }),
      el('div', { class: 'modal-btns' },
        el('button', { class: 'btn ghost', onclick: () => done(false) }, 'Cancel'),
        el('button', { class: 'btn', onclick: () => done(true) }, okLabel))
    );
    setTimeout(() => box.querySelector('.btn:not(.ghost)').focus(), 0);
  });
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
