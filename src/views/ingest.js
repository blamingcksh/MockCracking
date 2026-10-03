import { h, clear } from '../lib/dom.js';
import { SUBJECTS, SUBJECT_LABEL } from '../lib/format.js';
import { parsePaste, analyse, commit, typeHistogram } from '../data/ingest.js';
import { attachAsset, listAssets, getAsset } from '../assets/store.js';
import { TYPE_LABEL } from '../lib/format.js';

const state = { analysis: null, assets: new Map(), messages: [] };

export default async function ingestView(host) {
  state.analysis = null;
  state.messages = [];

  const textarea = h('textarea', {
    placeholder: 'Paste the raw JSON from Gemini here.\n\nEither a bare array of questions, or\n{ "assets": {...}, "questions": [...] }',
  });

  const subjectSelect = h('select', null, ...SUBJECTS.map(s =>
    h('option', { value: s, textContent: SUBJECT_LABEL[s] })));
  subjectSelect.value = 'physics';

  const preview = h('div');
  const messages = h('div');
  const assetForm = h('div', { className: 'card' });

  const parseBtn = h('button', { textContent: 'Parse & preview' });
  const commitBtn = h('button', { textContent: 'Commit to bank', disabled: true });
  const saveBtn = h('button', { className: 'ghost', textContent: 'Save JSON as file' });

  parseBtn.addEventListener('click', async () => {
    const parsed = parsePaste(textarea.value);
    if (parsed.error) {
      state.analysis = null;
      commitBtn.disabled = true;
      render(messages, h('div', { className: 'banner err', textContent: parsed.error }));
      clear(preview);
      return;
    }
    state.analysis = await analyse(parsed.questions);
    renderMessages();
    await renderPreview();
  });

  commitBtn.addEventListener('click', async () => {
    if (!state.analysis) return;
    const missing = await unresolvedAssets(state.analysis.missingAssets);
    if (missing.length) {
      render(messages, h('div', {
        className: 'banner err',
        textContent: `Attach these assets before committing: ${missing.map(m => `${m.source} "${m.asset}"`).join(', ')}`,
      }));
      return;
    }
    const { inserted, updated } = await commit(state.analysis.records);
    render(messages, h('div', {
      className: 'banner ok',
      textContent: `Committed ${inserted} new question(s), ${updated} updated.`,
    }));
    state.analysis = null;
    commitBtn.disabled = true;
    clear(preview);
    clear(assetForm);
  });

  saveBtn.addEventListener('click', () => {
    const parsed = parsePaste(textarea.value);
    if (parsed.error) { render(messages, h('div', { className: 'banner err', textContent: parsed.error })); return; }
    const blob = new Blob([textarea.value], { type: 'application/json' });
    const a = h('a', {
      href: URL.createObjectURL(blob),
      download: `${subjectSelect.value}-questions.json`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  host.appendChild(h('h1', { textContent: 'Ingest questions' }));
  host.appendChild(h('p', { className: 'sub', textContent: 'Paste Gemini output for one subject. Figures are resolved by attaching the screenshots or PDFs the JSON references.' }));
  host.appendChild(messages);
  host.appendChild(h('div', { className: 'card' },
    h('div', { className: 'row', style: { marginBottom: '10px' } },
      h('label', { className: 'field', style: { margin: 0 } },
        h('span', { textContent: 'Subject' }), subjectSelect),
      h('span', { className: 'spacer' }),
      parseBtn, commitBtn, saveBtn),
    textarea,
    h('p', { className: 'muted', style: { marginTop: '8px', marginBottom: 0 } },
      'The subject selector is only used for the exported filename — each question carries its own subject field, and validation enforces it.')));
  host.appendChild(assetForm);
  host.appendChild(preview);

  await renderAssetForm(assetForm);
  renderMessages();

  function renderMessages() {
    clear(messages);
    for (const m of state.messages) messages.appendChild(m);
  }

  async function renderPreview() {
    clear(preview);
    clear(assetForm);
    const a = state.analysis;
    if (!a) return;

    const issues = h('div');
    if (a.invalid.length) {
      issues.appendChild(h('div', { className: 'banner err' },
        h('strong', { textContent: `${a.invalid.length} question(s) failed validation` })));
      for (const bad of a.invalid.slice(0, 40)) {
        issues.appendChild(h('div', { style: { marginBottom: '6px' } },
          h('div', { textContent: `#${bad.index + 1} ${bad.id || '(no id)'}` }),
          h('ul', { style: { margin: '2px 0 0 18px', color: '#ffb4ae' } },
            bad.errors.map(e => h('li', { textContent: e })))));
      }
    }
    if (a.duplicates.length) {
      issues.appendChild(h('div', { className: 'banner err' },
        h('strong', { textContent: `Duplicate ids inside this paste: ${a.duplicates.map(d => d.id).join(', ')}` })));
    }
    preview.appendChild(issues);

    preview.appendChild(h('div', { className: 'card' },
      h('h3', { textContent: 'Summary' }),
      h('div', { className: 'row' },
        h('span', { className: 'tag', textContent: `${a.records.length} valid` }),
        ...typeHistogram(a.records).map(([t, n]) =>
          h('span', { className: 'tag', textContent: `${TYPE_LABEL[t] || t}: ${n}` })),
        h('span', { className: 'tag', textContent: `${a.updates.length} will update existing` }))));

    // a.missingAssets lists every referenced asset; filter to the ones that
    // are genuinely not attached yet.
    const stillMissing = await unresolvedAssets(a.missingAssets);
    if (!stillMissing.length) {
      preview.appendChild(h('div', { className: 'banner ok', textContent: 'All figure assets referenced by these questions are already attached.' }));
    } else {
      preview.appendChild(h('div', { className: 'banner err' },
        h('strong', { textContent: `Attach ${stillMissing.length} asset(s) to commit:` })));
      await renderAssetForm(assetForm, stillMissing);
    }

    if (a.records.length) {
      preview.appendChild(h('div', { className: 'card scroll' },
        h('table', null,
          h('thead', null, h('tr', null,
            h('th', { textContent: 'id' }), h('th', { textContent: 'subject' }),
            h('th', { textContent: 'type' }), h('th', { textContent: 'paper/section' }),
            h('th', { textContent: 'chapter' }), h('th', { className: 'num', textContent: 'qElo' }),
            h('th', { textContent: 'assets' }))),
          h('tbody', null, a.records.map(q => h('tr', null,
            h('td', { textContent: q.id }),
            h('td', { textContent: q.subject }),
            h('td', { textContent: q.type }),
            h('td', { textContent: `${q.paperHint ?? '—'}/${q.sectionHint ?? '—'}` }),
            h('td', { textContent: q.chapter }),
            h('td', { className: 'num', textContent: String(q.qElo) }),
            h('td', { textContent: collectAssets(q).join(' ') || '—' })))))));
    }

    commitBtn.disabled = !a.ok;
  }

  async function renderAssetForm(container, wanted = null) {
    clear(container);
    container.appendChild(h('h2', { textContent: wanted ? 'Attach referenced assets' : 'Attach an asset' }));
    const existing = await listAssets();
    if (existing.length) {
      container.appendChild(h('div', { className: 'row', style: { marginBottom: '10px' } },
        existing.map(a => h('span', { className: 'tag', textContent: `${a.tag} (${a.kind})` }))));
    }
    const list = h('div');
    container.appendChild(list);

    if (wanted) {
      for (const ref of wanted) {
        const [source, asset] = ref.split(':');
        const input = h('input', { type: 'file', accept: source === 'pdf' ? 'application/pdf' : 'image/*' });
        input.addEventListener('change', async () => {
          const file = input.files && input.files[0];
          if (!file) return;
          try {
            await attachAsset(asset, file);
            await renderAssetForm(container, await unresolvedAssets(wanted));
            if (state.analysis) await renderPreview();
          } catch (err) {
            container.appendChild(h('div', { className: 'banner err', textContent: err.message }));
          }
        });
        list.appendChild(h('div', { className: 'row', style: { marginBottom: '8px' } },
          h('span', { style: { width: '150px' }, textContent: `${asset} (${source})` }), input));
      }
    } else {
      const tagInput = h('input', { placeholder: 'tag, e.g. a1 or p1' });
      const fileInput = h('input', { type: 'file', accept: 'image/*,application/pdf' });
      list.appendChild(h('div', { className: 'row' },
        tagInput,
        fileInput,
        h('button', {
          className: 'ghost', textContent: 'Attach',
          onClick: async () => {
            const tag = tagInput.value.trim();
            const file = fileInput.files && fileInput.files[0];
            if (!tag || !file) return;
            try {
              await attachAsset(tag, file);
              await renderAssetForm(container);
            } catch (err) {
              container.appendChild(h('div', { className: 'banner err', textContent: err.message }));
            }
          },
        })));
    }
  }
}

function collectAssets(q) {
  const tags = new Set();
  const push = f => { if (f && f.asset) tags.add(f.asset); };
  push(q.figure); push(q.solutionFigure);
  for (const f of Object.values(q.optionFigures || {})) push(f);
  return [...tags];
}

async function unresolvedAssets(refs) {
  const out = [];
  for (const ref of refs) {
    const asset = ref.split(':')[1];
    if (!await getAsset(asset)) out.push(ref);
  }
  return out;
}

function render(el, ...children) { clear(el); for (const c of children) if (c) el.appendChild(c); }