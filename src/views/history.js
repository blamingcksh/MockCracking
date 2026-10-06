import { h, svg } from '../lib/dom.js';
import { SUBJECT_LABEL, TYPE_LABEL, pct, dateTime, clock, DIFFICULTIES } from '../lib/format.js';
import { getAll, getProfile } from '../db.js';
import { listAttempts } from '../data/attempts.js';
import { chapterTable, bandFor } from '../rating/elo.js';
import { navigate } from '../router.js';

export default async function historyView(host) {
  const [profile, questions, allAttempts] = await Promise.all([
    getProfile(), getAll('questions'), listAttempts(),
  ]);
  const byId = new Map(questions.map(q => [q.id, q]));
  const submitted = allAttempts
    .filter(a => a.status === 'submitted')
    .sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
  const chapters = await chapterTable();

  host.appendChild(h('h1', { textContent: 'History & analytics' }));
  host.appendChild(h('p', {
    className: 'sub',
    textContent: submitted.length
      ? `${submitted.length} submitted attempt(s) across your tests`
      : 'No submitted attempts yet. Schedule a test and sit it to start tracking.',
  }));

  // Top Section: Table of All Test Attempts
  host.appendChild(card('All test attempts', attemptList(allAttempts)));

  if (submitted.length) {
    host.appendChild(statRow(profile, submitted, questions));
    if (submitted.length >= 2) host.appendChild(card('Score trend', trendChart(submitted)));
    host.appendChild(card('Subject marks', aggregateBars(submitted, 'subject')));
    host.appendChild(card('Marks by question type', aggregateBars(submitted, 'type')));
    host.appendChild(card('Accuracy by model difficulty', difficultyBars(submitted, byId)));
    host.appendChild(card('Pace — time spent vs target', paceCard(submitted, questions)));
    host.appendChild(card('Chapter breakdown', chapterTableView(chapters, profile)));
    host.appendChild(card('Where to work next', focusPanel(chapters)));
  }
}

function card(title, body) {
  return h('div', { className: 'card' }, h('h2', { textContent: title }), body);
}

function stat(label, value, sub) {
  return h('div', { className: 'stat' },
    h('div', { className: 'label', textContent: label }),
    h('div', { className: 'value', textContent: value }),
    sub ? h('div', { className: 'delta muted', textContent: sub }) : null);
}

function statRow(profile, submitted, questions) {
  const row = h('div', { className: 'stat-row' });
  const latest = submitted[submitted.length - 1];
  const prev = submitted[submitted.length - 2];

  row.appendChild(stat('Ability', profile.ability.toFixed(0), bandFor(profile.ability)));

  if (latest) {
    const delta = prev ? latest.totalScore - prev.totalScore : null;
    row.appendChild(stat('Latest score', `${latest.totalScore}/${latest.maxScore}`,
      delta === null ? dateTime(latest.submittedAt) : `${delta > 0 ? '+' : ''}${delta} vs previous`));
  } else {
    row.appendChild(stat('Latest score', '—', 'no submitted attempt'));
  }

  const totalScore = submitted.reduce((n, a) => n + (a.totalScore || 0), 0);
  const totalMax = submitted.reduce((n, a) => n + (a.maxScore || 0), 0);
  row.appendChild(stat('Attempts', String(submitted.length),
    totalMax ? `average ${pct(totalScore, totalMax)}` : ''));
  row.appendChild(stat('Questions seen', String(questions.filter(q => (q.seenCount || 0) > 0).length), `${questions.length} in active tests`));
  row.appendChild(stat('Chapters tracked', String(Object.keys(profile.chapterAbility || {}).length), 'per-chapter ability'));
  return row;
}

