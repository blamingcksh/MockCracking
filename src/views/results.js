import { h, clear, openModal } from '../lib/dom.js';
import { renderMath } from '../lib/mathrender.js';
import { SUBJECT_LABEL, TYPE_LABEL, clock, dateTime, pct } from '../lib/format.js';
import { getAll } from '../db.js';
import { getAttempt, specFor, createAttempt } from '../data/attempts.js';
import { getTest } from '../data/tests.js';
import { renderFigure } from '../assets/figure.js';
import { navigate } from '../router.js';
import { describeNumericAnswer } from '../format/numeric.js';

export function answerText(q) {
  if (q.type === 'numerical' || q.type === 'stem_subquestion') return describeNumericAnswer(q.numericalAnswer);
  if (q.type === 'match_list') return q.matchAnswer || '—';
  return (q.correctOptions || []).join(', ') || '—';
}

export async function renderAttemptBody(host, attempt, { filter = 'all', chapterFilter = '' } = {}) {
  const questions = await getAll('questions');
  const byId = new Map(questions.map(q => [q.id, q]));

  // Top action bar
  host.appendChild(h('div', { className: 'row', style: { marginBottom: '14px', alignItems: 'center' } },
    h('button', { className: 'ghost', textContent: '← Tests', onClick: () => navigate('/tests') }),
    h('button', { className: 'ghost', textContent: 'History & analytics', onClick: () => navigate('/history') }),
    h('span', { className: 'grow' }),
    h('button', {
      className: 'active',
      textContent: 'Retake test',
      onClick: async () => {
        const test = await getTest(attempt.testId || attempt.paperId);
        if (!test) {
          alert('Original test definition not found.');
          return;
        }
        promptRetake(test);
      },
    })));

  const score = attempt.totalScore ?? 0;
  const max = attempt.maxScore ?? 0;

  // Hero card
  host.appendChild(h('div', { className: 'card score-hero' },
    h('div', null,
      h('div', { className: 'score-big', textContent: `${score}` }),
      h('div', { className: 'muted', textContent: `out of ${max}` })),
    h('div', null,
      h('div', { textContent: `${pct(score, max)} of the paper` }),
      h('div', { className: 'muted', textContent: `Submitted ${dateTime(attempt.submittedAt)} · took ${hoursMinsOf(attempt.durationSec)}` })),
    attempt.abilityAfter !== null && attempt.abilityAfter !== undefined
      ? h('div', null,
          h('div', { textContent: `Ability ${attempt.abilityAfter.toFixed(0)}` }),
          h('div', { className: 'muted', textContent: `was ${Number(attempt.abilityBefore).toFixed(0)} (Δ ${(attempt.abilityAfter - attempt.abilityBefore).toFixed(0)})` }))
      : null));

  // Subject and section summary table
  const subjects = [...new Set((attempt.slotSpecs || []).map(s => s.subject))];
  const summary = h('table', null,
    h('thead', null, h('tr', null,
      h('th', { textContent: 'Subject' }), h('th', { textContent: 'Section' }),
      h('th', { textContent: 'Type' }), h('th', { className: 'num', textContent: 'marks' }),
      h('th', { className: 'num', textContent: 'max' }), h('th', { className: 'num', textContent: '%' }))),
    h('tbody', null, subjects.flatMap(subject => (attempt.slotSpecs || [])
      .filter(s => s.subject === subject)
      .map(spec => {
        const p = (attempt.perSlot || {})[spec.key] || { score: 0, max: 0 };
        return h('tr', null,
          h('td', { textContent: SUBJECT_LABEL[subject] }),
          h('td', { textContent: spec.label }),
          h('td', { textContent: TYPE_LABEL[spec.type] }),
          h('td', { className: `num marks-cell ${p.score > 0 ? 'pos' : p.score < 0 ? 'neg' : ''}`, textContent: String(p.score) }),
          h('td', { className: 'num', textContent: String(p.max) }),
          h('td', { className: 'num', textContent: pct(p.score, p.max) }));
      }))));
  host.appendChild(h('div', { className: 'card scroll' }, summary));

  // Question detail list with filters
  const answers = attempt.scoresByQuestion || {};
  const counts = {
    all: Object.keys(answers).length,
    wrong: Object.values(answers).filter(r => r.marks < r.max).length,
    partial: Object.values(answers).filter(r => r.marks > 0 && r.marks < r.max).length,
    blank: Object.values(answers).filter(r => !r.answered).length,
  };

  const filterBar = h('div', { className: 'row', style: { margin: '20px 0 12px 0', alignItems: 'center', gap: '8px' } });

  const filterKeys = [
    { key: 'all', label: `All (${counts.all})` },
    { key: 'wrong', label: `Wrong (${counts.wrong})` },
    { key: 'partial', label: `Partial (${counts.partial})` },
    { key: 'blank', label: `Unanswered (${counts.blank})` },
  ];

  for (const item of filterKeys) {
    filterBar.appendChild(h('button', {
      className: filter === item.key ? 'active' : 'ghost',
      textContent: item.label,
      onClick: () => {
        clear(host);
        renderAttemptBody(host, attempt, { filter: item.key, chapterFilter });
      },
    }));
  }

  // Chapter filter dropdown
  const allChapters = [...new Set(Object.keys(answers).map(id => byId.get(id)).filter(Boolean).map(q => q.chapter))].sort();
  if (allChapters.length > 1) {
    const chapSel = h('select', { style: { marginLeft: 'auto' } },
      h('option', { value: '', textContent: 'All chapters' }),
      ...allChapters.map(c => h('option', { value: c, textContent: c })));
    chapSel.value = chapterFilter;
    chapSel.addEventListener('change', () => {
      clear(host);
      renderAttemptBody(host, attempt, { filter, chapterFilter: chapSel.value });
    });
    filterBar.appendChild(chapSel);
  }

  host.appendChild(filterBar);

  const filterFn = {
    all: () => true,
    wrong: r => r.marks < r.max,
    partial: r => r.marks > 0 && r.marks < r.max,
    blank: r => !r.answered,
  }[filter] || (() => true);

  const rows = [];
  for (const slotEntry of attempt.slots || []) {
    const spec = specFor(attempt, slotEntry.key);
    if (!spec) continue;
    slotEntry.questionIds.forEach((qid, i) => {
      const q = byId.get(qid);
      const result = (attempt.scoresByQuestion || {})[qid];
      if (!q || !result) return;
      if (!filterFn(result)) return;
      if (chapterFilter && q.chapter !== chapterFilter) return;
      rows.push({ q, spec, result, number: i + 1 });
    });
  }

  const list = h('div');
  for (const row of rows) {
    list.appendChild(questionCard(row, attempt));
  }
  if (!rows.length) {
    list.appendChild(h('div', { className: 'card empty-box', textContent: 'No questions match the selected filter.' }));
  }
  host.appendChild(list);

  function promptRetake(test) {
    const modalContent = h('div', null,
      h('p', { textContent: `Retaking "${test.name}". Choose how you would like to sit this attempt:` }),
      h('div', { className: 'row', style: { marginTop: '16px', gap: '10px' } },
        h('button', {
          textContent: 'Start now (full duration)',
          onClick: async () => {
            clear(document.getElementById('modal-root'));
            const deadline = Date.now() + (test.durationMins || 180) * 60000;
            const newAttempt = await createAttempt(test, test.spec, deadline);
            navigate(`/exam/${newAttempt.id}`);
          },
        }),
        h('button', {
          className: 'ghost',
          textContent: 'Back to tests',
          onClick: () => {
            clear(document.getElementById('modal-root'));
            navigate('/tests');
          },
        })));

    openModal(`Retake — ${test.name}`, modalContent, [{ label: 'Cancel', ghost: true }]);
  }
}

