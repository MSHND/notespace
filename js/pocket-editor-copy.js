/* Unfolding, details editor, copy-template behaviours, urgent collector. */

function getExpandableIds() {
  const byParent = childrenMap();
  return state.nodes
    .filter((n) => ((byParent.get(n.id) || []).length > 0))
    .map((n) => n.id);
}

function collapseAllNodes() {
  state.collapsed = new Set(getExpandableIds());
}

function unfoldAllNodes() {
  for (const id of getExpandableIds()) state.collapsed.delete(id);
}

function expandPathToNode(nodeId) {
  const map = nodeMap();
  let cur = map.get(nodeId) || null;
  let guard = 0;
  while (cur && guard < 200) {
    state.collapsed.delete(cur.id);
    if (!cur.parentId || cur.parentId === "root") break;
    cur = map.get(cur.parentId) || null;
    guard += 1;
  }
}

function toggleUnfoldAll() {
  const expandableIds = getExpandableIds();
  if (expandableIds.length === 0) {
    setStatus("Nothing to fold or unfold.", "warn");
    return;
  }
  const anyCollapsed = expandableIds.some((id) => state.collapsed.has(id));
  if (anyCollapsed) {
    for (const id of expandableIds) state.collapsed.delete(id);
    setStatus("Unfolded all.", "ok");
  } else {
    for (const id of expandableIds) state.collapsed.add(id);
    setStatus("Folded all.", "ok");
  }
  refreshMeta();
  renderTree();
  refocusTreeNavigation(state.selectedId);
    softlyEnsureSelectionVisible();
  persistPipSnapshot();
}

function isDetailsEditorOpen() {
  return !!state.detailsEdit.id && !(el.detailOverlay?.hidden ?? true);
}

function hasUnsavedDetailsEditorChanges() {
  if (!isDetailsEditorOpen()) return false;
  const nodeId = cleanText(state.detailsEdit.id, 80);
  const node = nodeId ? (nodeMap().get(nodeId) || null) : null;
  const baseLabel = node ? cleanText(node.label, 220) : cleanText(state.detailsEdit.originalLabel, 220);
  const baseBody = node
    ? composeDetailsEditorValue(node.details, node.urgent)
    : normaliseDetails(state.detailsEdit.originalDetails, 4000);
  const baseUrgent = node
    ? normaliseUrgentFlag(node.urgent)
    : normaliseUrgentFlag(state.detailsEdit.originalUrgent);
  const baseCopyContext = node
    ? normaliseCopyContextFlag(node.copyContext)
    : normaliseCopyContextFlag(state.detailsEdit.originalCopyContext);
  const nextLabel = cleanText(el.detailEditorLabel?.value, 220);
  const nextBody = normaliseDetails(el.detailEditorBody?.value, 4000);
  const parsedBody = parseUrgentDetailsBody(nextBody);
  const nextUrgent = (el.detailEditorUrgent instanceof HTMLInputElement && el.detailEditorUrgent.checked)
    || parsedBody.urgent;
  const nextCopyContext = el.detailEditorCopyContext instanceof HTMLInputElement
    ? !!el.detailEditorCopyContext.checked
    : false;
  return (
    nextLabel !== baseLabel
    || parsedBody.details !== normaliseDetails(baseBody, 4000)
    || nextUrgent !== baseUrgent
    || nextCopyContext !== baseCopyContext
  );
}

function hasUnsavedPocketLiteChanges() {
  return (Array.isArray(state.ops) && state.ops.length > 0)
    || hasUnsavedDetailsEditorChanges();
}

function handlePocketLiteBeforeUnload(ev) {
  if (!hasUnsavedPocketLiteChanges()) return undefined;
  ev.preventDefault();
  ev.returnValue = UNSAVED_CLOSE_MESSAGE;
  return UNSAVED_CLOSE_MESSAGE;
}