function trendChart(attempts) {
  const W = 900;
  const H = 210;
  const pad = { l: 46, r: 16, t: 14, b: 30 };
  const points = attempts.map(a => ({ pct: a.maxScore ? a.totalScore / a.maxScore : 0 }));
  const maxPct = Math.max(0.25, ...points.map(p => p.pct));
  const x = i => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = p => pad.t + (1 - p / maxPct) * (H - pad.t - pad.b);

  const g = svg('svg', { class: 'trend', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' });
  const defs = svg('defs');
  const grad = svg('linearGradient', { id: 'trendFill', x1: '0', y1: '0', x2: '0', y2: '1' });
  grad.appendChild(svg('stop', { offset: '0%', 'stop-color': '#6d7cff', 'stop-opacity': '0.26' }));
  grad.appendChild(svg('stop', { offset: '100%', 'stop-color': '#6d7cff', 'stop-opacity': '0' }));
  defs.appendChild(grad);
  g.appendChild(defs);
  for (let k = 0; k <= 4; k++) {
    const val = (maxPct * k) / 4;
    const yy = y(val);
    g.appendChild(svg('line', { class: 'axis', x1: pad.l, y1: yy, x2: W - pad.r, y2: yy }));
    const label = svg('text', { class: 'pt-label', x: 6, y: yy + 3 });
    label.textContent = `${Math.round(val * 100)}%`;
    g.appendChild(label);
  }
  const linePath = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.pct)}`).join(' ');
  const base = H - pad.b;
  g.appendChild(svg('path', {
    class: 'area',
    d: `${linePath} L${x(points.length - 1)},${base} L${x(0)},${base} Z`,
  }));
  g.appendChild(svg('path', { class: 'line', d: linePath }));
  points.forEach((p, i) => {
    g.appendChild(svg('circle', { class: 'pt', cx: x(i), cy: y(p.pct), r: 4 }));
    const t = svg('text', { class: 'pt-label', x: x(i) - 6, y: H - 8 });
    t.textContent = `#${i + 1}`;
    g.appendChild(t);
  });

  return h('div', null, g,
    h('p', { className: 'muted', textContent: 'Percentage of available marks, per submitted attempt in chronological order.' }));
}

function aggregateBars(attempts, mode) {
  const acc = new Map();
  for (const a of attempts) {
    for (const spec of a.slotSpecs || []) {
      const key = mode === 'subject' ? spec.subject : spec.type;
      const cur = acc.get(key) || { score: 0, max: 0 };
      const p = (a.perSlot || {})[spec.key] || { score: 0, max: 0 };
      cur.score += p.score;
      cur.max += p.max;
      acc.set(key, cur);
    }
  }
  const label = mode === 'subject'
    ? k => SUBJECT_LABEL[k] || k
    : k => TYPE_LABEL[k] || k;
  return barList([...acc.entries()].map(([k, v]) => ({
    label: label(k), value: v.score, max: v.max, pct: v.max ? v.score / v.max : 0,
  })));
}

function difficultyBars(attempts, byId) {
  const acc = new Map();
  for (const a of attempts) {
    for (const [qid, r] of Object.entries(a.scoresByQuestion || {})) {
      const d = (byId.get(qid) || {}).difficulty;
      if (!d) continue;
      const cur = acc.get(d) || { score: 0, max: 0 };
      cur.score += r.marks;
      cur.max += r.max;
      acc.set(d, cur);
    }
  }
  const rows = DIFFICULTIES.filter(d => acc.has(d)).map(d => {
    const v = acc.get(d);
    return { label: d, value: v.score, max: v.max, pct: v.max ? v.score / v.max : 0 };
  });
  return barList(rows);
}

function barList(rows) {
  if (!rows.length) return h('div', { className: 'empty', textContent: 'No data yet.' });
  const wrap = h('div');
  for (const r of rows) {
    const ratio = Math.max(0, Math.min(1, r.pct));
    wrap.appendChild(h('div', { className: 'bar-row' },
      h('div', { textContent: r.label }),
      h('div', { className: 'bar-track' },
        h('div', {
          className: `bar-fill${ratio >= 0.6 ? ' good' : ratio < 0.3 ? ' bad' : ''}`,
          style: { width: `${ratio * 100}%` },
        })),
      h('div', { className: 'bar-val', textContent: `${r.value}/${r.max}` })));
  }
  return wrap;
}

function paceCard(attempts, questions) {
  const targets = new Map(questions.map(q => [q.id, (q.targetTimeMins || 0) * 60]));
  let spent = 0;
  let target = 0;
  let count = 0;
  let over = 0;
  for (const a of attempts) {
    for (const [qid, r] of Object.entries(a.scoresByQuestion || {})) {
      const t = targets.get(qid) || 0;
      spent += r.seconds || 0;
      target += t;
      count += 1;
      if (t && (r.seconds || 0) > t * 1.5) over += 1;
    }
  }
  const wrap = h('div');
  wrap.appendChild(h('div', { className: 'row' },
    h('span', { className: 'tag', textContent: `avg ${clock(count ? spent / count : 0)} per question` }),
    h('span', { className: 'tag', textContent: `target avg ${clock(count ? target / count : 0)}` }),
    h('span', { className: 'tag', textContent: `${over} question(s) over 1.5× target` })));
  wrap.appendChild(h('p', { className: 'muted', textContent: 'Time runs from first interaction with a question to submission, so it includes thinking away from it.' }));
  return wrap;
}

