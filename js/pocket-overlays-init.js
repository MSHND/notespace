/* Controls help, row menus, command palette, event binding and startup. */

function isControlsHelpOpen() {
  return !!(el.controlsOverlay instanceof HTMLElement) && !el.controlsOverlay.hidden;
}

function openControlsHelp() {
  if (!(el.controlsOverlay instanceof HTMLElement)) {
    setStatus("Controls: + add below · Enter edit/copy · right-click actions · Esc back · Ctrl/Cmd+S save", "ok", { persist: true });
    refocusTreeNavigation(state.selectedId);
    return false;
  }
  el.controlsOverlay.hidden = false;
  requestAnimationFrame(() => {
    if (el.btnControlsClose instanceof HTMLElement) el.btnControlsClose.focus({ preventScroll: true });
  });
  return true;
}

function closeControlsHelp(options = {}) {
  const opts = { restoreFocus: true, ...options };
  if (!(el.controlsOverlay instanceof HTMLElement) || el.controlsOverlay.hidden) return false;
  el.controlsOverlay.hidden = true;
  if (opts.restoreFocus) refocusTreeNavigation(state.selectedId);
  return true;
}

function showQuickKeys() {
  openControlsHelp();
}


let rowMiniMenuEl = null;
let rowMiniMenuAnchor = null;
let rowMiniMenuPoint = null;

function isRowMiniMenuOpen() {
  return !!state.rowMiniMenuOpen && rowMiniMenuEl instanceof HTMLElement && document.body.contains(rowMiniMenuEl);
}

function closeRowMiniMenu(options = {}) {
  const opts = { restoreFocus: true, ...options };
  if (rowMiniMenuEl instanceof HTMLElement) rowMiniMenuEl.remove();
  rowMiniMenuEl = null;
  rowMiniMenuAnchor = null;
  rowMiniMenuPoint = null;
  state.rowMiniMenuOpen = false;
  const nodeId = cleanText(state.rowMiniMenuNodeId || state.selectedId, 80);
  state.rowMiniMenuNodeId = "";
  renderTree();
  if (opts.restoreFocus && nodeId) refocusTreeNavigation(nodeId);
  return true;
}

function positionRowMiniMenu() {
  if (!(rowMiniMenuEl instanceof HTMLElement)) return false;
  const gap = 6;
  const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  const coarsePointer = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const sheetMode = coarsePointer && vw <= 340 && !rowMiniMenuPoint;

  rowMiniMenuEl.style.visibility = "hidden";
  rowMiniMenuEl.classList.toggle("sheetMode", sheetMode);
  rowMiniMenuEl.style.left = "";
  rowMiniMenuEl.style.right = "";
  rowMiniMenuEl.style.top = "";
  rowMiniMenuEl.style.bottom = "";
  rowMiniMenuEl.style.width = "";

  if (sheetMode) {
    rowMiniMenuEl.style.visibility = "";
    return true;
  }

  rowMiniMenuEl.style.left = "0px";
  rowMiniMenuEl.style.top = "0px";
  const menuRect = rowMiniMenuEl.getBoundingClientRect();
  const menuWidth = Math.min(menuRect.width || 138, Math.max(112, vw - gap * 2));
  const menuHeight = Math.min(menuRect.height || 210, Math.max(80, vh - gap * 2));
  let left = gap;
  let top = gap;

  if (rowMiniMenuPoint && Number.isFinite(rowMiniMenuPoint.x) && Number.isFinite(rowMiniMenuPoint.y)) {
    left = rowMiniMenuPoint.x + 4;
    top = rowMiniMenuPoint.y + 4;
  } else if (rowMiniMenuAnchor instanceof HTMLElement) {
    const rect = rowMiniMenuAnchor.getBoundingClientRect();
    left = rect.right + 4;
    if (left + menuWidth > vw - gap) left = rect.left - menuWidth - 4;
    top = rect.top;
  }

  if (left + menuWidth > vw - gap) left = vw - menuWidth - gap;
  if (top + menuHeight > vh - gap) top = vh - menuHeight - gap;
  left = Math.max(gap, Math.min(left, vw - menuWidth - gap));
  top = Math.max(gap, Math.min(top, vh - menuHeight - gap));
  rowMiniMenuEl.style.left = `${Math.round(left)}px`;
  rowMiniMenuEl.style.top = `${Math.round(top)}px`;
  rowMiniMenuEl.style.visibility = "";
  return true;
}

