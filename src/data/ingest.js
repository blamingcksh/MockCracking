import { getAll, get, putMany } from '../db.js';
import { validateQuestion, referencedAssets } from './schema.js';

// Tolerant of fences, leading prose, and the bare-array form.
export function parsePaste(text) {
  const cleaned = String(text || '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();

  const firstBracket = cleaned.search(/[[{]/);
  if (firstBracket === -1) return { error: 'No JSON found in the pasted text.' };
  const body = cleaned.slice(firstBracket);

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    return { error: `JSON parse failed: ${err.message}` };
  }

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