function notifyPipDirtyState() {
  if (!isPipMode || window.parent === window) return;
  try {
    window.parent.postMessage({
      type: "pocketLite:dirtyState",
      dirty: hasUnsavedPocketLiteChanges(),
    }, "*");
  } catch {}
}

window.__pocketLiteHasUnsavedChanges = hasUnsavedPocketLiteChanges;

function exportPocketLiteSessionState(options = {}) {
  if (options.commitDetails === true && hasUnsavedDetailsEditorChanges()) {
    saveDetailsEditor();
  }
  return {
    dirty: hasUnsavedPocketLiteChanges(),
    source: { ...(state.source || {}) },
    nodes: JSON.parse(JSON.stringify(state.nodes || [])),
    tombstones: JSON.parse(JSON.stringify(state.tombstones || [])),
    rootExtras: JSON.parse(JSON.stringify(state.rootExtras || {})),
    dataExtras: JSON.parse(JSON.stringify(state.dataExtras || {})),
    selectedId: cleanText(state.selectedId, 80),
    focusRootId: cleanText(state.focusRootId, 80),
    collapsedIds: Array.from(state.collapsed || []),
    ops: JSON.parse(JSON.stringify(state.ops || [])),
  };
}

function adoptPocketLiteSessionState(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  const nodes = normaliseNodes(snapshot.nodes);
  if (!Array.isArray(nodes) || nodes.length === 0) return false;
  state.nodes = nodes;
  state.tombstones = Array.isArray(snapshot.tombstones) ? snapshot.tombstones : [];
  state.rootExtras = (snapshot.rootExtras && typeof snapshot.rootExtras === "object" && !Array.isArray(snapshot.rootExtras))
    ? normaliseRootExtras(snapshot.rootExtras) || {}
    : {};
  state.dataExtras = (snapshot.dataExtras && typeof snapshot.dataExtras === "object" && !Array.isArray(snapshot.dataExtras))
    ? normaliseRootExtras(snapshot.dataExtras) || {}
    : {};
  state.ops = Array.isArray(snapshot.ops) ? snapshot.ops : [];
  state.selectedId = cleanText(snapshot.selectedId, 80);
  state.focusRootId = cleanText(snapshot.focusRootId, 80);
  state.collapsed = new Set(Array.isArray(snapshot.collapsedIds) ? snapshot.collapsedIds.map((id) => cleanText(id, 80)).filter(Boolean) : []);
  state.source = {
    schema: cleanText(snapshot.source && snapshot.source.schema, 80),
    fileName: cleanText(snapshot.source && snapshot.source.fileName, 120),
    writtenAt: cleanText(snapshot.source && snapshot.source.writtenAt, 40),
  };
  refreshMeta();
  renderTree();
  persistPipSnapshot();
  setStatus("PiP changes returned. Save to keep them in the truth file.", "warn");
  return true;
}

window.__pocketLiteExportSessionState = exportPocketLiteSessionState;

async function saveThroughPipHost() {
  let hostSave = null;
  try {
    hostSave = window.parent && window.parent !== window
      ? window.parent.__pocketLiteSaveFromPip
      : null;
  } catch {}
  if (typeof hostSave !== "function") {
    setStatus("PiP cannot write the truth file directly here. Use Save in the main pocket window.", "warn");
    return false;
  }
  try {
    const result = await hostSave(exportPocketLiteSessionState({ commitDetails: true }));
    if (result && result.ok) {
      state.ops = [];
      refreshMeta();
      persistPipSnapshot();
      flashSaveChip("Safe");
      setStatus("Saved via main pocket window.", "ok");
      return true;
    }
    const errorText = cleanText(result && result.error, 180)
      || "PiP save could not write the truth file. Use Save in the main pocket window.";
    setStatus(errorText, "warn");
    return false;
  } catch {
    setStatus("Popout save could not reach the main pocket window.", "warn");
    return false;
  }
}

