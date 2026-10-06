import { get, getAll, put } from '../db.js';
import { scoreQuestion, scorePaper, isAnswered } from '../format/marks.js';
import { applyAttemptToRatings } from '../rating/elo.js';

export async function createAttempt(test, spec, customDeadline = null) {
  const now = Date.now();
  // The blueprint is snapshotted onto the attempt so a later edit to the
  // paper or to the format cannot retroactively change how this was scored.
  const slotSpecs = spec.slots.map(s => ({ ...s, paperNumber: spec.paperNumber || test.paperNumber }));
  const deadline = customDeadline || (now + spec.durationMins * 60000);
  const attempt = {
    id: `a-${now.toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    testId: test.id,
    paperId: test.id,
    name: test.name,
    formatId: test.formatId || 'custom',
    paperNumber: test.paperNumber || 1,
    durationMins: spec.durationMins,
    startedAt: now,
    deadline,
    submittedAt: null,
    durationSec: null,
    slots: test.slots,
    slotSpecs,
    responses: {},
    touched: {},
    marksByQuestion: {},
    scoresByQuestion: {},
    perSlot: {},
    totalScore: null,
    maxScore: slotSpecs.reduce((n, s) => n + s.count * s.marks, 0),
    abilityBefore: null,
    abilityAfter: null,
    status: 'in_progress',
  };
  await put('attempts', attempt);
  return attempt;
}

export function getAttempt(id) { return get('attempts', id); }

export async function listAttempts() {
  return (await getAll('attempts')).sort((a, b) => b.startedAt - a.startedAt);
}

export function specFor(attempt, key) {
  return (attempt.slotSpecs || []).find(s => s.key === key) || null;
}

export function questionOrder(attempt) {
  return (attempt.slots || []).flatMap(s => s.questionIds);
}

export async function saveResponse(attempt, questionId, value, marked) {
  attempt.responses[questionId] = { value, marked: !!marked };
  const now = Date.now();
  const prev = attempt.touched[questionId];
  attempt.touched[questionId] = { first: prev ? prev.first : now, last: now };
  await put('attempts', attempt);
  return attempt;
}

export function secondsOn(attempt, questionId) {
  const t = attempt.touched && attempt.touched[questionId];
  return t ? Math.max(0, Math.round((t.last - t.first) / 1000)) : 0;
}

export async function submitAttempt(attempt, questionsById) {
  const now = Date.now();
  const slotSpecs = attempt.slotSpecs || [];
  const bySlot = new Map((attempt.slots || []).map(s => [s.key, s.questionIds]));

  const { perSlot, total, max } = scorePaper(questionsById, slotSpecs, attempt.responses, bySlot);

  attempt.marksByQuestion = {};
  attempt.scoresByQuestion = {};

  for (const spec of slotSpecs) {
    for (const qid of bySlot.get(spec.key) || []) {
      const q = questionsById.get(qid);
      if (!q) continue;
      const marks = scoreQuestion(q, attempt.responses[qid], spec);
      attempt.marksByQuestion[qid] = marks;
      attempt.scoresByQuestion[qid] = {
        marks,
        max: spec.marks,
        seconds: secondsOn(attempt, qid),
        answered: isAnswered(attempt.responses[qid]),
      };
    }
  }

  attempt.perSlot = {};
  for (const [key, value] of Object.entries(perSlot)) {
    attempt.perSlot[key] = { score: value.score, max: value.max };
  }

  attempt.totalScore = total;
  attempt.maxScore = max;
  attempt.submittedAt = now;
  attempt.durationSec = Math.round((now - attempt.startedAt) / 1000);
  attempt.status = 'submitted';

  // Persist the scored paper FIRST. Rating updates are secondary: if they fail
  // the result must still stand, otherwise the student silently loses a paper
  // they sat.
  await put('attempts', attempt);

  const entries = [];
  for (const spec of slotSpecs) {
    for (const qid of bySlot.get(spec.key) || []) {
      const q = questionsById.get(qid);
      if (!q) continue;
      entries.push({
        question: q, spec, score: attempt.marksByQuestion[qid],
        chapter: q.chapter, chapterWeight: q.chapterWeight,
      });
    }
  }

  try {
    const rating = await applyAttemptToRatings(entries);
    attempt.abilityBefore = rating.abilityBefore;
    attempt.abilityAfter = rating.abilityAfter;
    await put('attempts', attempt);
  } catch (err) {
    console.error('rating update failed', err);
    attempt.ratingError = err.message;
    await put('attempts', attempt);
  }
  return attempt;
}

export async function deleteAttempt(id) {
  const { remove } = await import('../db.js');
  await remove('attempts', id);
}