/* Enter behaviour + row-menu safety guard.
   Loaded last so Enter copies in copy branches, opens PE elsewhere, and never
   falls through to the old inline details editor. It also keeps Move available
   in the right-click row menu if later menu trimming loses it. */
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

  function installMoveDisplayGuard() {
    if (document.getElementById("pocketMoveDisplayGuard")) return;
    const style = document.createElement("style");
    style.id = "pocketMoveDisplayGuard";
    style.textContent = `
      body:not(.phoneMode) .mobileMovePad { display: none !important; }
      body.phoneMode.moveModeActive .mobileMovePad { display: block !important; }
    `;
    document.head.appendChild(style);
  }

  function forceCloseRowMenus() {
    if (typeof closeRowMiniMenu === "function") closeRowMiniMenu({ restoreFocus: false });
    document.querySelectorAll(".rowMiniMenu").forEach((menu) => menu.remove());
    if (global.state) {
      global.state.rowMiniMenuOpen = false;
      global.state.rowMiniMenuNodeId = "";
    }
  }

  function selectedNodeWithKids() {
    const selectedId = clean(global.state?.selectedId, 80);
    if (!selectedId || typeof nodeMap !== "function") return { node: null, hasKids: false };
    const node = nodeMap().get(selectedId) || null;
    const hasKids = node && typeof sortNodesForParent === "function" ? sortNodesForParent(node.id).length > 0 : false;
    return { node, hasKids };
  }

  function copySelectedNodeIfAppropriate() {
    const { node, hasKids } = selectedNodeWithKids();
    if (!node) return false;
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

  function openSelectedPe() {
    const { node } = selectedNodeWithKids();
    if (!node) {
      if (typeof setStatus === "function") setStatus("Select an item first.", "warn");
      return false;
    }
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

    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();

    if (copySelectedNodeIfAppropriate()) return;
    openSelectedPe();
  }

  function rowMenuHasMove(menu) {
    return Array.from(menu.querySelectorAll(".rowMiniMenuBtn"))
      .some((button) => clean(button.textContent, 80).toLowerCase().startsWith("move"));
  }

  function makeMoveButton() {
    const btn = document.createElement("button");
    btn.className = "rowMiniMenuBtn";
    btn.type = "button";
    btn.setAttribute("role", "menuitem");
    btn.dataset.shortcut = "m";
    btn.setAttribute("aria-keyshortcuts", "M");
    btn.title = "Move (M)";

    const labelSpan = document.createElement("span");
    labelSpan.className = "rowMiniMenuLabel";
    labelSpan.textContent = "Move";
    btn.appendChild(labelSpan);

    const keySpan = document.createElement("span");
    keySpan.className = "rowMiniMenuShortcut";
    keySpan.textContent = "M";
    btn.appendChild(keySpan);

    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const id = clean(global.state?.rowMiniMenuNodeId || global.state?.selectedId, 80);
      if (id && global.state) global.state.selectedId = id;
      forceCloseRowMenus();
      if (typeof toggleMoveMode === "function") toggleMoveMode(true);
      else if (typeof runCommandPaletteAction === "function") runCommandPaletteAction("move");
      window.setTimeout(forceCloseRowMenus, 0);
    });

    return btn;
  }

  function ensureMoveInRowMenu() {
    const menu = document.querySelector(".rowMiniMenu");
    if (!(menu instanceof HTMLElement) || rowMenuHasMove(menu)) return;
    const buttons = Array.from(menu.querySelectorAll(".rowMiniMenuBtn"));
    const addBelow = buttons.find((button) => clean(button.textContent, 80).toLowerCase().startsWith("add below"));
    const focusHere = buttons.find((button) => clean(button.textContent, 80).toLowerCase().startsWith("focus"));
    const moveButton = makeMoveButton();
    if (addBelow instanceof HTMLElement) addBelow.insertAdjacentElement("afterend", moveButton);
    else if (focusHere instanceof HTMLElement) focusHere.insertAdjacentElement("beforebegin", moveButton);
    else menu.appendChild(moveButton);
    console.info("[row menu move guard] restored Move action");
  }

  function closeMenusAfterMoveClick(ev) {
    const target = ev.target instanceof HTMLElement ? ev.target.closest(".rowMiniMenuBtn") : null;
    if (!(target instanceof HTMLElement)) return;
    if (!clean(target.textContent, 80).toLowerCase().startsWith("move")) return;
    window.setTimeout(forceCloseRowMenus, 0);
    window.setTimeout(forceCloseRowMenus, 60);
  }

  installMoveDisplayGuard();
  document.addEventListener("keydown", handleEnter, true);
  window.addEventListener("keydown", handleEnter, true);
  document.addEventListener("click", closeMenusAfterMoveClick, true);
  document.addEventListener("click", () => window.requestAnimationFrame(ensureMoveInRowMenu), true);
  document.addEventListener("contextmenu", () => window.requestAnimationFrame(ensureMoveInRowMenu), true);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "." || ev.key === "ContextMenu" || (ev.shiftKey && ev.key === "F10")) {
      window.requestAnimationFrame(ensureMoveInRowMenu);
    }
  }, true);
  const observer = new MutationObserver(() => window.requestAnimationFrame(ensureMoveInRowMenu));
  observer.observe(document.body, { childList: true, subtree: true });
  console.info("[enter PE/copy guard] installed");
})(window);
