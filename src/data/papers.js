import { getAll, get, put, remove } from '../db.js';

export function newPaper(formatId, paperNumber, name) {
  return {
    id: `p-${formatId}-${paperNumber}-${crypto.randomUUID().slice(0, 8)}`,
    name,
    formatId,
    paperNumber,
    slots: [],
    createdAt: Date.now(),
  };
}

export async function savePaper(paper) {
  await put('papers', paper);
  return paper;
}

export async function deletePaper(id) { await remove('papers', id); }

export async function getPaperById(id) { return get('papers', id); }

export async function listPapers() {
  return (await getAll('papers')).sort((a, b) => b.createdAt - a.createdAt);
}

// Fills every slot from the bank. Prefers questions whose Gemini-assigned
// paper/section matches the slot, then orders by qElo ascending because real
// papers escalate in difficulty across a section.
export function autoAssemble(paperSlots, questions, { useExisting = new Map() } = {}) {
  const pool = questions.filter(q => q.status === 'active');
  const usedIds = new Set();
  const result = new Map();

  for (const spec of paperSlots) {
    const assigned = [];
    for (const qid of (useExisting.get(spec.key) || [])) {
      const q = pool.find(x => x.id === qid);
      if (q && !usedIds.has(qid)) { assigned.push(qid); usedIds.add(qid); }
    }

    const chosen = new Set(assigned);
    const candidates = pool
      .filter(q => q.type === spec.type && !usedIds.has(q.id) && !chosen.has(q.id))
      .map(q => ({
        q,
        hintMatch: (q.paperHint === null || q.paperHint === undefined || Number(q.paperHint) === Number(spec.paperNumber))
          && (q.sectionHint === null || q.sectionHint === undefined || Number(q.sectionHint) === Number(spec.sectionIndex))
          ? 0 : 1,
      }))
      .sort((a, b) => (a.hintMatch - b.hintMatch)
        || (a.q.qElo - b.q.qElo)
        || a.q.id.localeCompare(b.q.id));

    for (const { q } of candidates) {
      if (assigned.length >= spec.count) break;
      assigned.push(q.id);
      usedIds.add(q.id);
    }
    result.set(spec.key, assigned);
  }
  return result;
}

export function slotsComplete(paperSlots, assignment) {
  const short = [];
  for (const spec of paperSlots) {
    const filled = (assignment.get(spec.key) || []).length;
    if (filled !== spec.count) short.push({ spec, filled });
  }
  return { complete: short.length === 0, short };
}

export function paperTotals(paperSlots, assignment) {
  let max = 0;
  let filled = 0;
  for (const spec of paperSlots) {
    max += spec.count * spec.marks;
    filled += (assignment.get(spec.key) || []).length;
  }
  const count = paperSlots.reduce((n, s) => n + s.count, 0);
  return { max, filled, count, complete: filled === count };
}