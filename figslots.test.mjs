import assert from 'node:assert/strict';
import { extractFigureSlots, applyCrops } from './src/data/figslots.js';
import { validateQuestion } from './src/data/schema.js';

console.log('Testing figslots.js logic...');

// 1. extractFigureSlots with standard questions
const questions = [
  {
    id: 'jee-phy-rot-q1',
    subject: 'physics',
    chapter: 'Rotational Motion',
    stem: 'Find the acceleration of the cylinder.',
    figures: [
      { code: 'F1', on: 'stem', page: 1, desc: 'cylinder rolling down an incline' },
      { code: 'F2', on: 'B', page: 1, desc: 'velocity-time graph for option B' },
    ],
  },
  {
    id: 'jee-mat-lim-q2',
    subject: 'maths',
    chapter: 'Limits',
    stem: 'Evaluate limit.',
    figures: [],
  },
  {
    id: 'jee-che-ste-q3',
    subject: 'chemistry',
    chapter: 'Thermodynamics',
    stem: 'Which cycle represents Carnot engine?',
    figures: [
      { code: 'F3', on: 'stem', page: 2, desc: 'P-V indicator diagram' },
      { code: 'F4', on: 'solution', page: 3, desc: 'annotated Carnot cycle' },
    ],
  },
];

const res = extractFigureSlots(questions);
assert.equal(res.errors.length, 0, 'No errors in valid extraction');
assert.equal(res.slots.length, 4, 'Should extract 4 figure slots');

assert.equal(res.slots[0].code, 'F1');
assert.equal(res.slots[0].qid, 'jee-phy-rot-q1');
assert.equal(res.slots[0].on, 'stem');
assert.equal(res.slots[0].page, 1);

assert.equal(res.slots[1].code, 'F2');
assert.equal(res.slots[1].on, 'B');

assert.equal(res.slots[2].code, 'F3');
assert.equal(res.slots[2].on, 'stem');
assert.equal(res.slots[2].page, 2);

assert.equal(res.slots[3].code, 'F4');
assert.equal(res.slots[3].on, 'solution');
assert.equal(res.slots[3].page, 3);
console.log('✔ extractFigureSlots basic extraction passed');

// 2. Ordering check when codes emitted out of order
const unordered = [
  {
    id: 'q2',
    figures: [{ code: 'F3', on: 'stem' }],
  },
  {
    id: 'q1',
    figures: [{ code: 'F1', on: 'stem' }, { code: 'F2', on: 'stem' }], // multiple on stem will error
  },
];
const dupTarget = extractFigureSlots(unordered);
assert.equal(dupTarget.errors.length, 1, 'Should error on multiple figures on same target');

// Multiple unordered distinct targets
const unorderedValid = [
  { id: 'q2', figures: [{ code: 'F3', on: 'stem', page: 4 }] },
  { id: 'q1', figures: [{ code: 'F2', on: 'A', page: 2 }, { code: 'F1', on: 'stem', page: 1 }] },
];
const orderedRes = extractFigureSlots(unorderedValid);
assert.equal(orderedRes.errors.length, 0);
assert.deepEqual(orderedRes.slots.map(s => s.code), ['F1', 'F2', 'F3'], 'Slots should sort numerically');
console.log('✔ extractFigureSlots numeric ordering passed');

// 3. Duplicate code validation
const dupCode = [
  { id: 'q1', figures: [{ code: 'F1', on: 'stem' }] },
  { id: 'q2', figures: [{ code: 'F1', on: 'stem' }] },
];
const dupRes = extractFigureSlots(dupCode);
assert.ok(dupRes.errors.length > 0, 'Duplicate code should be caught');
console.log('✔ extractFigureSlots duplicate code detection passed');

// 4. Invalid code format and target validation
const invalidProps = [
  { id: 'q1', figures: [{ code: 'FIG-1', on: 'invalid_target' }] },
];
const invRes = extractFigureSlots(invalidProps);
assert.ok(invRes.errors.some(e => e.includes('invalid figure code')));
assert.ok(invRes.errors.some(e => e.includes('invalid "on" value')));
console.log('✔ extractFigureSlots invalid properties caught');

// 5. applyCrops onto question records
const records = [
  {
    id: 'jee-phy-rot-q1',
    subject: 'physics',
    unit: 'Mechanics',
    chapter: 'Rotational Motion',
    type: 'single_correct',
    stem: 'Find acceleration',
    options: ['1 m/s^2', '2 m/s^2', '3 m/s^2', '4 m/s^2'],
    correctOptions: ['A'],
    qElo: 1200,
    targetTimeMins: 3,
    difficulty: 'easy',
    marks: 4,
    negative: 1,
  },
  {
    id: 'jee-che-ste-q3',
    subject: 'chemistry',
    unit: 'Chemical Thermodynamics',
    chapter: 'Chemical Thermodynamics',
    type: 'single_correct',
    stem: 'Carnot cycle',
    options: ['A', 'B', 'C', 'D'],
    correctOptions: ['A'],
    qElo: 1400,
    targetTimeMins: 3,
    difficulty: 'medium',
    marks: 4,
    negative: 1,
  },
];

const crops = {
  F1: { page: 1, box: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 } },
  F2: { page: 1, box: { x: 0.6, y: 0.2, w: 0.3, h: 0.3 } },
  // F3 skipped
  F4: { page: 3, box: { x: 0.15, y: 0.4, w: 0.7, h: 0.5 } },
};

