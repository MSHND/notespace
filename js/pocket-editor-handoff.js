/* Explicit editor handoff.
   Opening popout should feel like expanding the current detail editor, not opening a different copy. */

(function initialisePocketEditorHandoff(global) {
  "use strict";

  function currentDetailId() {
    return typeof cleanText === "function" ? cleanText(global.state?.detailsEdit?.id, 80) : String(global.state?.detailsEdit?.id || "").trim();
  }

  function hasOpenDetailEditor() {
    return typeof isDetailsEditorOpen === "function" && isDetailsEditorOpen();
  }

  function snapshotVisibleDetailEditor() {
    const id = currentDetailId();
    if (!id || !hasOpenDetailEditor()) return null;
    return {
      id,
      title: el.detailEditorLabel instanceof HTMLInputElement ? el.detailEditorLabel.value : "",
      body: el.detailEditorBody instanceof HTMLTextAreaElement ? el.detailEditorBody.value : "",
      capturedAt: new Date().toISOString()
    };
  }

  function applyVisibleEditorToNode(snapshot) {
    if (!snapshot || !snapshot.id || typeof nodeMap !== "function") return false;
    const node = nodeMap().get(snapshot.id) || null;
    if (!node) return false;

    const nextTitle = typeof cleanText === "function" ? cleanText(snapshot.title, 220) : String(snapshot.title || "").trim().slice(0, 220);
    const nextBody = typeof parseUrgentDetailsBody === "function"
      ? parseUrgentDetailsBody(String(snapshot.body || "")).details
      : String(snapshot.body || "").replace(/\r/g, "").trim();
    const nextUrgentFromBody = typeof parseUrgentDetailsBody === "function"
      ? parseUrgentDetailsBody(String(snapshot.body || "")).urgent
      : false;
    const nextUrgent = (el.detailEditorUrgent instanceof HTMLInputElement && el.detailEditorUrgent.checked) || nextUrgentFromBody;
    const nextCopyContext = el.detailEditorCopyContext instanceof HTMLInputElement ? !!el.detailEditorCopyContext.checked : false;

    let changed = false;
    if (nextTitle && nextTitle !== node.label) {
      node.label = nextTitle;
      changed = true;
    }
    if (nextBody !== (typeof normaliseDetails === "function" ? normaliseDetails(node.details, 4000) : String(node.details || "").trim())) {
      if (nextBody) node.details = nextBody;
      else delete node.details;
      changed = true;
    }
    if (typeof normaliseUrgentFlag === "function" && nextUrgent !== normaliseUrgentFlag(node.urgent)) {
      if (nextUrgent) node.urgent = true;
      else delete node.urgent;
      changed = true;
    }
    if (typeof normaliseCopyContextFlag === "function" && nextCopyContext !== normaliseCopyContextFlag(node.copyContext)) {
      if (nextCopyContext) node.copyContext = true;
      else delete node.copyContext;
      changed = true;
    }
    if (!changed) return false;

    if (typeof nowIso === "function") node.updatedAt = nowIso();
    if (global.state?.detailsEdit && !global.state.detailsEdit.draftOpRecorded && typeof recordOp === "function") {
      recordOp({ type: "details_draft", id: node.id, path: typeof getPath === "function" ? getPath(node.id) : node.id, changed: "details" });
      global.state.detailsEdit.draftOpRecorded = true;
    }
    if (typeof refreshMeta === "function") refreshMeta();
    if (typeof renderTree === "function") renderTree();
    if (typeof persistPipSnapshot === "function") persistPipSnapshot();
    return true;
  }

  function preparePopoutHandoff() {
    const snapshot = snapshotVisibleDetailEditor();
    if (!snapshot) return;
    global.__pocketDetailPopoutLaunch = snapshot;
    if (typeof stageDetailsEditorDraft === "function") stageDetailsEditorDraft();
    else applyVisibleEditorToNode(snapshot);
    if (typeof PocketDetailDirtyState?.refresh === "function") requestAnimationFrame(PocketDetailDirtyState.refresh);
  }

  function init() {
    const button = document.getElementById("btnDetailPopout");
    if (!button) return;
    button.addEventListener("click", preparePopoutHandoff, true);
  }

  global.PocketEditorHandoff = Object.freeze({ prepare: preparePopoutHandoff });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
