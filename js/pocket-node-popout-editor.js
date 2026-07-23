/* Standalone node popout editor.
   This editor reads directly from nodeMap/state and saves directly back to the
   node. It deliberately does not read the retired inline details editor fields
   or recover browser drafts. */

(function initialisePocketNodePopoutEditor(global) {
  "use strict";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function popoutModel() {
    if (!global.PocketNodePopoutModel || typeof global.PocketNodePopoutModel.buildPayload !== "function" || typeof global.PocketNodePopoutModel.classifyNodeEditor !== "function" || typeof global.PocketNodePopoutModel.prepareSave !== "function") {
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
    if (!global.PocketNodePopoutTarget || typeof global.PocketNodePopoutTarget.get !== "function" || typeof global.PocketNodePopoutTarget.getById !== "function") {
      throw new Error("PocketNodePopoutTarget is not loaded.");
    }
    return global.PocketNodePopoutTarget;
  }

  function open(input) {
    if (typeof global.requirePocketFileForChanges === "function" && !global.requirePocketFileForChanges()) return false;
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
    if (typeof global.getPocketUnsavedOperationCount !== "function") return true;
    return Number(global.getPocketUnsavedOperationCount()) > 0;
  }

  function rejection(reason, message, status, extra = {}) {
    if (typeof setStatus === "function" && status) {
      setStatus(status, "warn", { durationMs: 7200 });
    }
    return {
      ok: false,
      changed: false,
      reason,
      message,
      status,
      ...extra
    };
  }

  function sourceIdentityFromPayload(payload) {
    return {
      fileSessionId: payload?.fileSessionId,
      sourceFileName: payload?.sourceFileName,
      sourcePipSession: payload?.sourcePipSession,
    };
  }

  function validateSourceIdentity(payload) {
    const identity = sourceIdentityFromPayload(payload);
    const validShape = Number.isSafeInteger(identity.fileSessionId)
      && identity.fileSessionId >= 0
      && typeof identity.sourceFileName === "string"
      && identity.sourceFileName.length <= 120
      && typeof identity.sourcePipSession === "boolean";
    if (!validShape || typeof global.isPocketEditorSourceIdentityCurrent !== "function") {
      return rejection(
        "missing-source-identity",
        "Pocket could not verify where this editor belongs. Nothing was changed. Close and reopen the item before saving.",
        "Editor source could not be verified — not saved"
      );
    }
    if (!global.isPocketEditorSourceIdentityCurrent(identity)) {
      return rejection(
        "file-session-changed",
        "Pocket is now using a different file. Your editor changes were not applied. Copy anything you need, close this editor, and reopen the item from the current file.",
        "Different Pocket file — not saved"
      );
    }
    return null;
  }

  function nextNodeUpdatedAt(previous) {
    const next = typeof nowIso === "function" ? nowIso() : new Date().toISOString();
    const previousMs = Date.parse(clean(previous, 40));
    const nextMs = Date.parse(next);
    if (Number.isFinite(previousMs) && Number.isFinite(nextMs) && nextMs <= previousMs) {
      try {
        return new Date(previousMs + 1).toISOString();
      } catch (_error) {}
    }
    return next;
  }

  function applyPayload(payload, options = {}) {
    if (typeof global.canModifyPocket !== "function" || !global.canModifyPocket()) {
      return rejection(
        "no-pocket-file",
        "Pocket does not have a current writable file. Nothing was changed.",
        "No writable Pocket file — not saved"
      );
    }

    const sourceIssue = validateSourceIdentity(payload);
    if (sourceIssue) return sourceIssue;

    const fullId = clean(payload?.id, Number.MAX_SAFE_INTEGER);
    if (!fullId || fullId.length > 80) {
      return rejection(
        "missing-node",
        "This item no longer exists. Your editor changes were not applied.",
        "Item no longer exists — not saved"
      );
    }
    const id = clean(fullId, 80);
    const node = popoutTarget().getById(id);
    if (!node) {
      return rejection(
        "missing-node",
        "This item no longer exists. Your editor changes were not applied.",
        "Item no longer exists — not saved"
      );
    }

    const originalUpdatedAt = typeof payload?.originalUpdatedAt === "string"
      ? payload.originalUpdatedAt.trim()
      : "";
    if (!originalUpdatedAt || originalUpdatedAt.length > 40) {
      return rejection(
        "missing-node-revision",
        "Pocket could not verify where this editor belongs. Nothing was changed. Close and reopen the item before saving.",
        "Editor revision could not be verified — not saved"
      );
    }
    const currentUpdatedAt = clean(node.updatedAt, 40);
    if (!currentUpdatedAt || originalUpdatedAt !== currentUpdatedAt) {
      return rejection(
        "node-revision-changed",
        "This item changed after the editor was opened. Your changes were not applied. Copy anything you need, then close and reopen the item.",
        "Item changed elsewhere — not saved"
      );
    }

    const model = popoutModel();
    const currentEditor = model.classifyNodeEditor(node);
    if (currentEditor.kind === "unsupported-or-malformed") {
      return rejection(
        "unsupported-editor",
        "This item uses editor data that this Pocket version cannot safely edit. Nothing was changed.",
        "Unsupported editor data — not saved",
        {
          id: id,
          label: clean(node.label, 220),
          readOnly: true,
        }
      );
    }

    const prepared = model.prepareSave(node, payload);
    if (!prepared.ok) {
      return rejection(
        prepared.reason || "invalid-save-payload",
        prepared.message || "Pocket could not safely apply this editor save. Nothing was changed.",
        prepared.status || "Editor save was rejected",
        {
          ...prepared,
          ok: false,
          changed: false,
          id,
          label: clean(node.label, 220),
        }
      );
    }

    const sourceIdentity = sourceIdentityFromPayload(payload);
    if (!prepared.changed) {
      if (options.quiet !== true && typeof setStatus === "function") setStatus("No editor changes to save.", "ok");
      return {
        ok: true,
        changed: false,
        id,
        label: prepared.beforeLabel,
        reason: "unchanged",
        nodeUpdatedAt: currentUpdatedAt,
        sourceIdentity,
      };
    }

    const updatedAt = nextNodeUpdatedAt(currentUpdatedAt);
    node.label = prepared.nextLabel;
    if (prepared.nextDetails) node.details = prepared.nextDetails;
    else delete node.details;
    if (prepared.editorMeta) node.editor = prepared.editorMeta;
    else delete node.editor;
    node.updatedAt = updatedAt;

    if (typeof recordOp === "function") recordOp({ type: "details_edit", id: id, path: typeof getPath === "function" ? getPath(id) : "", changed: prepared.editorMeta ? "outline" : "details" });
    if (typeof refreshMeta === "function") refreshMeta();
    if (typeof renderTree === "function") renderTree();
    if (typeof focusRowByNodeId === "function") focusRowByNodeId(id, { instant: true });
    if (typeof saveWorkspaceState === "function") saveWorkspaceState();
    if (typeof persistPipSnapshot === "function") persistPipSnapshot();
    if (options.quiet !== true && typeof setStatus === "function") setStatus(prepared.editorMeta ? `Saved outline for "${clean(node.label, 80)}".` : `Saved details for "${clean(node.label, 80)}".`, "ok");
    console.info("[node popout editor] saved", { id: id, changed: prepared.editorMeta ? "outline" : "details" });
    return {
      ok: true,
      changed: true,
      id,
      label: clean(node.label, 220),
      reason: "changed",
      nodeUpdatedAt: node.updatedAt,
      sourceIdentity,
    };
  }

  function apply(payload, options = {}) {
    const result = applyPayload(payload, options);
    return options.returnDetails === true ? result : result.ok === true;
  }

  async function applyAndSave(payload, options = {}) {
    const applied = applyPayload(payload, { quiet: true });
    if (!applied.ok) {
      return { ...applied, ok: false, applied: false, changed: false, exported: false, reason: applied.reason || "apply-failed" };
    }

    if (!applied.changed && !hasUnsavedOps() && options.exportUnchanged !== true) {
      if (typeof setStatus === "function") setStatus("No editor changes to save.", "ok");
      return {
        ok: true,
        applied: false,
        changed: false,
        exported: false,
        reason: "unchanged",
        nodeUpdatedAt: applied.nodeUpdatedAt,
        sourceIdentity: applied.sourceIdentity,
      };
    }

    if (typeof exportTree !== "function") {
      if (typeof setStatus === "function") setStatus("Editor saved locally. Main save is not available here.", "warn", { durationMs: 5200 });
      if (typeof flashSaveChip === "function") flashSaveChip("save*");
      return {
        ok: false,
        applied: true,
        changed: applied.changed,
        exported: false,
        reason: "export-unavailable",
        nodeUpdatedAt: applied.nodeUpdatedAt,
        sourceIdentity: applied.sourceIdentity,
      };
    }

    if (typeof flashSaveChip === "function") flashSaveChip("saving");
    if (typeof setStatus === "function") setStatus("Saving editor content and truth file...", "ok", { durationMs: 3200 });

    try {
      const exported = await exportTree({ ...(options.exportOptions || {}), returnDetails: true });
      if (exported && exported.ok === true) {
        return {
          ok: true,
          applied: true,
          changed: applied.changed,
          exported: true,
          reason: "exported",
          exportReason: exported.reason || "truth-file",
          target: exported.target || "truth-file",
          nodeUpdatedAt: applied.nodeUpdatedAt,
          sourceIdentity: exported.sourceIdentity || applied.sourceIdentity,
        };
      }
      if (exported && exported.downloaded === true) {
        return {
          ok: false,
          applied: true,
          changed: applied.changed,
          exported: false,
          downloaded: true,
          reason: "downloaded-copy",
          nodeUpdatedAt: applied.nodeUpdatedAt,
          sourceIdentity: applied.sourceIdentity,
        };
      }
      const reason = exported && typeof exported.reason === "string"
        ? (exported.reason === "unsupported" ? "export-unavailable" : exported.reason)
        : "export-failed";
      return {
        ok: false,
        applied: true,
        changed: applied.changed,
        exported: false,
        reason,
        nodeUpdatedAt: applied.nodeUpdatedAt,
        sourceIdentity: applied.sourceIdentity,
      };
    } catch (error) {
      console.error("[node popout editor] apply and save failed", error);
      if (typeof setStatus === "function") setStatus("Editor content saved locally, but the truth file save failed.", "warn", { durationMs: 6200 });
      if (typeof flashSaveChip === "function") flashSaveChip("save*");
      return {
        ok: false,
        applied: true,
        changed: applied.changed,
        exported: false,
        reason: "write-failed",
        nodeUpdatedAt: applied.nodeUpdatedAt,
        sourceIdentity: applied.sourceIdentity,
      };
    }
  }

  global.PocketNodePopoutEditor = Object.freeze({ open: open, apply: apply, applyAndSave: applyAndSave });
})(window);
