/* Editor visual sync.
   After opening popout, make the normal detail editor show the same selected item. */

(function initialisePocketEditorVisualSync(global) {
  "use strict";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function syncDetailEditorToSelected() {
    const selectedId = clean(global.state?.selectedId, 80);
    const detailId = clean(global.state?.detailsEdit?.id, 80);
    if (!selectedId || selectedId === detailId) return;
    if (typeof hasUnsavedDetailsEditorChanges === "function" && hasUnsavedDetailsEditorChanges()) return;
    if (typeof closeDetailsEditor === "function") closeDetailsEditor({ restoreFocus: false, nodeId: selectedId });
    if (typeof openDetailsEditorForSelectedNode === "function") openDetailsEditorForSelectedNode();
    if (typeof PocketDetailDirtyState?.refresh === "function") requestAnimationFrame(PocketDetailDirtyState.refresh);
  }

  function init() {
    const button = document.getElementById("btnDetailPopout");
    if (!button) return;
    button.addEventListener("click", () => {
      setTimeout(syncDetailEditorToSelected, 120);
    });
  }

  global.PocketEditorVisualSync = Object.freeze({ sync: syncDetailEditorToSelected });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
