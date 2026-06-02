/* Enter copy-only guard.
   Loaded last to keep Enter available for copy branches while preventing the
   older tree handler from falling through to the inline details editor. */
(function initialisePocketEnterCopyOnly(global) {
  "use strict";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function isEditableTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    const tag = String(target.tagName || "").toLowerCase();
    return target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
  }

  function copySelectedNodeIfAppropriate() {
    const selectedId = clean(global.state?.selectedId, 80);
    if (!selectedId || typeof nodeMap !== "function") return false;
    const node = nodeMap().get(selectedId) || null;
    if (!node) return false;
    const hasKids = typeof sortNodesForParent === "function" ? sortNodesForParent(node.id).length > 0 : false;
    if (typeof shouldCopyOnSingleClick !== "function" || !shouldCopyOnSingleClick(node, hasKids)) return false;

    if (typeof cancelPendingCopyClick === "function") cancelPendingCopyClick();
    if (typeof clearFilterForCopyLoop === "function") clearFilterForCopyLoop();
    if (typeof refreshMeta === "function") refreshMeta();
    if (typeof renderTree === "function") renderTree();
    if (typeof focusRowByNodeId === "function") focusRowByNodeId(node.id);

    if (typeof copyText === "function") {
      void copyText(clean(node.label, 220)).then((ok) => {
        if (ok && typeof showCopiedFeedback === "function") showCopiedFeedback(node.id);
        else if (!ok && typeof setStatus === "function") setStatus("Copy did not work.", "warn");
      });
      return true;
    }
    return false;
  }

  function handleEnter(ev) {
    if (ev.key !== "Enter" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    if (isEditableTarget(target)) return;
    if (global.state?.moveMode || global.pendingPathImport) return;
    const treeWrap = document.getElementById("treeWrap");
    if (!(treeWrap instanceof HTMLElement)) return;
    if (target && target !== treeWrap && !treeWrap.contains(target)) return;

    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();

    if (copySelectedNodeIfAppropriate()) return;
    if (typeof setStatus === "function") setStatus("Enter is reserved for copy. Use double-click or right-click → Edit for details.", "warn", { durationMs: 2600 });
    if (typeof refocusTreeNavigation === "function") refocusTreeNavigation(global.state?.selectedId || "");
  }

  document.addEventListener("keydown", handleEnter, true);
  window.addEventListener("keydown", handleEnter, true);
  console.info("[enter copy-only guard] installed");
})(window);
