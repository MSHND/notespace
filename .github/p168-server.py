from pathlib import Path
import re

ROOT = Path('.')

def read(path):
    return (ROOT / path).read_text()

def write(path, text):
    (ROOT / path).write_text(text)

def sub_once(path, pattern, replacement, flags=re.S):
    text = read(path)
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{path}: expected one match for {pattern!r}, got {count}')
    write(path, next_text)

def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one exact occurrence, got {count}: {old[:100]!r}')
    write(path, text.replace(old, new, 1))

# ---------------------------------------------------------------------------
# sync-service/pocket-sync-service-core.js
# ---------------------------------------------------------------------------
path = 'sync-service/pocket-sync-service-core.js'

# Legal shared authority states: whole-record steady/fenced OR Starling steady.
sub_once(path,
    r'''    case COLLECTIONS\.persistenceAuthorities: \{\n.*?      break;\n    \}''',
    '''    case COLLECTIONS.persistenceAuthorities: {
      if (input.kind !== "pocket.sync.persistence-authority"
          || input.syncedPocketId !== key
          || !["whole-record", "starling"].includes(input.currentMode)) {
        throw serviceError("service-state-invalid", 500);
      }
      identifier(input.accountId, "service-state-invalid");
      identifier(input.syncedPocketId, "service-state-invalid");
      positiveInteger(input.authorityRevision, "service-state-invalid");
      if (input.currentMode === "whole-record") {
        if (input.rollbackRevision !== null || input.adoptionHead !== null) {
          throw serviceError("service-state-invalid", 500);
        }
        if (input.transition !== null) {
          if (!sameKeys(input.transition, ["transitionId", "expectedAuthorityRevision"])) {
            throw serviceError("service-state-invalid", 500);
          }
          identifier(input.transition.transitionId, "service-state-invalid");
          positiveInteger(input.transition.expectedAuthorityRevision, "service-state-invalid");
          if (input.transition.expectedAuthorityRevision >= Number.MAX_SAFE_INTEGER
              || input.transition.expectedAuthorityRevision + 1 !== input.authorityRevision) {
            throw serviceError("service-state-invalid", 500);
          }
        }
      } else {
        if (input.transition !== null
            || !Number.isSafeInteger(input.rollbackRevision) || input.rollbackRevision < 1
            || !validateStarlingHead(input.adoptionHead, "service-state-invalid")) {
          throw serviceError("service-state-invalid", 500);
        }
      }
      break;
    }''')

# Add exact Starling Head + adoption request validation before generic object/Head request validation.
marker = 'function validateObjectHeadRequest(input, fields) {'
text = read(path)
if marker not in text:
    raise SystemExit('service core: object head validator marker missing')
insert = r'''function validateStarlingHead(input, code = "service-request-invalid") {
  const status = code === "service-state-invalid" ? 500 : 400;
  if (!isObject(input) || !sameKeys(input, ["schema", "revision", "sealRef"])
      || input.schema !== "pocket.starling.head.v1"
      || !Number.isSafeInteger(input.revision) || input.revision < 1
      || typeof input.sealRef !== "string" || input.sealRef.length < 1
      || input.sealRef.length > POLICY.maximumIdentifierLength
      || input.sealRef !== input.sealRef.trim()) {
    throw serviceError(code, status);
  }
  return frozen({ schema: input.schema, revision: input.revision, sealRef: input.sealRef });
}

function sameStarlingHead(left, right) {
  return !!left && !!right && left.schema === right.schema
    && left.revision === right.revision && left.sealRef === right.sealRef;
}

function validateAuthorityAdoptionRequest(input) {
  const fields = ["apiVersion", "operationId", "syncedPocketId", "expectedAuthorityRevision",
    "transitionId", "rollbackRevision", "adoptionHead"];
  const value = exactObject(input, fields, fields);
  if (value.apiVersion !== 1) throw serviceError("service-request-invalid");
  const expectedAuthorityRevision = positiveInteger(value.expectedAuthorityRevision);
  if (expectedAuthorityRevision >= Number.MAX_SAFE_INTEGER) {
    throw serviceError("service-request-invalid");
  }
  return frozen({
    apiVersion: 1,
    operationId: identifier(value.operationId),
    syncedPocketId: identifier(value.syncedPocketId),
    expectedAuthorityRevision,
    transitionId: identifier(value.transitionId),
    rollbackRevision: positiveInteger(value.rollbackRevision),
    adoptionHead: validateStarlingHead(value.adoptionHead),
  });
}

'''
write(path, text.replace(marker, insert + marker, 1))

