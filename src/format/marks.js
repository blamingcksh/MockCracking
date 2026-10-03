import { isCorrectNumeric, normalizeNumber } from './numeric.js';

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every(x => s.has(x));
}

// The acceptable answer keys for a question. match_list is keyed by the single
// correct combination option; every other type by sets of option letters.
function keySets(q) {
  if (q.type === 'match_list') {
    const sets = [];
    if (q.matchAnswer) sets.push([q.matchAnswer]);
    for (const alt of q.altAnswers || []) if (Array.isArray(alt) && alt.length) sets.push(alt);
    return sets.length ? sets : [[]];
  }
  const sets = [q.correctOptions || []];
  for (const alt of q.altAnswers || []) if (Array.isArray(alt) && alt.length) sets.push(alt);
  return sets;
}

// Partial-marking ladder, verbatim from the paper:
//   +4 all correct options chosen
//   +3 all four options correct but only three chosen
//   +2 three or more correct but only two chosen, both correct
//   +1 two or more correct but only one chosen, and it is correct
//    0 unanswered
//   -1 (2026) / -2 (2025) in all other cases
export function scoreMultiCorrect(q, chosen, spec) {
  const picked = (chosen || []).filter(x => x);
  if (picked.length === 0) return 0;

  const keys = keySets(q);
  if (keys.some(k => sameSet(picked, k))) return spec.marks;

  for (const key of keys) {
    const K = new Set(key);
    if (!picked.every(o => K.has(o))) continue;
    if (K.size === 4 && picked.length === 3) return spec.marks - 1;
    if (K.size >= 3 && picked.length === 2) return spec.marks - 2;
    if (K.size >= 2 && picked.length === 1) return spec.marks - 3;
  }
  return -spec.negative;
}

// The single entry point for marks. Every view routes through this.
export function scoreQuestion(q, response, spec) {
  const raw = response && response.value !== undefined ? response.value : response;
  switch (q.type) {
    case 'single_correct': {
      const chosen = Array.isArray(raw) ? raw[0] : raw;
      if (!chosen) return 0;
      return keySets(q).some(k => sameSet([chosen], k)) ? spec.marks : -spec.negative;
    }
    case 'multi_correct':
      return scoreMultiCorrect(q, Array.isArray(raw) ? raw : [], spec);
    case 'match_list': {
      if (!raw) return 0;
      return keySets(q).some(k => sameSet([raw], k)) ? spec.marks : -spec.negative;
    }
    case 'numerical':
    case 'stem_subquestion':
      return isCorrectNumeric(q.numericalAnswer, raw) ? spec.marks : 0;
    default:
      return 0;
  }
}

export function isAnswered(response) {
  const raw = response && response.value !== undefined ? response.value : response;
  if (raw === null || raw === undefined || raw === '') return false;
  if (Array.isArray(raw)) return raw.length > 0;
  return true;
}
// Fraction of the available marks, used as the Elo "actual" score so partial
// credit feeds the rating honestly.
export function scoreFraction(score, spec) {
  if (!spec || !spec.marks) return 0;
  return Math.max(0, Math.min(1, score / spec.marks));
}


// Aggregates marks per section. `idsBySlot` maps a blueprint slot key to the
// ordered question ids assigned to it; `questionsById` resolves those ids.
export function scorePaper(questionsById, slots, responses, idsBySlot) {
  const perSlot = {};
  let total = 0;
  let max = 0;
  for (const spec of slots) {
    const ids = idsBySlot.get(spec.key) || [];
    let slotTotal = 0;
    for (const id of ids) {
      const q = questionsById.get(id);
      if (q) slotTotal += scoreQuestion(q, responses[id], spec);
    }
    perSlot[spec.key] = { score: slotTotal, max: spec.count * spec.marks, count: ids.length };
    total += slotTotal;
    max += spec.count * spec.marks;
  }
  return { perSlot, total, max };
}

export function isBlankNumeric(raw) {
  return normalizeNumber(raw) === null && !String(raw || '').trim();
}