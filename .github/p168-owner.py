from pathlib import Path
import re

path = Path('js/pocket-starling-owner-successor.js')
text = path.read_text()

def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one occurrence, got {count}')
    text = text.replace(old, new, 1)

# P168 private-state contracts sit inside the existing encrypted owner-state envelope.
replace_once(
'''  const STATE_SCHEMA = "pocket.starling.owner-mirror-state.v1";
  const MIGRATION_SCHEMA = "pocket.starling.owner-migration.v1";
  const HEAD_SCHEMA = "pocket.starling.head.v1";
''',
'''  const STATE_SCHEMA = "pocket.starling.owner-mirror-state.v1";
  const AUTHORITY_STATE_SCHEMA = "pocket.starling.owner-authority-state.v2";
  const SWITCH_SCHEMA = "pocket.starling.authority-switch.v1";
  const SAVE_SCHEMA = "pocket.starling.authoritative-save.v1";
  const MIGRATION_SCHEMA = "pocket.starling.owner-migration.v1";
  const HEAD_SCHEMA = "pocket.starling.head.v1";
  const SWITCH_PHASES = Object.freeze(["prepared", "fenced", "commit-ambiguous"]);
  const SAVE_PHASES = Object.freeze(["captured", "prepared", "objects-present", "cas-ambiguous", "conflict"]);
''', 'state constants')

# Production default composition gains the narrow P166/P168 authority service.
replace_once(
'''    if (!serviceRoot || !remote || typeof remote.createBrowserJsonTransport !== "function"
        || typeof remote.createObjectHeadService !== "function"
        || typeof global.normaliseInput !== "function"
''',
'''    if (!serviceRoot || !remote || typeof remote.createBrowserJsonTransport !== "function"
        || typeof remote.createObjectHeadService !== "function"
        || typeof remote.createPersistenceAuthorityService !== "function"
        || typeof global.normaliseInput !== "function"
''', 'default remote requirements')
replace_once(
'''      return Object.freeze({
        objectHeadService: remote.createObjectHeadService({ transport }),
        operationIdFactory: randomOperationId,
''',
'''      return Object.freeze({
        objectHeadService: remote.createObjectHeadService({ transport }),
        persistenceAuthorityService: remote.createPersistenceAuthorityService({ transport }),
        operationIdFactory: randomOperationId,
''', 'default remote authority service')

# Explicit P164 test/bootstrap injections remain valid; P168 stays dormant unless the authority service is present.
replace_once(
'''    return Object.freeze({
      objectHeadService: bootstrap.objectHeadService,
      operationIdFactory: bootstrap.operationIdFactory,
      normaliseInput: bootstrap.normaliseInput,
      normaliseRootExtras: bootstrap.normaliseRootExtras,
      ownerStateStore,
    });
''',
'''    const persistenceAuthorityService = isObject(bootstrap.persistenceAuthorityService)
      && ["read", "acquireFence", "commitStarlingAdoption", "releaseFence"]
        .every((name) => typeof bootstrap.persistenceAuthorityService[name] === "function")
      ? bootstrap.persistenceAuthorityService : null;
    return Object.freeze({
      objectHeadService: bootstrap.objectHeadService,
      persistenceAuthorityService,
      operationIdFactory: bootstrap.operationIdFactory,
      normaliseInput: bootstrap.normaliseInput,
      normaliseRootExtras: bootstrap.normaliseRootExtras,
      ownerStateStore,
    });
''', 'checked authority options')

# Keep the accepted P164 plaintext validator verbatim as the v1 branch.
replace_once('  function validatePlainState(value, ownerRecord) {',
             '  function validateMirrorPlainState(value, ownerRecord) {', 'rename v1 validator')

marker = '''  function createSyncedOwnerController(configuration) {
'''
if text.count(marker) != 1:
    raise SystemExit('controller marker missing')