# Keep the accepted P166 predicate exact and add the post-adoption predicate.
replace_once(path,
'''  function persistenceAuthorityIsSteady(authority) {
    return authority.currentMode === "whole-record" && authority.transition === null;
  }
''',
'''  function persistenceAuthorityIsSteady(authority) {
    return authority.currentMode === "whole-record" && authority.transition === null;
  }

  function persistenceAuthorityIsStarlingSteady(authority) {
    return authority.currentMode === "starling" && authority.transition === null
      && Number.isSafeInteger(authority.rollbackRevision) && authority.rollbackRevision >= 1
      && !!authority.adoptionHead;
  }
''')

# Barrier authority reads through the same per-Pocket lock so ambiguity reads cannot overtake adoption/release.
sub_once(path,
    r'''  async function readPersistenceAuthority\(value\) \{.*?\n  \}\n\n  function authorityConflictWrapper''',
    '''  async function readPersistenceAuthority(value) {
    const { context, body } = invocation(value);
    const request = validateReadPersistenceAuthorityRequest(body);
    const at = clockMilliseconds();
    return withPocketAuthorityLock(request.syncedPocketId, () => transact("readonly", async (transaction) => {
      const { account } = await authoriseSession(transaction, context.sessionId, at);
      await requireOwnedPocket(transaction, account, request.syncedPocketId);
      const authority = await readPersistenceAuthorityRecord(transaction, account, request.syncedPocketId);
      return frozen({ status: 200, body: { apiVersion: 1, ok: true,
        operationId: request.operationId, syncedPocketId: request.syncedPocketId,
        authority: persistenceAuthoritySnapshot(authority) }, session: null });
    }));
  }

  function authorityConflictWrapper''')

# Add the purpose-specific content-neutral Starling adoption operation before fence release.
marker = '  async function releasePersistenceAuthorityFence(value) {'
text = read(path)
if marker not in text:
    raise SystemExit('service core: release fence marker missing')
adoption = r'''  async function commitStarlingAuthorityAdoption(value) {
    const { context, body } = invocation(value);
    const request = validateAuthorityAdoptionRequest(body);
    const at = clockMilliseconds();
    return transactAuthorityMutation(request.syncedPocketId, async (transaction) => {
      const { account } = await authoriseSession(transaction, context.sessionId, at);
      await requireOwnedPocket(transaction, account, request.syncedPocketId);
      const authority = await readPersistenceAuthorityRecord(transaction, account, request.syncedPocketId);
      if (authority.authorityRevision !== request.expectedAuthorityRevision
          || authority.currentMode !== "whole-record"
          || authority.transition === null
          || authority.transition.transitionId !== request.transitionId
          || authority.transition.expectedAuthorityRevision + 1 !== authority.authorityRevision
          || authority.rollbackRevision !== null || authority.adoptionHead !== null) {
        return authorityConflictWrapper(request, authority);
      }
      const pocket = await readRecord(transaction, COLLECTIONS.pockets, request.syncedPocketId);
      if (!pocket || pocket.accountId !== account.accountId
          || pocket.revision !== request.rollbackRevision) {
        return authorityConflictWrapper(request, authority);
      }
      const actualHead = await objectHeadCall("readHead", [request.syncedPocketId]);
      if (!sameStarlingHead(actualHead, request.adoptionHead)) {
        return authorityConflictWrapper(request, authority);
      }
      if (authority.authorityRevision >= Number.MAX_SAFE_INTEGER) {
        return authorityConflictWrapper(request, authority);
      }
      const next = frozen({
        ...authority,
        storeVersion: authority.storeVersion + 1,
        authorityRevision: authority.authorityRevision + 1,
        currentMode: "starling",
        transition: null,
        rollbackRevision: request.rollbackRevision,
        adoptionHead: request.adoptionHead,
      });
      await replaceRecord(transaction, COLLECTIONS.persistenceAuthorities,
        request.syncedPocketId, authority, next);
      return frozen({ status: 200, body: { apiVersion: 1, ok: true,
        operationId: request.operationId, syncedPocketId: request.syncedPocketId,
        status: "adopted", authority: persistenceAuthoritySnapshot(next) }, session: null });
    });
  }

'''
write(path, text.replace(marker, adoption + marker, 1))

