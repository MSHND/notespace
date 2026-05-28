/* Popout freshness guard.
   Protects visible detail-editor work without blindly discarding useful popout drafts. */

(function initialisePocketEditorPopoutFreshGuard(global) {
  "use strict";

  const DRAFT_KEY_PREFIX = "pocket.editorPopoutDraft.v1.";

  function safeClean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function normalise(value) {
    return String(value == null ? "" : value).replace(/\r/g, "").trim();
  }

  function draftKeyFor(nodeId) {
    return `${DRAFT_KEY_PREFIX}${safeClean(nodeId, 80) || "unknown"}`;
  }

  function readDraft(nodeId) {
    try {
      const raw = global.localStorage.getItem(draftKeyFor(nodeId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (safeClean(parsed.id, 80) !== safeClean(nodeId, 80)) return null;
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function clearDraft(nodeId) {
    try {
      global.localStorage.removeItem(draftKeyFor(nodeId));
    } catch (_error) {}
  }

  function currentVisibleEditorSnapshot() {
    return {
      title: el.detailEditorLabel instanceof HTMLInputElement ? el.detailEditorLabel.value : "",
      body: el.detailEditorBody instanceof HTMLTextAreaElement ? el.detailEditorBody.value : ""
    };
  }

  function resolvePopoutDraftConflict(ev) {
    const id = safeClean(global.state?.detailsEdit?.id || global.state?.selectedId, 80);
    if (!id) return;

    const hasVisibleEditor = el.detailEditorLabel instanceof HTMLInputElement
      || el.detailEditorBody instanceof HTMLTextAreaElement;
    if (!hasVisibleEditor) return;

    const draft = readDraft(id);
    if (!draft || draft.dirty !== true) return;

    const current = currentVisibleEditorSnapshot();
    const sameTitle = normalise(current.title) === normalise(draft.title);
    const sameBody = normalise(current.body) === normalise(draft.body);
    if (sameTitle && sameBody) return;

    const restoreDraft = global.confirm(
      "There is an unsaved popout draft for this item.\n\n" +
      "OK: restore the popout draft\n" +
      "Cancel: use the current detail editor text"
    );

    if (!restoreDraft) {
      clearDraft(id);
      if (typeof setStatus === "function") setStatus("Opening popout from current editor text.", "ok", { durationMs: 2800 });
    } else if (typeof setStatus === "function") {
      setStatus("Restoring previous popout draft.", "ok", { durationMs: 2800 });
    }
  }

  function init() {
    const button = document.getElementById("btnDetailPopout");
    if (!button) return;
    button.addEventListener("click", resolvePopoutDraftConflict, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
