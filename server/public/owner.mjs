import { el, toast } from '/shared/util.js';

const app = document.getElementById('app');
const logoutBtn = document.getElementById('logoutBtn');

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
logoutBtn.addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); location.reload(); });

function loginView() {
  logoutBtn.hidden = true;
  app.innerHTML = '';
  const k = el('input', { class: 'field', type: 'password', placeholder: 'Master key', autocomplete: 'current-password' });
  const err = el('div', { class: 'err' });
  const go = async () => {
    err.textContent = '';
    try { await api('/api/owner/login', { method: 'POST', body: JSON.stringify({ key: k.value }) }); boot(); }
    catch (e) { err.textContent = e.message; }
  };
  k.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  app.append(el('div', { class: 'card center-card' },
    el('h1', {}, 'Owner sign in'),
    el('div', { class: 'sub', text: 'The master key is in your server config. It lets you create teacher accounts.' }),
    k,
    el('div', { style: 'margin-top:12px' }, el('button', { class: 'btn', onclick: go }, 'Sign in')),
    err));
  k.focus();
}

async function ownerView() {
  logoutBtn.hidden = false;
  app.innerHTML = '';
  app.append(el('h1', {}, 'Teacher accounts'));

  // create form
  const u = el('input', { class: 'field', placeholder: 'username' });
  const n = el('input', { class: 'field', placeholder: 'display name (shown to students)' });
  const p = el('input', { class: 'field', type: 'text', placeholder: 'temporary password' });
  app.append(el('div', { class: 'card' },
    el('div', { class: 'lbl', text: 'Create a teacher' }),
    el('div', { class: 'stack' }, u, n, p),
    el('div', { style: 'margin-top:12px' },
      el('button', { class: 'btn', onclick: async () => {
        try {
          await api('/api/owner/teachers', { method: 'POST', body: JSON.stringify({ username: u.value, name: n.value, password: p.value }) });
          u.value = n.value = p.value = '';
          toast('Teacher created.'); ownerView();
        } catch (e) { toast(e.message); }
      } }, 'Create teacher'))));

  const list = el('div', { class: 'stack' });
  app.append(list);
  let teachers;
  try { teachers = await api('/api/owner/teachers'); } catch (e) { list.append(el('div', { class: 'err', text: e.message })); return; }
  if (!teachers.length) list.append(el('div', { class: 'muted', text: 'No teachers yet.' }));
  for (const t of teachers) {
    list.append(el('div', { class: 'card' },
      el('div', { class: 'row', style: 'justify-content:space-between' },
        el('div', {}, el('h3', { style: 'margin:0', text: `${t.name} ` }, el('span', { class: 'muted', style: 'font-weight:400', text: `@${t.username}` })),
          el('div', { class: 'meta muted', text: `${t.deckCount} decks${t.disabled ? ' · DISABLED' : ''}` })),
        el('span', { class: 'pill ' + (t.disabled ? 'off' : 'on'), text: t.disabled ? 'disabled' : 'active' })),
      el('div', { class: 'row', style: 'margin-top:12px' },
        el('button', { class: 'btn small ghost', onclick: () => resetPw(t) }, 'Reset password'),
        el('button', { class: 'btn small ghost', onclick: () => setDisabled(t, !t.disabled) }, t.disabled ? 'Enable' : 'Disable'),
        el('button', { class: 'btn small danger', onclick: () => removeTeacher(t) }, 'Delete'))));
  }

  // all decks
  app.append(el('h2', {}, 'All decks'));
  let decks;
  try { decks = await api('/api/owner/decks'); } catch { decks = []; }
  if (!decks.length) { app.append(el('div', { class: 'muted', text: 'None yet.' })); return; }
  const tbl = el('table', { class: 'rows' });
  tbl.append(el('tr', {}, el('th', { text: 'Deck' }), el('th', { text: 'Teacher' }), el('th', { text: 'Cards' }), el('th', { text: 'Status' })));
  for (const d of decks) {
    tbl.append(el('tr', {}, el('td', { text: d.name }), el('td', { text: d.teacher }), el('td', { text: String(d.cardCount) }),
      el('td', { text: d.published ? 'published' : 'draft' })));
  }
  app.append(tbl);
}

async function resetPw(t) {
  const pw = prompt(`New password for ${t.username}:`);
  if (!pw) return;
  try { await api('/api/owner/teachers/' + t.id, { method: 'POST', body: JSON.stringify({ password: pw }) }); toast('Password reset.'); }
  catch (e) { toast(e.message); }
}
async function setDisabled(t, disabled) {
  try { await api('/api/owner/teachers/' + t.id, { method: 'POST', body: JSON.stringify({ disabled }) }); ownerView(); }
  catch (e) { toast(e.message); }
}
async function removeTeacher(t) {
  if (!confirm(`Delete ${t.username}? Their decks are unpublished but kept.`)) return;
  try { await api('/api/owner/teachers/' + t.id, { method: 'DELETE' }); ownerView(); } catch (e) { toast(e.message); }
}

async function boot() {
  let me;
  try { me = await api('/api/me'); } catch { me = { role: null }; }
  if (me.role === 'owner') return ownerView();
  loginView();
}
boot();
