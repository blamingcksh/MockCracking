import { h, clear } from '../lib/dom.js';
import { loadPdfDocFromBlob } from '../assets/figure.js';

/**
 * Opens a full-screen PDF cropper allowing rapid sequential cropping of diagrams.
 * Supports cross-page diagrams (multi-part stitching) and iPad touch interactions (Pan vs Crop mode).
 *
 * @param {Object} options
 * @param {Blob} options.pdfBlob - The uploaded PDF file
 * @param {Array} options.slots - Array of figure slots from extractFigureSlots
 * @param {Object} [options.initialCrops] - Existing crop boxes map: { [code]: { page, box, parts?: Array } }
 * @returns {Promise<{ crops: Object } | null>} Resolves with crops map or null if cancelled
 */
export async function openCropper({ pdfBlob, slots = [], initialCrops = {} }) {
  if (!slots.length) {
    return { crops: {} };
  }

  // Load PDF doc
  let pdfDoc = null;
  try {
    pdfDoc = await loadPdfDocFromBlob(pdfBlob);
  } catch (err) {
    alert(`Could not load PDF: ${err.message}`);
    return null;
  }

  const numPages = pdfDoc.numPages;

  return new Promise(resolve => {
    // Normalise existing crops to include parts array
    const crops = {};
    for (const [code, val] of Object.entries(initialCrops || {})) {
      if (val && val.box) {
        crops[code] = {
          page: val.page,
          box: { ...val.box },
          parts: Array.isArray(val.parts) && val.parts.length > 0
            ? val.parts.map(p => ({ page: p.page, box: { ...p.box } }))
            : [{ page: val.page, box: { ...val.box } }],
        };
      }
    }

    const skipped = new Set();
    let currentIndex = 0;
    let zoomScale = 1.25; // Default scale for readability
    let activeMode = 'crop'; // 'crop' | 'pan'
    let isAddingPart = false; // True when user is adding a 2nd+ part to current slot

    // Find first uncropped slot
    const firstUncropped = slots.findIndex(s => !crops[s.code]);
    if (firstUncropped !== -1) currentIndex = firstUncropped;

    // DOM Elements
    const overlay = h('div', { className: 'cropper-overlay' });
    const header = h('header', { className: 'cropper-header' });
    const body = h('div', { className: 'cropper-body' });
    const scrollContainer = h('div', { className: 'cropper-scroll' });
    const sidebar = h('aside', { className: 'cropper-sidebar' });

    overlay.appendChild(header);
    body.appendChild(scrollContainer);
    body.appendChild(sidebar);
    overlay.appendChild(body);
    document.body.appendChild(overlay);

    // Keep track of page views
    const pageWraps = new Map(); // pageNum -> { wrap, canvas, overlay, rendered: boolean, viewport, page }

    // Header sub-elements
    const infoSlotCode = h('span', { className: 'cropper-badge' });
    const infoQTitle = h('strong', { className: 'cropper-q-title' });
    const infoTarget = h('span', { className: 'cropper-tag' });
    const infoPartsPill = h('span', { className: 'cropper-parts-pill', style: { display: 'none' } });
    const btnAddPart = h('button', { className: 'cropper-btn-addpart', textContent: '+ Add Part (cross-page)' });
    const infoPartMode = h('span', { className: 'cropper-part-mode-banner', style: { display: 'none' } });
    const infoDesc = h('span', { className: 'cropper-desc' });
    const infoPageHint = h('span', { className: 'cropper-hint' });

    // Mode toggle buttons (Touch friendly for iPad)
    const btnModeCrop = h('button', { className: 'cropper-mode-btn active', textContent: '✂️ Crop', title: 'Draw crop box on page' });
    const btnModePan = h('button', { className: 'cropper-mode-btn', textContent: '✋ Pan', title: 'Pan / scroll PDF without drawing' });
    const modeToggle = h('div', { className: 'cropper-mode-toggle' }, btnModeCrop, btnModePan);

    const btnUndo = h('button', { className: 'ghost small', textContent: 'Undo (Z)', title: 'Undo last crop' });
    const btnSkip = h('button', { className: 'ghost small', textContent: 'Skip (S)', title: 'Skip this figure' });
    const btnPrev = h('button', { className: 'ghost small', textContent: '← Prev', title: 'Previous diagram' });
    const btnNext = h('button', { className: 'ghost small', textContent: 'Next →', title: 'Next diagram' });

    const btnZoomOut = h('button', { className: 'ghost small', textContent: '−', title: 'Zoom out' });
    const zoomLabel = h('span', { style: { minWidth: '46px', textAlign: 'center', fontSize: '12px' }, textContent: '125%' });
    const btnZoomIn = h('button', { className: 'ghost small', textContent: '+', title: 'Zoom in' });
    const btnFit = h('button', { className: 'ghost small', textContent: 'Fit', title: 'Fit to window' });

    const btnDone = h('button', { className: 'active small', textContent: 'Done ✓', title: 'Save crops and finish' });
    const btnCancel = h('button', { className: 'ghost small', textContent: '✕ Cancel', title: 'Cancel without saving' });

    const headerLeft = h('div', { className: 'cropper-header-left' },
      infoSlotCode,
      infoQTitle,
      infoTarget,
      infoPartsPill,
      btnAddPart,
      infoPartMode,
      infoDesc,
      infoPageHint);

    const headerCenter = h('div', { className: 'cropper-header-center' },
      modeToggle,
      h('span', { className: 'cropper-sep' }),
      btnZoomOut, zoomLabel, btnZoomIn, btnFit);

    const headerRight = h('div', { className: 'cropper-header-right' },
      btnUndo,
      btnSkip,
      btnPrev,
      btnNext,
      h('span', { className: 'cropper-sep' }),
      btnDone,
      btnCancel);

    header.appendChild(headerLeft);
    header.appendChild(headerCenter);
    header.appendChild(headerRight);

    // Sidebar sub-elements
    const sidebarProgress = h('div', { className: 'cropper-progress-box' });
    const sidebarList = h('div', { className: 'cropper-list' });
    sidebar.appendChild(sidebarProgress);
    sidebar.appendChild(sidebarList);

    // Build page containers in scroll area
    for (let p = 1; p <= numPages; p++) {
      const wrap = h('div', { className: 'cropper-page-wrap', dataset: { page: String(p) } });
      const pageLabel = h('div', { className: 'cropper-page-number', textContent: `Page ${p} / ${numPages}` });
      const canvas = document.createElement('canvas');
      const boxOverlay = h('div', { className: 'cropper-page-overlay' });

      wrap.appendChild(pageLabel);
      wrap.appendChild(canvas);
      wrap.appendChild(boxOverlay);
      scrollContainer.appendChild(wrap);

      pageWraps.set(p, {
        pageNum: p,
        wrap,
        canvas,
        boxOverlay,
        rendered: false,
        viewport: null,
        page: null,
      });

      setupPageInteraction(p, wrap, boxOverlay);
    }

    // Mode switching handler
    function setMode(mode) {
      activeMode = mode;
      btnModeCrop.classList.toggle('active', mode === 'crop');
      btnModePan.classList.toggle('active', mode === 'pan');
      scrollContainer.classList.toggle('mode-pan', mode === 'pan');
    }

    btnModeCrop.addEventListener('click', () => setMode('crop'));
    btnModePan.addEventListener('click', () => setMode('pan'));

    // IntersectionObserver to render PDF pages lazily
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const p = Number(entry.target.dataset.page);
          renderPage(p);
        }
      }
    }, { root: scrollContainer, rootMargin: '400px 0px' });

    for (const { wrap } of pageWraps.values()) {
      observer.observe(wrap);
    }

    // Render a single PDF page onto its canvas
    async function renderPage(pageNum) {
      const item = pageWraps.get(pageNum);
      if (!item || item.rendered) return;

      if (!item.page) {
        item.page = await pdfDoc.getPage(pageNum);
      }

      const dpr = window.devicePixelRatio || 1;
      const viewport = item.page.getViewport({ scale: zoomScale });
      item.viewport = viewport;

      item.wrap.style.width = `${Math.ceil(viewport.width)}px`;
      item.wrap.style.height = `${Math.ceil(viewport.height)}px`;

      item.canvas.width = Math.ceil(viewport.width * dpr);
      item.canvas.height = Math.ceil(viewport.height * dpr);
      item.canvas.style.width = `${Math.ceil(viewport.width)}px`;
      item.canvas.style.height = `${Math.ceil(viewport.height)}px`;

      const ctx = item.canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      await item.page.render({ canvasContext: ctx, viewport }).promise;
      item.rendered = true;

      // Draw any existing crop boxes on this page
      renderPageCrops(pageNum);
    }

    // Re-render all page crops (supports multi-part boxes on separate or same pages)
    function renderPageCrops(pageNum) {
      const item = pageWraps.get(pageNum);
      if (!item) return;
      clear(item.boxOverlay);

      for (const s of slots) {
        const crop = crops[s.code];
        if (!crop) continue;

        const parts = Array.isArray(crop.parts) && crop.parts.length > 0
          ? crop.parts
          : (crop.box ? [{ page: crop.page, box: crop.box }] : []);

        parts.forEach((part, partIdx) => {
          if (part.page !== pageNum || !part.box) return;

          const isMulti = parts.length > 1;
          const isCurSlot = s.code === slots[currentIndex]?.code;
          const labelText = isMulti
            ? `${s.code} (Part ${partIdx + 1}/${parts.length}) · Q.${s.qNumber}`
            : `${s.code} · Q.${s.qNumber} (${s.on})`;

          const boxEl = h('div', {
            className: `cropper-saved-box ${isCurSlot ? 'active' : ''}`,
            style: {
              left: `${part.box.x * 100}%`,
              top: `${part.box.y * 100}%`,
              width: `${part.box.w * 100}%`,
              height: `${part.box.h * 100}%`,
            },
          },
          h('span', { className: 'cropper-saved-label', textContent: labelText }),
          h('button', {
            className: 'cropper-box-del',
            textContent: '×',
            title: isMulti ? `Remove Part ${partIdx + 1} of ${s.code}` : `Remove crop for ${s.code}`,
            onClick: (e) => {
              e.stopPropagation();
              if (isMulti) {
                crop.parts.splice(partIdx, 1);
                if (crop.parts.length === 1) {
                  crop.page = crop.parts[0].page;
                  crop.box = crop.parts[0].box;
                } else if (crop.parts.length === 0) {
                  delete crops[s.code];
                } else {
                  crop.page = crop.parts[0].page;
                  crop.box = crop.parts[0].box;
                }
              } else {
                delete crops[s.code];
              }
              if (isAddingPart) isAddingPart = false;
              updateAll();
            },
          }));

          boxEl.addEventListener('click', (e) => {
            e.stopPropagation();
            selectSlot(slots.findIndex(x => x.code === s.code), false);
          });

          item.boxOverlay.appendChild(boxEl);
        });
      }
    }

    // Handle touch/mouse drag on a page overlay
    function setupPageInteraction(pageNum, wrap, boxOverlay) {
      let isDragging = false;
      let startX = 0;
      let startY = 0;
      let liveBox = null;

      boxOverlay.addEventListener('pointerdown', (e) => {
        if (activeMode === 'pan') return;
        if (e.button !== 0) return; // Left click / touch primary only
        const rect = boxOverlay.getBoundingClientRect();
        startX = e.clientX - rect.left;
        startY = e.clientY - rect.top;
        isDragging = true;
        boxOverlay.setPointerCapture(e.pointerId);

        const curSlot = slots[currentIndex];
        const curCrop = curSlot ? crops[curSlot.code] : null;
        const nextPartNum = isAddingPart
          ? (Array.isArray(curCrop?.parts) ? curCrop.parts.length + 1 : 2)
          : null;

        const labelText = nextPartNum
          ? `${curSlot?.code || ''} (Part ${nextPartNum})`
          : (curSlot?.code || '');

        liveBox = h('div', { className: 'cropper-rubberband' },
          h('span', { className: 'cropper-rubberband-label', textContent: labelText }));
        liveBox.style.left = `${startX}px`;
        liveBox.style.top = `${startY}px`;
        liveBox.style.width = '0px';
        liveBox.style.height = '0px';
        boxOverlay.appendChild(liveBox);
      });

      boxOverlay.addEventListener('pointermove', (e) => {
        if (!isDragging || !liveBox) return;
        const rect = boxOverlay.getBoundingClientRect();
        const curX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const curY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

        const left = Math.min(startX, curX);
        const top = Math.min(startY, curY);
        const width = Math.abs(curX - startX);
        const height = Math.abs(curY - startY);

        liveBox.style.left = `${left}px`;
        liveBox.style.top = `${top}px`;
        liveBox.style.width = `${width}px`;
        liveBox.style.height = `${height}px`;
      });

      const finishDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;
        try { boxOverlay.releasePointerCapture(e.pointerId); } catch (_) {}

        if (!liveBox) return;
        const rect = boxOverlay.getBoundingClientRect();
        const curX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const curY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

        const left = Math.min(startX, curX);
        const top = Math.min(startY, curY);
        const width = Math.abs(curX - startX);
        const height = Math.abs(curY - startY);

        liveBox.remove();
        liveBox = null;

        // Ignore tiny accidental taps (< 12px or < 1.5% of dimension)
        if (width < 12 || height < 12 || rect.width === 0 || rect.height === 0) {
          return;
        }

        const normBox = {
          x: left / rect.width,
          y: top / rect.height,
          w: width / rect.width,
          h: height / rect.height,
        };

        const activeSlot = slots[currentIndex];
        if (!activeSlot) return;

        if (isAddingPart) {
          const curCrop = crops[activeSlot.code];
          if (!curCrop) {
            crops[activeSlot.code] = {
              page: pageNum,
              box: normBox,
              parts: [{ page: pageNum, box: normBox }],
            };
          } else {
            if (!Array.isArray(curCrop.parts) || curCrop.parts.length === 0) {
              curCrop.parts = [
                { page: curCrop.page || pageNum, box: curCrop.box || normBox },
              ];
            }
            curCrop.parts.push({ page: pageNum, box: normBox });
            curCrop.page = curCrop.parts[0].page;
            curCrop.box = curCrop.parts[0].box;
          }
          isAddingPart = false;
          skipped.delete(activeSlot.code);
          updateAll();
        } else {
          // Normal crop for active slot
          crops[activeSlot.code] = {
            page: pageNum,
            box: normBox,
            parts: [{ page: pageNum, box: normBox }],
          };
          skipped.delete(activeSlot.code);
          advanceToNext(true);
        }
      };

      boxOverlay.addEventListener('pointerup', finishDrag);
      boxOverlay.addEventListener('pointercancel', finishDrag);
    }

    // Add Part button click
    btnAddPart.addEventListener('click', () => {
      const cur = slots[currentIndex];
      if (!cur) return;
      const curCrop = crops[cur.code];
      if (!curCrop && !isAddingPart) {
        alert('Please draw the first diagram part on the page before adding an additional cross-page part.');
        return;
      }

      isAddingPart = !isAddingPart;
      if (isAddingPart) {
        setMode('crop');
      }
      updateAll();
    });

    // Auto-advance to next uncropped slot
    function advanceToNext(scrollIfDifferentPage = true) {
      // Look for next uncropped after currentIndex
      let nextIdx = -1;
      for (let i = currentIndex + 1; i < slots.length; i++) {
        if (!crops[slots[i].code] && !skipped.has(slots[i].code)) {
          nextIdx = i;
          break;
        }
      }
      // Wrap around if needed
      if (nextIdx === -1) {
        for (let i = 0; i < slots.length; i++) {
          if (!crops[slots[i].code] && !skipped.has(slots[i].code)) {
            nextIdx = i;
            break;
          }
        }
      }

      if (nextIdx !== -1) {
        selectSlot(nextIdx, scrollIfDifferentPage);
      } else {
        // All cropped/skipped
        if (currentIndex < slots.length - 1) {
          selectSlot(currentIndex + 1, scrollIfDifferentPage);
        } else {
          updateAll();
        }
      }
    }

    // Select slot index and optionally scroll to its hinted/existing page
    function selectSlot(index, autoScroll = true) {
      if (index < 0 || index >= slots.length) return;
      if (isAddingPart) isAddingPart = false;
      currentIndex = index;
      updateAll();

      if (autoScroll) {
        const slot = slots[currentIndex];
        const targetPage = crops[slot.code]?.page || slot.page || 1;
        scrollToPage(targetPage);
      }
    }

    function scrollToPage(pageNum) {
      const item = pageWraps.get(pageNum);
      if (!item) return;

      const containerRect = scrollContainer.getBoundingClientRect();
      const wrapRect = item.wrap.getBoundingClientRect();

      // Only scroll if page is not well within view
      const isVisible = wrapRect.top >= containerRect.top - 100 && wrapRect.bottom <= containerRect.bottom + 100;
      if (!isVisible) {
        item.wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      renderPage(pageNum);
    }

    function updateAll() {
      const cur = slots[currentIndex];
      if (!cur) return;

      const curCrop = crops[cur.code];
      const curParts = Array.isArray(curCrop?.parts) && curCrop.parts.length > 0
        ? curCrop.parts
        : (curCrop?.box ? [{ page: curCrop.page, box: curCrop.box }] : []);

      // Update header
      infoSlotCode.textContent = `${cur.code} of ${slots.length}`;
      infoQTitle.textContent = `Q.${cur.qNumber} · ${cur.subject}`;
      infoTarget.textContent = cur.on.toUpperCase();
      infoDesc.textContent = cur.desc || cur.stemPreview;
      infoPageHint.textContent = `(≈ Page ${cur.page})`;

      if (curParts.length > 1) {
        const pageList = [...new Set(curParts.map(p => p.page))].join(', ');
        infoPartsPill.style.display = 'inline-flex';
        infoPartsPill.textContent = `🔗 ${curParts.length} parts (p.${pageList})`;
      } else {
        infoPartsPill.style.display = 'none';
      }

      if (isAddingPart) {
        btnAddPart.textContent = '✕ Cancel + Part';
        btnAddPart.className = 'cropper-btn-addpart active';
        infoPartMode.style.display = 'inline-flex';
        infoPartMode.textContent = `✏️ Draw Part ${curParts.length + 1} on PDF page`;
      } else {
        btnAddPart.textContent = curCrop ? '+ Add Part (cross-page)' : '+ Add Part';
        btnAddPart.className = 'cropper-btn-addpart';
        btnAddPart.title = curCrop
          ? 'Add another part on this or next page to stick together'
          : 'Crop first part before adding another part';
        infoPartMode.style.display = 'none';
      }

      btnPrev.disabled = currentIndex === 0;
      btnNext.disabled = currentIndex === slots.length - 1;

      // Re-render saved boxes on all rendered pages
      for (const p of pageWraps.keys()) {
        renderPageCrops(p);
      }

      // Update sidebar
      updateSidebar();
    }

    function updateSidebar() {
      clear(sidebarProgress);
      clear(sidebarList);

      const croppedCount = Object.keys(crops).length;
      const skippedCount = skipped.size;
      const total = slots.length;

      const barFill = h('div', {
        className: 'cropper-progress-fill',
        style: { width: `${(croppedCount / total) * 100}%` },
      });
      const barTrack = h('div', { className: 'cropper-progress-track' }, barFill);

      sidebarProgress.appendChild(h('div', { className: 'cropper-progress-header' },
        h('strong', { textContent: `${croppedCount} / ${total} cropped` }),
        skippedCount ? h('span', { className: 'muted', textContent: ` · ${skippedCount} skipped` }) : h('span')));
      sidebarProgress.appendChild(barTrack);

      slots.forEach((s, idx) => {
        const isCurrent = idx === currentIndex;
        const isCropped = !!crops[s.code];
        const isSkipped = skipped.has(s.code);
        const crop = crops[s.code];

        let badgeClass = 'pending';
        let badgeText = '• pending';
        if (isCropped) {
          const partsCount = Array.isArray(crop.parts) ? crop.parts.length : 1;
          if (partsCount > 1) {
            badgeClass = 'cropped multi';
            const pages = [...new Set(crop.parts.map(p => p.page))].join(', ');
            badgeText = `✓ ${partsCount} parts (p.${pages})`;
          } else {
            badgeClass = 'cropped';
            badgeText = `✓ Page ${crop.page}`;
          }
        } else if (isSkipped) {
          badgeClass = 'skipped';
          badgeText = '⏭ skipped';
        }

        const row = h('div', {
          className: `cropper-list-item ${isCurrent ? 'active' : ''}`,
          onClick: () => selectSlot(idx, true),
        },
        h('div', { className: 'cropper-list-item-left' },
          h('span', { className: 'cropper-list-code', textContent: s.code }),
          h('div', { className: 'cropper-list-info' },
            h('span', { className: 'cropper-list-q', textContent: `Q.${s.qNumber} · ${s.on}` }),
            h('span', { className: 'cropper-list-desc', textContent: s.desc }))),
        h('span', { className: `cropper-list-badge ${badgeClass}`, textContent: badgeText }));

        sidebarList.appendChild(row);
      });
    }

    // Zoom handlers
    function applyZoom(newScale) {
      zoomScale = Math.max(0.5, Math.min(3.0, newScale));
      zoomLabel.textContent = `${Math.round(zoomScale * 100)}%`;
      for (const item of pageWraps.values()) {
        item.rendered = false;
      }
      // Re-render visible pages
      for (const item of pageWraps.values()) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const wrapRect = item.wrap.getBoundingClientRect();
        if (wrapRect.bottom >= containerRect.top && wrapRect.top <= containerRect.bottom) {
          renderPage(item.pageNum);
        }
      }
    }

    btnZoomIn.addEventListener('click', () => applyZoom(zoomScale + 0.25));
    btnZoomOut.addEventListener('click', () => applyZoom(zoomScale - 0.25));
    btnFit.addEventListener('click', () => {
      const availW = scrollContainer.clientWidth - 48;
      if (pageWraps.get(1)?.viewport) {
        const baseW = pageWraps.get(1).viewport.width / zoomScale;
        applyZoom(availW / baseW);
      } else {
        applyZoom(1.0);
      }
    });

    // Navigation buttons
    btnPrev.addEventListener('click', () => selectSlot(currentIndex - 1, true));
    btnNext.addEventListener('click', () => selectSlot(currentIndex + 1, true));

    btnSkip.addEventListener('click', () => {
      const cur = slots[currentIndex];
      if (cur) {
        delete crops[cur.code];
        skipped.add(cur.code);
        advanceToNext(true);
      }
    });

    btnUndo.addEventListener('click', () => {
      if (isAddingPart) {
        isAddingPart = false;
        updateAll();
        return;
      }
      const cur = slots[currentIndex];
      if (cur && crops[cur.code]) {
        const curCrop = crops[cur.code];
        if (Array.isArray(curCrop.parts) && curCrop.parts.length > 1) {
          curCrop.parts.pop();
          curCrop.page = curCrop.parts[0].page;
          curCrop.box = curCrop.parts[0].box;
        } else {
          delete crops[cur.code];
        }
        updateAll();
      } else if (currentIndex > 0) {
        const prev = slots[currentIndex - 1];
        if (crops[prev.code]) {
          const prevCrop = crops[prev.code];
          if (Array.isArray(prevCrop.parts) && prevCrop.parts.length > 1) {
            prevCrop.parts.pop();
            prevCrop.page = prevCrop.parts[0].page;
            prevCrop.box = prevCrop.parts[0].box;
          } else {
            delete crops[prev.code];
          }
        }
        selectSlot(currentIndex - 1, true);
      }
    });

    // Keyboard navigation
    function handleKeyDown(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        close({ crops });
      } else if (e.key === 'z' || e.key === 'Z') {
        if (!e.ctrlKey && !e.metaKey) {
          btnUndo.click();
        }
      } else if (e.key === 's' || e.key === 'S') {
        btnSkip.click();
      } else if (e.key === 'ArrowLeft') {
        btnPrev.click();
      } else if (e.key === 'ArrowRight') {
        btnNext.click();
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    function close(result) {
      window.removeEventListener('keydown', handleKeyDown);
      observer.disconnect();
      overlay.remove();
      resolve(result);
    }

    btnDone.addEventListener('click', () => {
      // Synchronize primary page and box from parts
      for (const crop of Object.values(crops)) {
        if (crop && Array.isArray(crop.parts) && crop.parts.length > 0) {
          crop.page = crop.parts[0].page;
          crop.box = crop.parts[0].box;
        }
      }
      close({ crops });
    });

    btnCancel.addEventListener('click', () => {
      if (Object.keys(crops).length > 0) {
        if (!confirm('Discard all cropped figures and exit?')) return;
      }
      close(null);
    });

    // Initial render
    updateAll();
    const initialTargetPage = slots[currentIndex]?.page || 1;
    renderPage(initialTargetPage);
    setTimeout(() => scrollToPage(initialTargetPage), 100);
  });
}