# Initial Head creation is now authority-aware. It remains available only in whole-record/steady mode.
sub_once(path,
    r'''  async function initialiseShadowHead\(value\) \{.*?\n  \}\n\n  async function readShadowHead''',
    '''  async function initialiseShadowHead(value) {
    const { context, body } = invocation(value);
    const request = validateObjectHeadRequest(body, ["apiVersion", "operationId", "syncedPocketId"]);
    const account = await authoriseObjectHead(context, request.syncedPocketId);
    return withPocketAuthorityLock(request.syncedPocketId, async () => {
      const authority = await transact("readonly", (transaction) =>
        readPersistenceAuthorityRecord(transaction, account, request.syncedPocketId));
      if (!persistenceAuthorityIsSteady(authority)) {
        throw serviceError("service-persistence-authority-transition-active", 409);
      }
      const head = await objectHeadCall("initialiseHead", [request.syncedPocketId]);
      return frozen({ status: 200, body: { apiVersion: 1, ok: true,
        operationId: request.operationId, syncedPocketId: request.syncedPocketId, head }, session: null });
    });
  }

  async function readShadowHead''')

# One Head CAS endpoint: old mirror shape only pre-switch; authority-bound shape only post-switch.
sub_once(path,
    r'''  async function compareAndSetShadowHead\(value\) \{.*?\n  \}\n\n  return Object\.freeze\(\{''',
    '''  async function compareAndSetShadowHead(value) {
    const { context, body } = invocation(value);
    const legacyFields = ["apiVersion", "operationId", "syncedPocketId", "expectedHead", "candidateSealStorageRef"];
    const authoritativeFields = [...legacyFields, "expectedAuthorityRevision"];
    const authoritative = isObject(body) && Object.prototype.hasOwnProperty.call(body, "expectedAuthorityRevision");
    const request = validateObjectHeadRequest(body, authoritative ? authoritativeFields : legacyFields);
    if (authoritative) positiveInteger(request.expectedAuthorityRevision);
    const account = await authoriseObjectHead(context, request.syncedPocketId);
    return withPocketAuthorityLock(request.syncedPocketId, async () => {
      const authority = await transact("readonly", (transaction) =>
        readPersistenceAuthorityRecord(transaction, account, request.syncedPocketId));
      if (authority.currentMode === "whole-record") {
        if (!persistenceAuthorityIsSteady(authority)) {
          throw serviceError("service-persistence-authority-transition-active", 409);
        }
        if (authoritative) return authorityConflictWrapper(request, authority);
      } else if (persistenceAuthorityIsStarlingSteady(authority)) {
        if (!authoritative || request.expectedAuthorityRevision !== authority.authorityRevision) {
          return authorityConflictWrapper(request, authority);
        }
      } else {
        return authorityConflictWrapper(request, authority);
      }
      const result = await objectHeadCall("compareAndSetHead", [request.syncedPocketId,
        request.expectedHead, request.candidateSealStorageRef]);
      return frozen({ status: result.ok ? 200 : 409, body: { apiVersion: 1,
        ok: result.ok === true, operationId: request.operationId,
        syncedPocketId: request.syncedPocketId, ...(result.ok ? { head: result.head }
          : { reason: result.reason, head: result.head ?? null }) }, session: null });
    });
  }

  return Object.freeze({''')

