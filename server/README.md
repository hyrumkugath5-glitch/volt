# Argon — server (teacher tool)

Runs Argon as a website. Three roles:

| Role | URL | How they get in |
|------|-----|-----------------|
| **Owner** (you) | `/owner` | the **master key** in `config.json` |
| **Teacher** | `/admin` | username + password **the owner created** |
| **Student** | `/` | just a name (+ a class code if the teacher set one) |

The owner mints teacher accounts — no one can create content without one. That's
the gate that keeps the software yours.

## Run locally

```bash
cd server
npm install
cp config.example.json config.json     # set "masterKey"
npm start                               # http://localhost:3200
```

First boot hashes your `masterKey` into `config.json` and adds a `sessionSecret`.

## What each role can do

**Owner** (`/owner`)
- create / rename teachers, reset their passwords, disable or delete them
- see every deck across all teachers

**Teacher** (`/admin`)
- **New from worksheet** → upload a PDF or image → Argon reads it, splits it into
  problems, solves the ones it can (linear/quadratic/systems, properties of
  exponents), skips Kuta answer-key pages → review & edit the cards → **Save**
- edit any of your decks; **Preview** runs the study session yourself
- **Publish** a deck to students (optionally behind a class code)
- **Results** — who finished, perfect vs. cleared, retries, time

- **➕ Alternate** — import a second worksheet (same skills, different numbers).
  Argon pairs the problems by number; then, when **anti-guessing** is on, a
  problem a student misses comes back as the alternate version so they can't
  memorise answers.

**Student** (`/`)
- pick a published deck → study: cards in problem-number order, flip, wrong ones
  go to the back, the session ends only when every card is right
- 💡 hint (never the answer) · 📄 original worksheet page · 🧮 calculator
- final answer report; their run is sent back so the teacher sees it

## Data

- `config.json` — owner key, session secret, port/host (gitignored)
- `data/teachers.json`, `data/decks.json`, `data/progress.json` (gitignored)
- `data/sources/` — the original uploaded worksheet files
- `data/.tessdata/` — decompressed OCR language data (rebuilt on demand)

## Shared code

`shared/` is copied verbatim from `../src` by `npm run sync` — the math engine
(`solve`, `exponents`), worksheet reconstruction (`parser`, `pdftext`,
`reconstruct`), rendering (`mathfmt`), spaced repetition (`srs`). The server
imports the DOM-free ones; the browser gets all of them from `/shared/`.
Edit the originals in `../src`, then `npm run sync`.

## Deploy

See [`deploy/README.md`](deploy/README.md) — tarball → `games` server → systemd →
playit.gg, same as the chat app.

```bash
bash make-tarball.sh    # -> argon-server.tgz
```

## Tests

```bash
bash test-flow.sh       # end-to-end API smoke test (server must be running)
```
The math engine's own tests live in `../test/` (`node ../test/verify-key.mjs …`).
