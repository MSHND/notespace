/* Payload/model helpers for the standalone node popout editor. */
(function initialisePocketNodePopoutModel(global) {
  "use strict";

  const OUTLINE_EDITOR_SCHEMA = "pocket.nodeEditor.v1";
  const UNSUPPORTED_EDITOR_MESSAGE = "This item uses editor data that this version of Pocket can't safely edit. Its readable text is shown below, and nothing will be changed.";
  const SAVE_LIMITS = Object.freeze({
    title: 220,
    details: 4000,
    outlineBlocks: 400,
    blockText: 4000,
    blockId: 80,
    depth: 8
  });

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

  function saveIssue(reason, message, status, extra = {}) {
    return {
      ok: false,
      reason,
      message,
      status,
      ...extra
    };
  }

  function fullClean(value) {
    return clean(value, Number.MAX_SAFE_INTEGER);
  }

  function fullDetails(value) {
    return normaliseDetailsSafe(value, Number.MAX_SAFE_INTEGER);
  }

  function validateOutlineBlocks(rawOutline, options = {}) {
    const stored = options.stored === true;
    if (!Array.isArray(rawOutline)) {
      return saveIssue(
        "invalid-outline",
        "Pocket could not safely read this outline. Nothing was changed.",
        "Outline is not valid — not saved"
      );
    }
    if (rawOutline.length > SAVE_LIMITS.outlineBlocks) {
      return saveIssue(
        "outline-too-many-blocks",
        `This outline has ${rawOutline.length} rows. Pocket can safely save up to ${SAVE_LIMITS.outlineBlocks}. Nothing was changed.`,
        "Too many outline rows — not saved",
        { actual: rawOutline.length, limit: SAVE_LIMITS.outlineBlocks }
      );
    }

    const ids = new Set();
    for (let index = 0; index < rawOutline.length; index += 1) {
      const block = rawOutline[index];
      if (!block || typeof block !== "object" || Array.isArray(block)) {
        return saveIssue(
          "invalid-outline-block",
          `Outline row ${index + 1} is not valid. Nothing was changed.`,
          "Outline row is not valid — not saved",
          { blockIndex: index }
        );
      }

      if (block.id != null && typeof block.id !== "string") {
        return saveIssue(
          "invalid-outline-id",
          `Outline row ${index + 1} has an invalid internal row ID. Nothing was changed.`,
          "Outline row ID is not valid — not saved",
          { blockIndex: index }
        );
      }
      const id = fullClean(block.id);
      if (!id && !stored) {
        return saveIssue(
          "invalid-outline-id",
          `Outline row ${index + 1} has no internal row ID. Nothing was changed.`,
          "Outline row ID is missing — not saved",
          { blockIndex: index }
        );
      }
      if (id.length > SAVE_LIMITS.blockId) {
        return saveIssue(
          "outline-id-too-long",
          `Outline row ${index + 1} has an internal row ID longer than ${SAVE_LIMITS.blockId} characters. Nothing was changed.`,
          "Outline row ID is too long — not saved",
          { blockIndex: index, actual: id.length, limit: SAVE_LIMITS.blockId }
        );
      }
      if (id) {
        if (ids.has(id)) {
          return saveIssue(
            "duplicate-outline-block-id",
            "This outline contains duplicate internal row IDs. Pocket did not save it because doing so could alter the wrong row. Nothing was changed.",
            "Duplicate outline row IDs — not saved",
            { blockIndex: index }
          );
        }
        ids.add(id);
      }

      if (block.text != null && typeof block.text !== "string") {
        return saveIssue(
          "invalid-outline-block",
          `Outline row ${index + 1} has invalid text. Nothing was changed.`,
          "Outline row is not valid — not saved",
          { blockIndex: index }
        );
      }
      const text = String(block.text == null ? "" : block.text).replace(/\r/g, "");
      if (text.length > SAVE_LIMITS.blockText) {
        return saveIssue(
          "outline-block-text-too-long",
          `Outline row ${index + 1} contains ${text.length.toLocaleString()} characters. Pocket can safely save up to ${SAVE_LIMITS.blockText.toLocaleString()}. Nothing was changed.`,
          "Outline row is too long — not saved",
          { blockIndex: index, actual: text.length, limit: SAVE_LIMITS.blockText }
        );
      }

      if (!Number.isFinite(block.depth) || !Number.isInteger(block.depth) || block.depth < 0 || block.depth > SAVE_LIMITS.depth) {
        return saveIssue(
          "invalid-outline-depth",
          `Outline row ${index + 1} has an invalid indentation depth. Pocket accepts whole-number depths from 0 to ${SAVE_LIMITS.depth}. Nothing was changed.`,
          "Outline depth is not valid — not saved",
          { blockIndex: index, actual: block.depth, limit: SAVE_LIMITS.depth }
        );
      }
      if (Object.prototype.hasOwnProperty.call(block, "collapsed") && typeof block.collapsed !== "boolean") {
        return saveIssue(
          "invalid-outline-block",
          `Outline row ${index + 1} has an invalid collapse state. Nothing was changed.`,
          "Outline row is not valid — not saved",
          { blockIndex: index }
        );
      }
    }
    return { ok: true };
  }

  function validateSavePayload(payload, options = {}) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return saveIssue(
        "invalid-save-payload",
        "Pocket could not safely read this editor save. Nothing was changed.",
        "Editor save is not valid"
      );
    }

    const title = fullClean(payload.title);
    if (title.length > SAVE_LIMITS.title) {
      return saveIssue(
        "title-too-long",
        `The item title contains ${title.length.toLocaleString()} characters. Pocket can safely save up to ${SAVE_LIMITS.title}. Nothing was changed.`,
        "Title is too long — not saved",
        { actual: title.length, limit: SAVE_LIMITS.title }
      );
    }

    const details = fullDetails(payload.body);
    if (details.length > SAVE_LIMITS.details) {
      return saveIssue(
        "details-too-long",
        `The readable text contains ${details.length.toLocaleString()} characters. Pocket can safely save up to ${SAVE_LIMITS.details.toLocaleString()}. Nothing was changed.`,
        "Readable text is too long — not saved",
        { actual: details.length, limit: SAVE_LIMITS.details }
      );
    }

    if (payload.mode !== "text" && payload.mode !== "outline") {
      return saveIssue(
        "invalid-outline",
        "Pocket could not verify the selected content section. Nothing was changed.",
        "Content section is not valid — not saved"
      );
    }

    if (payload.outline == null) return { ok: true, mode: payload.mode, title, details, editorMeta: null };
    if (!Array.isArray(payload.outline) || payload.schema !== OUTLINE_EDITOR_SCHEMA) {
      return saveIssue(
        "invalid-outline",
        "Pocket could not verify this outline format. Nothing was changed.",
        "Outline format is not valid — not saved"
      );
    }

    if (options.deferOutlineSafety !== true) {
      const outlineResult = validateOutlineBlocks(payload.outline);
      if (!outlineResult.ok) return outlineResult;
    }
    if (!metadataContract().cloneJsonCompatibleValue(payload.outline).ok) {
      return saveIssue(
        "invalid-outline",
        "Pocket could not safely read this outline. Nothing was changed.",
        "Outline is not valid — not saved"
      );
    }
    const hasMeaningfulOutline = payload.outline.some((block) => String(block?.text || "").trim().length > 0);
    if (!hasMeaningfulOutline) return { ok: true, mode: payload.mode, title, details, editorMeta: null };
    const editorMeta = normaliseEditorMeta({ schema: OUTLINE_EDITOR_SCHEMA, mode: "outline", outline: payload.outline });
    if (!editorMeta) {
      return saveIssue(
        "invalid-outline",
        "Pocket could not verify meaningful current Outline data in this save. Nothing was changed.",
        "Outline is not valid — not saved"
      );
    }
    return { ok: true, mode: payload.mode, title, details, editorMeta };
  }

  function validateStoredEditorForSave(node) {
    const classification = classifyNodeEditor(node);
    if (classification.kind !== "supported-v1-outline") return { ok: true };
    return validateOutlineBlocks(node.editor && node.editor.outline, { stored: true });
  }

  function prepareSave(node, payload) {
    const storedClassification = classifyNodeEditor(node);
    const validation = validateSavePayload(payload, { deferOutlineSafety: storedClassification.kind === "supported-v1-outline" });
    if (!validation.ok) return validation;

    const beforeLabel = clean(node.label, SAVE_LIMITS.title);
    const beforeDetails = normaliseDetailsSafe(node.details, SAVE_LIMITS.details);
    const beforeEditorMeta = normaliseEditorMeta(node.editor);
    const beforeEditor = JSON.stringify(beforeEditorMeta || null);
    const nextLabel = validation.title || beforeLabel || "Untitled";
    const nextDetails = validation.details;
    const incomingEditorMeta = validation.editorMeta;
    const incomingComparable = incomingEditorMeta && Array.isArray(payload.outline) ? {
      schema: OUTLINE_EDITOR_SCHEMA,
      mode: "outline",
      outline: payload.outline.map((block, index) => ({
        id: block && block.id,
        text: block && block.text,
        depth: block && block.depth,
        collapsed: block && block.collapsed === true,
        order: index + 1
      }))
    } : null;
    const afterEditor = JSON.stringify(incomingComparable);
    const editorChanged = beforeEditor !== afterEditor;
    if (editorChanged) {
      const storedResult = validateStoredEditorForSave(node);
      if (!storedResult.ok) return storedResult;
      const incomingResult = validateSavePayload(payload);
      if (!incomingResult.ok) return incomingResult;
    }
    const editorMeta = editorChanged ? incomingEditorMeta : (beforeEditorMeta ? node.editor : null);
    return {
      ok: true,
      changed: beforeLabel !== nextLabel || beforeDetails !== nextDetails || editorChanged,
      notesChanged: beforeDetails !== nextDetails,
      editorChanged,
      beforeLabel,
      nextLabel,
      nextDetails,
      editorMeta
    };
  }

  function buildPayload(node) {
    const classification = classifyNodeEditor(node);
    const editor = classification.kind === "supported-v1-outline" ? classification.normalised : null;
    const sourceIdentity = typeof global.capturePocketEditorSourceIdentity === "function"
      ? global.capturePocketEditorSourceIdentity()
      : null;
    const originalUpdatedAt = clean(node.updatedAt, 40);
    const payload = {
      id: clean(node.id, 80),
      title: clean(node.label, 220) || "Untitled",
      body: normaliseDetailsSafe(node.details, 4000),
      mode: editor?.mode || "text",
      outline: Array.isArray(editor?.outline) ? editor.outline : null,
      path: typeof getPath === "function" ? getPath(node.id) : "",
      openedAt: new Date().toISOString(),
      updatedAt: originalUpdatedAt,
      fileSessionId: Number.isSafeInteger(sourceIdentity?.fileSessionId) ? sourceIdentity.fileSessionId : null,
      sourceFileName: clean(sourceIdentity?.sourceFileName, 120),
      sourcePipSession: sourceIdentity?.sourcePipSession === true,
      originalUpdatedAt
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
    normaliseEditorMeta: normaliseEditorMeta,
    prepareSave: prepareSave,
    validateSavePayload: validateSavePayload,
    SAVE_LIMITS
  });
})(window);
