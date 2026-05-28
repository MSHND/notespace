/* Normal detail editor dirty-state trust pass.
   Keeps the inline detail editor aligned with the popout: save / save*, guarded close. */

(function initialisePocketDetailDirtyState(global) {
  "use strict";

  const CLEAN_SAVE_LABEL = "save";
  const DIRTY_SAVE_LABEL = "save*";

  function isOpen() {
    return typeof isDetailsEditorOpen === "function" && isDetailsEditorOpen();
  }

  function isDirty() {
    return typeof hasUnsavedDetailsEditorChanges === "function" && hasUnsavedDetailsEditorChanges();
  }

  function setSaveDirtyState(nextDirty) {
    const button = document.getElementById("btnDetailSave");
    if (!(button instanceof HTMLButtonElement)) return;
    button.textContent = nextDirty ? DIRTY_SAVE_LABEL : CLEAN_SAVE_LABEL;
    button.classList.toggle("detailSaveDirty", !!nextDirty);
    button.title = nextDirty ? "Save detail changes" : "Save details";
  }

  function refreshDetailDirtyState() {
    if (!isOpen()) {
      setSaveDirtyState(false);
      return;
    }
    setSaveDirtyState(isDirty());
  }

  function closeDetailEditorQuietly() {
    if (!isOpen()) return false;
    if (!isDirty()) {
      closeDetailsEditor({ restoreFocus: true });
      setSaveDirtyState(false);
      return true;
    }

    const discard = global.confirm("Close without saving detail changes?");
    if (!discard) {
      refreshDetailDirtyState();
      return false;
    }
    closeDetailsEditor({ restoreFocus: true, revertDraft: true });
    setSaveDirtyState(false);
    if (typeof setStatus === "function") setStatus("Details edit cancelled.", "warn");
    return true;
  }

  function interceptCloseClick(ev) {
    if (!isOpen()) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    closeDetailEditorQuietly();
  }

  function interceptOverlayClick(ev) {
    const overlay = document.getElementById("detailOverlay");
    if (!isOpen() || ev.target !== overlay) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    closeDetailEditorQuietly();
  }

  function interceptEscape(ev) {
    if (!isOpen() || ev.key !== "Escape") return;
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    if (target !== el.detailEditorLabel && target !== el.detailEditorBody) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    closeDetailEditorQuietly();
  }

  function wrapEditorLifecycle() {
    if (typeof global.openDetailsEditorForSelectedNode === "function") {
      const originalOpen = global.openDetailsEditorForSelectedNode;
      global.openDetailsEditorForSelectedNode = function wrappedOpenDetailsEditorForSelectedNode(...args) {
        const result = originalOpen.apply(this, args);
        requestAnimationFrame(refreshDetailDirtyState);
        return result;
      };
    }

    if (typeof global.saveDetailsEditor === "function") {
      const originalSave = global.saveDetailsEditor;
      global.saveDetailsEditor = function wrappedSaveDetailsEditor(...args) {
        const result = originalSave.apply(this, args);
        requestAnimationFrame(refreshDetailDirtyState);
        return result;
      };
    }

    if (typeof global.closeDetailsEditor === "function") {
      const originalClose = global.closeDetailsEditor;
      global.closeDetailsEditor = function wrappedCloseDetailsEditor(...args) {
        const result = originalClose.apply(this, args);
        requestAnimationFrame(refreshDetailDirtyState);
        return result;
      };
    }
  }

  function init() {
    wrapEditorLifecycle();

    const saveButton = document.getElementById("btnDetailSave");
    const closeButton = document.getElementById("btnDetailCancel");
    const overlay = document.getElementById("detailOverlay");

    if (closeButton instanceof HTMLElement) closeButton.addEventListener("click", interceptCloseClick, true);
    if (overlay instanceof HTMLElement) overlay.addEventListener("click", interceptOverlayClick, true);

    [el.detailEditorLabel, el.detailEditorBody].forEach((field) => {
      if (!(field instanceof HTMLElement)) return;
      field.addEventListener("input", () => requestAnimationFrame(refreshDetailDirtyState));
      field.addEventListener("keydown", interceptEscape, true);
    });

    [el.detailEditorUrgent, el.detailEditorCopyContext].forEach((field) => {
      if (!(field instanceof HTMLElement)) return;
      field.addEventListener("change", () => requestAnimationFrame(refreshDetailDirtyState));
    });

    if (saveButton instanceof HTMLButtonElement) saveButton.textContent = CLEAN_SAVE_LABEL;
    refreshDetailDirtyState();
  }

  global.PocketDetailDirtyState = Object.freeze({ refresh: refreshDetailDirtyState, close: closeDetailEditorQuietly });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
