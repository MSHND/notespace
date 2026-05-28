/* Popout freshness guard.
   When opening from the normal detail editor, prefer the visible editor fields over any older popout draft. */

(function initialisePocketEditorPopoutFreshGuard(global) {
  "use strict";

  const DRAFT_KEY_PREFIX = "pocket.editorPopoutDraft.v1.";

  function safeClean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function draftKeyFor(nodeId) {
    return `${DRAFT_KEY_PREFIX}${safeClean(nodeId, 80) || "unknown"}`;
  }

  function clearStalePopoutDraftForOpenEditor() {
    const id = safeClean(global.state?.detailsEdit?.id || global.state?.selectedId, 80);
    if (!id) return;
    const hasVisibleEditor = el.detailEditorLabel instanceof HTMLInputElement
      || el.detailEditorBody instanceof HTMLTextAreaElement;
    if (!hasVisibleEditor) return;
    try {
      global.localStorage.removeItem(draftKeyFor(id));
    } catch (_error) {}
  }

  function init() {
    const button = document.getElementById("btnDetailPopout");
    if (!button) return;
    button.addEventListener("click", clearStalePopoutDraftForOpenEditor, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
