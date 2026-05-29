/* Minimal editor route test.
   Enter opens a completely separate blank popout and does not block the
   existing inline editor. This only proves the key path/window path. */
(function initialisePocketNodeEditorRouteSmokeTest(global) {
  "use strict";

  function openBlankTestPopout() {
    const width = 520;
    const height = 380;
    const left = Math.max(0, Math.round((global.screen.availWidth - width) / 2));
    const top = Math.max(0, Math.round((global.screen.availHeight - height) / 2));
    const win = global.open("", "pocketStandaloneEditorSmokeTest", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!win) {
      if (typeof setStatus === "function") setStatus("Test popout blocked. Allow popups for pocket, then try Enter again.", "warn", { durationMs: 5200 });
      console.warn("[node editor route smoke] popup blocked");
      return false;
    }
    win.document.title = "pocket editor smoke test";
    win.document.body.style.margin = "24px";
    win.document.body.style.fontFamily = "system-ui, sans-serif";
    win.document.body.style.background = "#fbfbf8";
    win.document.body.style.color = "#0f172a";
    win.document.body.textContent = "Standalone editor test window. Enter opened this separate window. It is not connected to the inline editor yet.";
    win.focus();
    console.info("[node editor route smoke] popup opened");
    return true;
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    if (global.state?.moveMode || global.state?.inlineEdit?.id || global.pendingPathImport) return;
    // Deliberately do not preventDefault/stopPropagation. The existing inline
    // editor should still open too while we prove the separate popout path.
    openBlankTestPopout();
  }, true);

  global.openPocketNodeEditorSmokeTest = openBlankTestPopout;
  console.info("[node editor route smoke] installed");
})(window);
