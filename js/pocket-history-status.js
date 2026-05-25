/* Operation history, undo, status toasts, save-state labelling, inline-edit setup. */

function recordOp(op) {
  state.ops.push({
    ...op,
    at: nowIso(),
  });
  saveLocalSafetySnapshot(op && op.type ? op.type : "change");
}

function cloneForUndo(value) {
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch {}
  return JSON.parse(JSON.stringify(value));
}

function createTreeUndoSnapshot(kind = "") {
  return {
    kind: cleanText(kind, 40),
    nodes: cloneForUndo(state.nodes),
    tombstones: cloneForUndo(state.tombstones),
    selectedId: cleanText(state.selectedId, 80),
    focusRootId: cleanText(state.focusRootId, 80),
    collapsed: Array.from(state.collapsed),
  };
}

function restoreTreeUndoSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.nodes)) return false;
  state.nodes = cloneForUndo(snapshot.nodes);
  state.tombstones = Array.isArray(snapshot.tombstones) ? cloneForUndo(snapshot.tombstones) : [];
  state.selectedId = cleanText(snapshot.selectedId, 80);
  state.focusRootId = cleanText(snapshot.focusRootId, 80);
  state.collapsed = new Set(Array.isArray(snapshot.collapsed) ? snapshot.collapsed : []);
  clearInlineEditState();
  state.moveMode = false;
  refreshMeta();
  renderTree();
  persistPipSnapshot();
  refocusTreeNavigation(state.selectedId);
  return true;
}

function undoLastDeleteAction() {
  if (!lastDeleteUndoSnapshot) {
    setStatus("Nothing to undo.", "warn");
    return;
  }
  const restored = restoreTreeUndoSnapshot(lastDeleteUndoSnapshot);
  if (!restored) {
    setStatus("Undo unavailable.", "warn");
    return;
  }
  lastDeleteUndoSnapshot = null;
  lastTreeUndoKind = lastMoveUndoSnapshot ? "move" : "";
  setStatus("Back where it was.", "ok");
}

function undoLastMoveAction() {
  if (!lastMoveUndoSnapshot) {
    setStatus("Nothing to undo.", "warn");
    return;
  }
  const restored = restoreTreeUndoSnapshot(lastMoveUndoSnapshot);
  if (!restored) {
    setStatus("Undo unavailable.", "warn");
    return;
  }
  lastMoveUndoSnapshot = null;
  lastTreeUndoKind = lastEditUndoSnapshot ? "edit" : (lastDeleteUndoSnapshot ? "delete" : "");
  setStatus("Back where it was.", "ok");
}

function undoLastEditAction() {
  if (!lastEditUndoSnapshot) {
    setStatus("Nothing to undo.", "warn");
    return;
  }
  const restored = restoreTreeUndoSnapshot(lastEditUndoSnapshot);
  if (!restored) {
    setStatus("Undo unavailable.", "warn");
    return;
  }
  lastEditUndoSnapshot = null;
  lastTreeUndoKind = lastMoveUndoSnapshot ? "move" : (lastDeleteUndoSnapshot ? "delete" : "");
  setStatus("Back where it was.", "ok");
}

function undoMostRecentTreeMutation() {
  if (lastTreeUndoKind === "edit" && lastEditUndoSnapshot) {
    undoLastEditAction();
    return true;
  }
  if (lastTreeUndoKind === "delete" && lastDeleteUndoSnapshot) {
    undoLastDeleteAction();
    return true;
  }
  if (lastTreeUndoKind === "move" && lastMoveUndoSnapshot) {
    undoLastMoveAction();
    return true;
  }
  if (lastEditUndoSnapshot) {
    undoLastEditAction();
    return true;
  }
  if (lastMoveUndoSnapshot) {
    undoLastMoveAction();
    return true;
  }
  if (lastDeleteUndoSnapshot) {
    undoLastDeleteAction();
    return true;
  }
  setStatus("Nothing to undo.", "warn");
  return false;
}

function compactTopStatus(text, kind = "") {
  let msg = cleanText(text, 260);
  if (!msg) return "";

  const nextIdx = msg.toLowerCase().indexOf(" next:");
  if (nextIdx > 0) msg = msg.slice(0, nextIdx).trim();
  msg = msg.replace(/\s+/g, " ").trim();

  if (!kind && msg.length > 74) {
    msg = `${msg.slice(0, 71).trimEnd()}...`;
  } else if (kind && msg.length > 86) {
    msg = `${msg.slice(0, 83).trimEnd()}...`;
  }
  return msg;
}

