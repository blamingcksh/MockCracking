import { h, clear, openModal, confirmModal } from '../lib/dom.js';
import { FORMATS, getPaper, subjectOrder } from '../format/blues.js';
import { TYPE_LABEL, SUBJECT_LABEL, dateTime } from '../lib/format.js';
import { getAll } from '../db.js';
import {
  newPaper, savePaper, deletePaper, listPapers, getPaperById,
  autoAssemble, paperTotals,
} from '../data/papers.js';
import { navigate, resolve } from '../router.js';

export default async function builderView(host, params) {
  if (params.paperId) return editPaper(host, params.paperId);
  return listView(host);
}

async function listView(host) {
  host.appendChild(h('h1', { textContent: 'Papers' }));

  const nameInput = h('input', { placeholder: 'Paper name, e.g. "Advanced 2026 P1 Mock 1"' });
  const formatSel = h('select', null, ...Object.values(FORMATS).map(f => h('option', { value: f.id, textContent: f.label })));
  const paperSel = h('select');
  const autoBtn = h('button', { textContent: 'Auto-assemble from bank' });
  const blankBtn = h('button', { className: 'ghost', textContent: 'Start empty' });

  function syncPapers() {
    const fmt = FORMATS[formatSel.value];
    clear(paperSel);
    for (const p of fmt.papers) {
      paperSel.appendChild(h('option', {
        value: String(p.number),
        textContent: `${p.label} — ${p.questionCount} questions, ${p.maxMarks} marks`,
      }));
    }
  }
  formatSel.addEventListener('change', syncPapers);
  syncPapers();

  async function create(mode) {
    const fmt = FORMATS[formatSel.value];
    const paper = getPaper(fmt.id, paperSel.value);
    const paperId = newPaper(fmt.id, paper.number, nameInput.value.trim() || `${fmt.label} ${paper.label}`);
    paperId.slots = [];
    if (mode === 'auto') {
      const questions = await getAll('questions');
      paperId.slots = [...autoAssemble(paper.slots, questions).entries()]
        .map(([key, ids]) => ({ key, questionIds: ids }));
    }
    await savePaper(paperId);
    navigate(`/build/${paperId.id}`);
  }

  autoBtn.addEventListener('click', () => create('auto'));
  blankBtn.addEventListener('click', () => create('blank'));

  host.appendChild(h('div', { className: 'card' },
    h('h2', { textContent: 'New paper' }),
    h('div', { className: 'row' },
      h('label', { className: 'field', style: { margin: 0 } }, h('span', { textContent: 'Name' }), nameInput),
      h('label', { className: 'field', style: { margin: 0 } }, h('span', { textContent: 'Format' }), formatSel),
      h('label', { className: 'field', style: { margin: 0 } }, h('span', { textContent: 'Paper' }), paperSel)),
    h('div', { className: 'row' }, autoBtn, blankBtn,
      h('span', { className: 'muted', textContent: 'Auto-assemble fills every section from the bank, easiest first, preferring Gemini’s paper/section hints.' }))));

  const papers = await listPapers();
  if (!papers.length) {
    host.appendChild(h('div', { className: 'empty', textContent: 'No papers yet.' }));
    return;
  }
  const body = h('tbody');
  for (const p of papers) {
    const fmt = FORMATS[p.formatId];
    body.appendChild(h('tr', null,
      h('td', { textContent: p.name }),
      h('td', { textContent: fmt ? fmt.label : p.formatId }),
      h('td', { textContent: `Paper ${p.paperNumber}` }),
      h('td', { className: 'num', textContent: String((p.slots || []).reduce((n, s) => n + s.questionIds.length, 0)) }),
      h('td', { textContent: dateTime(p.createdAt) }),
      h('td', null, h('div', { className: 'row' },
        h('button', { className: 'ghost', textContent: 'Edit', onClick: () => navigate(`/build/${p.id}`) }),
        h('button', { className: 'danger', textContent: 'Delete', onClick: () => confirmModal('Delete paper', `Delete "${p.name}"?`, async () => { await deletePaper(p.id); resolve(); }) })))));
  }
  host.appendChild(h('div', { className: 'card scroll' },
    h('table', null,
      h('thead', null, h('tr', null, h('th', { textContent: 'name' }), h('th', { textContent: 'format' }), h('th', { textContent: 'paper' }), h('th', { className: 'num', textContent: 'questions' }), h('th', { textContent: 'created' }), h('th', null))),
      body)));
}