function restoreDetailsDraftOriginal() {
  const edit = state.detailsEdit || {};
  if (!edit.draftOpRecorded) return false;
  const nodeId = cleanText(edit.id, 80);
  const node = nodeId ? (nodeMap().get(nodeId) || null) : null;
  if (!node) return false;
  node.label = cleanText(edit.originalLabel, 220) || node.label;
  const originalDetails = normaliseDetails(edit.originalDetails, 4000);
  if (originalDetails) node.details = originalDetails;
  else delete node.details;
  if (normaliseUrgentFlag(edit.originalUrgent)) node.urgent = true;
  else delete node.urgent;
  if (normaliseCopyContextFlag(edit.originalCopyContext)) node.copyContext = true;
  else delete node.copyContext;
  node.updatedAt = nowIso();
  const opsStart = Number(edit.opsStartLength);
  if (Number.isFinite(opsStart) && opsStart >= 0) {
    state.ops = Array.isArray(state.ops) ? state.ops.slice(0, opsStart) : [];
  }
  refreshMeta();
  renderTree();
  persistPipSnapshot();
  return true;
}

function stageDetailsEditorDraft() {
  if (!isDetailsEditorOpen()) return false;
  const nodeId = cleanText(state.detailsEdit.id, 80);
  const node = nodeId ? (nodeMap().get(nodeId) || null) : null;
  if (!node) return false;
  const nextLabel = cleanText(el.detailEditorLabel?.value, 220);
  const parsedDetails = parseUrgentDetailsBody(String(el.detailEditorBody?.value || ""));
  const nextDetails = parsedDetails.details;
  const nextUrgent = (el.detailEditorUrgent instanceof HTMLInputElement && el.detailEditorUrgent.checked)
    || parsedDetails.urgent;
  const nextCopyContext = el.detailEditorCopyContext instanceof HTMLInputElement
    ? !!el.detailEditorCopyContext.checked
    : false;
  let changed = false;
  if (nextLabel && nextLabel !== cleanText(node.label, 220)) {
    node.label = nextLabel;
    changed = true;
  }
  if (nextUrgent !== normaliseUrgentFlag(node.urgent)) {
    if (nextUrgent) node.urgent = true;
    else delete node.urgent;
    changed = true;
  }
  if (nextCopyContext !== normaliseCopyContextFlag(node.copyContext)) {
    if (nextCopyContext) node.copyContext = true;
    else delete node.copyContext;
    changed = true;
  }
  if (nextDetails !== normaliseDetails(node.details, 4000)) {
    if (nextDetails) node.details = nextDetails;
    else delete node.details;
    changed = true;
  }
  if (!changed) {
    refreshMeta();
    return false;
  }
  node.updatedAt = nowIso();
  if (!state.detailsEdit.draftOpRecorded) {
    recordOp({
      type: "details_draft",
      id: node.id,
      path: getPath(node.id),
      changed: "details",
    });
    state.detailsEdit.draftOpRecorded = true;
  }
  refreshMeta();
  renderTree();
  persistPipSnapshot();
  return true;
}

function closeDetailsEditor(options = {}) {
  if (options.revertDraft === true) restoreDetailsDraftOriginal();
  if (el.detailOverlay instanceof HTMLElement) {
    el.detailOverlay.hidden = true;
  }
  const preferredNodeId = cleanText(options.nodeId || state.selectedId, 80);
  state.detailsEdit = {
    id: "",
    originalLabel: "",
    originalDetails: "",
    originalUrgent: false,
    originalCopyContext: false,
    draftOpRecorded: false,
    opsStartLength: 0,
  };
  if (el.detailEditorUrgent instanceof HTMLInputElement) {
    el.detailEditorUrgent.checked = false;
  }
  if (el.detailEditorCopyContext instanceof HTMLInputElement) {
    el.detailEditorCopyContext.checked = false;
  }
  if (options.restoreFocus === false) return;
  refocusTreeNavigation(preferredNodeId);
}

