/* Popout source lock.
   The popout button inside the detail editor must open that detail-editor item,
   even if the tree selection has moved elsewhere. */

(function initialisePocketEditorPopoutSourceLock(global) {
  "use strict";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function lockPopoutToDetailEditorItem() {
    const detailId = clean(global.state?.detailsEdit?.id, 80);
    if (!detailId) return;
    const map = typeof nodeMap === "function" ? nodeMap() : null;
    if (!map || !map.get(detailId)) return;

    global.state.selectedId = detailId;
    global.__pocketDetailPopoutSourceId = detailId;

    if (typeof focusRowByNodeId === "function") {
      requestAnimationFrame(() => focusRowByNodeId(detailId, { instant: true }));
    }
  }

  function init() {
    const button = document.getElementById("btnDetailPopout");
    if (!button) return;
    button.addEventListener("click", lockPopoutToDetailEditorItem, true);
  }

  global.PocketEditorPopoutSourceLock = Object.freeze({ lock: lockPopoutToDetailEditorItem });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