async function editPaper(host, paperId) {
  const paper = await getPaperById(paperId);
  if (!paper) { host.appendChild(h('div', { className: 'empty', textContent: 'Paper not found.' })); return; }

  const fmt = FORMATS[paper.formatId];
  const spec = getPaper(paper.formatId, paper.paperNumber);
  const questions = await getAll('questions');
  const byId = new Map(questions.map(q => [q.id, q]));

  const assignment = new Map((paper.slots || []).map(s => [s.key, s.questionIds.slice()]));
  for (const slot of spec.slots) if (!assignment.has(slot.key)) assignment.set(slot.key, []);

  const summary = h('div');
  const listHost = h('div');

  const startButton = h('button', {
    textContent: 'Save & start exam',
    onClick: async () => {
      if (!paperTotals(spec.slots, assignment).complete) { render(); return; }
      const slots = [...assignment.entries()].map(([key, questionIds]) => ({ key, questionIds }));
      const saved = { ...paper, slots };
      await savePaper(saved);
      const { createAttempt } = await import('../data/attempts.js');
      const attempt = await createAttempt(saved, spec);
      navigate(`/exam/${attempt.id}`);
    },
  });

  host.appendChild(h('h1', { textContent: paper.name }));
  host.appendChild(h('p', { className: 'sub', textContent: `${fmt.label} · ${spec.label}` }));
  host.appendChild(h('div', { className: 'row', style: { marginBottom: '14px' } },
    h('button', {
      className: 'ghost', textContent: 'Re-run auto-assemble',
      onClick: async () => {
        for (const s of spec.slots) assignment.set(s.key, []);
        for (const [k, v] of autoAssemble(spec.slots, questions)) assignment.set(k, v);
        render();
      },
    }),
    startButton,
    h('button', { className: 'ghost', textContent: 'Back to list', onClick: () => navigate('/build') })));
  host.appendChild(summary);
  host.appendChild(listHost);

  render();


  function render() {
    clear(summary); clear(listHost);

    const totals = paperTotals(spec.slots, assignment);
    startButton.disabled = !totals.complete;
    summary.appendChild(h('div', { className: 'banner ' + (totals.complete ? 'ok' : 'err') },
      h('strong', { textContent: `${totals.filled}/${totals.count} questions` }),
      h('span', { textContent: ` · ${totals.max} marks available · ${totals.complete ? 'ready to start' : 'short slots are marked below'}` })));

    const grouped = subjectOrder(spec);
    for (const subject of grouped) {
      listHost.appendChild(h('h2', { textContent: SUBJECT_LABEL[subject] }));
      for (const slot of spec.slots.filter(s => s.subject === subject)) {
        const ids = assignment.get(slot.key) || [];
        const short = ids.length !== slot.count;
        const card = h('div', { className: `slot-card${short ? ' short' : ''}` },
          h('div', { className: 'slot-head' },
            h('strong', { textContent: `${slot.label} · ${TYPE_LABEL[slot.type]}` }),
            h('span', { className: 'muted', textContent: `${ids.length}/${slot.count} · +${slot.marks}/wrong ${slot.negative}` })),
          ...ids.map((qid, i) => {
            const q = byId.get(qid);
            return h('div', { className: 'slot-q' },
              h('span', { className: 'muted', textContent: `Q${i + 1}` }),
              h('span', { textContent: q ? truncate(q.stem, 70) : `${qid} (missing from bank)` }),
              h('span', { className: 'muted', textContent: q ? `${q.chapter} · ${q.qElo}` : '' }),
              h('button', {
                className: 'ghost', textContent: '✕',
                onClick: () => { ids.splice(i, 1); render(); },
              }));
          }),
          h('div', { className: 'row', style: { marginTop: '8px' } },
            h('button', { className: 'ghost', textContent: 'Refill slot…', onClick: () => pick(slot.key, 'fill') }),
            h('button', { className: 'ghost', textContent: 'Add one', onClick: () => pick(slot.key, 'add') })));
        listHost.appendChild(card);
      }
    }

    function pick(key, mode) {
      const slot = spec.slots.find(s => s.key === key);
      const target = assignment.get(key) || [];
      // Questions placed in OTHER slots are off-limits, so one question is
      // never used twice in a paper. This slot's own questions stay available
      // so a refill can put them back.
      const used = new Set();
      for (const [k, ids] of assignment) {
        if (k !== key) for (const id of ids) used.add(id);
      }
      const candidates = questions
        .filter(q => q.type === slot.type && q.status === 'active' && !used.has(q.id))
        .sort((a, b) => a.qElo - b.qElo);

      const list = h('div', { className: 'scroll' });
      for (const q of candidates.slice(0, 200)) {
        list.appendChild(h('div', { className: 'slot-q' },
          h('div', { textContent: truncate(q.stem, 90) }),
          h('span', { className: 'muted', textContent: `${q.chapter} · ${q.qElo}` }),
          h('button', {
            className: 'ghost', textContent: 'Use',
            onClick: () => {
              if (mode === 'fill') {
                // Replace the slot and top it up with the next easiest unused
                // questions of the right type.
                target.length = 0;
                target.push(q.id);
                for (const e of candidates) {
                  if (target.length >= slot.count) break;
                  if (e.id !== q.id) target.push(e.id);
                }
              } else if (!target.includes(q.id)) {
                target.push(q.id);
              }
              assignment.set(key, target);
              clear(document.getElementById('modal-root'));
              render();
            },
          })));
      }
      if (!candidates.length) {
        list.appendChild(h('div', { className: 'empty', textContent: `No unused ${TYPE_LABEL[slot.type]} questions in the bank.` }));
      }
      openModal(`Pick ${TYPE_LABEL[slot.type]} — ${SUBJECT_LABEL[slot.subject]} ${slot.label}`, list, []);
    }
  }
}

function truncate(s, n) {
  const text = String(s).replace(/\$[^$]*\$/g, '…');
  return text.length > n ? `${text.slice(0, n)}…` : text;
}
