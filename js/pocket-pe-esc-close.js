/* PE Esc close guard.
   Captures simple PE popup windows and makes Escape close them. If the PE window
   has unsaved edits, it asks before closing; otherwise it closes immediately. */
(function initialisePocketPeEscClose(global) {
  "use strict";

  if (global.__pocketPeEscCloseInstalled) return;

  function installEscClose(peWin) {
    try {
      if (!peWin || peWin.closed || !peWin.document || peWin.__pocketPeEscCloseInstalled) return false;
      peWin.__pocketPeEscCloseInstalled = true;

      function closePeWindow() {
        if (!peWin.__pocketPeDirty) {
          peWin.close();
          return;
        }
        const ok = peWin.confirm(
          "You have unsaved changes.\n\n" +
          "OK closes without saving.\n" +
          "Cancel returns to your unsaved work."
        );
        if (ok) peWin.close();
      }

      peWin.document.addEventListener("keydown", (ev) => {
        if (ev.key !== "Escape" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
        ev.preventDefault();
        ev.stopPropagation();
        closePeWindow();
      }, true);

      console.info("[pe esc close] installed");
      return true;
    } catch (_error) {
      return false;
    }
  }

  const originalOpen = global.open.bind(global);
  global.open = function pocketOpenWithPeEscClose(...args) {
    const win = originalOpen(...args);
    const name = String(args[1] || "");
    if (win && name.startsWith("pocketSimplePe_")) {
      window.setTimeout(() => installEscClose(win), 0);
      window.setTimeout(() => installEscClose(win), 80);
      window.setTimeout(() => installEscClose(win), 240);
    }
    return win;
  };

  global.__pocketPeEscCloseInstalled = true;
  console.info("[pe esc close guard] installed");
})(window);