function openRowMiniMenu(nodeId, anchorEl, point = null) {
  const id = cleanText(nodeId, 80);
  const node = nodeMap().get(id) || null;
  if (!id || !node || isDetailsEditorOpen()) return false;
  if (isRowMiniMenuOpen() && state.rowMiniMenuNodeId === id) {
    closeRowMiniMenu({ restoreFocus: true });
    return true;
  }
  closeRowMiniMenu({ restoreFocus: false });
  state.selectedId = id;
  state.rowMiniMenuOpen = true;
  state.rowMiniMenuNodeId = id;
  rowMiniMenuAnchor = anchorEl instanceof HTMLElement ? anchorEl : null;
  rowMiniMenuPoint = point && Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: point.x, y: point.y } : null;
  renderTree();
  rowMiniMenuAnchor = document.querySelector(`[data-node-id="${CSS.escape(id)}"]`) || rowMiniMenuAnchor;

  const menu = document.createElement("div");
  menu.className = "rowMiniMenu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Row actions");
  const title = document.createElement("div");
  title.className = "rowMiniMenuTitle";
  title.textContent = `Actions · ${cleanText(node.name || "Untitled", 80) || "Untitled"}`;
  menu.appendChild(title);
  menu.addEventListener("click", (ev) => ev.stopPropagation());
  menu.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  menu.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeRowMiniMenu({ restoreFocus: true });
      return;
    }
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const buttons = Array.from(menu.querySelectorAll(".rowMiniMenuBtn:not([disabled])"))
        .filter((item) => item instanceof HTMLElement);
      if (!buttons.length) return;
      const currentIndex = buttons.indexOf(document.activeElement);
      const delta = ev.key === "ArrowDown" ? 1 : -1;
      const nextIndex = currentIndex < 0 ? 0 : (currentIndex + delta + buttons.length) % buttons.length;
      buttons[nextIndex].focus({ preventScroll: true });
      return;
    }
    if (!ev.metaKey && !ev.ctrlKey && !ev.altKey) {
      const shortcut = cleanText(ev.key || "", 4).toLowerCase();
      if (shortcut) {
        const target = menu.querySelector(`.rowMiniMenuBtn[data-shortcut="${shortcut}"]:not([disabled])`);
        if (target instanceof HTMLElement) {
          ev.preventDefault();
          ev.stopPropagation();
          target.click();
        }
      }
    }
  });

  const addButton = (label, action, shortcut = "", disabled = false) => {
    const btn = document.createElement("button");
    btn.className = "rowMiniMenuBtn";
    btn.type = "button";
    btn.setAttribute("role", "menuitem");
    const key = cleanText(shortcut, 4).toLowerCase();
    if (key) {
      btn.dataset.shortcut = key;
      btn.setAttribute("aria-keyshortcuts", key.toUpperCase());
      btn.title = `${label} (${key.toUpperCase()})`;
    }
    const labelSpan = document.createElement("span");
    labelSpan.className = "rowMiniMenuLabel";
    labelSpan.textContent = label;
    btn.appendChild(labelSpan);
    if (key) {
      const keySpan = document.createElement("span");
      keySpan.className = "rowMiniMenuShortcut";
      keySpan.textContent = key.toUpperCase();
      btn.appendChild(keySpan);
    }
    btn.disabled = !!disabled;
    btn.addEventListener("click", () => {
      closeRowMiniMenu({ restoreFocus: false });
      state.selectedId = id;
      runCommandPaletteAction(action);
    });
    menu.appendChild(btn);
    return btn;
  };
  const addSeparator = () => {
    const sep = document.createElement("div");
    sep.className = "rowMiniMenuSep";
    sep.setAttribute("role", "separator");
    menu.appendChild(sep);
  };

  addButton("Edit", "edit", "e");
  addButton("Add below", "add_sibling", "a");
  addButton("Move", "move", "m");
  addButton("Focus here", "focus", "f");
  addSeparator();
  addButton("Copy text", "copy_text", "c");
  addSeparator();
  addButton("Delete", "delete", "d");

  document.body.appendChild(menu);
  rowMiniMenuEl = menu;
  positionRowMiniMenu();
  requestAnimationFrame(() => {
    positionRowMiniMenu();
    const first = menu.querySelector(".rowMiniMenuBtn:not([disabled])");
    if (first instanceof HTMLElement) first.focus({ preventScroll: true });
  });
  return true;
}

