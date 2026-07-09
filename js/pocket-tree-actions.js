/* Tree mutation, selection, focus, move mode, keyboard navigation. */

function sortNodesForParent(parentId) {
  const safeParentId = parentId || "root";
  return state.nodes
    .filter((n) => ((n.parentId || "root") === safeParentId))
    .sort((a, b) => compareSiblingOrder(a, b, safeParentId));
}

function renumberChildren(parentId) {
  const siblings = sortNodesForParent(parentId);
  siblings.forEach((node, index) => {
    node.order = 1001 + index;
  });
}

function insertSiblingBelow(nodeId) {
  if (typeof requirePocketFileForChanges === "function" && !requirePocketFileForChanges()) return;
  const map = nodeMap();
  const node = map.get(nodeId);
  if (!node) {
    setStatus("Node not found.", "warn");
    return;
  }
  const parentId = node.parentId || "root";
  const newNode = {
    id: makeId("node"),
    parentId,
    label: "",
    source: "manual",
    order: Number.isFinite(node.order) ? node.order + 0.5 : maxSiblingOrder(parentId) + 1,
    updatedAt: nowIso(),
  };
  lastEditUndoSnapshot = createTreeUndoSnapshot("add");
  lastTreeUndoKind = "edit";
  state.nodes.push(newNode);
  renumberChildren(parentId);
  beginInlineEdit(newNode.id, {
    isNew: true,
    originalLabel: "",
    afterId: node.id,
    parentId,
  });
  setStatus("Caught. Type, then Enter.", "ok");
}

function insertChildUnder(nodeId) {
  if (typeof requirePocketFileForChanges === "function" && !requirePocketFileForChanges()) return;
  const map = nodeMap();
  const node = map.get(nodeId);
  if (!node) {
    setStatus("Node not found.", "warn");
    return;
  }
  if (isManagedSystemBucketNode(node)) {
    setStatus("System buckets stay managed. Select a normal item first.", "warn");
    return;
  }
  const parentId = node.id;
  const newNode = {
    id: makeId("node"),
    parentId,
    label: "",
    source: "manual",
    order: maxSiblingOrder(parentId) + 1,
    updatedAt: nowIso(),
  };
  lastEditUndoSnapshot = createTreeUndoSnapshot("add");
  lastTreeUndoKind = "edit";
  state.nodes.push(newNode);
  state.collapsed.delete(parentId);
  beginInlineEdit(newNode.id, {
    isNew: true,
    originalLabel: "",
    afterId: "",
    parentId,
  });
  setStatus("Caught. Type, then Enter.", "ok");
}

function deleteNodeById(nodeId, options = {}) {
  if (typeof requirePocketFileForChanges === "function" && !requirePocketFileForChanges()) return false;
  const opts = { confirm: true, ...options };
  const map = nodeMap();
  const node = map.get(nodeId);
  if (!node) {
    setStatus("Selected node was not found.", "warn");
    return false;
  }
  const byParent = childrenMap();
  const ids = [];
  const q = [node.id];
  const seen = new Set();
  while (q.length > 0) {
    const id = q.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    const kids = byParent.get(id) || [];
    for (const k of kids) q.push(k.id);
  }
  const childCount = Math.max(0, ids.length - 1);
  const message = childCount > 0
    ? `Delete "${node.label}" and ${childCount} child item(s)?`
    : `Delete "${node.label}"?`;
  if (opts.confirm) {
    const nowMs = Date.now();
    const isArmed = pendingDeleteConfirmNodeId === node.id && pendingDeleteConfirmExpiresAt > nowMs;
    if (!isArmed) {
      const guidance = childCount > 0
        ? "This removes the whole branch."
        : "This cannot be undone except via Undo.";
      pendingDeleteConfirmNodeId = node.id;
      pendingDeleteConfirmExpiresAt = nowMs + TREE_DELETE_CONFIRM_WINDOW_MS;
      setStatus(`${message} ${guidance} Press - or Delete again to confirm.`, "", {
        durationMs: TREE_DELETE_CONFIRM_WINDOW_MS,
      });
      refocusTreeNavigation(state.selectedId || node.id);
      return false;
    }
    pendingDeleteConfirmNodeId = "";
    pendingDeleteConfirmExpiresAt = 0;
  }
  pendingDeleteConfirmNodeId = "";
  pendingDeleteConfirmExpiresAt = 0;

  // Safety snapshot before destructive delete, so Restore last can recover quickly.
  const safetyPayload = {
    ...(state.rootExtras || {}),
    schema: "portal.export.v1",
    exportedAt: nowIso(),
    writtenAt: nowIso(),
    mainThoughtTree: state.nodes,
    mainThoughtTreeTombstones: state.tombstones,
    data: {
      ...(state.dataExtras || {}),
      mainThoughtTree: state.nodes,
      mainThoughtTreeTombstones: state.tombstones,
    },
  };
  saveLastSaveSnapshot(safetyPayload);

  const drop = new Set(ids);
  lastDeleteUndoSnapshot = createTreeUndoSnapshot("delete");
  lastTreeUndoKind = "delete";
  const parentId = node.parentId || "root";
  const siblings = sortNodesForParent(parentId);
  const siblingIndex = siblings.findIndex((s) => s.id === node.id);
  const nextSiblingId = siblingIndex >= 0 && siblingIndex + 1 < siblings.length
    ? siblings[siblingIndex + 1].id
    : "";
  const prevSiblingId = siblingIndex > 0 ? siblings[siblingIndex - 1].id : "";
  const parentSelection = parentId !== "root" ? parentId : "";
  const fallbackSelection = nextSiblingId || prevSiblingId || parentSelection;
  state.nodes = state.nodes.filter((n) => !drop.has(n.id));
  state.tombstones.push(...ids.map((id) => ({ id, deletedAt: nowIso() })));
  recordOp({ type: "delete", id: node.id, subtreeCount: ids.length });
  if (state.focusRootId && drop.has(state.focusRootId)) state.focusRootId = "";
  if (state.inlineEdit.id && drop.has(state.inlineEdit.id)) clearInlineEditState();
  state.selectedId = fallbackSelection;
  const deletedLabel = ids.length === 1
    ? "Deleted 1 item. Ctrl+Z to undo."
    : `Deleted ${ids.length} items. Ctrl+Z to undo.`;
  setStatus(deletedLabel, "ok", {
    action: { label: "Undo", onClick: () => undoLastDeleteAction() },
  });
  refreshMeta();
  renderTree();
  refocusTreeNavigation(state.selectedId);
    softlyEnsureSelectionVisible();
  persistPipSnapshot();
  return true;
}

