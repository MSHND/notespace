/* Payload/model helpers for the standalone node popout editor. */
(function initialisePocketNodePopoutModel(global) {
  "use strict";

  const OUTLINE_EDITOR_SCHEMA = "pocket.nodeEditor.v1";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function normaliseDetailsSafe(value, max = 4000) {
    return typeof normaliseDetails === "function" ? normaliseDetails(value, max) : String(value || "").replace(/\r/g, "").trim().slice(0, max);
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

  function buildPayload(node) {
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

  global.PocketNodePopoutModel = Object.freeze({
    buildPayload: buildPayload,
    normaliseEditorMeta: normaliseEditorMeta
  });
})(window);
