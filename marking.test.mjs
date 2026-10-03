// Throwaway verification of the marking engine against the official rules.
import { scoreQuestion } from './src/format/marks.js';
import { isCorrectNumeric } from './src/format/numeric.js';
import { FORMATS } from './src/format/blues.js';
import { expectedScore, updateAbility } from './src/rating/elo.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};

const adv26P1 = FORMATS.adv2026.papers[0];
const adv26P2 = FORMATS.adv2026.papers[1];
const adv25P1 = FORMATS.adv2025.papers[0];
const adv25P2 = FORMATS.adv2025.papers[1];
const main26 = FORMATS.main2026.papers[0];
const slot = (paper, subject, n) => paper.slots.find(s => s.subject === subject && s.sectionIndex === n);

// --- Blueprint totals against the official papers ---
eq('adv2026 P1 questions', adv26P1.questionCount, 48);
eq('adv2026 P1 marks', adv26P1.maxMarks, 180);
eq('adv2026 P2 questions', adv26P2.questionCount, 54);
eq('adv2026 P2 marks', adv26P2.maxMarks, 180);
eq('adv2026 P2 questions per subject', adv26P2.questionCount / 3, 18);
eq('adv2025 P1 questions', adv25P1.questionCount, 48);
eq('adv2025 P2 questions', adv25P2.questionCount, 48);
eq('adv2025 P2 sections per subject', adv25P2.slots.filter(s => s.subject === 'physics').length, 3);
eq('main2026 questions', main26.questionCount, 75);
eq('main2026 marks', main26.maxMarks, 300);
eq('main2026 questions per subject', main26.questionCount / 3, 25);

// --- Single correct: +3 / -1 / 0 ---
const s1 = slot(adv26P1, 'physics', 1);
const single = { type: 'single_correct', correctOptions: ['A'] };
eq('single right', scoreQuestion(single, { value: 'A' }, s1), 3);
eq('single wrong', scoreQuestion(single, { value: 'B' }, s1), -1);
eq('single blank', scoreQuestion(single, { value: null }, s1), 0);
eq('single marks', s1.marks, 3);

// --- Multi correct: the verbatim worked example, key {A,B,D} ---
const s2 = slot(adv26P1, 'physics', 2);
const multi = { type: 'multi_correct', correctOptions: ['A', 'B', 'D'] };
eq('multi full {A,B,D}', scoreQuestion(multi, { value: ['A','B','D'] }, s2), 4);
eq('multi {A,B}', scoreQuestion(multi, { value: ['A','B'] }, s2), 2);
eq('multi {A,D}', scoreQuestion(multi, { value: ['A','D'] }, s2), 2);
eq('multi {B,D}', scoreQuestion(multi, { value: ['B','D'] }, s2), 2);
eq('multi {A}', scoreQuestion(multi, { value: ['A'] }, s2), 1);
eq('multi {B}', scoreQuestion(multi, { value: ['B'] }, s2), 1);
eq('multi {D}', scoreQuestion(multi, { value: ['D'] }, s2), 1);
eq('multi blank', scoreQuestion(multi, { value: [] }, s2), 0);
eq('multi wrong combo', scoreQuestion(multi, { value: ['A','B','C'] }, s2), -1);

// --- +3 rung requires all four options correct ---
const s2b = slot(adv26P1, 'physics', 2);
const allFour = { type: 'multi_correct', correctOptions: ['A','B','C','D'] };
eq('all four, choose 3', scoreQuestion(allFour, { value: ['A','B','C'] }, s2b), 3);
eq('all four, choose 2', scoreQuestion(allFour, { value: ['A','B'] }, s2b), 2);
eq('all four, choose 1', scoreQuestion(allFour, { value: ['A'] }, s2b), 1);
eq('all four, choose 4', scoreQuestion(allFour, { value: ['A','B','C','D'] }, s2b), 4);
// three-correct key, choose 3 -> full, not +3
const three = { type: 'multi_correct', correctOptions: ['A','B','C'] };
eq('three-correct choose 3 = full', scoreQuestion(three, { value: ['A','B','C'] }, s2b), 4);
eq('three-correct choose 2', scoreQuestion(three, { value: ['A','B'] }, s2b), 2);

// --- 2025 multi-correct negative is -2 ---
const s2_25 = slot(adv25P1, 'physics', 2);
eq('adv2025 multi wrong', scoreQuestion(multi, { value: ['A','B','C'] }, s2_25), -2);
eq('adv2025 multi full', scoreQuestion(multi, { value: ['A','B','D'] }, s2_25), 4);

