# MockCracking

A mock-test studio for JEE. Sit papers that behave like the real exam, then see
exactly where the marks went.

Vanilla JS, no framework, no build step, no server. Everything lives in your
browser's IndexedDB.

---

## Running it

ES modules and IndexedDB both need an origin, so open it over HTTP — double-
clicking `index.html` will not work.

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

Requires Node only if you want to run the checks at the bottom.

---

## What it does

**Three exam formats**, encoded as data in `src/format/blues.js`, transcribed from
the official papers rather than guessed:

| Format | Shape |
|---|---|
| JEE Advanced 2026 | Paper 1 and Paper 2, 180 marks each. P1 = single-correct 4 / multi-correct 4 / numerical 4 / match-list 4. P2 = 4 / 5 / 5 / question-stem 4. |
| JEE Advanced 2025 | Same totals, different split: P1 = 4 / 3 / 6 / 3, P2 = 4 / 4 / 8. Multi-correct is **−2** here, not −1. |
| JEE Main 2026 | Per subject, Section A 20 MCQ + Section B 5 numerical, +4 / −1. |

**The marking engine** (`src/format/marks.js`) reproduces the real scheme
exactly, including the multi-correct partial ladder (+4 / +3 / +2 / +1 / 0 /
negative), 2-decimal numerical comparison, and the range and multi-set answer
keys that show up in official final answer keys (`[3.9 TO 4.1]`, `A or B`).

**The exam runner** is a CBT simulation: virtual keypad, question palette with
answered/marked state, mark-for-review, free navigation between subjects,
per-question timing, auto-save on every tap, and auto-submit at zero.

**Elo** couples your ability rating to each question's rating, so every answer
moves both. Partial credit counts proportionally, and `chapterWeight` scales how
hard a miss in a high-yield topic hurts. Once a question has 8 attempts the app
shows an empirical difficulty alongside Gemini's original judgement.

---

## Adding questions

You do not write questions by hand. Upload a paper PDF to Gemini with
`gemini gem prompt.txt` as the system prompt, paste the returned JSON into
**Ingest**, and the app validates, previews and stores it.

The prompt tells Gemini to assign each question its real type and its real
section, which is what lets the builder auto-assemble a valid paper. It also
covers figure cropping from both screenshots and PDF pages — the app then asks
you to attach the matching files.

Questions can only be reached through this path; validation rejects a
`match_list` without options, a multi-correct with one correct option, an
out-of-range Elo, or a crop box that spills past its page edge.

---

## Layout

```
index.html              app shell
styles/                 design system, exam, dashboard
vendor/                 KaTeX + pdf.js (offline, the only third-party files)
src/
  format/blues.js       exam formats as data — marks live here and nowhere else
  format/marks.js       the single scoring path
  format/numeric.js     2-decimal and range comparison
  data/schema.js        question shape and validation
  data/ingest.js        parse, validate, commit
  data/papers.js        auto-assembly and slot filling
  data/attempts.js      attempt lifecycle and submission
  rating/elo.js         ability and question ratings
  assets/figure.js      crop rendering for screenshots and PDF pages
  views/                dashboard, bank, ingest, builder, runner, results, review
gemini gem prompt.txt    the parser prompt
```

If you want to add a year, add one `format()` call in `blues.js`. Nothing else
needs to change.

---

## Checks

```bash
node marking.test.mjs    # 68 assertions on the marking rules and Elo
node import-check.mjs    # unresolved/unused imports across src/
```

`marking.test.mjs` is the one that matters: a silent bug in scoring produces
plausible-looking wrong numbers rather than an error, so the ladder from the
official paper is pinned down by assertion.

---

## Notes

- Data is per-browser. Clearing site data wipes your question bank and history;
  there is no sync or export.
- The two vendored libraries are local files, so the app works offline.
- Gemini's `difficulty` is treated as a prior, not truth — the app shows the
  empirical difficulty once it has enough attempts on a question to judge.