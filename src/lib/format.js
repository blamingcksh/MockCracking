export const SUBJECTS = ['physics', 'chemistry', 'maths'];

export const SUBJECT_LABEL = {
  physics: 'Physics', chemistry: 'Chemistry', maths: 'Mathematics',
};

export const TYPE_LABEL = {
  single_correct: 'Single correct',
  multi_correct: 'One or more correct',
  numerical: 'Numerical value',
  match_list: 'Matching list',
  stem_subquestion: 'Stem sub-question',
};

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'brutal'];

export function pct(part, whole) {
  if (!whole) return '—';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

export function clock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function hoursMins(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function dateTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function difficultyPill(level) {
  const span = document.createElement('span');
  span.className = `pill ${level}`;
  span.textContent = level;
  return span;
}

// Empirical win-fraction -> label, used once a question has enough attempts.
export function difficultyFromPValue(pValue) {
  if (pValue >= 0.75) return 'easy';
  if (pValue >= 0.50) return 'medium';
  if (pValue >= 0.25) return 'hard';
  return 'brutal';
}