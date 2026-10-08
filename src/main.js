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
  try {
    if (!window.katex) {
      document.getElementById('view').innerHTML = `
        <div class="card" style="margin: 32px auto; max-width: 600px; border-color: var(--warn); padding: 24px;">
          <h3 style="color: var(--warn); margin-top: 0;">KaTeX failed to load</h3>
          <p class="muted">KaTeX could not be loaded from ./vendor/katex/.</p>
        </div>
      `;
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
  } catch (err) {
    console.error('App initialization failed:', err);
    const view = document.getElementById('view');
    if (view) {
      view.innerHTML = `
        <div class="card" style="margin: 32px auto; max-width: 640px; border-color: var(--bad); padding: 24px;">
          <h2 style="color: var(--bad); margin-top: 0;">Failed to initialize app</h2>
          <p style="color: var(--text-2); font-size: 14px;">${err.message}</p>
          <pre style="background: rgba(0,0,0,0.5); padding: 12px; border-radius: 6px; font-size: 12px; overflow: auto; color: var(--text);">${err.stack || err}</pre>
          <button class="active" onclick="location.reload()" style="margin-top: 14px;">Reload app</button>
        </div>
      `;
    }
  }
}

boot();