function indentNodeById(nodeId) {
  if (typeof requirePocketFileForChanges === "function" && !requirePocketFileForChanges()) return;
  const map = nodeMap();
  const node = map.get(nodeId);
  if (!node) {
    setStatus("Selected node was not found.", "warn");
    return;
  }
  const parentId = node.parentId || "root";
  const siblings = sortNodesForParent(parentId);
  const index = siblings.findIndex((s) => s.id === node.id);
  if (index <= 0) {
    setStatus("Indent needs a previous sibling.", "warn");
    return;
  }
  const previousSibling = siblings[index - 1];
  lastMoveUndoSnapshot = createTreeUndoSnapshot("indent");
  lastTreeUndoKind = "move";
  node.parentId = previousSibling.id;
  node.order = maxSiblingOrder(previousSibling.id) + 1;
  node.updatedAt = nowIso();
  renumberChildren(parentId);
  renumberChildren(previousSibling.id);
  state.selectedId = node.id;
  expandPathToNode(node.id);
  recordOp({ type: "indent", id: node.id, newParentId: previousSibling.id });
  refreshMeta();
  renderTree();
  persistPipSnapshot();
  refocusTreeNavigation(node.id);
  requestAnimationFrame(() => flashTouchedRow(node.id));
  setStatus(`Tucked under "${previousSibling.label}".`, "ok", {
    action: { label: "Undo", onClick: () => undoLastMoveAction() },
  });
}

function outdentNodeById(nodeId) {
  if (typeof requirePocketFileForChanges === "function" && !requirePocketFileForChanges()) return;
  const map = nodeMap();
  const node = map.get(nodeId);
  if (!node) {
    setStatus("Selected node was not found.", "warn");
    return;
  }
  const parentId = node.parentId || "root";
  if (parentId === "root") {
    setStatus("That node is already at the top level.", "warn");
    return;
  }
  const parent = map.get(parentId);
  if (!parent) {
    setStatus("Could not find the parent node.", "warn");
    return;
  }
  const grandParentId = parent.parentId || "root";
  lastMoveUndoSnapshot = createTreeUndoSnapshot("outdent");
  lastTreeUndoKind = "move";
  node.parentId = grandParentId;
  node.order = Number.isFinite(parent.order) ? parent.order + 0.5 : maxSiblingOrder(grandParentId) + 1;
  node.updatedAt = nowIso();
  renumberChildren(parentId);
  renumberChildren(grandParentId);
  state.selectedId = node.id;
  expandPathToNode(node.id);
  recordOp({ type: "outdent", id: node.id, newParentId: grandParentId, afterId: parent.id });
  refreshMeta();
  renderTree();
  persistPipSnapshot();
  refocusTreeNavigation(node.id);
  requestAnimationFrame(() => flashTouchedRow(node.id));
  setStatus(`Lifted up a level.`, "ok", {
    action: { label: "Undo", onClick: () => undoLastMoveAction() },
  });
}

function moveNodeWithinSiblings(nodeId, direction) {
  if (typeof requirePocketFileForChanges === "function" && !requirePocketFileForChanges()) return;
  const map = nodeMap();
  const node = map.get(nodeId);
  if (!node) {
    setStatus("Selected node was not found.", "warn");
    return;
  }
  const parentId = node.parentId || "root";
  const siblings = sortNodesForParent(parentId);
  const index = siblings.findIndex((s) => s.id === node.id);
  if (index < 0) {
    setStatus("Could not find that node among its siblings.", "warn");
    return;
  }
  const targetIndex = direction < 0 ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= siblings.length) {
    setStatus(direction < 0 ? "That node is already at the top of its level." : "That node is already at the bottom of its level.", "warn");
    return;
  }
  const moving = siblings[index];
  lastMoveUndoSnapshot = createTreeUndoSnapshot(direction < 0 ? "move_up" : "move_down");
  lastTreeUndoKind = "move";
  siblings.splice(index, 1);
  siblings.splice(targetIndex, 0, moving);
  siblings.forEach((item, i) => {
    item.order = 1001 + i;
  });
  node.updatedAt = nowIso();
  state.selectedId = node.id;
  recordOp({ type: direction < 0 ? "move_up" : "move_down", id: node.id, parentId, toIndex: targetIndex });
  refreshMeta();
  renderTree();
  saveWorkspaceState();
  persistPipSnapshot();
  refocusTreeNavigation(node.id);
  requestAnimationFrame(() => flashTouchedRow(node.id));
  setStatus(`${direction < 0 ? "Moved up" : "Moved down"}.`, "ok", {
    action: { label: "Undo", onClick: () => undoLastMoveAction() },
  });
}

