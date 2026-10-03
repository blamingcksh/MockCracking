import { h, clear, openModal, confirmModal } from '../lib/dom.js';
import { renderMath } from '../lib/mathrender.js';
import { clock, SUBJECT_LABEL, TYPE_LABEL } from '../lib/format.js';
import { getAll } from '../db.js';
import { getAttempt, saveResponse, submitAttempt, specFor } from '../data/attempts.js';
import { renderFigure } from '../assets/figure.js';
import { navigate, setCleanup } from '../router.js';
import { isAnswered } from '../format/marks.js';

export default async function runnerView(host, params) {
  const attempt = await getAttempt(params.attemptId);
  if (!attempt) { host.appendChild(h('div', { className: 'empty', textContent: 'Attempt not found.' })); return; }

  if (attempt.status === 'submitted') { navigate(`/result/${attempt.id}`); return; }

  const questions = await getAll('questions');
  const byId = new Map(questions.map(q => [q.id, q]));

  const flat = buildFlatList(attempt, byId);
  if (!flat.length) {
    host.appendChild(h('div', { className: 'empty', textContent: 'This paper has no questions assigned.' }));
    return;
  }

  let index = Math.min(flat.length - 1, Math.max(0, firstUnansweredIndex(attempt, flat)));
  let figureHandles = [];
  let ticker = null;
  let submitted = false;

  const bar = h('div', { className: 'exam-bar' });
  const bodyHost = h('div');
  const paletteHost = h('aside', { className: 'card palette' });

  host.appendChild(h('div', { className: 'exam-shell' }, bar, h('div', { className: 'exam-grid' }, bodyHost, paletteHost)));

  draw();

  ticker = setInterval(tick, 1000);
  window.addEventListener('beforeunload', flush);
  setCleanup(flush);

  async function flush() {
    clearInterval(ticker);
    window.removeEventListener('beforeunload', flush);
  }

  function tick() {
    const left = attempt.deadline - Date.now();
    if (left <= 0 && !submitted) { finish(true); return; }
    const clockEl = bar.querySelector('.clock');
    if (clockEl) {
      clockEl.textContent = clock(left / 1000);
      clockEl.classList.toggle('low', left < 5 * 60000);
    }
  }

  function draw() {
    for (const handle of figureHandles) handle.destroy();
    figureHandles = [];

    clear(bar);
    const answered = flat.filter(e => isAnswered(attempt.responses[e.q.id])).length;
    const marked = flat.filter(e => attempt.responses[e.q.id] && attempt.responses[e.q.id].marked).length;
    const left = Math.max(0, attempt.deadline - Date.now());

    bar.appendChild(h('span', { className: 'clock', textContent: clock(left / 1000) }));
    bar.appendChild(h('span', { className: 'muted', textContent: `${answered}/${flat.length} answered · ${marked} marked` }));
    bar.appendChild(h('span', { className: 'grow' }));
    for (const subject of subjectsInOrder()) {
      const btn = h('button', {
        className: flat[index].spec.subject === subject ? 'active' : 'ghost',
        textContent: SUBJECT_LABEL[subject],
        onClick: () => {
          const target = flat.findIndex(e => subjectOf(e) === subject);
          if (target >= 0) { index = target; draw(); }
        },
      });
      bar.appendChild(btn);
    }
    bar.appendChild(h('button', { className: 'danger', textContent: 'Submit paper', onClick: () => confirmSubmit() }));

    clear(bodyHost);
    bodyHost.appendChild(renderQuestion(flat[index]));

    clear(paletteHost);
    paletteHost.appendChild(h('strong', { textContent: 'Question palette' }));
    for (const subject of subjectsInOrder()) {
      const entries = flat.filter(e => subjectOf(e) === subject);
      paletteHost.appendChild(h('div', { className: 'muted', style: { marginTop: '10px' }, textContent: SUBJECT_LABEL[subject] }));
      const grid = h('div', { className: 'palette-grid' });
      for (const e of entries) {
        const res = attempt.responses[e.q.id];
        const isAns = isAnswered(res);
        const classes = ['pal'];
        if (isAns) classes.push('answered');
        if (res && res.marked) classes.push('marked');
        if (e.i === index) classes.push('current');
        grid.appendChild(h('button', {
          className: classes.join(' '),
          textContent: String(e.number),
          onClick: () => { index = e.i; draw(); },
        }));
      }
      paletteHost.appendChild(grid);
    }
    paletteHost.appendChild(h('div', { className: 'legend' },
      h('div', null, h('i', { style: { background: 'var(--good)' } }), 'answered'),
      h('div', null, h('i', { style: { background: 'var(--panel-2)', border: '1px solid var(--mark)' } }), 'marked for review')));
  }

  function subjectsInOrder() {
    return [...new Set(flat.map(subjectOf))];
  }

  function subjectOf(entry) { return entry.spec.subject; }

  function renderQuestion(entry) {
    const { q, spec, number } = entry;
    const wrap = h('div');

    if (spec.type === 'stem_subquestion' && entry.group) {
      wrap.appendChild(h('div', { className: 'stem-block' },
        h('h4', { textContent: `Question Stem for Question Nos. ${entry.groupNumbers[0]} and ${entry.groupNumbers[1]}` }),
        renderMath(h('div'), entry.group.stem)));
    }

    const card = h('div', { className: 'q-card' });
    card.appendChild(h('div', { className: 'q-head' },
      h('span', { className: 'q-num', textContent: `Q.${number}` }),
      h('span', { className: 'muted', textContent: `+${spec.marks} · ${TYPE_LABEL[spec.type]} · ${spec.negative ? `${spec.negative} if wrong` : 'no negative marking'}` })));

    card.appendChild(renderMath(h('div', { className: 'q-stem' }), q.stem));

    if (q.figure) {
      const holder = h('div');
      figureHandles.push(renderFigure(holder, q.figure));
      card.appendChild(holder);
    }

    if (q.type === 'match_list') {
      card.appendChild(renderMatch(q));
    } else if (q.type === 'numerical' || q.type === 'stem_subquestion') {
      card.appendChild(renderKeypad(q));
    } else {
      card.appendChild(renderOptions(q));
      if (q.optionFigures) {
        for (const [letter, fig] of Object.entries(q.optionFigures)) {
          const holder = h('div');
          figureHandles.push(renderFigure(holder, fig));
          card.appendChild(h('div', { className: 'muted', textContent: `Figure for option ${letter}` }));
          card.appendChild(holder);
        }
      }
    }

    const res = attempt.responses[q.id] || { value: null, marked: false };
    card.appendChild(h('div', { className: 'q-actions' },
      h('button', { className: 'ghost', textContent: 'Save & Next', onClick: () => move(1) }),
      h('button', {
        className: res.marked ? '' : 'ghost',
        textContent: res.marked ? 'Marked for review ✓' : 'Mark for Review & Next',
        onClick: async () => {
          await saveResponse(attempt, q.id, res.value, !res.marked);
          move(1);
        },
      }),
      h('button', {
        className: 'ghost', textContent: 'Clear Response',
        onClick: async () => { await saveResponse(attempt, q.id, blankFor(q.type), false); draw(); },
      }),
      h('span', { className: 'grow' }),
      h('button', { className: 'ghost', textContent: '◀ Previous', disabled: index === 0, onClick: () => move(-1) }),
      h('button', { className: 'ghost', textContent: 'Next ▶', disabled: index === flat.length - 1, onClick: () => move(1) })));

    wrap.appendChild(card);
    return wrap;
  }

  function renderOptions(q) {
    const res = attempt.responses[q.id] || { value: [] };
    const chosen = q.type === 'multi_correct' ? (res.value || []) : [res.value].filter(Boolean);
    const box = h('div');
    (q.options || []).forEach((text, i) => {
      const letter = 'ABCD'[i];
      const selected = chosen.includes(letter);
      const el = h('div', {
        className: `opt${selected ? ' sel' : ''}`,
        onClick: async () => {
          let value;
          if (q.type === 'multi_correct') {
            const set = new Set(chosen);
            if (set.has(letter)) set.delete(letter); else set.add(letter);
            value = [...set].sort();
          } else {
            value = letter;
          }
          await saveResponse(attempt, q.id, value, attempt.responses[q.id] ? attempt.responses[q.id].marked : false);
          draw();
        },
      }, h('span', { className: 'opt-key', textContent: letter }), renderMath(h('div'), text));
      box.appendChild(el);
    });
    if (q.type === 'multi_correct') {
      box.appendChild(h('p', { className: 'muted', textContent: `${chosen.length} option(s) selected — choose every option that is correct.` }));
    }
    return box;
  }

  function renderMatch(q) {
    const wrap = h('div');
    const listI = h('table', null, h('thead', null, h('tr', null, h('th', { textContent: 'List-I' }), h('th', { textContent: 'List-II' }))));
    const tb = h('tbody');
    for (let i = 0; i < Math.max(q.listI.length, q.listII.length); i++) {
      const left = q.listI[i] ? h('td', null, renderMath(h('span'), q.listI[i])) : h('td');
      const right = q.listII[i] ? h('td', null, renderMath(h('span'), q.listII[i])) : h('td');
      tb.appendChild(h('tr', null, left, right));
    }
    listI.appendChild(tb);
    wrap.appendChild(h('div', { className: 'match-cols' },
      h('div', null, h('strong', { textContent: 'List-I (P, Q, R, S)' }), listI)));

    const res = attempt.responses[q.id] || { value: null };
    const options = h('div');
    (q.options || []).forEach((text, i) => {
      const letter = 'ABCD'[i];
      options.appendChild(h('div', {
        className: `opt${res.value === letter ? ' sel' : ''}`,
        onClick: async () => {
          await saveResponse(attempt, q.id, letter, attempt.responses[q.id] ? attempt.responses[q.id].marked : false);
          draw();
        },
      }, h('span', { className: 'opt-key', textContent: letter }), renderMath(h('div'), text)));
    });
    wrap.appendChild(options);
    return wrap;
  }

  function renderKeypad(q) {
    const wrap = h('div');
    const res = attempt.responses[q.id] || { value: '' };
    const display = h('div', { className: 'numeric-entry', textContent: String(res.value ?? '') === '' ? '—' : String(res.value) });

    const update = async (text) => {
      await saveResponse(attempt, q.id, text, attempt.responses[q.id] ? attempt.responses[q.id].marked : false);
      draw();
    };

    const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '−'];
    const pad = h('div', { className: 'keypad' });
    for (const k of keys) {
      pad.appendChild(h('button', {
        textContent: k === '−' ? '−' : k,
        onClick: () => {
          const cur = String(attempt.responses[q.id] ? attempt.responses[q.id].value : '');
          if (k === '−') return update(cur.startsWith('-') ? cur.slice(1) : `-${cur}`);
          if (k === '.' && cur.includes('.')) return;
          update((cur === '-' ? '-' : cur) + k);
        },
      }));
    }
    wrap.appendChild(display);
    if (q.unitLabel) wrap.appendChild(h('p', { className: 'muted', textContent: `Answer in ${q.unitLabel}, correct to two decimal places.` }));
    wrap.appendChild(pad);
    return wrap;
  }

  function move(delta) {
    const next = index + delta;
    if (next < 0 || next >= flat.length) return;
    index = next;
    draw();
  }

  function confirmSubmit() {
    const answered = flat.filter(e => isAnswered(attempt.responses[e.q.id])).length;
    const unanswered = flat.length - answered;
    const marked = flat.filter(e => attempt.responses[e.q.id] && attempt.responses[e.q.id].marked).length;
    confirmModal('Submit paper?',
      `You have answered ${answered} of ${flat.length} questions. ${unanswered} unanswered, ${marked} marked for review. Unanswered questions score zero.`,
      () => finish(false), 'Submit');
  }

  async function finish(auto) {
    submitted = true;
    try {
      await submitAttempt(attempt, byId);
    } catch (err) {
      // Never fail silently: a paper that looks unsubmitted is worse than an
      // error the student can see.
      console.error('submit failed', err);
      submitted = false;
      openModal('Could not submit', h('p', { textContent: `Scoring failed: ${err.message}. Your answers are saved — try submitting again.` }),
        [{ label: 'Retry', onClick: () => finish(auto) }]);
      return;
    }
    if (auto) {
      openModal('Time up',
        h('p', { textContent: 'Time expired. Your paper has been scored and submitted automatically.' }),
        [{ label: 'View result', onClick: go }]);
    } else {
      go();
    }
  }

  function go() {
    window.removeEventListener('beforeunload', flush);
    navigate(`/result/${attempt.id}`);
  }
}

