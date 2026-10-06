import assert from 'node:assert/strict';
import { deriveSpecFromUpload, testScheduleStatus } from './src/data/tests.js';

console.log('Testing tests.js logic...');

// Test 1: deriveSpecFromUpload with 1 paper
const sampleRecords1 = [
  {
    id: 'q1',
    subject: 'physics',
    type: 'single_correct',
    marks: 4,
    negative: 1,
    targetTimeMins: 3,
  },
  {
    id: 'q2',
    subject: 'chemistry',
    type: 'numerical',
    marks: 4,
    negative: 0,
    targetTimeMins: 2,
  },
];
const placement1 = new Map([
  ['q1', { paper: 1, section: 1 }],
  ['q2', { paper: 1, section: 2 }],
]);

const derived1 = deriveSpecFromUpload(sampleRecords1, placement1);
assert.equal(derived1.papers.length, 1, 'Should derive 1 paper');
assert.equal(derived1.papers[0].questionCount, 2, 'Should have 2 questions');
assert.equal(derived1.papers[0].maxMarks, 8, 'Should have 8 marks');
assert.equal(derived1.papers[0].durationMins, 15, 'Minimum duration is 15');
console.log('✔ deriveSpecFromUpload (single paper) passed');

// Test 2: deriveSpecFromUpload with 2 papers (Paper 1 & Paper 2)
const sampleRecords2 = [
  { id: 'q1', subject: 'physics', type: 'single_correct', marks: 4, negative: 1, targetTimeMins: 3 },
  { id: 'q2', subject: 'chemistry', type: 'numerical', marks: 4, negative: 0, targetTimeMins: 2 },
  { id: 'q3', subject: 'maths', type: 'multi_correct', marks: 4, negative: 2, targetTimeMins: 4 },
];
const placement2 = new Map([
  ['q1', { paper: 1, section: 1 }],
  ['q2', { paper: 1, section: 2 }],
  ['q3', { paper: 2, section: 1 }],
]);

const derived2 = deriveSpecFromUpload(sampleRecords2, placement2);
assert.equal(derived2.papers.length, 2, 'Should derive 2 separate papers');
assert.equal(derived2.papers[0].paperNumber, 1);
assert.equal(derived2.papers[0].questionCount, 2);
assert.equal(derived2.papers[1].paperNumber, 2);
assert.equal(derived2.papers[1].questionCount, 1);
console.log('✔ deriveSpecFromUpload (two papers separated) passed');

// Test 3: Schedule OFF (Anytime)
const unscheduledTest = {
  scheduleEnabled: false,
  scheduledAt: null,
  durationMins: 180,
};
const schedOff = testScheduleStatus(unscheduledTest);
assert.equal(schedOff.status, 'ready');
assert.equal(schedOff.canStart, true);
assert.equal(schedOff.remainingMs, 180 * 60000);
console.log('✔ Schedule OFF (ready anytime) passed');

// Test 4: Schedule ON - Future (Locked)
const now = Date.now();
const futureTest = {
  scheduleEnabled: true,
  scheduledAt: now + 10 * 60000, // 10 minutes in the future
  durationMins: 60,
};
const schedFuture = testScheduleStatus(futureTest);
assert.equal(schedFuture.status, 'locked');
assert.equal(schedFuture.canStart, false);
assert(schedFuture.startsInMs > 9 * 60000);
console.log('✔ Schedule ON - Future (locked) passed');

// Test 5: Schedule ON - Active Window with Late Start
const lateTest = {
  scheduleEnabled: true,
  scheduledAt: now - 15 * 60000, // started 15 minutes ago
  durationMins: 60,
};
const schedLate = testScheduleStatus(lateTest);
assert.equal(schedLate.status, 'window_active');
assert.equal(schedLate.canStart, true);
// Should have 45 minutes left out of 60!
const minutesLeft = Math.round(schedLate.remainingMs / 60000);
assert.equal(minutesLeft, 45, 'Should deduce 15 minutes because student started late');
assert(schedLate.lateMs >= 15 * 60000);
console.log('✔ Schedule ON - Active window with late deduction passed');

// Test 6: Schedule ON - Expired Window
const expiredTest = {
  scheduleEnabled: true,
  scheduledAt: now - 70 * 60000, // scheduled 70 min ago for a 60 min test
  durationMins: 60,
};
const schedExpired = testScheduleStatus(expiredTest);
assert.equal(schedExpired.status, 'expired');
assert.equal(schedExpired.canStart, false);
console.log('✔ Schedule ON - Expired window passed');

console.log('\nAll test suite assertions passed successfully!');
