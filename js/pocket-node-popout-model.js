/* Unified canonical-text model helpers for the standalone node popout editor. */
(function initialisePocketNodePopoutModel(global) {
  "use strict";

  const UNSUPPORTED_EDITOR_MESSAGE = "This item uses editor data that this version of Pocket can't safely edit. Its readable text is shown below, and nothing will be changed.";
  const SAVE_LIMITS = Object.freeze({ title: 220, details: 4000, depth: 8 });

  function content() {
    if (!global.PocketNodeContent) throw new Error("PocketNodeContent is not loaded.");
    return global.PocketNodeContent;
  }
  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }
  function classifyNodeEditor(node) {
    const present = !!node && typeof node === "object" && Object.prototype.hasOwnProperty.call(node, "editor");
    return content().classifyEditor(present ? node.editor : undefined, { present });
  }
  function classifyEditorMeta(value, options = {}) { return content().classifyEditor(value, options); }
  function normaliseEditorMeta(value) {
    const classified = content().classifyEditor(value, { present: value !== undefined });
    return classified.supported ? classified.normalised : null;
  }
  function issue(reason, message, status, extra = {}) { return { ok: false, reason, message, status, ...extra }; }

  function validateSavePayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return issue("invalid-save-payload", "Pocket could not safely read this editor save. Nothing was changed.", "Editor save is not valid");
    }
    const titleRaw = typeof payload.title === "string" ? payload.title : "";
    if (titleRaw.trim().length > SAVE_LIMITS.title) {
      return issue("title-too-long", `The item title is longer than ${SAVE_LIMITS.title} characters. Nothing was changed.`, "Title is too long — not saved");
    }
    const rawText = typeof payload.text === "string" ? payload.text
      : (typeof payload.body === "string" ? payload.body : null);
    if (rawText === null) {
      return issue("invalid-editor-text", "Pocket could not verify the editor document. Nothing was changed.", "Document is not valid — not saved");
    }
    const checked = content().validateText(rawText);
    if (!checked.ok) {
      return issue(checked.reason, `This document is larger than Pocket's safe editor envelope. Nothing was changed.`, "Document is too large — not saved", checked);
    }
    return { ok: true, title: titleRaw.trim().slice(0, SAVE_LIMITS.title), text: checked.text };
  }

  function prepareSave(node, payload) {
    const classification = classifyNodeEditor(node);
    if (classification.kind === "unsupported-or-malformed") {
      return issue("unsupported-editor", UNSUPPORTED_EDITOR_MESSAGE, "Unsupported editor data — not saved");
    }
    const validation = validateSavePayload(payload);
    if (!validation.ok) return validation;
    const beforeLabel = clean(node && node.label, SAVE_LIMITS.title);
    const opening = content().readNode(node);
    const nextLabel = validation.title || beforeLabel || "Untitled";
    const titleChanged = beforeLabel !== nextLabel;
    const contentChanged = opening.text !== validation.text;
    let prepared = null;
    if (contentChanged) {
      prepared = content().prepareCanonical(validation.text);
      if (!prepared.ok) return prepared;
    }
    return {
      ok: true,
      changed: titleChanged || contentChanged,
      titleChanged,
      contentChanged,
      notesChanged: contentChanged,
      editorChanged: contentChanged,
      beforeLabel,
      nextLabel,
      beforeText: opening.text,
      nextText: validation.text,
      nextDetails: contentChanged ? prepared.details : content().normaliseDetails(node && node.details),
      editorMeta: contentChanged ? prepared.editor : node && node.editor,
      preserveRawEditor: !contentChanged,
    };
  }

  function buildPayload(node) {
    const view = content().readNode(node);
    const sourceIdentity = typeof global.capturePocketEditorSourceIdentity === "function"
      ? global.capturePocketEditorSourceIdentity() : null;
    const originalUpdatedAt = clean(node && node.updatedAt, 40);
    const payload = {
      id: clean(node && node.id, 80),
      title: clean(node && node.label, 220) || "Untitled",
      text: view.text,
      body: view.text,
      path: typeof getPath === "function" ? getPath(node.id) : "",
      openedAt: new Date().toISOString(),
      updatedAt: originalUpdatedAt,
      fileSessionId: Number.isSafeInteger(sourceIdentity?.fileSessionId) ? sourceIdentity.fileSessionId : null,
      sourceFileName: clean(sourceIdentity?.sourceFileName, 120),
      sourcePipSession: sourceIdentity?.sourcePipSession === true,
      sourceOwnerKind: clean(sourceIdentity?.sourceOwnerKind, 24),
      sourceVaultSessionId: clean(sourceIdentity?.sourceVaultSessionId, 120),
      originalUpdatedAt,
      contentKind: view.kind,
    };
    if (view.readOnly) {
      payload.readOnly = true;
      payload.readOnlyReason = "unsupported-editor";
      payload.readOnlyMessage = UNSUPPORTED_EDITOR_MESSAGE;
      if (view.classification && view.classification.schema) payload.editorSchema = view.classification.schema;
    }
    return payload;
  }

  global.PocketNodePopoutModel = Object.freeze({
    buildPayload,
    classifyEditorMeta,
    classifyNodeEditor,
    normaliseEditorMeta,
    prepareSave,
    validateSavePayload,
    SAVE_LIMITS,
  });
})(window);
