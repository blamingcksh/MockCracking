// Renders mixed prose + LaTeX into a container. Text segments are inserted as
// text nodes; only the LaTeX segments are handed to KaTeX.
const MATH = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;

export function renderMath(host, source) {
  host.textContent = '';
  if (typeof source !== 'string' || source === '') return host;
  const text = source.replace(/\\text\{([^}]*)\}/g, '$1');
  let last = 0;
  let m;
  MATH.lastIndex = 0;
  while ((m = MATH.exec(text)) !== null) {
    if (m.index > last) host.appendChild(document.createTextNode(text.slice(last, m.index)));
    const display = m[1] !== undefined;
    const latex = (display ? m[1] : m[2]).trim();
    const span = document.createElement('span');
    try {
      window.katex.render(latex, span, { throwOnError: false, displayMode: display, output: 'html' });
    } catch (err) {
      span.textContent = latex;
    }
    host.appendChild(span);
    last = m.index + m[0].length;
  }
  if (last < text.length) host.appendChild(document.createTextNode(text.slice(last)));
  return host;
}

export function mathHtml(source) {
  const probe = document.createElement('div');
  renderMath(probe, source);
  return probe.innerHTML;
}