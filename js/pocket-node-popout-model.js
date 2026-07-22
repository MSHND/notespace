/* Payload/model helpers for the standalone node popout editor. */
(function initialisePocketNodePopoutModel(global) {
  "use strict";

  const OUTLINE_EDITOR_SCHEMA = "pocket.nodeEditor.v1";
  const UNSUPPORTED_EDITOR_MESSAGE = "This item uses editor data that this version of Pocket can't safely edit. Its readable text is shown below, and nothing will be changed.";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function normaliseDetailsSafe(value, max = 4000) {
    return typeof normaliseDetails === "function" ? normaliseDetails(value, max) : String(value || "").replace(/\r/g, "").trim().slice(0, max);
  }

  function metadataContract() {
    const contract = global.PocketEditorMetadata;
    if (!contract || typeof contract.classifyEditorMeta !== "function" || typeof contract.normaliseSupportedEditorMeta !== "function" || typeof contract.cloneJsonCompatibleValue !== "function") {
      throw new Error("PocketEditorMetadata is not loaded.");
    }
    return contract;
  }

  function classifyEditorMeta(value, options = {}) {
    return metadataContract().classifyEditorMeta(value, options);
  }

  function classifyNodeEditor(node) {
    const present = !!node && typeof node === "object" && Object.prototype.hasOwnProperty.call(node, "editor");
    const classification = classifyEditorMeta(present ? node.editor : undefined, { present });
    const hasPe = !!node && typeof node === "object" && Object.prototype.hasOwnProperty.call(node, "pe");
    if (hasPe && !metadataContract().cloneJsonCompatibleValue(node.pe).ok) {
      return { kind: "unsupported-or-malformed", supported: false, schema: classification.schema || "", normalised: null };
    }
    return classification;
  }

  function normaliseEditorMeta(value) {
    return metadataContract().normaliseSupportedEditorMeta(value);
  }

  function buildPayload(node) {
    const classification = classifyNodeEditor(node);
    const editor = classification.kind === "supported-v1-outline" ? classification.normalised : null;
    const payload = {
      id: clean(node.id, 80),
      title: clean(node.label, 220) || "Untitled",
      body: normaliseDetailsSafe(node.details, 4000),
      mode: editor?.mode || "text",
      outline: Array.isArray(editor?.outline) ? editor.outline : null,
      path: typeof getPath === "function" ? getPath(node.id) : "",
      openedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (editor) payload.schema = OUTLINE_EDITOR_SCHEMA;
    if (classification.kind === "unsupported-or-malformed") {
      payload.mode = "text";
      payload.outline = null;
      payload.readOnly = true;
      payload.readOnlyReason = "unsupported-editor";
      payload.readOnlyMessage = UNSUPPORTED_EDITOR_MESSAGE;
      if (classification.schema) payload.editorSchema = classification.schema;
    }
    return payload;
  }

  global.PocketNodePopoutModel = Object.freeze({
    buildPayload: buildPayload,
    classifyEditorMeta: classifyEditorMeta,
    classifyNodeEditor: classifyNodeEditor,
    normaliseEditorMeta: normaliseEditorMeta
  });
})(window);