validators = r'''  function validateAuthoritySnapshot(value) {
    if (!exact(value, ["schema", "authorityRevision", "currentMode", "transition",
      "rollbackRevision", "adoptionHead"])
        || value.schema !== "pocket.sync.persistence-authority.v1"
        || !Number.isSafeInteger(value.authorityRevision) || value.authorityRevision < 1
        || !["whole-record", "starling"].includes(value.currentMode)) return null;
    let transition = null;
    let rollbackRevision = null;
    let adoptionHead = null;
    if (value.currentMode === "whole-record") {
      if (value.rollbackRevision !== null || value.adoptionHead !== null) return null;
      if (value.transition !== null) {
        if (!exact(value.transition, ["transitionId", "expectedAuthorityRevision"])
            || typeof value.transition.transitionId !== "string" || !value.transition.transitionId
            || value.transition.transitionId !== value.transition.transitionId.trim()
            || !Number.isSafeInteger(value.transition.expectedAuthorityRevision)
            || value.transition.expectedAuthorityRevision < 1
            || value.transition.expectedAuthorityRevision >= Number.MAX_SAFE_INTEGER
            || value.transition.expectedAuthorityRevision + 1 !== value.authorityRevision) return null;
        transition = freeze(value.transition);
      }
    } else {
      const head = safeHead(value.adoptionHead);
      if (value.transition !== null || !Number.isSafeInteger(value.rollbackRevision)
          || value.rollbackRevision < 1 || !head || head.revision < 1) return null;
      rollbackRevision = value.rollbackRevision;
      adoptionHead = head;
    }
    return freeze({ schema: value.schema, authorityRevision: value.authorityRevision,
      currentMode: value.currentMode, transition, rollbackRevision, adoptionHead });
  }

  function validateSwitchWitness(value) {
    if (value === null) return null;
    if (!exact(value, ["schema", "transitionId", "sourceAuthorityRevision", "fencedAuthorityRevision",
      "rollbackRevision", "adoptionHead", "phase", "commitMayHaveRun"])
        || value.schema !== SWITCH_SCHEMA || typeof value.transitionId !== "string"
        || !value.transitionId || value.transitionId !== value.transitionId.trim()
        || !Number.isSafeInteger(value.sourceAuthorityRevision) || value.sourceAuthorityRevision < 1
        || !Number.isSafeInteger(value.rollbackRevision) || value.rollbackRevision < 1
        || !SWITCH_PHASES.includes(value.phase) || typeof value.commitMayHaveRun !== "boolean") return null;
    const adoptionHead = safeHead(value.adoptionHead);
    if (!adoptionHead || adoptionHead.revision < 1) return null;
    if (value.phase === "prepared") {
      if (value.fencedAuthorityRevision !== null || value.commitMayHaveRun) return null;
    } else if (!Number.isSafeInteger(value.fencedAuthorityRevision)
        || value.fencedAuthorityRevision !== value.sourceAuthorityRevision + 1) return null;
    if (value.phase === "commit-ambiguous" && value.commitMayHaveRun !== true) return null;
    return freeze({ ...clone(value), adoptionHead });
  }

  function validateSaveWitness(value) {
    if (value === null) return null;
    if (!exact(value, ["schema", "authorityRevision", "expectedHead", "ceiling", "operations",
      "preservationProjection", "targetFingerprint", "descriptor", "phase", "casMayHaveRun"])
        || value.schema !== SAVE_SCHEMA
        || !Number.isSafeInteger(value.authorityRevision) || value.authorityRevision < 1
        || !Number.isSafeInteger(value.ceiling) || value.ceiling < 1
        || !Array.isArray(value.operations) || !isObject(value.preservationProjection)
        || typeof value.targetFingerprint !== "string"
        || !/^sha256:[A-Za-z0-9_-]{43}$/.test(value.targetFingerprint)
        || !SAVE_PHASES.includes(value.phase) || typeof value.casMayHaveRun !== "boolean") return null;
    const expectedHead = safeHead(value.expectedHead);
    if (!expectedHead || expectedHead.revision < 1) return null;
    let descriptor = null;
    if (value.descriptor !== null) {
      try { descriptor = global.PocketStarlingDurablePublication?.validateDescriptor?.(value.descriptor); }
      catch (_error) { return null; }
      if (!descriptor || !sameHead(descriptor.expectedHead, expectedHead)) return null;
    }
    if (value.phase !== "captured" && !descriptor) return null;
    if (value.phase === "cas-ambiguous" && !value.casMayHaveRun) return null;
    return freeze({ schema: SAVE_SCHEMA, authorityRevision: value.authorityRevision, expectedHead,
      ceiling: value.ceiling, operations: clone(value.operations),
      preservationProjection: clone(value.preservationProjection), targetFingerprint: value.targetFingerprint,
      descriptor, phase: value.phase, casMayHaveRun: value.casMayHaveRun });
  }

  function validateAuthorityPlainState(value, ownerRecord) {
    if (!exact(value, ["schema", "owner", "authority", "legacyMirror", "acceptedHead",
      "switchWitness", "saveWitness"])
        || value.schema !== AUTHORITY_STATE_SCHEMA || !exact(value.owner, [
          "syncedPocketId", "deviceId", "masterKeyGeneration",
        ]) || value.owner.syncedPocketId !== ownerRecord.syncedPocketId
        || value.owner.deviceId !== ownerRecord.deviceId
        || value.owner.masterKeyGeneration !== ownerRecord.usage?.masterKeyGeneration) return null;
    const authority = validateAuthoritySnapshot(value.authority);
    const acceptedHead = safeHead(value.acceptedHead);
    const switchWitness = validateSwitchWitness(value.switchWitness);
    const saveWitness = validateSaveWitness(value.saveWitness);
    if (!authority || !acceptedHead || acceptedHead.revision < 1
        || (value.switchWitness !== null && !switchWitness)
        || (value.saveWitness !== null && !saveWitness)) return null;
    let legacyMirror = null;
    if (value.legacyMirror !== null) {
      legacyMirror = validateAccepted(value.legacyMirror);
      if (!legacyMirror || !sameHead(legacyMirror.head, acceptedHead)) return null;
    }
    if (authority.currentMode === "whole-record") {
      if (!legacyMirror || saveWitness !== null
          || legacyMirror.sourceRevision !== ownerRecord.remote?.confirmedRevision) return null;
      if (authority.transition === null) {
        if (switchWitness && switchWitness.phase !== "prepared") return null;
      } else {
        if (!switchWitness || switchWitness.transitionId !== authority.transition.transitionId
            || switchWitness.fencedAuthorityRevision !== authority.authorityRevision) return null;
      }
      if (switchWitness && (switchWitness.rollbackRevision !== legacyMirror.sourceRevision
          || !sameHead(switchWitness.adoptionHead, legacyMirror.head))) return null;
    } else {
      if (legacyMirror !== null || authority.transition !== null
          || authority.rollbackRevision !== ownerRecord.remote?.confirmedRevision
          || (switchWitness && (switchWitness.rollbackRevision !== authority.rollbackRevision
            || !sameHead(switchWitness.adoptionHead, authority.adoptionHead)))) return null;
      if (saveWitness && (saveWitness.authorityRevision !== authority.authorityRevision
          || !sameHead(saveWitness.expectedHead, acceptedHead))) return null;
    }
    return freeze({ schema: AUTHORITY_STATE_SCHEMA,
      owner: { syncedPocketId: ownerRecord.syncedPocketId, deviceId: ownerRecord.deviceId,
        masterKeyGeneration: ownerRecord.usage.masterKeyGeneration },
      authority, legacyMirror, acceptedHead, switchWitness, saveWitness });
  }

  function validatePlainState(value, ownerRecord) {
    if (value?.schema === STATE_SCHEMA) return validateMirrorPlainState(value, ownerRecord);
    if (value?.schema === AUTHORITY_STATE_SCHEMA) return validateAuthorityPlainState(value, ownerRecord);
    return null;
  }

'''
text = text.replace(marker, validators + marker, 1)

