/* Dormant P122 publication composition. It stages no live owner work: callers
   supply both a P121-authenticated stage and the exact expected remote Head. */
(function (global) {
  "use strict";

  const API_VERSION = 1,
    IDENTIFIER_LIMIT = 160,
    PRESENCE_CHUNK_SIZE = 512;

  function publicationError(code) {
    const error = new Error(`Pocket Starling publication ${code}.`);
    error.code = code;
    return error;
  }

  function exact(value, fields) {
    return (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === fields.length &&
      fields.every((field) => Object.prototype.hasOwnProperty.call(value, field))
    );
  }

  function dependencies() {
    const storage = global.PocketStarlingStorageShadow,
      head = global.PocketStarlingHeadShadow;
    if (
      !storage ||
      !head ||
      typeof storage.publicationBinding !== "function" ||
      typeof storage.verifyNewRecordPresence !== "function" ||
      typeof head.validHead !== "function"
    )
      throw publicationError("publication-input-invalid");
    return { storage, head };
  }

  function operationId(value) {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > IDENTIFIER_LIMIT ||
      value !== value.trim()
    )
      throw publicationError("publication-operation-id-invalid");
    return value;
  }

  function requireService(value) {
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.putOpaqueObject !== "function" ||
      typeof value.objectPresence !== "function" ||
      typeof value.compareAndSetShadowHead !== "function"
    )
      throw publicationError("publication-input-invalid");
    return value;
  }

  function requireReconciliationService(value) {
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.readShadowHead !== "function" ||
      typeof value.getOpaqueObject !== "function"
    )
      throw publicationError("publication-input-invalid");
    return value;
  }

  function preflight(input, operationIdFactory) {
    if (!exact(input, ["stage", "expectedHead"]))
      throw publicationError("publication-input-invalid");
    const { storage, head } = dependencies(),
      binding = storage.publicationBinding(input.stage),
      stage = input.stage;
    let expectedHead;
    try {
      if (!head.validHead(input.expectedHead))
        throw publicationError("publication-head-invalid");
      expectedHead = Object.freeze({
        schema: input.expectedHead.schema,
        revision: input.expectedHead.revision,
        sealRef: input.expectedHead.sealRef,
      });
      if (!head.validHead(expectedHead))
        throw publicationError("publication-head-invalid");
    } catch (error) {
      if (error && error.code === "publication-head-invalid") throw error;
      throw publicationError("publication-head-invalid");
    }
    if (expectedHead.sealRef !== binding.expectedSealStorageRef)
      throw publicationError("publication-head-lineage-mismatch");
    if (
      !stage ||
      !Array.isArray(stage.newRecords) ||
      stage.sealStorageRef !== binding.candidateSealStorageRef ||
      stage.newRecords.length !== binding.newRecordCount
    )
      throw publicationError("publication-input-invalid");
    const operations = [],
      seen = new Set(),
      claim = (kind, index) => {
        let value;
        try {
          value = operationIdFactory(kind, index);
        } catch (_error) {
          throw publicationError("publication-operation-id-invalid");
        }
        value = operationId(value);
        if (seen.has(value)) throw publicationError("publication-operation-id-invalid");
        seen.add(value);
        return value;
      };
    for (let index = 0; index < stage.newRecords.length; index += 1)
      operations.push(Object.freeze({ kind: "put-object", index, id: claim("put-object", index) }));
    const presenceCount = Math.ceil(stage.newRecords.length / PRESENCE_CHUNK_SIZE);
    for (let index = 0; index < presenceCount; index += 1)
      operations.push(Object.freeze({ kind: "presence", index, id: claim("presence", index) }));
    operations.push(
      Object.freeze({
        kind: "compare-and-set-head",
        index: 0,
        id: claim("compare-and-set-head", 0),
      }),
    );
    return Object.freeze({
      storage,
      stage,
      binding,
      expectedHead,
      operations: Object.freeze(operations),
    });
  }

  function outcome(result) {
    if (result && result.ok === true && result.head)
      return Object.freeze({ kind: "success", head: result.head });
    if (
      result &&
      result.ok === false &&
      [
        "head-conflict",
        "candidate-object-missing",
        "head-revision-exhausted",
      ].includes(result.reason)
    )
      return Object.freeze({ kind: result.reason });
    throw publicationError("publication-outcome-unknown");
  }

  function reconciliationDependencies() {
    const storage = global.PocketStarlingStorageShadow,
      head = global.PocketStarlingHeadShadow,
      crypto = global.PocketStarlingCryptoShadow,
      sync = global.PocketSyncCrypto;
    if (
      !storage ||
      !head ||
      !crypto ||
      !sync ||
      typeof storage.publicationBinding !== "function" ||
      typeof storage.validateCapsuleBytes !== "function" ||
      typeof head.validHead !== "function" ||
      !head.OUTCOME ||
      typeof crypto.openObject !== "function" ||
      typeof crypto.validateContext !== "function" ||
      typeof sync.validateNonExtractableAesKey !== "function"
    )
      throw publicationError("publication-input-invalid");
    return { storage, head, crypto, sync };
  }

  function reconciliationResult(outcome, examined = 0) {
    return Object.freeze({ outcome, examined });
  }

  function reconciliationPreflight(input, operationIdFactory) {
    if (!exact(input, ["stage", "expectedHead", "masterKey", "context"]))
      throw publicationError("publication-input-invalid");
    const { storage, head, crypto, sync } = reconciliationDependencies(),
      binding = storage.publicationBinding(input.stage);
    let expectedHead, masterKey, context;
    try {
      if (!head.validHead(input.expectedHead))
        throw publicationError("publication-head-invalid");
      expectedHead = Object.freeze({
        schema: input.expectedHead.schema,
        revision: input.expectedHead.revision,
        sealRef: input.expectedHead.sealRef,
      });
      if (!head.validHead(expectedHead))
        throw publicationError("publication-head-invalid");
      masterKey = sync.validateNonExtractableAesKey(input.masterKey);
      const suppliedContext = crypto.validateContext(input.context);
      context = Object.freeze({ syncedPocketId: suppliedContext.syncedPocketId });
    } catch (error) {
      if (error && error.code === "publication-head-invalid") throw error;
      throw publicationError("publication-input-invalid");
    }
    if (expectedHead.sealRef !== binding.expectedSealStorageRef)
      throw publicationError("publication-head-lineage-mismatch");
    if (context.syncedPocketId !== binding.syncedPocketId)
      throw publicationError("publication-input-invalid");
    const seen = new Set();
    function claim(kind, index) {
      let value;
      try {
        value = operationIdFactory(kind, index);
      } catch (_error) {
        throw publicationError("publication-operation-id-invalid");
      }
      value = operationId(value);
      if (seen.has(value)) throw publicationError("publication-operation-id-invalid");
      seen.add(value);
      return value;
    }
    return Object.freeze({
      storage,
      head,
      crypto,
      binding,
      expectedHead,
      candidateSealStorageRef: binding.candidateSealStorageRef,
      masterKey,
      context,
      claim,
    });
  }

  function createPublisher({ objectHeadService, operationIdFactory } = {}) {
    const service = requireService(objectHeadService);
    if (typeof operationIdFactory !== "function")
      throw publicationError("publication-input-invalid");

    async function publishCandidate(input) {
      const prepared = preflight(input, operationIdFactory),
        records = prepared.stage.newRecords,
        presence = new Set();
      let operation = 0;
      for (const entry of records) {
        await service.putOpaqueObject({
          apiVersion: API_VERSION,
          operationId: prepared.operations[operation].id,
          syncedPocketId: prepared.binding.syncedPocketId,
          storageRef: entry.storageRef,
          record: entry.record,
        });
        operation += 1;
      }
      for (let start = 0; start < records.length; start += PRESENCE_CHUNK_SIZE) {
        const entries = records.slice(start, start + PRESENCE_CHUNK_SIZE),
          response = await service.objectPresence({
            apiVersion: API_VERSION,
            operationId: prepared.operations[operation].id,
            syncedPocketId: prepared.binding.syncedPocketId,
            storageRefs: entries.map((entry) => entry.storageRef),
          });
        operation += 1;
        if (!response || !Array.isArray(response.rows))
          throw publicationError("publication-remote-presence-missing");
        for (let index = 0; index < entries.length; index += 1) {
          const row = response.rows[index];
          if (
            !row ||
            row.storageRef !== entries[index].storageRef ||
            row.present !== true
          )
            throw publicationError("publication-remote-presence-missing");
          presence.add(row.storageRef);
        }
      }
      let cas;
      try {
        cas = outcome(
          await service.compareAndSetShadowHead({
            apiVersion: API_VERSION,
            operationId: prepared.operations[operation].id,
            syncedPocketId: prepared.binding.syncedPocketId,
            expectedHead: prepared.expectedHead,
            candidateSealStorageRef: prepared.binding.candidateSealStorageRef,
          }),
        );
      } catch (error) {
        if (error && error.code === "publication-outcome-unknown") throw error;
        throw publicationError("publication-outcome-unknown");
      }
      if (cas.kind === "head-conflict")
        return Object.freeze({ outcome: "conflict", reason: "head-conflict" });
      if (cas.kind === "candidate-object-missing")
        return Object.freeze({
          outcome: "not-committed",
          reason: "candidate-object-missing",
        });
      if (cas.kind === "head-revision-exhausted")
        return Object.freeze({
          outcome: "not-committed",
          reason: "head-revision-exhausted",
        });
      const proof = prepared.storage.verifyNewRecordPresence(
        prepared.stage,
        (storageRef) => presence.has(storageRef),
      );
      if (!proof || proof.ok !== true) throw publicationError("publication-outcome-unknown");
      return Object.freeze({ outcome: "committed", head: cas.head });
    }

    return Object.freeze({ publishCandidate });
  }

  function createReconciler({ objectHeadService, operationIdFactory } = {}) {
    const service = requireReconciliationService(objectHeadService);
    if (typeof operationIdFactory !== "function")
      throw publicationError("publication-input-invalid");

    async function reconcileAmbiguousPublication(input) {
      const prepared = reconciliationPreflight(input, operationIdFactory),
        outcomes = prepared.head.OUTCOME,
        readHeadOperationId = prepared.claim("read-head", 0);
      let current;
      try {
        const response = await service.readShadowHead({
          apiVersion: API_VERSION,
          operationId: readHeadOperationId,
          syncedPocketId: prepared.binding.syncedPocketId,
        });
        if (!response || !prepared.head.validHead(response.head))
          return reconciliationResult(outcomes.UNKNOWN);
        current = Object.freeze({
          schema: response.head.schema,
          revision: response.head.revision,
          sealRef: response.head.sealRef,
        });
      } catch (_error) {
        return reconciliationResult(outcomes.UNKNOWN);
      }
      if (
        current.revision === prepared.expectedHead.revision &&
        current.sealRef === prepared.expectedHead.sealRef
      )
        return reconciliationResult(outcomes.NOT_COMMITTED);
      if (current.revision <= prepared.expectedHead.revision)
        return reconciliationResult(outcomes.UNKNOWN);

      const delta = current.revision - prepared.expectedHead.revision;
      const getSealOperationIds = [];
      for (let depth = 0; depth < delta; depth += 1)
        getSealOperationIds.push(prepared.claim("get-seal", depth));
      let ref = current.sealRef,
        candidateDepth = -1;
      const seen = new Set();
      for (let depth = 0; depth < delta; depth += 1) {
        if (seen.has(ref)) return reconciliationResult(outcomes.UNKNOWN, depth);
        seen.add(ref);
        let capsule;
        try {
          const response = await service.getOpaqueObject({
            apiVersion: API_VERSION,
            operationId: getSealOperationIds[depth],
            syncedPocketId: prepared.binding.syncedPocketId,
            storageRef: ref,
          });
          if (!response || response.present !== true || !response.record)
            return reconciliationResult(outcomes.UNKNOWN, depth + 1);
          capsule = prepared.storage.validateCapsuleBytes(
            await prepared.crypto.openObject(
              response.record,
              ref,
              prepared.masterKey,
              prepared.context,
            ),
          );
        } catch (_error) {
          return reconciliationResult(outcomes.UNKNOWN, depth + 1);
        }
        if (capsule.logicalKind !== "candidate-seal")
          return reconciliationResult(outcomes.UNKNOWN, depth + 1);
        if (ref === prepared.candidateSealStorageRef) candidateDepth = depth;
        const previousLogicalRef = capsule.object.previousSealRef;
        if (previousLogicalRef === null) ref = null;
        else {
          const link = capsule.links.find(
            (entry) => entry.logicalRef === previousLogicalRef,
          );
          if (!link) return reconciliationResult(outcomes.UNKNOWN, depth + 1);
          ref = link.storageRef;
        }
        if (depth + 1 < delta && (typeof ref !== "string" || ref.length === 0))
          return reconciliationResult(outcomes.UNKNOWN, depth + 1);
      }
      if (ref !== prepared.expectedHead.sealRef)
        return reconciliationResult(outcomes.UNKNOWN, delta);
      if (candidateDepth === delta - 1)
        return reconciliationResult(
          delta === 1 ? outcomes.COMMITTED : outcomes.COMMITTED_AND_SUPERSEDED,
          delta,
        );
      if (candidateDepth !== -1)
        return reconciliationResult(outcomes.UNKNOWN, delta);
      return reconciliationResult(outcomes.CONFLICT, delta);
    }

    return Object.freeze({ reconcileAmbiguousPublication });
  }

  global.PocketStarlingPublicationShadow = Object.freeze({
    createPublisher,
    createReconciler,
  });
})(typeof window !== "undefined" ? window : globalThis);
