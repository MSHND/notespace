/* PE visible-version compatibility patch.
   First-class editor and pe preservation is owned by pocket-import.js. */
(function initialisePocketPeVisibleVersion(global) {
  "use strict";

  const PE_VISIBLE_VERSION = "PE · simple v0.5";

  function installPeVersionMarkerPatch() {
    if (global.__pocketPeVisibleVersionPatchInstalled) return;
    const originalOpen = global.open.bind(global);

    function patchVersionLabel(win) {
      try {
        if (!win || win.closed || !win.document) return false;
        const marker = win.document.querySelector(".peVersion");
        if (!(marker instanceof win.HTMLElement)) return false;
        marker.textContent = PE_VISIBLE_VERSION;
        marker.title = String(marker.title || "").replace(/PE · simple v\d+\.\d+/g, PE_VISIBLE_VERSION) || PE_VISIBLE_VERSION;
        return true;
      } catch (_error) {
        return false;
      }
    }

    function patchSoon(win) {
      [0, 80, 240, 520].forEach((delay) => window.setTimeout(() => patchVersionLabel(win), delay));
    }

    function allowSwitchFromExistingPe() {
      const existing = global.__pocketPeWindow;
      if (!existing || existing.closed) return true;
      if (existing.__pocketPeDirty) {
        try { existing.focus(); } catch (_error) {}
        const ok = global.confirm("You have unsaved changes in the open editor.\n\nOK switches editor. Cancel keeps the current editor open.");
        if (!ok) return false;
        existing.__pocketPeDirty = false;
      }
      try { existing.close(); } catch (_error) {}
      global.__pocketPeWindow = null;
      return true;
    }

    global.open = function pocketOpenWithPeVisibleVersion(...args) {
      const name = String(args[1] || "");
      const isSimplePe = name.startsWith("pocketSimplePe_");
      if (isSimplePe && !allowSwitchFromExistingPe()) return null;
      const win = originalOpen(...args);
      if (win && isSimplePe) {
        global.__pocketPeWindow = win;
        patchSoon(win);
      }
      return win;
    };

    global.__pocketPeVisibleVersionPatchInstalled = true;
    console.info("[pe visible version] installed", PE_VISIBLE_VERSION);
  }

  installPeVersionMarkerPatch();
})(window);
