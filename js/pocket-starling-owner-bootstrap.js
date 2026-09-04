/* P162 owner-contained initial Starling base bootstrap.

This module wraps the existing Synced owner controller without changing its
whole-record Save path. Bootstrap is explicit, generation-bound and dormant:
it may establish one authenticated Starling genesis, but never becomes Save
authority and never exposes owner key material or the accepted session.
*/
(function initialisePocketStarlingOwnerBootstrap(global) {
  "use strict";

  const baseOwnerApi = global.PocketSyncOwnerController;
  if (!baseOwnerApi || typeof baseOwnerApi.createSyncedOwnerController !== "function") return;

  const FACTORY_FIELDS = Object.freeze([
    "crypto", "deviceStore", "contentService", "randomBytes",
  ]);
  const OPTIONAL_FACTORY_FIELD = "starlingBootstrap";
  const HEAD_SCHEMA = "pocket.starling.head.v1";

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function freeze(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(freeze));
    if (isObject(value)) {
      const copy = {};
      for (const key of Object.keys(value)) copy[key] = freeze(value[key]);
      return Object.freeze(copy);
    }
    return value;
  }

  function failure(reason, extra = {}) {
    return freeze({ ok: false, reason, ...extra });
  }

  function sameValue(left, right) {
    if (left === right) return true;
    if (typeof left !== typeof right || left === null || right === null) return false;
    if (Array.isArray(left) || Array.isArray(right)) {
      return Array.isArray(left) && Array.isArray(right)
        && left.length === right.length
        && left.every((value, index) => sameValue(value, right[index]));
    }
    if (!isObject(left) || !isObject(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && sameValue(left[key], right[key]));
  }

  function safeHead(head) {
    return head && head.schema === HEAD_SCHEMA && Number.isSafeInteger(head.revision)
      && head.revision >= 0
      && ((head.revision === 0 && head.sealRef === null)
        || (head.revision > 0 && typeof head.sealRef === "string" && head.sealRef))
      ? Object.freeze({ schema: HEAD_SCHEMA, revision: head.revision, sealRef: head.sealRef })
      : null;
  }

  function currentScriptServiceRoot() {
    const value = global.document?.currentScript?.dataset?.serviceRoot;
    return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
      && !value.includes("\\") && !value.includes("?") && !value.includes("#")
      ? value : null;
  }

  function randomOperationId(kind, index) {
    const crypto = global.crypto;
    const encode = global.PocketSyncCrypto?.encodeBase64Url;
    if (!crypto || typeof crypto.getRandomValues !== "function" || typeof encode !== "function") {
      throw new Error("Pocket Starling bootstrap operation-id-unavailable.");
    }
    const bytes = new Uint8Array(18);
    try {
      crypto.getRandomValues(bytes);
      return `p162-${String(kind).slice(0, 48)}-${index}-${encode(bytes)}`;
    } finally { bytes.fill(0); }
  }

  function defaultBootstrapOptions() {
    const serviceRoot = currentScriptServiceRoot();
    const remote = global.PocketSyncRemoteClient;
    if (!serviceRoot || !remote || typeof remote.createBrowserJsonTransport !== "function"
        || typeof remote.createObjectHeadService !== "function"
        || typeof global.normaliseInput !== "function"
        || typeof global.normaliseRootExtras !== "function") return null;
    try {
      const transport = remote.createBrowserJsonTransport({ serviceRoot });
      return Object.freeze({
        objectHeadService: remote.createObjectHeadService({ transport }),
        operationIdFactory: randomOperationId,
        normaliseInput: global.normaliseInput,
        normaliseRootExtras: global.normaliseRootExtras,
      });
    } catch (_error) { return null; }
  }

  const productionBootstrapOptions = defaultBootstrapOptions();

  function checkedBootstrapOptions(input) {
    const value = input || productionBootstrapOptions;
    if (!isObject(value)
        || !isObject(value.objectHeadService)
        || ["putOpaqueObject", "getOpaqueObject", "objectPresence", "initialiseShadowHead",
          "readShadowHead", "compareAndSetShadowHead"]
          .some((name) => typeof value.objectHeadService[name] !== "function")
        || typeof value.operationIdFactory !== "function"
        || typeof value.normaliseInput !== "function"
        || typeof value.normaliseRootExtras !== "function") return null;
    return value;
  }

  function starlingDependencies() {
    const bridge = global.PocketStarlingBridgeShadow;
    const root = global.PocketStarlingRootShadow;
    const placement = global.PocketStarlingPlacementShadow;
    const logical = global.PocketStarlingObjectSealShadow;
    const semantic = global.PocketStarlingSemanticAuthorityShadow;
    const storage = global.PocketStarlingStorageShadow;
    const publication = global.PocketStarlingPublicationShadow;
    const remoteOpen = global.PocketStarlingRemoteOpenShadow;
    const materialize = global.PocketStarlingMaterializeShadow;
    const head = global.PocketStarlingHeadShadow;
    if (!bridge || typeof bridge.encode !== "function"
        || !root || typeof root.build !== "function"
        || !placement || typeof placement.audit !== "function"
        || !logical || typeof logical.createStager !== "function"
        || typeof logical.stageCandidate !== "function"
        || typeof logical.auditCandidateSeal !== "function"
        || typeof logical.semanticAuditProvenance !== "function"
        || typeof logical.canonical !== "function"
        || !semantic || typeof semantic.issueInitial !== "function"
        || !storage || typeof storage.stageCandidate !== "function"
        || !publication || typeof publication.createPublisher !== "function"
        || typeof publication.createReconciler !== "function"
        || !remoteOpen || typeof remoteOpen.createRemoteOpener !== "function"
        || !materialize || typeof materialize.materializeAccepted !== "function"
        || !head || typeof head.validHead !== "function" || !head.OUTCOME) return null;
    return { bridge, root, placement, logical, semantic, storage, publication, remoteOpen, materialize, head };
  }

  function normalisedSource(options, payload, deps) {
    if (!isObject(payload) || payload.schema !== "portal.export.v1") return failure("bootstrap-source-invalid");
    let norm;
    try {
      const parsed = options.normaliseInput(payload);
      const dataExtras = options.normaliseRootExtras(isObject(payload.data) ? payload.data : {});
      norm = isObject(parsed) ? {
        schema: parsed.schema,
        writtenAt: parsed.writtenAt,
        nodes: parsed.nodes,
        tombstones: parsed.tombstones,
        rootExtras: isObject(parsed.rootExtras) ? parsed.rootExtras : {},
        dataExtras: isObject(dataExtras) ? dataExtras : {},
      } : null;
    } catch (_error) { return failure("bootstrap-source-invalid"); }
    const fields = ["schema", "writtenAt", "nodes", "tombstones", "rootExtras", "dataExtras"];
    if (!isObject(norm) || fields.some((field) => !Object.prototype.hasOwnProperty.call(norm, field))
        || typeof norm.schema !== "string" || !norm.schema
        || typeof norm.writtenAt !== "string" || !norm.writtenAt
        || !Array.isArray(norm.nodes) || !Array.isArray(norm.tombstones)
        || !isObject(norm.rootExtras) || !isObject(norm.dataExtras)) {
      return failure("bootstrap-source-invalid");
    }
    const canonical = deps.logical.canonical(norm);
    if (!canonical || canonical.ok !== true || typeof canonical.bytes !== "string") {
      return failure("bootstrap-source-invalid");
    }
    try { return { ok: true, document: JSON.parse(canonical.bytes) }; }
    catch (_error) { return failure("bootstrap-source-invalid"); }
  }

  function canonicalOwnerProjection(source, encoded, deps) {
    const relation = deps.placement.audit(encoded.bridge.structural);
    if (!relation || relation.ok !== true || !relation.relation) return failure("bootstrap-source-invalid");
    const byId = new Map(source.nodes.map((node) => [node.id, node]));
    if (byId.size !== source.nodes.length) return failure("bootstrap-source-invalid");
    const nodes = [];
    const seen = new Set();
    const visit = (parentId) => {
      const children = relation.relation.children[parentId] || [];
      for (let index = 0; index < children.length; index += 1) {
        const nodeId = children[index];
        const node = byId.get(nodeId);
        if (!node || seen.has(nodeId)) return false;
        seen.add(nodeId);
        const payload = {};
        for (const key of Object.keys(node)) {
          if (key !== "id" && key !== "parentId" && key !== "order") payload[key] = node[key];
        }
        nodes.push({ id: nodeId, parentId, order: index, ...payload });
        if (!visit(nodeId)) return false;
      }
      return true;
    };
    if (!visit("root") || seen.size !== source.nodes.length) return failure("bootstrap-source-invalid");
    const projected = {
      schema: source.schema,
      writtenAt: source.writtenAt,
      nodes,
      tombstones: source.tombstones,
      rootExtras: source.rootExtras,
      dataExtras: source.dataExtras,
    };
    const canonical = deps.logical.canonical(projected);
    if (!canonical || canonical.ok !== true) return failure("bootstrap-source-invalid");
    try { return { ok: true, document: JSON.parse(canonical.bytes), bytes: canonical.bytes }; }
    catch (_error) { return failure("bootstrap-source-invalid"); }
  }

  async function proveAccepted(options, input, deps, expectedHead = null) {
    try {
      if (typeof input.sourceGuard === "function" && await input.sourceGuard() !== true) {
        return failure("bootstrap-source-stale");
      }
      const opener = deps.remoteOpen.createRemoteOpener({
        objectHeadService: options.objectHeadService,
        operationIdFactory: options.operationIdFactory,
      });
      const opened = await opener.openRemote({
        masterKey: input.masterKey,
        context: { syncedPocketId: input.syncedPocketId },
        semanticAuthority: input.semanticAuthority,
      });
      if (!opened || opened.outcome !== "opened" || !opened.session) {
        return failure("bootstrap-remote-open-failed");
      }
      const acceptedHead = safeHead(opened.head);
      if (!acceptedHead || acceptedHead.revision !== 1
          || (expectedHead && (acceptedHead.revision !== expectedHead.revision
            || acceptedHead.sealRef !== expectedHead.sealRef))) {
        return failure("bootstrap-head-mismatch");
      }
      let sealBytes;
      try { sealBytes = await opened.session.resolveLogical(opened.session.acceptedSealRef); }
      catch (_error) { return failure("bootstrap-remote-open-failed"); }
      let seal;
      try { seal = JSON.parse(sealBytes); }
      catch (_error) { return failure("bootstrap-remote-open-failed"); }
      if (!seal || seal.previousSealRef !== null) return failure("bootstrap-head-not-genesis");
      const materialized = await deps.materialize.materializeAccepted(opened.session);
      if (!materialized || materialized.ok !== true || !materialized.document) {
        return failure("bootstrap-materialize-failed");
      }
      const canonical = deps.logical.canonical(materialized.document);
      if (!canonical || canonical.ok !== true || canonical.bytes !== input.expectedDocumentBytes) {
        return failure("bootstrap-equivalence-failed");
      }
      if (typeof input.sourceGuard === "function" && await input.sourceGuard() !== true) {
        return failure("bootstrap-source-stale");
      }
      return { ok: true, head: acceptedHead, session: opened.session };
    } catch (_error) { return failure("bootstrap-remote-open-failed"); }
  }

  async function composeInitialBootstrap(options, input) {
    const deps = starlingDependencies();
    if (!deps) return failure("bootstrap-foundation-unavailable");
    const source = normalisedSource(options, input.payload, deps);
    if (!source.ok) return source;
    const encoded = deps.bridge.encode(source.document, { capacity: 4 });
    if (!encoded || encoded.ok !== true || !encoded.bridge) return failure("bootstrap-source-invalid");
    const expected = canonicalOwnerProjection(source.document, encoded, deps);
    if (!expected.ok) return expected;
    const rooted = deps.root.build(encoded.bridge);
    if (!rooted || rooted.ok !== true || !rooted.state) return failure("bootstrap-source-invalid");
    const stager = deps.logical.createStager();
    const logical = deps.logical.stageCandidate(stager, rooted.state, { previousSealRef: null });
    if (!logical || logical.ok !== true || !logical.stage?.sealRef) return failure("bootstrap-logical-stage-failed");
    const audit = deps.logical.auditCandidateSeal(logical.stage.sealRef, (ref) => stager.store.get(ref));
    if (!audit || audit.ok !== true) return failure("bootstrap-semantic-audit-failed");
    const auditProof = deps.logical.semanticAuditProvenance(audit);
    const issued = await deps.semantic.issueInitial({ authority: input.semanticAuthority, auditProof });
    if (!issued || issued.ok !== true || !issued.proof) return failure("bootstrap-semantic-audit-failed");
    let stage;
    try {
      stage = await deps.storage.stageCandidate({
        sealRef: logical.stage.sealRef,
        resolveLogical: (ref) => stager.store.get(ref),
        masterKey: input.masterKey,
        context: { syncedPocketId: input.syncedPocketId },
        semanticAuthority: input.semanticAuthority,
        semanticValidityProof: issued.proof,
      });
    } catch (_error) { return failure("bootstrap-storage-stage-failed"); }

    if (typeof input.sourceGuard === "function" && await input.sourceGuard() !== true) {
      return failure("bootstrap-source-stale");
    }

    let initialHead = null;
    try {
      const response = await options.objectHeadService.initialiseShadowHead({
        apiVersion: 1,
        operationId: options.operationIdFactory("initialise-head", 0),
        syncedPocketId: input.syncedPocketId,
      });
      initialHead = safeHead(response?.head);
    } catch (_error) {
      try {
        const response = await options.objectHeadService.readShadowHead({
          apiVersion: 1,
          operationId: options.operationIdFactory("reconcile-initialise-head", 0),
          syncedPocketId: input.syncedPocketId,
        });
        initialHead = safeHead(response?.head);
      } catch (_readError) { return failure("bootstrap-head-outcome-unknown"); }
    }
    if (!initialHead) return failure("bootstrap-head-outcome-unknown");

    if (initialHead.revision > 0) {
      const reused = await proveAccepted(options, {
        ...input,
        expectedDocumentBytes: expected.bytes,
      }, deps, null);
      return reused.ok ? { ...reused, reused: true, sourceDocument: expected.document }
        : failure("bootstrap-existing-head-incompatible");
    }

    let guardFailed = false;
    const guardedService = Object.freeze({
      putOpaqueObject: (...args) => options.objectHeadService.putOpaqueObject(...args),
      getOpaqueObject: (...args) => options.objectHeadService.getOpaqueObject(...args),
      objectPresence: (...args) => options.objectHeadService.objectPresence(...args),
      initialiseShadowHead: (...args) => options.objectHeadService.initialiseShadowHead(...args),
      readShadowHead: (...args) => options.objectHeadService.readShadowHead(...args),
      async compareAndSetShadowHead(...args) {
        if (typeof input.sourceGuard === "function" && await input.sourceGuard() !== true) {
          guardFailed = true;
          throw new Error("bootstrap-source-stale");
        }
        return options.objectHeadService.compareAndSetShadowHead(...args);
      },
    });

    const publisher = deps.publication.createPublisher({
      objectHeadService: guardedService,
      operationIdFactory: options.operationIdFactory,
    });
    let published;
    try {
      published = await publisher.publishCandidate({ stage, expectedHead: initialHead });
    } catch (error) {
      if (guardFailed) return failure("bootstrap-source-stale");
      if (error?.code !== "publication-outcome-unknown") {
        return failure("bootstrap-object-publication-failed");
      }
      let reconciled;
      try {
        reconciled = await deps.publication.createReconciler({
          objectHeadService: options.objectHeadService,
          operationIdFactory: options.operationIdFactory,
        }).reconcileAmbiguousPublication({
          stage,
          expectedHead: initialHead,
          masterKey: input.masterKey,
          context: { syncedPocketId: input.syncedPocketId },
        });
      } catch (_error) { return failure("bootstrap-head-outcome-unknown"); }
      if (!reconciled || reconciled.outcome !== deps.head.OUTCOME.COMMITTED) {
        return failure(reconciled?.outcome === deps.head.OUTCOME.CONFLICT
          ? "bootstrap-head-conflict" : "bootstrap-head-outcome-unknown");
      }
      published = { outcome: "committed", head: { schema: HEAD_SCHEMA, revision: 1, sealRef: stage.sealStorageRef } };
    }

    if (published?.outcome === "conflict") {
      const reused = await proveAccepted(options, {
        ...input,
        expectedDocumentBytes: expected.bytes,
      }, deps, null);
      return reused.ok ? { ...reused, reused: true, sourceDocument: expected.document }
        : failure("bootstrap-head-conflict");
    }
    if (published?.outcome !== "committed") {
      return failure("bootstrap-head-not-accepted");
    }
    const acceptedHead = safeHead(published.head);
    if (!acceptedHead || acceptedHead.revision !== 1 || acceptedHead.sealRef !== stage.sealStorageRef) {
      return failure("bootstrap-head-outcome-unknown");
    }
    const proven = await proveAccepted(options, {
      ...input,
      expectedDocumentBytes: expected.bytes,
    }, deps, acceptedHead);
    return proven.ok ? { ...proven, reused: false, sourceDocument: expected.document } : proven;
  }

  function splitFactoryConfiguration(input) {
    if (!isObject(input)) return { base: input, bootstrap: null };
    const keys = Object.keys(input);
    const allowed = new Set([...FACTORY_FIELDS, OPTIONAL_FACTORY_FIELD]);
    if (keys.some((key) => !allowed.has(key))) return { base: input, bootstrap: null };
    const base = {};
    for (const field of FACTORY_FIELDS) if (Object.prototype.hasOwnProperty.call(input, field)) base[field] = input[field];
    return { base, bootstrap: input[OPTIONAL_FACTORY_FIELD] || null };
  }

  function createSyncedOwnerController(configuration) {
    const split = splitFactoryConfiguration(configuration);
    const base = baseOwnerApi.createSyncedOwnerController(split.base);
    const options = checkedBootstrapOptions(split.bootstrap);
    let mirror = null;
    let accepted = null;

    function clearOwnerPrivateState() {
      mirror = null;
      accepted = null;
    }

    function currentSession() {
      return base.captureSyncedOwnerSaveSession();
    }

    function stateMatchesMirror(state, session, record = mirror?.record) {
      return !!mirror && !!state && !!session && !!record
        && base.isSyncedOwnerSaveSessionCurrent(session) === true
        && mirror.token === session.token && mirror.generation === session.generation
        && mirror.syncedPocketId === session.syncedPocketId
        && state.syncedPocketId === mirror.syncedPocketId
        && state.generation === mirror.generation
        && record.syncedPocketId === mirror.syncedPocketId;
    }

    function sourceRecordMatchesMirror(record) {
      const original = mirror?.record;
      if (!record || !original) return false;
      return record.kind === original.kind
        && record.schemaVersion === original.schemaVersion
        && record.storeRevision === original.storeRevision
        && record.syncedPocketId === original.syncedPocketId
        && record.deviceId === original.deviceId
        && sameValue(record.content, original.content)
        && sameValue(record.remote, original.remote)
        && sameValue(record.deviceEnvelope?.context, original.deviceEnvelope?.context)
        && sameValue(record.deviceEnvelope?.metadata, original.deviceEnvelope?.metadata)
        && sameValue(record.deviceEnvelope?.record, original.deviceEnvelope?.record);
    }

    async function captureMirror(suppliedMasterKey = null) {
      const state = base.getSyncedOwnerState();
      const session = currentSession();
      if (!state || !session || !base.isSyncedOwnerSaveSessionCurrent(session)) return false;
      let record;
      let masterKey = suppliedMasterKey;
      try {
        record = await configuration.deviceStore.readPocket(state.syncedPocketId);
        if (!record || record.syncedPocketId !== state.syncedPocketId) return false;
        if (masterKey) configuration.crypto.validateNonExtractableAesKey(masterKey);
        else {
          const bundle = await configuration.crypto.openMasterKeyBundle(
            record.deviceEnvelope.record,
            record.deviceWrappingKey,
            record.deviceEnvelope.context,
            []
          );
          masterKey = configuration.crypto.validateNonExtractableAesKey(bundle?.masterKey);
        }
        await configuration.crypto.openContent(record.content.record, masterKey, record.content.context);
      } catch (_error) { return false; }
      if (!base.isSyncedOwnerSaveSessionCurrent(session)) return false;
      const current = base.getSyncedOwnerState();
      if (!current || current.generation !== state.generation
          || current.syncedPocketId !== state.syncedPocketId) return false;
      mirror = { token: session.token, generation: session.generation,
        syncedPocketId: session.syncedPocketId, record, masterKey };
      accepted = null;
      return true;
    }

    async function refreshMirrorAfterSave() {
      if (!mirror) return false;
      const state = base.getSyncedOwnerState();
      const session = currentSession();
      if (!stateMatchesMirror(state, session)) { clearOwnerPrivateState(); return false; }
      try {
        const record = await configuration.deviceStore.readPocket(mirror.syncedPocketId);
        if (!record || record.syncedPocketId !== mirror.syncedPocketId) return false;
        mirror.record = record;
        return true;
      } catch (_error) { return false; }
    }

    async function sourceGuard(sourceRecord, sourceRevision, sourceSession) {
      if (!base.isSyncedOwnerSaveSessionCurrent(sourceSession)) return false;
      const state = base.getSyncedOwnerState();
      if (!state || state.syncedPocketId !== sourceSession.syncedPocketId
          || state.generation !== sourceSession.generation
          || state.pending !== false
          || state.confirmedRemoteRevision !== sourceRevision
          || state.knownRemoteRevision !== sourceRevision) return false;
      let stored;
      try { stored = await configuration.deviceStore.readPocket(sourceSession.syncedPocketId); }
      catch (_error) { return false; }
      return sourceRecordMatchesMirror(stored) && sourceRecordMatchesMirror(sourceRecord);
    }

    async function bootstrapInitialStarlingBase() {
      if (!options) return failure("bootstrap-unavailable");
      const state = base.getSyncedOwnerState();
      const session = currentSession();
      if (!state || !session || !base.isSyncedOwnerSaveSessionCurrent(session)) {
        return failure("no-synced-owner");
      }
      if (accepted && accepted.token === session.token && accepted.generation === session.generation) {
        return freeze({ ok: true, reason: "already-ready", generation: accepted.generation,
          sourceRevision: accepted.sourceRevision, head: accepted.head });
      }
      if (!stateMatchesMirror(state, session)) {
        if (!await captureMirror(null)) return failure("bootstrap-source-unavailable");
      }
      const startState = base.getSyncedOwnerState();
      const startSession = currentSession();
      if (!stateMatchesMirror(startState, startSession)) return failure("bootstrap-source-stale");
      const sourceRevision = startState.confirmedRemoteRevision;
      const sourceRecord = mirror.record;
      if (!Number.isSafeInteger(sourceRevision) || sourceRevision < 1
          || startState.pending !== false || startState.knownRemoteRevision !== sourceRevision
          || sourceRecord.remote?.confirmedRevision !== sourceRevision
          || sourceRecord.remote?.pending !== null || sourceRecord.remote?.conflict !== null
          || sourceRecord.content?.context?.syncedPocketId !== mirror.syncedPocketId
          || sourceRecord.content?.context?.revision !== sourceRevision) {
        return failure("bootstrap-source-not-confirmed");
      }
      let stored;
      try { stored = await configuration.deviceStore.readPocket(mirror.syncedPocketId); }
      catch (_error) { return failure("bootstrap-source-unavailable"); }
      if (!sourceRecordMatchesMirror(stored)) return failure("bootstrap-source-stale");

      let payload;
      let semanticBundle;
      try {
        payload = await configuration.crypto.openContent(
          sourceRecord.content.record, mirror.masterKey, sourceRecord.content.context
        );
        semanticBundle = await configuration.crypto.openMasterKeyBundle(
          sourceRecord.deviceEnvelope.record,
          sourceRecord.deviceWrappingKey,
          sourceRecord.deviceEnvelope.context,
          [],
          { semanticAuthority: true }
        );
        configuration.crypto.validateNonExtractableAesKey(semanticBundle?.masterKey);
        const checked = await configuration.crypto.openContent(
          sourceRecord.content.record, semanticBundle.masterKey, sourceRecord.content.context
        );
        if (!sameValue(payload, checked) || !semanticBundle.semanticAuthority) {
          return failure("bootstrap-source-authentication-failed");
        }
      } catch (_error) { return failure("bootstrap-source-authentication-failed"); }

      const guard = () => sourceGuard(sourceRecord, sourceRevision, startSession);
      if (!await guard()) return failure("bootstrap-source-stale");
      const composed = await composeInitialBootstrap(options, {
        syncedPocketId: mirror.syncedPocketId,
        payload,
        masterKey: semanticBundle.masterKey,
        semanticAuthority: semanticBundle.semanticAuthority,
        sourceGuard: guard,
      });
      payload = null;
      if (!composed.ok) return composed;
      if (!await guard()) return failure("bootstrap-source-stale");
      accepted = {
        token: startSession.token,
        generation: startSession.generation,
        sourceRevision,
        head: safeHead(composed.head),
        session: composed.session,
      };
      return freeze({ ok: true, reason: composed.reused ? "reused" : "ready",
        generation: accepted.generation, sourceRevision, head: accepted.head });
    }

    function getStarlingBootstrapState() {
      const session = currentSession();
      if (!accepted || !session || accepted.token !== session.token
          || accepted.generation !== session.generation
          || !base.isSyncedOwnerSaveSessionCurrent(session)) return null;
      return freeze({ ready: true, generation: accepted.generation,
        sourceRevision: accepted.sourceRevision, head: accepted.head });
    }

    async function adoptSyncedOwner(input) {
      const result = await base.adoptSyncedOwner(input);
      if (result?.ok === true) {
        clearOwnerPrivateState();
        await captureMirror(input?.masterKey || null);
      }
      return result;
    }

    async function adoptReadyActivation(input) {
      const result = await base.adoptReadyActivation(input);
      if (result?.ok === true) {
        clearOwnerPrivateState();
      }
      return result;
    }

    async function adoptReadyRecovery(input, dependencies) {
      const result = await base.adoptReadyRecovery(input, dependencies);
      if (result?.ok === true) {
        clearOwnerPrivateState();
        await captureMirror(null);
      }
      return result;
    }

    async function saveSyncedOwner(input) {
      const result = await base.saveSyncedOwner(input);
      await refreshMirrorAfterSave();
      return result;
    }

    function releaseSyncedOwner() {
      clearOwnerPrivateState();
      return base.releaseSyncedOwner();
    }

    return Object.freeze({
      canAdoptSyncedOwner: base.canAdoptSyncedOwner,
      adoptSyncedOwner,
      adoptReadyActivation,
      adoptReadyRecovery,
      releaseSyncedOwner,
      captureSyncedOwnerSaveSession: base.captureSyncedOwnerSaveSession,
      isSyncedOwnerSaveSessionCurrent: base.isSyncedOwnerSaveSessionCurrent,
      getSyncedOwnerState: base.getSyncedOwnerState,
      saveSyncedOwner,
      bootstrapInitialStarlingBase,
      getStarlingBootstrapState,
    });
  }

  global.PocketSyncOwnerController = Object.freeze({ createSyncedOwnerController });
  global.PocketStarlingOwnerBootstrap = Object.freeze({
    composeInitialBootstrap,
  });
})(typeof window !== "undefined" ? window : globalThis);