# Private operation gate and operation-id stream are inside the same controller.
replace_once(
'''    let privateOwner = null;
    let accepted = null;
    let stateStoreOpened = false;
''',
'''    let privateOwner = null;
    let accepted = null;
    let stateStoreOpened = false;
    let authorityOperationOrdinal = 0;
    let ownerOperationTail = Promise.resolve();
''', 'controller private gate vars')

# Add v2 state constructor directly after the existing v1 constructor.
needle = '''    function canonicalDocument(payload) {
'''
if text.count(needle) != 1:
    raise SystemExit('canonicalDocument marker missing')
v2constructor = r'''    function authorityPlainState(authorityInput, legacyMirrorInput, acceptedHeadInput,
      switchWitnessInput = null, saveWitnessInput = null) {
      const current = currentPrivate();
      const authority = validateAuthoritySnapshot(authorityInput);
      const acceptedHead = safeHead(acceptedHeadInput);
      if (!current || !authority || !acceptedHead) return null;
      const candidate = {
        schema: AUTHORITY_STATE_SCHEMA,
        owner: ownerBinding(current.owner.record),
        authority,
        legacyMirror: legacyMirrorInput === null ? null : validateAccepted(legacyMirrorInput),
        acceptedHead,
        switchWitness: switchWitnessInput,
        saveWitness: saveWitnessInput,
      };
      return validateAuthorityPlainState(candidate, current.owner.record);
    }

    function nextOperationId(kind) {
      if (!options) return null;
      try {
        const value = options.operationIdFactory(`p168-${kind}`, authorityOperationOrdinal++);
        return typeof value === "string" && value.length > 0 && value.length <= 160
          && value === value.trim() ? value : null;
      } catch (_error) { return null; }
    }

    function freezeOnceInput(input) {
      if (!input || typeof input.freezePayload !== "function") return null;
      let frozenPromise = null;
      return Object.freeze({
        freezePayload() {
          if (frozenPromise === null) frozenPromise = Promise.resolve().then(() => input.freezePayload());
          return frozenPromise;
        },
      });
    }

    function serialiseOwnerOperation(callback) {
      const run = () => Promise.resolve().then(callback);
      const result = ownerOperationTail.then(run, run);
      ownerOperationTail = result.then(() => undefined, () => undefined);
      return result;
    }

    function wholeSteady(authority) {
      return authority?.currentMode === "whole-record" && authority.transition === null;
    }

    function starlingSteady(authority) {
      return authority?.currentMode === "starling" && authority.transition === null
        && Number.isSafeInteger(authority.rollbackRevision) && authority.rollbackRevision >= 1
        && !!safeHead(authority.adoptionHead);
    }

    async function readSharedAuthority() {
      const current = currentPrivate();
      const operationId = nextOperationId("authority-read");
      if (!current || !options?.persistenceAuthorityService || !operationId) return null;
      try {
        const result = await options.persistenceAuthorityService.read({
          apiVersion: 1, operationId, syncedPocketId: current.owner.syncedPocketId,
        });
        return validateAuthoritySnapshot(result?.authority);
      } catch (_error) { return null; }
    }

'''
text = text.replace(needle, v2constructor + needle, 1)

