import { h, clear, openModal } from '../lib/dom.js';
import { renderMath } from '../lib/mathrender.js';
import { SUBJECTS, SUBJECT_LABEL, TYPE_LABEL, DIFFICULTIES } from '../lib/format.js';
import { validateQuestion } from '../data/schema.js';
import { renderFigure } from '../assets/figure.js';
import { bandFor, empiricalDifficulty } from '../rating/elo.js';
import { describeNumericAnswer } from '../format/numeric.js';
import { getAll, put } from '../db.js';

const filters = { subject: '', type: '', difficulty: '', unit: '', unseen: false, q: '' };

export default async function bankView(host) {
  const questions = (await getAll('questions')).filter(q => q.status !== 'archived');
  const listHost = h('div');
  const count = h('p', { className: 'muted' });

  const controls = h('div', { className: 'card row' },
    select('Subject', ['', ...SUBJECTS], v => filters.subject = v, s => s ? SUBJECT_LABEL[s] : 'All'),
    select('Type', ['', 'single_correct', 'multi_correct', 'numerical', 'match_list', 'stem_subquestion'],
      v => filters.type = v, v => v ? TYPE_LABEL[v] : 'All'),
    select('Difficulty', ['', ...DIFFICULTIES], v => filters.difficulty = v, v => v || 'Any'),
    select('Unit', ['', ...[...new Set(questions.map(q => q.unit))].sort()], v => filters.unit = v, v => v || 'All units'),
    h('label', { className: 'check' },
      h('input', { type: 'checkbox', onChange: e => { filters.unseen = e.target.checked; render(); } }),
      'Unseen only'),
    h('input', { placeholder: 'search id, stem, chapter…', onInput: e => { filters.q = e.target.value.toLowerCase(); render(); } }),
  );

  host.appendChild(h('h1', { textContent: 'Question bank' }));
  host.appendChild(controls);
  host.appendChild(count);
  host.appendChild(listHost);
  render();


  function render() {
    clear(listHost);
    const rows = questions.filter(q => {
      if (filters.subject && q.subject !== filters.subject) return false;
      if (filters.type && q.type !== filters.type) return false;
      if (filters.difficulty && q.difficulty !== filters.difficulty) return false;
      if (filters.unit && q.unit !== filters.unit) return false;
      if (filters.unseen && (q.seenCount || 0) > 0) return false;
      if (filters.q) {
        const hay = `${q.id} ${q.stem} ${q.chapter} ${(q.tags || []).join(' ')}`.toLowerCase();
        if (!hay.includes(filters.q)) return false;
      }
      return true;
    }).sort((a, b) => a.qElo - b.qElo);

    count.textContent = `${rows.length} of ${questions.length} questions`;

    if (!rows.length) {
      listHost.appendChild(h('div', { className: 'empty', textContent: 'Nothing matches. Ingest some questions first.' }));
      return;
    }

    const body = h('tbody');
    for (const q of rows) {
      const emp = empiricalDifficulty(q);
      body.appendChild(h('tr', {
        style: { cursor: 'pointer' },
        onClick: () => openDetail(q),
      },
        h('td', { textContent: q.id }),
        h('td', { textContent: SUBJECT_LABEL[q.subject] || q.subject }),
        h('td', { textContent: TYPE_LABEL[q.type] || q.type }),
        h('td', null, h('span', { className: `pill ${q.difficulty}`, textContent: q.difficulty })),
        h('td', { className: 'num', textContent: String(q.qElo) }),
        h('td', { className: 'num', textContent: bandFor(q.qElo) }),
        h('td', { className: 'num', textContent: q.seenCount && q.pValue !== null ? `${(q.pValue * 100).toFixed(0)}%` : '—' }),
        h('td', { textContent: emp ? emp : '—' }),
        h('td', { textContent: q.chapter })));
    }

    listHost.appendChild(h('div', { className: 'card scroll' },
      h('table', null,
        h('thead', null, h('tr', null,
          h('th', { textContent: 'id' }), h('th', { textContent: 'subject' }),
          h('th', { textContent: 'type' }), h('th', { textContent: 'difficulty' }),
          h('th', { className: 'num', textContent: 'qElo' }), h('th', { className: 'num', textContent: 'band' }),
          h('th', { className: 'num', textContent: 'pValue' }), h('th', { textContent: 'empirical' }),
          h('th', { textContent: 'chapter' }))),
        body)));
  }

  function openDetail(q) {
    const figures = [];
    const stemHost = h('div', { className: 'q-stem' });
    renderMath(stemHost, q.stem);
    if (q.figure) {
      const holder = h('div');
      renderFigure(holder, q.figure);
      figures.push(holder);
    }

    const body = h('div', null,
      h('div', { className: 'row', style: { marginBottom: '8px' } },
        h('span', { className: 'tag', textContent: q.unit }),
        h('span', { className: 'tag', textContent: q.chapter }),
        h('span', { className: `pill ${q.difficulty}`, textContent: q.difficulty }),
        h('span', { className: 'tag', textContent: `qElo ${q.qElo}` }),
        h('span', { className: 'tag', textContent: `${bandFor(q.qElo)} · P(win vs 1200) ${(1 / (1 + 10 ** ((q.qElo - 1200) / 400)) * 100).toFixed(1)}%` }),
        h('span', { className: 'tag', textContent: `${q.targetTimeMins} min target` }),
        h('span', { className: 'tag', textContent: `seen ${q.seenCount || 0}` })),
      stemHost,
      ...figures,
      q.options ? h('ol', { style: { paddingLeft: '20px' } }, q.options.map(o => {
        const li = h('li'); renderMath(li, o); return li;
      })) : null,
      q.listI ? h('div', { className: 'match-cols' },
        h('div', null, h('strong', { textContent: 'List-I' }), h('ol', { type: 'A' }, q.listI.map(renderMathNode))),
        h('div', null, h('strong', { textContent: 'List-II' }), h('ol', null, q.listII.map(renderMathNode)))) : null,
      h('div', { className: 'banner ok' },
        h('strong', { textContent: 'Answer: ' }),
        h('span', { textContent: answerText(q) })),
      q.hint ? h('p', null, h('strong', { textContent: 'Hint: ' }), q.hint) : null,
      q.explanation ? h('p', null, h('strong', { textContent: 'Explanation: ' }), q.explanation) : null,
      h('div', { className: 'row' },
        h('button', { textContent: 'Edit', onClick: () => openEditor(q) }),
        h('button', {
          className: 'ghost', textContent: q.status === 'archived' ? 'Restore' : 'Archive',
          onClick: async () => { await put('questions', { ...q, status: q.status === 'archived' ? 'active' : 'archived' }); location.reload(); },
        }),
        h('button', { className: 'ghost', textContent: 'Close', onClick: () => clear(document.getElementById('modal-root')) })));

    openModal(q.id, body, []);
  }

  function openEditor(q) {
    const fields = {
      stem: h('textarea', { textContent: q.stem }),
      options: h('textarea', { textContent: (q.options || []).join('\n') }),
      correctOptions: h('input', { textContent: (q.correctOptions || []).join(',') }),
      numericalAnswer: h('input', { textContent: typeof q.numericalAnswer === 'object' ? '' : String(q.numericalAnswer ?? '') }),
      matchAnswer: h('input', { textContent: q.matchAnswer || '' }),
      explanation: h('textarea', { textContent: q.explanation || '' }),
      hint: h('input', { textContent: q.hint || '' }),
      qElo: h('input', { type: 'number', value: String(q.qElo) }),
      difficulty: select('Difficulty', DIFFICULTIES, () => {}, v => v, q.difficulty),
      tags: h('input', { textContent: (q.tags || []).join(', ') }),
    };

    const status = h('div');
    openModal('Edit question', h('div', null,
      field('Stem', fields.stem),
      field('Options (one per line)', fields.options),
      field('Correct options (comma separated letters)', fields.correctOptions),
      field('Numerical answer (number, or "min,max")', fields.numericalAnswer),
      field('Match answer letter', fields.matchAnswer),
      field('Hint', fields.hint),
      field('Explanation', fields.explanation),
      h('div', { className: 'row' }, field('qElo', fields.qElo), field('Difficulty', fields.difficulty)),
      field('Tags', fields.tags),
      status,
    ), [
      { label: 'Cancel', ghost: true },
      {
        label: 'Save',
        onClick: async () => {
          const draft = {
            ...q,
            stem: fields.stem.value,
            options: fields.options.value.split('\n').map(s => s.trim()).filter(Boolean),
            correctOptions: fields.correctOptions.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
            numericalAnswer: parseNumericField(fields.numericalAnswer.value, q.numericalAnswer),
            matchAnswer: fields.matchAnswer.value.trim().toUpperCase() || null,
            hint: fields.hint.value || null,
            explanation: fields.explanation.value || null,
            qElo: Number(fields.qElo.value),
            difficulty: fields.difficulty.value,
            tags: fields.tags.value.split(',').map(s => s.trim()).filter(Boolean),
          };
          const result = validateQuestion(draft, q);
          if (!result.ok) {
            clear(status);
            status.appendChild(h('div', { className: 'banner err' },
              h('ul', { style: { margin: '4px 0 0 16px' } }, result.errors.map(e => h('li', { textContent: e })))));
            return;
          }
          await put('questions', result.value);
          location.reload();
        },
      },
    ]);
  }
}

function parseNumericField(text, current) {
  const trimmed = text.trim();
  if (!trimmed) return typeof current === 'object' ? current : null;
  if (trimmed.includes(',')) {
    const [lo, hi] = trimmed.split(',').map(s => Number(s.trim()));
    return Number.isFinite(lo) && Number.isFinite(hi) ? { min: lo, max: hi } : current;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : current;
}

export function answerText(q) {
  if (q.type === 'numerical' || q.type === 'stem_subquestion') return describeNumericAnswer(q.numericalAnswer);
  if (q.type === 'match_list') return q.matchAnswer;
  return (q.correctOptions || []).join(', ');
}

function renderMathNode(text) { const d = h('div'); renderMath(d, text); return d; }

function field(label, input) {
  return h('label', { className: 'field' }, h('span', { textContent: label }), input);
}

function select(label, values, onChange, labeler, initial) {
  const sel = h('select', null, ...values.map(v => h('option', { value: v, textContent: labeler(v) })));
  if (initial !== undefined) sel.value = initial;
  sel.addEventListener('change', () => onChange(sel.value));
  return h('label', { className: 'field', style: { margin: 0 } }, h('span', { textContent: label }), sel);
}