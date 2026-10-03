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
  return raw.startsWith('/') ? raw : '/dashboard';
}

export function navigate(path) {
  if (currentPath() === path) return resolve();
  location.hash = path;
}

export function resolve() {
  const path = currentPath();
  const host = document.getElementById('view');
  runCleanup();

  for (const r of routes) {
    const m = r.regex.exec(path);
    if (!m) continue;
    const params = {};
    r.names.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
    host.textContent = '';
    r.handler(host, params);
    paintNav(path);
    return { path, params, handler: r.handler };
  }

  host.textContent = '';
  notFound(host);
  paintNav(path);
  return { path, params: {}, handler: notFound };
}

export function onNavigate(fn) {
  window.addEventListener('hashchange', () => { const r = resolve(); if (fn) fn(r); });
}

function paintNav(path) {
  for (const a of document.querySelectorAll('#topnav a')) {
    const href = a.getAttribute('href') || '';
    const target = href.replace(/^#/, '');
    const active = target === path
      || (target !== '/dashboard' && path.startsWith(target))
      || (target === '/dashboard' && path === '/dashboard');
    a.classList.toggle('active', active);
  }
}