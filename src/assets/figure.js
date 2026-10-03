import { get } from '../db.js';

// Read directly from the store to avoid a cycle with store.js, which imports
// clearFigureCache from this module.
const getAsset = tag => get('assets', tag);

let pdfjs = null;
async function pdf() {
  if (!pdfjs) {
    pdfjs = await import('../../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      '../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url,
    ).href;
  }
  return pdfjs;
}

const pdfDocs = new Map();     // tag -> Promise<PdfDocument>
const pageSources = new Map();  // `${tag}:${page}` -> Promise<source>
const imageSources = new Map(); // tag -> Promise<HTMLImageElement>

export async function pdfPageCount(blob) {
  const lib = await pdf();
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  return doc.numPages;
}

async function pdfDoc(tag) {
  if (!pdfDocs.has(tag)) {
    const asset = await getAsset(tag);
    if (!asset) throw new Error(`asset "${tag}" is not attached`);
    pdfDocs.set(tag, (async () => {
      const lib = await pdf();
      return lib.getDocument({ data: new Uint8Array(await asset.blob.arrayBuffer()) }).promise;
    })());
  }
  return pdfDocs.get(tag);
}

// A "source" is anything we can drawImage: { drawable, width, height }.
async function loadSource(figure) {
  if (figure.source === 'pdf') {
    const key = `${figure.asset}:${figure.page}`;
    if (!pageSources.has(key)) {
      pageSources.set(key, (async () => {
        const asset = await getAsset(figure.asset);
        if (!asset) throw new Error(`asset "${figure.asset}" is not attached`);
        if (Number.isInteger(figure.page) && figure.page > (asset.pageCount || 0)) {
          throw new Error(`page ${figure.page} is outside ${asset.name} (${asset.pageCount} pages)`);
        }
        const doc = await pdfDoc(figure.asset);
        const page = await doc.getPage(figure.page);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        return { drawable: canvas, width: canvas.width, height: canvas.height };
      })());
    }
    return pageSources.get(key);
  }

  if (!imageSources.has(figure.asset)) {
    imageSources.set(figure.asset, (async () => {
      const asset = await getAsset(figure.asset);
      if (!asset) throw new Error(`asset "${figure.asset}" is not attached`);
      const url = URL.createObjectURL(asset.blob);
      try {
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error(`${asset.name} is not a readable image`));
          img.src = url;
        });
        return { drawable: img, width: img.naturalWidth, height: img.naturalHeight };
      } finally {
        // The element keeps the decoded bitmap; the URL is not needed again.
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    })());
  }
  return imageSources.get(figure.asset);
}

export function clearFigureCache(tag) {
  if (!tag) {
    pageSources.clear();
    imageSources.clear();
    pdfDocs.clear();
    return;
  }
  for (const key of [...pageSources.keys()]) {
    if (key.startsWith(`${tag}:`)) pageSources.delete(key);
  }
  imageSources.delete(tag);
  pdfDocs.delete(tag);
}

function missingBox(message) {
  const el = document.createElement('div');
  el.className = 'figure-missing';
  const strong = document.createElement('strong');
  strong.textContent = 'Figure unavailable';
  const detail = document.createElement('div');
  detail.className = 'muted';
  detail.textContent = message;
  el.append(strong, detail);
  return el;
}

// Renders one cropped figure into hostEl and keeps the crop correct on resize.
// Returns a handle with destroy() so the runner can tear down observers.
export function renderFigure(hostEl, figure) {
  hostEl.textContent = '';
  hostEl.className = 'figure';

  if (!figure || !figure.box || typeof figure.box !== 'object') {
    hostEl.appendChild(missingBox('this question has no crop box'));
    return { destroy() {} };
  }

  const box = figure.box;
  let source = null;
  let disposed = false;
  let observer = null;

  const status = document.createElement('div');
  status.className = 'figure-loading';
  status.textContent = 'loading figure…';
  hostEl.appendChild(status);

  const draw = () => {
    if (disposed || !source) return;
    const width = hostEl.clientWidth;
    if (width <= 0) return;

    const scale = width / (box.w * source.width);
    const dispW = source.width * scale;
    const dispH = source.height * scale;
    const cropW = box.w * dispW;
    const cropH = box.h * dispH;
    const dpr = window.devicePixelRatio || 1;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(cropH * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${cropH}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.drawImage(source.drawable, box.x * dispW, box.y * dispH, cropW, cropH, 0, 0, width, cropH);

    hostEl.textContent = '';
    hostEl.appendChild(canvas);
  };

  loadSource(figure).then(loaded => {
    if (disposed) return;
    source = loaded;
    draw();
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => draw());
      observer.observe(hostEl);
    }
  }).catch(err => {
    if (disposed) return;
    hostEl.textContent = '';
    hostEl.appendChild(missingBox(err.message));
  });

  return {
    destroy() {
      disposed = true;
      if (observer) observer.disconnect();
    },
  };
}