// --- altAnswers: "A or B" style keys ---
const alt = { type: 'multi_correct', correctOptions: ['A'], altAnswers: [['B']] };
eq('altAnswers primary', scoreQuestion(alt, { value: ['A'] }, s2), 4);
eq('altAnswers alternative', scoreQuestion(alt, { value: ['B'] }, s2), 4);
eq('altAnswers other still wrong', scoreQuestion(alt, { value: ['C'] }, s2), -1);

// --- Numerical: +4 / 0, never negative ---
const s3 = slot(adv26P1, 'physics', 3);
const num = { type: 'numerical', numericalAnswer: 12.34 };
eq('numeric exact', scoreQuestion(num, { value: '12.34' }, s3), 4);
eq('numeric via keypad float', scoreQuestion(num, { value: '12.34' }, s3), 4);
eq('numeric 3dp rounds to 2dp', scoreQuestion(num, { value: '12.340' }, s3), 4);
eq('numeric wrong', scoreQuestion(num, { value: '12.35' }, s3), 0);
eq('numeric blank', scoreQuestion(num, { value: '' }, s3), 0);
eq('numeric garbage', scoreQuestion(num, { value: 'abc' }, s3), 0);

// --- Range keys from the official final answer key ---
eq('range 4.0 in [3.9,4.1]', isCorrectNumeric({ min: 3.9, max: 4.1 }, '4.0'), true);
eq('range 3.9 edge', isCorrectNumeric({ min: 3.9, max: 4.1 }, '3.9'), true);
eq('range 4.1 edge', isCorrectNumeric({ min: 3.9, max: 4.1 }, '4.1'), true);
eq('range 4.2 outside', isCorrectNumeric({ min: 3.9, max: 4.1 }, '4.2'), false);
eq('range 690-710', isCorrectNumeric({ min: 690, max: 710 }, '700'), true);
eq('range reversed bounds', isCorrectNumeric({ min: 710, max: 690 }, '700'), true);
eq('exact beats range shape', isCorrectNumeric(4.0, '4.0'), true);

// --- Match list: +4 / -1 / 0 ---
const s4 = slot(adv26P1, 'physics', 4);
const match = { type: 'match_list', matchAnswer: 'B' };
eq('match right', scoreQuestion(match, { value: 'B' }, s4), 4);
eq('match wrong', scoreQuestion(match, { value: 'A' }, s4), -1);
eq('match blank', scoreQuestion(match, { value: null }, s4), 0);

// --- Stem sub-question: +2 / 0, never negative ---
const s4p2 = slot(adv26P2, 'physics', 4);
eq('stem slot marks', s4p2.marks, 2);
eq('stem subquestion groupSize', s4p2.groupSize, 2);
const stemQ = { type: 'stem_subquestion', numericalAnswer: 5 };
eq('stem right', scoreQuestion(stemQ, { value: '5' }, s4p2), 2);
eq('stem wrong scores 0 not negative', scoreQuestion(stemQ, { value: '6' }, s4p2), 0);

// --- JEE Main: +4 / -1 on both sections ---
const mainA = slot(main26, 'maths', 1);
const mainB = slot(main26, 'maths', 2);
eq('mains A marks', mainA.marks, 4);
eq('mains A count', mainA.count, 20);
eq('mains B count', mainB.count, 5);
eq('mains single wrong', scoreQuestion(single, { value: 'B' }, mainA), -1);
eq('mains numeric wrong', scoreQuestion(num, { value: '9' }, mainB), 0);

// --- Elo ---
eq('expectedScore even', Math.round(expectedScore(1200, 1200) * 1000) / 1000, 0.5);
eq('harder question lowers expectation', expectedScore(1200, 2000) < expectedScore(1200, 1200), true);
eq('getting a hard question right raises ability a lot',
  updateAbility(1200, 2200, 1) - 1200 > updateAbility(1200, 900, 1) - 1200, true);
eq('getting an easy question wrong lowers ability more',
  updateAbility(1200, 800, 0) - 1200 < updateAbility(1200, 2000, 0) - 1200, true);

// --- chapterWeight scales the learning rate ---
eq('heavy chapter punishes harder', updateAbility(1200, 1800, 0, 1.5) < updateAbility(1200, 1800, 0, 0.05), true);
eq('weight 1 is the neutral default',
  updateAbility(1200, 1800, 0), updateAbility(1200, 1800, 0, 1));
eq('ability floor respected', updateAbility(700, 800, 0, 1.5) >= 700, true);
eq('ability ceiling respected', updateAbility(2600, 2500, 1, 1.5) <= 2700, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);