# Argon

Turn online geometry and algebra worksheets into flashcards that help students
actually learn the material.

Give it a worksheet (PDF or image). Argon reads it, breaks it into individual
problems, and builds a study deck. In study mode a wrong answer goes to the back
of the deck and comes back until you get it right — and at the end you get a
report of every problem with its correct answer.

Everything runs **offline and free**. An optional Claude AI assist can fill in
answers and write hints automatically if you add your own API key.

---

## Running it

```bash
cd argon
npm install
npm start
```

## Building a Windows installer (.exe)

```bash
npm run icon      # regenerates the app icon (only needed if you change build/icon.png)
npm run dist      # outputs dist/Argon Setup <version>.exe
```

---

## How it works

### Importing a worksheet
1. **New from worksheet** → pick a PDF or image (`.pdf .png .jpg .webp .bmp`).
2. Argon reads it:
   - **Digital PDFs** (Cazoom, Kuta, most teacher handouts): the real text is
     extracted directly — column layout and stacked fractions are reconstructed.
     **This is the most accurate option — use the PDF if you have it.**
   - **Scans / photos / screenshots**: built-in OCR (Tesseract, bundled — no
     internet). Multi-column sheets are split into columns and read one at a
     time. Stacked fractions read poorly from images — prefer the PDF, or turn
     on AI assist.
3. The text is split on the problem numbers, each problem is classified (linear
   equation, quadratic, factoring, Pythagorean, area, slope, midpoint, systems,
   angles, …), and answers are filled in from three sources, in order:
   an **answer key** in the file → **Argon's own solver** → **Claude** (if AI is on).
4. You land on a review screen with the original page on the left and the
   editable cards on the right. Each card shows where its answer came from
   ("from answer key" / "solved by Argon"). Fix anything, hit **✨ Solve all
   blank answers** for the rest, then **Save deck**.

### 🔀 "3 readings" — when the question is unclear
If OCR mangles a problem (`7Tx + 3 = 9 - 5x`, a fraction that came out as noise, a
missing `=`), Argon reconstructs what the equation most likely was. It shows **up
to 3 candidate readings**, each solved, labelled "as read" / "adjusted". You
compare them against the worksheet page (shown right there) and click the right
one — it fills in both the question and the answer. During import this panel pops
up automatically for any problem Argon couldn't solve; in the deck editor there's
a **🔀 3 readings** button on every card.

### The built-in math engine
Argon works out answers, exactly and offline:

**Equations** (`src/solve.js`)
- linear equations in one variable — `3(x - 2) = 9`, `(9 + 7x)/3 = -11`, `7x + 3 = 9 - 5x`
- quadratics — `x² - 3x - 10 = 0` (factored roots, or the quadratic formula)
- proportions / rational equations — `6/(7x + 1) = 3/(x - 2)`
- 2×2 linear systems — `4x + 6y = -38`, `x + 7y = -48`

**Properties of exponents** (`src/exponents.js`) — products, quotients and powers
of monomials, with negative and zero exponents, in "positive exponents only" form:
- `(x⁻² · x⁻³)⁴` → `1/x²⁰`
- `(2x²y⁴ · 4x²y⁴ · 3x) / (3x⁻³y²)` → `8x⁸y⁶`
- `(a⁻³b⁻³)⁰` → `1`

Answers come out as exact fractions (`x = -7/2`, not `-3.5`). During study, flip a
card and hit **📝 Show working** for linear steps. It does **not** do word
problems, trig equations, factoring-to-request, or anything past degree 2 — those
need an answer key or AI.

### Self-check against the answer key
`test/verify-key.mjs` reads a Kuta PDF, solves every worksheet problem with the
math engine *from scratch*, then extracts the official answers from the answer-key
pages in the same PDF and compares. On "More Properties of Exponents":

```
$ node test/verify-key.mjs test/fixtures/exponents.pdf
ok  # 1  Argon: 1/x^20       key: (1)/(x^20)
ok  # 5  Argon: 8x^8y^6      key: 8 x^8 y^6
ok  #22  Argon: (h^3j^4k^2)/2  key: (h^3 j^4 k^2)/(2)
22/22 match the answer key
```

### Kuta Software worksheets
Argon reads Kuta PDFs specifically well:
- **superscripts** are detected by font size + position and folded into the
  expression (`x` raised `2` → `x^2`), so `(x²)³ · 2x⁴` isn't scrambled
- **stacked fractions** — the problem number sits between the numerator and
  denominator rows; Argon re-assembles `N) (numerator)/(denominator)`
- the **anti-copy watermark** Kuta stamps down the page is filtered out
- **answer-key pages** (Kuta appends them, repeating the problem numbers) are
  detected and skipped — you get one set of cards, not two

