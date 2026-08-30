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

  global.PocketStarlingPublicationShadow = Object.freeze({ createPublisher });
})(typeof window !== "undefined" ? window : globalThis);
