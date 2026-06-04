/* Temporary PE version marker bump.
   Loaded before the simple standalone PE writer so it can patch the tiny version
   label inside newly opened PE popup windows. */
(function initialisePocketPeVersionV05(global) {
  "use strict";

  if (global.__pocketPeVersionV05Installed) return;

  const PE_VERSION_LABEL = "PE · simple v0.5";
  const originalOpen = global.open.bind(global);

  function patchVersionLabel(win) {
    try {
      if (!win || win.closed || !win.document) return false;
      const marker = win.document.querySelector(".peVersion");
      if (!(marker instanceof win.HTMLElement)) return false;
      marker.textContent = PE_VERSION_LABEL;
      marker.title = String(marker.title || "").replace(/PE · simple v\d+\.\d+/g, PE_VERSION_LABEL) || PE_VERSION_LABEL;
      return true;
    } catch (_error) {
      return false;
    }
  }

  function patchSoon(win) {
    [0, 80, 240, 520].forEach((delay) => window.setTimeout(() => patchVersionLabel(win), delay));
  }

  global.open = function pocketOpenWithPeVersionMarker(...args) {
    const win = originalOpen(...args);
    const name = String(args[1] || "");
    if (win && name.startsWith("pocketSimplePe_")) patchSoon(win);
    return win;
  };

  global.__pocketPeVersionV05Installed = true;
  console.info("[pe version marker] installed", PE_VERSION_LABEL);
})(window);