# Export the new exact authority operation.
replace_once(path,
'''    readPersistenceAuthority,
    acquirePersistenceAuthorityFence,
    releasePersistenceAuthorityFence,
''',
'''    readPersistenceAuthority,
    acquirePersistenceAuthorityFence,
    commitStarlingAuthorityAdoption,
    releasePersistenceAuthorityFence,
''')

# ---------------------------------------------------------------------------
# sync-service/pocket-sync-http-adapter.js
# ---------------------------------------------------------------------------
path = 'sync-service/pocket-sync-http-adapter.js'
replace_once(path,
'''  readPersistenceAuthority: "/pockets/authority/read",
  acquirePersistenceAuthorityFence: "/pockets/authority/fence/acquire",
  releasePersistenceAuthorityFence: "/pockets/authority/fence/release",
''',
'''  readPersistenceAuthority: "/pockets/authority/read",
  acquirePersistenceAuthorityFence: "/pockets/authority/fence/acquire",
  commitStarlingAuthorityAdoption: "/pockets/authority/starling/adopt",
  releasePersistenceAuthorityFence: "/pockets/authority/fence/release",
''')
replace_once(path,
'''    statuses: ["conditionalUpload", "acquirePersistenceAuthorityFence",
      "releasePersistenceAuthorityFence", "addEnvelope", "revokeEnvelope",
''',
'''    statuses: ["conditionalUpload", "acquirePersistenceAuthorityFence",
      "commitStarlingAuthorityAdoption", "releasePersistenceAuthorityFence", "addEnvelope", "revokeEnvelope",
''')

# ---------------------------------------------------------------------------
# js/pocket-sync-remote-client.js
# ---------------------------------------------------------------------------
path = 'js/pocket-sync-remote-client.js'
replace_once(path,
'''    readPersistenceAuthority: "/pockets/authority/read",
    acquirePersistenceAuthorityFence: "/pockets/authority/fence/acquire",
    releasePersistenceAuthorityFence: "/pockets/authority/fence/release",
''',
'''    readPersistenceAuthority: "/pockets/authority/read",
    acquirePersistenceAuthorityFence: "/pockets/authority/fence/acquire",
    commitStarlingAuthorityAdoption: "/pockets/authority/starling/adopt",
    releasePersistenceAuthorityFence: "/pockets/authority/fence/release",
''')
replace_once(path,
'''        "acquirePersistenceAuthorityFence",
        "releasePersistenceAuthorityFence",
''',
'''        "acquirePersistenceAuthorityFence",
        "commitStarlingAuthorityAdoption",
        "releasePersistenceAuthorityFence",
''')