function questionCard({ q, spec, result, number }, attempt) {
  const card = h('div', { className: 'q-card' });
  const cls = result.marks > 0 ? 'pos' : result.marks < 0 ? 'neg' : '';
  card.appendChild(h('div', { className: 'q-head' },
    h('span', { className: 'q-num', textContent: `Q.${number}` }),
    h('span', { className: 'muted', textContent: `${SUBJECT_LABEL[q.subject]} · ${q.chapter} · ${q.difficulty} · qElo ${q.qElo}` }),
    h('span', { className: 'grow' }),
    h('span', { className: `marks-cell ${cls}`, textContent: `${result.marks} / ${result.max}` }),
    h('span', { className: 'muted', textContent: `${clock(result.seconds)} (target ${Math.round(q.targetTimeMins * 60 / 60)}m)` })));

  card.appendChild(renderMath(h('div', { className: 'q-stem' }), q.stem));
  if (q.figure) { const fig = h('div'); renderFigure(fig, q.figure); card.appendChild(fig); }

  if (q.options) {
    (q.options).forEach((text, i) => {
      const letter = 'ABCD'[i];
      const res = attempt.responses[q.id] || {};
      const chosen = Array.isArray(res.value) ? res.value.includes(letter) : res.value === letter;
      const keys = new Set([(q.correctOptions || []), ...(q.altAnswers || [])].flat());
      const isKey = keys.has(letter) || q.matchAnswer === letter;
      let cls2 = 'opt';
      if (isKey && chosen) cls2 += ' correct';
      else if (chosen && !isKey) cls2 += ' wrong';
      card.appendChild(h('div', { className: cls2 },
        h('span', { className: 'opt-key', textContent: letter }), renderMath(h('div'), text)));
    });
  }

  card.appendChild(h('div', { className: 'banner ' + (result.marks > 0 ? 'ok' : result.marks < 0 ? 'err' : 'err') },
    h('div', null, h('strong', { textContent: 'Correct answer: ' }), answerText(q)),
    h('div', { className: 'muted', textContent: `Your response: ${describeResponse(attempt.responses[q.id])}` })));

  if (q.explanation) {
    const sol = h('div');
    renderMath(sol, q.explanation);
    if (q.solutionFigure) { const solFig = h('div'); renderFigure(solFig, q.solutionFigure); sol.appendChild(solFig); }
    card.appendChild(h('h3', { textContent: 'Solution' }));
    card.appendChild(sol);
  }
  return card;
}

export function describeResponse(res) {
  if (!res || res.value === null || res.value === undefined) return 'not attempted';
  if (Array.isArray(res.value)) return res.value.length ? res.value.join(', ') : 'not attempted';
  if (res.value === '') return 'not attempted';
  return String(res.value);
}

function hoursMinsOf(seconds) {
  if (!seconds) return '—';
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export default async function resultsView(host, params) {
  const attempt = await getAttempt(params.attemptId);
  if (!attempt) { host.appendChild(h('div', { className: 'empty', textContent: 'Attempt not found.' })); return; }
  if (attempt.status !== 'submitted') { navigate(`/exam/${attempt.id}`); return; }

  host.appendChild(h('h1', { textContent: attempt.name }));
  host.appendChild(h('p', { className: 'sub', textContent: dateTime(attempt.submittedAt) }));
  await renderAttemptBody(host, attempt, { filter: 'all' });
}
