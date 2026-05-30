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

  installOpenInterceptor();
})(window);
