/* Gentle editor conflict guard.
   If the normal detail editor changes after a popout opens, ask before popout overwrites it. */

(function initialisePocketEditorConflictGuard(global) {
  "use strict";

  const baselines = new Map();

  function clean(value, max = 220) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function normalDetails(value) {
    return typeof normaliseDetails === "function" ? normaliseDetails(value, 4000) : String(value || "").replace(/\r/g, "").trim();
  }

  function currentNodeSnapshot(id) {
    const node = id && typeof nodeMap === "function" ? nodeMap().get(id) : null;
    if (!node) return null;
    return {
      id,
      label: clean(node.label, 220),
      details: normalDetails(node.details),
      updatedAt: clean(node.updatedAt, 40)
    };
  }

  function currentVisibleEditorSnapshot(id) {
    if (!(typeof isDetailsEditorOpen === "function" && isDetailsEditorOpen())) return null;
    if (clean(global.state?.detailsEdit?.id, 80) !== clean(id, 80)) return null;
    return {
      id,
      label: el.detailEditorLabel instanceof HTMLInputElement ? clean(el.detailEditorLabel.value, 220) : "",
      details: el.detailEditorBody instanceof HTMLTextAreaElement ? normalDetails(el.detailEditorBody.value) : ""
    };
  }

  function rememberBaselineForPopout() {
    const id = clean(global.state?.detailsEdit?.id || global.state?.selectedId, 80);
    const snap = currentNodeSnapshot(id);
    if (!snap) return;
    baselines.set(id, snap);
  }

  function payloadSnapshot(payload) {
    return {
      id: clean(payload?.id, 80),
      label: clean(payload?.title, 220),
      details: normalDetails(payload?.body)
    };
  }

  function hasMeaningfulConflict(payload) {
    const incoming = payloadSnapshot(payload);
    if (!incoming.id) return false;

    const base = baselines.get(incoming.id);
    const now = currentNodeSnapshot(incoming.id);
    if (!base || !now) return false;
    if (!base.updatedAt || base.updatedAt === now.updatedAt) return false;

    const visible = currentVisibleEditorSnapshot(incoming.id) || now;
    const mainChangedFromBase = visible.label !== base.label || visible.details !== base.details;
    const popoutDiffersFromMain = incoming.label !== visible.label || incoming.details !== visible.details;
    return mainChangedFromBase && popoutDiffersFromMain;
  }

  function wrapPopoutApply() {
    const current = global.PocketEditorPopout;
    if (!current || typeof current.apply !== "function" || typeof current.open !== "function") return false;

    const originalApply = current.apply;
    const originalOpen = current.open;

    global.PocketEditorPopout = Object.freeze({
      open: function guardedOpen(...args) {
        rememberBaselineForPopout();
        return originalOpen.apply(this, args);
      },
      apply: function guardedApply(payload, ...rest) {
        if (hasMeaningfulConflict(payload)) {
          const usePopout = global.confirm(
            "The main detail editor changed since this popout opened.\n\n" +
            "OK: save the popout version\n" +
            "Cancel: keep the main editor version"
          );
          if (!usePopout) {
            if (typeof setStatus === "function") setStatus("Kept main editor changes. Popout draft is still open.", "warn", { durationMs: 4200 });
            return false;
          }
        }
        const ok = originalApply.call(this, payload, ...rest);
        if (ok && payload?.id) baselines.delete(clean(payload.id, 80));
        return ok;
      }
    });
    return true;
  }

  function init() {
    const button = document.getElementById("btnDetailPopout");
    if (button) button.addEventListener("click", rememberBaselineForPopout, true);
    wrapPopoutApply();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
