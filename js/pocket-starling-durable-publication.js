/* P164 durable Starling publication split.

P122 publishes a live in-memory stage all at once. P164 needs a crash-safe seam
between opaque-object publication and the one Head CAS. This module snapshots
only the authenticated physical candidate (opaque records + refs), then can
presence-prove, attempt one CAS, or reconcile that exact candidate after reload.
*/
(function initialisePocketStarlingDurablePublication(global) {
  "use strict";

  const DESCRIPTOR_SCHEMA = "pocket.starling.durable-candidate.v1";
  const DESCRIPTOR_FIELDS = Object.freeze([
    "schema", "syncedPocketId", "expectedHead", "candidateSealStorageRef", "newRecords",
  ]);
  const RECORD_FIELDS = Object.freeze(["storageRef", "record"]);
  const API_VERSION = 1;
  const PRESENCE_CHUNK_SIZE = 512;

  function fail(code) {
    const error = new Error(`Pocket Starling durable publication ${code}.`);
    error.code = code;
    return error;
  }

  function exact(value, fields) {
    return !!value && typeof value === "object" && !Array.isArray(value)
      && Object.keys(value).length === fields.length
      && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
  }

  function identifier(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 160
      && value === value.trim();
  }

  function dependencies() {
    const head = global.PocketStarlingHeadShadow;
    const storage = global.PocketStarlingStorageShadow;
    const starlingCrypto = global.PocketStarlingCryptoShadow;
    const syncCrypto = global.PocketSyncCrypto;
    if (!head || typeof head.validHead !== "function" || !head.OUTCOME
        || !storage || typeof storage.publicationBinding !== "function"
        || typeof storage.validateCapsuleBytes !== "function"
        || !starlingCrypto || typeof starlingCrypto.openObject !== "function"
        || typeof starlingCrypto.validateContext !== "function"
        || typeof starlingCrypto.REFERENCE_PREFIX !== "string"
        || !syncCrypto || typeof syncCrypto.validateNonExtractableAesKey !== "function") {
      throw fail("dependency-unavailable");
    }
    return { head, storage, starlingCrypto, syncCrypto };
  }

  function storageRef(value, crypto) {
    return typeof value === "string" && value.startsWith(crypto.REFERENCE_PREFIX)
      && /^[A-Za-z0-9_-]{43}$/.test(value.slice(crypto.REFERENCE_PREFIX.length));
  }

  function snapshotHead(value, head) {
    if (!head.validHead(value)) throw fail("head-invalid");
    return Object.freeze({ schema: value.schema, revision: value.revision, sealRef: value.sealRef });
  }

  function freeze(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(freeze));
    if (value && typeof value === "object") {
      const copy = {};
      for (const key of Object.keys(value)) copy[key] = freeze(value[key]);
      return Object.freeze(copy);
    }
    return value;
  }

  function validateDescriptor(input) {
    const { head, starlingCrypto } = dependencies();
    if (!exact(input, DESCRIPTOR_FIELDS) || input.schema !== DESCRIPTOR_SCHEMA
        || !identifier(input.syncedPocketId) || !Array.isArray(input.newRecords)) {
      throw fail("descriptor-invalid");
    }
    const expectedHead = snapshotHead(input.expectedHead, head);
    if (expectedHead.revision < 1 || !storageRef(expectedHead.sealRef, starlingCrypto)
        || !storageRef(input.candidateSealStorageRef, starlingCrypto)) {
      throw fail("descriptor-invalid");
    }
    const seen = new Set();
    const newRecords = input.newRecords.map((entry) => {
      if (!exact(entry, RECORD_FIELDS) || !storageRef(entry.storageRef, starlingCrypto)
          || !entry.record || typeof entry.record !== "object" || Array.isArray(entry.record)
          || seen.has(entry.storageRef)) throw fail("descriptor-invalid");
      seen.add(entry.storageRef);
      return freeze({ storageRef: entry.storageRef, record: entry.record });
    });
    if (!seen.has(input.candidateSealStorageRef)) throw fail("descriptor-invalid");
    const sorted = newRecords.slice().sort((a, b) => a.storageRef.localeCompare(b.storageRef));
    if (newRecords.some((entry, index) => entry.storageRef !== sorted[index].storageRef)) {
      throw fail("descriptor-invalid");
    }
    return freeze({
      schema: DESCRIPTOR_SCHEMA,
      syncedPocketId: input.syncedPocketId,
      expectedHead,
      candidateSealStorageRef: input.candidateSealStorageRef,
      newRecords,
    });
  }

  function descriptorFromPrepared(prepared) {
    const { storage, head } = dependencies();
    if (!prepared || prepared.outcome !== "prepared" || !prepared.stage
        || !prepared.binding || !head.validHead(prepared.expectedHead)) {
      throw fail("prepared-invalid");
    }
    let binding;
    try { binding = storage.publicationBinding(prepared.stage); }
    catch (_error) { throw fail("prepared-invalid"); }
    if (binding.syncedPocketId !== prepared.binding.syncedPocketId
        || binding.expectedSealStorageRef !== prepared.binding.expectedSealStorageRef
        || binding.candidateSealStorageRef !== prepared.binding.candidateSealStorageRef
        || binding.newRecordCount !== prepared.binding.newRecordCount
        || prepared.expectedHead.sealRef !== binding.expectedSealStorageRef
        || prepared.stage.sealStorageRef !== binding.candidateSealStorageRef
        || prepared.stage.newRecords.length !== binding.newRecordCount) {
      throw fail("prepared-invalid");
    }
    return validateDescriptor({
      schema: DESCRIPTOR_SCHEMA,
      syncedPocketId: binding.syncedPocketId,
      expectedHead: prepared.expectedHead,
      candidateSealStorageRef: binding.candidateSealStorageRef,
      newRecords: prepared.stage.newRecords,
    });
  }

  function requireService(value) {
    if (!value || typeof value !== "object"
        || ["putOpaqueObject", "objectPresence", "compareAndSetShadowHead",
          "readShadowHead", "getOpaqueObject"].some((name) => typeof value[name] !== "function")) {
      throw fail("service-invalid");
    }
    return value;
  }

  function operationIdFactory(value) {
    if (typeof value !== "function") throw fail("operation-id-factory-invalid");
    return (kind, index) => {
      const id = value(kind, index);
      if (!identifier(id)) throw fail("operation-id-invalid");
      return id;
    };
  }

  function createCoordinator(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).length !== 2) throw fail("coordinator-input-invalid");
    const service = requireService(input.objectHeadService);
    const freshOperationId = operationIdFactory(input.operationIdFactory);

    async function provePresence(descriptorInput, prefix) {
      const descriptor = validateDescriptor(descriptorInput);
      for (let start = 0, chunk = 0; start < descriptor.newRecords.length;
        start += PRESENCE_CHUNK_SIZE, chunk += 1) {
        const entries = descriptor.newRecords.slice(start, start + PRESENCE_CHUNK_SIZE);
        const response = await service.objectPresence({
          apiVersion: API_VERSION,
          operationId: freshOperationId(`${prefix}-presence`, chunk),
          syncedPocketId: descriptor.syncedPocketId,
          storageRefs: entries.map((entry) => entry.storageRef),
        });
        if (!response || !Array.isArray(response.rows) || response.rows.length !== entries.length) {
          throw fail("presence-unproved");
        }
        for (let index = 0; index < entries.length; index += 1) {
          const row = response.rows[index];
          if (!row || row.storageRef !== entries[index].storageRef || row.present !== true) {
            throw fail("presence-unproved");
          }
        }
      }
      return descriptor;
    }

    async function ensureObjects(descriptorInput) {
      const descriptor = validateDescriptor(descriptorInput);
      for (let index = 0; index < descriptor.newRecords.length; index += 1) {
        const entry = descriptor.newRecords[index];
        await service.putOpaqueObject({
          apiVersion: API_VERSION,
          operationId: freshOperationId("durable-put-object", index),
          syncedPocketId: descriptor.syncedPocketId,
          storageRef: entry.storageRef,
          record: entry.record,
        });
      }
      await provePresence(descriptor, "durable-object");
      return Object.freeze({ outcome: "objects-present" });
    }

    async function attemptHead(descriptorInput) {
      const descriptor = await provePresence(descriptorInput, "pre-cas");
      let response;
      try {
        response = await service.compareAndSetShadowHead({
          apiVersion: API_VERSION,
          operationId: freshOperationId("durable-compare-and-set-head", 0),
          syncedPocketId: descriptor.syncedPocketId,
          expectedHead: descriptor.expectedHead,
          candidateSealStorageRef: descriptor.candidateSealStorageRef,
        });
      } catch (_error) {
        throw fail("head-outcome-unknown");
      }
      if (response?.ok === true && response.head) {
        const { head } = dependencies();
        const accepted = snapshotHead(response.head, head);
        if (accepted.revision !== descriptor.expectedHead.revision + 1
            || accepted.sealRef !== descriptor.candidateSealStorageRef) {
          throw fail("head-outcome-unknown");
        }
        return Object.freeze({ outcome: "committed", head: accepted });
      }
      if (response?.ok === false && response.reason === "head-conflict") {
        return Object.freeze({ outcome: "conflict" });
      }
      if (response?.ok === false && ["candidate-object-missing", "head-revision-exhausted"].includes(response.reason)) {
        return Object.freeze({ outcome: "not-committed", reason: response.reason });
      }
      throw fail("head-outcome-unknown");
    }

    async function reconcile(inputValue) {
      if (!inputValue || typeof inputValue !== "object" || Array.isArray(inputValue)
          || Object.keys(inputValue).length !== 3
          || !Object.prototype.hasOwnProperty.call(inputValue, "descriptor")
          || !Object.prototype.hasOwnProperty.call(inputValue, "masterKey")
          || !Object.prototype.hasOwnProperty.call(inputValue, "context")) {
        throw fail("reconcile-input-invalid");
      }
      const descriptor = validateDescriptor(inputValue.descriptor);
      const { head, storage, starlingCrypto, syncCrypto } = dependencies();
      let masterKey;
      let context;
      try {
        masterKey = syncCrypto.validateNonExtractableAesKey(inputValue.masterKey);
        const supplied = starlingCrypto.validateContext(inputValue.context);
        context = Object.freeze({ syncedPocketId: supplied.syncedPocketId });
      } catch (_error) { throw fail("reconcile-input-invalid"); }
      if (context.syncedPocketId !== descriptor.syncedPocketId) throw fail("reconcile-input-invalid");
      let actual;
      try {
        const response = await service.readShadowHead({
          apiVersion: API_VERSION,
          operationId: freshOperationId("durable-read-head", 0),
          syncedPocketId: descriptor.syncedPocketId,
        });
        actual = response && head.validHead(response.head)
          ? snapshotHead(response.head, head) : null;
      } catch (_error) { return Object.freeze({ outcome: head.OUTCOME.UNKNOWN, examined: 0 }); }
      if (!actual) return Object.freeze({ outcome: head.OUTCOME.UNKNOWN, examined: 0 });
      if (actual.revision === descriptor.expectedHead.revision
          && actual.sealRef === descriptor.expectedHead.sealRef) {
        return Object.freeze({ outcome: head.OUTCOME.NOT_COMMITTED, examined: 0 });
      }
      if (actual.revision <= descriptor.expectedHead.revision) {
        return Object.freeze({ outcome: head.OUTCOME.UNKNOWN, examined: 0 });
      }
      const delta = actual.revision - descriptor.expectedHead.revision;
      let ref = actual.sealRef;
      let candidateDepth = -1;
      const seen = new Set();
      for (let depth = 0; depth < delta; depth += 1) {
        if (seen.has(ref)) return Object.freeze({ outcome: head.OUTCOME.UNKNOWN, examined: depth });
        seen.add(ref);
        let capsule;
        try {
          const response = await service.getOpaqueObject({
            apiVersion: API_VERSION,
            operationId: freshOperationId("durable-get-seal", depth),
            syncedPocketId: descriptor.syncedPocketId,
            storageRef: ref,
          });
          if (!response || response.present !== true || !response.record) {
            return Object.freeze({ outcome: head.OUTCOME.UNKNOWN, examined: depth + 1 });
          }
          capsule = storage.validateCapsuleBytes(await starlingCrypto.openObject(
            response.record, ref, masterKey, context
          ));
        } catch (_error) {
          return Object.freeze({ outcome: head.OUTCOME.UNKNOWN, examined: depth + 1 });
        }
        if (capsule.logicalKind !== "candidate-seal") {
          return Object.freeze({ outcome: head.OUTCOME.UNKNOWN, examined: depth + 1 });
        }
        if (ref === descriptor.candidateSealStorageRef) candidateDepth = depth;
        const previousLogicalRef = capsule.object.previousSealRef;
        if (previousLogicalRef === null) ref = null;
        else {
          const link = capsule.links.find((entry) => entry.logicalRef === previousLogicalRef);
          if (!link) return Object.freeze({ outcome: head.OUTCOME.UNKNOWN, examined: depth + 1 });
          ref = link.storageRef;
        }
        if (depth + 1 < delta && (typeof ref !== "string" || !ref)) {
          return Object.freeze({ outcome: head.OUTCOME.UNKNOWN, examined: depth + 1 });
        }
      }
      if (ref !== descriptor.expectedHead.sealRef) {
        return Object.freeze({ outcome: head.OUTCOME.UNKNOWN, examined: delta });
      }
      if (candidateDepth === delta - 1) {
        return Object.freeze({
          outcome: delta === 1 ? head.OUTCOME.COMMITTED : head.OUTCOME.COMMITTED_AND_SUPERSEDED,
          examined: delta,
        });
      }
      if (candidateDepth !== -1) {
        return Object.freeze({ outcome: head.OUTCOME.UNKNOWN, examined: delta });
      }
      return Object.freeze({ outcome: head.OUTCOME.CONFLICT, examined: delta });
    }

    return Object.freeze({ ensureObjects, attemptHead, reconcile });
  }

  global.PocketStarlingDurablePublication = Object.freeze({
    DESCRIPTOR_SCHEMA,
    validateDescriptor,
    descriptorFromPrepared,
    createCoordinator,
  });
})(typeof window !== "undefined" ? window : globalThis);