# Replace authority-state validator with the exact three-state contract.
sub_once(path,
    r'''  function validatePersistenceAuthorityState\(input\) \{.*?\n  \}\n\n  function validatePersistenceAuthorityReadRequest''',
    r'''  function validatePersistenceAuthorityHead(input) {
    const value = exactObject(input, ["schema", "revision", "sealRef"],
      ["schema", "revision", "sealRef"]);
    if (value.schema !== "pocket.starling.head.v1"
        || !Number.isSafeInteger(value.revision) || value.revision < 1
        || typeof value.sealRef !== "string" || value.sealRef.length < 1
        || value.sealRef.length > IDENTIFIER_LIMIT || value.sealRef !== value.sealRef.trim()) {
      throw remoteError("remote-response-invalid");
    }
    return frozen(value);
  }

  function validatePersistenceAuthorityState(input) {
    const value = exactObject(input, ["schema", "authorityRevision", "currentMode",
      "transition", "rollbackRevision", "adoptionHead"],
    ["schema", "authorityRevision", "currentMode", "transition", "rollbackRevision", "adoptionHead"]);
    if (value.schema !== "pocket.sync.persistence-authority.v1"
        || !["whole-record", "starling"].includes(value.currentMode)) {
      throw remoteError("remote-response-invalid");
    }
    const authorityRevision = revision(value.authorityRevision, 1, "remote-response-invalid");
    let transition = null;
    let rollbackRevision = null;
    let adoptionHead = null;
    if (value.currentMode === "whole-record") {
      if (value.rollbackRevision !== null || value.adoptionHead !== null) {
        throw remoteError("remote-response-invalid");
      }
      if (value.transition !== null) {
        const current = exactObject(value.transition, ["transitionId", "expectedAuthorityRevision"],
          ["transitionId", "expectedAuthorityRevision"]);
        const expectedAuthorityRevision = revision(current.expectedAuthorityRevision, 1, "remote-response-invalid");
        if (expectedAuthorityRevision >= Number.MAX_SAFE_INTEGER
            || expectedAuthorityRevision + 1 !== authorityRevision) {
          throw remoteError("remote-response-invalid");
        }
        transition = frozen({ transitionId: identifier(current.transitionId, "remote-response-invalid"),
          expectedAuthorityRevision });
      }
    } else {
      if (value.transition !== null) throw remoteError("remote-response-invalid");
      rollbackRevision = revision(value.rollbackRevision, 1, "remote-response-invalid");
      adoptionHead = validatePersistenceAuthorityHead(value.adoptionHead);
    }
    return frozen({ schema: value.schema, authorityRevision, currentMode: value.currentMode,
      transition, rollbackRevision, adoptionHead });
  }

  function validatePersistenceAuthorityReadRequest''')

# Add exact adoption request validator before the common authority response validator.
marker = '  function validatePersistenceAuthorityBase(input, request) {'
text = read(path)
if marker not in text:
    raise SystemExit('remote client: authority base marker missing')
insert = r'''  function validatePersistenceAuthorityAdoptionRequest(input) {
    const fields = ["apiVersion", "operationId", "syncedPocketId", "expectedAuthorityRevision",
      "transitionId", "rollbackRevision", "adoptionHead"];
    const value = exactObject(input, fields, fields, "remote-request-invalid");
    if (value.apiVersion !== 1) throw remoteError("remote-request-invalid");
    const expectedAuthorityRevision = revision(value.expectedAuthorityRevision, 1);
    if (expectedAuthorityRevision >= Number.MAX_SAFE_INTEGER) throw remoteError("remote-request-invalid");
    const head = validatePersistenceAuthorityHead(value.adoptionHead);
    return frozen({ apiVersion: 1, operationId: identifier(value.operationId),
      syncedPocketId: identifier(value.syncedPocketId), expectedAuthorityRevision,
      transitionId: identifier(value.transitionId), rollbackRevision: revision(value.rollbackRevision, 1),
      adoptionHead: head });
  }

'''
write(path, text.replace(marker, insert + marker, 1))

