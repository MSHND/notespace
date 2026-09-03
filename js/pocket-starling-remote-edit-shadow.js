/* Dormant P125 remote-edit composition. It prepares one unadopted physical
   successor from an already accepted P124 session without selecting transport. */
(function (global) {
  "use strict";

  function fail(code) {
    const error = new Error(`Pocket Starling remote edit ${code}.`);
    error.code = code;
    return error;
  }

  function exact(value, fields) {
    return value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === fields.length &&
      fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
  }

  function dependencies() {
    const sync = global.PocketSyncCrypto,
      crypto = global.PocketStarlingCryptoShadow,
      head = global.PocketStarlingHeadShadow,
      logical = global.PocketStarlingLogicalEditShadow,
      storage = global.PocketStarlingStorageShadow,
      semantic = global.PocketStarlingSemanticAuthorityShadow;
    if (!sync || !crypto || !head || !logical || !storage || !semantic ||
      typeof sync.validateNonExtractableAesKey !== "function" ||
      typeof crypto.validateContext !== "function" ||
      typeof head.validHead !== "function" ||
      typeof logical.createBase !== "function" ||
      typeof logical.editPayload !== "function" ||
      typeof logical.move !== "function" ||
      typeof logical.reorder !== "function" ||
      typeof logical.deleteBranch !== "function" ||
      typeof logical.restoreBranch !== "function" ||
      typeof logical.insert !== "function" ||
      typeof logical.compose !== "function" ||
      typeof storage.stageCandidate !== "function" ||
      typeof storage.publicationBinding !== "function" ||
      typeof semantic.issueSuccessor !== "function") throw fail("remote-edit-input-invalid");
    return { sync, crypto, head, logical, storage, semantic };
  }

  function validSession(value) {
    return exact(value, ["acceptedSealRef", "semanticBaseProof", "resolveLogical", "createReuseProof", "readContent", "readPlacement", "diagnostics"]) &&
      typeof value.acceptedSealRef === "string" && value.acceptedSealRef.length > 0 &&
      !!value.semanticBaseProof &&
      typeof value.resolveLogical === "function" && typeof value.createReuseProof === "function" &&
      typeof value.readContent === "function" && typeof value.readPlacement === "function" &&
      typeof value.diagnostics === "function";
  }

  function openedSnapshot(value, head) {
    if (!exact(value, ["outcome", "head", "session"]) || value.outcome !== "opened" ||
      !head.validHead(value.head) || value.head.revision < 1 || !validSession(value.session))
      throw fail("remote-edit-input-invalid");
    return Object.freeze({
      expectedHead: Object.freeze({ schema: value.head.schema, revision: value.head.revision, sealRef: value.head.sealRef }),
      session: value.session,
    });
  }

  async function createEditor(input) {
    if (!exact(input, ["opened", "masterKey", "context", "semanticAuthority"])) throw fail("remote-edit-input-invalid");
    const { sync, crypto, head, logical, storage, semantic } = dependencies();
    let masterKey, context;
    try {
      masterKey = sync.validateNonExtractableAesKey(input.masterKey);
      const supplied = crypto.validateContext(input.context);
      context = Object.freeze({ syncedPocketId: supplied.syncedPocketId });
    } catch (_error) { throw fail("remote-edit-input-invalid"); }
    const opened = openedSnapshot(input.opened, head),
      freshBaseProof = opened.session.createReuseProof(),
      baseResult = await logical.createBase({
        acceptedSealRef: opened.session.acceptedSealRef,
        resolveLogical: opened.session.resolveLogical,
        syncedPocketId: context.syncedPocketId,
        semanticAuthority: input.semanticAuthority,
        semanticBaseProof: opened.session.semanticBaseProof,
      });
    if (!baseResult || baseResult.ok !== true || !baseResult.base) return baseResult;
    const base = baseResult.base, expectedHead = opened.expectedHead;

    async function prepareCandidate(candidate) {
      const issued = await semantic.issueSuccessor({
          authority: input.semanticAuthority,
          semanticBaseProof: opened.session.semanticBaseProof,
          candidate,
        });
      if (!issued || issued.ok !== true || !issued.proof) throw fail("remote-edit-authority-mismatch");
      const stage = await storage.stageCandidate({
          sealRef: candidate.sealRef,
          resolveLogical: candidate.resolveLogical,
          masterKey,
          context,
          freshBaseProof,
          newLogicalRefs: candidate.newLogicalRefs,
          semanticAuthority: input.semanticAuthority,
          semanticValidityProof: issued.proof,
        }),
        binding = storage.publicationBinding(stage);
      if (!binding || binding.syncedPocketId !== context.syncedPocketId ||
        binding.expectedSealStorageRef !== expectedHead.sealRef ||
        binding.candidateSealStorageRef !== stage.sealStorageRef)
        throw fail("remote-edit-authority-mismatch");
      const prepared = { outcome: "prepared", expectedHead, stage, binding };
      const retentions = typeof logical.deleteRetentionWitness === "function"
        ? logical.deleteRetentionWitness(candidate) : null;
      if (Array.isArray(retentions) && retentions.length > 0) {
        Object.defineProperty(prepared, "p170DeleteRetentions", {
          value: retentions,
          enumerable: false,
          configurable: false,
          writable: false,
        });
      }
      return Object.freeze(prepared);
    }

    async function preparePayloadEdit(editInput) {
      if (!exact(editInput, ["nodeId", "payload"])) throw fail("remote-edit-input-invalid");
      const edited = await logical.editPayload(base, editInput.nodeId, editInput.payload);
      if (!edited || edited.ok !== true) return edited;
      if (edited.changed === false) return Object.freeze({ outcome: "unchanged" });
      if (edited.changed !== true || !edited.candidate) throw fail("remote-edit-input-invalid");
      return prepareCandidate(edited.candidate);
    }

    async function prepareMove(moveInput) {
      if (!exact(moveInput, ["nodeId", "fromIndex", "newParentId", "toIndex"])) throw fail("remote-edit-input-invalid");
      const moved = await logical.move(base, moveInput.nodeId, moveInput.fromIndex, moveInput.newParentId, moveInput.toIndex);
      if (!moved || moved.ok !== true) return moved;
      if (!moved.candidate) throw fail("remote-edit-input-invalid");
      return prepareCandidate(moved.candidate);
    }

    async function prepareReorder(reorderInput) {
      if (!exact(reorderInput, ["nodeId", "fromIndex", "toIndex"])) throw fail("remote-edit-input-invalid");
      const reordered = await logical.reorder(base, reorderInput.nodeId, reorderInput.fromIndex, reorderInput.toIndex);
      if (!reordered || reordered.ok !== true) return reordered;
      if (reordered.changed === false && reordered.reason === "no-change") return Object.freeze({ outcome: "unchanged" });
      if (reordered.changed !== true || !reordered.candidate) throw fail("remote-edit-input-invalid");
      return prepareCandidate(reordered.candidate);
    }

    async function prepareDelete(deleteInput) {
      if (!exact(deleteInput, ["nodeId", "fromIndex"])) throw fail("remote-edit-input-invalid");
      const deleted = await logical.deleteBranch(
        base,
        deleteInput.nodeId,
        deleteInput.fromIndex,
      );
      if (!deleted || deleted.ok !== true) return deleted;
      if (!deleted.candidate) throw fail("remote-edit-input-invalid");
      return prepareCandidate(deleted.candidate);
    }

    async function prepareRestore(restoreInput) {
      if (!exact(restoreInput, ["nodeId", "fromIndex", "newParentId", "toIndex"])) throw fail("remote-edit-input-invalid");
      const restored = await logical.restoreBranch(
        base,
        restoreInput.nodeId,
        restoreInput.fromIndex,
        restoreInput.newParentId,
        restoreInput.toIndex,
      );
      if (!restored || restored.ok !== true) return restored;
      if (!restored.candidate) throw fail("remote-edit-input-invalid");
      return prepareCandidate(restored.candidate);
    }

    async function prepareInsert(insertInput) {
      if (!exact(insertInput, ["nodeId", "parentId", "toIndex", "payload"])) throw fail("remote-edit-input-invalid");
      const inserted = await logical.insert(base, insertInput);
      if (!inserted || inserted.ok !== true) return inserted;
      if (!inserted.candidate) throw fail("remote-edit-input-invalid");
      return prepareCandidate(inserted.candidate);
    }

    async function prepareWorkingSet(operations, preservationProjection) {
      const composed = await logical.compose(base, operations, preservationProjection);
      if (!composed || composed.ok !== true) return composed;
      if (composed.changed === false && composed.reason === "no-change")
        return Object.freeze({ outcome: "unchanged" });
      if (composed.changed !== true || !composed.candidate)
        throw fail("remote-edit-input-invalid");
      return prepareCandidate(composed.candidate);
    }

    return Object.freeze({
      preparePayloadEdit,
      prepareMove,
      prepareReorder,
      prepareDelete,
      prepareRestore,
      prepareInsert,
      prepareWorkingSet,
    });
  }

  global.PocketStarlingRemoteEditShadow = Object.freeze({ createEditor });
})(typeof window !== "undefined" ? window : globalThis);
