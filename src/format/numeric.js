const EPS = 1e-9;

// Accepts what the on-screen keypad can produce, including a leading minus.
export function normalizeNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/,/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function isRange(answer) {
  return answer !== null && typeof answer === 'object'
    && Number.isFinite(answer.min) && Number.isFinite(answer.max);
}

// Official final answer keys contain both exact values and ranges such as
// "[3.9 TO 4.1]" / "[690 to 710]", so both key shapes must score.
export function isCorrectNumeric(answer, value) {
  const given = normalizeNumber(value);
  if (given === null) return false;
  if (isRange(answer)) {
    const lo = Math.min(answer.min, answer.max);
    const hi = Math.max(answer.min, answer.max);
    return given >= lo - EPS && given <= hi + EPS;
  }
  const target = normalizeNumber(answer);
  if (target === null) return false;
  return Math.abs(round2(given) - round2(target)) <= EPS;
}

export function describeNumericAnswer(answer) {
  if (isRange(answer)) return `${answer.min} – ${answer.max}`;
  const n = normalizeNumber(answer);
  return n === null ? '—' : String(round2(n));
}