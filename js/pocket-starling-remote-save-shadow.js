/* Dormant P127 one-shot remote save composition. */
(function (global) {
  "use strict";
  function fail(code) { const error = new Error(`Pocket Starling remote save ${code}.`); error.code = code; return error; }
  function exact(value, fields) { return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field)); }
  function dependencies() {
    const sync = global.PocketSyncCrypto, crypto = global.PocketStarlingCryptoShadow, edit = global.PocketStarlingRemoteEditShadow, publication = global.PocketStarlingPublicationShadow;
    if (!sync || !crypto || !edit || !publication || typeof sync.validateNonExtractableAesKey !== "function" || typeof crypto.validateContext !== "function" || typeof edit.createEditor !== "function" || typeof publication.createPublisher !== "function" || typeof publication.createReconciler !== "function") throw fail("remote-save-input-invalid");
    return { sync, crypto, edit, publication };
  }
  function service(value) { return value && typeof value === "object" && ["putOpaqueObject", "objectPresence", "compareAndSetShadowHead", "readShadowHead", "getOpaqueObject"].every((key) => typeof value[key] === "function"); }
  async function createTransaction(input) {
    if (!exact(input, ["opened", "masterKey", "context", "objectHeadService", "operationIdFactory"])) throw fail("remote-save-input-invalid");
    const { sync, crypto, edit, publication } = dependencies(); let masterKey, context;
    try { masterKey = sync.validateNonExtractableAesKey(input.masterKey); const supplied = crypto.validateContext(input.context); context = Object.freeze({ syncedPocketId: supplied.syncedPocketId }); } catch (_error) { throw fail("remote-save-input-invalid"); }
    if (!service(input.objectHeadService) || typeof input.operationIdFactory !== "function") throw fail("remote-save-input-invalid");
    const editor = await edit.createEditor({ opened: input.opened, masterKey, context }), publisher = publication.createPublisher({ objectHeadService: input.objectHeadService, operationIdFactory: input.operationIdFactory }), reconciler = publication.createReconciler({ objectHeadService: input.objectHeadService, operationIdFactory: input.operationIdFactory });
    let state = "ready", pending = null;
    async function save(value, fields, prepare) {
      if (state !== "ready") throw fail("remote-save-state-invalid");
      if (!exact(value, fields)) throw fail("remote-save-input-invalid");
      const prepared = await editor[prepare](value);
      if (prepared && prepared.outcome === "unchanged") return Object.freeze({ outcome: "unchanged" });
      if (!prepared || prepared.outcome !== "prepared") return prepared;
      try { const result = await publisher.publishCandidate({ stage: prepared.stage, expectedHead: prepared.expectedHead }); state = "terminal"; return result; }
      catch (error) { if (error && error.code === "publication-outcome-unknown") { pending = { stage: prepared.stage, expectedHead: prepared.expectedHead }; state = "ambiguous"; return Object.freeze({ outcome: "ambiguous" }); } state = "terminal"; throw error; }
    }
    async function savePayload(value) { return save(value, ["nodeId", "payload"], "preparePayloadEdit"); }
    async function saveMove(value) { return save(value, ["nodeId", "fromIndex", "newParentId", "toIndex"], "prepareMove"); }
    async function saveReorder(value) { return save(value, ["nodeId", "fromIndex", "toIndex"], "prepareReorder"); }
    async function reconcileAmbiguous() {
      if (state !== "ambiguous" || !pending) throw fail("remote-save-state-invalid");
      const result = await reconciler.reconcileAmbiguousPublication({ stage: pending.stage, expectedHead: pending.expectedHead, masterKey, context });
      if (result.outcome !== "unknown") { state = "terminal"; pending = null; }
      return result;
    }
    return Object.freeze({ savePayload, saveMove, saveReorder, reconcileAmbiguous });
  }
  global.PocketStarlingRemoteSaveShadow = Object.freeze({ createTransaction });
})(typeof window !== "undefined" ? window : globalThis);