// Flatten slots into a display order with 1-based per-subject numbering, and
// resolve shared stems for the stem_subquestion sections.
function buildFlatList(attempt, byId) {
  const out = [];

  // Real papers number continuously within a subject (Physics Q1-Q16 across all
  // four sections), so the counter carries across a subject's sections.
  const counters = new Map();

  for (const slotEntry of attempt.slots || []) {
    const spec = specFor(attempt, slotEntry.key);
    if (!spec) continue;
    const ids = slotEntry.questionIds;
    const numbering = {};
    ids.forEach((qid) => {
      const next = (counters.get(spec.subject) || 0) + 1;
      counters.set(spec.subject, next);
      numbering[qid] = next;
    });

    ids.forEach((qid, i) => {
      const q = byId.get(qid);
      if (!q) return;
      out.push({ q, spec, number: numbering[qid], slotKey: slotEntry.key, i: out.length });
    });
  }

  if (attempt.slotSpecs && attempt.slotSpecs.some(s => s.type === 'stem_subquestion')) {
    const stems = new Map();
    for (const entry of out) {
      if (entry.q.type !== 'stem_subquestion' || !entry.q.groupId) continue;
      const arr = stems.get(entry.q.groupId) || [];
      arr.push(entry);
      stems.set(entry.q.groupId, arr);
    }
    for (const arr of stems.values()) {
      if (arr.length < 2) continue;
      const numbers = arr.map(e => e.number);
      for (const entry of arr) {
        entry.group = arr[0].q;
        entry.groupNumbers = numbers;
      }
    }
  }

  return out;
}

function blankFor(type) {
  if (type === 'multi_correct') return [];
  if (type === 'numerical' || type === 'stem_subquestion') return '';
  return null;
}

function firstUnansweredIndex(attempt, flat) {
  const i = flat.findIndex(e => !isAnswered(attempt.responses[e.q.id]));
  return i < 0 ? 0 : i;
}