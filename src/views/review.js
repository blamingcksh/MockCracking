import { h, clear } from '../lib/dom.js';
import { dateTime } from '../lib/format.js';
import { getAll } from '../db.js';
import { getAttempt } from '../data/attempts.js';
import { renderAttemptBody } from './results.js';
import { navigate } from '../router.js';

export default async function reviewView(host, params) {
  const attempt = await getAttempt(params.attemptId);
  if (!attempt) { host.appendChild(h('div', { className: 'empty', textContent: 'Attempt not found.' })); return; }
  if (attempt.status !== 'submitted') { navigate(`/exam/${attempt.id}`); return; }

  host.appendChild(h('h1', { textContent: `Review — ${attempt.name}` }));
  host.appendChild(h('p', { className: 'sub', textContent: dateTime(attempt.submittedAt) }));

  const filterRow = h('div', { className: 'row', style: { marginBottom: '12px' } });
  const container = h('div');
  host.appendChild(filterRow);
  host.appendChild(container);

  const answers = attempt.scoresByQuestion || {};
  const counts = {
    all: Object.keys(answers).length,
    wrong: Object.values(answers).filter(r => r.marks < r.max).length,
    partial: Object.values(answers).filter(r => r.marks > 0 && r.marks < r.max).length,
    blank: Object.values(answers).filter(r => !r.answered).length,
  };

  let chapterFilter = '';
  for (const key of ['all', 'wrong', 'partial', 'blank']) {
    filterRow.appendChild(h('button', {
      className: 'ghost', textContent: `${key} (${counts[key]})`,
      onClick: () => show(key),
    }));
  }

  async function show(filter) {
    clear(filterRow);
    for (const key of ['all', 'wrong', 'partial', 'blank']) {
      filterRow.appendChild(h('button', {
        className: filter === key ? '' : 'ghost',
        textContent: `${key} (${counts[key]})`,
        onClick: () => show(key),
      }));
    }

    const questions = await getAll('questions');
    const byId = new Map(questions.map(q => [q.id, q]));
    const chapters = [...new Set(Object.keys(answers).map(id => byId.get(id)).filter(Boolean).map(q => q.chapter))].sort();
    const sel = h('select', null, h('option', { value: '', textContent: 'All chapters' }),
      ...chapters.map(c => h('option', { value: c, textContent: c })));
    sel.value = chapterFilter;
    sel.addEventListener('change', () => { chapterFilter = sel.value; show(filter); });
    filterRow.appendChild(sel);

    clear(container);
    const scoped = chapterFilter
      ? { ...attempt, scoresByQuestion: Object.fromEntries(Object.entries(answers).filter(([id]) => (byId.get(id) || {}).chapter === chapterFilter)) }
      : attempt;
    await renderAttemptBody(container, scoped, { filter });
  }

  await show('wrong');
}