function openDetailsEditorForSelectedNode() {
  if (!state.selectedId) {
    setStatus("Select a node first.", "warn");
    return;
  }
  const map = nodeMap();
  const node = map.get(state.selectedId);
  if (!node) {
    setStatus("Selected node was not found.", "warn");
    return;
  }
  state.detailsEdit = {
    id: node.id,
    originalLabel: cleanText(node.label, 220),
    originalDetails: normaliseDetails(node.details, 4000),
    originalUrgent: normaliseUrgentFlag(node.urgent),
    originalCopyContext: normaliseCopyContextFlag(node.copyContext),
    draftOpRecorded: false,
    opsStartLength: Array.isArray(state.ops) ? state.ops.length : 0,
  };
  if (el.detailEditorTitle) {
    el.detailEditorTitle.textContent = `Edit ${cleanText(node.label, 80) || "item"}`;
  }
  if (el.detailEditorPath) {
    const path = getPath(node.id);
    el.detailEditorPath.textContent = path ? path : "";
    el.detailEditorPath.title = path || "";
  }
  if (el.detailEditorLabel instanceof HTMLInputElement) {
    el.detailEditorLabel.value = cleanText(node.label, 220);
  }
  if (el.detailEditorBody instanceof HTMLTextAreaElement) {
    el.detailEditorBody.value = composeDetailsEditorValue(node.details, node.urgent);
  }
  if (el.detailEditorUrgent instanceof HTMLInputElement) {
    const parsedBody = parseUrgentDetailsBody(node.details);
    el.detailEditorUrgent.checked = normaliseUrgentFlag(node.urgent) || parsedBody.urgent;
  }
  if (el.detailEditorCopyContext instanceof HTMLInputElement) {
    el.detailEditorCopyContext.checked = normaliseCopyContextFlag(node.copyContext);
  }
  if (el.detailOverlay instanceof HTMLElement) {
    el.detailOverlay.hidden = false;
  }
  requestAnimationFrame(() => {
    if (el.detailEditorLabel instanceof HTMLInputElement) {
      el.detailEditorLabel.focus();
      el.detailEditorLabel.select();
    }
  });
  setStatus(`Details ready for "${cleanText(node.label, 80)}".`, "ok");
}

