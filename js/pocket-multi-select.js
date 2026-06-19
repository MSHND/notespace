/* Tree multi-select foundation and safe bulk delete. */
(function initialisePocketMultiSelect(global) {
  "use strict";

  const STYLE_ID = "pocketMultiSelectStyles";
  let installed = false;

  function cleanId(value) {
    if (typeof cleanText === "function") return cleanText(value, 80);
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
  }

  function ensureState() {
    if (typeof state !== "object" || !state) return new Set();
    if (!(state.multiSelectedIds instanceof Set)) {
      const raw = Array.isArray(state.multiSelectedIds) ? state.multiSelectedIds : [];
      state.multiSelectedIds = new Set(raw.map(cleanId).filter(Boolean));
    }
    state.multiSelectAnchorId = cleanId(state.multiSelectAnchorId);
    return state.multiSelectedIds;
  }

  function getMap() {
    if (typeof nodeMap === "function") return nodeMap();
    return new Map((state.nodes || []).map((node) => [node.id, node]));
  }

  function getChildren() {
    if (typeof childrenMap === "function") return childrenMap();
    const map = new Map();
    for (const node of state.nodes || []) {
      const parentId = node.parentId || "root";
      if (!map.has(parentId)) map.set(parentId, []);
      map.get(parentId).push(node);
    }
    return map;
  }

  function visibleIds() {
    const root = typeof el === "object" && el && el.treeRoot;
    if (!(root instanceof HTMLElement)) return [];
    return Array.from(root.querySelectorAll(".row[data-node-id]"))
      .map((row) => cleanId(row.getAttribute("data-node-id")))
      .filter(Boolean);
  }

  function rowForId(nodeId) {
    const id = cleanId(nodeId);
    const root = typeof el === "object" && el && el.treeRoot;
    if (!id || !(root instanceof HTMLElement)) return null;
    return Array.from(root.querySelectorAll(".row[data-node-id]"))
      .find((row) => cleanId(row.getAttribute("data-node-id")) === id) || null;
  }

  function getSelectedNodeIdsForBulk() {
    const selected = new Set();
    const extras = ensureState();
    const primaryId = cleanId(state.selectedId);
    if (primaryId) selected.add(primaryId);
    extras.forEach((id) => {
      const clean = cleanId(id);
      if (clean) selected.add(clean);
    });
    const map = getMap();
    return Array.from(selected).filter((id) => map.has(id));
  }

  function getMultiSelectedCount() {
    return getSelectedNodeIdsForBulk().length;
  }

  function hasActiveMultiSelection() {
    return getMultiSelectedCount() > 1;
  }

  function isNodeInCurrentSelection(nodeId) {
    return getSelectedNodeIdsForBulk().includes(cleanId(nodeId));
  }

  function syncRowClasses() {
    const extras = ensureState();
    const primaryId = cleanId(state.selectedId);
    const root = typeof el === "object" && el && el.treeRoot;
    if (!(root instanceof HTMLElement)) return;
    root.querySelectorAll(".row.multiSelected").forEach((row) => row.classList.remove("multiSelected"));
    extras.forEach((id) => {
      if (id === primaryId) return;
      const row = rowForId(id);
      if (row) row.classList.add("multiSelected");
    });
  }

  function updateMultiPill() {
    const count = getMultiSelectedCount();
    if (count <= 1 || typeof el !== "object" || !el || !(el.modePill instanceof HTMLElement)) return;
    el.modePill.textContent = `${count} selected`;
    el.modePill.className = "modePill show multi";
    el.modePill.title = "Esc clears multi-selection.";
  }

  function refreshSelectionUi(options = {}) {
    if (typeof refreshMeta === "function") refreshMeta();
    syncRowClasses();
    updateMultiPill();
    if (options.status && hasActiveMultiSelection() && typeof setStatus === "function") {
      setStatus(`${getMultiSelectedCount()} selected`, "ok", { durationMs: 2200 });
    }
  }

  function focusPrimary(id) {
    if (typeof focusRowByNodeId === "function") {
      focusRowByNodeId(id, { block: "nearest" });
      return;
    }
    const row = rowForId(id);
    if (row) row.focus({ preventScroll: true });
  }

  function clearMultiSelection(options = {}) {
    const extras = ensureState();
    const hadSelection = extras.size > 0;
    extras.clear();
    state.multiSelectAnchorId = cleanId(state.selectedId);
    if (hadSelection && !options.silent) {
      refreshSelectionUi();
      if (typeof renderTree === "function") renderTree();
      focusPrimary(state.selectedId);
      if (typeof setStatus === "function") setStatus("Multi-selection cleared.", "ok");
    }
    return hadSelection;
  }

  function applyMultiSelection(primaryId, extraIds, anchorId) {
    const id = cleanId(primaryId);
    const map = getMap();
    if (!id || !map.has(id)) return false;
    const extras = ensureState();
    extras.clear();
    for (const rawId of extraIds || []) {
      const extraId = cleanId(rawId);
      if (extraId && extraId !== id && map.has(extraId)) extras.add(extraId);
    }
    state.selectedId = id;
    state.multiSelectAnchorId = cleanId(anchorId || id);
    if (typeof renderTree === "function") renderTree();
    else refreshSelectionUi();
    focusPrimary(id);
    if (typeof saveWorkspaceState === "function") saveWorkspaceState();
    refreshSelectionUi({ status: true });
    return true;
  }

  function applyCtrlSelection(nodeId) {
    const id = cleanId(nodeId);
    if (!id) return false;
    const previousPrimaryId = cleanId(state.selectedId);
    const nextExtras = new Set(ensureState());

    if (id === previousPrimaryId) {
      nextExtras.clear();
    } else if (nextExtras.has(id)) {
      nextExtras.delete(id);
      if (previousPrimaryId) nextExtras.add(previousPrimaryId);
    } else {
      if (previousPrimaryId) nextExtras.add(previousPrimaryId);
    }

    return applyMultiSelection(id, nextExtras, id);
  }

  function applyShiftSelection(nodeId) {
    const id = cleanId(nodeId);
    const ids = visibleIds();
    if (!id || !ids.includes(id)) return applyCtrlSelection(id);
    const currentAnchor = cleanId(state.multiSelectAnchorId);
    const anchorId = ids.includes(currentAnchor)
      ? currentAnchor
      : (ids.includes(cleanId(state.selectedId)) ? cleanId(state.selectedId) : id);
    const start = ids.indexOf(anchorId);
    const end = ids.indexOf(id);
    if (start < 0 || end < 0) return applyCtrlSelection(id);
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    const range = ids.slice(lo, hi + 1);
    return applyMultiSelection(id, range.filter((rangeId) => rangeId !== id), anchorId);
  }

  function handleTreeClick(ev) {
    const row = ev.target && ev.target.closest ? ev.target.closest(".row[data-node-id]") : null;
    const treeRoot = el && el.treeRoot;
    if (!row || !(treeRoot instanceof HTMLElement) || !treeRoot.contains(row)) return;
    const id = cleanId(row.getAttribute("data-node-id"));
    if (!id || ev.altKey) return;

    const multiKey = !!(ev.metaKey || ev.ctrlKey);
    const rangeKey = !!ev.shiftKey;
    if (!multiKey && !rangeKey) {
      clearMultiSelection({ silent: true });
      state.multiSelectAnchorId = id;
      return;
    }

    ev.preventDefault();
    ev.stopPropagation();
    if (typeof cancelPendingCopyClick === "function") cancelPendingCopyClick();
    if (rangeKey) applyShiftSelection(id);
    else applyCtrlSelection(id);
  }

  function hasSelectedAncestor(nodeId, selectedIds, map) {
    let node = map.get(nodeId);
    while (node && node.parentId && node.parentId !== "root") {
      if (selectedIds.has(node.parentId)) return true;
      node = map.get(node.parentId);
    }
    return false;
  }

  function getEffectiveMultiSelectedRootIds() {
    const map = getMap();
    const selectedIds = new Set(getSelectedNodeIdsForBulk());
    const order = visibleIds();
    return Array.from(selectedIds)
      .sort((a, b) => {
        const ai = order.indexOf(a);
        const bi = order.indexOf(b);
        if (ai >= 0 && bi >= 0) return ai - bi;
        if (ai >= 0) return -1;
        if (bi >= 0) return 1;
        return 0;
      })
      .filter((id) => !hasSelectedAncestor(id, selectedIds, map));
  }

  function collectSubtreeIds(rootIds) {
    const byParent = getChildren();
    const seen = new Set();
    const ids = [];
    const q = rootIds.slice();
    while (q.length > 0) {
      const id = q.shift();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      for (const kid of byParent.get(id) || []) q.push(kid.id);
    }
    return ids;
  }

  function fallbackSelection(dropIds, rootIds) {
    const drop = new Set(dropIds);
    const order = visibleIds();
    const firstRootIndex = order.findIndex((id) => rootIds.includes(id));
    if (firstRootIndex >= 0) {
      for (let i = firstRootIndex + 1; i < order.length; i += 1) {
        if (!drop.has(order[i])) return order[i];
      }
      for (let i = firstRootIndex - 1; i >= 0; i -= 1) {
        if (!drop.has(order[i])) return order[i];
      }
    }
    const map = getMap();
    for (const rootId of rootIds) {
      const parentId = cleanId(map.get(rootId)?.parentId);
      if (parentId && parentId !== "root" && !drop.has(parentId)) return parentId;
    }
    return "";
  }

  function savePreDeleteSnapshot() {
    if (typeof saveLastSaveSnapshot !== "function" || typeof nowIso !== "function") return;
    const writtenAt = nowIso();
    saveLastSaveSnapshot({
      ...(state.rootExtras || {}),
      schema: "portal.export.v1",
      exportedAt: writtenAt,
      writtenAt,
      mainThoughtTree: state.nodes,
      mainThoughtTreeTombstones: state.tombstones,
      data: {
        ...(state.dataExtras || {}),
        mainThoughtTree: state.nodes,
        mainThoughtTreeTombstones: state.tombstones,
      },
    });
  }

  function deleteMultiSelectionIfActive() {
    if (!hasActiveMultiSelection()) return false;
    const rootIds = getEffectiveMultiSelectedRootIds();
    if (!rootIds.length) return false;
    const ok = global.confirm(
      rootIds.length === 1
        ? "Delete 1 selected node and its children?"
        : `Delete ${rootIds.length} selected nodes and their children?`
    );
    if (!ok) {
      if (typeof setStatus === "function") setStatus("Delete cancelled.", "ok");
      focusPrimary(state.selectedId);
      return true;
    }

    const ids = collectSubtreeIds(rootIds);
    const drop = new Set(ids);
    const nextSelectedId = fallbackSelection(ids, rootIds);

    savePreDeleteSnapshot();
    if (
      typeof createTreeUndoSnapshot === "function"
      && typeof lastDeleteUndoSnapshot !== "undefined"
      && typeof lastTreeUndoKind !== "undefined"
    ) {
      lastDeleteUndoSnapshot = createTreeUndoSnapshot("delete_many");
      lastTreeUndoKind = "delete";
    }
    state.nodes = state.nodes.filter((node) => !drop.has(node.id));
    state.tombstones.push(...ids.map((id) => ({ id, deletedAt: typeof nowIso === "function" ? nowIso() : new Date().toISOString() })));
    if (typeof recordOp === "function") {
      recordOp({ type: "delete_many", ids: rootIds, rootCount: rootIds.length, subtreeCount: ids.length });
    }
    if (state.focusRootId && drop.has(state.focusRootId)) state.focusRootId = "";
    if (state.inlineEdit && state.inlineEdit.id && drop.has(state.inlineEdit.id) && typeof clearInlineEditState === "function") {
      clearInlineEditState();
    }
    state.selectedId = nextSelectedId;
    clearMultiSelection({ silent: true });

    const childCount = Math.max(0, ids.length - rootIds.length);
    const rootText = `${rootIds.length} selected node${rootIds.length === 1 ? "" : "s"}`;
    const childText = childCount > 0 ? ` and ${childCount} child item${childCount === 1 ? "" : "s"}` : "";
    if (typeof setStatus === "function") {
      setStatus(`Deleted ${rootText}${childText}. Ctrl+Z to undo.`, "ok", {
        action: typeof undoLastDeleteAction === "function"
          ? { label: "Undo", onClick: () => undoLastDeleteAction() }
          : null,
      });
    }
    if (typeof refreshMeta === "function") refreshMeta();
    if (typeof renderTree === "function") renderTree();
    focusPrimary(state.selectedId);
    if (typeof softlyEnsureSelectionVisible === "function") softlyEnsureSelectionVisible();
    if (typeof persistPipSnapshot === "function") persistPipSnapshot();
    return true;
  }

  function handleEscape(ev) {
    if (ev.key !== "Escape" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    if (!hasActiveMultiSelection()) return;
    const target = ev.target;
    if (target && target.closest && target.closest("input, textarea, select, [contenteditable='true'], dialog, [role='dialog'], .menu, .contextMenu, .commandOverlay")) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    clearMultiSelection();
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .row.multiSelected {
        background: rgba(37, 99, 235, 0.035);
        border-color: rgba(37, 99, 235, 0.12);
      }
      .modePill.multi {
        color: rgba(29, 78, 216, 0.84);
        border-color: rgba(37, 99, 235, 0.22);
        background: rgba(37, 99, 235, 0.055);
      }
    `;
    document.head.appendChild(style);
  }

  function wrapFunctions() {
    const originalRenderTree = global.renderTree;
    if (typeof originalRenderTree === "function" && !originalRenderTree.__pocketMultiSelectWrapped) {
      global.renderTree = function renderTreeWithMultiSelection() {
        const result = originalRenderTree.apply(this, arguments);
        syncRowClasses();
        updateMultiPill();
        return result;
      };
      global.renderTree.__pocketMultiSelectWrapped = true;
    }

    const originalRefreshMeta = global.refreshMeta;
    if (typeof originalRefreshMeta === "function" && !originalRefreshMeta.__pocketMultiSelectWrapped) {
      global.refreshMeta = function refreshMetaWithMultiSelection() {
        const result = originalRefreshMeta.apply(this, arguments);
        updateMultiPill();
        return result;
      };
      global.refreshMeta.__pocketMultiSelectWrapped = true;
    }

    const originalDeleteSelected = global.deleteSelected;
    if (typeof originalDeleteSelected === "function" && !originalDeleteSelected.__pocketMultiSelectWrapped) {
      global.deleteSelected = function deleteSelectedWithMultiSelection() {
        if (deleteMultiSelectionIfActive()) return;
        return originalDeleteSelected.apply(this, arguments);
      };
      global.deleteSelected.__pocketMultiSelectWrapped = true;
    }
  }

  function install() {
    if (installed || typeof state !== "object" || !state || typeof el !== "object" || !el) return;
    installed = true;
    ensureState();
    injectStyles();
    wrapFunctions();
    if (el.treeWrap instanceof HTMLElement) {
      el.treeWrap.addEventListener("click", handleTreeClick, true);
    }
    document.addEventListener("keydown", handleEscape, true);
    refreshSelectionUi();
  }

  global.getSelectedNodeIdsForBulk = getSelectedNodeIdsForBulk;
  global.getMultiSelectedCount = getMultiSelectedCount;
  global.hasActiveMultiSelection = hasActiveMultiSelection;
  global.isNodeInCurrentSelection = isNodeInCurrentSelection;
  global.clearMultiSelection = clearMultiSelection;
  global.getEffectiveMultiSelectedRootIds = getEffectiveMultiSelectedRootIds;
  global.deleteMultiSelectionIfActive = deleteMultiSelectionIfActive;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    global.setTimeout(install, 0);
  }
})(window);