function getVisibleNodeIdsInRenderOrder() {
  if (!(el.treeRoot instanceof HTMLElement)) return [];
  return Array.from(el.treeRoot.querySelectorAll(".row[data-node-id]"))
    .map((row) => cleanText(row.getAttribute("data-node-id"), 80))
    .filter(Boolean);
}

function repairVisibleSelectionAfterRender() {
  if (state.inlineEdit.id || isDetailsEditorOpen()) return;
  const visibleIds = getVisibleNodeIdsInRenderOrder();
  if (visibleIds.length === 0) return;
  const selectedId = cleanText(state.selectedId, 80);
  if (selectedId && visibleIds.includes(selectedId)) return;
  const nextId = visibleIds[0];
  state.selectedId = nextId;
  if (el.treeRoot instanceof HTMLElement) {
    const escaped = typeof CSS?.escape === "function" ? CSS.escape(nextId) : nextId.replace(/"/g, '\\"');
    const row = el.treeRoot.querySelector(`.row[data-node-id="${escaped}"]`);
    if (row instanceof HTMLElement) row.classList.add("selected");
  }
  refreshMeta();
  persistPipSnapshot();
}

function focusRowByNodeId(nodeId, options = {}) {
  const id = cleanText(nodeId, 80);
  if (!id || !(el.treeRoot instanceof HTMLElement)) return;
  requestAnimationFrame(() => {
    const escaped = typeof CSS?.escape === "function" ? CSS.escape(id) : id.replace(/"/g, '\\"');
    const row = el.treeRoot.querySelector(`.row[data-node-id="${escaped}"]`);
    if (row instanceof HTMLElement) {
      row.focus({ preventScroll: true });
      scrollRowComfortably(row, { instant: options.instant === true });
    }
  });
}

function refocusTreeNavigation(preferredNodeId = "") {
  const id = cleanText(preferredNodeId, 80) || cleanText(state.selectedId, 80);
  requestAnimationFrame(() => {
    if (id && el.treeRoot instanceof HTMLElement) {
      const escaped = typeof CSS?.escape === "function" ? CSS.escape(id) : id.replace(/"/g, '\\"');
      const row = el.treeRoot.querySelector(`.row[data-node-id="${escaped}"]`);
      if (row instanceof HTMLElement) {
        scrollRowComfortably(row);
      }
    }
    if (el.treeWrap instanceof HTMLElement) {
      el.treeWrap.focus({ preventScroll: true });
    }
  });
}





function restoreTreeNavigation(selectedId = state.selectedId) {
  requestAnimationFrame(() => {
    if (el.treeWrap instanceof HTMLElement) {
      el.treeWrap.focus({ preventScroll: true });
    }

    if (!selectedId) return;

    const row = document.querySelector(".row.selected");
    if (row instanceof HTMLElement) {
      scrollRowComfortably(row);
    }
  });
}

function softlyEnsureSelectionVisible() {
  requestAnimationFrame(() => {
    const selected = document.querySelector(".row.selected");
    if (!(selected instanceof HTMLElement)) return;

    scrollRowComfortably(selected);
  });
}

function clearFilterForCopyLoop() {
  if (!(el.search instanceof HTMLInputElement)) return false;
  const hadFilter = cleanText(el.search.value, 120).length > 0;
  if (!hadFilter) return false;
  el.search.value = "";
  resetTypeJump();
  return true;
}

function refocusFilterForCopyLoop() {
  if (!(el.search instanceof HTMLInputElement)) return;
  requestAnimationFrame(() => {
    if (!(el.search instanceof HTMLInputElement)) return;
    el.search.focus({ preventScroll: true });
    el.search.setSelectionRange(0, 0);
  });
}

function resetTypeJump() {
  state.typeJump.query = "";
  state.typeJump.cycle = 0;
  state.typeJump.lastAt = 0;
}

function hasNodeId(nodeId) {
  const id = cleanText(nodeId, 80);
  return !!id && state.nodes.some((node) => cleanText(node?.id, 80) === id);
}

function rememberFilterOrigin() {
  if (!state.navigationMemory || typeof state.navigationMemory !== "object") return;
  if (state.navigationMemory.filterSelectedId || state.navigationMemory.filterFocusRootId) return;
  state.navigationMemory.filterSelectedId = cleanText(state.selectedId, 80);
  state.navigationMemory.filterFocusRootId = cleanText(state.focusRootId, 80);
}

function clearFilterMemory() {
  if (!state.navigationMemory || typeof state.navigationMemory !== "object") return;
  state.navigationMemory.filterSelectedId = "";
  state.navigationMemory.filterFocusRootId = "";
}

function restoreRememberedSelectionAfterFilter(fallbackId = "") {
  const memory = state.navigationMemory && typeof state.navigationMemory === "object" ? state.navigationMemory : {};
  const rememberedFocusId = cleanText(memory.filterFocusRootId, 80);
  const rememberedSelectedId = cleanText(memory.filterSelectedId, 80);
  const fallback = cleanText(fallbackId || state.selectedId, 80);
  const targetId = hasNodeId(rememberedSelectedId) ? rememberedSelectedId : (hasNodeId(fallback) ? fallback : "");

  if (rememberedFocusId && hasNodeId(rememberedFocusId)) {
    state.focusRootId = rememberedFocusId;
  }
  if (targetId) {
    state.selectedId = targetId;
    expandPathToNode(targetId);
  }
  clearFilterMemory();
  return targetId;
}

function clearFilterAndReturnHome(statusText = "Filter cleared.") {
  if (!(el.search instanceof HTMLInputElement)) return false;
  const hadFilter = cleanText(el.search.value, 120).length > 0;
  if (!hadFilter) return false;
  const fallbackId = cleanText(state.selectedId, 80);
  el.search.value = "";
  resetTypeJump();
  const targetId = restoreRememberedSelectionAfterFilter(fallbackId);
  refreshMeta();
  renderTree();
  refocusTreeNavigation(targetId || state.selectedId);
  requestAnimationFrame(() => {
    if (targetId) flashTouchedRow(targetId);
    else softlyEnsureSelectionVisible();
  });
  saveWorkspaceState();
  if (statusText) setStatus(statusText, "ok");
  return true;
}

function clearFocusAndReturnHome(statusText = "Back to full pocket.") {
  if (!state.focusRootId) return false;
  const previousFocusId = cleanText(state.focusRootId, 80);
  const rememberedId = cleanText(state.navigationMemory?.preFocusSelectedId, 80);
  const targetId = hasNodeId(rememberedId) ? rememberedId : (hasNodeId(state.selectedId) ? state.selectedId : previousFocusId);
  state.focusRootId = "";
  if (state.navigationMemory && typeof state.navigationMemory === "object") {
    state.navigationMemory.preFocusSelectedId = "";
  }
  if (targetId) state.selectedId = targetId;
  expandPathToNode(targetId || previousFocusId);
  refreshMeta();
  renderTree();
  refocusTreeNavigation(targetId || previousFocusId);
  requestAnimationFrame(() => {
    if (targetId) flashTouchedRow(targetId);
    else softlyEnsureSelectionVisible();
  });
  saveWorkspaceState();
  persistPipSnapshot();
  if (statusText) setStatus(statusText, "ok");
  return true;
}

function toggleFocusHere() {
  if (!state.selectedId) {
    setStatus("Select something to focus.", "warn");
    return;
  }
  const map = nodeMap();
  const node = map.get(state.selectedId);
  if (!node) {
    setStatus("Selected node was not found.", "warn");
    return;
  }
  if (state.focusRootId === node.id) {
    clearFocusAndReturnHome("Back to full pocket.");
    return;
  }
  if (state.navigationMemory && typeof state.navigationMemory === "object") {
    state.navigationMemory.preFocusSelectedId = cleanText(state.selectedId, 80);
  }
  state.focusRootId = node.id;
  state.selectedId = node.id;
  state.collapsed.delete(node.id);
  refreshMeta();
  renderTree();
  refocusTreeNavigation(node.id);
  softlyEnsureSelectionVisible();
  persistPipSnapshot();
  setStatus("Focused. Esc returns.", "ok");
}

function selectNodeById(nodeId, options = {}) {
  const id = cleanText(nodeId, 80);
  if (!id) return false;
  if (!state.nodes.some((n) => n.id === id)) return false;
  state.selectedId = id;
  if (options.expandPath) expandPathToNode(id);
  refreshMeta();
  renderTree();
  focusRowByNodeId(id, { block: "nearest" });
  saveWorkspaceState();
  return true;
}

function moveSelectionByVisibleDelta(delta) {
  const visibleIds = getVisibleNodeIdsInRenderOrder();
    softlyEnsureSelectionVisible();
  if (visibleIds.length === 0) return false;
  const applySelection = (nodeId) => {
    const id = cleanText(nodeId, 80);
    if (!id) return false;
    if (!state.nodes.some((n) => n.id === id)) return false;
    state.selectedId = id;
    refreshMeta();
    renderTree();
    focusRowByNodeId(id, { block: "nearest" });
    return true;
  };
  if (!state.selectedId) {
    const fallbackId = delta < 0 ? visibleIds[visibleIds.length - 1] : visibleIds[0];
    return applySelection(fallbackId);
  }
  const currentIndex = visibleIds.indexOf(state.selectedId);
  if (currentIndex < 0) {
    return applySelection(visibleIds[0]);
  }
  const nextIndex = currentIndex + delta;
  if (nextIndex < 0 || nextIndex >= visibleIds.length) return false;
  return applySelection(visibleIds[nextIndex]);
}

function moveSelectionToVisibleEdge(edge) {
  const visibleIds = getVisibleNodeIdsInRenderOrder();
  if (visibleIds.length === 0) return false;
  const toEnd = cleanText(edge, 16).toLowerCase() === "end";
  const nextId = toEnd ? visibleIds[visibleIds.length - 1] : visibleIds[0];
  if (!nextId) return false;
  if (state.selectedId === nextId) return false;
  const id = cleanText(nextId, 80);
  if (!id || !state.nodes.some((n) => n.id === id)) return false;
  state.selectedId = id;
  refreshMeta();
  renderTree();
  focusRowByNodeId(id, { block: "nearest" });
  saveWorkspaceState();
  return true;
}

function jumpSelectionByTypedChar(rawKey) {
  const key = cleanText(rawKey, 8).toLowerCase();
  if (!key || key.length !== 1) return false;
  const visibleIds = getVisibleNodeIdsInRenderOrder();
  if (visibleIds.length === 0) return false;
  const map = nodeMap();
  const nowMs = Date.now();
  const activeWindowMs = 850;
  const previousQuery = cleanText(state.typeJump.query, 40).toLowerCase();
  const withinWindow = (nowMs - Number(state.typeJump.lastAt || 0)) <= activeWindowMs;
  const repeatSingleKey = previousQuery.length === 1 && previousQuery === key;
  let cycleFromCurrentSelection = false;

  if (repeatSingleKey) {
    state.typeJump.query = key;
    state.typeJump.cycle = 0;
    cycleFromCurrentSelection = true;
  } else if (!withinWindow) {
    state.typeJump.query = key;
    state.typeJump.cycle = 0;
  } else {
    state.typeJump.query = `${previousQuery}${key}`.slice(0, 40);
    state.typeJump.cycle = 0;
  }
  state.typeJump.lastAt = nowMs;

  const findMatches = (prefix) => {
    const needle = cleanText(prefix, 60).toLowerCase();
    if (!needle) return [];
    return visibleIds.filter((id) => {
      const node = map.get(id);
      const label = cleanText(node?.label || "", 200).toLowerCase();
      return label.startsWith(needle);
    });
  };

  let query = state.typeJump.query;
  let matches = findMatches(query);
  if (matches.length === 0 && query.length > 1) {
    query = key;
    matches = findMatches(query);
    state.typeJump.query = query;
    state.typeJump.cycle = 0;
    cycleFromCurrentSelection = true;
  }
  if (matches.length === 0) return false;

  let targetId = "";
  if (cycleFromCurrentSelection) {
    const currentMatchIndex = matches.indexOf(state.selectedId);
    const nextMatchIndex = currentMatchIndex >= 0 ? (currentMatchIndex + 1) % matches.length : 0;
    targetId = matches[nextMatchIndex];
  } else {
    targetId = matches[0];
  }
  if (!targetId || !state.nodes.some((n) => n.id === targetId)) return false;
  state.selectedId = targetId;
  refreshMeta();
  renderTree();
  focusRowByNodeId(targetId);
  return true;
}

function clearMoveModeIdleTimer() {
  if (moveModeIdleTimer) {
    clearTimeout(moveModeIdleTimer);
    moveModeIdleTimer = null;
  }
}

function stopMovePadRepeat() {
  if (movePadRepeatStartTimer) {
    clearTimeout(movePadRepeatStartTimer);
    movePadRepeatStartTimer = null;
  }
  if (movePadRepeatInterval) {
    clearInterval(movePadRepeatInterval);
    movePadRepeatInterval = null;
  }
}

function startMovePadRepeat(direction) {
  stopMovePadRepeat();
  moveSelectedViaPad(direction);
  if (!state.moveMode || !state.selectedId) return;
  movePadRepeatStartTimer = window.setTimeout(() => {
    movePadRepeatStartTimer = null;
    movePadRepeatInterval = window.setInterval(() => {
      if (!state.moveMode || !state.selectedId) {
        stopMovePadRepeat();
        return;
      }
      moveSelectedViaPad(direction);
    }, 95);
  }, 260);
}

function armMoveModeIdleTimer() {
  clearMoveModeIdleTimer();
  if (!state.moveMode) return;
  moveModeIdleTimer = window.setTimeout(() => {
    moveModeIdleTimer = null;
    if (!state.moveMode) return;
    state.moveMode = false;
    stopMovePadRepeat();
    refreshMeta();
    setStatus("Move mode off (idle).", "ok");
    refocusTreeNavigation(state.selectedId);
  }, 12000);
}

function toggleMoveMode(force) {
  if (!state.selectedId && force !== false) {
    setStatus("Select a node first.", "warn");
    return;
  }
  const next = typeof force === "boolean" ? force : !state.moveMode;
  if (next && typeof requirePocketFileForChanges === "function" && !requirePocketFileForChanges()) return;
  state.moveMode = !!next && !!state.selectedId;
  refreshMeta();
  if (state.moveMode) {
    const selected = nodeMap().get(state.selectedId);
    const label = cleanText(selected?.label, 120) || "item";
    setStatus(`Move "${label}": Move mode on. Use ↑ ↓ to reorder, → to indent, ← to outdent. Enter confirms, Esc cancels.`, "ok");
    armMoveModeIdleTimer();
    refocusTreeNavigation(state.selectedId);
  }
  else {
    clearMoveModeIdleTimer();
    stopMovePadRepeat();
    setStatus("Move mode off.", "ok");
    refocusTreeNavigation(state.selectedId);
  }
}

function moveSelectedViaPad(direction) {
  if (!state.selectedId) {
    setStatus("Select an item first.", "warn");
    return;
  }
  if (!state.moveMode) {
    setStatus("Turn on Move mode first.", "warn");
    return;
  }
  if (direction === "up") moveNodeWithinSiblings(state.selectedId, -1);
  else if (direction === "down") moveNodeWithinSiblings(state.selectedId, 1);
  else if (direction === "left") outdentNodeById(state.selectedId);
  else if (direction === "right") indentNodeById(state.selectedId);
  else return;
  armMoveModeIdleTimer();
  refocusTreeNavigation(state.selectedId);
}

function openRowMiniMenuForSelected() {
  const id = cleanText(state.selectedId, 80);
  if (!id) {
    setStatus("Select an item first.", "warn");
    return false;
  }
  const node = nodeMap().get(id) || null;
  if (!node) {
    setStatus("That item is not available now.", "warn");
    return false;
  }
  const anchor = document.querySelector(`[data-node-id="${CSS.escape(id)}"] .rowActionBtn.more`);
  const row = document.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
  return openRowMiniMenu(id, anchor instanceof HTMLElement ? anchor : row);
}

function shouldCopyOnTreeEnter(node) {
  if (!node) return false;
  if (typeof findCopyContextRootId === "function") {
    const rootId = cleanText(findCopyContextRootId(node.id), 80);
    if (rootId) return true;
  }
  if (typeof isCopyFocusMode === "function" && isCopyFocusMode()) return true;
  if (typeof isPipMode !== "undefined" && isPipMode) return true;
  return false;
}

function copyNodeLabelFromTreeEnter(node) {
  if (!node || typeof copyText !== "function") return false;
  cancelPendingCopyClick();
  const id = cleanText(node.id, 80);
  const payload = typeof copyContextPayloadForNode === "function"
    ? copyContextPayloadForNode(node)
    : { text: cleanText(node.label, 220), preserveLines: false, max: 220 };
  if (!id || !payload.text) {
    setStatus("Nothing to copy from that item.", "warn");
    return true;
  }
  clearFilterForCopyLoop();
  refreshMeta();
  renderTree();
  focusRowByNodeId(id);
  void copyText(payload.text, {
    preserveLines: payload.preserveLines === true,
    max: payload.max || (payload.preserveLines ? 4000 : 220),
  }).then((ok) => {
    if (ok) showCopiedFeedback(id);
    else setStatus("Copy did not work.", "warn");
  });
  return true;
}

function openPeFromTreeEnter(node) {
  const id = cleanText(node?.id, 80);
  if (!id) return false;
  cancelPendingCopyClick();
  if (typeof window.openPocketPeEditor === "function") {
    window.openPocketPeEditor(id);
    return true;
  }
  if (window.PocketPeEditor && typeof window.PocketPeEditor.open === "function") {
    window.PocketPeEditor.open(id);
    return true;
  }
  if (typeof window.openPocketNodeEditor === "function") {
    window.openPocketNodeEditor(id);
    return true;
  }
  return false;
}

function routeTreeEnterForSelectedNode() {
  const id = cleanText(state.selectedId, 80);
  if (!id) {
    setStatus("Select an item first.", "warn");
    return true;
  }
  const node = nodeMap().get(id) || null;
  if (!node) {
    setStatus("Selected node was not found.", "warn");
    return true;
  }
  if (shouldCopyOnTreeEnter(node)) return copyNodeLabelFromTreeEnter(node);
  if (openPeFromTreeEnter(node)) return true;
  setStatus("Item details are not ready yet.", "warn");
  return true;
}

function handleTreeKeydown(ev) {
  if (isDetailsEditorOpen()) return;
  if (state.inlineEdit.id) return;
  const hasPendingImport = !!pendingPathImport;
  if (
    hasPendingImport
    && !ev.metaKey
    && !ev.ctrlKey
    && !ev.altKey
    && !ev.shiftKey
    && ev.key === "Enter"
  ) {
    ev.preventDefault();
    commitPendingPathImport();
    refocusTreeNavigation(state.selectedId);
    return;
  }
  if (
    hasPendingImport
    && !ev.metaKey
    && !ev.ctrlKey
    && !ev.altKey
    && !ev.shiftKey
    && ev.key === "Escape"
  ) {
    ev.preventDefault();
    cancelPendingPathImport();
    refocusTreeNavigation(state.selectedId);
    return;
  }
  const lowerKey = String(ev.key || "").toLowerCase();
  if (
    !ev.metaKey
    && !ev.ctrlKey
    && !ev.altKey
    && !ev.shiftKey
    && (ev.key === "ContextMenu" || ev.key === ".")
  ) {
    ev.preventDefault();
    openRowMiniMenuForSelected();
    return;
  }
  if (
    !ev.metaKey
    && !ev.ctrlKey
    && !ev.altKey
    && ev.shiftKey
    && ev.key === "F10"
  ) {
    ev.preventDefault();
    openRowMiniMenuForSelected();
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && !ev.shiftKey && !ev.altKey && lowerKey === "z") {
    ev.preventDefault();
    undoMostRecentTreeMutation();
    return;
  }
  if (ev.key === "Escape" && pendingDeleteConfirmNodeId && pendingDeleteConfirmExpiresAt > Date.now()) {
    ev.preventDefault();
    pendingDeleteConfirmNodeId = "";
    pendingDeleteConfirmExpiresAt = 0;
    setStatus("Delete cancelled.", "ok");
    refocusTreeNavigation(state.selectedId);
    return;
  }
  if (
    !ev.metaKey
    && !ev.ctrlKey
    && !ev.altKey
    && !ev.shiftKey
    && ev.key === "Escape"
    && !state.moveMode
  ) {
    ev.preventDefault();
    const cleared = clearFilterAndReturnHome("Filter cleared.");
    if (!cleared) {
      const unfocused = clearFocusAndReturnHome("Back to full pocket.");
      if (!unfocused) refocusTreeNavigation(state.selectedId);
    }
    return;
  }
  if (
    !ev.metaKey
    && !ev.ctrlKey
    && !ev.altKey
    && ev.shiftKey
    && ev.key === "Tab"
  ) {
    ev.preventDefault();
    if (el.search instanceof HTMLInputElement) {
      el.search.focus({ preventScroll: true });
      el.search.select();
    }
    return;
  }
  if (
    !ev.metaKey
    && !ev.ctrlKey
    && !ev.altKey
    && !ev.shiftKey
    && ev.key === "F2"
  ) {
    ev.preventDefault();
    renameSelected();
    return;
  }
  if (
    !ev.metaKey
    && !ev.ctrlKey
    && !ev.altKey
    && ev.shiftKey
    && lowerKey === "f"
  ) {
    ev.preventDefault();
    toggleFocusHere();
    return;
  }
  if (
    !ev.metaKey
    && !ev.ctrlKey
    && !ev.altKey
    && ev.shiftKey
    && (ev.key === "+" || ev.key === "=" || ev.key === "Add")
  ) {
    ev.preventDefault();
    if (state.selectedId) insertSiblingBelow(state.selectedId);
    else addItemsFromPrimaryAction();
    return;
  }
  if (
    !ev.metaKey
    && !ev.ctrlKey
    && !ev.altKey
    && !ev.shiftKey
    && (ev.key === "=" || ev.key === "+" || ev.key === "Add")
  ) {
    ev.preventDefault();
    addItemsFromPrimaryAction();
    return;
  }
  if (
    !ev.metaKey
    && !ev.ctrlKey
    && !ev.altKey
    && !ev.shiftKey
    && (ev.key === "-" || ev.key === "Subtract" || ev.key === "Delete")
  ) {
    ev.preventDefault();
    deleteSelected();
    return;
  }
  if (
    !ev.metaKey
    && !ev.ctrlKey
    && !ev.altKey
    && !ev.shiftKey
    && ev.key.length === 1
    && /\S/.test(ev.key)
  ) {
    ev.preventDefault();
    jumpSelectionByTypedChar(ev.key);
    return;
  }
  if (
    (ev.metaKey || ev.ctrlKey)
    && !ev.shiftKey
    && !ev.altKey
    && ev.key === "ArrowLeft"
  ) {
    ev.preventDefault();
    collapseAllNodes();
    refreshMeta();
    renderTree();
    refocusTreeNavigation(state.selectedId);
    softlyEnsureSelectionVisible();
    persistPipSnapshot();
    setStatus("Folded all.", "ok");
    return;
  }
  if (
    (ev.metaKey || ev.ctrlKey)
    && !ev.shiftKey
    && !ev.altKey
    && ev.key === "ArrowRight"
  ) {
    ev.preventDefault();
    unfoldAllNodes();
    refreshMeta();
    renderTree();
    refocusTreeNavigation(state.selectedId);
    softlyEnsureSelectionVisible();
    persistPipSnapshot();
    setStatus("Unfolded all.", "ok");
    return;
  }
  if (
    (ev.metaKey || ev.ctrlKey)
    && !ev.shiftKey
    && !ev.altKey
    && (ev.key === "ArrowUp" || ev.key === "ArrowDown")
  ) {
    ev.preventDefault();
    const moved = moveSelectionToVisibleEdge(ev.key === "ArrowUp" ? "start" : "end");
    if (!moved) {
      setStatus(
        ev.key === "ArrowUp" ? "Already at the top visible item." : "Already at the bottom visible item.",
        "warn"
      );
    }
    return;
  }
  if (
    !ev.metaKey
    && !ev.ctrlKey
    && !ev.shiftKey
    && !ev.altKey
    && ["Home", "End", "PageUp", "PageDown"].includes(ev.key)
  ) {
    if (state.moveMode) return;
    ev.preventDefault();
    const goStart = ev.key === "Home" || ev.key === "PageUp";
    const moved = moveSelectionToVisibleEdge(goStart ? "start" : "end");
    if (!moved) {
      setStatus(
        goStart ? "Already at the top visible item." : "Already at the bottom visible item.",
        "warn"
      );
    }
    return;
  }
  if (
    !ev.metaKey
    && !ev.ctrlKey
    && !ev.shiftKey
    && !ev.altKey
    && typeof ev.getModifierState === "function"
    && ev.getModifierState("Fn")
    && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(ev.key)
  ) {
    if (state.moveMode) return;
    ev.preventDefault();
    const goStart = ev.key === "ArrowUp" || ev.key === "ArrowLeft";
    const moved = moveSelectionToVisibleEdge(goStart ? "start" : "end");
    if (!moved) {
      setStatus(
        goStart ? "Already at the top visible item." : "Already at the bottom visible item.",
        "warn"
      );
    }
    return;
  }
  if (state.moveMode) {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(ev.key)) {
      ev.preventDefault();
      if (ev.key === "ArrowUp") moveNodeWithinSiblings(state.selectedId, -1);
      else if (ev.key === "ArrowDown") moveNodeWithinSiblings(state.selectedId, 1);
      else if (ev.key === "ArrowLeft") outdentNodeById(state.selectedId);
      else if (ev.key === "ArrowRight") indentNodeById(state.selectedId);
      armMoveModeIdleTimer();
      refocusTreeNavigation(state.selectedId);
      return;
    }
    if (ev.key === "Enter") {
      ev.preventDefault();
      toggleMoveMode(false);
      setStatus("Move confirmed.", "ok");
      return;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      toggleMoveMode(false);
      setStatus("Move cancelled.", "ok");
      return;
    }
  }
  if (
    !ev.metaKey
    && !ev.ctrlKey
    && !ev.altKey
    && !ev.shiftKey
    && (ev.key === " " || ev.code === "Space")
  ) {
    ev.preventDefault();
    if (!state.selectedId) {
      setStatus("Select an item first.", "warn");
      return;
    }
    const map = nodeMap();
    const current = map.get(state.selectedId);
    if (!current) {
      setStatus("That item is not available now.", "warn");
      return;
    }
    const hasKids = sortNodesForParent(current.id).length > 0;
    if (!hasKids) {
      setStatus("No child items to fold.", "warn");
      return;
    }
    if (state.collapsed.has(current.id)) state.collapsed.delete(current.id);
    else state.collapsed.add(current.id);
    refreshMeta();
    renderTree();
    refocusTreeNavigation(current.id);
    softlyEnsureSelectionVisible();
    persistPipSnapshot();
    return;
  }
  if (
    !ev.metaKey
    && !ev.ctrlKey
    && !ev.altKey
    && !ev.shiftKey
    && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(ev.key)
  ) {
    ev.preventDefault();
    if (!state.selectedId) {
      moveSelectionByVisibleDelta(1);
      return;
    }
    const map = nodeMap();
    const current = map.get(state.selectedId);
    if (!current) return;
    if (ev.key === "ArrowUp") {
      moveSelectionByVisibleDelta(-1);
      return;
    }
    if (ev.key === "ArrowDown") {
      moveSelectionByVisibleDelta(1);
      return;
    }
    const kids = sortNodesForParent(current.id);
    if (ev.key === "ArrowRight") {
      if (kids.length === 0) {
        setStatus("No child items to open.", "warn");
        return;
      }
      if (state.collapsed.has(current.id)) {
        if (el.treeWrap instanceof HTMLElement) {
          el.treeWrap.focus({ preventScroll: true });
        }
        state.collapsed.delete(current.id);
        refreshMeta();
        renderTree();
        refocusTreeNavigation(current.id);
    softlyEnsureSelectionVisible();
        persistPipSnapshot();
        return;
      }
      selectNodeById(kids[0].id, { expandPath: true });
      return;
    }
    if (ev.key === "ArrowLeft") {
      if (kids.length > 0 && !state.collapsed.has(current.id)) {
        if (el.treeWrap instanceof HTMLElement) {
          el.treeWrap.focus({ preventScroll: true });
        }
        state.collapsed.add(current.id);
        refreshMeta();
        renderTree();
        refocusTreeNavigation(current.id);
    softlyEnsureSelectionVisible();
        persistPipSnapshot();
        return;
      }
      if (state.focusRootId === current.id && current.parentId && current.parentId !== "root") {
        if (el.treeWrap instanceof HTMLElement) {
          el.treeWrap.focus({ preventScroll: true });
        }
        state.focusRootId = current.parentId;
        state.selectedId = current.parentId;
        state.collapsed.add(current.parentId);
        refreshMeta();
        renderTree();
        refocusTreeNavigation(current.parentId);
        persistPipSnapshot();
        return;
      }
      if (current.parentId && current.parentId !== "root") {
        selectNodeById(current.parentId, { expandPath: true });
      }
      return;
    }
  }
  if (
    !ev.metaKey
    && !ev.ctrlKey
    && !ev.altKey
    && !ev.shiftKey
    && ev.key === "Enter"
  ) {
    ev.preventDefault();
    routeTreeEnterForSelectedNode();
    return;
  }
  if (!state.selectedId) {
    setStatus("Select an item first.", "warn");
    return;
  }
  if (ev.key !== "Tab") return;
  ev.preventDefault();
  if (ev.shiftKey) outdentNodeById(state.selectedId);
  else indentNodeById(state.selectedId);
}
