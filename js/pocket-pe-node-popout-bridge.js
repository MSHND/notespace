/* PE node popout bridge.
   Dormant until loaded. When loaded after PocketNodePopoutEditor, exposes the
   canonical PocketPeEditor surface by delegating to the node popout editor. */
(function initialisePocketPeNodePopoutBridge(global) {
  "use strict";

  const VERSION = "PE node popout bridge v1";
  const existing = global.PocketPeEditor && typeof global.PocketPeEditor === "object"
    ? global.PocketPeEditor
    : {};
  const next = { ...existing, version: VERSION };

  function nodePopout() {
    return global.PocketNodePopoutEditor && typeof global.PocketNodePopoutEditor === "object"
      ? global.PocketNodePopoutEditor
      : null;
  }

  if (typeof nodePopout()?.open === "function") {
    next.open = function openPocketPeViaNodePopout(input) {
      const target = nodePopout();
      if (!target || typeof target.open !== "function") return false;
      try {
        return target.open(input) === true;
      } catch (error) {
        console.warn("[PE node popout bridge] open failed", error);
        return false;
      }
    };
  }

  if (typeof nodePopout()?.apply === "function") {
    next.apply = function applyPocketPeViaNodePopout(payload) {
      const target = nodePopout();
      if (!target || typeof target.apply !== "function") return false;
      try {
        return target.apply(payload) === true;
      } catch (error) {
        console.warn("[PE node popout bridge] apply failed", error);
        return false;
      }
    };
  }

  global.PocketPeEditor = Object.freeze(next);
})(window);
