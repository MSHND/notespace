/* List smoothing: calmer filter typing and keyboard scroll behaviour. */

(function initialisePocketListSmoothing(global) {
  "use strict";

  let filterRenderTimer = null;
  let lastFilterValue = "";

  function safeClean(value, max = 120) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function getTreeScroller() {
    return el.treeWrap instanceof HTMLElement ? el.treeWrap : null;
  }

  function findRow(nodeId) {
    const id = safeClean(nodeId, 80);
    if (!id || !(el.treeRoot instanceof HTMLElement)) return null;
    const escaped = typeof CSS?.escape === "function" ? CSS.escape(id) : id.replace(/"/g, '\\"');
    const row = el.treeRoot.querySelector(`.row[data-node-id="${escaped}"]`);
    return row instanceof HTMLElement ? row : null;
  }

  function calmScrollRowIntoView(row, options = {}) {
    if (!(row instanceof HTMLElement)) return false;
    const container = getTreeScroller();
    const behavior = options.smooth === true && options.instant !== true ? "smooth" : "auto";
    if (!(container instanceof HTMLElement)) {
      try { row.scrollIntoView({ block: "nearest", inline: "nearest", behavior }); } catch {}
      return true;
    }

    const rowBox = row.getBoundingClientRect();
    const wrapBox = container.getBoundingClientRect();
    const cushion = Math.min(120, Math.max(34, wrapBox.height * 0.14));
    const visibleTop = wrapBox.top + cushion;
    const visibleBottom = wrapBox.bottom - cushion;

    let delta = 0;
    if (rowBox.top < visibleTop) delta = rowBox.top - visibleTop;
    else if (rowBox.bottom > visibleBottom) delta = rowBox.bottom - visibleBottom;

    if (Math.abs(delta) < 4) return true;
    try {
      container.scrollBy({ top: delta, left: 0, behavior });
    } catch {
      container.scrollTop += delta;
    }
    return true;
  }

  function softCenterRow(row) {
    if (!(row instanceof HTMLElement)) return false;
    const container = getTreeScroller();
    if (!(container instanceof HTMLElement)) {
      try { row.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" }); } catch {}
      return true;
    }
    const rowBox = row.getBoundingClientRect();
    const wrapBox = container.getBoundingClientRect();
    const targetCenter = wrapBox.top + (wrapBox.height * 0.48);
    const rowCenter = rowBox.top + (rowBox.height / 2);
    const delta = rowCenter - targetCenter;
    if (Math.abs(delta) < 42) return true;
    try {
      container.scrollBy({ top: delta, left: 0, behavior: "smooth" });
    } catch {
      container.scrollTop += delta;
    }
    return true;
  }

  function isRecentTypeJumpFor(id) {
    const typeJump = state && state.typeJump ? state.typeJump : null;
    if (!typeJump) return false;
    const lastAt = Number(typeJump.lastAt || 0);
    if (!lastAt || Date.now() - lastAt > 260) return false;
    return safeClean(state.selectedId, 80) === safeClean(id, 80);
  }

  global.scrollRowComfortably = function scrollRowComfortably(row, options = {}) {
    return calmScrollRowIntoView(row, options);
  };

  global.focusRowByNodeId = function focusRowByNodeId(nodeId, options = {}) {
    const id = safeClean(nodeId, 80);
    if (!id || !(el.treeRoot instanceof HTMLElement)) return;
    requestAnimationFrame(() => {
      const row = findRow(id);
      if (!(row instanceof HTMLElement)) return;
      row.focus({ preventScroll: true });
      if (options.center === true || isRecentTypeJumpFor(id)) {
        softCenterRow(row);
        return;
      }
      calmScrollRowIntoView(row, { instant: options.instant === true, smooth: options.smooth === true });
    });
  };

  function handleFilterInputSmoothly(ev) {
    if (ev.target !== el.search) return;
    ev.stopImmediatePropagation();

    const scroller = getTreeScroller();
    const previousTop = scroller ? scroller.scrollTop : 0;
    const value = safeClean(el.search.value, 120);
    const hasFilter = value.length > 0;

    if (hasFilter) rememberFilterOrigin();
    else clearFilterMemory();
    resetTypeJump();

    if (filterRenderTimer) clearTimeout(filterRenderTimer);
    const delay = hasFilter ? 54 : 0;
    filterRenderTimer = window.setTimeout(() => {
      filterRenderTimer = null;
      lastFilterValue = value;
      renderTree();

      if (scroller instanceof HTMLElement && hasFilter) {
        requestAnimationFrame(() => {
          scroller.scrollTop = Math.max(0, Math.min(previousTop, scroller.scrollHeight - scroller.clientHeight));
        });
      }
      if (!hasFilter) refocusTreeNavigation(state.selectedId, { instant: true });
    }, delay);
  }

  function init() {
    if (el.search instanceof HTMLInputElement) {
      el.search.addEventListener("input", handleFilterInputSmoothly, true);
    }
  }

  global.PocketListSmoothing = Object.freeze({ calmScrollRowIntoView, softCenterRow });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