# Add adoption method to the existing authority service.
sub_once(path,
    r'''  function createPersistenceAuthorityService\(\{ transport \} = \{\}\) \{.*?\n    return Object\.freeze\(\{ read, acquireFence, releaseFence \}\);\n  \}''',
    r'''  function createPersistenceAuthorityService({ transport } = {}) {
    const remote = validateTransport(transport);
    async function read(input) {
      const request = validatePersistenceAuthorityReadRequest(input);
      const result = validateTransportResult(await callTransport(remote, "readPersistenceAuthority", request), [200]);
      return validatePersistenceAuthorityBase(result.body, request);
    }
    async function acquireFence(input) {
      const request = validatePersistenceAuthorityFenceRequest(input);
      const result = validateTransportResult(await callTransport(remote, "acquirePersistenceAuthorityFence", request), [200, 409]);
      if (result.status === 200) {
        const value = exactObject(result.body, ["apiVersion", "ok", "operationId", "syncedPocketId",
          "status", "replayed", "authority"], ["apiVersion", "ok", "operationId", "syncedPocketId",
          "status", "replayed", "authority"]);
        if (value.apiVersion !== 1 || value.ok !== true || value.operationId !== request.operationId
            || value.syncedPocketId !== request.syncedPocketId || value.status !== "fenced"
            || typeof value.replayed !== "boolean") throw remoteError("remote-response-invalid");
        return frozen({ ...value, authority: validatePersistenceAuthorityState(value.authority) });
      }
      const value = exactObject(result.body, ["apiVersion", "ok", "operationId", "syncedPocketId",
        "status", "reason", "authority"], ["apiVersion", "ok", "operationId", "syncedPocketId",
        "status", "reason", "authority"]);
      if (value.apiVersion !== 1 || value.ok !== false || value.operationId !== request.operationId
          || value.syncedPocketId !== request.syncedPocketId || value.status !== "conflict"
          || value.reason !== "authority-conflict") throw remoteError("remote-response-invalid");
      return frozen({ ...value, authority: validatePersistenceAuthorityState(value.authority) });
    }
    async function commitStarlingAdoption(input) {
      const request = validatePersistenceAuthorityAdoptionRequest(input);
      const result = validateTransportResult(await callTransport(remote, "commitStarlingAuthorityAdoption", request), [200, 409]);
      if (result.status === 200) {
        const value = exactObject(result.body, ["apiVersion", "ok", "operationId", "syncedPocketId",
          "status", "authority"], ["apiVersion", "ok", "operationId", "syncedPocketId",
          "status", "authority"]);
        if (value.apiVersion !== 1 || value.ok !== true || value.operationId !== request.operationId
            || value.syncedPocketId !== request.syncedPocketId || value.status !== "adopted") {
          throw remoteError("remote-response-invalid");
        }
        return frozen({ ...value, authority: validatePersistenceAuthorityState(value.authority) });
      }
      const value = exactObject(result.body, ["apiVersion", "ok", "operationId", "syncedPocketId",
        "status", "reason", "authority"], ["apiVersion", "ok", "operationId", "syncedPocketId",
        "status", "reason", "authority"]);
      if (value.apiVersion !== 1 || value.ok !== false || value.operationId !== request.operationId
          || value.syncedPocketId !== request.syncedPocketId || value.status !== "conflict"
          || value.reason !== "authority-conflict") throw remoteError("remote-response-invalid");
      return frozen({ ...value, authority: validatePersistenceAuthorityState(value.authority) });
    }
    async function releaseFence(input) {
      const request = validatePersistenceAuthorityFenceRequest(input);
      const result = validateTransportResult(await callTransport(remote, "releasePersistenceAuthorityFence", request), [200, 409]);
      if (result.status === 200) {
        const value = exactObject(result.body, ["apiVersion", "ok", "operationId", "syncedPocketId",
          "status", "authority"], ["apiVersion", "ok", "operationId", "syncedPocketId",
          "status", "authority"]);
        if (value.apiVersion !== 1 || value.ok !== true || value.operationId !== request.operationId
            || value.syncedPocketId !== request.syncedPocketId || value.status !== "released") {
          throw remoteError("remote-response-invalid");
        }
        return frozen({ ...value, authority: validatePersistenceAuthorityState(value.authority) });
      }
      const value = exactObject(result.body, ["apiVersion", "ok", "operationId", "syncedPocketId",
        "status", "reason", "authority"], ["apiVersion", "ok", "operationId", "syncedPocketId",
        "status", "reason", "authority"]);
      if (value.apiVersion !== 1 || value.ok !== false || value.operationId !== request.operationId
          || value.syncedPocketId !== request.syncedPocketId || value.status !== "conflict"
          || value.reason !== "authority-conflict") throw remoteError("remote-response-invalid");
      return frozen({ ...value, authority: validatePersistenceAuthorityState(value.authority) });
    }
    return Object.freeze({ read, acquireFence, commitStarlingAdoption, releaseFence });
  }''')

