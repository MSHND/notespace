/* Popout save acknowledgement hardening.
   Handles popout save messages in capture phase and replies directly to the source window. */

(function initialisePocketEditorSaveAck(global) {
  "use strict";

  function handlePopoutSaveWithAck(ev) {
    if (!ev.data || ev.data.type !== "pocketEditorPopout:save") return;
    if (!global.PocketEditorPopout || typeof global.PocketEditorPopout.apply !== "function") return;

    ev.stopImmediatePropagation();
    let ok = false;
    try {
      ok = global.PocketEditorPopout.apply(ev.data.payload) === true;
    } catch (error) {
      console.error(error);
      ok = false;
    }

    try {
      if (ok && ev.source && typeof ev.source.postMessage === "function") {
        ev.source.postMessage({ type: "pocketEditorPopout:saved" }, "*");
      }
    } catch (error) {
      console.error(error);
    }

    if (!ok && typeof setStatus === "function") {
      setStatus("Popout save was not applied. Check for a conflict prompt or try again.", "warn", { durationMs: 5200 });
    }
  }

  global.addEventListener("message", handlePopoutSaveWithAck, true);
})(window);