# Insert P168 authority transition / Starling Save engine before bootstrap helper.
needle = '''    async function bootstrapInitialStarlingBase() {
'''
if text.count(needle) != 1:
    raise SystemExit('bootstrap marker missing')
engine = r'''    async function rollbackProof(revision, expectedHead) {
      const current = currentPrivate();
      const state = base.getSyncedOwnerState();
      if (!current || !state || state.pending !== false
          || state.confirmedRemoteRevision !== revision || state.knownRemoteRevision !== revision
          || current.owner.record.remote?.confirmedRevision !== revision
          || current.owner.record.remote?.pending !== null || current.owner.record.remote?.conflict !== null
          || current.owner.record.content?.context?.revision !== revision) return null;
      let payload;
      try {
        payload = await split.base.crypto.openContent(current.owner.record.content.record,
          current.owner.masterKey, current.owner.record.content.context);
      } catch (_error) { return null; }
      const canonical = canonicalDocument(payload);
      const targetFingerprint = canonical && await fingerprint(canonical.bytes);
      if (!canonical || !targetFingerprint) return null;
      const opened = await freshOpen();
      if (!opened || opened.outcome !== "opened" || !sameHead(opened.head, expectedHead)
          || !await proveOpened(opened, expectedHead, targetFingerprint, canonical.bytes)) return null;
      return Object.freeze({ payload, canonical, targetFingerprint, opened });
    }

    async function persistMirrorFromAuthority(durable) {
      if (!durable || durable.schema !== AUTHORITY_STATE_SCHEMA || !durable.legacyMirror) return false;
      const plain = plainState(durable.legacyMirror, null);
      return !!plain && persistDurableState(plain);
    }

    async function releaseOwnFence(durable, authority) {
      if (!durable || durable.schema !== AUTHORITY_STATE_SCHEMA || !durable.switchWitness
          || authority?.currentMode !== "whole-record" || authority.transition === null
          || authority.transition.transitionId !== durable.switchWitness.transitionId) return false;
      const operationId = nextOperationId("authority-release");
      if (!operationId) return false;
      try {
        const result = await options.persistenceAuthorityService.releaseFence({
          apiVersion: 1, operationId, syncedPocketId: durable.owner.syncedPocketId,
          expectedAuthorityRevision: authority.authorityRevision,
          transitionId: durable.switchWitness.transitionId,
        });
        const released = validateAuthoritySnapshot(result?.authority);
        if (!result?.ok || !released || !wholeSteady(released)) return false;
        return persistMirrorFromAuthority(durable);
      } catch (_error) {
        const observed = await readSharedAuthority();
        return !!observed && wholeSteady(observed) && persistMirrorFromAuthority(durable);
      }
    }

    async function reconcileSwitchState(durable, authority) {
      if (!durable || durable.schema !== AUTHORITY_STATE_SCHEMA || !durable.switchWitness) return null;
      const witness = durable.switchWitness;
      if (starlingSteady(authority)
          && authority.rollbackRevision === witness.rollbackRevision
          && sameHead(authority.adoptionHead, witness.adoptionHead)) {
        const opened = await freshOpen();
        if (!opened || opened.outcome !== "opened" || !opened.session || !safeHead(opened.head)) {
          return failure("authority-switch-local-confirmation-unsettled");
        }
        const next = authorityPlainState(authority, null, opened.head, null, null);
        if (!next || !await persistDurableState(next)) {
          return failure("authority-switch-local-confirmation-unsettled");
        }
        const current = currentPrivate();
        if (current) accepted = { token: current.session.token, generation: current.session.generation,
          sourceRevision: authority.rollbackRevision, head: opened.head, session: opened.session };
        return failure("authority-switch-reentry-confirmed");
      }
      if (authority?.currentMode === "whole-record" && authority.transition !== null
          && authority.transition.transitionId === witness.transitionId) {
        await releaseOwnFence(durable, authority);
        return failure("authority-switch-unsettled");
      }
      if (wholeSteady(authority) && witness.phase === "prepared") {
        if (!await persistMirrorFromAuthority(durable)) return failure("authority-switch-unsettled");
        return Object.freeze({ ok: true, reason: "authority-switch-not-started" });
      }
      return failure("authority-transition-conflict");
    }

    async function attemptAuthorityAdoption(payload, preparation, authority, durable) {
      const current = currentPrivate();
      const state = base.getSyncedOwnerState();
      if (!current || !state || !wholeSteady(authority) || durable?.migration
          || state.pending !== false || state.confirmedRemoteRevision !== state.knownRemoteRevision
          || current.owner.record.remote?.pending !== null || current.owner.record.remote?.conflict !== null
          || current.owner.record.remote?.confirmedRevision !== state.confirmedRemoteRevision
          || current.owner.record.content?.context?.revision !== state.confirmedRemoteRevision) {
        return Object.freeze({ kind: "ineligible" });
      }
      const sourceRevision = state.confirmedRemoteRevision;
      const source = await ensureAccepted(sourceRevision,
        durable?.schema === STATE_SCHEMA ? durable : null);
      if (!source || source.sourceRevision !== sourceRevision || !safeHead(source.head)
          || source.head.revision < 1) return Object.freeze({ kind: "ineligible" });
      const preProof = await rollbackProof(sourceRevision, source.head);
      if (!preProof) return Object.freeze({ kind: "ineligible" });
      const transitionId = nextOperationId("authority-transition");
      if (!transitionId) return Object.freeze({ kind: "unsettled", reason: "authority-switch-unsettled" });
      const witnessPrepared = freeze({ schema: SWITCH_SCHEMA, transitionId,
        sourceAuthorityRevision: authority.authorityRevision, fencedAuthorityRevision: null,
        rollbackRevision: sourceRevision, adoptionHead: source.head,
        phase: "prepared", commitMayHaveRun: false });
      let local = authorityPlainState(authority,
        { sourceRevision, head: source.head }, source.head, witnessPrepared, null);
      if (!local || !await persistDurableState(local)) {
        return Object.freeze({ kind: "ineligible" });
      }

      const acquireId = nextOperationId("authority-acquire");
      if (!acquireId) return Object.freeze({ kind: "unsettled", reason: "authority-switch-unsettled" });
      let acquired;
      try {
        acquired = await options.persistenceAuthorityService.acquireFence({
          apiVersion: 1, operationId: acquireId, syncedPocketId: current.owner.syncedPocketId,
          expectedAuthorityRevision: authority.authorityRevision, transitionId,
        });
      } catch (_error) {
        const observed = await readSharedAuthority();
        if (observed && wholeSteady(observed)) {
          await persistMirrorFromAuthority(local);
          return Object.freeze({ kind: "ineligible" });
        }
        return Object.freeze({ kind: "unsettled", reason: "authority-transition-conflict" });
      }
      const fenced = validateAuthoritySnapshot(acquired?.authority);
      if (!acquired?.ok || !fenced || fenced.currentMode !== "whole-record"
          || fenced.authorityRevision !== authority.authorityRevision + 1
          || fenced.transition?.transitionId !== transitionId) {
        const observed = await readSharedAuthority();
        if (observed && wholeSteady(observed)) {
          await persistMirrorFromAuthority(local);
          return Object.freeze({ kind: "ineligible" });
        }
        return Object.freeze({ kind: "unsettled", reason: "authority-transition-conflict" });
      }
      let witness = freeze({ ...witnessPrepared, fencedAuthorityRevision: fenced.authorityRevision,
        phase: "fenced" });
      local = authorityPlainState(fenced, { sourceRevision, head: source.head }, source.head, witness, null);
      if (!local || !await persistDurableState(local)) {
        return Object.freeze({ kind: "unsettled", reason: "authority-switch-local-confirmation-unsettled" });
      }

      if (!await refreshPrivateOwner()) {
        return Object.freeze({ kind: "unsettled", reason: "authority-switch-unsettled" });
      }
      const revisionId = nextOperationId("rollback-revision-read");
      let remoteRevision = null;
      try {
        remoteRevision = revisionId && await split.base.contentService.readRevision({
          apiVersion: 1, operationId: revisionId, syncedPocketId: current.owner.syncedPocketId,
        });
      } catch (_error) {}
      const finalProof = remoteRevision?.recordPresent === true && remoteRevision.revision === sourceRevision
        ? await rollbackProof(sourceRevision, source.head) : null;
      if (!finalProof || !base.isSyncedOwnerSaveSessionCurrent(current.session)) {
        await releaseOwnFence(local, fenced);
        return Object.freeze({ kind: "unsettled", reason: "authority-transition-conflict" });
      }
      accepted = { token: current.session.token, generation: current.session.generation,
        sourceRevision, head: source.head, session: finalProof.opened.session };

      witness = freeze({ ...witness, phase: "commit-ambiguous", commitMayHaveRun: true });
      local = authorityPlainState(fenced, { sourceRevision, head: source.head }, source.head, witness, null);
      if (!local || !await persistDurableState(local)) {
        return Object.freeze({ kind: "unsettled", reason: "authority-switch-local-confirmation-unsettled" });
      }
      const commitId = nextOperationId("authority-adopt");
      if (!commitId) return Object.freeze({ kind: "unsettled", reason: "authority-switch-unsettled" });
      let committed = null;
      try {
        const result = await options.persistenceAuthorityService.commitStarlingAdoption({
          apiVersion: 1, operationId: commitId, syncedPocketId: current.owner.syncedPocketId,
          expectedAuthorityRevision: fenced.authorityRevision, transitionId,
          rollbackRevision: sourceRevision, adoptionHead: source.head,
        });
        if (result?.ok === true) committed = validateAuthoritySnapshot(result.authority);
      } catch (_error) {}
      if (!committed) {
        const observed = await readSharedAuthority();
        if (observed && starlingSteady(observed)
            && observed.authorityRevision === fenced.authorityRevision + 1
            && observed.rollbackRevision === sourceRevision
            && sameHead(observed.adoptionHead, source.head)) committed = observed;
        else if (observed && observed.currentMode === "whole-record"
            && observed.authorityRevision === fenced.authorityRevision
            && observed.transition?.transitionId === transitionId) {
          await releaseOwnFence(local, observed);
          return Object.freeze({ kind: "unsettled", reason: "authority-switch-unsettled" });
        } else return Object.freeze({ kind: "unsettled", reason: "authority-transition-conflict" });
      }
      if (!starlingSteady(committed) || committed.authorityRevision !== fenced.authorityRevision + 1
          || committed.rollbackRevision !== sourceRevision || !sameHead(committed.adoptionHead, source.head)) {
        return Object.freeze({ kind: "unsettled", reason: "authority-transition-conflict" });
      }
      const finalLocal = authorityPlainState(committed, null, source.head, null, null);
      if (!finalLocal || !await persistDurableState(finalLocal)) {
        return Object.freeze({ kind: "unsettled", reason: "authority-switch-local-confirmation-unsettled" });
      }
      return Object.freeze({ kind: "adopted", authority: committed,
        durable: finalLocal, payload, preparation });
    }

    async function ensureStarlingAccepted(durable, authority) {
      const current = currentPrivate();
      if (!current || !durable || durable.schema !== AUTHORITY_STATE_SCHEMA
          || durable.switchWitness !== null || !starlingSteady(authority)
          || durable.authority.currentMode !== "starling"
          || durable.authority.authorityRevision !== authority.authorityRevision
          || durable.authority.rollbackRevision !== authority.rollbackRevision
          || !sameHead(durable.authority.adoptionHead, authority.adoptionHead)) return null;
      const opened = await freshOpen();
      if (!opened || opened.outcome !== "opened" || !opened.session
          || !sameHead(opened.head, durable.acceptedHead)) return null;
      accepted = { token: current.session.token, generation: current.session.generation,
        sourceRevision: authority.rollbackRevision, head: opened.head, session: opened.session };
      return accepted;
    }

    async function prepareAuthoritativeDescriptor(witness, durable, authority) {
      const current = currentPrivate();
      const remoteEdit = global.PocketStarlingRemoteEditShadow;
      const publication = global.PocketStarlingDurablePublication;
      const source = await ensureStarlingAccepted(durable, authority);
      if (!current || !source || !sameHead(source.head, witness.expectedHead)
          || !remoteEdit || typeof remoteEdit.createEditor !== "function"
          || !publication || typeof publication.descriptorFromPrepared !== "function") return null;
      try {
        const editor = await remoteEdit.createEditor({
          opened: { outcome: "opened", head: source.head, session: source.session },
          masterKey: current.owner.masterKey,
          context: { syncedPocketId: current.owner.syncedPocketId },
          semanticAuthority: current.owner.semanticAuthority,
        });
        const prepared = await editor.prepareWorkingSet(clone(witness.operations),
          clone(witness.preservationProjection));
        if (!prepared || prepared.outcome !== "prepared") return null;
        const descriptor = publication.descriptorFromPrepared(prepared);
        return descriptor && sameHead(descriptor.expectedHead, witness.expectedHead) ? descriptor : null;
      } catch (_error) { return null; }
    }

    async function persistAuthoritativeWitness(durable, witness) {
      const next = authorityPlainState(durable.authority, null, durable.acceptedHead,
        null, witness);
      return next && await persistDurableState(next) ? next : null;
    }

    async function proveAndAcceptAuthoritative(durable, witness, expectedBytes = null) {
      if (!witness.descriptor) return false;
      const candidateHead = safeHead({ schema: HEAD_SCHEMA,
        revision: witness.expectedHead.revision + 1,
        sealRef: witness.descriptor.candidateSealStorageRef });
      if (!candidateHead) return false;
      const opened = await freshOpen();
      if (!await proveOpened(opened, candidateHead, witness.targetFingerprint, expectedBytes)) return false;
      const next = authorityPlainState(durable.authority, null, candidateHead, null, null);
      if (!next || !await persistDurableState(next)) return false;
      const current = currentPrivate();
      if (current) accepted = { token: current.session.token, generation: current.session.generation,
        sourceRevision: durable.authority.rollbackRevision, head: candidateHead, session: opened.session };
      return true;
    }

    async function completeAuthoritativeSave(durableInput, expectedBytes = null,
      callState = { casAttempted: false }) {
      let durable = durableInput;
      let witness = durable?.saveWitness;
      const current = currentPrivate();
      if (!current || !witness || !starlingSteady(durable.authority)) return false;
      if (!witness.descriptor) {
        const descriptor = await prepareAuthoritativeDescriptor(witness, durable, durable.authority);
        if (!descriptor) return false;
        witness = freeze({ ...witness, descriptor, phase: "prepared", casMayHaveRun: false });
        durable = await persistAuthoritativeWitness(durable, witness);
        if (!durable) return false;
      }
      const coordinator = global.PocketStarlingDurablePublication?.createCoordinator?.({
        objectHeadService: options.objectHeadService, operationIdFactory: options.operationIdFactory,
      });
      if (!coordinator) return false;
      if (witness.casMayHaveRun) {
        let reconciled;
        try { reconciled = await coordinator.reconcile({ descriptor: witness.descriptor,
          masterKey: current.owner.masterKey, context: { syncedPocketId: current.owner.syncedPocketId } }); }
        catch (_error) { return false; }
        const outcomes = global.PocketStarlingHeadShadow?.OUTCOME;
        if (!outcomes) return false;
        if (reconciled.outcome === outcomes.COMMITTED) {
          return proveAndAcceptAuthoritative(durable, witness, expectedBytes);
        }
        if ([outcomes.CONFLICT, outcomes.COMMITTED_AND_SUPERSEDED].includes(reconciled.outcome)) {
          await persistAuthoritativeWitness(durable,
            freeze({ ...witness, phase: "conflict", casMayHaveRun: true }));
          return false;
        }
        if (reconciled.outcome !== outcomes.NOT_COMMITTED) return false;
        witness = freeze({ ...witness, phase: "objects-present", casMayHaveRun: false });
        durable = await persistAuthoritativeWitness(durable, witness);
        if (!durable || callState.casAttempted) return false;
      }
      try { await coordinator.ensureObjects(witness.descriptor); }
      catch (_error) { return false; }
      if (witness.phase !== "objects-present") {
        witness = freeze({ ...witness, phase: "objects-present", casMayHaveRun: false });
        durable = await persistAuthoritativeWitness(durable, witness);
        if (!durable) return false;
      }
      if (callState.casAttempted) return false;
      witness = freeze({ ...witness, phase: "cas-ambiguous", casMayHaveRun: true });
      durable = await persistAuthoritativeWitness(durable, witness);
      if (!durable) return false;
      callState.casAttempted = true;
      let headResult;
      try { headResult = await coordinator.attemptHead(witness.descriptor, witness.authorityRevision); }
      catch (_error) {
        try {
          const reconciled = await coordinator.reconcile({ descriptor: witness.descriptor,
            masterKey: current.owner.masterKey, context: { syncedPocketId: current.owner.syncedPocketId } });
          if (reconciled.outcome === global.PocketStarlingHeadShadow.OUTCOME.COMMITTED) {
            return proveAndAcceptAuthoritative(durable, witness, expectedBytes);
          }
          if ([global.PocketStarlingHeadShadow.OUTCOME.CONFLICT,
            global.PocketStarlingHeadShadow.OUTCOME.COMMITTED_AND_SUPERSEDED].includes(reconciled.outcome)) {
            await persistAuthoritativeWitness(durable,
              freeze({ ...witness, phase: "conflict", casMayHaveRun: true }));
          }
        } catch (_reconcileError) {}
        return false;
      }
      if (headResult.outcome === "committed") {
        return proveAndAcceptAuthoritative(durable, witness, expectedBytes);
      }
      if (headResult.outcome === "conflict") {
        await persistAuthoritativeWitness(durable,
          freeze({ ...witness, phase: "conflict", casMayHaveRun: true }));
        return false;
      }
      if (headResult.outcome === "not-committed") {
        await persistAuthoritativeWitness(durable,
          freeze({ ...witness, phase: "objects-present", casMayHaveRun: false }));
      }
      return false;
    }

    async function savePreparedStarling(payload, preparation, authority, durable) {
      const source = await ensureStarlingAccepted(durable, authority);
      if (!source || !sameHead(source.head, durable.acceptedHead)) {
        return failure("starling-reentry-required");
      }
      const canonical = canonicalDocument(payload);
      const targetFingerprint = canonical && await fingerprint(canonical.bytes);
      if (!canonical || !targetFingerprint) return failure("starling-save-preparation-invalid");
      let witness = freeze({ schema: SAVE_SCHEMA, authorityRevision: authority.authorityRevision,
        expectedHead: source.head, ceiling: preparation.ceiling, operations: preparation.operations,
        preservationProjection: preparation.preservationProjection, targetFingerprint,
        descriptor: null, phase: "captured", casMayHaveRun: false });
      let local = authorityPlainState(authority, null, source.head, null, witness);
      if (!local || !await persistDurableState(local)) {
        return failure("starling-save-local-confirmation-unsettled");
      }
      const descriptor = await prepareAuthoritativeDescriptor(witness, local, authority);
      if (!descriptor) return failure("starling-save-unsettled");
      witness = freeze({ ...witness, descriptor, phase: "prepared" });
      local = await persistAuthoritativeWitness(local, witness);
      if (!local) return failure("starling-save-local-confirmation-unsettled");
      const committed = await completeAuthoritativeSave(local, canonical.bytes, { casAttempted: false });
      return committed ? Object.freeze({ ok: true }) : failure("starling-save-unsettled");
    }

    async function dispatchAuthoritySave(input) {
      if (!await refreshPrivateOwner()) return failure("authority-owner-state-unavailable");
      let authority = await readSharedAuthority();
      if (!authority) return failure("authority-state-unavailable");
      let durable = await loadDurableState();
      const once = freezeOnceInput(input);
      if (!once) return failure("save-input-invalid");

      if (wholeSteady(authority)) {
        if (durable?.schema === AUTHORITY_STATE_SCHEMA && durable.switchWitness) {
          const reconciled = await reconcileSwitchState(durable, authority);
          if (!reconciled?.ok) return reconciled || failure("authority-switch-unsettled");
          durable = await loadDurableState();
        }
        if (durable?.schema === STATE_SCHEMA && durable.migration) {
          return saveWholeRecordWithMirror(once);
        }
        let payload;
        try { payload = await once.freezePayload(); }
        catch (_error) { return saveWholeRecordWithMirror(once); }
        const preparation = resolvePreparation(payload);
        if (!preparation) return saveWholeRecordWithMirror(once);
        const adoption = await attemptAuthorityAdoption(payload, preparation, authority, durable);
        if (adoption.kind === "ineligible") return saveWholeRecordWithMirror(once);
        if (adoption.kind !== "adopted") return failure(adoption.reason || "authority-switch-unsettled");
        return savePreparedStarling(payload, preparation, adoption.authority, adoption.durable);
      }

      if (authority.currentMode === "whole-record") {
        if (durable?.schema === AUTHORITY_STATE_SCHEMA && durable.switchWitness) {
          return (await reconcileSwitchState(durable, authority)) || failure("authority-switch-unsettled");
        }
        return failure("authority-transition-conflict");
      }

      if (!starlingSteady(authority)) return failure("authority-state-invalid");
      if (durable?.schema === AUTHORITY_STATE_SCHEMA && durable.switchWitness) {
        return (await reconcileSwitchState(durable, authority)) || failure("authority-switch-unsettled");
      }
      if (!durable || durable.schema !== AUTHORITY_STATE_SCHEMA) {
        return failure("starling-reentry-required");
      }
      if (durable.saveWitness) {
        const confirmed = await completeAuthoritativeSave(durable, null, { casAttempted: false });
        return confirmed ? failure("starling-save-reentry-confirmed") : failure("starling-save-unsettled");
      }
      if (!await ensureStarlingAccepted(durable, authority)) return failure("starling-reentry-required");
      let payload;
      try { payload = await once.freezePayload(); }
      catch (_error) { return failure("payload-freeze-failed"); }
      const preparation = resolvePreparation(payload);
      if (!preparation) return failure("starling-save-preparation-invalid");
      return savePreparedStarling(payload, preparation, authority, durable);
    }

'''
text = text.replace(needle, engine + needle, 1)

# Accepted P164 implementation becomes the explicitly named whole-record strategy; body is untouched.
replace_once('    async function saveSyncedOwner(input) {',
             '    async function saveWholeRecordWithMirror(input) {', 'rename P164 save strategy')

# New public save method is only a dispatcher/gate; legacy P164 test injections stay exact.
needle = '''    return Object.freeze({
      canAdoptSyncedOwner: base.canAdoptSyncedOwner,
'''
if text.count(needle) != 1:
    raise SystemExit('public controller return marker missing')
wrapper = r'''    async function saveSyncedOwner(input) {
      if (!options?.persistenceAuthorityService) return saveWholeRecordWithMirror(input);
      return serialiseOwnerOperation(() => dispatchAuthoritySave(input));
    }

'''
text = text.replace(needle, wrapper + needle, 1)

path.write_text(text)
print('P168 same-owner authority dispatcher applied')