function setStatus(text, kind = "", options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const action = opts.action && typeof opts.action === "object" ? opts.action : null;
  const actionLabel = cleanText(action && action.label, 20);
  const actionHandler = typeof (action && action.onClick) === "function" ? action.onClick : null;
  statusActionHandler = actionLabel && actionHandler ? actionHandler : null;
  if (!el.titleToast) return;
  if (titleToastTimer) {
    clearTimeout(titleToastTimer);
    titleToastTimer = null;
  }
  if (!text) {
    el.titleToast.textContent = "";
    el.titleToast.className = "topStatusToast";
    el.titleToast.removeAttribute("tabindex");
    el.titleToast.removeAttribute("role");
    return;
  }
  const compact = compactTopStatus(text, kind);
  el.titleToast.textContent = statusActionHandler ? `${compact} · ${actionLabel}` : compact;
  el.titleToast.className = `topStatusToast${kind ? ` ${kind}` : ""}${statusActionHandler ? " action" : ""} show`;
  if (statusActionHandler) {
    el.titleToast.setAttribute("tabindex", "0");
    el.titleToast.setAttribute("role", "button");
  } else {
    el.titleToast.removeAttribute("tabindex");
    el.titleToast.removeAttribute("role");
  }
  const requestedMs = Number(opts.durationMs);
  const defaultMs = kind === "warn" ? 4200 : 3200;
  const actionMinMs = statusActionHandler ? 7000 : defaultMs;
  const hideAfterMs = Number.isFinite(requestedMs) && requestedMs > 0
    ? Math.max(actionMinMs, requestedMs)
    : actionMinMs;
  titleToastTimer = window.setTimeout(() => {
    statusActionHandler = null;
    el.titleToast.removeAttribute("tabindex");
    el.titleToast.removeAttribute("role");
    el.titleToast.classList.remove("show");
  }, hideAfterMs);
}

