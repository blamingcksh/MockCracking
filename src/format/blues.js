// Official exam formats, transcribed from the papers on jeeadv.ac.in and
// the NTA JEE Main pattern. Marks and negative values live here and nowhere
// else: views never hardcode a mark value.
//
// Section numbering restarts at 1 within each subject of each paper.

const SUBJECTS = ['physics', 'chemistry', 'maths'];

function slots(specs) {
  const out = [];
  for (const subject of SUBJECTS) {
    specs.forEach((spec, i) => {
      out.push({ key: `${subject}-s${spec.section}`, subject, sectionIndex: spec.section, ...spec });
    });
  }
  return out;
}

const ADV2026_P1 = slots([
  { section: 1, label: 'Section 1', type: 'single_correct', count: 4, marks: 3, negative: 1 },
  { section: 2, label: 'Section 2', type: 'multi_correct', count: 4, marks: 4, negative: 1 },
  { section: 3, label: 'Section 3', type: 'numerical', count: 4, marks: 4, negative: 0 },
  { section: 4, label: 'Section 4', type: 'match_list', count: 4, marks: 4, negative: 1 },
]);

const ADV2026_P2 = slots([
  { section: 1, label: 'Section 1', type: 'single_correct', count: 4, marks: 3, negative: 1 },
  { section: 2, label: 'Section 2', type: 'multi_correct', count: 5, marks: 4, negative: 1 },
  { section: 3, label: 'Section 3', type: 'numerical', count: 5, marks: 4, negative: 0 },
  { section: 4, label: 'Section 4', type: 'stem_subquestion', count: 4, marks: 2, negative: 0, groupSize: 2 },
]);

const ADV2025_P1 = slots([
  { section: 1, label: 'Section 1', type: 'single_correct', count: 4, marks: 3, negative: 1 },
  { section: 2, label: 'Section 2', type: 'multi_correct', count: 3, marks: 4, negative: 2 },
  { section: 3, label: 'Section 3', type: 'numerical', count: 6, marks: 4, negative: 0 },
  { section: 4, label: 'Section 4', type: 'match_list', count: 3, marks: 4, negative: 1 },
]);

const ADV2025_P2 = slots([
  { section: 1, label: 'Section 1', type: 'single_correct', count: 4, marks: 3, negative: 1 },
  { section: 2, label: 'Section 2', type: 'multi_correct', count: 4, marks: 4, negative: 2 },
  { section: 3, label: 'Section 3', type: 'numerical', count: 8, marks: 4, negative: 0 },
]);

const MAINS2026 = slots([
  { section: 1, label: 'Section A', type: 'single_correct', count: 20, marks: 4, negative: 1 },
  { section: 2, label: 'Section B', type: 'numerical', count: 5, marks: 4, negative: 1 },
]);

function format(spec) {
  const out = {
    id: spec.id,
    label: spec.label,
    exam: spec.exam,
    durationMins: spec.durationMins,
    subjects: SUBJECTS,
    papers: [],
  };
  for (const paper of spec.papers) {
    const paperSlots = paper.slots;
    out.papers.push({
      number: paper.number,
      label: paper.label,
      slots: paperSlots,
      questionCount: paperSlots.reduce((n, s) => n + s.count, 0),
      maxMarks: paperSlots.reduce((n, s) => n + s.count * s.marks, 0),
      durationMins: spec.durationMins,
    });
  }
  out.totalMarks = out.papers.reduce((n, p) => n + p.maxMarks, 0);
  return out;
}

export const FORMATS = {
  adv2026: format({
    id: 'adv2026', label: 'JEE Advanced 2026', exam: 'advanced', durationMins: 180,
    papers: [
      { number: 1, label: 'Paper 1', slots: ADV2026_P1 },
      { number: 2, label: 'Paper 2', slots: ADV2026_P2 },
    ],
  }),
  adv2025: format({
    id: 'adv2025', label: 'JEE Advanced 2025', exam: 'advanced', durationMins: 180,
    papers: [
      { number: 1, label: 'Paper 1', slots: ADV2025_P1 },
      { number: 2, label: 'Paper 2', slots: ADV2025_P2 },
    ],
  }),
  main2026: format({
    id: 'main2026', label: 'JEE Main 2026', exam: 'main', durationMins: 180,
    papers: [{ number: 1, label: 'Paper 1 (B.E./B.Tech)', slots: MAINS2026 }],
  }),
};

export const DEFAULT_FORMAT = 'adv2026';

export function getFormat(id) {
  return FORMATS[id] || FORMATS[DEFAULT_FORMAT];
}

export function getPaper(formatId, paperNumber) {
  const fmt = getFormat(formatId);
  return fmt.papers.find(p => p.number === Number(paperNumber)) || fmt.papers[0];
}

export function findSlot(paper, key) {
  return paper.slots.find(s => s.key === key) || null;
}

export function slotsForSubject(paper, subject) {
  return paper.slots.filter(s => s.subject === subject);
}

// The subject's slots repeat across papers; group them for the runner's nav.
export function subjectOrder(paper) {
  return SUBJECTS.filter(s => paper.slots.some(slot => slot.subject === s));
}