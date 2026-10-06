import { h, clear } from '../lib/dom.js';
import { parsePaste, analyse } from '../data/ingest.js';
import { deriveSpecFromUpload, createTestsFromUpload } from '../data/tests.js';
import { attachAsset, getAsset } from '../assets/store.js';
import { navigate } from '../router.js';

export default async function newTestView(host) {
  host.appendChild(h('div', { className: 'row', style: { marginBottom: '16px', alignItems: 'center' } },
    h('div', null,
      h('h1', { textContent: 'New test' }),
      h('p', { className: 'sub', textContent: 'Paste your Gemini question paper JSON and set schedule options.' })),
    h('span', { className: 'grow' }),
    h('button', { className: 'ghost', textContent: '← Cancel', onClick: () => navigate('/tests') })));

  const state = {
    analysis: null,
    papers: [],
    unresolvedAssets: [],
    scheduleConfigs: {},
  };

  const nameInput = h('input', {
    placeholder: 'Test title (e.g. JEE Advanced 2025 Mock 1)',
    value: 'JEE Test',
    style: { width: '100%', fontSize: '16px', padding: '10px 12px' },
  });

  const textarea = h('textarea', {
    placeholder: 'Paste the JSON from Gemini here (array of questions or { "questions": [...] })...',
    style: { minHeight: '220px', fontFamily: 'monospace', fontSize: '13px' },
  });

  const summaryBox = h('div');
  const assetCard = h('div', { className: 'card', style: { display: 'none' } });
  const scheduleBox = h('div');
  const actionRow = h('div', { className: 'row', style: { marginTop: '20px' } });

  const createBtn = h('button', {
    className: 'active',
    textContent: 'Create & schedule test',
    disabled: true,
  });

  actionRow.appendChild(createBtn);
  actionRow.appendChild(h('button', {
    className: 'ghost',
    textContent: 'Cancel',
    onClick: () => navigate('/tests'),
  }));

  const mainCard = h('div', { className: 'card' },
    h('label', { className: 'field' },
      h('span', { textContent: 'Test name' }),
      nameInput),
    h('label', { className: 'field', style: { marginTop: '14px' } },
      h('span', { textContent: 'Question paper JSON' }),
      textarea),
    summaryBox);

  host.appendChild(mainCard);
  host.appendChild(assetCard);
  host.appendChild(scheduleBox);
  host.appendChild(actionRow);

  textarea.addEventListener('input', debounce(processInput, 300));
  textarea.addEventListener('blur', processInput);

  async function processInput() {
    const raw = textarea.value.trim();
    if (!raw) {
      state.analysis = null;
      state.papers = [];
      state.unresolvedAssets = [];
      clear(summaryBox);
      assetCard.style.display = 'none';
      clear(scheduleBox);
      createBtn.disabled = true;
      return;
    }

    const parsed = parsePaste(raw);
    if (parsed.error) {
      state.analysis = null;
      clear(summaryBox);
      summaryBox.appendChild(h('div', { className: 'banner err', style: { marginTop: '12px' }, textContent: parsed.error }));
      createBtn.disabled = true;
      assetCard.style.display = 'none';
      clear(scheduleBox);
      return;
    }

    const a = await analyse(parsed.questions);
    state.analysis = a;

    if (!a.ok) {
      clear(summaryBox);
      const errs = [];
      if (a.invalid.length) errs.push(`${a.invalid.length} question(s) failed validation.`);
      if (a.duplicates.length) errs.push(`Duplicate IDs: ${a.duplicates.map(d => d.id).join(', ')}.`);
      summaryBox.appendChild(h('div', { className: 'banner err', style: { marginTop: '12px' }, textContent: errs.join(' ') }));
      createBtn.disabled = true;
      assetCard.style.display = 'none';
      clear(scheduleBox);
      return;
    }

    const { papers, unplaced } = deriveSpecFromUpload(a.records, a.placement);
    state.papers = papers;

    // Check figure assets
    state.unresolvedAssets = await checkMissingAssets(a.missingAssets);

    renderSummary(papers, unplaced);
    await renderAssets();
    renderScheduleControls(papers);

    createBtn.disabled = !a.ok || state.unresolvedAssets.length > 0 || !papers.length;
  }

  function renderSummary(papers, unplaced) {
    clear(summaryBox);
    if (!papers.length) {
      summaryBox.appendChild(h('div', { className: 'banner err', style: { marginTop: '12px' }, textContent: 'No placed questions found in JSON.' }));
      return;
    }

    const tags = [];
    const totalQ = papers.reduce((sum, p) => sum + p.questionCount, 0);
    const totalMarks = papers.reduce((sum, p) => sum + p.maxMarks, 0);

    tags.push(h('span', { className: 'tag', textContent: `${totalQ} questions total` }));
    tags.push(h('span', { className: 'tag', textContent: `${totalMarks} marks total` }));
    if (papers.length > 1) {
      tags.push(h('span', { className: 'tag badge-live', textContent: `${papers.length} papers detected (will create ${papers.length} tests)` }));
    }

    const wrap = h('div', { className: 'banner ok', style: { marginTop: '14px' } },
      h('div', { className: 'row', style: { gap: '8px' } }, ...tags));

    if (unplaced.length) {
      wrap.appendChild(h('p', { className: 'muted', style: { margin: '8px 0 0 0', color: 'var(--err)' }, textContent: `${unplaced.length} question(s) could not be placed due to missing section.` }));
    }
    summaryBox.appendChild(wrap);
  }

  async function renderAssets() {
    clear(assetCard);
    if (!state.unresolvedAssets.length) {
      assetCard.style.display = 'none';
      return;
    }

    assetCard.style.display = 'block';
    assetCard.appendChild(h('h3', { textContent: 'Attach referenced figure assets' }));
    assetCard.appendChild(h('p', { className: 'muted', textContent: 'This paper references the following images/PDFs. Attach them to enable figures in the exam.' }));

    const list = h('div', { style: { marginTop: '12px' } });
    for (const ref of state.unresolvedAssets) {
      const [source, tag] = ref.split(':');
      const input = h('input', { type: 'file', accept: source === 'pdf' ? 'application/pdf' : 'image/*' });
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
          await attachAsset(tag, file);
          state.unresolvedAssets = await checkMissingAssets(state.analysis.missingAssets);
          await renderAssets();
          createBtn.disabled = state.unresolvedAssets.length > 0;
        } catch (err) {
          alert(`Failed to attach asset: ${err.message}`);
        }
      });
      list.appendChild(h('div', { className: 'row', style: { marginBottom: '8px', alignItems: 'center' } },
        h('strong', { style: { width: '120px' }, textContent: `${tag} (${source})` }),
        input));
    }
    assetCard.appendChild(list);
  }

  function renderScheduleControls(papers) {
    clear(scheduleBox);
    state.scheduleConfigs = {};

    for (const p of papers) {
      const defaultDuration = p.durationMins || 180;
      const card = h('div', { className: 'card', style: { marginTop: '16px' } });

      const heading = papers.length > 1
        ? h('h3', { textContent: `Schedule: ${p.label} (${p.questionCount} Qs, ${p.maxMarks} marks)` })
        : h('h3', { textContent: 'Schedule settings' });

      const toggle = h('input', { type: 'checkbox' });
      const now = new Date();
      const defaultDt = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      const timeInput = h('input', { type: 'datetime-local', value: defaultDt });
      const durationInput = h('input', { type: 'number', min: '1', value: String(defaultDuration), style: { width: '110px' } });

      const scheduleDetails = h('div', { style: { display: 'none', marginTop: '12px' } },
        h('label', { className: 'field' },
          h('span', { textContent: 'Start date & time' }),
          timeInput),
        h('p', { className: 'muted', style: { fontSize: '13px', margin: '4px 0 0 0' }, textContent: 'Test is locked until start time. Starting late deduces time from the window!' }));

      const unscheduledNote = h('p', { className: 'muted', style: { fontSize: '13px', margin: '6px 0 0 0' }, textContent: 'Schedule is OFF. Test can be attempted anytime with full duration.' });

      toggle.addEventListener('change', () => {
        const isScheduled = toggle.checked;
        scheduleDetails.style.display = isScheduled ? 'block' : 'none';
        unscheduledNote.style.display = isScheduled ? 'none' : 'block';
        state.scheduleConfigs[p.paperNumber] = {
          scheduleEnabled: isScheduled,
          scheduledAt: isScheduled ? new Date(timeInput.value).getTime() : null,
          durationMins: Math.max(1, Number(durationInput.value) || defaultDuration),
        };
      });

      timeInput.addEventListener('change', () => {
        if (state.scheduleConfigs[p.paperNumber]) {
          state.scheduleConfigs[p.paperNumber].scheduledAt = new Date(timeInput.value).getTime();
        }
      });

      durationInput.addEventListener('input', () => {
        if (state.scheduleConfigs[p.paperNumber]) {
          state.scheduleConfigs[p.paperNumber].durationMins = Math.max(1, Number(durationInput.value) || defaultDuration);
        }
      });

      state.scheduleConfigs[p.paperNumber] = {
        scheduleEnabled: false,
        scheduledAt: null,
        durationMins: defaultDuration,
      };

      card.appendChild(heading);
      card.appendChild(h('label', { className: 'check', style: { marginTop: '10px', display: 'flex', alignItems: 'center' } },
        toggle,
        h('span', { style: { marginLeft: '8px', fontWeight: '500' }, textContent: 'Enable scheduled test window (lock until date & time)' })));
      card.appendChild(scheduleDetails);
      card.appendChild(unscheduledNote);
      card.appendChild(h('label', { className: 'field', style: { marginTop: '12px' } },
        h('span', { textContent: 'Duration (minutes)' }),
        durationInput));

      scheduleBox.appendChild(card);
    }
  }

  createBtn.addEventListener('click', async () => {
    if (!state.analysis || !state.papers.length) return;
    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';

    try {
      const baseName = nameInput.value.trim() || 'JEE Test';
      const result = await createTestsFromUpload({
        baseName,
        records: state.analysis.records,
        placement: state.analysis.placement,
        schedules: state.scheduleConfigs,
      });

      navigate('/tests');
    } catch (err) {
      alert(`Could not create test: ${err.message}`);
      createBtn.disabled = false;
      createBtn.textContent = 'Create & schedule test';
    }
  });

  async function checkMissingAssets(refs) {
    const missing = [];
    for (const ref of refs) {
      const tag = ref.split(':')[1];
      const found = await getAsset(tag);
      if (!found) missing.push(ref);
    }
    return missing;
  }
}

function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}
