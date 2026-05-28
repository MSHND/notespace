/* Editor truth loop.
   When popout saves back into the open normal detail editor, re-base the normal editor so it agrees. */

(function initialisePocketEditorRebase(global) {
  "use strict";

  function isOpen() {
    return typeof isDetailsEditorOpen === "function" && isDetailsEditorOpen();
  }

  function clean(value, max = 220) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function normalDetails(value) {
    return typeof normaliseDetails === "function" ? normaliseDetails(value, 4000) : String(value || "").replace(/\r/g, "").trim();
  }

  function normalUrgent(value) {
    return typeof normaliseUrgentFlag === "function" ? normaliseUrgentFlag(value) : value === true;
  }

  function normalCopyContext(value) {
    return typeof normaliseCopyContextFlag === "function" ? normaliseCopyContextFlag(value) : value === true;
  }

  function rebaseOpenDetailEditorFromNode() {
    if (!isOpen()) return false;
    const id = clean(global.state?.detailsEdit?.id, 80);
    const node = id && typeof nodeMap === "function" ? nodeMap().get(id) : null;
    if (!node) return false;

    const nodeLabel = clean(node.label, 220);
    const nodeDetails = normalDetails(node.details);
    const nodeUrgent = normalUrgent(node.urgent);
    const nodeCopyContext = normalCopyContext(node.copyContext);

    if (el.detailEditorLabel instanceof HTMLInputElement) el.detailEditorLabel.value = nodeLabel;
    if (el.detailEditorBody instanceof HTMLTextAreaElement) el.detailEditorBody.value = nodeDetails;
    if (el.detailEditorUrgent instanceof HTMLInputElement) el.detailEditorUrgent.checked = nodeUrgent;
    if (el.detailEditorCopyContext instanceof HTMLInputElement) el.detailEditorCopyContext.checked = nodeCopyContext;

    global.state.detailsEdit.originalLabel = nodeLabel;
    global.state.detailsEdit.originalDetails = nodeDetails;
    global.state.detailsEdit.originalUrgent = nodeUrgent;
    global.state.detailsEdit.originalCopyContext = nodeCopyContext;
    global.state.detailsEdit.draftOpRecorded = false;
    global.state.detailsEdit.opsStartLength = Array.isArray(global.state.ops) ? global.state.ops.length : 0;

    if (typeof PocketDetailDirtyState?.refresh === "function") requestAnimationFrame(PocketDetailDirtyState.refresh);
    return true;
  }

  function looksLikePopoutSaveStatus(message) {
    const text = clean(message, 200).toLowerCase();
    return text.startsWith("saved outline for ") || text.startsWith("saved details for ");
  }

  function wrapStatus() {
    if (typeof global.setStatus !== "function") return;
    const originalSetStatus = global.setStatus;
    global.setStatus = function wrappedSetStatus(message, ...rest) {
      if (looksLikePopoutSaveStatus(message)) {
        rebaseOpenDetailEditorFromNode();
      }
      return originalSetStatus.call(this, message, ...rest);
    };
  }

  global.PocketEditorRebase = Object.freeze({ rebase: rebaseOpenDetailEditorFromNode });
  wrapStatus();
})(window);
