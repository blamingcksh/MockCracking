// Minimal DOM builder. Every node is created through h(); stems come from
// pasted JSON and are untrusted, so plain text always goes via textContent.
export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'className') el.className = value;
      else if (key === 'textContent') el.textContent = String(value);
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'dataset' && typeof value === 'object') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
      else el[key] = value;
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

export function mount(el, ...children) { clear(el); append(el, children); return el; }

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  for (const child of children.flat()) if (child) el.appendChild(child);
  return el;
}

// Modal used for confirmations, warnings and the bank picker.
export function openModal(title, bodyNodes, actions = []) {
  const root = document.getElementById('modal-root');
  const close = () => clear(root);
  const footer = actions.length
    ? h('div', { className: 'row', style: { marginTop: '16px', justifyContent: 'flex-end' } },
        actions.map(a => h('button', {
          className: a.danger ? 'danger' : a.ghost ? 'ghost' : '',
          onClick: () => { if (a.keepOpen !== true) close(); if (a.onClick) a.onClick(); },
        }, a.label)))
    : null;
  mount(root, h('div', {
    className: 'modal-backdrop',
    onClick: e => { if (e.target.classList.contains('modal-backdrop')) close(); },
  }, h('div', { className: 'modal' }, h('h3', { textContent: title }), ...[].concat(bodyNodes), footer)));
  return close;
}

export function confirmModal(title, message, onYes, yesLabel = 'Confirm') {
  openModal(title, h('p', { textContent: message }), [
    { label: 'Cancel', ghost: true },
    { label: yesLabel, danger: true, onClick: onYes },
  ]);
}