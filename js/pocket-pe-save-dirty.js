/* PE save dirty cue.
   PE already records an op through PocketPeEditor.apply(). This wrapper makes
   the main save/export chip visibly dirty after a PE local save. */
(function initialisePocketPeSaveDirtyCue(global) {
  "use strict";

  function install() {
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

  if (!install()) {
    window.setTimeout(install, 0);
    window.setTimeout(install, 250);
  }
})(window);
