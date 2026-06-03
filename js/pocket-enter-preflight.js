/* Early Enter routing preflight.
   Loaded before the original tree keyboard handler so Enter can be routed safely:
   copy branches copy, all other tree nodes open PE, and the old inline editor
   never receives the Enter fallback. */
(function initialisePocketEnterPreflight(global) {
  "use strict";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function isEditableTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    const tag = String(target.tagName || "").toLowerCase();
    return target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
  }

  function selectedNodeWithKids() {
    const selectedId = clean(global.state?.selectedId, 80);
    if (!selectedId || typeof nodeMap !== "function") return { node: null, hasKids: false };
    const node = nodeMap().get(selectedId) || null;
    const hasKids = node && typeof sortNodesForParent === "function" ? sortNodesForParent(node.id).length > 0 : false;
    return { node, hasKids };
  }

  function copySelectedNode(node) {
    if (typeof cancelPendingCopyClick === "function") cancelPendingCopyClick();
    if (typeof clearFilterForCopyLoop === "function") clearFilterForCopyLoop();
    if (typeof refreshMeta === "function") refreshMeta();
    if (typeof renderTree === "function") renderTree();
    if (typeof focusRowByNodeId === "function") focusRowByNodeId(node.id);
    if (typeof copyText !== "function") return false;

    void copyText(clean(node.label, 220)).then((ok) => {
      if (ok && typeof showCopiedFeedback === "function") showCopiedFeedback(node.id);
      else if (!ok && typeof setStatus === "function") setStatus("Copy did not work.", "warn");
    });
    return true;
  }

  function openSelectedPe(node) {
    if (typeof cancelPendingCopyClick === "function") cancelPendingCopyClick();
    if (typeof openItemDetailsForNode === "function") return !!openItemDetailsForNode(node.id);
    if (typeof global.openPocketPeEditor === "function") return !!global.openPocketPeEditor(node.id);
    if (global.PocketPeEditor && typeof global.PocketPeEditor.open === "function") return !!global.PocketPeEditor.open(node.id);
    if (typeof global.openPocketNodeEditor === "function") return !!global.openPocketNodeEditor(node.id);
    if (typeof global.openPocketEditor === "function") return !!global.openPocketEditor(node.id);
    if (typeof setStatus === "function") setStatus("Editor is not available yet. Refresh and try again.", "warn");
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

    const { node, hasKids } = selectedNodeWithKids();
    if (!node) return;

    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();

    if (typeof shouldCopyOnSingleClick === "function" && shouldCopyOnSingleClick(node, hasKids)) {
      copySelectedNode(node);
      return;
    }

    openSelectedPe(node);
  }

  global.addEventListener("keydown", handleEnter, true);
  console.info("[enter preflight] installed");
})(window);