function isCommandPaletteOpen() {
  return !!state.commandPaletteOpen && !(el.commandOverlay?.hidden ?? true);
}

function refreshCommandPaletteState() {
  const hasSelection = !!cleanText(state.selectedId, 80) && !!nodeMap().get(cleanText(state.selectedId, 80));
  const setDisabled = (button, disabled) => {
    if (button instanceof HTMLButtonElement) button.disabled = !!disabled;
  };
  setDisabled(el.cmdAddChild, false);
  setDisabled(el.cmdAddSibling, !hasSelection);
  setDisabled(el.cmdRename, !hasSelection);
  setDisabled(el.cmdEdit, !hasSelection);
  setDisabled(el.cmdMove, !hasSelection);
  setDisabled(el.cmdFocus, !hasSelection);
  const trail = readLocalSafetyTrail();
  const latest = readLocalSafetySnapshot();
  const latestMs = latest ? latest.capturedMs : 0;
  const previousLocalVersion = trail.find((item) => item && item.capturedMs > 0 && (!latestMs || item.capturedMs < latestMs - 1000));
  const hasPreviousLocalVersion = !!previousLocalVersion;
  if (el.cmdRestoreRecent instanceof HTMLButtonElement) {
    const hint = el.cmdRestoreRecent.querySelector(".commandHint");
    if (hint) hint.textContent = previousLocalVersion
      ? `${formatSaveClockLabel(new Date(previousLocalVersion.capturedMs))} · ${previousLocalVersion.norm.nodes.length} nodes`
      : "safety";
  }
  setDisabled(el.cmdRestoreRecent, !hasPreviousLocalVersion);
}

function openCommandPalette() {
  closeRowMiniMenu({ restoreFocus: false });
  if (!(el.commandOverlay instanceof HTMLElement)) return false;
  if (isDetailsEditorOpen()) return false;
  refreshCommandPaletteState();
  state.commandPaletteOpen = true;
  el.commandOverlay.hidden = false;
  requestAnimationFrame(() => {
    const first = el.commandOverlay?.querySelector(".commandBtn:not([disabled])");
    if (first instanceof HTMLElement) first.focus({ preventScroll: true });
  });
  return true;
}

function closeCommandPalette(options = {}) {
  const opts = { restoreFocus: true, ...options };
  if (!(el.commandOverlay instanceof HTMLElement)) return false;
  if (!isCommandPaletteOpen()) return false;
  state.commandPaletteOpen = false;
  el.commandOverlay.hidden = true;
  if (opts.restoreFocus) refocusTreeNavigation(state.selectedId);
  return true;
}

