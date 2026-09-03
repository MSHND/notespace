/* P164 rollback-safe post-bootstrap Starling successor mirror.

This wrapper keeps the existing whole-record Synced controller as the only live
Save owner. For one eligible explicit Save it durably records the exact P160
working set, prepares one physical Starling successor from the proved P162 base,
lets the whole-record Save become authoritative first, and only then attempts
one Head transition. Starling failures never turn a confirmed whole-record Save
into a user-facing failure.
*/
(function initialisePocketStarlingOwnerSuccessor(global) {
  "use strict";

  const baseOwnerApi = global.PocketSyncOwnerController;
  if (!baseOwnerApi || typeof baseOwnerApi.createSyncedOwnerController !== "function") return;

  const STATE_SCHEMA = "pocket.starling.owner-mirror-state.v1";
  const MIGRATION_SCHEMA = "pocket.starling.owner-migration.v1";
  const HEAD_SCHEMA = "pocket.starling.head.v1";
  const PHASES = Object.freeze([
    "captured", "prepared", "objects-present", "cas-ambiguous", "conflict",
  ]);
  const BASE_FACTORY_FIELDS = Object.freeze([
    "crypto", "deviceStore", "contentService", "randomBytes", "starlingBootstrap",
  ]);
  const OPTIONAL_SUCCESSOR_FIELD = "starlingSuccessor";

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function exact(value, fields) {
    return isObject(value) && Object.keys(value).length === fields.length
      && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
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

  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); }
    catch (_error) { return null; }
  }

  function failure(reason) {
    return Object.freeze({ ok: false, reason });
  }

  function safeHead(value) {
    const head = global.PocketStarlingHeadShadow;
    return head && typeof head.validHead === "function" && head.validHead(value)
      ? Object.freeze({ schema: value.schema, revision: value.revision, sealRef: value.sealRef })
      : null;
  }

  function sameHead(left, right) {
    return !!left && !!right && left.schema === right.schema
      && left.revision === right.revision && left.sealRef === right.sealRef;
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
      throw new Error("Pocket Starling successor operation-id-unavailable.");
    }
    const bytes = new Uint8Array(18);
    try {
      crypto.getRandomValues(bytes);
      return `p164-${String(kind).slice(0, 48)}-${index}-${encode(bytes)}`;
    } finally { bytes.fill(0); }
  }

  function defaultRemoteOptions() {
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

  const productionRemoteOptions = defaultRemoteOptions();

  function checkedOptions(configuration, successorInput) {
    const bootstrap = isObject(configuration?.starlingBootstrap)
      ? configuration.starlingBootstrap : productionRemoteOptions;
    const successor = successorInput === undefined ? null : successorInput;
    if (successor !== null && (!exact(successor, ["ownerStateStore"])
        || !isObject(successor.ownerStateStore))) return null;
    const ownerStateStore = successor?.ownerStateStore || global.PocketStarlingOwnerState;
    if (!isObject(bootstrap) || !isObject(bootstrap.objectHeadService)
        || ["putOpaqueObject", "getOpaqueObject", "objectPresence", "readShadowHead",
          "compareAndSetShadowHead"].some((name) => typeof bootstrap.objectHeadService[name] !== "function")
        || typeof bootstrap.operationIdFactory !== "function"
        || typeof bootstrap.normaliseInput !== "function"
        || typeof bootstrap.normaliseRootExtras !== "function"
        || !ownerStateStore || ["open", "read", "write"].some((name) => typeof ownerStateStore[name] !== "function")) {
      return null;
    }
    return Object.freeze({
      objectHeadService: bootstrap.objectHeadService,
      operationIdFactory: bootstrap.operationIdFactory,
      normaliseInput: bootstrap.normaliseInput,
      normaliseRootExtras: bootstrap.normaliseRootExtras,
      ownerStateStore,
    });
  }

  function splitConfiguration(input) {
    if (!isObject(input)) return { base: input, successor: undefined };
    const allowed = new Set([...BASE_FACTORY_FIELDS, OPTIONAL_SUCCESSOR_FIELD]);
    if (Object.keys(input).some((field) => !allowed.has(field))) {
      return { base: input, successor: undefined };
    }
    const base = {};
    for (const field of BASE_FACTORY_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(input, field)) base[field] = input[field];
    }
    return { base, successor: input[OPTIONAL_SUCCESSOR_FIELD] };
  }

  function validatePreparation(value) {
    if (!exact(value, ["ceiling", "operations", "preservationProjection"])
        || !Number.isSafeInteger(value.ceiling) || value.ceiling < 1
        || !Array.isArray(value.operations) || !isObject(value.preservationProjection)) return null;
    const copied = clone(value);
    return copied ? freeze(copied) : null;
  }

  function resolvePreparation(payload) {
    const resolver = global.currentPocketStarlingOwnerSavePreparation;
    if (typeof resolver !== "function") return null;
    try { return validatePreparation(resolver(payload)); }
    catch (_error) { return null; }
  }

  function validateAccepted(value) {
    if (!exact(value, ["sourceRevision", "head"])
        || !Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 1) return null;
    const head = safeHead(value.head);
    return head && head.revision >= 1 ? freeze({ sourceRevision: value.sourceRevision, head }) : null;
  }

  function validateMigration(value) {
    if (value === null) return null;
    if (!exact(value, [
      "schema", "sourceRevision", "targetRevision", "ceiling", "operations",
      "preservationProjection", "expectedHead", "targetFingerprint", "descriptor",
      "phase", "casMayHaveRun",
    ]) || value.schema !== MIGRATION_SCHEMA
        || !Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 1
        || value.targetRevision !== value.sourceRevision + 1
        || !Number.isSafeInteger(value.ceiling) || value.ceiling < 1
        || !Array.isArray(value.operations) || !isObject(value.preservationProjection)
        || typeof value.targetFingerprint !== "string" || !/^sha256:[A-Za-z0-9_-]{43}$/.test(value.targetFingerprint)
        || !PHASES.includes(value.phase) || typeof value.casMayHaveRun !== "boolean") return null;
    const expectedHead = safeHead(value.expectedHead);
    if (!expectedHead || expectedHead.revision < 1) return null;
    let descriptor = null;
    if (value.descriptor !== null) {
      try { descriptor = global.PocketStarlingDurablePublication?.validateDescriptor?.(value.descriptor); }
      catch (_error) { return null; }
      if (!descriptor || descriptor.syncedPocketId.length < 1
          || !sameHead(descriptor.expectedHead, expectedHead)) return null;
    }
    if (value.phase !== "captured" && !descriptor) return null;
    return freeze({
      schema: MIGRATION_SCHEMA,
      sourceRevision: value.sourceRevision,
      targetRevision: value.targetRevision,
      ceiling: value.ceiling,
      operations: clone(value.operations),
      preservationProjection: clone(value.preservationProjection),
      expectedHead,
      targetFingerprint: value.targetFingerprint,
      descriptor,
      phase: value.phase,
      casMayHaveRun: value.casMayHaveRun,
    });
  }

  function validatePlainState(value, ownerRecord) {
    if (!exact(value, ["schema", "owner", "accepted", "migration"])
        || value.schema !== STATE_SCHEMA || !exact(value.owner, [
          "syncedPocketId", "deviceId", "masterKeyGeneration",
        ]) || value.owner.syncedPocketId !== ownerRecord.syncedPocketId
        || value.owner.deviceId !== ownerRecord.deviceId
        || value.owner.masterKeyGeneration !== ownerRecord.usage?.masterKeyGeneration) return null;
    const accepted = validateAccepted(value.accepted);
    if (!accepted) return null;
    const migration = validateMigration(value.migration);
    if (value.migration !== null && !migration) return null;
    if (migration && (migration.sourceRevision !== accepted.sourceRevision
        || !sameHead(migration.expectedHead, accepted.head))) return null;
    return freeze({
      schema: STATE_SCHEMA,
      owner: {
        syncedPocketId: ownerRecord.syncedPocketId,
        deviceId: ownerRecord.deviceId,
        masterKeyGeneration: ownerRecord.usage.masterKeyGeneration,
      },
      accepted,
      migration,
    });
  }

  function createSyncedOwnerController(configuration) {
    const split = splitConfiguration(configuration);
    const base = baseOwnerApi.createSyncedOwnerController(split.base);
    const options = checkedOptions(split.base, split.successor);
    let privateOwner = null;
    let accepted = null;
    let stateStoreOpened = false;

    function clearPrivate() {
      privateOwner = null;
      accepted = null;
    }

    function currentSession() {
      return base.captureSyncedOwnerSaveSession();
    }

    function currentPrivate() {
      const session = currentSession();
      return privateOwner && session
        && base.isSyncedOwnerSaveSessionCurrent(session) === true
        && privateOwner.token === session.token
        && privateOwner.generation === session.generation
        && privateOwner.syncedPocketId === session.syncedPocketId
        ? { session, owner: privateOwner } : null;
    }

    async function capturePrivateOwner() {
      if (!options) return false;
      const state = base.getSyncedOwnerState();
      const session = currentSession();
      if (!state || !session || !base.isSyncedOwnerSaveSessionCurrent(session)) return false;
      let record;
      let bundle;
      try {
        record = await split.base.deviceStore.readPocket(state.syncedPocketId);
        if (!record || record.syncedPocketId !== state.syncedPocketId) return false;
        bundle = await split.base.crypto.openMasterKeyBundle(
          record.deviceEnvelope.record,
          record.deviceWrappingKey,
          record.deviceEnvelope.context,
          [],
          { semanticAuthority: true }
        );
        split.base.crypto.validateNonExtractableAesKey(bundle?.masterKey);
        if (!bundle?.semanticAuthority) return false;
        await split.base.crypto.openContent(record.content.record, bundle.masterKey, record.content.context);
      } catch (_error) { return false; }
      if (!base.isSyncedOwnerSaveSessionCurrent(session)) return false;
      const current = base.getSyncedOwnerState();
      if (!current || current.generation !== state.generation
          || current.syncedPocketId !== state.syncedPocketId) return false;
      privateOwner = {
        token: session.token,
        generation: session.generation,
        syncedPocketId: session.syncedPocketId,
        record,
        masterKey: bundle.masterKey,
        semanticAuthority: bundle.semanticAuthority,
      };
      accepted = null;
      return true;
    }

    async function refreshPrivateOwner() {
      const current = currentPrivate();
      if (!current) return capturePrivateOwner();
      try {
        const record = await split.base.deviceStore.readPocket(current.owner.syncedPocketId);
        if (!record || record.syncedPocketId !== current.owner.syncedPocketId
            || record.deviceId !== current.owner.record.deviceId) return false;
        current.owner.record = record;
        return true;
      } catch (_error) { return false; }
    }

    async function ensureStateStoreOpen() {
      if (!options) return false;
      if (stateStoreOpened) return true;
      try {
        await options.ownerStateStore.open();
        stateStoreOpened = true;
        return true;
      } catch (_error) { return false; }
    }

    async function loadDurableState() {
      const current = currentPrivate();
      if (!current || !await ensureStateStoreOpen()) return null;
      let stored;
      try { stored = await options.ownerStateStore.read(current.owner.syncedPocketId); }
      catch (_error) { return null; }
      if (!stored) return null;
      if (stored.syncedPocketId !== current.owner.syncedPocketId
          || stored.deviceId !== current.owner.record.deviceId) return null;
      let plain;
      try {
        plain = await split.base.crypto.openContent(
          stored.encrypted.record,
          current.owner.record.deviceWrappingKey,
          stored.encrypted.context
        );
      } catch (_error) { return null; }
      return validatePlainState(plain, current.owner.record);
    }

    async function persistDurableState(plainInput) {
      const current = currentPrivate();
      if (!current || !await ensureStateStoreOpen()) return false;
      const plain = validatePlainState(plainInput, current.owner.record);
      if (!plain) return false;
      let record;
      try { record = await split.base.deviceStore.readPocket(current.owner.syncedPocketId); }
      catch (_error) { return false; }
      if (!record || record.deviceId !== current.owner.record.deviceId
          || record.usage?.masterKeyGeneration !== current.owner.record.usage?.masterKeyGeneration) return false;
      let reserved;
      try {
        reserved = await split.base.deviceStore.reservePocketEncryptionUsage(
          record.syncedPocketId,
          record.storeRevision,
          record.usage,
          { masterKeyContentEncryptions: 0, deviceWrappingKeyEncryptions: 1 }
        );
      } catch (_error) { return false; }
      if (!base.isSyncedOwnerSaveSessionCurrent(current.session)) return false;
      current.owner.record = reserved;
      let previous;
      try { previous = await options.ownerStateStore.read(record.syncedPocketId); }
      catch (_error) { return false; }
      if (previous && previous.deviceId !== reserved.deviceId) return false;
      const revision = previous ? previous.revision + 1 : 1;
      if (!Number.isSafeInteger(revision) || revision < 1) return false;
      const context = {
        syncedPocketId: reserved.syncedPocketId,
        revision,
        contentType: split.base.crypto.FORMAT.contentType,
      };
      let encryptedRecord;
      try {
        encryptedRecord = await split.base.crypto.sealContent(
          plain,
          reserved.deviceWrappingKey,
          context
        );
      } catch (_error) { return false; }
      try {
        await options.ownerStateStore.write({
          expectedRevision: previous ? previous.revision : null,
          record: {
            kind: global.PocketStarlingOwnerState.FORMAT.kind,
            schemaVersion: global.PocketStarlingOwnerState.FORMAT.schemaVersion,
            revision,
            syncedPocketId: reserved.syncedPocketId,
            deviceId: reserved.deviceId,
            encrypted: { context, record: encryptedRecord },
          },
        });
        return true;
      } catch (_error) { return false; }
    }

    function ownerBinding(record) {
      return Object.freeze({
        syncedPocketId: record.syncedPocketId,
        deviceId: record.deviceId,
        masterKeyGeneration: record.usage.masterKeyGeneration,
      });
    }

    function plainState(acceptedInput, migration) {
      const current = currentPrivate();
      const acceptedValue = validateAccepted(acceptedInput);
      if (!current || !acceptedValue) return null;
      return freeze({
        schema: STATE_SCHEMA,
        owner: ownerBinding(current.owner.record),
        accepted: acceptedValue,
        migration,
      });
    }

    function canonicalDocument(payload) {
      if (!isObject(payload) || payload.schema !== "portal.export.v1") return null;
      const logical = global.PocketStarlingObjectSealShadow;
      const bridge = global.PocketStarlingBridgeShadow;
      const placement = global.PocketStarlingPlacementShadow;
      if (!logical || typeof logical.canonical !== "function"
          || !bridge || typeof bridge.encode !== "function"
          || !placement || typeof placement.audit !== "function") return null;
      try {
        const parsed = options.normaliseInput(payload);
        const dataExtras = options.normaliseRootExtras(isObject(payload.data) ? payload.data : {});
        if (!isObject(parsed) || typeof parsed.schema !== "string" || !parsed.schema
            || typeof parsed.writtenAt !== "string" || !parsed.writtenAt
            || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.tombstones)) return null;
        const document = {
          schema: parsed.schema,
          writtenAt: parsed.writtenAt,
          nodes: parsed.nodes,
          tombstones: parsed.tombstones,
          rootExtras: isObject(parsed.rootExtras) ? parsed.rootExtras : {},
          dataExtras: isObject(dataExtras) ? dataExtras : {},
        };
        const encoded = bridge.encode(document, { capacity: 4 });
        if (!encoded || encoded.ok !== true || !encoded.bridge) return null;
        const relation = placement.audit(encoded.bridge.structural);
        if (!relation || relation.ok !== true || !relation.relation) return null;
        const byId = new Map(document.nodes.map((node) => [node.id, node]));
        if (byId.size !== document.nodes.length) return null;
        const nodes = [];
        const seen = new Set();
        const visit = (parentId) => {
          const children = relation.relation.children[parentId] || [];
          for (let index = 0; index < children.length; index += 1) {
            const nodeId = children[index];
            const node = byId.get(nodeId);
            if (!node || seen.has(nodeId)) return false;
            seen.add(nodeId);
            const nodePayload = {};
            for (const key of Object.keys(node)) {
              if (key !== "id" && key !== "parentId" && key !== "order") nodePayload[key] = node[key];
            }
            nodes.push({ id: nodeId, parentId, order: index, ...nodePayload });
            if (!visit(nodeId)) return false;
          }
          return true;
        };
        if (!visit("root") || seen.size !== document.nodes.length) return null;
        const projected = {
          schema: document.schema,
          writtenAt: document.writtenAt,
          nodes,
          tombstones: document.tombstones,
          rootExtras: document.rootExtras,
          dataExtras: document.dataExtras,
        };
        const canonical = logical.canonical(projected);
        if (!canonical || canonical.ok !== true || typeof canonical.bytes !== "string") return null;
        return Object.freeze({ document: freeze(JSON.parse(canonical.bytes)), bytes: canonical.bytes });
      } catch (_error) { return null; }
    }

    async function fingerprint(bytes) {
      if (typeof bytes !== "string" || !global.crypto?.subtle?.digest) return null;
      try {
        const digest = new Uint8Array(await global.crypto.subtle.digest(
          "SHA-256", new TextEncoder().encode(bytes)
        ));
        return `sha256:${split.base.crypto.encodeBase64Url(digest)}`;
      } catch (_error) { return null; }
    }

    async function freshOpen() {
      const current = currentPrivate();
      const remoteOpen = global.PocketStarlingRemoteOpenShadow;
      if (!current || !remoteOpen || typeof remoteOpen.createRemoteOpener !== "function") return null;
      try {
        return await remoteOpen.createRemoteOpener({
          objectHeadService: options.objectHeadService,
          operationIdFactory: options.operationIdFactory,
        }).openRemote({
          masterKey: current.owner.masterKey,
          context: { syncedPocketId: current.owner.syncedPocketId },
          semanticAuthority: current.owner.semanticAuthority,
        });
      } catch (_error) { return null; }
    }

    async function proveOpened(opened, expectedHead, expectedFingerprint, expectedBytes = null) {
      const materialize = global.PocketStarlingMaterializeShadow;
      const logical = global.PocketStarlingObjectSealShadow;
      if (!opened || opened.outcome !== "opened" || !opened.session
          || !sameHead(opened.head, expectedHead)
          || !materialize || typeof materialize.materializeAccepted !== "function"
          || !logical || typeof logical.canonical !== "function") return false;
      try {
        const materialized = await materialize.materializeAccepted(opened.session);
        if (!materialized || materialized.ok !== true || !materialized.document) return false;
        const canonical = logical.canonical(materialized.document);
        if (!canonical || canonical.ok !== true || typeof canonical.bytes !== "string") return false;
        if (expectedBytes !== null && canonical.bytes !== expectedBytes) return false;
        const actualFingerprint = await fingerprint(canonical.bytes);
        return actualFingerprint !== null && actualFingerprint === expectedFingerprint;
      } catch (_error) { return false; }
    }

    async function ensureAccepted(sourceRevision, durable = null) {
      const current = currentPrivate();
      if (!current) return null;
      if (accepted && accepted.token === current.session.token
          && accepted.generation === current.session.generation
          && accepted.sourceRevision === sourceRevision) return accepted;
      const candidates = [];
      if (durable?.accepted) candidates.push(durable.accepted);
      const bootstrap = base.getStarlingBootstrapState?.();
      if (bootstrap) candidates.push({ sourceRevision: bootstrap.sourceRevision, head: bootstrap.head });
      let metadata = null;
      for (const candidate of candidates) {
        const checked = validateAccepted(candidate);
        if (checked && checked.sourceRevision === sourceRevision) { metadata = checked; break; }
      }
      if (!metadata) return null;
      const opened = await freshOpen();
      if (!opened || opened.outcome !== "opened" || !opened.session || !sameHead(opened.head, metadata.head)) {
        return null;
      }
      const state = base.getSyncedOwnerState();
      const record = current.owner.record;
      if (state && state.pending === false && state.confirmedRemoteRevision === sourceRevision
          && record.remote?.confirmedRevision === sourceRevision && record.remote?.pending === null) {
        let payload;
        try {
          payload = await split.base.crypto.openContent(
            record.content.record, current.owner.masterKey, record.content.context
          );
        } catch (_error) { return null; }
        const canonical = canonicalDocument(payload);
        const expectedFingerprint = canonical && await fingerprint(canonical.bytes);
        if (!canonical || !expectedFingerprint
            || !await proveOpened(opened, metadata.head, expectedFingerprint, canonical.bytes)) return null;
      }
      accepted = {
        token: current.session.token,
        generation: current.session.generation,
        sourceRevision,
        head: metadata.head,
        session: opened.session,
      };
      return accepted;
    }

    async function prepareDescriptor(migration, durable) {
      const current = currentPrivate();
      const remoteEdit = global.PocketStarlingRemoteEditShadow;
      const durablePublication = global.PocketStarlingDurablePublication;
      if (!current || !remoteEdit || typeof remoteEdit.createEditor !== "function"
          || !durablePublication || typeof durablePublication.descriptorFromPrepared !== "function") return null;
      const source = await ensureAccepted(migration.sourceRevision, durable);
      if (!source || !sameHead(source.head, migration.expectedHead)) return null;
      try {
        const editor = await remoteEdit.createEditor({
          opened: { outcome: "opened", head: source.head, session: source.session },
          masterKey: current.owner.masterKey,
          context: { syncedPocketId: current.owner.syncedPocketId },
          semanticAuthority: current.owner.semanticAuthority,
        });
        const prepared = await editor.prepareWorkingSet(
          clone(migration.operations),
          clone(migration.preservationProjection)
        );
        if (!prepared || prepared.outcome !== "prepared") return null;
        const descriptor = durablePublication.descriptorFromPrepared(prepared);
        if (!descriptor || descriptor.syncedPocketId !== current.owner.syncedPocketId
            || !sameHead(descriptor.expectedHead, migration.expectedHead)) return null;
        return descriptor;
      } catch (_error) { return null; }
    }

    async function persistMigration(durable, migration) {
      const current = currentPrivate();
      if (!current) return null;
      const acceptedMeta = durable?.accepted || validateAccepted({
        sourceRevision: migration.sourceRevision,
        head: migration.expectedHead,
      });
      const nextPlain = plainState(acceptedMeta, migration);
      if (!nextPlain || !await persistDurableState(nextPlain)) return null;
      return nextPlain;
    }

    async function proveAndAccept(durable, migration, expectedBytes = null) {
      const current = currentPrivate();
      if (!current || !migration.descriptor) return false;
      const candidateHead = safeHead({
        schema: HEAD_SCHEMA,
        revision: migration.expectedHead.revision + 1,
        sealRef: migration.descriptor.candidateSealStorageRef,
      });
      if (!candidateHead) return false;
      const opened = await freshOpen();
      if (!await proveOpened(opened, candidateHead, migration.targetFingerprint, expectedBytes)) return false;
      const nextPlain = plainState({ sourceRevision: migration.targetRevision, head: candidateHead }, null);
      if (!nextPlain || !await persistDurableState(nextPlain)) return false;
      accepted = {
        token: current.session.token,
        generation: current.session.generation,
        sourceRevision: migration.targetRevision,
        head: candidateHead,
        session: opened.session,
      };
      return true;
    }

    async function completeMigration(durableInput, expectedBytes = null, callState = { casAttempted: false }) {
      let durable = durableInput;
      let migration = durable?.migration;
      const current = currentPrivate();
      if (!current || !migration) return false;
      const record = current.owner.record;
      if (record.remote?.confirmedRevision < migration.targetRevision
          || record.remote?.pending !== null || record.remote?.conflict !== null) return false;

      if (!migration.descriptor) {
        const descriptor = await prepareDescriptor(migration, durable);
        if (!descriptor) return false;
        migration = freeze({ ...migration, descriptor, phase: "prepared", casMayHaveRun: false });
        durable = await persistMigration(durable, migration);
        if (!durable) return false;
      }

      const coordinator = global.PocketStarlingDurablePublication?.createCoordinator?.({
        objectHeadService: options.objectHeadService,
        operationIdFactory: options.operationIdFactory,
      });
      if (!coordinator) return false;

      if (migration.casMayHaveRun) {
        let reconciled;
        try {
          reconciled = await coordinator.reconcile({
            descriptor: migration.descriptor,
            masterKey: current.owner.masterKey,
            context: { syncedPocketId: current.owner.syncedPocketId },
          });
        } catch (_error) { return false; }
        const outcomes = global.PocketStarlingHeadShadow?.OUTCOME;
        if (!outcomes) return false;
        if (reconciled.outcome === outcomes.COMMITTED) {
          return proveAndAccept(durable, migration, expectedBytes);
        }
        if (reconciled.outcome === outcomes.CONFLICT
            || reconciled.outcome === outcomes.COMMITTED_AND_SUPERSEDED) {
          const conflicted = freeze({ ...migration, phase: "conflict", casMayHaveRun: true });
          await persistMigration(durable, conflicted);
          return false;
        }
        if (reconciled.outcome !== outcomes.NOT_COMMITTED) return false;
        migration = freeze({ ...migration, phase: "objects-present", casMayHaveRun: false });
        durable = await persistMigration(durable, migration);
        if (!durable || callState.casAttempted) return false;
      }

      try {
        await coordinator.ensureObjects(migration.descriptor);
      } catch (_error) { return false; }
      if (migration.phase !== "objects-present") {
        migration = freeze({ ...migration, phase: "objects-present", casMayHaveRun: false });
        durable = await persistMigration(durable, migration);
        if (!durable) return false;
      }
      if (callState.casAttempted) return false;

      migration = freeze({ ...migration, phase: "cas-ambiguous", casMayHaveRun: true });
      durable = await persistMigration(durable, migration);
      if (!durable) return false;
      callState.casAttempted = true;

      let headResult;
      try { headResult = await coordinator.attemptHead(migration.descriptor); }
      catch (_error) {
        try {
          const reconciled = await coordinator.reconcile({
            descriptor: migration.descriptor,
            masterKey: current.owner.masterKey,
            context: { syncedPocketId: current.owner.syncedPocketId },
          });
          if (reconciled.outcome === global.PocketStarlingHeadShadow.OUTCOME.COMMITTED) {
            return proveAndAccept(durable, migration, expectedBytes);
          }
          if (reconciled.outcome === global.PocketStarlingHeadShadow.OUTCOME.CONFLICT
              || reconciled.outcome === global.PocketStarlingHeadShadow.OUTCOME.COMMITTED_AND_SUPERSEDED) {
            await persistMigration(durable, freeze({ ...migration, phase: "conflict", casMayHaveRun: true }));
          }
        } catch (_reconcileError) {}
        return false;
      }
      if (headResult.outcome === "committed") {
        return proveAndAccept(durable, migration, expectedBytes);
      }
      if (headResult.outcome === "conflict") {
        await persistMigration(durable, freeze({ ...migration, phase: "conflict", casMayHaveRun: true }));
        return false;
      }
      if (headResult.outcome === "not-committed") {
        await persistMigration(durable, freeze({ ...migration, phase: "objects-present", casMayHaveRun: false }));
      }
      return false;
    }

    async function recoverPriorMigration() {
      if (!await refreshPrivateOwner()) return null;
      const durable = await loadDurableState();
      if (!durable?.migration) return durable;
      await completeMigration(durable, null, { casAttempted: false });
      return loadDurableState();
    }

    async function bootstrapInitialStarlingBase() {
      if (!await refreshPrivateOwner()) await capturePrivateOwner();
      const current = currentPrivate();
      if (current && accepted && accepted.token === current.session.token
          && accepted.generation === current.session.generation) {
        return freeze({
          ok: true,
          reason: "already-ready",
          generation: current.session.generation,
          sourceRevision: accepted.sourceRevision,
          head: accepted.head,
        });
      }
      const durable = current ? await loadDurableState() : null;
      if (current && durable && !durable.migration) {
        const restored = await ensureAccepted(durable.accepted.sourceRevision, durable);
        if (restored) {
          return freeze({
            ok: true,
            reason: "reused",
            generation: current.session.generation,
            sourceRevision: restored.sourceRevision,
            head: restored.head,
          });
        }
      }
      const result = await base.bootstrapInitialStarlingBase();
      if (result?.ok === true) {
        await refreshPrivateOwner();
        const now = currentPrivate();
        if (now) {
          const opened = await freshOpen();
          if (opened?.outcome === "opened" && sameHead(opened.head, result.head)) {
            accepted = {
              token: now.session.token,
              generation: now.session.generation,
              sourceRevision: result.sourceRevision,
              head: safeHead(result.head),
              session: opened.session,
            };
          }
        }
      }
      return result;
    }

    function getStarlingBootstrapState() {
      const current = currentPrivate();
      if (current && accepted && accepted.token === current.session.token
          && accepted.generation === current.session.generation) {
        return freeze({
          ready: true,
          generation: current.session.generation,
          sourceRevision: accepted.sourceRevision,
          head: accepted.head,
        });
      }
      return base.getStarlingBootstrapState();
    }

    async function adoptSyncedOwner(input) {
      const result = await base.adoptSyncedOwner(input);
      if (result?.ok === true) {
        clearPrivate();
        await capturePrivateOwner();
      }
      return result;
    }

    async function adoptReadyActivation(input) {
      const result = await base.adoptReadyActivation(input);
      if (result?.ok === true) {
        clearPrivate();
        await capturePrivateOwner();
      }
      return result;
    }

    async function adoptReadyRecovery(input, dependencies) {
      const result = await base.adoptReadyRecovery(input, dependencies);
      if (result?.ok === true) {
        clearPrivate();
        await capturePrivateOwner();
      }
      return result;
    }

    function releaseSyncedOwner() {
      clearPrivate();
      return base.releaseSyncedOwner();
    }

    async function saveSyncedOwner(input) {
      if (!options || !input || typeof input.freezePayload !== "function") {
        return base.saveSyncedOwner(input);
      }
      if (!await refreshPrivateOwner()) {
        const result = await base.saveSyncedOwner(input);
        await refreshPrivateOwner();
        return result;
      }

      let durable = await recoverPriorMigration();
      const before = base.getSyncedOwnerState();
      const current = currentPrivate();
      if (!before || !current) return base.saveSyncedOwner(input);

      if (durable?.migration || before.pending === true) {
        const result = await base.saveSyncedOwner(input);
        await refreshPrivateOwner();
        if (result?.ok === true && durable?.migration) {
          durable = await loadDurableState();
          if (durable?.migration) await completeMigration(durable, null, { casAttempted: false });
        }
        return result;
      }

      let payload;
      try { payload = await input.freezePayload(); }
      catch (_error) { return base.saveSyncedOwner(input); }
      const preparation = resolvePreparation(payload);
      if (!preparation) return base.saveSyncedOwner(input);
      const source = await ensureAccepted(before.confirmedRemoteRevision, durable);
      if (!source || before.pending !== false
          || before.confirmedRemoteRevision !== before.knownRemoteRevision
          || source.sourceRevision !== before.confirmedRemoteRevision) {
        return base.saveSyncedOwner(input);
      }
      const canonical = canonicalDocument(payload);
      const targetFingerprint = canonical && await fingerprint(canonical.bytes);
      if (!canonical || !targetFingerprint) return base.saveSyncedOwner(input);

      const migration = freeze({
        schema: MIGRATION_SCHEMA,
        sourceRevision: before.confirmedRemoteRevision,
        targetRevision: before.confirmedRemoteRevision + 1,
        ceiling: preparation.ceiling,
        operations: preparation.operations,
        preservationProjection: preparation.preservationProjection,
        expectedHead: source.head,
        targetFingerprint,
        descriptor: null,
        phase: "captured",
        casMayHaveRun: false,
      });
      const initialPlain = plainState({ sourceRevision: source.sourceRevision, head: source.head }, migration);
      if (!initialPlain || !await persistDurableState(initialPlain)) {
        const result = await base.saveSyncedOwner(input);
        await refreshPrivateOwner();
        return result;
      }
      durable = initialPlain;

      const descriptor = await prepareDescriptor(migration, durable);
      if (descriptor) {
        const preparedMigration = freeze({ ...migration, descriptor, phase: "prepared" });
        const persisted = await persistMigration(durable, preparedMigration);
        if (persisted) durable = persisted;
      }

      const result = await base.saveSyncedOwner(input);
      await refreshPrivateOwner();
      if (result?.ok !== true) return result;
      if (result.confirmedRemoteRevision === migration.targetRevision) {
        durable = await loadDurableState();
        if (durable?.migration) {
          await completeMigration(durable, canonical.bytes, { casAttempted: false });
        }
      }
      return result;
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
})(typeof window !== "undefined" ? window : globalThis);