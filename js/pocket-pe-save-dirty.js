/* PE save dirty cue + old-details migration helper.
   PE already records an op through PocketPeEditor.apply(). This wrapper makes
   the main save/export chip visibly dirty after a PE local save, adds a small
   node-bound bridge button for old inline details, makes Enter open PE only,
   adds a browser close/refresh guard for unsaved PE edits, and blocks node
   switching while PE has unsaved local edits. */
(function initialisePocketPeSaveDirtyCue(global) {
  "use strict";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function domSelectedNodeId() {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const activeRow = active ? active.closest("[data-node-id]") : null;
    const selectedRow = document.querySelector(".row.selected[data-node-id], .row:focus[data-node-id], [aria-selected='true'][data-node-id]");
    const row = activeRow || selectedRow;
    return row instanceof HTMLElement ? clean(row.getAttribute("data-node-id"), 80) : "";
  }

  function nodeIdFromEvent(ev) {
    const target = ev?.target instanceof HTMLElement ? ev.target : null;
    const row = target ? target.closest("[data-node-id]") : null;
    return row instanceof HTMLElement ? clean(row.getAttribute("data-node-id"), 80) : "";
  }

  function nodeById(id) {
    return id && typeof nodeMap === "function" ? nodeMap().get(id) || null : null;
  }

  function openOldDetailsForNode(nodeId) {
    const id = clean(nodeId || global.state?.selectedId || global.state?.detailsEdit?.id, 80);
    const node = nodeById(id);
    if (!node) {
      if (typeof setStatus === "function") setStatus("Could not find that node for old details.", "warn");
      return false;
    }
    if (global.state) global.state.selectedId = node.id;
    try {
      if (typeof global.openDetailsEditorForSelectedNode === "function") {
        global.openDetailsEditorForSelectedNode();
      }
      if (global.el?.detailOverlay instanceof HTMLElement) {
        global.el.detailOverlay.hidden = false;
      }
      if (typeof focusRowByNodeId === "function") focusRowByNodeId(node.id, { instant: true });
      if (typeof setStatus === "function") setStatus("Old inline details opened for copying.", "ok");
      return true;
    } catch (error) {
      console.warn("[pe old details] failed", error);
      if (typeof setStatus === "function") setStatus("Could not open old inline details.", "warn");
      return false;
    }
  }

  function existingDirtyPeWindow() {
    const win = global.__pocketPeWindow;
    if (!win || win.closed) return null;
    return win.__pocketPeDirty ? win : null;
  }

  function confirmPeSwitch(nextNodeId) {
    const dirtyWin = existingDirtyPeWindow();
    if (!dirtyWin) return true;
    try { dirtyWin.focus(); } catch (_error) {}
    const ok = global.confirm(
      "This PE has unsaved changes.\n\n" +
      "Switch to the new node and lose those changes?\n\n" +
      "Choose Cancel to stay here and save first."
    );
    if (!ok) {
      if (typeof setStatus === "function") setStatus("PE still has unsaved changes — save before switching nodes.", "warn");
      console.warn("[pe switch guard] blocked", { nextNodeId });
      return false;
    }
    dirtyWin.__pocketPeDirty = false;
    console.warn("[pe switch guard] user discarded unsaved PE edits", { nextNodeId });
    return true;
  }

  function installPeUnsavedGuard(peWin) {
    try {
      if (!peWin || peWin.closed || !peWin.document || peWin.__pocketPeUnsavedGuardInstalled) return false;
      const doc = peWin.document;
      const title = doc.getElementById("title");
      const text = doc.getElementById("text");
      const saveBtn = doc.getElementById("saveBtn");
      if (!title || !text || !saveBtn) return false;
      const message = "This PE has unsaved changes.";
      peWin.__pocketPeDirty = false;
      const markDirty = () => { peWin.__pocketPeDirty = true; };
      const markCleanSoon = () => window.setTimeout(() => { peWin.__pocketPeDirty = false; }, 80);
      title.addEventListener("input", markDirty);
      text.addEventListener("input", markDirty);
      saveBtn.addEventListener("click", markCleanSoon);
      peWin.addEventListener("beforeunload", (ev) => {
        if (!peWin.__pocketPeDirty) return undefined;
        ev.preventDefault();
        ev.returnValue = message;
        return message;
      });
      peWin.__pocketPeUnsavedGuardInstalled = true;
      console.info("[pe unsaved guard] installed");
      return true;
    } catch (_error) {
      return false;
    }
  }

  function injectOldDetailsButton(peWin, nodeId) {
    try {
      if (!peWin || peWin.closed || !peWin.document) return false;
      const doc = peWin.document;
      installPeUnsavedGuard(peWin);
      if (doc.getElementById("peOldDetailsBtn")) return true;
      const bar = doc.querySelector(".bar");
      const saveBtn = doc.getElementById("saveBtn");
      if (!bar || !saveBtn) return false;
      const boundNodeId = clean(nodeId, 80);
      const btn = doc.createElement("button");
      btn.id = "peOldDetailsBtn";
      btn.type = "button";
      btn.textContent = "old details";
      btn.title = "Open this node's old inline details for manual copying";
      btn.addEventListener("click", () => {
        try {
          if (peWin.opener && !peWin.opener.closed && peWin.opener.PocketPeOldDetailsBridge) {
            peWin.opener.PocketPeOldDetailsBridge.open(boundNodeId);
          }
        } catch (error) {
          console.warn("[pe old details] popup button failed", error);
        }
      });
      saveBtn.insertAdjacentElement("afterend", btn);
      console.info("[pe old details] button bound", { id: boundNodeId });
      return true;
    } catch (_error) {
      return false;
    }
  }

  function installOpenInterceptor() {
    if (global.__pocketPeOldDetailsOpenWrapped) return;
    const originalOpen = global.open.bind(global);
    global.open = function pocketPeOpenWithOldDetailsButton(...args) {
      const win = originalOpen(...args);
      const name = String(args[1] || "");
      if (name === "pocketStandalonePe" && win) {
        global.__pocketPeWindow = win;
        const boundNodeId = clean(global.__pocketPeOpeningNodeId || global.state?.selectedId || domSelectedNodeId(), 80);
        window.setTimeout(() => injectOldDetailsButton(win, boundNodeId), 0);
        window.setTimeout(() => injectOldDetailsButton(win, boundNodeId), 80);
        window.setTimeout(() => injectOldDetailsButton(win, boundNodeId), 240);
      }
      return win;
    };
    global.__pocketPeOldDetailsOpenWrapped = true;
    console.info("[pe old details] window.open interceptor installed");
  }

  function installEnterPeOnly() {
    if (global.__pocketPeEnterOnlyInstalled) return;
    document.addEventListener("keydown", function peOnlyEnterCapture(ev) {
      if (ev.key !== "Enter" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
      if (global.state?.moveMode || global.state?.inlineEdit?.id || global.pendingPathImport) return;
      const capturedId = nodeIdFromEvent(ev) || domSelectedNodeId() || clean(global.state?.selectedId, 80);
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      if (!confirmPeSwitch(capturedId)) return;
      global.__pocketPeOpeningNodeId = capturedId;
      window.setTimeout(() => {
        if (typeof global.openPocketPeEditor === "function") global.openPocketPeEditor(capturedId);
        window.setTimeout(() => { if (global.__pocketPeOpeningNodeId === capturedId) global.__pocketPeOpeningNodeId = ""; }, 500);
      }, 0);
    }, true);
    global.__pocketPeEnterOnlyInstalled = true;
    console.info("[pe enter only] installed");
  }

  function installDirtyCue() {
    const pe = global.PocketPeEditor;
    if (!pe || typeof pe.apply !== "function" || pe.__dirtyCueWrapped) return false;
    const originalApply = pe.apply.bind(pe);
    const originalOpen = typeof pe.open === "function" ? pe.open.bind(pe) : null;
    const wrappedApply = function applyPeWithDirtyCue(payload) {
      const ok = originalApply(payload);
      if (ok) {
        if (global.__pocketPeWindow && !global.__pocketPeWindow.closed) global.__pocketPeWindow.__pocketPeDirty = false;
        if (typeof refreshMeta === "function") refreshMeta();
        if (typeof flashSaveChip === "function") flashSaveChip("save*");
        if (typeof setStatus === "function") {
          setStatus("PE saved locally — use main save to update pocket file.", "ok", { durationMs: 5200 });
        }
      }
      return ok;
    };
    const wrappedOpen = originalOpen ? function openPeWithNodeBinding(nodeId) {
      const id = clean(nodeId || global.state?.selectedId || domSelectedNodeId(), 80);
      if (!confirmPeSwitch(id)) return false;
      global.__pocketPeOpeningNodeId = id;
      const result = originalOpen(id);
      window.setTimeout(() => { if (global.__pocketPeOpeningNodeId === id) global.__pocketPeOpeningNodeId = ""; }, 500);
      return result;
    } : pe.open;
    global.PocketPeEditor = Object.freeze({ ...pe, open: wrappedOpen, apply: wrappedApply, __dirtyCueWrapped: true });
    if (typeof wrappedOpen === "function") global.openPocketPeEditor = wrappedOpen;
    console.info("[pe dirty cue] installed");
    return true;
  }

  global.PocketPeOldDetailsBridge = Object.freeze({ open: openOldDetailsForNode });
  installOpenInterceptor();
  installEnterPeOnly();
  if (!installDirtyCue()) {
    window.setTimeout(installDirtyCue, 0);
    window.setTimeout(installDirtyCue, 250);
  }
})(window);
