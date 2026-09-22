/* List smoothing: calmer filter typing and keyboard scroll/selection behaviour. */

(function initialisePocketListSmoothing(global) {
  "use strict";

  let filterRenderTimer = null;

  function safeClean(value, max = 120) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function getTreeScroller() {
    return el.treeWrap instanceof HTMLElement ? el.treeWrap : null;
  }

  function findRow(nodeId) {
    const id = safeClean(nodeId, 80);
    if (!id || !(el.treeRoot instanceof HTMLElement)) return null;
    if (typeof getMountedMainRowForNodeId === "function") {
      const mounted = getMountedMainRowForNodeId(id);
      if (mounted instanceof HTMLElement) return mounted;
    }
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

  function getVisibleIds() {
    if (typeof getVisibleNodeIdsInRenderOrder === "function") return getVisibleNodeIdsInRenderOrder();
    if (!(el.treeRoot instanceof HTMLElement)) return [];
    return Array.from(el.treeRoot.querySelectorAll(".row[data-node-id]"))
      .map((row) => safeClean(row.getAttribute("data-node-id"), 80))
      .filter(Boolean);
  }

  function paintSelectionOnly(nextId) {
    const id = safeClean(nextId, 80);
    if (!id || !state.nodes.some((node) => node.id === id)) return false;
    const mountedBefore = findRow(id);
    if (!(mountedBefore instanceof HTMLElement)) return false;

    const previousId = safeClean(state.selectedId, 80);
    state.selectedId = id;

    let projected = false;
    if (previousId && previousId !== id && typeof projectMainPrimarySelection === "function") {
      try {
        projected = projectMainPrimarySelection(previousId, id) === true;
      } catch {}
    }
    if (!projected) renderTree();

    const row = projected ? mountedBefore : findRow(id);
    if (!(row instanceof HTMLElement)) return false;
    row.focus({ preventScroll: true });
    refreshMeta();
    calmScrollRowIntoView(row);
    return true;
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
      if (options.center === true) {
        softCenterRow(row);
        return;
      }
      calmScrollRowIntoView(row, { instant: options.instant === true, smooth: options.smooth === true });
    });
  };

  global.moveSelectionByVisibleDelta = function moveSelectionByVisibleDelta(delta) {
    const visibleIds = getVisibleIds();
    if (visibleIds.length === 0) return false;
    if (!state.selectedId) return paintSelectionOnly(delta < 0 ? visibleIds[visibleIds.length - 1] : visibleIds[0]);
    const currentIndex = visibleIds.indexOf(state.selectedId);
    if (currentIndex < 0) return paintSelectionOnly(visibleIds[0]);
    const nextIndex = currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= visibleIds.length) return false;
    return paintSelectionOnly(visibleIds[nextIndex]);
  };

  global.moveSelectionToVisibleEdge = function moveSelectionToVisibleEdge(edge) {
    const visibleIds = getVisibleIds();
    if (visibleIds.length === 0) return false;
    const toEnd = safeClean(edge, 16).toLowerCase() === "end";
    const nextId = toEnd ? visibleIds[visibleIds.length - 1] : visibleIds[0];
    if (!nextId || state.selectedId === nextId) return false;
    const ok = paintSelectionOnly(nextId);
    if (ok) saveWorkspaceState();
    return ok;
  };

  let pendingFilterRender = null;

  function runFilterRender(request, options = {}) {
    if (!request) return false;
    renderTree();

    const preserveScroll = options.preserveScroll !== false;
    if (preserveScroll && request.scroller instanceof HTMLElement && request.hasFilter) {
      requestAnimationFrame(() => {
        request.scroller.scrollTop = Math.max(
          0,
          Math.min(request.previousTop, request.scroller.scrollHeight - request.scroller.clientHeight)
        );
      });
    }
    if (!request.hasFilter) refocusTreeNavigation(state.selectedId, { instant: true });
    return true;
  }

  function cancelPendingFilterRender() {
    if (filterRenderTimer) clearTimeout(filterRenderTimer);
    filterRenderTimer = null;
    const hadPending = !!pendingFilterRender;
    pendingFilterRender = null;
    return hadPending;
  }

  function settlePendingFilterRender(options = {}) {
    if (!pendingFilterRender) return false;
    if (filterRenderTimer) clearTimeout(filterRenderTimer);
    filterRenderTimer = null;
    const request = pendingFilterRender;
    pendingFilterRender = null;
    return runFilterRender(request, options);
  }

  function scheduleFilterRender(value, options = {}) {
    const hasFilter = safeClean(value, 120).length > 0;
    const scroller = getTreeScroller();
    pendingFilterRender = {
      scroller,
      previousTop: scroller ? scroller.scrollTop : 0,
      hasFilter,
    };
    if (filterRenderTimer) clearTimeout(filterRenderTimer);
    filterRenderTimer = null;

    if (options.immediate === true) {
      return settlePendingFilterRender({ preserveScroll: options.preserveScroll !== false });
    }

    const delay = hasFilter ? 54 : 0;
    filterRenderTimer = window.setTimeout(() => {
      filterRenderTimer = null;
      const request = pendingFilterRender;
      pendingFilterRender = null;
      runFilterRender(request, { preserveScroll: true });
    }, delay);
    return true;
  }

  function applyFilterQueryValue(rawValue, options = {}) {
    if (!(el.search instanceof HTMLInputElement)) return false;
    const value = String(rawValue ?? "").slice(0, 120);
    el.search.value = value;
    const hasFilter = safeClean(value, 120).length > 0;

    if (hasFilter) rememberFilterOrigin();
    else clearFilterMemory();
    resetTypeJump();

    return scheduleFilterRender(value, options);
  }

  function handleFilterInputSmoothly(ev) {
    if (ev.target !== el.search) return;
    ev.stopImmediatePropagation();
    applyFilterQueryValue(el.search.value);
  }

  function init() {
    if (el.search instanceof HTMLInputElement) {
      el.search.addEventListener("input", handleFilterInputSmoothly, true);
    }
  }

  global.applyPocketFilterQueryValue = applyFilterQueryValue;
  global.settlePocketPendingFilterRender = settlePendingFilterRender;
  global.cancelPocketPendingFilterRender = cancelPendingFilterRender;
  global.PocketListSmoothing = Object.freeze({
    calmScrollRowIntoView,
    softCenterRow,
    paintSelectionOnly,
    applyFilterQueryValue,
    settlePendingFilterRender,
    cancelPendingFilterRender,
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