function runCommandPaletteAction(action) {
  closeCommandPalette({ restoreFocus: false });
  requestAnimationFrame(() => {
    let shouldReturnToTree = true;
    if (action === "add_child") {
      shouldReturnToTree = false;
      const id = cleanText(state.selectedId, 80);
      if (id) insertChildUnder(id);
      else addItemsFromPrimaryAction();
    }
    else if (action === "add_sibling") {
      shouldReturnToTree = false;
      const id = cleanText(state.selectedId, 80);
      if (id) insertSiblingBelow(id);
      else addItemsFromPrimaryAction();
    } else if (action === "rename") {
      shouldReturnToTree = false;
      renameSelected();
    }
    else if (action === "edit") {
      shouldReturnToTree = false;
      openDetailsEditorForSelectedNode();
    }
    else if (action === "move") toggleMoveMode();
    else if (action === "focus") toggleFocusHere();
    else if (action === "search") {
      shouldReturnToTree = false;
      if (el.search instanceof HTMLInputElement) {
        el.search.focus({ preventScroll: true });
        el.search.select();
      }
    } else if (action === "save") saveCurrentContext();
    else if (action === "delete") deleteSelected();
    else if (action === "health") showPocketHealth();
    else if (action === "restore_recent") restorePreviousLocalSafetyVersion();
    else if (action === "copy_text") {
      const selectedId = cleanText(state.selectedId, 80);
      const selectedNode = nodeMap().get(selectedId) || null;
      if (!selectedNode) setStatus("Select an item first.", "warn");
      else {
        const selectedHasKids = sortNodesForParent(selectedNode.id).length > 0;
        if (shouldCopyOnSingleClick(selectedNode, selectedHasKids)) {
          clearFilterForCopyLoop();
          refreshMeta();
          renderTree();
          refocusTreeNavigation(selectedId);
        }
        void copyText(selectedNode.label).then((ok) => {
          if (ok) showCopiedFeedback(selectedId);
        });
      }
    }
    else if (action === "help") showQuickKeys();
    if (shouldReturnToTree) refocusTreeNavigation(state.selectedId);
  });
}

function moveCommandPaletteFocus(delta) {
  if (!isCommandPaletteOpen()) return false;
  const buttons = Array.from(el.commandOverlay.querySelectorAll(".commandBtn:not([disabled])"))
    .filter((item) => item instanceof HTMLElement);
  if (buttons.length === 0) return false;
  const active = document.activeElement;
  const currentIndex = buttons.indexOf(active);
  const nextIndex = currentIndex < 0
    ? 0
    : (currentIndex + delta + buttons.length) % buttons.length;
  buttons[nextIndex].focus({ preventScroll: true });
  return true;
}

