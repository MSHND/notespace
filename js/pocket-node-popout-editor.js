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

  function getNode(input) {
    let id = "";
    if (typeof input === "string") id = clean(input, 80);
    else if (input && typeof input === "object") id = clean(input.id, 80);
    if (!id) id = clean(global.state?.selectedId, 80);
    if (!id || typeof nodeMap !== "function") return null;
    return nodeMap().get(id) || null;
  }

  function open(input) {
    const node = getNode(input);
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

  function apply(payload) {
    const id = clean(payload?.id, 80);
    const node = getNode(id);
    if (!id || !node) {
      if (typeof setStatus === "function") setStatus("Editor item no longer exists.", "warn");
      return false;
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
      if (typeof setStatus === "function") setStatus("No editor changes to save.", "ok");
      return true;
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
    if (typeof setStatus === "function") setStatus(editorMeta ? `Saved outline for "${clean(node.label, 80)}".` : `Saved details for "${clean(node.label, 80)}".`, "ok");
    console.info("[node popout editor] saved", { id: id, changed: editorMeta ? "outline" : "details" });
    return true;
  }

  global.PocketNodePopoutEditor = Object.freeze({ open: open, apply: apply });
})(window);