function saveDetailsEditor() {
  const nodeId = cleanText(state.detailsEdit.id, 80);
  if (!nodeId) {
    closeDetailsEditor({ restoreFocus: true });
    return;
  }
  const map = nodeMap();
  const node = map.get(nodeId);
  if (!node) {
    closeDetailsEditor({ restoreFocus: true });
    setStatus("Selected node was not found.", "warn");
    return;
  }
  const nextLabel = cleanText(el.detailEditorLabel?.value, 220);
  const rawBodyValue = String(el.detailEditorBody?.value || "");
  const completionRequested = hasCompletionTag(rawBodyValue);
  const parentId = cleanText(node.parentId, 80) || "root";
  const parentNode = parentId === "root" ? null : (map.get(parentId) || null);
  const canApplyCompletionMove = (
    completionRequested
    && !isManagedSystemBucketNode(node)
    && !(parentNode && isCompletedSystemBucketNode(parentNode))
  );
  const parsedDetails = parseUrgentDetailsBody(
    canApplyCompletionMove ? stripCompletionTags(rawBodyValue) : rawBodyValue
  );
  const nextUrgent = (el.detailEditorUrgent instanceof HTMLInputElement && el.detailEditorUrgent.checked)
    || parsedDetails.urgent;
  const nextCopyContext = el.detailEditorCopyContext instanceof HTMLInputElement
    ? !!el.detailEditorCopyContext.checked
    : false;
  if (!nextLabel) {
    setStatus("Name cannot be blank.", "warn");
    if (el.detailEditorLabel instanceof HTMLInputElement) {
      el.detailEditorLabel.focus();
      el.detailEditorLabel.select();
    }
    return;
  }
  const nextDetails = parsedDetails.details;
  const prevLabel = cleanText(node.label, 220);
  const prevDetails = normaliseDetails(node.details, 4000);
  const prevUrgent = normaliseUrgentFlag(node.urgent);
  const prevCopyContext = normaliseCopyContextFlag(node.copyContext);
  const labelChanged = nextLabel !== prevLabel;
  const detailsChanged = nextDetails !== prevDetails;
  const urgentChanged = nextUrgent !== prevUrgent;
  const copyContextChanged = nextCopyContext !== prevCopyContext;
  const hasFieldChanges = labelChanged || detailsChanged || urgentChanged || copyContextChanged;
  const hadDraftChanges = !!state.detailsEdit.draftOpRecorded;
  if (!hasFieldChanges && !canApplyCompletionMove) {
    closeDetailsEditor({ restoreFocus: true, nodeId });
    setStatus(
      hadDraftChanges ? `Saved details for "${nextLabel}". Save pocket to keep them.` : "No detail changes.",
      hadDraftChanges ? "ok" : "warn"
    );
    return;
  }
  node.label = nextLabel;
  if (nextUrgent) node.urgent = true;
  else delete node.urgent;
  if (nextCopyContext) node.copyContext = true;
  else delete node.copyContext;
  if (nextDetails) node.details = nextDetails;
  else delete node.details;
  node.updatedAt = nowIso();
  let completionResult = { moved: false, bucketId: "" };
  if (canApplyCompletionMove) {
    completionResult = moveNodeIntoCompletedSystemBucket(node.id);
  }
  const changed = hasFieldChanges || completionResult.moved;
  if (!changed) {
    closeDetailsEditor({ restoreFocus: true, nodeId });
    setStatus("No detail changes.", "warn");
    return;
  }

  const changedParts = [];
  if (labelChanged) changedParts.push("name");
  if (detailsChanged) changedParts.push("details");
  if (urgentChanged) changedParts.push("urgent");
  if (copyContextChanged) changedParts.push("copy context");
  if (completionResult.moved) changedParts.push("completed");
  recordOp({
    type: "details_edit",
    id: node.id,
    path: getPath(node.id),
    changed: changedParts.join("+"),
  });

  refreshMeta();
  renderTree();
  persistPipSnapshot();
  if (completionResult.moved && completionResult.bucketId) {
    state.selectedId = completionResult.bucketId;
    expandPathToNode(completionResult.bucketId);
  }
  const focusAfterDetailsId = completionResult.moved && completionResult.bucketId ? completionResult.bucketId : node.id;
  if (!completionResult.moved) state.selectedId = node.id;
  closeDetailsEditor({
    restoreFocus: true,
    nodeId: focusAfterDetailsId,
  });
  requestAnimationFrame(() => flashTouchedRow(focusAfterDetailsId));
  const statusText = completionResult.moved
    ? `Saved ${changedParts.join(" + ")} for "${nextLabel}". Moved to Completed.`
    : `Saved ${changedParts.join(" + ")} for "${nextLabel}".`;
  setStatus(statusText, "ok");
}

function handleDetailsEditorKeydown(ev) {
  if (!isDetailsEditorOpen()) return;
  const target = ev.target instanceof HTMLElement ? ev.target : null;
  const isLabelField = target === el.detailEditorLabel;
  const isBodyField = target === el.detailEditorBody;
  if (ev.key === "Escape") {
    ev.preventDefault();
    closeDetailsEditor({ restoreFocus: true, revertDraft: true });
    setStatus("Details edit cancelled.", "warn");
    return;
  }
  if (
    ev.key === "Enter"
    && isLabelField
    && !ev.metaKey
    && !ev.ctrlKey
    && !ev.altKey
    && !ev.shiftKey
  ) {
    ev.preventDefault();
    saveDetailsEditor();
    return;
  }
  if (ev.key === "Enter" && isBodyField && (ev.metaKey || ev.ctrlKey)) {
    ev.preventDefault();
    saveDetailsEditor();
    return;
  }
}

