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

export async function loadPdfDocFromBlob(blob) {
  const lib = await pdf();
  return lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
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

/**
 * Calculates pixel layout for rendering single or multi-part figure crops.
 * All parts are rendered at a uniform scale and stacked vertically.
 *
 * @param {Array<{ box: {x,y,w,h}, source: {width, height} }>} partsWithSources
 * @param {number} hostWidth - Display width available in the DOM
 * @returns {{ totalWidth: number, totalHeight: number, layouts: Array }}
 */
export function calculatePartLayout(partsWithSources, hostWidth) {
  if (!partsWithSources.length || hostWidth <= 0) {
    return { totalWidth: 0, totalHeight: 0, layouts: [] };
  }

  const items = partsWithSources.map(p => {
    const srcW = p.source?.width || 1;
    const srcH = p.source?.height || 1;
    const box = p.box || { x: 0, y: 0, w: 1, h: 1 };
    const sx = Math.max(0, box.x * srcW);
    const sy = Math.max(0, box.y * srcH);
    const sw = Math.max(1, Math.min(srcW - sx, box.w * srcW));
    const sh = Math.max(1, Math.min(srcH - sy, box.h * srcH));
    return { sx, sy, sw, sh, source: p.source };
  });

  // Calculate uniform scale so line thickness and text size match across parts
  const maxSw = Math.max(...items.map(it => it.sw), 1);
  const uniformScale = hostWidth / maxSw;

  let currentY = 0;
  const layouts = items.map(it => {
    const destW = Math.round(it.sw * uniformScale);
    const destH = Math.round(it.sh * uniformScale);
    const dx = Math.round((hostWidth - destW) / 2); // Center horizontally
    const dy = currentY;
    currentY += destH;
    return {
      sx: it.sx,
      sy: it.sy,
      sw: it.sw,
      sh: it.sh,
      dx,
      dy,
      destW,
      destH,
      drawable: it.source?.drawable,
    };
  });

  return {
    totalWidth: hostWidth,
    totalHeight: Math.max(1, currentY),
    layouts,
  };
}

// Renders one cropped figure into hostEl and keeps the crop correct on resize.
// Supports single-part and multi-part (cross-page) diagrams stitched vertically.
// Returns a handle with destroy() so the runner can tear down observers.
export function renderFigure(hostEl, figure) {
  hostEl.textContent = '';
  hostEl.className = 'figure';

  const partsList = (Array.isArray(figure?.parts) && figure.parts.length > 0)
    ? figure.parts.map(p => ({
        source: figure.source || 'pdf',
        asset: figure.asset,
        page: p.page,
        box: p.box,
      }))
    : (figure && figure.box ? [figure] : []);

  if (!partsList.length) {
    hostEl.appendChild(missingBox('this question has no crop box'));
    return { destroy() {} };
  }

  let sources = null;
  let disposed = false;
  let observer = null;

  const status = document.createElement('div');
  status.className = 'figure-loading';
  status.textContent = 'loading figure…';
  hostEl.appendChild(status);

  const draw = () => {
    if (disposed || !sources || !sources.length) return;
    const width = hostEl.clientWidth;
    if (width <= 0) return;

    const partsWithSources = partsList.map((p, i) => ({
      box: p.box,
      source: sources[i],
    }));

    const { totalWidth, totalHeight, layouts } = calculatePartLayout(partsWithSources, width);
    if (totalHeight <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(totalWidth * dpr));
    canvas.height = Math.max(1, Math.round(totalHeight * dpr));
    canvas.style.width = `${totalWidth}px`;
    canvas.style.height = `${totalHeight}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    for (const lay of layouts) {
      if (lay.drawable) {
        ctx.drawImage(
          lay.drawable,
          lay.sx, lay.sy, lay.sw, lay.sh,
          lay.dx, lay.dy, lay.destW, lay.destH,
        );
      }
    }

    hostEl.textContent = '';
    hostEl.appendChild(canvas);
  };

  Promise.all(partsList.map(loadSource)).then(loadedSources => {
    if (disposed) return;
    sources = loadedSources;
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