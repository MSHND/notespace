/* Human-friendly close handling for the standalone editor.
   Browser close/refresh still uses the browser's generic beforeunload wording.
   This script gives the editor's normal X and Escape paths a clearer prompt. */
(function initialisePocketEditorHumanClose(global) {
  "use strict";

  const UNSAVED_PROMPT = "You have unsaved changes.\n\nOK leaves without saving.\nCancel returns to your unsaved work.";

  function install(peWin) {
    try {
      if (!peWin || peWin.closed || !peWin.document || peWin.__pocketHumanCloseInstalled) return false;
      const doc = peWin.document;
      const closeBtn = doc.getElementById("closeBtn");
      const closeWithPrompt = (ev) => {
        if (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation();
        }
        if (peWin.__pocketPeDirty) {
          const ok = global.confirm(UNSAVED_PROMPT);
          if (!ok) return false;
          peWin.__pocketPeDirty = false;
        }
        peWin.close();
        return true;
      };
      if (closeBtn) closeBtn.addEventListener("click", closeWithPrompt, true);
      doc.addEventListener("keydown", (ev) => {
        if (ev.key !== "Escape" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
        closeWithPrompt(ev);
      }, true);
      peWin.__pocketHumanCloseInstalled = true;
      console.info("[editor human close] installed");
      return true;
    } catch (_error) {
      return false;
    }
  }

  function installOpenInterceptor() {
    if (global.__pocketHumanCloseOpenWrapped) return;
    const originalOpen = global.open.bind(global);
    global.open = function pocketOpenWithHumanClose(...args) {
      const win = originalOpen(...args);
      const name = String(args[1] || "");
      if (name === "pocketStandalonePe" && win) {
        window.setTimeout(() => install(win), 0);
        window.setTimeout(() => install(win), 80);
        window.setTimeout(() => install(win), 240);
      }
      return win;
    };
    global.__pocketHumanCloseOpenWrapped = true;
    console.info("[editor human close] window.open interceptor installed");
  }

  function installEditRouteInterceptor() {
    if (global.__pocketItemDetailsEditRouteInstalled) return;
    const clean = (value, max = 80) => typeof cleanText === "function"
      ? cleanText(value, max)
      : String(value || "").trim().slice(0, max);

    const selectedIdFromEvent = (ev) => {
      const target = ev.target instanceof HTMLElement ? ev.target : null;
      const row = target ? target.closest("[data-node-id]") : null;
      const rowId = row instanceof HTMLElement ? clean(row.getAttribute("data-node-id"), 80) : "";
      return rowId
        || clean(global.state?.rowMiniMenuNodeId, 80)
        || clean(global.state?.selectedId, 80);
    };

    const isEditAction = (target) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.closest("#cmdEdit") || target.closest("#btnOpenPrimary")) return true;
      const menuButton = target.closest(".rowMiniMenuBtn");
      if (!(menuButton instanceof HTMLElement)) return false;
      return clean(menuButton.textContent, 40).toLowerCase().startsWith("edit");
    };

    document.addEventListener("click", (ev) => {
      const target = ev.target instanceof HTMLElement ? ev.target : null;
      if (!isEditAction(target)) return;
      const id = selectedIdFromEvent(ev);
      if (!id) return;
      if (global.state) global.state.selectedId = id;
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      if (typeof closeCommandPalette === "function") closeCommandPalette({ restoreFocus: false });
      if (typeof closeRowMiniMenu === "function") closeRowMiniMenu({ restoreFocus: false });
      if (typeof global.openPocketNodeEditor === "function") {
        global.openPocketNodeEditor(id);
        return;
      }
      if (typeof global.openPocketEditor === "function") {
        global.openPocketEditor(id);
        return;
      }
      if (typeof openDetailsEditorForSelectedNode === "function") openDetailsEditorForSelectedNode();
    }, true);

    global.__pocketItemDetailsEditRouteInstalled = true;
    console.info("[item details edit route] installed");
  }

  installOpenInterceptor();
  installEditRouteInterceptor();
})(window);
