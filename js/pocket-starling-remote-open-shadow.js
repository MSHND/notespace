/* Dormant P124 remote-open composition. It has no live owner or transport
   selection: callers inject the established P120 object/Head service. */
(function (global) {
  "use strict";

  const API_VERSION = 1, IDENTIFIER_LIMIT = 160;

  function fail(code) {
    const error = new Error(`Pocket Starling remote open ${code}.`);
    error.code = code;
    return error;
  }

  function exact(value, fields) {
    return value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === fields.length &&
      fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
  }

  function dependencies() {
    const storage = global.PocketStarlingStorageShadow,
      crypto = global.PocketStarlingCryptoShadow,
      sync = global.PocketSyncCrypto,
      head = global.PocketStarlingHeadShadow,
      semantic = global.PocketStarlingSemanticAuthorityShadow;
    if (!storage || !crypto || !sync || !head ||
      typeof storage.createResolver !== "function" ||
      typeof crypto.validateContext !== "function" ||
      typeof sync.validateNonExtractableAesKey !== "function" ||
      !semantic || typeof semantic.authenticate !== "function" ||
      typeof head.validHead !== "function") throw fail("remote-open-input-invalid");
    return { storage, crypto, sync, head, semantic };
  }

  function claimFactory(factory) {
    const used = new Set();
    return (kind, index) => {
      let id;
      try { id = factory(kind, index); } catch (_error) { throw fail("remote-open-operation-id-invalid"); }
      if (typeof id !== "string" || !id || id.length > IDENTIFIER_LIMIT || id !== id.trim() || used.has(id))
        throw fail("remote-open-operation-id-invalid");
      used.add(id);
      return id;
    };
  }

  function createRemoteOpener({ objectHeadService, operationIdFactory } = {}) {
    if (!objectHeadService || typeof objectHeadService !== "object" ||
      typeof objectHeadService.readShadowHead !== "function" ||
      typeof objectHeadService.getOpaqueObject !== "function" ||
      typeof operationIdFactory !== "function") throw fail("remote-open-input-invalid");

    async function openRemote(input) {
      const { storage, crypto, sync, head, semantic } = dependencies();
      const inputFields = ["masterKey", "context", "semanticAuthority"];
      if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).length !== inputFields.length || inputFields.some((field) => !(field in input)))
        throw fail("remote-open-input-invalid");
      let masterKey, context;
      try {
        masterKey = sync.validateNonExtractableAesKey(input.masterKey);
        const supplied = crypto.validateContext(input.context);
        context = Object.freeze({ syncedPocketId: supplied.syncedPocketId });
      } catch (_error) { throw fail("remote-open-input-invalid"); }
      const claim = claimFactory(operationIdFactory), readHeadId = claim("read-head", 0),
        response = await objectHeadService.readShadowHead({ apiVersion: API_VERSION, operationId: readHeadId, syncedPocketId: context.syncedPocketId });
      if (!response || response.head === null)
        return Object.freeze({ outcome: "uninitialised", head: null });
      if (!head.validHead(response.head)) throw fail("remote-open-input-invalid");
      const acceptedHead = Object.freeze({ schema: response.head.schema, revision: response.head.revision, sealRef: response.head.sealRef });
      if (acceptedHead.revision === 0)
        return Object.freeze({ outcome: "empty", head: acceptedHead });
      let getIndex = 0;
      const resolver = await storage.createResolver({
        acceptedSealStorageRef: acceptedHead.sealRef,
        acceptedBaseComplete: true,
        masterKey,
        context,
        async resolveStorage(storageRef) {
          const index = getIndex,
            operationId = claim("get-object", index);
          getIndex += 1;
          const response = await objectHeadService.getOpaqueObject({
            apiVersion: API_VERSION,
            operationId,
            syncedPocketId: context.syncedPocketId,
            storageRef,
          });
          if (!response || response.present !== true || !response.record)
            throw fail("remote-open-object-missing");
          return response.record;
        },
      }), opened = await resolver.openAccepted();
      if (!opened || opened.ok !== true || !opened.handle) throw fail("remote-open-input-invalid");
      const semanticValidity = resolver.semanticValidity();
      if (!semanticValidity) throw fail("semantic-validity-missing");
      const binding = Object.freeze({
          syncedPocketId: context.syncedPocketId,
          logicalSealRef: resolver.acceptedSealRef,
          logicalRootRef: opened.handle.seal.rootRef,
          previousLogicalSealRef: opened.handle.seal.previousSealRef,
          logicalSealSchema: "pocket.starling.candidate-seal.v1",
          logicalRootSchema: "pocket.starling.logical-root.v1",
          logicalObjectSchema: "pocket.starling.logical-object.v1",
          sequenceSchema: "pocket.starling.sequence-page.v2",
          placementGeneration: "pocket.starling.placement-relation.v1",
        }), authenticated = await semantic.authenticate({
          authority: input.semanticAuthority,
          semanticValidity,
          binding,
        });
      if (!authenticated || authenticated.ok !== true || !authenticated.semanticBaseProof)
        throw fail(authenticated && authenticated.reason === "semantic-validity-invalid"
          ? "semantic-validity-invalid" : "semantic-validity-missing");
      const session = Object.freeze({
        acceptedSealRef: resolver.acceptedSealRef,
        semanticBaseProof: authenticated.semanticBaseProof,
        resolveLogical: (ref) => resolver.resolveLogical(ref),
        createReuseProof: () => resolver.createReuseProof(),
        readContent: (nodeId) => resolver.readContent(opened.handle, nodeId),
        readPlacement: (nodeId) => resolver.readPlacement(opened.handle, nodeId),
        diagnostics: () => resolver.diagnostics(),
      });
      return Object.freeze({ outcome: "opened", head: acceptedHead, session });
    }
    return Object.freeze({ openRemote });
  }

  global.PocketStarlingRemoteOpenShadow = Object.freeze({ createRemoteOpener });
})(typeof window !== "undefined" ? window : globalThis);