function formatSaveClockLabel(date = new Date()) {
  try {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
  } catch {
    const hours = String(date.getHours()).padStart(2, "0");
    const mins = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${mins}`;
  }
}

function markSavedNow(payload = null) {
  const meta = payload ? writeLastBackupMeta(payload) : readLastBackupMeta();
  lastSavedLabel = meta?.label || formatSaveClockLabel(new Date());
}

function flashSaveChip(label = "saved") {
  if (!el.btnExportTree) return;
  const nextLabel = cleanText(label, 40) || "saved";
  if (saveChipTimer) {
    clearTimeout(saveChipTimer);
    saveChipTimer = null;
  }
  el.btnExportTree.textContent = nextLabel;
  el.btnExportTree.classList.add("on");
  saveChipTimer = window.setTimeout(() => {
    el.btnExportTree.classList.remove("on");
    saveChipTimer = null;
    refreshMeta();
  }, 1200);
}

function refreshMeta() {
  if (!state.selectedId) state.moveMode = false;
  const focusPath = state.focusRootId ? getPath(state.focusRootId) : "";
  document.body.classList.toggle("focusedView", !!state.focusRootId);
  document.body.classList.toggle("moveModeActive", !!(state.moveMode && state.selectedId));
  if (el.focusPath) el.focusPath.textContent = focusPath ? `Focus: ${focusPath}` : "Focus: all";
  if (el.modePill instanceof HTMLElement) {
    const pillText = state.moveMode && state.selectedId
      ? "Move mode"
      : (state.focusRootId ? "Focused" : "");
    el.modePill.textContent = pillText;
    el.modePill.className = `modePill${pillText ? " show" : ""}${state.moveMode && state.selectedId ? " move" : (state.focusRootId ? " focus" : "")}`;
    el.modePill.title = pillText === "Move mode"
      ? "Use arrows to move. Esc exits."
      : (pillText === "Focused" ? "Esc returns to full pocket." : "");
  }
  const hasData = state.nodes.length > 0;
  const unsavedCount = Array.isArray(state.ops) ? state.ops.length : 0;
  const hasUnsavedDetails = hasUnsavedDetailsEditorChanges();
  const hasUnsaved = unsavedCount > 0 || hasUnsavedDetails;
  const hasSelection = !!state.selectedId;
  const expandableIds = getExpandableIds();
  const anyCollapsed = expandableIds.some((id) => state.collapsed.has(id));
  if (el.btnUnfoldAll) {
    el.btnUnfoldAll.disabled = !hasData || expandableIds.length === 0;
    el.btnUnfoldAll.textContent = anyCollapsed ? "Unfold" : "Fold";
  }
  if (el.btnAddPrimary) el.btnAddPrimary.disabled = false;
  if (el.btnAddMobile) el.btnAddMobile.disabled = false;
  if (document.body && document.body.classList) {
    document.body.classList.toggle("moveModeActive", !!state.moveMode && !!state.selectedId);
  }
  if (!state.moveMode || !state.selectedId) {
    stopMovePadRepeat();
  }
  if (el.btnMovePrimary) {
    el.btnMovePrimary.disabled = !hasSelection;
    el.btnMovePrimary.classList.toggle("on", !!state.moveMode && !!state.selectedId);
  }
  if (el.btnRenamePrimary) el.btnRenamePrimary.disabled = !hasSelection;
  if (el.btnDeletePrimary) el.btnDeletePrimary.disabled = !hasSelection;
  if (el.btnOpenPrimary) el.btnOpenPrimary.disabled = !hasSelection;
  const isSaving = !!state.saveInProgress;
  el.btnExportTree.disabled = !hasData || isSaving;
  el.btnExportTree.classList.remove("safetySafe", "safetyNeed", "safetyCheck");
  if (isSaving) {
    el.btnExportTree.textContent = "saving...";
    el.btnExportTree.title = "Writing pocket file";
  } else if (!saveChipTimer) {
    const backupMeta = readLastBackupMeta();
    const hasConflictRisk = !!(state.conflictGuard && state.conflictGuard.active);
    if (hasConflictRisk) {
      el.btnExportTree.textContent = "check";
      el.btnExportTree.classList.add("safetyCheck");
    } else if (hasUnsaved) {
      el.btnExportTree.textContent = "save*";
      el.btnExportTree.classList.add("safetyNeed");
    } else if (backupMeta) {
      el.btnExportTree.textContent = "save";
      el.btnExportTree.classList.add("safetySafe");
    } else {
      el.btnExportTree.textContent = "save";
    }
    el.btnExportTree.title = hasConflictRisk
      ? "This file looks older than a local/saved copy; save carefully"
      : (hasUnsavedDetails
      ? "Detail edit not saved yet"
      : (hasUnsaved
      ? `Local changes only; save ${unsavedCount} change${unsavedCount === 1 ? "" : "s"} to your pocket file`
      : (backupMeta ? `${backupProofLabel(backupMeta)} saved ${formatAgoLabel(backupMeta.exportedAt)}` : "Save a portable pocket copy")));
  }
  const movePadEnabled = !!state.moveMode && !!state.selectedId;
  if (el.btnMovePadUp) el.btnMovePadUp.disabled = !movePadEnabled;
  if (el.btnMovePadDown) el.btnMovePadDown.disabled = !movePadEnabled;
  if (el.btnMovePadLeft) el.btnMovePadLeft.disabled = !movePadEnabled;
  if (el.btnMovePadRight) el.btnMovePadRight.disabled = !movePadEnabled;
  notifyPipDirtyState();
}

function clearInlineEditState() {
  state.inlineEdit = {
    id: "",
    isNew: false,
    originalLabel: "",
    afterId: "",
    parentId: "",
    autoFocus: false,
  };
}

function clearCaptureRhythm() {
  state.captureRhythm = { parentId: "", lastAddedId: "", expiresAt: 0 };
}

function armCaptureRhythm(parentId, lastAddedId) {
  const safeParentId = cleanText(parentId, 80) || "root";
  const safeLastAddedId = cleanText(lastAddedId, 80);
  if (!safeLastAddedId) {
    clearCaptureRhythm();
    return;
  }
  state.captureRhythm = {
    parentId: safeParentId,
    lastAddedId: safeLastAddedId,
    expiresAt: Date.now() + 45000,
  };
}

function shouldContinueCaptureRhythm(selectedId) {
  const rhythm = state.captureRhythm || {};
  const safeSelectedId = cleanText(selectedId, 80);
  return !!safeSelectedId
    && cleanText(rhythm.lastAddedId, 80) === safeSelectedId
    && Number(rhythm.expiresAt || 0) > Date.now();
}

function beginInlineEdit(nodeId, options = {}) {
  const map = nodeMap();
  const node = map.get(nodeId);
  if (!node) return;
  state.selectedId = node.id;
  state.inlineEdit = {
    id: node.id,
    isNew: !!options.isNew,
    originalLabel: typeof options.originalLabel === "string" ? options.originalLabel : node.label,
    afterId: cleanText(options.afterId, 80),
    parentId: cleanText(options.parentId, 80) || (node.parentId || "root"),
    autoFocus: true,
  };
  expandPathToNode(node.id);
  refreshMeta();
  renderTree();
  persistPipSnapshot();
}

function cancelInlineEdit(nodeId) {
  if (!state.inlineEdit.id || state.inlineEdit.id !== nodeId) return;
  const edit = { ...state.inlineEdit };
  clearInlineEditState();
  if (edit.isNew) {
    clearCaptureRhythm();
    deleteNodeById(nodeId, { confirm: false });
    setStatus("New item cancelled.", "warn");
    refocusTreeNavigation();
    return;
  }
  refreshMeta();
  renderTree();
  persistPipSnapshot();
  refocusTreeNavigation(nodeId);
}

function commitInlineEdit(nodeId, rawValue, options = {}) {
  if (!state.inlineEdit.id || state.inlineEdit.id !== nodeId) return;
  const postAction = cleanText(options.postAction, 20).toLowerCase();
  const map = nodeMap();
  const node = map.get(nodeId);
  const edit = { ...state.inlineEdit };
  const slashBatch = parseCaptureSlashPathBatch(rawValue);
  if (slashBatch.matched) {
    if (!slashBatch.ok) {
      setStatus(slashBatch.message || "Use /path/item format, one per line.", "warn");
      return;
    }
    // Safety snapshot before bulk inline import, so Restore last can recover quickly.
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
    clearInlineEditState();
    if (edit.isNew && node && !state.nodes.some((entry) => (entry.parentId || "root") === node.id)) {
      state.nodes = state.nodes.filter((entry) => entry.id !== node.id);
      renumberChildren(edit.parentId || "root");
    }
    const beforeIds = new Set(state.nodes.map((entry) => entry.id));
    let focusNode = null;
    for (const entry of slashBatch.entries) {
      const parts = Array.isArray(entry?.parts)
        ? entry.parts.map((part) => cleanText(part, 120)).filter(Boolean)
        : [];
      if (parts.length < 2) continue;
      const created = ensurePathNode(parts);
      if (!focusNode && parts.length > 0) {
        focusNode = findChildByLabel("root", parts[0]) || created || null;
      }
    }
    const createdIds = state.nodes
      .map((entry) => entry.id)
      .filter((id) => !beforeIds.has(id));
    if (createdIds.length > 0) {
      recordOp({
        type: "import_paths_inline",
        pathCount: Array.isArray(slashBatch.entries) ? slashBatch.entries.length : 0,
        created: createdIds.length,
      });
    }
    if (focusNode) {
      state.selectedId = focusNode.id;
      state.focusRootId = focusNode.id;
      state.collapsed.delete(focusNode.id);
      expandPathToNode(focusNode.id);
    }
    if (el.search instanceof HTMLInputElement && cleanText(el.search.value, 120)) {
      el.search.value = "";
    }
    refreshMeta();
    renderTree();
    persistPipSnapshot();
    if (focusNode) focusRowByNodeId(focusNode.id, { block: "nearest" });
    const importedCount = Array.isArray(slashBatch.entries) ? slashBatch.entries.length : 0;
    if (createdIds.length > 0) {
      setStatus(`Imported ${importedCount} path line${importedCount === 1 ? "" : "s"} (${createdIds.length} new nodes).`, "ok");
    } else {
      setStatus(`Imported ${importedCount} path line${importedCount === 1 ? "" : "s"} (no new nodes).`, "ok");
    }
    return;
  }
  clearInlineEditState();
  if (!node) {
    refreshMeta();
    renderTree();
    persistPipSnapshot();
    refocusTreeNavigation();
    return;
  }
  const next = cleanText(rawValue, 220);
  if (!next) {
    if (edit.isNew) {
      deleteNodeById(nodeId, { confirm: false });
      setStatus("Blank item removed.", "warn");
      refocusTreeNavigation();
      return;
    }
    refreshMeta();
    renderTree();
    persistPipSnapshot();
    setStatus("Label cannot be blank.", "warn");
    refocusTreeNavigation(nodeId);
    return;
  }
  const prev = node.label;
  if (!edit.isNew && next !== prev) {
    lastEditUndoSnapshot = createTreeUndoSnapshot("rename");
    lastTreeUndoKind = "edit";
  }
  node.label = next;
  node.updatedAt = nowIso();
  if (edit.isNew) {
    recordOp({ type: "add_below", id: node.id, afterId: edit.afterId, parentId: edit.parentId, label: next });
    armCaptureRhythm(edit.parentId || node.parentId || "root", node.id);
    setStatus(`Caught.`, "ok", {
      action: { label: "Undo", onClick: () => undoLastEditAction() },
      durationMs: 7600,
    });
  } else if (next !== prev) {
    recordOp({ type: "rename", id: node.id, from: prev, to: next });
    setStatus(`Renamed.`, "ok", {
      action: { label: "Undo", onClick: () => undoLastEditAction() },
      durationMs: 7600,
    });
  }
  refreshMeta();
  renderTree();
  persistPipSnapshot();
  refocusTreeNavigation(node.id);
  requestAnimationFrame(() => flashTouchedRow(node.id));
  if (postAction === "indent") indentNodeById(node.id);
  if (postAction === "outdent") outdentNodeById(node.id);
}