const updatedRecords = applyCrops(records, res.slots, crops, 'pdf-asset-123');

// Question 1: should have stem figure and option B figure
assert.deepEqual(updatedRecords[0].figure, {
  source: 'pdf',
  asset: 'pdf-asset-123',
  page: 1,
  box: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
});
assert.deepEqual(updatedRecords[0].optionFigures.B, {
  source: 'pdf',
  asset: 'pdf-asset-123',
  page: 1,
  box: { x: 0.6, y: 0.2, w: 0.3, h: 0.3 },
});

// Question 2: F3 was skipped -> figure should be null; F4 was cropped -> solutionFigure present
assert.equal(updatedRecords[1].figure, null);
assert.deepEqual(updatedRecords[1].solutionFigure, {
  source: 'pdf',
  asset: 'pdf-asset-123',
  page: 3,
  box: { x: 0.15, y: 0.4, w: 0.7, h: 0.5 },
});

// Validate that records pass validateQuestion from schema.js
for (const r of updatedRecords) {
  const val = validateQuestion(r);
  assert.equal(val.ok, true, `Record ${r.id} should validate cleanly with applied crops: ${val.errors}`);
}
console.log('✔ applyCrops application and schema validation passed');

// 6. Multi-part (cross-page) crop application and schema validation
const multiPartCrops = {
  F1: {
    parts: [
      { page: 1, box: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 } },
      { page: 2, box: { x: 0.05, y: 0.1, w: 0.6, h: 0.4 } },
    ],
  },
};
const multiPartRecords = applyCrops(records, res.slots, multiPartCrops, 'pdf-multi-123');
assert.equal(multiPartRecords[0].figure.page, 1, 'Primary page should match part 1');
assert.deepEqual(multiPartRecords[0].figure.box, { x: 0.1, y: 0.2, w: 0.5, h: 0.3 }, 'Primary box should match part 1');
assert.equal(multiPartRecords[0].figure.parts.length, 2, 'Should attach both parts');
assert.equal(multiPartRecords[0].figure.parts[0].page, 1);
assert.equal(multiPartRecords[0].figure.parts[1].page, 2);

const multiVal = validateQuestion(multiPartRecords[0]);
assert.equal(multiVal.ok, true, `Multi-part question must pass schema validation: ${multiVal.errors}`);
console.log('✔ Multi-part crop mapping and schema validation passed');

// 7. Schema rejection of invalid parts
const invalidPartRecord = {
  ...multiPartRecords[0],
  figure: {
    ...multiPartRecords[0].figure,
    parts: [{ page: 0, box: { x: 0, y: 0, w: 0.5, h: 0.5 } }], // invalid page 0
  },
};
const invPartVal = validateQuestion(invalidPartRecord);
assert.equal(invPartVal.ok, false, 'Should reject page 0 in parts');
assert.ok(invPartVal.errors.some(e => e.includes('1-indexed integer')), 'Should mention 1-indexed integer');

const emptyPartsRecord = {
  ...multiPartRecords[0],
  figure: {
    ...multiPartRecords[0].figure,
    parts: [],
  },
};
const emptyPartsVal = validateQuestion(emptyPartsRecord);
assert.equal(emptyPartsVal.ok, false, 'Should reject empty parts array');
console.log('✔ Schema validation rejects invalid parts arrays correctly');

// 8. calculatePartLayout vertical stacking test
const { calculatePartLayout } = await import('./src/assets/figure.js');

// Test single part layout
const singleLayout = calculatePartLayout([
  { box: { x: 0.1, y: 0.2, w: 0.5, h: 0.25 }, source: { width: 1000, height: 1000 } },
], 500);
assert.equal(singleLayout.totalWidth, 500);
assert.equal(singleLayout.totalHeight, 250);
assert.equal(singleLayout.layouts.length, 1);
assert.equal(singleLayout.layouts[0].destW, 500);
assert.equal(singleLayout.layouts[0].destH, 250);
assert.equal(singleLayout.layouts[0].dy, 0);

// Test multi-part cross-page vertical stacking layout
const multiLayout = calculatePartLayout([
  { box: { x: 0, y: 0, w: 0.4, h: 0.2 }, source: { width: 1000, height: 1000 } }, // sw: 400, sh: 200
  { box: { x: 0, y: 0, w: 0.4, h: 0.3 }, source: { width: 1000, height: 1000 } }, // sw: 400, sh: 300
], 800);

assert.equal(multiLayout.totalWidth, 800);
assert.equal(multiLayout.totalHeight, 1000); // 400 (part 1) + 600 (part 2)
assert.equal(multiLayout.layouts.length, 2);
assert.equal(multiLayout.layouts[0].destW, 800);
assert.equal(multiLayout.layouts[0].destH, 400);
assert.equal(multiLayout.layouts[0].dy, 0);
assert.equal(multiLayout.layouts[1].destW, 800);
assert.equal(multiLayout.layouts[1].destH, 600);
assert.equal(multiLayout.layouts[1].dy, 400, 'Part 2 should be positioned immediately below Part 1');
console.log('✔ calculatePartLayout single and multi-part vertical stitching passed');

console.log('All figslots tests passed successfully!');

