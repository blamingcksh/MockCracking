import { h, clear } from '../lib/dom.js';
import { parsePaste, analyse } from '../data/ingest.js';
import { extractFigureSlots, applyCrops } from '../data/figslots.js';
import { deriveSpecFromUpload, createTestsFromUpload } from '../data/tests.js';
import { attachAsset } from '../assets/store.js';
import { openCropper } from './cropper.js';
import { navigate } from '../router.js';

export default async function newTestView(host) {
  host.appendChild(h('div', { className: 'row', style: { marginBottom: '16px', alignItems: 'center' } },
    h('div', null,
      h('h1', { textContent: 'New test' }),
      h('p', { className: 'sub', textContent: 'Paste the JSON from the Gemini parser prompt. If diagrams are present, upload the exam PDF to crop them in order.' })),
    h('span', { className: 'grow' }),
    h('button', { className: 'ghost', textContent: '← Cancel', onClick: () => navigate('/tests') })));

  const state = {
    analysis: null,
    rawQuestions: [],
    slots: [],
    slotsErrors: [],
    slotsWarnings: [],
    crops: {},
    pdfFile: null,
    papers: [],
    scheduleConfigs: {},
  };

  const nameInput = h('input', {
    placeholder: 'Test title (e.g. JEE Advanced 2025 Mock 1)',
    value: 'JEE Test',
    style: { width: '100%', fontSize: '16px', padding: '10px 12px' },
  });

  const textarea = h('textarea', {
    placeholder: 'Paste Gemini questions JSON here (array of questions or { "questions": [...] })...',
    style: { minHeight: '220px', fontFamily: 'monospace', fontSize: '13px' },
  });

  const summaryBox = h('div');
  const figureCard = h('div', { className: 'card', style: { display: 'none', marginTop: '16px' } });
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
      h('span', { textContent: 'Question paper JSON (from Gemini prompt)' }),
      textarea),
    summaryBox);

  host.appendChild(mainCard);
  host.appendChild(figureCard);
  host.appendChild(scheduleBox);
  host.appendChild(actionRow);

  textarea.addEventListener('input', debounce(processInput, 300));
  textarea.addEventListener('blur', processInput);

  function updateCreateDisabled() {
    const baseOk = !!(state.analysis && state.analysis.ok && state.papers.length && state.slotsErrors.length === 0);
    if (!baseOk) {
      createBtn.disabled = true;
      return;
    }
    if (state.slots.length > 0) {
      createBtn.disabled = !state.pdfFile;
    } else {
      createBtn.disabled = false;
    }
  }

  async function processInput() {
    const raw = textarea.value.trim();
    if (!raw) {
      state.analysis = null;
      state.rawQuestions = [];
      state.slots = [];
      state.slotsErrors = [];
      state.slotsWarnings = [];
      state.crops = {};
      state.pdfFile = null;
      state.papers = [];
      clear(summaryBox);
      figureCard.style.display = 'none';
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
      figureCard.style.display = 'none';
      clear(scheduleBox);
      return;
    }

    state.rawQuestions = parsed.questions;

    // Check figure slots
    const slotRes = extractFigureSlots(parsed.questions);
    state.slots = slotRes.slots;
    state.slotsErrors = slotRes.errors;
    state.slotsWarnings = slotRes.warnings;

    // Schema and placement analysis
    const a = await analyse(parsed.questions);
    state.analysis = a;

    if (!a.ok || state.slotsErrors.length > 0) {
      clear(summaryBox);
      const errs = [];
      if (a.invalid.length) errs.push(`${a.invalid.length} question(s) failed validation.`);
      if (a.duplicates.length) errs.push(`Duplicate IDs: ${a.duplicates.map(d => d.id).join(', ')}.`);
      if (state.slotsErrors.length) errs.push(`Figure code errors: ${state.slotsErrors.join('; ')}.`);
      summaryBox.appendChild(h('div', { className: 'banner err', style: { marginTop: '12px' }, textContent: errs.join(' ') }));
      createBtn.disabled = true;
      figureCard.style.display = 'none';
      clear(scheduleBox);
      return;
    }

    // Derive papers
    const { papers, unplaced } = deriveSpecFromUpload(a.records, a.placement);
    state.papers = papers;

    renderSummary(papers, unplaced);
    renderFigureSection();
    renderScheduleControls(papers);
    updateCreateDisabled();
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
    if (state.slots.length > 0) {
      tags.push(h('span', { className: 'tag', textContent: `${state.slots.length} diagrams (F1..F${state.slots.length})` }));
    }
    if (papers.length > 1) {
      tags.push(h('span', { className: 'tag badge-live', textContent: `${papers.length} papers detected (will create ${papers.length} tests)` }));
    }

    const wrap = h('div', { className: 'banner ok', style: { marginTop: '14px' } },
      h('div', { className: 'row', style: { gap: '8px' } }, ...tags));

    if (unplaced.length) {
      wrap.appendChild(h('p', { className: 'muted', style: { margin: '8px 0 0 0', color: 'var(--err)' }, textContent: `${unplaced.length} question(s) could not be placed due to missing section.` }));
    }
    if (state.slotsWarnings.length) {
      wrap.appendChild(h('p', { className: 'muted', style: { margin: '8px 0 0 0', color: 'var(--warn)' }, textContent: state.slotsWarnings.join(' ') }));
    }
    summaryBox.appendChild(wrap);
  }

  function renderFigureSection() {
    clear(figureCard);
    if (!state.slots.length) {
      figureCard.style.display = 'none';
      return;
    }

    figureCard.style.display = 'block';

    const uniqueQids = new Set(state.slots.map(s => s.qid));
    figureCard.appendChild(h('h3', { textContent: `Diagrams & Figures (${state.slots.length} detected across ${uniqueQids.size} questions)` }));
    figureCard.appendChild(h('p', {
      className: 'muted',
      textContent: 'Attach the exam PDF to crop each diagram in sequence (F1, F2...). The full-screen cropper will guide you through them automatically.',
    }));

    const fileInput = h('input', {
      type: 'file',
      accept: 'application/pdf',
      style: { marginTop: '12px' },
    });

    const statusBox = h('div', { style: { marginTop: '12px' } });

    function updateStatusBox() {
      clear(statusBox);
      if (!state.pdfFile) {
        statusBox.appendChild(h('p', { className: 'muted', textContent: 'Please choose the exam PDF file above.' }));
        return;
      }

      const croppedCount = Object.keys(state.crops).length;
      const total = state.slots.length;
      const isComplete = croppedCount >= total;

      const infoRow = h('div', { className: 'row', style: { alignItems: 'center', gap: '12px' } },
        h('span', {
          className: isComplete ? 'tag badge-live' : 'tag',
          textContent: `✓ PDF: ${state.pdfFile.name} (${croppedCount}/${total} cropped)`,
        }),
        h('button', {
          className: isComplete ? 'ghost' : 'active',
          textContent: isComplete ? 'Re-open cropper' : 'Open cropper to crop diagrams',
          onClick: launchCropper,
        }));

      statusBox.appendChild(infoRow);
    }

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      state.pdfFile = file;
      updateStatusBox();
      updateCreateDisabled();

      // Launch cropper automatically on file select
      await launchCropper();
    });

    figureCard.appendChild(fileInput);
    figureCard.appendChild(statusBox);
    updateStatusBox();
  }

  async function launchCropper() {
    if (!state.pdfFile || !state.slots.length) return;
    const res = await openCropper({
      pdfBlob: state.pdfFile,
      slots: state.slots,
      initialCrops: state.crops,
    });

    if (res && res.crops) {
      state.crops = res.crops;
    }
    renderFigureSection();
    updateCreateDisabled();
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
    if (state.slots.length > 0 && !state.pdfFile) {
      alert('Please upload the test PDF before creating the test.');
      return;
    }

    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';

    try {
      let finalRecords = state.analysis.records;

      if (state.slots.length > 0 && state.pdfFile) {
        // Unique asset tag per test to avoid collision across tests
        const assetTag = `pdf-${Date.now()}`;
        await attachAsset(assetTag, state.pdfFile);
        finalRecords = applyCrops(state.analysis.records, state.slots, state.crops, assetTag);
      }

      const baseName = nameInput.value.trim() || 'JEE Test';
      await createTestsFromUpload({
        baseName,
        records: finalRecords,
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
}

function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}