function bind() {
  el.controlsOverlay?.addEventListener("click", (ev) => {
    if (ev.target === el.controlsOverlay) {
      closeControlsHelp({ restoreFocus: true });
    }
  });
  el.controlsOverlay?.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeControlsHelp({ restoreFocus: true });
    }
  });
  el.btnControlsClose?.addEventListener("click", () => closeControlsHelp({ restoreFocus: true }));

  el.commandOverlay?.addEventListener("click", (ev) => {
    if (ev.target === el.commandOverlay) {
      closeCommandPalette({ restoreFocus: true });
    }
  });
  el.commandOverlay?.addEventListener("keydown", (ev) => {
    if (!isCommandPaletteOpen()) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeCommandPalette({ restoreFocus: true });
      return;
    }
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      moveCommandPaletteFocus(1);
      return;
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      moveCommandPaletteFocus(-1);
      return;
    }
  });
  document.addEventListener("pointerdown", (ev) => {
    if (!isRowMiniMenuOpen()) return;
    if (rowMiniMenuEl instanceof HTMLElement && rowMiniMenuEl.contains(ev.target)) return;
    if (rowMiniMenuAnchor instanceof HTMLElement && rowMiniMenuAnchor.contains(ev.target)) return;
    closeRowMiniMenu({ restoreFocus: false });
  }, true);
  document.addEventListener("keydown", (ev) => {
    if (!isRowMiniMenuOpen()) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeRowMiniMenu({ restoreFocus: true });
    }
  }, true);
  window.addEventListener("resize", () => {
    if (isRowMiniMenuOpen()) positionRowMiniMenu();
  });
  window.addEventListener("scroll", () => {
    if (isRowMiniMenuOpen()) positionRowMiniMenu();
  }, true);

  el.cmdAddChild?.addEventListener("click", () => runCommandPaletteAction("add_child"));
  el.cmdAddSibling?.addEventListener("click", () => runCommandPaletteAction("add_sibling"));
  el.cmdRename?.addEventListener("click", () => runCommandPaletteAction("rename"));
  el.cmdEdit?.addEventListener("click", () => runCommandPaletteAction("edit"));
  el.cmdMove?.addEventListener("click", () => runCommandPaletteAction("move"));
  el.cmdFocus?.addEventListener("click", () => runCommandPaletteAction("focus"));
  el.cmdSearch?.addEventListener("click", () => runCommandPaletteAction("search"));
  el.cmdSave?.addEventListener("click", () => runCommandPaletteAction("save"));
  el.cmdHealth?.addEventListener("click", () => runCommandPaletteAction("health"));
  el.cmdRestoreRecent?.addEventListener("click", () => runCommandPaletteAction("restore_recent"));
  el.cmdHelp?.addEventListener("click", () => runCommandPaletteAction("help"));
  el.btnUnfoldAll?.addEventListener("click", toggleUnfoldAll);
  el.btnAddPrimary?.addEventListener("click", addItemsFromPrimaryAction);
  el.btnAddMobile?.addEventListener("click", addItemsFromPrimaryAction);
  el.btnMovePrimary?.addEventListener("click", () => toggleMoveMode());
  const bindMovePadButton = (button, direction) => {
    if (!button) return;
    button.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      startMovePadRepeat(direction);
    });
    button.addEventListener("pointerup", () => stopMovePadRepeat());
    button.addEventListener("pointercancel", () => stopMovePadRepeat());
    button.addEventListener("pointerleave", (ev) => {
      if (ev.buttons === 0) stopMovePadRepeat();
    });
    button.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      moveSelectedViaPad(direction);
    });
  };
  bindMovePadButton(el.btnMovePadUp, "up");
  bindMovePadButton(el.btnMovePadDown, "down");
  bindMovePadButton(el.btnMovePadLeft, "left");
  bindMovePadButton(el.btnMovePadRight, "right");
  document.addEventListener("pointerup", () => stopMovePadRepeat(), true);
  document.addEventListener("pointercancel", () => stopMovePadRepeat(), true);
  el.btnRenamePrimary?.addEventListener("click", renameSelected);
  el.btnDeletePrimary?.addEventListener("click", deleteSelected);
  el.btnOpenPrimary?.addEventListener("click", openDetailsEditorForSelectedNode);
  el.btnLoad.addEventListener("click", () => el.fileInput.click());
  el.btnPip?.addEventListener("click", () => {
    void openPipWindow();
  });
  el.btnImportNow?.addEventListener("click", commitPendingPathImport);
  el.btnCancelImport?.addEventListener("click", cancelPendingPathImport);
  el.btnUndoImport?.addEventListener("click", undoLastImportBatch);
  el.fileInput.addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0] ? ev.target.files[0] : null;
    await loadFromFile(file);
    ev.target.value = "";
  });

  el.search.addEventListener("input", () => {
    const hasFilter = cleanText(el.search.value, 120).length > 0;
    if (hasFilter) rememberFilterOrigin();
    else clearFilterMemory();
    resetTypeJump();
    renderTree();
    if (!hasFilter) refocusTreeNavigation(state.selectedId);
  });
  el.search.addEventListener("keydown", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    if (ev.key === "Tab") {
      ev.preventDefault();
      const visibleIds = getVisibleNodeIdsInRenderOrder();
      const targetId = (state.selectedId && visibleIds.includes(state.selectedId))
        ? state.selectedId
        : (visibleIds[0] || state.selectedId || "");
      if (targetId) {
        state.selectedId = targetId;
        refreshMeta();
        renderTree();
        refocusTreeNavigation(targetId);
        return;
      }
      refocusTreeNavigation(state.selectedId);
      return;
    }
    if (ev.key === "Enter") {
      ev.preventDefault();
      const visibleIds = getVisibleNodeIdsInRenderOrder();
      const targetId = visibleIds[0] || state.selectedId || "";
      if (!targetId) {
        setStatus("No matching items.", "warn");
        return;
      }
      const map = nodeMap();
      const targetNode = map.get(targetId) || null;
      const targetHasKids = !!targetNode && sortNodesForParent(targetNode.id).length > 0;
      const copyOnEnter = !!targetNode && shouldCopyOnSingleClick(targetNode, targetHasKids);
      state.selectedId = targetId;
      if (copyOnEnter) {
        const hadFilter = cleanText(el.search.value, 120).length > 0;
        if (hadFilter) {
          el.search.value = "";
          resetTypeJump();
          clearFilterMemory();
        }
        state.selectedId = targetId;
        expandPathToNode(targetId);
        refreshMeta();
        renderTree();
        refocusTreeNavigation(targetId);
        void copyText(targetNode.label).then((ok) => {
          if (ok) showCopiedFeedback(targetId);
        });
        return;
      }
      refreshMeta();
      renderTree();
      refocusTreeNavigation(targetId);
      saveWorkspaceState();
      return;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      const cleared = clearFilterAndReturnHome("Filter cleared.");
      if (!cleared) refocusTreeNavigation(state.selectedId);
    }
  });
  el.treeWrap?.addEventListener("keydown", handleTreeKeydown);
  el.btnDetailSave?.addEventListener("click", saveDetailsEditor);
  el.btnDetailCancel?.addEventListener("click", () => {
    closeDetailsEditor({ restoreFocus: true, revertDraft: true });
    setStatus("Details edit cancelled.", "warn");
  });
  el.detailOverlay?.addEventListener("click", (ev) => {
    if (ev.target !== el.detailOverlay) return;
    closeDetailsEditor({ restoreFocus: true, revertDraft: true });
    setStatus("Details edit cancelled.", "warn");
  });
  el.detailEditorLabel?.addEventListener("keydown", handleDetailsEditorKeydown);
  el.detailEditorBody?.addEventListener("keydown", handleDetailsEditorKeydown);
  el.detailEditorLabel?.addEventListener("input", stageDetailsEditorDraft);
  el.detailEditorBody?.addEventListener("input", stageDetailsEditorDraft);
  el.detailEditorUrgent?.addEventListener("change", stageDetailsEditorDraft);
  el.detailEditorCopyContext?.addEventListener("change", stageDetailsEditorDraft);
  el.btnExportTree.addEventListener("click", saveCurrentContext);
  el.titleToast?.addEventListener("click", (ev) => {
    triggerStatusAction(ev);
  });
  el.titleToast?.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    triggerStatusAction(ev);
  });
  const handleGlobalShortcuts = (ev) => {
    const key = String(ev.key || "").toLowerCase();
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    const tag = target ? String(target.tagName || "").toLowerCase() : "";
    const isEditableTarget = !!target && (target.isContentEditable || tag === "input" || tag === "textarea");
    if (isControlsHelpOpen()) {
      if (key === "escape") {
        ev.preventDefault();
        ev.stopPropagation();
        closeControlsHelp({ restoreFocus: true });
        return;
      }
      return;
    }
    if (isCommandPaletteOpen()) {
      if (key === "escape") {
        ev.preventDefault();
        ev.stopPropagation();
        closeCommandPalette({ restoreFocus: true });
        return;
      }
      return;
    }
    if (
      ((key === "/" && !ev.shiftKey) || key === "?")
      && !ev.metaKey
      && !ev.ctrlKey
      && !ev.altKey
      && !isEditableTarget
    ) {
      ev.preventDefault();
      ev.stopPropagation();
      openCommandPalette();
      return;
    }
    if (
      key === "k"
      && (ev.metaKey || ev.ctrlKey)
      && !ev.altKey
      && !ev.shiftKey
      && !isEditableTarget
    ) {
      ev.preventDefault();
      ev.stopPropagation();
      openCommandPalette();
      return;
    }
    if (key === "escape") {
      const isInlineRenameInput = !!(target && (target.classList.contains("labelEdit") || target.closest(".labelEdit")));
      if (isInlineRenameInput) return;
      if (target === el.search) return;
      if (isDetailsEditorOpen()) {
        ev.preventDefault();
        ev.stopPropagation();
        closeDetailsEditor({ restoreFocus: true, revertDraft: true });
        setStatus("Details edit cancelled.", "warn");
        return;
      }
      if (state.moveMode) {
        ev.preventDefault();
        ev.stopPropagation();
        toggleMoveMode(false);
        refocusTreeNavigation(state.selectedId);
        return;
      }
      const hasFilterText = cleanText(el.search?.value || "", 120).length > 0;
      if (hasFilterText && el.search instanceof HTMLInputElement) {
        ev.preventDefault();
        ev.stopPropagation();
        clearFilterAndReturnHome("Filter cleared.");
        return;
      }
      if (state.focusRootId) {
        ev.preventDefault();
        ev.stopPropagation();
        clearFocusAndReturnHome("Back to full pocket.");
        return;
      }
    }
    const hasPrimaryMod = ev.ctrlKey || ev.metaKey;
    if (!hasPrimaryMod || ev.altKey || ev.shiftKey) return;
    if (key === "z" && !isEditableTarget) {
      ev.preventDefault();
      ev.stopPropagation();
      undoMostRecentTreeMutation();
      refocusTreeNavigation(state.selectedId);
      return;
    }
    if (key === "s") {
      ev.preventDefault();
      ev.stopPropagation();
      saveCurrentContext();
      return;
    }
    if (key === "f") {
      ev.preventDefault();
      ev.stopPropagation();
      if (el.search instanceof HTMLInputElement) {
        el.search.focus({ preventScroll: true });
        el.search.select();
      }
      return;
    }
    if (key === "c") {
      if (isEditableTarget || target === el.search) return;
      const selectedId = cleanText(state.selectedId, 80);
      if (!selectedId) return;
      const selectedNode = nodeMap().get(selectedId) || null;
      if (!selectedNode) return;
      ev.preventDefault();
      ev.stopPropagation();
      const selectedHasKids = sortNodesForParent(selectedNode.id).length > 0;
      const copyLoopMode = shouldCopyOnSingleClick(selectedNode, selectedHasKids);
      if (copyLoopMode) {
        clearFilterForCopyLoop();
        refreshMeta();
        renderTree();
        refocusTreeNavigation(selectedId);
      }
      void copyText(selectedNode.label).then((ok) => {
        if (!ok) return;
        showCopiedFeedback(selectedId);
      });
      return;
    }
  };
  window.addEventListener("keydown", handleGlobalShortcuts, { capture: true });
  document.addEventListener("keydown", handleGlobalShortcuts, { capture: true });
  const handleWindowFocusToTree = () => {
    if (isDetailsEditorOpen()) return;
    // When the popout/browser regains focus after the user has scrolled,
    // do not pull the list back to the previously selected row.
    // The next actual click/keyboard action will choose where focus belongs.
    requestAnimationFrame(() => {
      if (el.treeWrap instanceof HTMLElement) {
        el.treeWrap.focus({ preventScroll: true });
      }
    });
  };
  window.addEventListener("focus", handleWindowFocusToTree);
  window.addEventListener("beforeunload", handlePocketLiteBeforeUnload);
  window.onbeforeunload = handlePocketLiteBeforeUnload;
}

bind();
refreshMeta();
renderTree();
if (!restoreFromPipSnapshot()) {
  void autoLoadAtStartup();
}
