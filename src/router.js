const routes = [];
let notFound = () => null;

// Views that own timers or listeners register a cleanup callback. The router
// runs it before mounting the next view, so nothing keeps running after the
// user navigates away.
let activeCleanup = null;

export function setCleanup(fn) {
  activeCleanup = fn;
}

function runCleanup() {
  if (!activeCleanup) return;
  const fn = activeCleanup;
  activeCleanup = null;
  try { fn(); } catch (err) { console.error('view cleanup failed', err); }
}

export function route(pattern, handler) {
  // "/exam/:attemptId" -> /^\/exam\/([^/]+)$/
  const names = [];
  const source = pattern.replace(/:[A-Za-z0-9_]+/g, match => {
    names.push(match.slice(1));
    return '([^/]+)';
  });
  routes.push({ regex: new RegExp(`^${source}$`), names, handler });
}

export function setNotFound(handler) { notFound = handler; }

export function currentPath() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw.startsWith('/')) {
    location.hash = '#/tests';
    return '/tests';
  }
  return raw;
}

export async function navigate(path) {
  if (currentPath() === path) return resolve();
  location.hash = path;
}

export async function resolve() {
  const path = currentPath();
  const host = document.getElementById('view');
  runCleanup();

  for (const r of routes) {
    const m = r.regex.exec(path);
    if (!m) continue;
    const params = {};
    r.names.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
    host.textContent = '';
    paintNav(path);
    try {
      await r.handler(host, params);
    } catch (err) {
      console.error(`Error rendering route "${path}":`, err);
      host.innerHTML = `
        <div class="card" style="margin: 24px auto; max-width: 640px; border-color: var(--bad); padding: 24px;">
          <h2 style="color: var(--bad); margin-top: 0;">Error loading page (${path})</h2>
          <p style="color: var(--text-2); font-size: 14px;">${err.message}</p>
          <pre style="background: rgba(0,0,0,0.5); padding: 12px; border-radius: 6px; font-size: 12px; overflow: auto; color: var(--text);">${err.stack || err}</pre>
          <div class="row" style="margin-top: 16px; gap: 8px;">
            <button class="active" onclick="location.hash='#/tests'; location.reload();">Reload Tests</button>
            <button class="ghost" onclick="location.hash='#/new'">New Test</button>
          </div>
        </div>
      `;
    }
    return { path, params, handler: r.handler };
  }

  host.textContent = '';
  paintNav(path);
  try {
    await notFound(host);
  } catch (err) {
    console.error('notFound handler failed', err);
  }
  return { path, params: {}, handler: notFound };
}

export function onNavigate(fn) {
  window.addEventListener('hashchange', async () => { const r = await resolve(); if (fn) fn(r); });
}

function paintNav(path) {
  for (const a of document.querySelectorAll('#topnav a')) {
    const href = a.getAttribute('href') || '';
    const target = href.replace(/^#/, '');
    const active = target === path
      || (target !== '/tests' && path.startsWith(target))
      || (target === '/tests' && (path === '/tests' || path === '/new'));
    a.classList.toggle('active', active);
  }
}