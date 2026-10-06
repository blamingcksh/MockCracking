import { h, clear, openModal, confirmModal } from '../lib/dom.js';
import { clock, dateTime, pct } from '../lib/format.js';
import { listTests, deleteTest, testScheduleStatus, startTest, saveTest } from '../data/tests.js';
import { listAttempts, createAttempt } from '../data/attempts.js';
import { navigate, setCleanup, resolve } from '../router.js';

export default async function testsView(host) {
  const [tests, allAttempts] = await Promise.all([
    listTests(),
    listAttempts(),
  ]);

  host.appendChild(h('div', { className: 'row', style: { marginBottom: '16px', alignItems: 'center' } },
    h('div', null,
      h('h1', { textContent: 'Tests' }),
      h('p', { className: 'sub', textContent: 'Schedule and sit your JEE question papers.' })),
    h('span', { className: 'grow' }),
    h('button', {
      className: 'primary-action',
      textContent: '+ Upload & schedule test',
      onClick: () => navigate('/new'),
    })));

  if (!tests.length) {
    host.appendChild(h('div', { className: 'card empty-box' },
      h('h3', { textContent: 'No tests created yet' }),
      h('p', { className: 'muted', textContent: 'Upload a Gemini-parsed paper to create and schedule a test.' }),
      h('button', {
        style: { marginTop: '12px' },
        textContent: 'Upload a question paper',
        onClick: () => navigate('/new'),
      })));
    return;
  }

  const container = h('div', { className: 'tests-list' });
  host.appendChild(container);

  renderList();

  const ticker = setInterval(renderList, 1000);
  setCleanup(() => clearInterval(ticker));

  function renderList() {
    clear(container);

    for (const test of tests) {
      const attempts = allAttempts.filter(a => a.testId === test.id || a.paperId === test.id);
      const inProg = attempts.find(a => a.status === 'in_progress');
      const submitted = attempts.filter(a => a.status === 'submitted');
      const sched = testScheduleStatus(test);

      const card = h('div', { className: `card test-card ${sched.status}` });

      // Header row
      const head = h('div', { className: 'test-card-head' });
      const titleCol = h('div', null,
        h('h2', { className: 'test-title', textContent: test.name }),
        h('div', { className: 'row test-meta-tags' },
          h('span', { className: 'tag', textContent: `${test.questionCount} questions` }),
          h('span', { className: 'tag', textContent: `${test.maxMarks} marks` }),
          h('span', { className: 'tag', textContent: `${test.durationMins} mins` }),
          scheduleBadge(test, sched)));
      head.appendChild(titleCol);

      // Attempt stats row if attempts exist
      if (submitted.length) {
        const best = submitted.reduce((max, a) => Math.max(max, a.totalScore ?? 0), -Infinity);
        const latest = submitted[0];
        card.appendChild(h('div', { className: 'test-attempt-summary' },
          h('span', { className: 'muted', textContent: `Attempts: ${submitted.length}` }),
          h('span', { className: 'muted', textContent: `Best: ${best}/${test.maxMarks} (${pct(best, test.maxMarks)})` }),
          h('span', { className: 'muted', textContent: `Latest: ${latest.totalScore}/${test.maxMarks} on ${dateTime(latest.submittedAt)}` })));
      }

      // Action buttons
      const actions = h('div', { className: 'row test-card-actions' });

      if (inProg) {
        const leftSec = Math.max(0, Math.round((inProg.deadline - Date.now()) / 1000));
        actions.appendChild(h('button', {
          className: 'active',
          textContent: `Resume test (${clock(leftSec)} left)`,
          onClick: () => navigate(`/exam/${inProg.id}`),
        }));
      } else if (sched.status === 'locked') {
        actions.appendChild(h('button', {
          disabled: true,
          textContent: `Locked (starts in ${clock(Math.ceil(sched.startsInMs / 1000))})`,
        }));
      } else if (sched.status === 'window_active') {
        const lateNote = sched.lateMs > 60000 ? ` (${Math.round(sched.lateMs / 60000)}m late - time deducted)` : '';
        actions.appendChild(h('button', {
          className: 'active',
          textContent: `Start test now${lateNote}`,
          onClick: async () => {
            try {
              const attempt = await startTest(test);
              navigate(`/exam/${attempt.id}`);
            } catch (err) {
              alert(err.message);
            }
          },
        }));
      } else if (sched.status === 'expired') {
        actions.appendChild(h('button', {
          className: 'ghost',
          disabled: true,
          textContent: 'Window closed',
        }));
      } else {
        // Ready / Unscheduled
        actions.appendChild(h('button', {
          className: 'active',
          textContent: submitted.length ? 'Start another attempt' : 'Start test',
          onClick: async () => {
            try {
              const attempt = await startTest(test);
              navigate(`/exam/${attempt.id}`);
            } catch (err) {
              alert(err.message);
            }
          },
        }));
      }

      // Retake action (available if already submitted or if window expired)
      if (submitted.length || sched.status === 'expired') {
        actions.appendChild(h('button', {
          className: 'ghost',
          textContent: 'Retake',
          onClick: () => promptRetake(test),
        }));
      }

      // Reschedule option
      actions.appendChild(h('button', {
        className: 'ghost',
        textContent: 'Schedule settings',
        onClick: () => openScheduleModal(test),
      }));

      // History of attempts dropdown / button
      if (submitted.length) {
        actions.appendChild(h('button', {
          className: 'ghost',
          textContent: `View results (${submitted.length})`,
          onClick: () => openAttemptsModal(test, submitted),
        }));
      }

      actions.appendChild(h('span', { className: 'grow' }));

      // Delete
      actions.appendChild(h('button', {
        className: 'danger ghost',
        textContent: 'Delete',
        onClick: () => confirmModal('Delete test', `Delete "${test.name}" and all of its questions and attempts?`, async () => {
          await deleteTest(test.id);
          resolve();
        }),
      }));

      card.insertBefore(head, card.firstChild);
      card.appendChild(actions);
      container.appendChild(card);
    }
  }

  function scheduleBadge(test, sched) {
    if (!test.scheduleEnabled) {
      return h('span', { className: 'tag badge-unscheduled', textContent: 'Anytime' });
    }
    if (sched.status === 'locked') {
      const startsStr = new Date(sched.startsAt).toLocaleString();
      return h('span', { className: 'tag badge-locked', textContent: `Starts ${startsStr} (in ${clock(Math.ceil(sched.startsInMs / 1000))})` });
    }
    if (sched.status === 'window_active') {
      const leftStr = clock(Math.ceil(sched.remainingMs / 1000));
      return h('span', { className: 'tag badge-live', textContent: `Window active (${leftStr} left)` });
    }
    return h('span', { className: 'tag badge-expired', textContent: 'Window expired' });
  }

  function promptRetake(test) {
    const modalContent = h('div', null,
      h('p', { textContent: `Retaking "${test.name}". Choose how you would like to sit this attempt:` }),
      h('div', { className: 'row', style: { marginTop: '16px', gap: '10px' } },
        h('button', {
          textContent: 'Start now (full duration)',
          onClick: async () => {
            clear(document.getElementById('modal-root'));
            const deadline = Date.now() + (test.durationMins || 180) * 60000;
            const attempt = await createAttempt(test, test.spec, deadline);
            navigate(`/exam/${attempt.id}`);
          },
        }),
        h('button', {
          className: 'ghost',
          textContent: 'Schedule a time window',
          onClick: () => {
            clear(document.getElementById('modal-root'));
            openScheduleModal(test);
          },
        })));

    openModal(`Retake — ${test.name}`, modalContent, [{ label: 'Cancel', ghost: true }]);
  }

  function openScheduleModal(test) {
    const toggle = h('input', { type: 'checkbox', checked: !!test.scheduleEnabled });
    const localDt = test.scheduledAt
      ? new Date(test.scheduledAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      : new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

    const timeInput = h('input', { type: 'datetime-local', value: localDt });
    const durationInput = h('input', { type: 'number', min: '1', value: String(test.durationMins || 180), style: { width: '100px' } });

    const scheduleSection = h('div', { style: { display: test.scheduleEnabled ? 'block' : 'none', marginTop: '12px' } },
      h('label', { className: 'field' },
        h('span', { textContent: 'Start date & time' }),
        timeInput),
      h('p', { className: 'muted', style: { fontSize: '12px' }, textContent: 'Test is locked until start time. Starting late reduces exam time by how late you started.' }));

    toggle.addEventListener('change', () => {
      scheduleSection.style.display = toggle.checked ? 'block' : 'none';
    });

    const body = h('div', null,
      h('label', { className: 'check', style: { marginBottom: '12px', display: 'flex', alignItems: 'center' } },
        toggle,
        h('span', { style: { marginLeft: '8px', fontWeight: '500' }, textContent: 'Enable scheduled window' })),
      scheduleSection,
      h('label', { className: 'field', style: { marginTop: '12px' } },
        h('span', { textContent: 'Duration (minutes)' }),
        durationInput));

    openModal('Schedule settings', body, [
      { label: 'Cancel', ghost: true },
      {
        label: 'Save',
        onClick: async () => {
          const scheduleEnabled = toggle.checked;
          const scheduledAt = scheduleEnabled ? new Date(timeInput.value).getTime() : null;
          const durationMins = Math.max(1, Number(durationInput.value) || 180);

          test.scheduleEnabled = scheduleEnabled;
          test.scheduledAt = scheduledAt;
          test.durationMins = durationMins;
          test.spec.durationMins = durationMins;

          await saveTest(test);
          clear(document.getElementById('modal-root'));
          resolve();
        },
      },
    ]);
  }

  function openAttemptsModal(test, attempts) {
    const list = h('div', { className: 'scroll', style: { maxHeight: '350px' } },
      h('table', null,
        h('thead', null, h('tr', null,
          h('th', { textContent: 'Attempt' }),
          h('th', { className: 'num', textContent: 'Score' }),
          h('th', { textContent: '%' }),
          h('th', { textContent: 'Date' }),
          h('th', null))),
        h('tbody', null, attempts.map((a, i) => h('tr', null,
          h('td', { textContent: `#${attempts.length - i}` }),
          h('td', { className: 'num', textContent: `${a.totalScore}/${a.maxScore}` }),
          h('td', { textContent: pct(a.totalScore, a.maxScore) }),
          h('td', { textContent: dateTime(a.submittedAt) }),
          h('td', null, h('button', {
            className: 'ghost',
            textContent: 'View result',
            onClick: () => {
              clear(document.getElementById('modal-root'));
              navigate(`/result/${a.id}`);
            },
          })))))));

    openModal(`Past attempts — ${test.name}`, list, [{ label: 'Close', ghost: true }]);
  }
}
