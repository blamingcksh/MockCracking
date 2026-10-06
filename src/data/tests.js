import { getAll, get, put, remove, putMany } from '../db.js';
import { createAttempt } from './attempts.js';

export async function saveTest(test) {
  await put('tests', test);
  return test;
}

export async function getTest(id) {
  return get('tests', id);
}

export async function listTests() {
  const list = await getAll('tests');
  return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function deleteTest(id) {
  // Delete all questions belonging to this test
  const allQuestions = await getAll('questions');
  const forThis = allQuestions.filter(q => q.testId === id || (q.id && q.id.startsWith(`${id}/`)));
  for (const q of forThis) {
    await remove('questions', q.id);
  }
  // Delete all attempts belonging to this test
  const allAttempts = await getAll('attempts');
  for (const a of allAttempts.filter(a => a.testId === id)) {
    await remove('attempts', a.id);
  }
  await remove('tests', id);
}

export function testScheduleStatus(test) {
  if (!test.scheduleEnabled) {
    return {
      status: 'ready',
      label: 'Ready',
      canStart: true,
      remainingMs: (test.durationMins || 180) * 60000,
      lateMs: 0,
    };
  }

  const now = Date.now();
  const start = test.scheduledAt || 0;
  const windowDurationMs = (test.durationMins || 180) * 60000;
  const windowEnd = start + windowDurationMs;

  if (now < start) {
    return {
      status: 'locked',
      label: 'Locked',
      canStart: false,
      startsInMs: start - now,
      startsAt: start,
      windowEnd,
    };
  }

  if (now < windowEnd) {
    const remainingMs = windowEnd - now;
    const lateMs = now - start;
    return {
      status: 'window_active',
      label: 'Window Active',
      canStart: true,
      remainingMs,
      lateMs,
      startsAt: start,
      windowEnd,
    };
  }

  return {
    status: 'expired',
    label: 'Expired',
    canStart: false,
    expiredSinceMs: now - windowEnd,
    windowEnd,
  };
}

export async function startTest(test) {
  const sched = testScheduleStatus(test);
  if (!sched.canStart) {
    throw new Error(sched.status === 'locked'
      ? `This test is locked until ${new Date(sched.startsAt).toLocaleTimeString()}`
      : 'This test schedule window has expired.');
  }

  let deadline;
  if (test.scheduleEnabled) {
    deadline = test.scheduledAt + (test.durationMins || 180) * 60000;
  } else {
    deadline = Date.now() + (test.durationMins || 180) * 60000;
  }

  const attempt = await createAttempt(test, test.spec, deadline);
  return attempt;
}

export function deriveSpecFromUpload(records, placement) {
  const byPaper = new Map();
  const idsByPaper = new Map();
  const unplaced = [];
  const targetById = new Map(records.map(q => [q.id, q.targetTimeMins || 0]));

  for (const q of records) {
    const p = placement.get(q.id) || {};
    if (p.section === null || p.section === undefined || !Number.isFinite(Number(p.section))) {
      unplaced.push({ id: q.id, reason: 'no section in JSON' });
      continue;
    }
    const n = Number(p.section);
    const paperNum = p.paper === null || p.paper === undefined ? 1 : Number(p.paper);
    const key = `${q.subject}-s${n}-${q.type}-m${q.marks}n${q.negative}`;

    if (!byPaper.has(paperNum)) { byPaper.set(paperNum, new Map()); idsByPaper.set(paperNum, new Map()); }
    const slots = byPaper.get(paperNum);
    const ids = idsByPaper.get(paperNum);
    if (!slots.has(key)) {
      slots.set(key, {
        key,
        subject: q.subject,
        sectionIndex: n,
        type: q.type,
        label: `Section ${n}`,
        count: 0,
        marks: q.marks,
        negative: q.negative,
      });
      ids.set(key, []);
    }
    slots.get(key).count += 1;
    ids.get(key).push(q.id);
  }

  const subjectRank = { physics: 0, chemistry: 1, maths: 2 };
  const papers = [];
  for (const [paperNum, slotMap] of byPaper) {
    const slotIds = idsByPaper.get(paperNum);
    const slots = [...slotMap.values()].sort((a, b) =>
      (subjectRank[a.subject] - subjectRank[b.subject]) || (a.sectionIndex - b.sectionIndex) || a.type.localeCompare(b.type));
    let questionCount = 0;
    let maxMarks = 0;
    let minutes = 0;
    for (const s of slots) {
      questionCount += s.count;
      maxMarks += s.count * s.marks;
      for (const qid of slotIds.get(s.key) || []) minutes += targetById.get(qid) || 0;
    }
    const label = byPaper.size > 1 ? `Paper ${paperNum}` : 'Paper 1';
    papers.push({
      paperNumber: paperNum,
      label,
      slots,
      slotIds,
      durationMins: Math.max(15, Math.ceil(minutes)),
      questionCount,
      maxMarks,
    });
  }
  papers.sort((a, b) => a.paperNumber - b.paperNumber);
  return { papers, unplaced };
}

// Creates independent tests for each paper in the upload, namespacing question
// IDs so questions and figures across multiple papers never collide or overwrite.
export async function createTestsFromUpload({ baseName, records, placement, schedules, assetPrefixMap = {} }) {
  const { papers, unplaced } = deriveSpecFromUpload(records, placement);
  const createdTests = [];

  for (const p of papers) {
    const testId = `t-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
    const scheduleCfg = (schedules && schedules[p.paperNumber]) || {
      scheduleEnabled: false,
      scheduledAt: null,
      durationMins: p.durationMins,
    };

    const paperTitle = papers.length > 1
      ? `${baseName.trim()} (${p.label})`
      : baseName.trim();

    // Collect questions for this paper
    const paperQuestions = [];
    const idMap = new Map(); // originalId -> namespacedId

    for (const slot of p.slots) {
      const qids = p.slotIds.get(slot.key) || [];
      for (const origId of qids) {
        const origQ = records.find(r => r.id === origId);
        if (!origQ) continue;
        const newId = `${testId}/${origId}`;
        idMap.set(origId, newId);

        // Deep-clone and namespace question assets & id
        const newQ = JSON.parse(JSON.stringify(origQ));
        newQ.id = newId;
        newQ.testId = testId;

        // Re-tag figure references if prefixed
        const remapAsset = fig => {
          if (fig && fig.asset && assetPrefixMap[fig.asset]) {
            fig.asset = assetPrefixMap[fig.asset];
          }
        };
        remapAsset(newQ.figure);
        remapAsset(newQ.solutionFigure);
        if (newQ.optionFigures) {
          for (const optFig of Object.values(newQ.optionFigures)) remapAsset(optFig);
        }

        paperQuestions.push(newQ);
      }
    }

    // Persist questions
    await putMany('questions', paperQuestions);

    const test = {
      id: testId,
      name: paperTitle,
      paperNumber: p.paperNumber,
      createdAt: Date.now(),
      scheduleEnabled: !!scheduleCfg.scheduleEnabled,
      scheduledAt: scheduleCfg.scheduleEnabled ? scheduleCfg.scheduledAt : null,
      durationMins: Math.max(1, Number(scheduleCfg.durationMins) || p.durationMins),
      spec: {
        label: p.label,
        durationMins: Math.max(1, Number(scheduleCfg.durationMins) || p.durationMins),
        slots: p.slots,
      },
      slots: p.slots.map(s => ({
        key: s.key,
        questionIds: (p.slotIds.get(s.key) || []).map(qid => idMap.get(qid)).filter(Boolean),
      })),
      questionCount: p.questionCount,
      maxMarks: p.maxMarks,
    };

    await saveTest(test);
    createdTests.push(test);
  }

  return { tests: createdTests, unplaced };
}
