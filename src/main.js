import { openDb } from './db.js';
import { route, setNotFound, resolve, onNavigate } from './router.js';
import { h } from './lib/dom.js';

import tests from './views/tests.js';
import newtest from './views/newtest.js';
import runner from './views/runner.js';
import results from './views/results.js';
import history from './views/history.js';

const NAV = [
  ['#/tests', 'Tests'],
  ['#/history', 'History'],
];

function buildNav() {
  const nav = document.getElementById('topnav');
  nav.textContent = '';
  nav.appendChild(h('span', { className: 'brand', textContent: 'MockCracking' }));
  for (const [href, label] of NAV) nav.appendChild(h('a', { href, textContent: label }));
}

async function boot() {
  if (!window.katex) {
    document.getElementById('view').textContent = 'KaTeX failed to load from ./vendor/katex/ — re-vendor it.';
    return;
  }
  await openDb();
  buildNav();

  route('/tests', tests);
  route('/new', newtest);
  route('/exam/:attemptId', runner);
  route('/result/:attemptId', results);
  route('/history', history);

  // Backward compatibility redirects for old URLs
  route('/dashboard', () => location.hash = '/history');
  route('/bank', () => location.hash = '/tests');
  route('/ingest', () => location.hash = '/new');
  route('/build', () => location.hash = '/tests');

  setNotFound(host => {
    host.appendChild(h('div', { className: 'empty', textContent: 'Page not found.' }));
  });

  onNavigate();
  await resolve();
}

boot();