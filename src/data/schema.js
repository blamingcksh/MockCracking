export const QUESTION_TYPES = [
  'single_correct', 'multi_correct', 'numerical', 'match_list', 'stem_subquestion',
];

export const SUBJECTS = ['physics', 'chemistry', 'maths'];
export const DIFFICULTIES = ['easy', 'medium', 'hard', 'brutal'];

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

// Fallback +/- scheme when an older upload does not carry printed marks.
// Anything newer must emit explicit `marks`/`negative` (see the Gemini prompt).
export const DEFAULT_SCHEME = {
  single_correct: { marks: 4, negative: 1 },
  multi_correct: { marks: 4, negative: 1 },
  match_list: { marks: 4, negative: 1 },
  numerical: { marks: 4, negative: 0 },
  stem_subquestion: { marks: 2, negative: 0 },
};

export function isRangeAnswer(v) {
  return v !== null && typeof v === 'object'
    && Number.isFinite(v.min) && Number.isFinite(v.max);
}

function isPlainArray(v) {
  return Array.isArray(v);
}

function validateFigure(fig, path, errors, required = false) {
  if (fig === null || fig === undefined) {
    if (required) errors.push(`${path} is required`);
    return;
  }
  if (typeof fig !== 'object') { errors.push(`${path} must be an object`); return; }
  if (fig.source !== 'image' && fig.source !== 'pdf') errors.push(`${path}.source must be "image" or "pdf"`);
  if (typeof fig.asset !== 'string' || !fig.asset) errors.push(`${path}.asset must be a non-empty tag`);
  if (fig.source === 'pdf') {
    if (!Number.isInteger(fig.page) || fig.page < 1) errors.push(`${path}.page must be a 1-indexed integer`);
  }
  const box = fig.box;
  if (!box || typeof box !== 'object') { errors.push(`${path}.box is required`); return; }
  for (const k of ['x', 'y', 'w', 'h']) {
    if (!Number.isFinite(box[k])) errors.push(`${path}.box.${k} must be a finite number`);
  }
  if (Number.isFinite(box.w) && (box.w <= 0 || box.w > 1)) errors.push(`${path}.box.w must be in (0,1]`);
  if (Number.isFinite(box.h) && (box.h <= 0 || box.h > 1)) errors.push(`${path}.box.h must be in (0,1]`);
  if (Number.isFinite(box.x) && (box.x < 0 || box.x >= 1)) errors.push(`${path}.box.x must be in [0,1)`);
  if (Number.isFinite(box.y) && (box.y < 0 || box.y >= 1)) errors.push(`${path}.box.y must be in [0,1)`);
  if (Number.isFinite(box.x) && Number.isFinite(box.w) && box.x + box.w > 1.0001) errors.push(`${path}.box spills past the right edge`);
  if (Number.isFinite(box.y) && Number.isFinite(box.h) && box.y + box.h > 1.0001) errors.push(`${path}.box spills past the bottom edge`);
}

