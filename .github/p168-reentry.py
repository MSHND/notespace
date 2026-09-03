from pathlib import Path


def patch(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one occurrence, got {count}")
    p.write_text(text.replace(old, new, 1))

# ---------------------------------------------------------------------------
# Additional-device/current-content selection: authority is read after key
# unwrap and before any readable current payload is selected.
# ---------------------------------------------------------------------------
patch('js/pocket-sync-additional-device.js',
'''  const FACTORY = ["crypto", "deviceStore", "accountClient", "discoveryService", "contentService", "envelopeService", "randomBytes", "now"];
''',
'''  const FACTORY = ["crypto", "deviceStore", "accountClient", "discoveryService", "contentService", "envelopeService", "randomBytes", "now"];
  const AUTHORITY_FACTORY = ["persistenceAuthorityService", "objectHeadService"];
''', 'additional factory constants')

patch('js/pocket-sync-additional-device.js',
'''    if (!object(value) || Object.keys(value).some((key) => ![...FACTORY, "strandedActivationClassifier"].includes(key))
        || FACTORY.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) return null;
''',
'''    if (!object(value) || Object.keys(value).some((key) => ![...FACTORY, ...AUTHORITY_FACTORY, "strandedActivationClassifier"].includes(key))
        || FACTORY.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) return null;
    const authorityCount = AUTHORITY_FACTORY.filter((key) => Object.prototype.hasOwnProperty.call(value, key)).length;
    if (![0, AUTHORITY_FACTORY.length].includes(authorityCount)) return null;
''', 'additional optional authority pair')

patch('js/pocket-sync-additional-device.js',
'''        || typeof value.randomBytes !== "function" || typeof value.now !== "function"
        || (value.strandedActivationClassifier !== undefined
''',
'''        || typeof value.randomBytes !== "function" || typeof value.now !== "function"
        || (authorityCount === AUTHORITY_FACTORY.length
          && (!object(value.persistenceAuthorityService)
            || typeof value.persistenceAuthorityService.read !== "function"
            || !object(value.objectHeadService)
            || typeof value.objectHeadService.readShadowHead !== "function"
            || typeof value.objectHeadService.getOpaqueObject !== "function"))
        || (value.strandedActivationClassifier !== undefined
''', 'additional authority service validation')

marker = '''  async function completedActivationDraft(config, record) {
'''
p = Path('js/pocket-sync-additional-device.js')
text = p.read_text()
if text.count(marker) != 1:
    raise SystemExit('additional selector marker missing')
selector = r'''  function authorityMode(value) {
    const authority = value?.authority;
    if (!object(authority) || authority.schema !== "pocket.sync.persistence-authority.v1"
        || !Number.isSafeInteger(authority.authorityRevision) || authority.authorityRevision < 1) return null;
    if (authority.currentMode === "whole-record") {
      if (authority.transition !== null || authority.rollbackRevision !== null || authority.adoptionHead !== null) return null;
      return freeze({ mode: "whole-record", authorityRevision: authority.authorityRevision });
    }
    const head = authority.adoptionHead;
    if (authority.currentMode !== "starling" || authority.transition !== null
        || !Number.isSafeInteger(authority.rollbackRevision) || authority.rollbackRevision < 1
        || !object(head) || head.schema !== "pocket.starling.head.v1"
        || !Number.isSafeInteger(head.revision) || head.revision < 1
        || typeof head.sealRef !== "string" || !head.sealRef) return null;
    return freeze({ mode: "starling", authorityRevision: authority.authorityRevision,
      rollbackRevision: authority.rollbackRevision,
      adoptionHead: freeze({ schema: head.schema, revision: head.revision, sealRef: head.sealRef }) });
  }

  async function readAuthority(config, syncedPocketId) {
    if (!config.persistenceAuthorityService) return freeze({ mode: "legacy" });
    const operationId = randomId(config);
    if (!operationId) return null;
    try {
      return authorityMode(await config.persistenceAuthorityService.read({
        apiVersion: 1, operationId, syncedPocketId,
      }));
    } catch (_error) { return null; }
  }

  async function readRollbackContent(config, syncedPocketId, revision) {
    const operationId = randomId(config);
    if (!operationId) return null;
    try {
      const current = await config.contentService.readRevision({ apiVersion: 1, operationId, syncedPocketId });
      if (!current || current.recordPresent !== true || current.revision !== revision) return null;
      const downloadId = randomId(config);
      if (!downloadId) return null;
      const downloaded = await config.contentService.downloadEncryptedRecord({
        apiVersion: 1, operationId: downloadId, syncedPocketId, revision,
      });
      if (!downloaded || downloaded.syncedPocketId !== syncedPocketId || downloaded.revision !== revision) return null;
      return freeze({ content: remoteContent(config, syncedPocketId, revision, downloaded.encryptedRecord), revision });
    } catch (_error) { return null; }
  }

  function starlingPayload(document) {
    if (!object(document) || typeof document.schema !== "string" || !document.schema
        || typeof document.writtenAt !== "string" || !document.writtenAt
        || !Array.isArray(document.nodes) || !Array.isArray(document.tombstones)
        || !object(document.rootExtras) || !object(document.dataExtras)) return null;
    let nodes; let tombstones; let rootExtras; let dataExtras;
    try {
      nodes = JSON.parse(JSON.stringify(document.nodes));
      tombstones = JSON.parse(JSON.stringify(document.tombstones));
      rootExtras = JSON.parse(JSON.stringify(document.rootExtras));
      dataExtras = JSON.parse(JSON.stringify(document.dataExtras));
    } catch (_error) { return null; }
    return {
      ...rootExtras,
      schema: "portal.export.v1",
      exportedAt: document.writtenAt,
      writtenAt: document.writtenAt,
      mainThoughtTree: nodes,
      mainThoughtTreeTombstones: tombstones,
      data: { ...dataExtras, mainThoughtTree: nodes, mainThoughtTreeTombstones: tombstones },
    };
  }

  async function readStarlingCurrent(config, syncedPocketId, masterKey, semanticAuthority,
    dependencies, authority) {
    const remoteOpen = global.PocketStarlingRemoteOpenShadow;
    const materialize = global.PocketStarlingMaterializeShadow;
    if (!semanticAuthority || !remoteOpen || typeof remoteOpen.createRemoteOpener !== "function"
        || !materialize || typeof materialize.materializeAccepted !== "function") return null;
    let opened;
    try {
      opened = await remoteOpen.createRemoteOpener({
        objectHeadService: config.objectHeadService,
        operationIdFactory: () => randomId(config),
      }).openRemote({ masterKey, context: { syncedPocketId }, semanticAuthority });
    } catch (_error) { return null; }
    if (!opened || opened.outcome !== "opened" || !opened.session
        || !object(opened.head) || opened.head.schema !== "pocket.starling.head.v1"
        || !Number.isSafeInteger(opened.head.revision) || opened.head.revision < 1) return null;
    let materialized;
    try { materialized = await materialize.materializeAccepted(opened.session); }
    catch (_error) { return null; }
    const payload = materialized?.ok === true ? starlingPayload(materialized.document) : null;
    if (!payload || dependencies.validatePayload(payload) !== true) return null;
    const rollback = await readRollbackContent(config, syncedPocketId, authority.rollbackRevision);
    if (!rollback) return null;
    return freeze({ kind: "starling", payload, content: rollback.content,
      revision: rollback.revision, head: opened.head, authorityRevision: authority.authorityRevision });
  }

  async function selectCurrent(config, syncedPocketId, masterKey, semanticAuthority, dependencies) {
    const authority = await readAuthority(config, syncedPocketId);
    if (!authority) return null;
    if (authority.mode === "legacy") {
      const current = await readCurrent(config, syncedPocketId, randomId(config), masterKey, dependencies);
      return current ? freeze({ kind: "whole-record", ...current }) : null;
    }
    if (authority.mode === "starling") {
      return readStarlingCurrent(config, syncedPocketId, masterKey, semanticAuthority, dependencies, authority);
    }
    if (authority.mode !== "whole-record") return null;
    const current = await readCurrent(config, syncedPocketId, randomId(config), masterKey, dependencies);
    if (!current) return null;
    const after = await readAuthority(config, syncedPocketId);
    if (!after) return null;
    if (after.mode === "starling") {
      return readStarlingCurrent(config, syncedPocketId, masterKey, semanticAuthority, dependencies, after);
    }
    if (after.mode !== "whole-record" || after.authorityRevision !== authority.authorityRevision) return null;
    return freeze({ kind: "whole-record", ...current });
  }

'''
p.write_text(text.replace(marker, selector + marker, 1))

patch('js/pocket-sync-additional-device.js',
'''  async function adoptOpened(config, dependencies, captured, syncedPocketId, record, masterKey) {
    const latest = await readCurrent(config, syncedPocketId, randomId(config), masterKey, dependencies);
    if (!latest || !sameTarget(dependencies, captured)) return fail("additional-device-target-stale");
    if (latest.revision !== record.remote.confirmedRevision) {
''',
'''  async function adoptOpened(config, dependencies, captured, syncedPocketId, record, masterKey, semanticAuthority = null) {
    const latest = await selectCurrent(config, syncedPocketId, masterKey, semanticAuthority, dependencies);
    if (!latest || !sameTarget(dependencies, captured)) return fail("additional-device-target-stale");
    if (latest.kind === "starling" && latest.revision !== record.remote.confirmedRevision) {
      return fail("additional-device-state-invalid");
    }
    if (latest.kind === "whole-record" && latest.revision !== record.remote.confirmedRevision) {
''', 'existing-device selected current')

patch('js/pocket-sync-additional-device.js',
'''      bundle = await config.crypto.openMasterKeyBundle(record.deviceEnvelope.record,
        record.deviceWrappingKey, record.deviceEnvelope.context, []);
      config.crypto.validateNonExtractableAesKey(bundle?.masterKey);
    } catch (_error) { return fail("additional-device-open-failed"); }
    return adoptOpened(config, dependencies, captured, syncedPocketId, record, bundle.masterKey);
''',
'''      bundle = await config.crypto.openMasterKeyBundle(record.deviceEnvelope.record,
        record.deviceWrappingKey, record.deviceEnvelope.context, [], { semanticAuthority: true });
      config.crypto.validateNonExtractableAesKey(bundle?.masterKey);
    } catch (_error) { return fail("additional-device-open-failed"); }
    return adoptOpened(config, dependencies, captured, syncedPocketId, record,
      bundle.masterKey, bundle.semanticAuthority || null);
''', 'existing-device semantic authority')

patch('js/pocket-sync-additional-device.js',
'''        opened = await config.crypto.openMasterKeyBundle(downloaded.envelope.encryptedEnvelope,
          wrappingKey, context, []);
''',
'''        opened = await config.crypto.openMasterKeyBundle(downloaded.envelope.encryptedEnvelope,
          wrappingKey, context, [], { semanticAuthority: true });
''', 'new-device initial semantic authority')

patch('js/pocket-sync-additional-device.js',
'''      const current = await readCurrent(config, discovery.syncedPocketId, randomId(config), opened.masterKey, dependencies);
      if (!current) return fail("remote-content-invalid");
''',
'''      const current = await selectCurrent(config, discovery.syncedPocketId, opened.masterKey,
        opened.semanticAuthority || null, dependencies);
      if (!current) return fail("remote-content-invalid");
''', 'new-device selected current')

patch('js/pocket-sync-additional-device.js',
'''      const durableBundle = await config.crypto.openMasterKeyBundle(
        finalRecord.deviceEnvelope.record,
        finalRecord.deviceWrappingKey,
        finalRecord.deviceEnvelope.context,
        []
      );
''',
'''      const durableBundle = await config.crypto.openMasterKeyBundle(
        finalRecord.deviceEnvelope.record,
        finalRecord.deviceWrappingKey,
        finalRecord.deviceEnvelope.context,
        [],
        { semanticAuthority: true }
      );
''', 'new-device durable semantic authority')

patch('js/pocket-sync-additional-device.js',
'''      const latest = await readCurrent(config, discovery.syncedPocketId, randomId(config),
        durableBundle.masterKey, dependencies);
      if (!latest || !sameTarget(dependencies, captured)) return fail("additional-device-target-stale");
      if (latest.revision !== current.revision) {
''',
'''      const latest = await selectCurrent(config, discovery.syncedPocketId, durableBundle.masterKey,
        durableBundle.semanticAuthority || null, dependencies);
      if (!latest || !sameTarget(dependencies, captured)) return fail("additional-device-target-stale");
      if (latest.kind === "starling" && latest.revision !== current.revision) {
        return fail("additional-device-state-invalid");
      }
      if (latest.kind === "whole-record" && latest.revision !== current.revision) {
''', 'new-device final selected current')

# ---------------------------------------------------------------------------
# Browser runtime and local integration wire the paired services. Recovery is
# deliberately gated rather than broadened into a second Starling recovery path.
# ---------------------------------------------------------------------------
patch('js/pocket-sync-browser-runtime.js',
'''        || Object.keys(input).some((field) => ![...SERVICE_FIELDS, "discoveryService", "environment"].includes(field))
''',
'''        || Object.keys(input).some((field) => ![...SERVICE_FIELDS, "discoveryService",
          "persistenceAuthorityService", "objectHeadService", "environment"].includes(field))
''', 'runtime optional fields')

patch('js/pocket-sync-browser-runtime.js',
'''    requireMethods(config.recoveryService, ["initialiseRecovery"], "recovery-service-invalid");
''',
'''    requireMethods(config.recoveryService, ["initialiseRecovery"], "recovery-service-invalid");
    const authorityPair = Number(Object.prototype.hasOwnProperty.call(config, "persistenceAuthorityService"))
      + Number(Object.prototype.hasOwnProperty.call(config, "objectHeadService"));
    if (![0, 2].includes(authorityPair)) throw new Error("Pocket Sync browser runtime configuration-invalid.");
    if (authorityPair === 2) {
      requireMethods(config.persistenceAuthorityService, ["read"], "persistence-authority-service-invalid");
      requireMethods(config.objectHeadService, ["readShadowHead", "getOpaqueObject"], "object-head-service-invalid");
    }
''', 'runtime authority pair validation')

patch('js/pocket-sync-browser-runtime.js',
'''        envelopeService: config.envelopeService,
        randomBytes: browserRandom(environment), now,
''',
'''        envelopeService: config.envelopeService,
        ...(authorityPair === 2 ? {
          persistenceAuthorityService: config.persistenceAuthorityService,
          objectHeadService: config.objectHeadService,
        } : {}),
        randomBytes: browserRandom(environment), now,
''', 'runtime pass reentry services')

patch('js/pocket-sync-browser-runtime.js',
'''      const bundle = await crypto.openMasterKeyBundle(
        found.record.deviceEnvelope.record,
        found.record.deviceWrappingKey,
        found.record.deviceEnvelope.context,
        []
      );
      const payload = await crypto.openContent(
''',
'''      const bundle = await crypto.openMasterKeyBundle(
        found.record.deviceEnvelope.record,
        found.record.deviceWrappingKey,
        found.record.deviceEnvelope.context,
        []
      );
      if (authorityPair === 2) {
        let authority = null;
        try {
          const operationId = crypto.encodeBase64Url(browserRandom(environment)(32));
          authority = (await config.persistenceAuthorityService.read({ apiVersion: 1,
            operationId, syncedPocketId: found.record.syncedPocketId }))?.authority || null;
        } catch (_error) { return safeFailure("recovery-authority-attention"); }
        if (!authority || authority.currentMode !== "whole-record" || authority.transition !== null
            || authority.rollbackRevision !== null || authority.adoptionHead !== null) {
          return safeFailure("recovery-starling-authority-attention");
        }
      }
      const payload = await crypto.openContent(
''', 'recovery authority gate before rollback decrypt')

patch('js/pocket-sync-local-integration.js',
'''        || typeof remote.createContentService !== "function"
        || typeof remote.createEnvelopeService !== "function"
''',
'''        || typeof remote.createContentService !== "function"
        || typeof remote.createPersistenceAuthorityService !== "function"
        || typeof remote.createObjectHeadService !== "function"
        || typeof remote.createEnvelopeService !== "function"
''', 'local integration authority foundation')

patch('js/pocket-sync-local-integration.js',
'''      contentService,
      envelopeService: remote.createEnvelopeService({ transport }),
''',
'''      contentService,
      persistenceAuthorityService: remote.createPersistenceAuthorityService({ transport }),
      objectHeadService: remote.createObjectHeadService({ transport }),
      envelopeService: remote.createEnvelopeService({ transport }),
''', 'local integration authority composition')

patch('js/pocket-sync-local-integration.js',
'''        const savedPayload = currentPayload();
        const savedFingerprint = recordFingerprint(savedPayload);
''',
'''        const authorityOperation = operationId();
        if (!authorityOperation) return safeFailure("round-trip-unavailable");
        const authority = await remote.createPersistenceAuthorityService({ transport }).read({
          apiVersion: 1, operationId: authorityOperation, syncedPocketId,
        });
        if (authority?.authority?.currentMode === "starling") {
          return safeFailure("round-trip-starling-authority");
        }
        if (authority?.authority?.currentMode !== "whole-record"
            || authority.authority.transition !== null) return safeFailure("round-trip-not-ready");
        const savedPayload = currentPayload();
        const savedFingerprint = recordFingerprint(savedPayload);
''', 'round-trip authority gate')

# ---------------------------------------------------------------------------
# Same installed controller: after an existing-owner adoption, rebuild private
# Starling v2 state from shared authority/current Head before Save can route.
# ---------------------------------------------------------------------------
p = Path('js/pocket-starling-owner-successor.js')
text = p.read_text()
old = '''    async function adoptSyncedOwner(input) {
      const result = await base.adoptSyncedOwner(input);
      if (result?.ok === true) {
        clearPrivate();
        await capturePrivateOwner();
      }
      return result;
    }
'''
new = '''    async function rebuildStarlingReentry(authority) {
      const current = currentPrivate();
      if (!current || !starlingSteady(authority)
          || current.owner.record.remote?.confirmedRevision !== authority.rollbackRevision
          || current.owner.record.remote?.pending !== null || current.owner.record.remote?.conflict !== null
          || current.owner.record.content?.context?.revision !== authority.rollbackRevision) return false;
      const opened = await freshOpen();
      const materialize = global.PocketStarlingMaterializeShadow;
      const logical = global.PocketStarlingObjectSealShadow;
      if (!opened || opened.outcome !== "opened" || !opened.session || !safeHead(opened.head)
          || !materialize || typeof materialize.materializeAccepted !== "function"
          || !logical || typeof logical.canonical !== "function") return false;
      try {
        const materialized = await materialize.materializeAccepted(opened.session);
        const canonical = materialized?.ok === true && materialized.document
          ? logical.canonical(materialized.document) : null;
        if (!canonical || canonical.ok !== true || typeof canonical.bytes !== "string") return false;
      } catch (_error) { return false; }
      const next = authorityPlainState(authority, null, opened.head, null, null);
      if (!next || !await persistDurableState(next)) return false;
      accepted = { token: current.session.token, generation: current.session.generation,
        sourceRevision: authority.rollbackRevision, head: opened.head, session: opened.session };
      return true;
    }

    async function adoptSyncedOwner(input) {
      const result = await base.adoptSyncedOwner(input);
      if (result?.ok !== true) return result;
      clearPrivate();
      if (!await capturePrivateOwner()) {
        try { base.releaseSyncedOwner(); } catch (_error) {}
        clearPrivate();
        return failure("owner-adoption-state-unavailable");
      }
      if (!options?.persistenceAuthorityService) return result;
      const authority = await readSharedAuthority();
      if (!authority) {
        try { base.releaseSyncedOwner(); } catch (_error) {}
        clearPrivate();
        return failure("authority-state-unavailable");
      }
      if (wholeSteady(authority)) return result;
      if (!starlingSteady(authority) || !await rebuildStarlingReentry(authority)) {
        try { base.releaseSyncedOwner(); } catch (_error) {}
        clearPrivate();
        return failure("starling-reentry-required");
      }
      return result;
    }
'''
if text.count(old) != 1:
    raise SystemExit(f'owner adopt reentry: expected one occurrence, got {text.count(old)}')
p.write_text(text.replace(old, new, 1))

print('P168 authority-aware reopen/recovery construction applied')
