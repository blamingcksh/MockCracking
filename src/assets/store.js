import { getAll, put, remove, get } from '../db.js';
import { clearFigureCache } from './figure.js';

export async function putAsset(asset) {
  await put('assets', asset);
  return asset;
}

export function getAsset(tag) {
  return get('assets', tag);
}

export async function listAssets() {
  const rows = await getAll('assets');
  return rows.sort((a, b) => a.tag.localeCompare(b.tag));
}

export async function deleteAsset(tag) {
  // Cached page canvases hold rendered pixels of a PDF we no longer own.
  clearFigureCache(tag);
  await remove('assets', tag);
}

export function assetKey(figure) {
  return `${figure.source}:${figure.asset}`;
}

// Accepts a screenshot/photo or a PDF, tags it, and records page count for PDFs.
export async function attachAsset(tag, file) {
  const isPdf = file.type === 'application/pdf'
    || /\.pdf$/i.test(file.name || '');
  const blob = file.slice(0, file.size, isPdf ? 'application/pdf' : (file.type || 'application/octet-stream'));

  let pageCount = null;
  if (isPdf) {
    try {
      pageCount = await countPdfPages(blob);
    } catch (err) {
      throw new Error(`Could not read "${file.name}" as a PDF: ${err.message}`);
    }
  } else {
    pageCount = await countImagePixels(blob);
  }

  const asset = { tag, kind: isPdf ? 'pdf' : 'image', name: file.name, mime: blob.type, blob, pageCount };
  await putAsset(asset);
  return asset;
}

async function countPdfPages(blob) {
  const { pdfPageCount } = await import('./figure.js');
  return pdfPageCount(blob);
}

function countImagePixels(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(`${img.naturalWidth}×${img.naturalHeight}`); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not a readable image')); };
    img.src = url;
  });
}