# Object/Head request validator: allow expectedAuthorityRevision only on CAS and return structured authority conflicts.
# The service implementation is patched narrowly rather than changing other object methods.
sub_once(path,
    r'''    async function compareAndSetShadowHead\(input\) \{.*?\n    \}\n\n    return Object\.freeze\(\{''',
    r'''    async function compareAndSetShadowHead(input) {
      const legacyFields = ["apiVersion", "operationId", "syncedPocketId", "expectedHead", "candidateSealStorageRef"];
      const authoritativeFields = [...legacyFields, "expectedAuthorityRevision"];
      const authoritative = isObject(input) && Object.prototype.hasOwnProperty.call(input, "expectedAuthorityRevision");
      const request = validateObjectRequest(input, authoritative ? authoritativeFields : legacyFields);
      if (authoritative) revision(request.expectedAuthorityRevision, 1);
      const result = validateTransportResult(await callTransport(remote, "compareAndSetShadowHead", request), [200, 409]);
      if (result.status === 200) {
        const value = validateObjectResponse(result.body, request, ["head"]);
        return frozen({ ok: true, head: validateHead(value.head) });
      }
      const base = exactObject(result.body, ["apiVersion", "ok", "operationId", "syncedPocketId", "reason", "head",
        "status", "authority"], ["apiVersion", "ok", "operationId", "syncedPocketId", "reason"]);
      if (base.apiVersion !== 1 || base.ok !== false || base.operationId !== request.operationId
          || base.syncedPocketId !== request.syncedPocketId) throw remoteError("remote-response-invalid");
      if (base.reason === "authority-conflict") {
        if (base.status !== "conflict" || !Object.prototype.hasOwnProperty.call(base, "authority")) {
          throw remoteError("remote-response-invalid");
        }
        return frozen({ ok: false, reason: "authority-conflict",
          authority: validatePersistenceAuthorityState(base.authority) });
      }
      if (!Object.prototype.hasOwnProperty.call(base, "head")) throw remoteError("remote-response-invalid");
      return frozen({ ok: false, reason: base.reason, head: base.head === null ? null : validateHead(base.head) });
    }

    return Object.freeze({''')

# ---------------------------------------------------------------------------
# js/pocket-starling-durable-publication.js
# ---------------------------------------------------------------------------
path = 'js/pocket-starling-durable-publication.js'
replace_once(path,
'''    async function attemptHead(descriptorInput) {
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
''',
'''    async function attemptHead(descriptorInput, expectedAuthorityRevision = null) {
      const descriptor = await provePresence(descriptorInput, "pre-cas");
      if (expectedAuthorityRevision !== null
          && (!Number.isSafeInteger(expectedAuthorityRevision) || expectedAuthorityRevision < 1)) {
        throw fail("authority-revision-invalid");
      }
      let response;
      try {
        response = await service.compareAndSetShadowHead({
          apiVersion: API_VERSION,
          operationId: freshOperationId("durable-compare-and-set-head", 0),
          syncedPocketId: descriptor.syncedPocketId,
          expectedHead: descriptor.expectedHead,
          candidateSealStorageRef: descriptor.candidateSealStorageRef,
          ...(expectedAuthorityRevision === null ? {} : { expectedAuthorityRevision }),
        });
''')
replace_once(path,
'''      if (response?.ok === false && response.reason === "head-conflict") {
        return Object.freeze({ outcome: "conflict" });
      }
''',
'''      if (response?.ok === false && ["head-conflict", "authority-conflict"].includes(response.reason)) {
        return Object.freeze({ outcome: "conflict", reason: response.reason });
      }
''')

print('P168 server/transport patch applied')
