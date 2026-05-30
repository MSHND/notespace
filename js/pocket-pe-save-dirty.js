/* PE save dirty cue + old-details migration helper.
   PE already records an op through PocketPeEditor.apply(). This wrapper makes
   the main save/export chip visibly dirty after a PE local save, adds a small
   bridge button for old inline details, and makes Enter open PE only. */
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

  function openOldDetailsForCurrentNode() {
    const id = clean(global.state?.selectedId || global.state?.detailsEdit?.id, 80);
    if (id && global.state) global.state.selectedId = id;
    try {
      if (typeof global.openDetailsEditorForSelectedNode === "function") {
        global.openDetailsEditorForSelectedNode();
      }
      if (global.el?.detailOverlay instanceof HTMLElement) {
        global.el.detailOverlay.hidden = false;
      }
      if (typeof setStatus === "function") setStatus("Old inline details opened for copying.", "ok");
      return true;
    } catch (error) {
      console.warn("[pe old details] failed", error);
      if (typeof setStatus === "function") setStatus("Could not open old inline details.", "warn");
      return false;
    }
  }

  function injectOldDetailsButton(peWin) {
    try {
      if (!peWin || peWin.closed || !peWin.document) return false;
      const doc = peWin.document;
      if (doc.getElementById("peOldDetailsBtn")) return true;
      const bar = doc.querySelector(".bar");
      const saveBtn = doc.getElementById("saveBtn");
      if (!bar || !saveBtn) return false;
      const btn = doc.createElement("button");
      btn.id = "peOldDetailsBtn";
      btn.type = "button";
      btn.textContent = "old details";
      btn.title = "Open the old inline details editor for manual copying";
      btn.addEventListener("click", () => {
        try {
          if (peWin.opener && !peWin.opener.closed && peWin.opener.PocketPeOldDetailsBridge) {
            peWin.opener.PocketPeOldDetailsBridge.open();
          }
        } catch (error) {
          console.warn("[pe old details] popup button failed", error);
        }
      });
      saveBtn.insertAdjacentElement("afterend", btn);
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
        window.setTimeout(() => injectOldDetailsButton(win), 0);
        window.setTimeout(() => injectOldDetailsButton(win), 80);
        window.setTimeout(() => injectOldDetailsButton(win), 240);
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
      window.setTimeout(() => {
        if (typeof global.openPocketPeEditor === "function") global.openPocketPeEditor(capturedId);
      }, 0);
    }, true);
    global.__pocketPeEnterOnlyInstalled = true;
    console.info("[pe enter only] installed");
  }

  function installDirtyCue() {
    const pe = global.PocketPeEditor;
    if (!pe || typeof pe.apply !== "function" || pe.__dirtyCueWrapped) return false;
    const originalApply = pe.apply.bind(pe);
    const wrapped = function applyPeWithDirtyCue(payload) {
      const ok = originalApply(payload);
      if (ok) {
        if (typeof refreshMeta === "function") refreshMeta();
        if (typeof flashSaveChip === "function") flashSaveChip("save*");
        if (typeof setStatus === "function") {
          setStatus("PE saved locally — use main save to update pocket file.", "ok", { durationMs: 5200 });
        }
      }
      return ok;
    };
    global.PocketPeEditor = Object.freeze({ ...pe, apply: wrapped, __dirtyCueWrapped: true });
    console.info("[pe dirty cue] installed");
    return true;
  }

  global.PocketPeOldDetailsBridge = Object.freeze({ open: openOldDetailsForCurrentNode });
  installOpenInterceptor();
  installEnterPeOnly();
  if (!installDirtyCue()) {
    window.setTimeout(installDirtyCue, 0);
    window.setTimeout(installDirtyCue, 250);
  }
})(window);