### Studying
- Cards come out in **problem-number order** (1, 2, 3 …), matching the worksheet.
- Cards show the question; click (or press <kbd>Space</kbd>) to flip.
- **Got it wrong** → the card goes to the **back of the deck**.
- **Got it right** / **Easy** → the card is cleared.
- The session ends only when every card has been answered correctly.
- Keyboard: <kbd>Space</kbd> flip · <kbd>1</kbd> wrong · <kbd>2</kbd> right ·
  <kbd>H</kbd> hint.

### Anti-guessing (optional)
Open a deck → **➕ Alternate worksheet** → import a second worksheet that tests
the same skills with different numbers (e.g. a "Version B", or the same Kuta
worksheet regenerated). Argon pairs the problems by number. With anti-guessing on,
**a problem the student misses comes back as the alternate version** — so they
can't just memorise "problem 3 is x = 5". The report shows which version they
finished on.

### 💡 Hint button
Never shows the answer. Offline it gives layered strategy hints based on the
problem type ("The hypotenuse is opposite the right angle… a² + b² = c²…").
With AI assist on, it asks Claude for a Socratic nudge instead.

### 📄 Worksheets with graphs & diagrams
Argon keeps a picture of each source page with the deck. If a problem refers to a
graph or figure, click **📄 Worksheet** during study to pull up the original
page. (Offline OCR reads the problem text; it doesn't interpret the graph
itself — turn on AI assist and Claude will read graphs from the page image when
generating cards.)

### Answer report
After clearing a deck you get a report listing **every problem, its correct
answer, and how many tries it took this session**. Export it as a `.txt` or
print it.

### 🧮 Calculator
<kbd>Ctrl</kbd>+<kbd>K</kbd> anywhere. Scientific functions (`sqrt`, `sin`,
`cos`, `tan`, `log`, `ln`, …), constants (`pi`, `e`), trig in degrees. Shows a
live typeset preview (√, x², π, ×) as you type, and understands those symbols if
you paste them in.

---

## Optional: Claude AI assist

Off by default. **Settings → turn on AI assist → paste an Anthropic API key.**

- Billed separately from Claude Pro — it's a pay-as-you-go API account at
  [console.anthropic.com](https://console.anthropic.com) (add ~$5 of credits).
- Roughly **$0.01–0.04 per worksheet** with Claude Haiku.
- The key is stored only on this computer (`%APPDATA%/Argon/settings.json`).

With it on, each worksheet page is sent to Claude, which returns the problems,
fully worked answers, and hints automatically — you just review and save.

---

## Project layout

| Path | What |
|------|------|
| `main.js` | Electron main process: window, file dialogs, offline OCR worker, AI passthrough |
| `src/index.html` / `styles.css` | Shell + theme |
| `src/app.js` | Views, routing, study session, report |
| `src/ocr.js` | PDF/image → page text (pdf.js + Tesseract); flags Kuta answer-key pages |
| `src/pdftext.js` | Pure layout reconstruction: columns, superscripts, stacked fractions, watermark removal — no deps |
| `src/parser.js` | Text → problems, classifier, offline hints |
| `src/solve.js` | Offline equation solver (linear / quadratic / systems) — pure, no deps |
| `src/exponents.js` | Offline "properties of exponents" simplifier — pure, no deps |
| `src/reconstruct.js` | Guesses garbled questions → 3 candidate readings, each solved |
| `src/mathfmt.js` | KaTeX rendering |
| `src/srs.js` | SM-2 spaced repetition (Library "due" counts) |
| `src/calc.js` | Safe expression evaluator + calculator UI |
| `src/ai.js` | Optional Claude calls |
| `assets/eng.traineddata.gz` | Bundled OCR language data (offline) |
| `build/` | Icon (`icon.png`) + `.ico` generator |
| `test/` | `node test/{solve,exponents,reconstruct}.test.mjs` · `node test/verify-key.mjs <pdf>` (checks the engine against the PDF's own answer key) · `npx electron test/drive.js` (UI) · `npx electron test/ocr.js <pdf>` · `test/readings.js` · `test/peek.js` |

## Data

Decks and settings live in `%APPDATA%/Argon/` (`data.json`, `settings.json`).
Delete that folder to reset. The OCR language cache is `%APPDATA%/Argon/tessdata/`.

## Turning this into a server app (later)

The pieces that would move to a Node server unchanged: `src/parser.js`,
`src/solve.js`, `src/exponents.js`, `src/pdftext.js`, `src/reconstruct.js`,
`src/mathfmt.js`, `src/srs.js` (all pure), and the Tesseract call in `main.js`
(already Node). What changes: `main.js` becomes an Express app
(`POST /upload` → OCR + parse + solve → JSON), the `src/*.js` view layer becomes
a served web page, and `store.js` talks to a database / per-user files instead of
`ipcRenderer`. `pdf.js` and `katex` already run in a browser. Same shape as the
terminal chat-room app; playit.gg would expose it the same way.

## License

Proprietary — all rights reserved. See [LICENSE](LICENSE). Not open source.
Bundled components (Electron, pdf.js, tesseract.js, KaTeX, …) keep their own
permissive licenses.
