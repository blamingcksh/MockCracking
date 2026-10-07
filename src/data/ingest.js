import { getAll, get, putMany } from '../db.js';
import { validateQuestion, referencedAssets } from './schema.js';

// Shared JSON-extraction: tolerant of fences, leading prose, and bare forms.
function extractJson(text) {
  const cleaned = String(text || '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();

  const firstBracket = cleaned.search(/[[{]/);
  if (firstBracket === -1) return { error: 'No JSON found in the pasted text.' };
  const body = cleaned.slice(firstBracket);

  try {
    return { value: JSON.parse(body) };
  } catch (err) {
    return { error: `JSON parse failed: ${err.message}` };
  }
}

// Tolerant of fences, leading prose, and the bare-array form.
export function parsePaste(text) {
  const res = extractJson(text);
  if (res.error) return { error: res.error };
  const parsed = res.value;

  if (Array.isArray(parsed)) return { questions: parsed, assets: { images: [], pdfs: [] } };
  if (parsed && Array.isArray(parsed.questions)) {
    return {
      questions: parsed.questions,
      assets: {
        images: Array.isArray(parsed.assets && parsed.assets.images) ? parsed.assets.images : [],
        pdfs: Array.isArray(parsed.assets && parsed.assets.pdfs) ? parsed.assets.pdfs : [],
      },
    };
  }
  return { error: 'Expected a JSON array of questions, or an object with a "questions" array.' };
}

// Coordinate patch from Prompt 2. Accepts:
//   { "coords": [{ id, figure, optionFigures, solutionFigure }, ...] }
//   [{ id, figure, ... }, ...]
//   { "<id>": { figure, optionFigures, solutionFigure }, ... }
// Missing figure keys mean "leave Box 1 value"; explicit null means "confirm text-only".
export function parseCoordsPaste(text) {
  const raw = String(text || '').trim();
  if (!raw) return { entries: [] };
  const res = extractJson(raw);
  if (res.error) return { error: res.error };
  const parsed = res.value;

  let list = null;
  if (Array.isArray(parsed)) list = parsed;
  else if (parsed && Array.isArray(parsed.coords)) list = parsed.coords;
  else if (parsed && parsed.coords && typeof parsed.coords === 'object') {
    // Map form inside wrapper: { coords: { "<id>": {...} } }
    list = Object.entries(parsed.coords).map(([id, v]) => ({ id, ...(v && typeof v === 'object' ? v : {}) }));
  } else if (parsed && typeof parsed === 'object' && !parsed.questions) {
    const keys = Object.keys(parsed);
    const looksLikeIdMap = keys.length > 0 && keys.every(k => typeof parsed[k] === 'object' || parsed[k] === null);
    if (looksLikeIdMap && keys.some(k => k.startsWith('jee-') || k.includes('/'))) {
      list = keys.map(id => ({ id, ...((parsed[id] && typeof parsed[id] === 'object') ? parsed[id] : {}) }));
    }
  }
  if (!list) return { error: 'Expected { "coords": [...] }, an array of { id, figure, ... }, or an { "<id>": {...} } map.' };
  if (!Array.isArray(list)) return { error: 'Coordinate patch must be an array.' };

  const entries = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || typeof e !== 'object') return { error: `coords[${i}] must be an object with an "id".` };
    const id = typeof e.id === 'string' ? e.id.trim() : '';
    if (!id) return { error: `coords[${i}] is missing a valid "id".` };
    entries.push({ id, figure: e.figure, optionFigures: e.optionFigures, solutionFigure: e.solutionFigure });
  }
  return { entries };
}

function coordsFigureError(fig, path) {
  if (fig === null || fig === undefined) return null;
  if (typeof fig !== 'object') return `${path} must be an object`;
  if (fig.source !== 'image' && fig.source !== 'pdf') return `${path}.source must be "image" or "pdf"`;
  if (typeof fig.asset !== 'string' || !fig.asset) return `${path}.asset must be a non-empty tag`;
  if (fig.source === 'pdf' && (!Number.isInteger(fig.page) || fig.page < 1)) return `${path}.page must be a 1-indexed integer`;
  const box = fig.box;
  if (!box || typeof box !== 'object') return `${path}.box is required`;
  for (const k of ['x', 'y', 'w', 'h']) {
    if (!Number.isFinite(box[k])) return `${path}.box.${k} must be a finite number`;
  }
  if (box.w <= 0 || box.w > 1) return `${path}.box.w must be in (0,1]`;
  if (box.h <= 0 || box.h > 1) return `${path}.box.h must be in (0,1]`;
  if (box.x < 0 || box.x >= 1) return `${path}.box.x must be in [0,1)`;
  if (box.y < 0 || box.y >= 1) return `${path}.box.y must be in [0,1)`;
  if (box.x + box.w > 1.0001) return `${path}.box spills past the right edge`;
  if (box.y + box.h > 1.0001) return `${path}.box spills past the bottom edge`;
  return null;
}

// Merges a Prompt 2 coordinate patch onto validated Box 1 records by id.
// Optional merge: unknown ids warn, invalid boxes are skipped (base kept).
// Returns { merged, applied, figuresAdded, unknownIds:[], errors:[{id, errors:[]}] }
export function mergeCoords(baseRecords, entries) {
  const byId = new Map((baseRecords || []).map((q, idx) => [q.id, idx]));
  const merged = (baseRecords || []).map(q => ({
    ...q,
    figure: q.figure ? JSON.parse(JSON.stringify(q.figure)) : q.figure,
    optionFigures: q.optionFigures ? JSON.parse(JSON.stringify(q.optionFigures)) : q.optionFigures,
    solutionFigure: q.solutionFigure ? JSON.parse(JSON.stringify(q.solutionFigure)) : q.solutionFigure,
  }));

  const unknownIds = [];
  const errors = [];
  let applied = 0;
  let figuresAdded = 0;
  const seen = new Set();

  for (const e of entries || []) {
    if (seen.has(e.id)) {
      errors.push({ id: e.id, errors: ['duplicate coordinate entry for this id'] });
      continue;
    }
    seen.add(e.id);
    const idx = byId.get(e.id);
    if (idx === undefined) {
      unknownIds.push(e.id);
      continue;
    }
    const errs = [];
    const hasFigureKey = Object.prototype.hasOwnProperty.call(e, 'figure');
    const hasOptionKey = Object.prototype.hasOwnProperty.call(e, 'optionFigures');
    const hasSolutionKey = Object.prototype.hasOwnProperty.call(e, 'solutionFigure');
    if (!hasFigureKey && !hasOptionKey && !hasSolutionKey) continue;

    if (hasFigureKey) {
      const err = coordsFigureError(e.figure, 'figure');
      if (err) errs.push(err);
    }
    if (hasSolutionKey) {
      const err = coordsFigureError(e.solutionFigure, 'solutionFigure');
      if (err) errs.push(err);
    }
    if (hasOptionKey && e.optionFigures !== null && e.optionFigures !== undefined) {
      if (typeof e.optionFigures !== 'object' || Array.isArray(e.optionFigures)) {
        errs.push('optionFigures must be an object like { "C": <figure> }');
      } else {
        for (const [letter, fig] of Object.entries(e.optionFigures)) {
          if (!['A', 'B', 'C', 'D'].includes(letter)) errs.push(`optionFigures has unknown option "${letter}"`);
          const err = coordsFigureError(fig, `optionFigures.${letter}`);
          if (err) errs.push(err);
        }
      }
    }
    if (errs.length) {
      errors.push({ id: e.id, errors: errs });
      continue;
    }
    const target = merged[idx];
    if (hasFigureKey) target.figure = e.figure === undefined ? target.figure : (e.figure ? JSON.parse(JSON.stringify(e.figure)) : null);
    if (hasOptionKey) target.optionFigures = e.optionFigures === undefined ? target.optionFigures : (e.optionFigures ? JSON.parse(JSON.stringify(e.optionFigures)) : null);
    if (hasSolutionKey) target.solutionFigure = e.solutionFigure === undefined ? target.solutionFigure : (e.solutionFigure ? JSON.parse(JSON.stringify(e.solutionFigure)) : null);
    applied++;
    for (const fig of [target.figure, target.solutionFigure, ...Object.values(target.optionFigures || {})]) {
      if (fig) figuresAdded++;
    }
  }

  return { merged, applied, figuresAdded, unknownIds, errors };
}

export function typeHistogram(questions) {
  const counts = new Map();
  for (const q of questions) counts.set(q.type, (counts.get(q.type) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// Returns { ok, records, invalid:[{index,id,errors}], duplicates:[], updates:[], missingAssets:[] }
export async function analyse(questions) {
  const existing = await getAll('questions');
  const byId = new Map(existing.map(q => [q.id, q]));
  const seenInPaste = new Set();

  const records = [];
  const invalid = [];
  const duplicates = [];
  const updates = [];
  const missingAssets = new Set();
  const placement = new Map();

  questions.forEach((raw, index) => {
    const id = raw && typeof raw.id === 'string' ? raw.id.trim() : '';
    if (id && seenInPaste.has(id)) {
      duplicates.push({ index, id });
      return;
    }
    if (id) seenInPaste.add(id);

    const prior = id ? byId.get(id) : null;
    const result = validateQuestion(raw, prior || {});
    if (!result.ok) {
      invalid.push({ index, id, errors: result.errors });
      return;
    }
    if (id) {
      const paper = raw.paper === null || raw.paper === undefined ? null : Number(raw.paper);
      const section = raw.section === null || raw.section === undefined ? null : Number(raw.section);
      placement.set(id, { paper: Number.isFinite(paper) ? paper : null, section: Number.isFinite(section) ? section : null });
    }
    if (prior) updates.push(id);
    for (const ref of referencedAssets(result.value)) missingAssets.add(ref);
    records.push(result.value);
  });

  return { ok: invalid.length === 0 && duplicates.length === 0, records, invalid, duplicates, updates, missingAssets: [...missingAssets], placement };
}

export async function commit(records) {
  if (!records.length) return { inserted: 0, updated: 0 };
  const existing = await getAll('questions');
  const existingIds = new Set(existing.map(q => q.id));
  const fresh = records.filter(r => !existingIds.has(r.id));
  const stale = records.filter(r => existingIds.has(r.id));
  if (fresh.length) await putMany('questions', fresh);
  if (stale.length) await putMany('questions', stale);
  return { inserted: fresh.length, updated: stale.length };
}

export async function fetchExisting(id) {
  return get('questions', id);
}