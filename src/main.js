import { openDb } from './db.js';
import { route, setNotFound, resolve, onNavigate } from './router.js';
import { h } from './lib/dom.js';
import { DEFAULT_ABILITY } from './rating/elo.js';

import dashboard from './views/dashboard.js';
import bank from './views/bank.js';
import ingest from './views/ingest.js';
import builder from './views/builder.js';
import runner from './views/runner.js';
import results from './views/results.js';
import review from './views/review.js';

const NAV = [
  ['#/dashboard', 'Dashboard'],
  ['#/bank', 'Question bank'],
  ['#/ingest', 'Ingest'],
  ['#/build', 'Papers'],
];

function buildNav() {
  const nav = document.getElementById('topnav');
  nav.textContent = '';
  nav.appendChild(h('span', { className: 'brand', textContent: 'MockCracking' }));
  for (const [href, label] of NAV) nav.appendChild(h('a', { href, textContent: label }));
  nav.appendChild(h('span', { className: 'spacer' }));
  nav.appendChild(h('a', { href: '#/assets', className: 'ghost', textContent: 'Assets' }));
}

async function boot() {
  if (!window.katex) {
    document.getElementById('view').textContent = 'KaTeX failed to load from ./vendor/katex/ — re-vendor it.';
    return;
  }
  await openDb();
  buildNav();

  route('/dashboard', dashboard);
  route('/bank', bank);
  route('/ingest', ingest);
  route('/assets', assetsView);
  route('/build', builder);
  route('/build/:paperId', builder);
  route('/exam/:attemptId', runner);
  route('/result/:attemptId', results);
  route('/review/:attemptId', review);
  setNotFound(host => {
    host.appendChild(h('div', { className: 'empty', textContent: 'Page not found.' }));
  });

  onNavigate();
  await resolve();
}

async function assetsView(host) {
  const { listAssets, deleteAsset } = await import('./assets/store.js');
  const { getAll } = await import('./db.js');
  const assets = await listAssets();
  const questions = await getAll('questions');

  host.appendChild(h('h1', { textContent: 'Figure assets' }));
  host.appendChild(h('p', { className: 'sub', textContent: 'Screenshots and PDFs that question crops point at. Tags are referenced by the ingested JSON.' }));

  if (!assets.length) {
    host.appendChild(h('div', { className: 'empty', textContent: 'No assets yet. Attach them during ingest.' }));
    return;
  }

  const table = h('table', null,
    h('thead', null, h('tr', null,
      h('th', { textContent: 'Tag' }), h('th', { textContent: 'Kind' }),
      h('th', { textContent: 'File' }), h('th', { textContent: 'Pages / size' }),
      h('th', { textContent: 'Used by' }), h('th', null))),
    h('tbody', null, assets.map(a => {
      const users = questions.filter(q => JSON.stringify([q.figure, q.solutionFigure, q.optionFigures || {}]).includes(`"${a.tag}"`));
      return h('tr', null,
        h('td', { textContent: a.tag }),
        h('td', { textContent: a.kind }),
        h('td', { textContent: a.name || '—' }),
        h('td', { textContent: a.kind === 'pdf' ? `${a.pageCount} pages` : (a.pageCount || '—') }),
        h('td', { textContent: String(users.length) }),
        h('td', null, h('button', {
          className: 'ghost', textContent: 'Delete',
          onClick: () => {
            if (users.length) {
              alert(`${users.length} question(s) still reference "${a.tag}".`);
              return;
            }
            deleteAsset(a.tag).then(() => resolve());
          },
        })));
    })));
  host.appendChild(h('div', { className: 'card scroll' }, table));
  host.appendChild(h('p', { className: 'muted', textContent: `Starting ability is ${DEFAULT_ABILITY}.` }));
}

boot();