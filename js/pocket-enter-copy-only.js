/* Enter behaviour + row-menu safety guard + PE Esc close guard.
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

  function isOpenElement(element) {
    return element instanceof HTMLElement && element.hidden !== true && element.getAttribute("aria-hidden") !== "true";
  }

  function hasOpenEnterOwningLayer() {
    if (global.state?.commandPaletteOpen || global.state?.rowMiniMenuOpen) return true;
    if (document.querySelector(".rowMiniMenu")) return true;
    return ["commandOverlay", "controlsOverlay", "detailOverlay"].some((id) => isOpenElement(document.getElementById(id)));
  }

  function shouldIgnoreEnterTarget(target) {
    if (isEditableTarget(target)) return true;
    if (global.state?.moveMode || global.pendingPathImport || global.state?.inlineEdit?.id) return true;
    if (hasOpenEnterOwningLayer()) return true;
    if (!(target instanceof HTMLElement)) return false;
    return !!target.closest(".rowMiniMenu, .commandOverlay, .controlsOverlay, .detailOverlay, [role='dialog'], [role='menu']");
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

  function installPeEscCloseGuard() {
    if (global.__pocketPeEscCloseGuardInstalled) return;
    const originalOpen = global.open.bind(global);
    global.open = function pocketOpenWithPeEscClose(...args) {
      const win = originalOpen(...args);
      const name = String(args[1] || "");
      if (win && name.startsWith("pocketSimplePe_")) {
        const install = () => {
          try {
            if (!win || win.closed || !win.document || win.__pocketPeEscCloseInstalled) return;
            win.__pocketPeEscCloseInstalled = true;

            function ensureChoiceStyle() {
              if (win.document.getElementById("pocketPeUnsavedChoiceStyle")) return;
              const style = win.document.createElement("style");
              style.id = "pocketPeUnsavedChoiceStyle";
              style.textContent = `
                .peUnsavedShade {
                  position: fixed;
                  inset: 0;
                  z-index: 9999;
                  display: grid;
                  place-items: center;
                  background: rgba(15,23,42,.24);
                  padding: 18px;
                }
                .peUnsavedCard {
                  width: min(430px, 100%);
                  border: 1px solid rgba(148,163,184,.32);
                  border-radius: 18px;
                  background: rgba(255,255,255,.98);
                  box-shadow: 0 24px 70px -36px rgba(15,23,42,.55);
                  padding: 18px;
                  color: #0f172a;
                  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                }
                .peUnsavedTitle {
                  font-size: 16px;
                  font-weight: 750;
                  margin: 0 0 6px;
                }
                .peUnsavedText {
                  font-size: 13px;
                  line-height: 1.45;
                  color: rgba(71,85,105,.92);
                  margin: 0 0 14px;
                }
                .peUnsavedActions {
                  display: flex;
                  flex-wrap: wrap;
                  justify-content: flex-end;
                  gap: 8px;
                }
                .peUnsavedActions button {
                  border: 0;
                  border-radius: 999px;
                  padding: 7px 11px;
                  font: inherit;
                  font-size: 12px;
                  cursor: pointer;
                  background: rgba(148,163,184,.16);
                  color: #0f172a;
                }
                .peUnsavedActions button:hover,
                .peUnsavedActions button:focus-visible {
                  background: rgba(148,163,184,.28);
                  outline: none;
                }
                .peUnsavedActions .primary {
                  background: rgba(15,23,42,.9);
                  color: white;
                }
                .peUnsavedActions .primary:hover,
                .peUnsavedActions .primary:focus-visible {
                  background: rgba(15,23,42,1);
                }
                .peUnsavedActions .danger {
                  color: #7f1d1d;
                }
              `;
              win.document.head.appendChild(style);
            }

            function closeUnsavedChoice() {
              const existing = win.document.getElementById("peUnsavedChoice");
              if (existing) existing.remove();
            }

            function saveThenClose() {
              const saveBtn = win.document.getElementById("saveBtn");
              if (!saveBtn) return;
              saveBtn.click();
              let tries = 0;
              const timer = win.setInterval(() => {
                tries += 1;
                const stillDirty = win.__pocketPeDirty === true;
                const disabled = saveBtn.disabled === true;
                if (!stillDirty && !disabled) {
                  win.clearInterval(timer);
                  win.close();
                }
                if (tries > 80) {
                  win.clearInterval(timer);
                  const status = win.document.getElementById("status");
                  if (status) status.textContent = "save did not finish";
                }
              }, 100);
            }

            function showUnsavedChoice() {
              ensureChoiceStyle();
              closeUnsavedChoice();

              const shade = win.document.createElement("div");
              shade.id = "peUnsavedChoice";
              shade.className = "peUnsavedShade";
              shade.setAttribute("role", "dialog");
              shade.setAttribute("aria-modal", "true");

              const card = win.document.createElement("div");
              card.className = "peUnsavedCard";

              const title = win.document.createElement("div");
              title.className = "peUnsavedTitle";
              title.textContent = "Save before closing?";

              const text = win.document.createElement("p");
              text.className = "peUnsavedText";
              text.textContent = "You have unsaved changes in this item.";

              const actions = win.document.createElement("div");
              actions.className = "peUnsavedActions";

              const keepBtn = win.document.createElement("button");
              keepBtn.type = "button";
              keepBtn.textContent = "Keep editing";
              keepBtn.addEventListener("click", closeUnsavedChoice);

              const leaveBtn = win.document.createElement("button");
              leaveBtn.type = "button";
              leaveBtn.className = "danger";
              leaveBtn.textContent = "Leave without saving";
              leaveBtn.addEventListener("click", () => win.close());

              const saveBtn = win.document.createElement("button");
              saveBtn.type = "button";
              saveBtn.className = "primary";
              saveBtn.textContent = "Save and close";
              saveBtn.addEventListener("click", () => {
                saveBtn.disabled = true;
                saveBtn.textContent = "Saving…";
                saveThenClose();
              });

              actions.appendChild(keepBtn);
              actions.appendChild(leaveBtn);
              actions.appendChild(saveBtn);
              card.appendChild(title);
              card.appendChild(text);
              card.appendChild(actions);
              shade.appendChild(card);
              win.document.body.appendChild(shade);
              saveBtn.focus({ preventScroll: true });
            }

            function closePeWindow() {
              if (!win.__pocketPeDirty) {
                win.close();
                return;
              }
              showUnsavedChoice();
            }

            win.document.addEventListener("keydown", (ev) => {
              if (ev.key !== "Escape" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
              ev.preventDefault();
              ev.stopPropagation();
              closePeWindow();
            }, true);
            console.info("[pe esc close] installed");
          } catch (_error) {}
        };
        window.setTimeout(install, 0);
        window.setTimeout(install, 80);
        window.setTimeout(install, 240);
      }
      return win;
    };
    global.__pocketPeEscCloseGuardInstalled = true;
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

  function copyAncestorRootIdForEnter(node) {
    if (!node || typeof findCopyContextRootId !== "function") return "";
    const parentId = clean(node.parentId, 80);
    if (!parentId || parentId === "root") return "";
    try {
      return clean(findCopyContextRootId(parentId), 80);
    } catch (_error) {
      return "";
    }
  }

  function shouldCopyOnEnter(node, hasKids) {
    if (!node) return false;
    if (typeof shouldCopyOnSingleClick === "function" && shouldCopyOnSingleClick(node, hasKids)) return true;
    return !!copyAncestorRootIdForEnter(node);
  }

  function copySelectedNodeIfAppropriate() {
    const { node, hasKids } = selectedNodeWithKids();
    if (!node || !shouldCopyOnEnter(node, hasKids)) return false;

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
    if (shouldIgnoreEnterTarget(target)) return;
    const treeWrap = document.getElementById("treeWrap");
    if (!(treeWrap instanceof HTMLElement)) return;
    const isTreeTarget = !target || target === treeWrap || treeWrap.contains(target);

    if (copySelectedNodeIfAppropriate()) {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      return;
    }
    if (!isTreeTarget) return;

    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
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
  installPeEscCloseGuard();
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
