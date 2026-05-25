/* phone mode tap behaviour: tapping a parent row opens/closes its children. */

(function initialisePocketPhoneTap(global) {
  "use strict";

  function isPhoneMode() {
    return document.body.classList.contains("phoneMode");
  }

  function isInteractiveTarget(target) {
    if (!(target instanceof Element)) return false;
    return !!target.closest("button, input, textarea, select, .phoneRowMenuBtn, .rowMiniMenu");
  }

  function nodeHasChildren(nodeId) {
    if (typeof childrenMap !== "function") return false;
    const byParent = childrenMap();
    return (byParent.get(nodeId) || []).length > 0;
  }

  function toggleNodeChildren(nodeId) {
    if (!nodeHasChildren(nodeId)) return false;

    if (typeof cancelPendingCopyClick === "function") cancelPendingCopyClick();
    state.selectedId = nodeId;

    if (state.collapsed.has(nodeId)) state.collapsed.delete(nodeId);
    else state.collapsed.add(nodeId);

    refreshMeta();
    renderTree();
    focusRowByNodeId(nodeId, { block: "nearest" });
    return true;
  }

  function initPhoneTap() {
    const treeWrap = document.getElementById("treeWrap");
    if (!treeWrap) return;

    treeWrap.addEventListener("click", (ev) => {
      if (!isPhoneMode()) return;
      if (isInteractiveTarget(ev.target)) return;

      const row = ev.target instanceof Element ? ev.target.closest(".row[data-node-id]") : null;
      if (!(row instanceof HTMLElement)) return;

      const nodeId = row.getAttribute("data-node-id") || "";
      if (!nodeId || !nodeHasChildren(nodeId)) return;

      ev.preventDefault();
      ev.stopPropagation();
      toggleNodeChildren(nodeId);
    }, true);
  }

  global.PocketPhoneTap = Object.freeze({ init: initPhoneTap });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPhoneTap, { once: true });
  } else {
    initPhoneTap();
  }
})(window);
