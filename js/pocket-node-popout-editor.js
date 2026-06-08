/* Standalone node popout editor.
   This editor reads directly from nodeMap/state and saves directly back to the
   node. It deliberately does not read the retired inline details editor fields
   or recover browser drafts. */

(function initialisePocketNodePopoutEditor(global) {
  "use strict";

  let editorWindow = null;
  const OUTLINE_EDITOR_SCHEMA = "pocket.nodeEditor.v1";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function normaliseDetailsSafe(value, max = 4000) {
    return typeof normaliseDetails === "function" ? normaliseDetails(value, max) : String(value || "").replace(/\r/g, "").trim().slice(0, max);
  }

  function htmlEscape(value) {
    return String(value || "").replace(/[&<>\"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch];
    });
  }

  function safeJson(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c");
  }

  function getNode(input) {
    let id = "";
    if (typeof input === "string") id = clean(input, 80);
    else if (input && typeof input === "object") id = clean(input.id, 80);
    if (!id) id = clean(global.state?.selectedId, 80);
    if (!id || typeof nodeMap !== "function") return null;
    return nodeMap().get(id) || null;
  }

  function normaliseOutlineBlock(raw, index) {
    const depth = Number(raw?.depth);
    return {
      id: clean(raw?.id, 80) || (typeof makeId === "function" ? makeId("block") : "block_" + index),
      text: String(raw?.text == null ? "" : raw.text).replace(/\r/g, "").slice(0, 4000),
      depth: Number.isFinite(depth) ? Math.max(0, Math.min(8, Math.round(depth))) : 0,
      collapsed: raw?.collapsed === true,
      order: index + 1
    };
  }

  function normaliseEditorMeta(value) {
    if (!value || typeof value !== "object") return null;
    const mode = clean(value.mode, 24).toLowerCase() === "outline" ? "outline" : "text";
    if (mode !== "outline") return null;
    const outline = Array.isArray(value.outline) ? value.outline.slice(0, 400).map(normaliseOutlineBlock) : [];
    const meaningful = outline.some(function (block) {
      return (Number(block.depth) || 0) > 0 || block.collapsed === true || clean(block.text, 4000);
    });
    if (!meaningful) return null;
    return { schema: OUTLINE_EDITOR_SCHEMA, mode: "outline", outline: outline };
  }

  function payloadFromNode(node) {
    const editor = normaliseEditorMeta(node.editor) || null;
    return {
      id: clean(node.id, 80),
      title: clean(node.label, 220) || "Untitled",
      body: normaliseDetailsSafe(node.details, 4000),
      mode: editor?.mode || "text",
      outline: Array.isArray(editor?.outline) ? editor.outline : null,
      path: typeof getPath === "function" ? getPath(node.id) : "",
      openedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function editorHtml(payload) {
    if (!global.PocketNodePopoutTemplate || typeof global.PocketNodePopoutTemplate.render !== "function") {
      throw new Error("PocketNodePopoutTemplate is not loaded.");
    }
    if (!global.PocketNodePopoutRuntime || typeof global.PocketNodePopoutRuntime.build !== "function") {
      throw new Error("PocketNodePopoutRuntime is not loaded.");
    }
    return global.PocketNodePopoutTemplate.render(payload, {
      htmlEscape: htmlEscape,
      runtimeScript: global.PocketNodePopoutRuntime.build(safeJson(payload))
    });
  }

  function open(input) {
    const node = getNode(input);
    if (!node) {
      if (typeof setStatus === "function") setStatus("Select an item first.", "warn");
      console.warn("[node popout editor] no node", { input, selectedId: global.state?.selectedId });
      return false;
    }

    const payload = payloadFromNode(node);
    const width = Math.min(820, Math.max(600, Math.round(global.screen.availWidth * 0.5)));
    const height = Math.min(820, Math.max(600, Math.round(global.screen.availHeight * 0.76)));
    const left = Math.round((global.screen.availWidth - width) / 2);
    const top = Math.round((global.screen.availHeight - height) / 2);
    editorWindow = global.open("", "pocketNodePopoutEditor", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!editorWindow) {
      if (typeof setStatus === "function") setStatus("Popout blocked. Allow popups for pocket, then try again.", "warn", { durationMs: 5200 });
      return false;
    }
    editorWindow.document.open();
    editorWindow.document.write(editorHtml(payload));
    editorWindow.document.close();
    editorWindow.focus();
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

    const beforeLabel = clean(node.label, 220);
    const beforeDetails = normaliseDetailsSafe(node.details, 4000);
    const beforeEditor = JSON.stringify(normaliseEditorMeta(node.editor) || null);
    const nextLabel = clean(payload.title, 220) || beforeLabel || "Untitled";
    const nextDetails = normaliseDetailsSafe(payload.body, 4000);
    const editorMeta = normaliseEditorMeta(payload);
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