function chapterTableView(chapters, profile) {
  const attempted = chapters.filter(c => c.attempts > 0);
  if (!attempted.length) return h('div', { className: 'empty', textContent: 'No chapter attempts yet.' });
  const body = h('tbody');
  for (const c of attempted) {
    const ability = c.ability;
    const delta = ability === undefined ? null : ability - profile.ability;
    const cls = delta === null ? '' : delta < -40 ? 'bad' : delta > 40 ? 'good' : '';
    body.appendChild(h('tr', null,
      h('td', null, h('span', { className: 'chapter-name', textContent: c.chapter })),
      h('td', { textContent: SUBJECT_LABEL[c.subject] || c.subject }),
      h('td', { className: 'num', textContent: String(c.attempts) }),
      h('td', { className: 'num', textContent: pct(c.correct, c.attempts) }),
      h('td', { className: 'num', textContent: `${c.marksEarned}/${c.marksPossible}` }),
      h('td', { className: 'num', textContent: ability === undefined ? '—' : ability.toFixed(0) }),
      h('td', { className: `num ${cls}`, textContent: delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}` }),
      h('td', { className: 'num', textContent: c.targetSeconds ? clock(c.seconds / c.attempts) : '—' }),
      h('td', { className: 'num', textContent: c.targetSeconds ? clock(c.targetSeconds / c.attempts) : '—' })));
  }
  return h('div', { className: 'scroll' },
    h('table', null,
      h('thead', null, h('tr', null,
        h('th', { textContent: 'chapter' }), h('th', { textContent: 'subject' }),
        h('th', { className: 'num', textContent: 'attempts' }), h('th', { className: 'num', textContent: 'solved' }),
        h('th', { className: 'num', textContent: 'marks' }), h('th', { className: 'num', textContent: 'ability' }),
        h('th', { className: 'num', textContent: 'vs you' }),
        h('th', { className: 'num', textContent: 'avg time' }), h('th', { className: 'num', textContent: 'target' }))),
      body));
}

function focusPanel(chapters) {
  const weak = chapters.filter(c => c.attempts >= 5).slice(0, 5);
  if (!weak.length) {
    return h('div', { className: 'empty', textContent: 'Needs at least 5 attempts in a chapter before it appears here.' });
  }
  const wrap = h('div', { className: 'focus-list' });
  for (const c of weak) {
    wrap.appendChild(h('div', { className: 'focus-item' },
      h('div', null,
        h('div', { textContent: c.chapter }),
        h('div', { className: 'subj', textContent: `${SUBJECT_LABEL[c.subject]} · ${c.attempts} attempts · ${pct(c.correct, c.attempts)} solved` })),
      h('div', { style: { textAlign: 'right' } },
        h('div', { textContent: c.ability === undefined ? '—' : c.ability.toFixed(0) }),
        h('div', { className: 'subj', textContent: 'ability' }))));
  }
  return wrap;
}

function attemptList(all) {
  if (!all.length) return h('div', { className: 'empty', textContent: 'No attempts taken yet.' });
  const body = h('tbody');
  for (const a of all) {
    body.appendChild(h('tr', null,
      h('td', { textContent: a.name }),
      h('td', { textContent: a.status === 'submitted' ? 'Submitted' : 'In progress' }),
      h('td', { className: 'num', textContent: a.totalScore === null ? '—' : `${a.totalScore}/${a.maxScore}` }),
      h('td', { textContent: a.status === 'submitted' ? pct(a.totalScore, a.maxScore) : '—' }),
      h('td', { textContent: dateTime(a.submittedAt || a.startedAt) }),
      h('td', null, h('button', {
        className: a.status === 'submitted' ? 'ghost' : 'active',
        textContent: a.status === 'submitted' ? 'View analysis' : 'Resume',
        onClick: () => navigate(a.status === 'submitted' ? `/result/${a.id}` : `/exam/${a.id}`),
      }))));
  }
  return h('div', { className: 'scroll' },
    h('table', null,
      h('thead', null, h('tr', null,
        h('th', { textContent: 'Test / Paper' }), h('th', { textContent: 'Status' }),
        h('th', { className: 'num', textContent: 'Score' }), h('th', { textContent: '%' }),
        h('th', { textContent: 'When' }), h('th', null))),
      body));
}
