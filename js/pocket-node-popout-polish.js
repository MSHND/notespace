/* P210 PE presentation polish.
   This layer chooses focus, scrolling and keyboard gestures only. The native
   PocketNodePopoutRuntime remains the owner of editor state and commands. */
(function initialisePocketNodePopoutPolish(global) {
  "use strict";

  function asDocument(candidate) {
    return candidate && typeof candidate.getElementById === "function" ? candidate : null;
  }

  function payloadFromDocument(doc) {
    const carrier = doc?.getElementById?.("pocketNodePopoutPayload");
    if (!carrier || String(carrier.tagName || "").toUpperCase() !== "TEXTAREA") return null;
    try {
      const parsed = JSON.parse(String(carrier.value || ""));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  function openingFocusTarget(payload) {
    if (!payload || payload.readOnly === true) return "none";
    return typeof payload.title === "string" && payload.title.trim() ? "body" : "title";
  }

  function selectionFor(doc) {
    try {
      if (typeof global.getSelection === "function") return global.getSelection();
      if (typeof doc?.getSelection === "function") return doc.getSelection();
    } catch (_error) {}
    return null;
  }

  function placeCaretInElement(doc, element, atEnd) {
    if (!element) return false;
    try { element.focus({ preventScroll: true }); }
    catch (_error) { try { element.focus(); } catch (_ignored) {} }
    try {
      const selection = selectionFor(doc);
      const range = typeof doc?.createRange === "function" ? doc.createRange() : null;
      if (!selection || !range
          || typeof range.selectNodeContents !== "function"
          || typeof range.collapse !== "function"
          || typeof selection.removeAllRanges !== "function"
          || typeof selection.addRange !== "function") return true;
      range.selectNodeContents(element);
      range.collapse(atEnd === true ? false : true);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (_error) {}
    return true;
  }

  function focusOpeningSurface(doc, payload) {
    const target = openingFocusTarget(payload);
    if (target === "none") return false;
    if (target === "title") {
      const title = doc?.getElementById?.("titleInput");
      if (!title || typeof title.focus !== "function") return false;
      try { title.focus({ preventScroll: true }); } catch (_error) { title.focus(); }
      if (typeof title.select === "function") title.select();
      return true;
    }
    const pane = doc?.getElementById?.("outlinePane");
    const first = pane?.querySelector?.(".lineText[data-line-id]") || null;
    return first ? placeCaretInElement(doc, first, true) : false;
  }

  function installOpeningFocus(doc, payload) {
    return focusOpeningSurface(doc, payload);
  }

  function editableBodyEntryTarget(doc) {
    const pane = doc?.getElementById?.("outlinePane");
    const first = pane?.querySelector?.(".lineText[data-line-id]") || null;
    if (!first) return null;
    const declared = String(first.getAttribute?.("contenteditable") ?? first.contentEditable ?? "").toLowerCase();
    if (first.isContentEditable !== true && declared !== "true") return null;
    return first;
  }

  function collapsedCaretOwnedBy(doc, element) {
    if (!element || doc?.activeElement !== element) return false;
    const selection = selectionFor(doc);
    if (!selection || selection.rangeCount !== 1 || typeof selection.getRangeAt !== "function") return false;
    let range;
    try { range = selection.getRangeAt(0); } catch (_error) { return false; }
    if (!range || range.collapsed !== true || !range.startContainer) return false;
    return range.startContainer === element || element.contains?.(range.startContainer) === true;
  }

  function canPlaceCollapsedCaret(doc) {
    const selection = selectionFor(doc);
    const range = typeof doc?.createRange === "function" ? doc.createRange() : null;
    return !!selection
      && !!range
      && typeof range.selectNodeContents === "function"
      && typeof range.collapse === "function"
      && typeof selection.removeAllRanges === "function"
      && typeof selection.addRange === "function"
      && typeof selection.getRangeAt === "function";
  }

  function handleTitleBodyTab(ev, doc, payload) {
    if (!ev || ev.key !== "Tab" || ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey || ev.isComposing) return false;
    if (!payload || payload.readOnly === true) return false;

    const title = doc?.getElementById?.("titleInput");
    if (!title || doc.activeElement !== title || ev.target !== title || title.readOnly === true || title.disabled === true) return false;

    const body = editableBodyEntryTarget(doc);
    if (!body || !canPlaceCollapsedCaret(doc)) return false;
    if (placeCaretInElement(doc, body, false) !== true || !collapsedCaretOwnedBy(doc, body)) return false;

    ev.preventDefault?.();
    return true;
  }

  function finiteRect(rect) {
    if (!rect) return null;
    const top = Number(rect.top);
    const bottom = Number(rect.bottom);
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
    return { top, bottom };
  }

  function comfortScrollDelta(paneRect, activeRect, margin = 28) {
    const pane = finiteRect(paneRect);
    const active = finiteRect(activeRect);
    const safeMargin = Math.max(8, Number(margin) || 0);
    if (!pane || !active || pane.bottom <= pane.top) return 0;
    const upper = pane.top + Math.min(safeMargin, (pane.bottom - pane.top) * 0.22);
    const lower = pane.bottom - Math.min(safeMargin, (pane.bottom - pane.top) * 0.22);
    if (active.top < upper) return active.top - upper;
    if (active.bottom > lower) return active.bottom - lower;
    return 0;
  }

  function activeEditable(doc) {
    const active = doc?.activeElement || null;
    if (!active || typeof active.closest !== "function") return null;
    return active.closest(".lineText[data-line-id]");
  }

  function usableCaretRect(rect) {
    const finite = finiteRect(rect);
    if (!finite) return null;
    const declaredHeight = Number(rect?.height);
    const geometricHeight = finite.bottom - finite.top;
    const height = Number.isFinite(declaredHeight) ? Math.max(declaredHeight, geometricHeight) : geometricHeight;
    return Number.isFinite(height) && height >= 0.5 ? finite : null;
  }

  function selectionRectFor(doc, editable) {
    const selection = selectionFor(doc);
    if (!selection || selection.rangeCount !== 1 || typeof selection.getRangeAt !== "function") return null;
    let range;
    try { range = selection.getRangeAt(0); } catch (_error) { return null; }
    if (!range || range.collapsed !== true || !range.startContainer) return null;
    if (!(range.startContainer === editable || editable.contains?.(range.startContainer))) return null;
    try {
      const rangeRect = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
      const usableRangeRect = usableCaretRect(rangeRect);
      if (usableRangeRect) return usableRangeRect;
      if (typeof range.getClientRects !== "function") return null;
      const rects = range.getClientRects();
      for (let index = 0; rects && index < rects.length; index += 1) {
        const usableClientRect = usableCaretRect(rects[index]);
        if (usableClientRect) return usableClientRect;
      }
      return null;
    } catch (_error) {
      return null;
    }
  }

  function keepActiveLineComfortable(doc) {
    const pane = doc?.getElementById?.("outlinePane");
    const editable = activeEditable(doc);
    if (!pane || !editable || typeof pane.getBoundingClientRect !== "function") return false;
    const activeRect = selectionRectFor(doc, editable)
      || finiteRect(editable.getBoundingClientRect?.())
      || finiteRect(editable.closest?.(".docRow[data-line-id]")?.getBoundingClientRect?.());
    if (!activeRect) return false;
    const delta = comfortScrollDelta(pane.getBoundingClientRect(), activeRect, 30);
    if (Math.abs(delta) < 1) return false;
    const current = Number(pane.scrollTop) || 0;
    const maximum = Math.max(0, (Number(pane.scrollHeight) || 0) - (Number(pane.clientHeight) || 0));
    const target = Math.max(0, Math.min(maximum, current + delta));
    const actual = target - current;
    if (Math.abs(actual) < 1) return false;
    try { pane.scrollBy({ top: actual, left: 0, behavior: "smooth" }); }
    catch (_error) { pane.scrollTop = target; }
    return true;
  }

  function rowDepth(row) {
    const value = Number(row?.getAttribute?.("data-depth"));
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  function parentRowIndex(rows, currentIndex) {
    if (!Array.isArray(rows) || currentIndex <= 0 || currentIndex >= rows.length) return -1;
    const depth = rowDepth(rows[currentIndex]);
    if (depth <= 0) return -1;
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      const candidateDepth = rowDepth(rows[index]);
      if (candidateDepth === depth - 1) return index;
      if (candidateDepth < depth - 1) return -1;
    }
    return -1;
  }

  function firstVisibleDirectChildRow(rows, currentIndex) {
    if (!Array.isArray(rows) || currentIndex < 0 || currentIndex >= rows.length - 1) return null;
    const current = rows[currentIndex];
    const next = rows[currentIndex + 1];
    const currentDepth = rowDepth(current);
    return rowDepth(next) === currentDepth + 1 ? next : null;
  }

  function caretIsAtStart(doc, editable) {
    const selection = selectionFor(doc);
    if (!selection || selection.rangeCount !== 1 || typeof selection.getRangeAt !== "function") return false;
    let range;
    try { range = selection.getRangeAt(0); } catch (_error) { return false; }
    if (!range || range.collapsed !== true || !range.startContainer) return false;
    if (!(range.startContainer === editable || editable.contains?.(range.startContainer))) return false;
    try {
      const before = range.cloneRange();
      before.selectNodeContents(editable);
      before.setEnd(range.startContainer, range.startOffset);
      return before.toString().length === 0;
    } catch (_error) {
      return false;
    }
  }

  function caretIsAtEnd(doc, editable) {
    const selection = selectionFor(doc);
    if (!selection || selection.rangeCount !== 1 || typeof selection.getRangeAt !== "function") return false;
    let range;
    try { range = selection.getRangeAt(0); } catch (_error) { return false; }
    if (!range || range.collapsed !== true || !range.endContainer) return false;
    if (!(range.endContainer === editable || editable.contains?.(range.endContainer))) return false;
    try {
      const after = range.cloneRange();
      after.selectNodeContents(editable);
      after.setStart(range.endContainer, range.endOffset);
      return after.toString().length === 0;
    } catch (_error) {
      return false;
    }
  }

  function editableRowOwnsFocus(doc, element) {
    if (!element || doc?.activeElement !== element) return false;
    const declared = String(element.getAttribute?.("contenteditable") ?? element.contentEditable ?? "").toLowerCase();
    return element.isContentEditable === true || declared === "true";
  }

  function softCenterPeRow(pane, row) {
    if (!pane || !row || typeof pane.getBoundingClientRect !== "function" || typeof row.getBoundingClientRect !== "function") return false;
    const paneRect = pane.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const paneTop = Number(paneRect.top);
    const paneBottom = Number(paneRect.bottom);
    const rowTop = Number(rowRect.top);
    const rowBottom = Number(rowRect.bottom);
    if (![paneTop, paneBottom, rowTop, rowBottom].every(Number.isFinite) || paneBottom <= paneTop) return false;
    const delta = ((rowTop + rowBottom) / 2) - (paneTop + ((paneBottom - paneTop) * 0.46));
    if (Math.abs(delta) < 18) return true;
    const current = Number(pane.scrollTop) || 0;
    const maximum = Math.max(0, (Number(pane.scrollHeight) || 0) - (Number(pane.clientHeight) || 0));
    const target = Math.max(0, Math.min(maximum, current + delta));
    const actual = target - current;
    if (Math.abs(actual) < 1) return true;
    try { pane.scrollBy({ top: actual, left: 0, behavior: "smooth" }); }
    catch (_error) { pane.scrollTop = target; }
    return true;
  }

  function handlePlainLeft(ev, doc) {
    if (!ev || ev.key !== "ArrowLeft" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey || ev.isComposing) return false;
    const target = ev.target?.closest?.(".lineText[data-line-id]") || null;
    if (!target || doc.activeElement !== target || !caretIsAtStart(doc, target)) return false;
    const pane = doc.getElementById("outlinePane");
    const row = target.closest?.(".docRow[data-line-id]") || null;
    if (!pane || !row) return false;

    const gutter = row.querySelector?.(".lineGutter.branch[data-line-id]") || row.querySelector?.(".lineGutter[data-line-id]") || null;
    if (gutter && String(gutter.textContent || "").trim() === "▾") {
      ev.preventDefault?.();
      ev.stopImmediatePropagation?.();
      gutter.click?.();
      return true;
    }

    const rows = Array.from(pane.querySelectorAll?.(".docRow[data-line-id]") || []);
    const currentIndex = rows.indexOf(row);
    const parentIndex = parentRowIndex(rows, currentIndex);
    if (parentIndex < 0) return false;
    const parentRow = rows[parentIndex];
    const parentText = parentRow.querySelector?.(".lineText[data-line-id]") || null;
    if (!parentText) return false;

    ev.preventDefault?.();
    ev.stopImmediatePropagation?.();
    parentText.click?.();
    placeCaretInElement(doc, parentText, true);
    softCenterPeRow(pane, parentRow);
    return true;
  }

  function handlePlainRight(ev, doc, payload) {
    if (!ev || ev.key !== "ArrowRight" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey || ev.isComposing || ev.keyCode === 229) return false;
    if (payload?.readOnly === true) return false;
    const target = ev.target?.closest?.(".lineText[data-line-id]") || null;
    if (!editableRowOwnsFocus(doc, target) || !caretIsAtEnd(doc, target) || !canPlaceCollapsedCaret(doc)) return false;
    const pane = doc.getElementById("outlinePane");
    const row = target.closest?.(".docRow[data-line-id]") || null;
    if (!pane || !row) return false;

    const gutter = row.querySelector?.(".lineGutter[data-line-id]") || null;
    const glyph = String(gutter?.textContent || "").trim();
    if (glyph === "▸") {
      if (typeof gutter?.click !== "function") return false;
      ev.preventDefault?.();
      ev.stopImmediatePropagation?.();
      gutter.click();
      placeCaretInElement(doc, target, true);
      return true;
    }
    if (glyph !== "▾") return false;

    const rows = Array.from(pane.querySelectorAll?.(".docRow[data-line-id]") || []);
    const currentIndex = rows.indexOf(row);
    const childRow = firstVisibleDirectChildRow(rows, currentIndex);
    const childText = childRow?.querySelector?.(".lineText[data-line-id]") || null;
    if (!childText || typeof childText.click !== "function") return false;

    ev.preventDefault?.();
    ev.stopImmediatePropagation?.();
    childText.click();
    placeCaretInElement(doc, childText, false);
    softCenterPeRow(pane, childRow);
    return true;
  }

  function install(docCandidate) {
    const doc = asDocument(docCandidate || global.document);
    if (!doc || doc.__pocketP210PolishInstalled === true) return false;
    const pane = doc.getElementById("outlinePane");
    if (!pane) return false;
    doc.__pocketP210PolishInstalled = true;

    installOpeningFocus(doc, payloadFromDocument(doc));
    const payload = payloadFromDocument(doc);

    let comfortQueued = false;
    const scheduleComfort = () => {
      if (comfortQueued) return;
      comfortQueued = true;
      const raf = typeof global.requestAnimationFrame === "function"
        ? global.requestAnimationFrame.bind(global)
        : (callback) => global.setTimeout?.(callback, 0);
      raf(() => {
        comfortQueued = false;
        keepActiveLineComfortable(doc);
      });
    };

    doc.addEventListener?.("selectionchange", scheduleComfort);
    pane.addEventListener?.("keyup", scheduleComfort);
    pane.addEventListener?.("input", scheduleComfort);
    pane.addEventListener?.("focusin", scheduleComfort);
    doc.addEventListener?.("keydown", (ev) => {
      if (handleTitleBodyTab(ev, doc, payload)) return;
      if (handlePlainLeft(ev, doc)) return;
      handlePlainRight(ev, doc, payload);
    }, true);
    return true;
  }

  global.PocketNodePopoutPolish = Object.freeze({
    install,
    openingFocusTarget,
    focusOpeningSurface,
    installOpeningFocus,
    comfortScrollDelta,
    keepActiveLineComfortable,
    handleTitleBodyTab,
    parentRowIndex,
    firstVisibleDirectChildRow,
    handlePlainLeft,
    handlePlainRight,
    softCenterPeRow,
  });

  install(global.document);
})(window);
