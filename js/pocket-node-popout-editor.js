/* Standalone node popout editor.
   This editor reads directly from nodeMap/state and saves directly back to the
   node. It deliberately does not read the retired inline details editor fields
   or recover browser drafts. */

(function initialisePocketNodePopoutEditor(global) {
  "use strict";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function normaliseDetailsSafe(value, max = 4000) {
    return typeof normaliseDetails === "function" ? normaliseDetails(value, max) : String(value || "").replace(/\r/g, "").trim().slice(0, max);
  }

  function popoutModel() {
    if (!global.PocketNodePopoutModel || typeof global.PocketNodePopoutModel.buildPayload !== "function" || typeof global.PocketNodePopoutModel.normaliseEditorMeta !== "function") {
      throw new Error("PocketNodePopoutModel is not loaded.");
    }
    return global.PocketNodePopoutModel;
  }

  function popoutWindow() {
    if (!global.PocketNodePopoutWindow || typeof global.PocketNodePopoutWindow.open !== "function") {
      throw new Error("PocketNodePopoutWindow is not loaded.");
    }
    return global.PocketNodePopoutWindow;
  }

  function popoutTarget() {
    if (!global.PocketNodePopoutTarget || typeof global.PocketNodePopoutTarget.get !== "function") {
      throw new Error("PocketNodePopoutTarget is not loaded.");
    }
    return global.PocketNodePopoutTarget;
  }

  function open(input) {
    const node = popoutTarget().get(input);
    if (!node) {
      if (typeof setStatus === "function") setStatus("Select an item first.", "warn");
      console.warn("[node popout editor] no node", { input, selectedId: global.state?.selectedId });
      return false;
    }

    const payload = popoutModel().buildPayload(node);
    if (!popoutWindow().open(payload)) return false;
    console.info("[node popout editor] opened", { id: payload.id, title: payload.title });
    return true;
  }

  function hasUnsavedOps() {
    return !!(global.state && Array.isArray(global.state.ops) && global.state.ops.length > 0);
  }

  function applyPayload(payload, options = {}) {
    const id = clean(payload?.id, 80);
    const node = popoutTarget().get(id);
    if (!id || !node) {
      if (typeof setStatus === "function") setStatus("Editor item no longer exists.", "warn");
      return { ok: false, changed: false, reason: "missing-node" };
    }

    const model = popoutModel();
    const beforeLabel = clean(node.label, 220);
    const beforeDetails = normaliseDetailsSafe(node.details, 4000);
    const beforeEditor = JSON.stringify(model.normaliseEditorMeta(node.editor) || null);
    const nextLabel = clean(payload.title, 220) || beforeLabel || "Untitled";
    const nextDetails = normaliseDetailsSafe(payload.body, 4000);
    const editorMeta = model.normaliseEditorMeta(payload);
    const afterEditor = JSON.stringify(editorMeta || null);
    const changed = beforeLabel !== nextLabel || beforeDetails !== nextDetails || beforeEditor !== afterEditor;

    if (!changed) {
      if (options.quiet !== true && typeof setStatus === "function") setStatus("No editor changes to save.", "ok");
      return { ok: true, changed: false, id: id, label: beforeLabel, reason: "unchanged" };
    }

    node.label = nextLabel;
    if (nextDetails) node.details = nextDetails;
    else delete node.details;
    if (editorMeta) node.editor = editorMeta;
    else delete node.editor;
    node.updatedAt = typeof nowIso === "function" ? nowIso() : new Date().toISOString();
    if (global.state) global.state.selectedId = id;

    if (typeof recordOp === "function") recordOp({ type: "details_edit", id: id, path: typeof getPath === "function" ? getPath(id) : "", changed: editorMeta ? "outline" : "details" });
    if (typeof refreshMeta === "function") refreshMeta();
    if (typeof renderTree === "function") renderTree();
    if (typeof focusRowByNodeId === "function") focusRowByNodeId(id, { instant: true });
    if (typeof saveWorkspaceState === "function") saveWorkspaceState();
    if (typeof persistPipSnapshot === "function") persistPipSnapshot();
    if (options.quiet !== true && typeof setStatus === "function") setStatus(editorMeta ? `Saved outline for "${clean(node.label, 80)}".` : `Saved details for "${clean(node.label, 80)}".`, "ok");
    console.info("[node popout editor] saved", { id: id, changed: editorMeta ? "outline" : "details" });
    return { ok: true, changed: true, id: id, label: clean(node.label, 220), reason: "changed" };
  }

  function apply(payload) {
    return applyPayload(payload).ok === true;
  }

  async function applyAndSave(payload, options = {}) {
    const applied = applyPayload(payload, { quiet: true });
    if (!applied.ok) {
      return { ok: false, applied: false, changed: false, exported: false, reason: applied.reason || "apply-failed" };
    }

    if (!applied.changed && !hasUnsavedOps() && options.exportUnchanged !== true) {
      if (typeof setStatus === "function") setStatus("No editor changes to save.", "ok");
      return { ok: true, applied: false, changed: false, exported: false, reason: "unchanged" };
    }

    if (typeof exportTree !== "function") {
      if (typeof setStatus === "function") setStatus("Editor saved locally. Main save is not available here.", "warn", { durationMs: 5200 });
      if (typeof flashSaveChip === "function") flashSaveChip("save*");
      return { ok: false, applied: true, changed: applied.changed, exported: false, reason: "export-unavailable" };
    }

    if (typeof flashSaveChip === "function") flashSaveChip("saving");
    if (typeof setStatus === "function") setStatus("Saving editor content and truth file...", "ok", { durationMs: 3200 });

    try {
      const exported = await exportTree({ ...(options.exportOptions || {}), returnDetails: true });
      if (exported && exported.ok === true) {
        return { ok: true, applied: true, changed: applied.changed, exported: true, reason: "exported" };
      }
      if (exported && exported.downloaded === true) {
        return { ok: false, applied: true, changed: applied.changed, exported: false, downloaded: true, reason: "downloaded-copy" };
      }
      return { ok: false, applied: true, changed: applied.changed, exported: false, reason: "export-failed-or-cancelled" };
    } catch (error) {
      console.error("[node popout editor] apply and save failed", error);
      if (typeof setStatus === "function") setStatus("Editor content saved locally, but the truth file save failed.", "warn", { durationMs: 6200 });
      if (typeof flashSaveChip === "function") flashSaveChip("save*");
      return { ok: false, applied: true, changed: applied.changed, exported: false, reason: "export-failed" };
    }
  }

  global.PocketNodePopoutEditor = Object.freeze({ open: open, apply: apply, applyAndSave: applyAndSave });
})(window);
