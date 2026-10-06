# MockCracking

A streamlined JEE mock-test studio. Upload question papers, schedule tests, sit them in a real CBT simulation, and review detailed results and attempt history with Elo analytics.

Vanilla JS, no framework, no build step, no server. Everything lives in your browser's IndexedDB.

---

## Running it

ES modules and IndexedDB both need an origin, so open it over HTTP:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

---

## Workflow

1. **Upload & Schedule (`#/new`)**:
   - Paste the JSON returned from Gemini (using `gemini gem prompt.txt`).
   - If a paste contains both Paper 1 and Paper 2, MockCracking automatically separates them into individual tests.
   - Choose whether to schedule the test:
     - **Schedule OFF**: Attempt anytime with full duration.
     - **Schedule ON**: Paper remains locked until the start time. Starting late deducts time from your exam window.
   - Attach any figure screenshots or PDFs if referenced.
2. **Tests Dashboard (`#/tests`)**:
   - View all your scheduled and ready tests.
   - See live countdowns to test start windows.
   - Start or resume tests.
   - Retake tests with a clean attempt.
3. **Exam Runner (`#/exam/:attemptId`)**:
   - Real JEE CBT interface: virtual keypad, question palette, mark for review, subject tabs, auto-save on every tap, and auto-submit at zero.
4. **Results & Review (`#/result/:attemptId`)**:
   - Immediate score hero, subject/section breakdown table.
   - Full question review with filters (`All`, `Wrong`, `Partial`, `Unanswered`, and by Chapter).
   - Instant "Retake test" option.
5. **History & Analytics (`#/history`)**:
   - Complete history table of every test attempt taken.
   - Elo rating progression, score trends, chapter breakdown, accuracy by difficulty, and pace analysis.

---

## Checks

```bash
node marking.test.mjs    # 68 assertions on the marking rules and Elo
node tests.test.mjs      # tests on paper separation, schedule windows, and late deduction
node import-check.mjs    # verifies 0 unresolved/unused imports across src/
```