function isCopyContextMarkerNode(node) {
  if (!node || typeof node !== "object") return false;
  const id = cleanText(node.id, 80);
  if (id === "m1") return true;
  if (normaliseCopyContextFlag(node.copyContext)) return true;
  const roleCandidates = [
    cleanText(node.role, 40).toLowerCase(),
    cleanText(node.copyRole, 40).toLowerCase(),
    cleanText(node?.profile?.role, 40).toLowerCase(),
    cleanText(node?.profile?.copyRole, 40).toLowerCase(),
  ];
  for (const role of roleCandidates) {
    if (role === "copy") return true;
  }
  return false;
}

function isCopyContextLabelFallbackNode(node) {
  const key = cleanText(node?.label, 220).toLowerCase();
  return key === "copy templates" || key === "copy";
}

function isCopyContextRootNode(node) {
  return isCopyContextMarkerNode(node) || isCopyContextLabelFallbackNode(node);
}

function findCopyContextRootId(nodeId) {
  const map = nodeMap();
  let cur = map.get(nodeId) || null;
  let guard = 0;
  while (cur && guard < 200) {
    if (isCopyContextRootNode(cur)) return cleanText(cur.id, 80);
    if (!cur.parentId || cur.parentId === "root") break;
    cur = map.get(cur.parentId) || null;
    guard += 1;
  }
  return "";
}

function isUnderCopyTemplates(nodeId) {
  return !!findCopyContextRootId(nodeId);
}

function isCopyFocusMode() {
  if (isPipMode) return true;
  if (!state.focusRootId) return false;
  return !!findCopyContextRootId(state.focusRootId);
}

function shouldCopyOnSingleClick(node, hasKids) {
  if (!node || hasKids) return false;
  if (isUnderCopyTemplates(node.id)) return true;
  if (isPipMode) return !hasKids;
  if (isCopyFocusMode()) return !hasKids;
  return false;
}

function copyContextPayloadForNode(node) {
  const details = normaliseDetails(node && node.details, 4000);
  if (details) {
    return {
      text: details,
      kind: "details",
      preserveLines: true,
      max: 4000,
    };
  }

  const label = cleanText(node && node.label, 220);
  return {
    text: label,
    kind: "label",
    preserveLines: false,
    max: 220,
  };
}

function cancelPendingCopyClick() {
  if (!pendingCopyClickTimer) return;
  clearTimeout(pendingCopyClickTimer);
  pendingCopyClickTimer = null;
}

function scheduleCopyClick(nodeId) {
  cancelPendingCopyClick();
  const id = cleanText(nodeId, 80);
  if (!id) return;
  pendingCopyClickTimer = window.setTimeout(() => {
    pendingCopyClickTimer = null;
    const node = nodeMap().get(id) || null;
    const payload = copyContextPayloadForNode(node);
    if (!node || !payload.text) {
      setStatus("Nothing to copy from that item.", "warn");
      return;
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
  }, COPY_CLICK_DELAY_MS);
}

function getPath(nodeId) {
  const map = nodeMap();
  const parts = [];
  let cur = map.get(nodeId) || null;
  let guard = 0;
  while (cur && guard < 200) {
    parts.push(cur.label);
    if (!cur.parentId || cur.parentId === "root") break;
    cur = map.get(cur.parentId) || null;
    guard += 1;
  }
  return parts.reverse().join(" > ");
}

function buildUrgentCollectorEntries() {
  const out = [];
  for (const node of Array.isArray(state.nodes) ? state.nodes : []) {
    const id = cleanText(node?.id, 80);
    if (!id) continue;
    const attentionState = nodeAttentionState(node);
    if (!attentionState) continue;
    const path = cleanText(getPath(id), 500) || cleanText(node?.label, 220) || id;
    out.push({ id, path, attentionState });
  }
  out.sort((left, right) => left.path.localeCompare(right.path));
  return out;
}
