/* PE save dirty cue + old-details migration helper.
   The PE window does not save the truth file directly. It sends its payload to
   this main-window bridge, which applies the editor content and then performs
   the normal truth JSON save from the main window context. */
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
      if (typeof global.openDetailsEditorForSelectedNode === "function") global.openDetailsEditorForSelectedNode();
      if (global.el?.detailOverlay instanceof HTMLElement) global.el.detailOverlay.hidden = false;
      if (typeof focusRowByNodeId === "function") focusRowByNodeId(node.id, { instant: true });
      if (typeof setStatus === "function") setStatus("Old details opened for copying.", "ok");
      return true;
    } catch (error) {
      console.warn("[pe old details] failed", error);
      if (typeof setStatus === "function") setStatus("Could not open old details.", "warn");
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
      "You have unsaved changes.\n\n" +
      "OK leaves without saving.\n" +
      "Cancel returns to your unsaved work."
    );
    if (!ok) {
      if (typeof setStatus === "function") setStatus("Still unsaved — save before switching items.", "warn");
      console.warn("[pe switch guard] blocked", { nextNodeId });
      return false;
    }
    dirtyWin.__pocketPeDirty = false;
    console.warn("[pe switch guard] user discarded unsaved editor edits", { nextNodeId });
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
      const message = "You have unsaved changes.";
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
      console.info("[editor unsaved guard] installed");
      return true;
    } catch (_error) {
      return false;
    }
  }

  function installOutlineArrowPolish(peWin) {
    try {
      if (!peWin || peWin.closed || !peWin.document || peWin.__pocketOutlineArrowPolishInstalled) return false;
      const doc = peWin.document;
      const outlinePane = doc.getElementById("outlinePane");
      if (!outlinePane) return false;
      doc.addEventListener("keydown", (ev) => {
        if ((ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
        const input = ev.target instanceof peWin.HTMLInputElement ? ev.target : null;
        if (!input || !input.classList.contains("outlineInput")) return;
        const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
        if (!atStart) return;
        const row = input.closest(".outlineRow");
        const twist = row ? row.querySelector(".twist.hasKids") : null;
        if (!(twist instanceof peWin.HTMLElement)) return;
        const shouldCollapse = ev.key === "ArrowLeft" && twist.textContent === "▾";
        const shouldExpand = ev.key === "ArrowRight" && twist.textContent === "▸";
        if (!shouldCollapse && !shouldExpand) return;
        ev.preventDefault();
        ev.stopPropagation();
        twist.click();
      }, true);
      peWin.__pocketOutlineArrowPolishInstalled = true;
      console.info("[outline arrow polish] installed");
      return true;
    } catch (_error) {
      return false;
    }
  }

  function installOutlineSurfacePolish(peWin) {
    try {
      if (!peWin || peWin.closed || !peWin.document || peWin.__pocketOutlineSurfacePolishInstalled) return false;
      const doc = peWin.document;
      const style = doc.createElement("style");
      style.id = "pocketOutlineSurfacePolish";
      style.textContent = `
        #outlinePane { border: 0 !important; box-shadow: none !important; background: transparent !important; border-radius: 0 !important; padding: 6px 0 !important; }
        #outlinePane .outlineRow,
        #outlinePane .outlineRow:hover,
        #outlinePane .outlineRow:focus-within { border-radius: 0 !important; background: transparent !important; }
        #outlinePane .outlineInput,
        #outlinePane .outlineInput:focus { border: 0 !important; box-shadow: none !important; background: transparent !important; }
      `;
      doc.head.appendChild(style);
      peWin.__pocketOutlineSurfacePolishInstalled = true;
      console.info("[outline surface polish] installed");
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
      installOutlineArrowPolish(peWin);
      installOutlineSurfacePolish(peWin);
      if (doc.getElementById("peOldDetailsBtn")) return true;
      const bar = doc.querySelector(".bar");
      const saveBtn = doc.getElementById("saveBtn");
      if (!bar || !saveBtn) return false;
      const boundNodeId = clean(nodeId, 80);
      const btn = doc.createElement("button");
      btn.id = "peOldDetailsBtn";
      btn.type = "button";
      btn.textContent = "old details";
      btn.title = "Open this item's old details for manual copying";
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

  function installDirtyCue() {
    const pe = global.PocketPeEditor;
    if (!pe || typeof pe.apply !== "function" || pe.__dirtyCueWrapped) return false;
    const originalApply = pe.apply.bind(pe);
    const originalOpen = typeof pe.open === "function" ? pe.open.bind(pe) : null;

    async function applyAndSaveFromMain(payload) {
      const applied = originalApply(payload);
      if (!applied) return { ok: false, applied: false, saved: false, message: "apply failed" };

      if (global.__pocketPeWindow && !global.__pocketPeWindow.closed) global.__pocketPeWindow.__pocketPeDirty = false;
      if (typeof refreshMeta === "function") refreshMeta();
      if (typeof flashSaveChip === "function") flashSaveChip("saving");

      if (typeof exportTree !== "function") {
        if (typeof setStatus === "function") setStatus("Editor saved locally. Main save is not available here.", "warn", { durationMs: 5200 });
        if (typeof flashSaveChip === "function") flashSaveChip("save*");
        return { ok: true, applied: true, saved: false, message: "applied locally" };
      }

      if (typeof setStatus === "function") setStatus("Saving editor content and truth file…", "ok", { durationMs: 3200 });
      try {
        const saved = await exportTree({ downloadFallback: false });
        if (saved) return { ok: true, applied: true, saved: true, message: "saved" };
        if (typeof setStatus === "function") {
          setStatus("Editor saved locally. Use main Save to reconnect the truth file — no download copy was made.", "warn", { durationMs: 7200 });
        }
        if (typeof flashSaveChip === "function") flashSaveChip("save*");
        return { ok: true, applied: true, saved: false, message: "applied locally; main save needed" };
      } catch (error) {
        console.error("[pe apply-and-save bridge] failed", error);
        if (typeof setStatus === "function") setStatus("Editor content saved locally, but the truth file save failed.", "warn", { durationMs: 6200 });
        if (typeof flashSaveChip === "function") flashSaveChip("save*");
        return { ok: true, applied: true, saved: false, message: "truth save failed" };
      }
    }

    const wrappedApply = function applyPeWithDirtyCue(payload) {
      const ok = originalApply(payload);
      if (ok) {
        if (global.__pocketPeWindow && !global.__pocketPeWindow.closed) global.__pocketPeWindow.__pocketPeDirty = false;
        if (typeof refreshMeta === "function") refreshMeta();
        if (typeof flashSaveChip === "function") flashSaveChip("save*");
        if (typeof setStatus === "function") setStatus("Editor content applied. Main save still needed.", "warn", { durationMs: 5200 });
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

    global.__pocketPeApplyAndSave = applyAndSaveFromMain;
    global.PocketPeEditor = Object.freeze({ ...pe, open: wrappedOpen, apply: wrappedApply, __dirtyCueWrapped: true });
    if (typeof wrappedOpen === "function") global.openPocketPeEditor = wrappedOpen;
    console.info("[pe apply-and-save bridge] installed");
    return true;
  }

  global.PocketPeOldDetailsBridge = Object.freeze({ open: openOldDetailsForNode });
  installOpenInterceptor();
  if (!installDirtyCue()) {
    window.setTimeout(installDirtyCue, 0);
    window.setTimeout(installDirtyCue, 250);
  }
})(window);