// Returns { ok, errors:[], value }. `value` is the normalised record to store.
export function validateQuestion(input, existing = {}) {
  const errors = [];
  const q = input && typeof input === 'object' ? input : {};

  if (typeof q.id !== 'string' || !q.id.trim()) errors.push('id must be a non-empty string');
  if (!SUBJECTS.includes(q.subject)) errors.push(`subject must be one of ${SUBJECTS.join(', ')}`);
  if (!QUESTION_TYPES.includes(q.type)) errors.push(`type must be one of ${QUESTION_TYPES.join(', ')}`);
  if (typeof q.stem !== 'string' || !q.stem.trim()) errors.push('stem is required');

  if (typeof q.unit !== 'string' || !q.unit.trim()) errors.push('unit is required');
  if (typeof q.chapter !== 'string' || !q.chapter.trim()) errors.push('chapter is required');

  const type = q.type;

  if (type === 'single_correct' || type === 'multi_correct' || type === 'match_list') {
    if (!isPlainArray(q.options) || q.options.length < 2 || q.options.length > 4) {
      errors.push(`${type} requires 2–4 options`);
    }
  }

  if (type === 'single_correct') {
    const corr = q.correctOptions;
    if (!isPlainArray(corr) || corr.length !== 1) errors.push('single_correct requires exactly one correct option');
    else if (!OPTION_LETTERS.slice(0, (q.options || []).length).includes(corr[0])) {
      errors.push('correctOptions must be one of the rendered option letters');
    }
  }

  if (type === 'multi_correct') {
    const corr = q.correctOptions;
    if (!isPlainArray(corr) || corr.length < 2) {
      errors.push('multi_correct requires at least two correct options ("one or more than one")');
    }
  }

  for (const [i, alt] of (q.altAnswers || []).entries()) {
    if (!isPlainArray(alt) || !alt.length) errors.push(`altAnswers[${i}] must be a non-empty array of option letters`);
  }

  if (type === 'match_list') {
    if (!isPlainArray(q.listI) || q.listI.length !== 4) errors.push('match_list requires listI with 4 entries (P, Q, R, S)');
    if (!isPlainArray(q.listII) || q.listII.length !== 5) errors.push('match_list requires listII with 5 entries (1–5)');
    if (typeof q.matchAnswer !== 'string' || !OPTION_LETTERS.includes(q.matchAnswer)) {
      errors.push('match_list requires matchAnswer of "A"–"D"');
    }
  }

  if (type === 'numerical' || type === 'stem_subquestion') {
    const ok = Number.isFinite(q.numericalAnswer) || isRangeAnswer(q.numericalAnswer);
    if (!ok) errors.push(`${type} requires numericalAnswer as a number or {min,max}`);
    if (type === 'stem_subquestion') {
      if (typeof q.groupId !== 'string' || !q.groupId.trim()) {
        errors.push('stem_subquestion requires a groupId shared with its sibling question');
      }
    }
  }

  if (!Number.isFinite(q.qElo) || q.qElo < 800 || q.qElo > 2550) errors.push('qElo must be a number in [800, 2550]');
  if (!Number.isFinite(q.targetTimeMins) || q.targetTimeMins <= 0 || q.targetTimeMins > 60) {
    errors.push('targetTimeMins must be a number in (0, 60]');
  }
  if (!DIFFICULTIES.includes(q.difficulty)) errors.push(`difficulty must be one of ${DIFFICULTIES.join(', ')}`);

  const weight = q.chapterWeight === undefined || q.chapterWeight === null ? 1.0 : q.chapterWeight;
  if (!Number.isFinite(weight) || weight < 0.05 || weight > 1.5) errors.push('chapterWeight must be in [0.05, 1.5]');

  const fallback = DEFAULT_SCHEME[type] || { marks: 4, negative: 1 };
  const marks = q.marks === undefined || q.marks === null ? fallback.marks : Number(q.marks);
  const negative = q.negative === undefined || q.negative === null ? fallback.negative : Number(q.negative);
  if (!Number.isFinite(marks) || marks <= 0) errors.push('marks must be a positive number');
  if (!Number.isFinite(negative) || negative < 0) errors.push('negative must be a non-negative number');

  validateFigure(q.figure, 'figure', errors, false);
  validateFigure(q.solutionFigure, 'solutionFigure', errors, false);
  if (q.optionFigures && typeof q.optionFigures === 'object') {
    for (const [letter, fig] of Object.entries(q.optionFigures)) {
      if (!OPTION_LETTERS.includes(letter)) errors.push(`optionFigures has unknown option "${letter}"`);
      validateFigure(fig, `optionFigures.${letter}`, errors, true);
    }
  }

  if (errors.length) return { ok: false, errors };

  const record = {
    ...existing,
    id: q.id.trim(),
    subject: q.subject,
    unit: q.unit,
    chapter: q.chapter,
    type,
    groupId: q.groupId || null,
    stem: q.stem,
    options: q.options || null,
    correctOptions: q.correctOptions || null,
    altAnswers: q.altAnswers || [],
    numericalAnswer: q.numericalAnswer === undefined ? null : q.numericalAnswer,
    unitLabel: q.unitLabel || null,
    listI: q.listI || null,
    listII: q.listII || null,
    matchAnswer: q.matchAnswer || null,
    qElo: Math.round(q.qElo),
    targetTimeMins: q.targetTimeMins,
    difficulty: q.difficulty,
    marks,
    negative,
    chapterWeight: weight,
    tags: Array.isArray(q.tags) ? q.tags : [],
    hint: q.hint || null,
    explanation: q.explanation || null,
    figure: q.figure || null,
    optionFigures: q.optionFigures || null,
    solutionFigure: q.solutionFigure || null,
    model: q.model || 'gem-stamped-v4',
    pValue: existing.pValue ?? null,
    seenCount: existing.seenCount || 0,
    correctCount: existing.correctCount || 0,
    status: q.status || existing.status || 'active',
    createdAt: existing.createdAt || Date.now(),
  };
  // Legacy installs stored paperHint/sectionHint on the record; drop them so
  // the placement hints are used only at upload->paper seeding time.
  delete record.paperHint;
  delete record.sectionHint;
  return { ok: true, errors: [], value: record };
}

// Every asset tag referenced anywhere on the question.
export function referencedAssets(q) {
  const tags = new Set();
  const push = (fig) => { if (fig && fig.asset) tags.add(`${fig.source}:${fig.asset}`); };
  push(q.figure);
  push(q.solutionFigure);
  for (const fig of Object.values(q.optionFigures || {})) push(fig);
  return [...tags];
}