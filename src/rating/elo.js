import { getAll, getProfile, saveProfile, putMany } from '../db.js';
import { scoreFraction } from '../format/marks.js';
import { difficultyFromPValue } from '../lib/format.js';

export const DEFAULT_ABILITY = 1200;
export const K_ABILITY = 24;
export const K_QUESTION = 12;
export const PVALUE_LAMBDA = 0.15;
export const PVALUE_MATURE = 3;      // attempts before an EWMA replaces the running mean
export const PVALUE_SHOW = 8;        // attempts before empirical difficulty is shown

export function expectedScore(ability, qElo) {
  return 1 / (1 + 10 ** ((qElo - ability) / 400));
}

function clampRating(n) {
  return Math.max(700, Math.min(2700, n));
}

// chapterWeight is how much the topic matters for rank (0.05-1.5). It scales
// the learning rate so a miss in Rotational Motion moves the rating much
// harder than a miss in a peripheral topic.
export function updateAbility(ability, qElo, actual, weight = 1) {
  const k = K_ABILITY * weight;
  return clampRating(ability + k * (actual - expectedScore(ability, qElo)));
}

export function updateQuestionRating(qElo, ability, actual) {
  return Math.round(clampRating(qElo + K_QUESTION * (actual - expectedScore(ability, qElo))));
}

// Band label derived from the formula, so it can never drift from the engine.
export function bandFor(qElo, ability = DEFAULT_ABILITY) {
  const p = expectedScore(ability, qElo);
  if (p >= 0.40) return 'T1_FOUNDATION';
  if (p >= 0.28) return 'T2_CORE_MAINS';
  if (p >= 0.17) return 'T3_STD_MAINS';
  if (p >= 0.08) return 'T4_ADV_EASY';
  if (p >= 0.03) return 'T5_PAPER_ADV';
  if (p >= 0.008) return 'T6_ELITE';
  return 'T7_OLYMP';
}

// entries: [{ question, spec, score, chapter, chapterWeight }]
export async function applyAttemptToRatings(entries) {
  const profile = await getProfile();
  const abilityBefore = profile.ability;
  let ability = profile.ability;

  const ratings = new Map();
  for (const entry of entries) {
    const actual = scoreFraction(entry.score, entry.spec);
    const weight = Number.isFinite(entry.chapterWeight) ? entry.chapterWeight : 1;
    const abilityAtQuestion = ability;
    ability = updateAbility(ability, entry.question.qElo, actual, weight);
    const prior = profile.chapterAbility[entry.chapter];
    profile.chapterAbility[entry.chapter] = updateAbility(
      prior === undefined ? profile.ability : prior,
      entry.question.qElo,
      actual,
      weight,
    );
    ratings.set(entry.question.id, { actual, abilityAtQuestion });
  }

  profile.ability = ability;
  profile.totalAttempts = (profile.totalAttempts || 0) + 1;
  profile.updatedAt = Date.now();
  await saveProfile(profile);

  const updates = entries.map(({ question }) => {
    const q = { ...question };
    const { actual, abilityAtQuestion } = ratings.get(q.id);
    q.qElo = updateQuestionRating(q.qElo, abilityAtQuestion, actual);
    q.seenCount = (q.seenCount || 0) + 1;
    if (actual > 0) q.correctCount = (q.correctCount || 0) + 1;
    if (q.seenCount === 1) q.pValue = actual;
    else if (q.seenCount < PVALUE_MATURE) q.pValue = (q.pValue * q.seenCount + actual) / (q.seenCount + 1);
    else q.pValue = q.pValue * (1 - PVALUE_LAMBDA) + actual * PVALUE_LAMBDA;
    return q;
  });

  await putMany('questions', updates);
  return { profile, updates, abilityBefore, abilityAfter: ability };
}

export function empiricalDifficulty(question) {
  if (!question || (question.seenCount || 0) < PVALUE_SHOW || question.pValue === null) return null;
  return difficultyFromPValue(question.pValue);
}

export async function chapterTable() {
  const [profile, questions, attempts] = await Promise.all([
    getProfile(), getAll('questions'), getAll('attempts'),
  ]);
  const stats = new Map();
  for (const q of questions) {
    if (q.status === 'archived') continue;
    if (!stats.has(q.chapter)) {
      stats.set(q.chapter, {
        chapter: q.chapter, subject: q.subject, unit: q.unit, bank: 0,
        attempts: 0, correct: 0, marksEarned: 0, marksPossible: 0,
        seconds: 0, targetSeconds: 0,
        ability: profile.chapterAbility[q.chapter],
      });
    }
    stats.get(q.chapter).bank += 1;
  }
  for (const a of attempts) {
    if (a.status !== 'submitted' || !a.scoresByQuestion) continue;
    for (const [qid, res] of Object.entries(a.scoresByQuestion)) {
      const q = questions.find(x => x.id === qid);
      const row = q && stats.get(q.chapter);
      if (!row) continue;
      row.attempts += 1;
      if (res.marks > 0) row.correct += 1;
      row.marksEarned += res.marks;
      row.marksPossible += res.max || 0;
      row.seconds += res.seconds || 0;
      row.targetSeconds += (q.targetTimeMins || 0) * 60;
    }
  }
  return [...stats.values()].sort((a, b) => (a.ability ?? 9999) - (b.ability ?? 9999));
}