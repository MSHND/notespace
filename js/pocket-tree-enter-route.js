/* Purpose-built tree Enter route: copy in copy contexts, otherwise open PE. */
(function installPocketTreeEnterRoute() {
  function isPlainEnter(ev) {
    return !!ev
      && ev.key === "Enter"
      && !ev.metaKey
      && !ev.ctrlKey
      && !ev.altKey
      && !ev.shiftKey;
  }

  function isEditableTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    const tag = String(target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button") return true;
    if (target.isContentEditable) return true;
    return !!target.closest("input, textarea, select, button, [contenteditable='true'], [role='dialog'], [role='menu']");
  }

  function hasVisibleBlockingTreeUi() {
    const selectors = [
      "#commandOverlay:not([hidden])",
      "#controlsOverlay:not([hidden])",
      "#detailOverlay:not([hidden])",
      "[role='dialog']:not([hidden])",
      "[role='menu']:not([hidden])",
    ];
    return selectors.some((selector) => document.querySelector(selector));
  }

  function selectedNode() {
    const id = cleanText(state?.selectedId, 80);
    if (!id) return null;
    return nodeMap().get(id) || null;
  }

  function shouldCopyOnTreeEnter(node) {
    if (!node) return false;
    const id = cleanText(node.id, 80);
    if (!id) return false;
    if (typeof findCopyContextRootId === "function" && findCopyContextRootId(id)) return true;
    if (typeof isPipMode !== "undefined" && isPipMode) return true;
    if (typeof isCopyFocusMode === "function" && isCopyFocusMode()) return true;
    return false;
  }

  function copySelectedNodeLabel(node) {
    const id = cleanText(node?.id, 80);
    const value = cleanText(node?.label, 220);
    if (!id || !value) {
      setStatus("Nothing to copy from that item.", "warn");
      return;
    }
    if (typeof cancelPendingCopyClick === "function") cancelPendingCopyClick();
    if (typeof clearFilterForCopyLoop === "function") clearFilterForCopyLoop();
    refreshMeta();
    renderTree();
    focusRowByNodeId(id);
    void copyText(value).then((ok) => {
      if (ok) showCopiedFeedback(id);
      else setStatus("Copy did not work.", "warn");
    });
  }

  function openSelectedNodeInPe(node) {
    const id = cleanText(node?.id || state?.selectedId, 80);
    if (!id) {
      setStatus("Select an item first.", "warn");
      return;
    }
    if (typeof window.openPocketPeEditor === "function") {
      window.openPocketPeEditor(id);
      return;
    }
    if (window.PocketPeEditor && typeof window.PocketPeEditor.open === "function") {
      window.PocketPeEditor.open(id);
      return;
    }
    if (typeof window.openPocketNodeEditor === "function") {
      window.openPocketNodeEditor(id);
      return;
    }
    setStatus("Item details are not ready yet.", "warn");
  }

  function handleTreeEnter(ev) {
    if (!isPlainEnter(ev)) return;
    if (isEditableTarget(ev.target)) return;
    if (hasVisibleBlockingTreeUi()) return;
    if (state?.inlineEdit?.id) return;
    if (state?.moveMode) return;
    if (typeof pendingPathImport !== "undefined" && pendingPathImport) return;

    const treeWrap = el?.treeWrap;
    if (!(treeWrap instanceof HTMLElement)) return;
    if (!treeWrap.contains(ev.target instanceof Node ? ev.target : null) && document.activeElement !== treeWrap) return;

    const node = selectedNode();
    ev.preventDefault();
    ev.stopImmediatePropagation();

    if (!node) {
      setStatus("Select an item first.", "warn");
      return;
    }
    if (shouldCopyOnTreeEnter(node)) {
      copySelectedNodeLabel(node);
      return;
    }
    openSelectedNodeInPe(node);
  }

  function bindTreeEnterRoute() {
    const treeWrap = el?.treeWrap || document.getElementById("treeWrap");
    if (!(treeWrap instanceof HTMLElement)) return;
    if (treeWrap.dataset.pocketTreeEnterRoute === "1") return;
    treeWrap.dataset.pocketTreeEnterRoute = "1";
    treeWrap.addEventListener("keydown", handleTreeEnter, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindTreeEnterRoute, { once: true });
  } else {
    bindTreeEnterRoute();
  }
})();
