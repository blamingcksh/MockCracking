/**
 * Figure slots and crop application for MockCracking.
 * Manages extraction of figure codes (F1..Fn) from parsed Gemini questions
 * and applying user crops onto question records.
 */

const VALID_ON = new Set(['stem', 'A', 'B', 'C', 'D', 'solution']);

/**
 * Extracts and validates figure slots from raw question objects.
 * @param {Array} questions - Array of raw question objects from JSON paste
 * @returns {{ slots: Array, errors: Array<string>, warnings: Array<string> }}
 */
export function extractFigureSlots(questions) {
  const list = Array.isArray(questions) ? questions : (questions?.questions || []);
  const slots = [];
  const errors = [];
  const warnings = [];
  const seenCodes = new Set();
  const seenQuestionTargets = new Set();

  list.forEach((q, qIndex) => {
    if (!q || typeof q !== 'object') return;
    const rawFigures = q.figures || q.figureSlots;
    if (!rawFigures || !Array.isArray(rawFigures)) return;

    const qid = typeof q.id === 'string' ? q.id.trim() : `q-${qIndex + 1}`;
    const qNum = qIndex + 1;
    const qStemPreview = typeof q.stem === 'string'
      ? (q.stem.length > 80 ? q.stem.slice(0, 77) + '...' : q.stem)
      : '';

    rawFigures.forEach((fig, figIndex) => {
      if (!fig || typeof fig !== 'object') {
        errors.push(`Question ${qNum} (${qid}): figure entry #${figIndex + 1} is not an object.`);
        return;
      }

      let hasSlotError = false;
      const rawCode = String(fig.code || '').trim();
      const codeMatch = rawCode.match(/^F(\d+)$/i);
      let n = null;
      let code = rawCode;
      if (!codeMatch) {
        errors.push(`Question ${qNum} (${qid}): invalid figure code "${rawCode}". Codes must be in format F1, F2, F3...`);
        hasSlotError = true;
      } else {
        n = parseInt(codeMatch[1], 10);
        code = `F${n}`;
        if (seenCodes.has(code)) {
          errors.push(`Duplicate figure code "${code}" found in Question ${qNum} (${qid}). Each code must be unique.`);
          hasSlotError = true;
        } else {
          seenCodes.add(code);
        }
      }

      let on = typeof fig.on === 'string' ? fig.on.trim() : 'stem';
      if (['a', 'b', 'c', 'd'].includes(on)) on = on.toUpperCase();
      if (!VALID_ON.has(on)) {
        errors.push(`Question ${qNum} (${qid}): invalid "on" value "${fig.on}" for ${code}. Must be "stem", "A", "B", "C", "D", or "solution".`);
        hasSlotError = true;
      }

      const targetKey = `${qid}:${on}`;
      if (seenQuestionTargets.has(targetKey)) {
        errors.push(`Question ${qNum} (${qid}): multiple figure codes assigned to "${on}". Use a single code covering the diagram block.`);
        hasSlotError = true;
      } else {
        seenQuestionTargets.add(targetKey);
      }

      if (hasSlotError) return;

      const rawPage = parseInt(fig.page, 10);
      const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
      const desc = typeof fig.desc === 'string' && fig.desc.trim()
        ? fig.desc.trim()
        : `Figure for ${on}`;

      slots.push({
        code,
        n,
        qid,
        qIndex,
        qNumber: qNum,
        subject: q.subject || 'unknown',
        chapter: q.chapter || '',
        stemPreview: qStemPreview,
        on,
        page,
        desc,
      });
    });
  });

  // Sort slots by sequence number (F1, F2, F3...)
  slots.sort((a, b) => a.n - b.n);

  // Check for numbering gaps (warning only, not blocking)
  for (let i = 0; i < slots.length; i++) {
    const expected = i + 1;
    if (slots[i].n !== expected && !warnings.some(w => w.includes('gap'))) {
      warnings.push(`Figure codes have numbering gaps (e.g. expected F${expected}, found ${slots[i].code}).`);
    }
  }

  return { slots, errors, warnings };
}

function normalizeBox(box) {
  if (!box || typeof box !== 'object') return { x: 0, y: 0, w: 1, h: 1 };
  const rawX = Math.max(0, Math.min(0.99, Number(box.x || 0)));
  const rawY = Math.max(0, Math.min(0.99, Number(box.y || 0)));
  const maxW = Math.max(0.01, 1 - rawX);
  const maxH = Math.max(0.01, 1 - rawY);
  const w = Math.max(0.01, Math.min(maxW, Number(box.w || 1)));
  const h = Math.max(0.01, Math.min(maxH, Number(box.h || 1)));
  return {
    x: Number(rawX.toFixed(4)),
    y: Number(rawY.toFixed(4)),
    w: Number(w.toFixed(4)),
    h: Number(h.toFixed(4)),
  };
}

/**
 * Applies crop boxes onto question records.
 * @param {Array} records - Array of question records (from analyse / schema validation)
 * @param {Array} slots - Array of slots returned by extractFigureSlots
 * @param {Object} crops - Map of code -> { page: number, box: { x, y, w, h }, parts?: Array }
 * @param {string} assetTag - Unique tag for the PDF asset (e.g. "pdf-1718000000000")
 * @returns {Array} New records with attached figures
 */
export function applyCrops(records, slots, crops = {}, assetTag) {
  if (!Array.isArray(records)) return [];
  const cropsMap = crops instanceof Map ? Object.fromEntries(crops) : (crops || {});

  // Group slots by question id
  const slotsByQid = new Map();
  for (const s of slots || []) {
    if (!slotsByQid.has(s.qid)) slotsByQid.set(s.qid, []);
    slotsByQid.get(s.qid).push(s);
  }

  return records.map(q => {
    const qSlots = slotsByQid.get(q.id);
    if (!qSlots || !qSlots.length) {
      return { ...q };
    }

    const updated = {
      ...q,
      figure: q.figure || null,
      optionFigures: q.optionFigures ? { ...q.optionFigures } : null,
      solutionFigure: q.solutionFigure || null,
    };

    for (const slot of qSlots) {
      const crop = cropsMap[slot.code];
      if (!crop) continue;

      const hasParts = Array.isArray(crop.parts) && crop.parts.length > 0;
      if (!hasParts && !crop.box) continue;

      const primaryPart = hasParts ? crop.parts[0] : crop;
      const primaryPage = Number.isInteger(primaryPart.page) && primaryPart.page >= 1
        ? primaryPart.page
        : (Number.isInteger(crop.page) && crop.page >= 1 ? crop.page : slot.page);

      const figureObj = {
        source: 'pdf',
        asset: assetTag,
        page: primaryPage,
        box: normalizeBox(primaryPart.box || crop.box),
      };

      if (hasParts && crop.parts.length > 1) {
        figureObj.parts = crop.parts.map(p => ({
          page: Number.isInteger(p.page) && p.page >= 1 ? p.page : primaryPage,
          box: normalizeBox(p.box),
        }));
      }

      if (slot.on === 'stem') {
        updated.figure = figureObj;
      } else if (slot.on === 'solution') {
        updated.solutionFigure = figureObj;
      } else if (['A', 'B', 'C', 'D'].includes(slot.on)) {
        if (!updated.optionFigures) updated.optionFigures = {};
        updated.optionFigures[slot.on] = figureObj;
      }
    }

    return updated;
  });
}
