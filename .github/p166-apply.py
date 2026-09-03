from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text()

def write(path, text):
    (ROOT / path).write_text(text)

def once(text, old, new, label):
    if text.count(old) != 1:
        raise SystemExit(f"{label}: expected one match, found {text.count(old)}")
    return text.replace(old, new, 1)

# --- shared service-record collection + real PostgreSQL advisory lock ---
p = "sync-service/pocket-sync-postgres-store.js"
s = read(p)
s = once(s,
'''  "recoveryLocators",\n  "recoveryCeremonies",\n  "keyOperations",\n]);''',
'''  "recoveryLocators",\n  "recoveryCeremonies",\n  "keyOperations",\n  "persistenceAuthorities",\n]);''', "postgres collections")
s = once(s,
'''  remove: `DELETE FROM ${TABLE} WHERE collection = $1 AND record_key = $2 AND store_version = $3`,\n});''',
'''  remove: `DELETE FROM ${TABLE} WHERE collection = $1 AND record_key = $2 AND store_version = $3`,\n  authorityLock: "SELECT pg_advisory_lock(hashtextextended($1::text, 166)) AS locked",\n  authorityUnlock: "SELECT pg_advisory_unlock(hashtextextended($1::text, 166)) AS unlocked",\n});''', "postgres lock sql")
s = once(s,
'''  return Object.freeze({ transact });\n}''',
'''  async function withPocketAuthorityLock(syncedPocketId, callback) {\n    const pocket = validateKey(syncedPocketId);\n    if (pocket.length > 160 || pocket !== pocket.trim() || typeof callback !== "function") {\n      throw storeError("store-key-invalid");\n    }\n    let client = null;\n    let locked = false;\n    let primaryError = null;\n    try {\n      try { client = await pool.connect(); }\n      catch (_error) { throw storeError("store-storage-failed"); }\n      if (!isReference(client) || typeof client.query !== "function"\n          || typeof client.release !== "function") throw storeError("store-storage-failed");\n      let acquired;\n      try { acquired = await client.query(SQL.authorityLock, [pocket]); }\n      catch (_error) { throw storeError("store-storage-failed"); }\n      if (!isReference(acquired) || !Array.isArray(acquired.rows) || acquired.rows.length !== 1) {\n        throw storeError("store-storage-failed");\n      }\n      locked = true;\n      return await callback();\n    } catch (error) {\n      primaryError = error;\n      throw error;\n    } finally {\n      if (client) {\n        let unlockError = null;\n        if (locked) {\n          try {\n            const released = await client.query(SQL.authorityUnlock, [pocket]);\n            if (!isReference(released) || !Array.isArray(released.rows)\n                || released.rows.length !== 1 || released.rows[0]?.unlocked !== true) {\n              unlockError = storeError("store-storage-failed");\n            }\n          } catch (_error) { unlockError = storeError("store-storage-failed"); }\n        }\n        try { client.release(); }\n        catch (_error) { if (!unlockError) unlockError = storeError("store-storage-failed"); }\n        if (unlockError && !primaryError) throw unlockError;\n      }\n    }\n  }\n\n  return Object.freeze({ transact, withPocketAuthorityLock });\n}''', "postgres return")
write(p, s)

# --- memory service store gains the same lock contract + authority collection ---
p = "tests/helpers/p034-memory-service-store.js"
s = read(p)
s = once(s,
'''  "recoveryCeremonies",\n  "keyOperations",\n]);''',
'''  "recoveryCeremonies",\n  "keyOperations",\n  "persistenceAuthorities",\n]);''', "memory collections")
s = once(s,
'''    queue: Promise.resolve(),\n  };''',
'''    queue: Promise.resolve(),\n    authorityLocks: new Map(),\n  };''', "memory lock state")
s = once(s,
'''  const store = Object.freeze({ transact });''',
'''  async function withPocketAuthorityLock(syncedPocketId, callback) {\n    const pocket = validateKey(syncedPocketId);\n    if (pocket.length > 160 || pocket !== pocket.trim() || typeof callback !== "function") {\n      throw storeError("store-key-invalid");\n    }\n    const prior = backing.authorityLocks.get(pocket) || Promise.resolve();\n    let releaseTurn;\n    const turn = new Promise((resolve) => { releaseTurn = resolve; });\n    const tail = prior.then(() => turn, () => turn);\n    backing.authorityLocks.set(pocket, tail);\n    await prior.catch(() => {});\n    try { return await callback(); }\n    finally {\n      releaseTurn();\n      tail.finally(() => {\n        if (backing.authorityLocks.get(pocket) === tail) backing.authorityLocks.delete(pocket);\n      }).catch(() => {});\n    }\n  }\n\n  const store = Object.freeze({ transact, withPocketAuthorityLock });''', "memory store")
write(p, s)

# --- migration: collection constraint, deterministic backfill, schema marker ---
p = "sync-service/migrations/003-pocket-sync-persistence-authority.sql"
write(p, '''ALTER TABLE public.pocket_sync_records\n  DROP CONSTRAINT IF EXISTS pocket_sync_records_collection_check;\n\nALTER TABLE public.pocket_sync_records\n  ADD CONSTRAINT pocket_sync_records_collection_check CHECK (\n    collection IN (\n      'accounts', 'credentials', 'sessions', 'ceremonies', 'pockets', 'operations',\n      'keySets', 'envelopes', 'recoveryLocators', 'recoveryCeremonies', 'keyOperations',\n      'persistenceAuthorities'\n    )\n  );\n\nINSERT INTO public.pocket_sync_records (collection, record_key, store_version, record)\nSELECT\n  'persistenceAuthorities',\n  record_key,\n  1,\n  jsonb_build_object(\n    'kind', 'pocket.sync.persistence-authority',\n    'schemaVersion', 1,\n    'storeVersion', 1,\n    'accountId', record ->> 'accountId',\n    'syncedPocketId', record_key,\n    'authorityRevision', 1,\n    'currentMode', 'whole-record',\n    'transition', NULL,\n    'rollbackRevision', NULL,\n    'adoptionHead', NULL\n  )\nFROM public.pocket_sync_records\nWHERE collection = 'pockets'\nON CONFLICT (collection, record_key) DO NOTHING;\n\nINSERT INTO public.pocket_sync_schema (schema_name, schema_version)\nVALUES ('pocket-sync-persistence-authority', 1)\nON CONFLICT (schema_name) DO NOTHING;\n''')

p = "sync-service/pocket-sync-db-migrate.js"
s = read(p)
s = once(s,
'''  path.join(__dirname, "migrations", ["002", "pocket", "sync", "object", "head", "store.sql"].join("-")),\n]);''',
'''  path.join(__dirname, "migrations", ["002", "pocket", "sync", "object", "head", "store.sql"].join("-")),\n  path.join(__dirname, "migrations", ["003", "pocket", "sync", "persistence", "authority.sql"].join("-")),\n]);''', "migration path")
write(p, s)

# --- schema verifier understands the new strict collection/schema marker ---
p = "sync-service/pocket-sync-postgres-schema.js"
s = read(p)
s = once(s,
'''  "accounts", "credentials", "sessions", "ceremonies", "pockets", "operations",\n  "keySets", "envelopes", "recoveryLocators", "recoveryCeremonies", "keyOperations",\n]);''',
'''  "accounts", "credentials", "sessions", "ceremonies", "pockets", "operations",\n  "keySets", "envelopes", "recoveryLocators", "recoveryCeremonies", "keyOperations",\n  "persistenceAuthorities",\n]);''', "schema collections")
s = once(s,
'''    "SELECT schema_name,schema_version FROM public.pocket_sync_schema WHERE schema_name IN ($1,$2)",\n    ["pocket-sync-store", "pocket-sync-object-head-store"], "schema-version-query");''',
'''    "SELECT schema_name,schema_version FROM public.pocket_sync_schema WHERE schema_name IN ($1,$2,$3)",\n    ["pocket-sync-store", "pocket-sync-object-head-store", "pocket-sync-persistence-authority"], "schema-version-query");''', "schema version query")
s = once(s,
'''  const objectHeadVersions = version.rows.filter((row) => row?.schema_name === "pocket-sync-object-head-store");''',
'''  const objectHeadVersions = version.rows.filter((row) => row?.schema_name === "pocket-sync-object-head-store");\n  const authorityVersions = version.rows.filter((row) => row?.schema_name === "pocket-sync-persistence-authority");''', "schema version rows")
s = once(s,
'''  if (objectHeadVersions.length !== 1 || objectHeadVersions[0]?.schema_version !== 1) {\n    throw schemaError("object-head-schema-version-value");\n  }\n  return true;''',
'''  if (objectHeadVersions.length !== 1 || objectHeadVersions[0]?.schema_version !== 1) {\n    throw schemaError("object-head-schema-version-value");\n  }\n  if (authorityVersions.length !== 1 || authorityVersions[0]?.schema_version !== 1) {\n    throw schemaError("schema-version-value");\n  }\n  return true;''', "schema authority version")
write(p, s)

# --- service core: strict authority record, read/fence APIs, one shared lock around mutations ---
p = "sync-service/pocket-sync-service-core.js"
s = read(p)
s = once(s,
'''  keyOperations: "keyOperations",\n});''',
'''  keyOperations: "keyOperations",\n  persistenceAuthorities: "persistenceAuthorities",\n});''', "core collections")
s = once(s,
'''  keyOperations: Object.freeze([\n    "kind", "schemaVersion", "storeVersion", "accountId", "syncedPocketId",\n    "operationId", "logicalChangeId", "operationKind", "expectedKeySetVersion",\n    "requestDigest", "result",\n  ]),\n});''',
'''  keyOperations: Object.freeze([\n    "kind", "schemaVersion", "storeVersion", "accountId", "syncedPocketId",\n    "operationId", "logicalChangeId", "operationKind", "expectedKeySetVersion",\n    "requestDigest", "result",\n  ]),\n  persistenceAuthorities: Object.freeze([\n    "kind", "schemaVersion", "storeVersion", "accountId", "syncedPocketId",\n    "authorityRevision", "currentMode", "transition", "rollbackRevision", "adoptionHead",\n  ]),\n});''', "core record fields")
s = once(s,
'''    case COLLECTIONS.keyOperations: {''',
'''    case COLLECTIONS.persistenceAuthorities: {\n      if (input.kind !== "pocket.sync.persistence-authority"\n          || input.syncedPocketId !== key || input.currentMode !== "whole-record"\n          || input.rollbackRevision !== null || input.adoptionHead !== null) {\n        throw serviceError("service-state-invalid", 500);\n      }\n      identifier(input.accountId, "service-state-invalid");\n      identifier(input.syncedPocketId, "service-state-invalid");\n      positiveInteger(input.authorityRevision, "service-state-invalid");\n      if (input.transition !== null) {\n        if (!sameKeys(input.transition, ["transitionId", "expectedAuthorityRevision"])) {\n          throw serviceError("service-state-invalid", 500);\n        }\n        identifier(input.transition.transitionId, "service-state-invalid");\n        positiveInteger(input.transition.expectedAuthorityRevision, "service-state-invalid");\n        if (input.transition.expectedAuthorityRevision >= Number.MAX_SAFE_INTEGER\n            || input.transition.expectedAuthorityRevision + 1 !== input.authorityRevision) {\n          throw serviceError("service-state-invalid", 500);\n        }\n      }\n      break;\n    }\n    case COLLECTIONS.keyOperations: {''', "core authority validation")
s = once(s,
'''      || !sameKeys(input.store, ["transact"])\n      || typeof input.store.transact !== "function"''',
'''      || !sameKeys(input.store, ["transact", "withPocketAuthorityLock"])\n      || typeof input.store.transact !== "function"\n      || typeof input.store.withPocketAuthorityLock !== "function"''', "core store contract")

# request validators before object/head validator
marker = '''function validateObjectHeadRequest(input, fields) {'''
authority_validators = '''function validateReadPersistenceAuthorityRequest(input) {\n  const value = exactObject(input, ["apiVersion", "operationId", "syncedPocketId"],\n    ["apiVersion", "operationId", "syncedPocketId"]);\n  if (value.apiVersion !== 1) throw serviceError("service-request-invalid");\n  return frozen({ apiVersion: 1, operationId: identifier(value.operationId),\n    syncedPocketId: identifier(value.syncedPocketId) });\n}\n\nfunction validateAuthorityFenceRequest(input) {\n  const fields = ["apiVersion", "operationId", "syncedPocketId",\n    "expectedAuthorityRevision", "transitionId"];\n  const value = exactObject(input, fields, fields);\n  if (value.apiVersion !== 1) throw serviceError("service-request-invalid");\n  const expectedAuthorityRevision = positiveInteger(value.expectedAuthorityRevision);\n  if (expectedAuthorityRevision >= Number.MAX_SAFE_INTEGER) {\n    throw serviceError("service-request-invalid");\n  }\n  return frozen({ apiVersion: 1, operationId: identifier(value.operationId),\n    syncedPocketId: identifier(value.syncedPocketId), expectedAuthorityRevision,\n    transitionId: identifier(value.transitionId) });\n}\n\n'''
if marker not in s: raise SystemExit("core validator marker missing")
s = s.replace(marker, authority_validators + marker, 1)

# shared lock + authority helpers after transact()
marker = '''  async function readRecord(transaction, collection, key) {'''
helpers = '''  async function withPocketAuthorityLock(syncedPocketId, callback) {\n    let pending;\n    try {\n      pending = store.withPocketAuthorityLock(syncedPocketId, callback);\n      if (!thenable(pending)) throw serviceError("service-core-invalid", 500);\n      return await pending;\n    } catch (error) {\n      if (error && typeof error.code === "string" && error.code.startsWith("service-")) throw error;\n      throw mapTransactionError(error);\n    }\n  }\n\n  function transactAuthorityMutation(syncedPocketId, callback) {\n    return withPocketAuthorityLock(syncedPocketId, () => transact("readwrite", callback));\n  }\n\n  function initialPersistenceAuthority(account, syncedPocketId) {\n    return frozen({\n      kind: "pocket.sync.persistence-authority", schemaVersion: 1, storeVersion: 1,\n      accountId: account.accountId, syncedPocketId, authorityRevision: 1,\n      currentMode: "whole-record", transition: null, rollbackRevision: null, adoptionHead: null,\n    });\n  }\n\n  function persistenceAuthoritySnapshot(authority) {\n    return frozen({\n      schema: "pocket.sync.persistence-authority.v1",\n      authorityRevision: authority.authorityRevision,\n      currentMode: authority.currentMode,\n      transition: authority.transition,\n      rollbackRevision: authority.rollbackRevision,\n      adoptionHead: authority.adoptionHead,\n    });\n  }\n\n  function persistenceAuthorityIsSteady(authority) {\n    return authority.currentMode === "whole-record" && authority.transition === null;\n  }\n\n'''
if marker not in s: raise SystemExit("core helper marker missing")
s = s.replace(marker, helpers + marker, 1)

# authority record reader after readRecord implementation
marker = '''  async function insertRecord(transaction, collection, key, record) {'''
reader = '''  async function readPersistenceAuthorityRecord(transaction, account, syncedPocketId, options = {}) {\n    const authority = await readRecord(transaction, COLLECTIONS.persistenceAuthorities, syncedPocketId);\n    if (authority === null) {\n      if (options.allowMissing === true) return null;\n      throw serviceError("service-state-invalid", 500);\n    }\n    if (authority.accountId !== account.accountId || authority.syncedPocketId !== syncedPocketId) {\n      throw serviceError("service-state-invalid", 500);\n    }\n    return authority;\n  }\n\n'''
if marker not in s: raise SystemExit("core reader marker missing")
s = s.replace(marker, reader + marker, 1)

# conditional upload uses same lock and authority admission
start = s.index('  async function conditionalUpload(value) {')
end = s.index('\n  async function listEnvelopes', start)
block = s[start:end]
block = once(block, '    return transact("readwrite", async (transaction) => {',
             '    return transactAuthorityMutation(request.syncedPocketId, async (transaction) => {',
             "conditional lock")
block = once(block,
'''      const digest = uploadDigest(account.accountId, request);''',
'''      const authority = await readPersistenceAuthorityRecord(\n        transaction, account, request.syncedPocketId,\n        { allowMissing: pocket === null && account.syncedPocketId === null }\n      );\n      const digest = uploadDigest(account.accountId, request);''', "conditional authority read")
block = once(block,
'''      const actualRevision = pocket ? pocket.revision : 0;''',
'''      if (pocket !== null) {\n        if (!persistenceAuthorityIsSteady(authority)) {\n          throw serviceError("service-persistence-authority-transition-active", 409);\n        }\n      } else if (authority !== null) {\n        throw serviceError("service-state-invalid", 500);\n      }\n      const actualRevision = pocket ? pocket.revision : 0;''', "conditional admission")
block = once(block,
'''          await replaceRecord(\n            transaction,\n            COLLECTIONS.accounts,\n            account.accountId,\n            account,\n            boundAccount\n          );''',
'''          await replaceRecord(\n            transaction,\n            COLLECTIONS.accounts,\n            account.accountId,\n            account,\n            boundAccount\n          );\n          await insertRecord(transaction, COLLECTIONS.persistenceAuthorities,\n            request.syncedPocketId, initialPersistenceAuthority(account, request.syncedPocketId));''', "conditional initial authority")
s = s[:start] + block + s[end:]

# authority service methods before listEnvelopes
insert_at = s.index('\n  async function listEnvelopes', s.index('  async function conditionalUpload'))
authority_methods = '''\n  async function readPersistenceAuthority(value) {\n    const { context, body } = invocation(value);\n    const request = validateReadPersistenceAuthorityRequest(body);\n    const at = clockMilliseconds();\n    return transact("readonly", async (transaction) => {\n      const { account } = await authoriseSession(transaction, context.sessionId, at);\n      await requireOwnedPocket(transaction, account, request.syncedPocketId);\n      const authority = await readPersistenceAuthorityRecord(transaction, account, request.syncedPocketId);\n      return frozen({ status: 200, body: { apiVersion: 1, ok: true,\n        operationId: request.operationId, syncedPocketId: request.syncedPocketId,\n        authority: persistenceAuthoritySnapshot(authority) }, session: null });\n    });\n  }\n\n  function authorityConflictWrapper(request, authority) {\n    return frozen({ status: 409, body: { apiVersion: 1, ok: false,\n      operationId: request.operationId, syncedPocketId: request.syncedPocketId,\n      status: "conflict", reason: "authority-conflict",\n      authority: persistenceAuthoritySnapshot(authority) }, session: null });\n  }\n\n  async function acquirePersistenceAuthorityFence(value) {\n    const { context, body } = invocation(value);\n    const request = validateAuthorityFenceRequest(body);\n    const at = clockMilliseconds();\n    return transactAuthorityMutation(request.syncedPocketId, async (transaction) => {\n      const { account } = await authoriseSession(transaction, context.sessionId, at);\n      await requireOwnedPocket(transaction, account, request.syncedPocketId);\n      const authority = await readPersistenceAuthorityRecord(transaction, account, request.syncedPocketId);\n      if (authority.transition !== null\n          && authority.transition.transitionId === request.transitionId\n          && authority.transition.expectedAuthorityRevision === request.expectedAuthorityRevision) {\n        return frozen({ status: 200, body: { apiVersion: 1, ok: true,\n          operationId: request.operationId, syncedPocketId: request.syncedPocketId,\n          status: "fenced", replayed: true, authority: persistenceAuthoritySnapshot(authority) },\n          session: null });\n      }\n      if (!persistenceAuthorityIsSteady(authority)\n          || authority.authorityRevision !== request.expectedAuthorityRevision) {\n        return authorityConflictWrapper(request, authority);\n      }\n      const next = frozen({ ...authority, storeVersion: authority.storeVersion + 1,\n        authorityRevision: authority.authorityRevision + 1,\n        transition: { transitionId: request.transitionId,\n          expectedAuthorityRevision: request.expectedAuthorityRevision } });\n      await replaceRecord(transaction, COLLECTIONS.persistenceAuthorities,\n        request.syncedPocketId, authority, next);\n      return frozen({ status: 200, body: { apiVersion: 1, ok: true,\n        operationId: request.operationId, syncedPocketId: request.syncedPocketId,\n        status: "fenced", replayed: false, authority: persistenceAuthoritySnapshot(next) },\n        session: null });\n    });\n  }\n\n  async function releasePersistenceAuthorityFence(value) {\n    const { context, body } = invocation(value);\n    const request = validateAuthorityFenceRequest(body);\n    const at = clockMilliseconds();\n    return transactAuthorityMutation(request.syncedPocketId, async (transaction) => {\n      const { account } = await authoriseSession(transaction, context.sessionId, at);\n      await requireOwnedPocket(transaction, account, request.syncedPocketId);\n      const authority = await readPersistenceAuthorityRecord(transaction, account, request.syncedPocketId);\n      if (authority.authorityRevision !== request.expectedAuthorityRevision\n          || authority.transition === null\n          || authority.transition.transitionId !== request.transitionId) {\n        return authorityConflictWrapper(request, authority);\n      }\n      const next = frozen({ ...authority, storeVersion: authority.storeVersion + 1,\n        authorityRevision: authority.authorityRevision + 1, transition: null });\n      await replaceRecord(transaction, COLLECTIONS.persistenceAuthorities,\n        request.syncedPocketId, authority, next);\n      return frozen({ status: 200, body: { apiVersion: 1, ok: true,\n        operationId: request.operationId, syncedPocketId: request.syncedPocketId,\n        status: "released", authority: persistenceAuthoritySnapshot(next) }, session: null });\n    });\n  }\n'''
s = s[:insert_at] + authority_methods + s[insert_at:]

# Head CAS uses the identical per-pocket lock and authority record.
start = s.index('  async function compareAndSetShadowHead(value) {')
end = s.index('\n  async function', start + 10)
block = s[start:end]
block = once(block,
'''    await authoriseObjectHead(context, request.syncedPocketId);''',
'''    return withPocketAuthorityLock(request.syncedPocketId, async () => {\n      const account = await authoriseObjectHead(context, request.syncedPocketId);\n      const authority = await transact("readonly", (transaction) =>\n        readPersistenceAuthorityRecord(transaction, account, request.syncedPocketId));\n      if (!persistenceAuthorityIsSteady(authority)) {\n        throw serviceError("service-persistence-authority-transition-active", 409);\n      }''', "head lock")
# move the original function's final close outside the lock callback
if not block.rstrip().endswith('  }'):
    raise SystemExit("head block close not found")
trim = block.rstrip()[:-3].rstrip()
block = trim + '\n    });\n  }'
s = s[:start] + block + s[end:]

# expose authority methods from core
s = once(s,
'''    conditionalUpload,\n    listEnvelopes,''',
'''    conditionalUpload,\n    readPersistenceAuthority,\n    acquirePersistenceAuthorityFence,\n    releasePersistenceAuthorityFence,\n    listEnvelopes,''', "core method export")
write(p, s)

# --- HTTP routes ---
p = "sync-service/pocket-sync-http-adapter.js"
s = read(p)
s = once(s,
'''  conditionalUpload: "/pockets/content/conditional-upload",\n  listEnvelopes:''',
'''  conditionalUpload: "/pockets/content/conditional-upload",\n  readPersistenceAuthority: "/pockets/authority/read",\n  acquirePersistenceAuthorityFence: "/pockets/authority/fence/acquire",\n  releasePersistenceAuthorityFence: "/pockets/authority/fence/release",\n  listEnvelopes:''', "http routes")
s = once(s,
'''    statuses: ["conditionalUpload", "addEnvelope", "revokeEnvelope", "initialiseRecovery", "rotateRecovery", "compareAndSetShadowHead"].includes(routeName)''',
'''    statuses: ["conditionalUpload", "acquirePersistenceAuthorityFence",\n      "releasePersistenceAuthorityFence", "addEnvelope", "revokeEnvelope",\n      "initialiseRecovery", "rotateRecovery", "compareAndSetShadowHead"].includes(routeName)''', "http statuses")
write(p, s)

# --- browser remote client: routes, transport statuses, strict authority service, explicit admission errors ---
p = "js/pocket-sync-remote-client.js"
s = read(p)
s = once(s,
'''    conditionalUpload: "/pockets/content/conditional-upload",\n    listEnvelopes:''',
'''    conditionalUpload: "/pockets/content/conditional-upload",\n    readPersistenceAuthority: "/pockets/authority/read",\n    acquirePersistenceAuthorityFence: "/pockets/authority/fence/acquire",\n    releasePersistenceAuthorityFence: "/pockets/authority/fence/release",\n    listEnvelopes:''', "remote routes")
s = once(s,
'''        "conditionalUpload",\n        "addEnvelope",''',
'''        "conditionalUpload",\n        "acquirePersistenceAuthorityFence",\n        "releasePersistenceAuthorityFence",\n        "addEnvelope",''', "remote statuses")
# distinct authority rejection from conditional upload
needle = '''    if (status === 409) {\n      const response = exactObject(input, ['''
replacement = '''    if (status === 409 && input?.apiVersion === 1 && input?.ok === false\n        && input?.reason === "service-persistence-authority-transition-active") {\n      const rejected = exactObject(input, ["apiVersion", "ok", "reason"],\n        ["apiVersion", "ok", "reason"]);\n      if (rejected.apiVersion !== 1 || rejected.ok !== false) throw remoteError("remote-response-invalid");\n      const error = remoteError("remote-authority-transition-active", false, 409);\n      error.definite = true;\n      error.outcome = "definite-failure";\n      throw error;\n    }\n    if (status === 409) {\n      const response = exactObject(input, ['''
if needle not in s: raise SystemExit("conditional 409 marker missing")
s = s.replace(needle, replacement, 1)

# insert persistence authority service before object head service
marker = '''  function createObjectHeadService({ transport } = {}) {'''
auth_service = '''  function validatePersistenceAuthorityState(input) {\n    const value = exactObject(input, ["schema", "authorityRevision", "currentMode",\n      "transition", "rollbackRevision", "adoptionHead"],\n    ["schema", "authorityRevision", "currentMode", "transition", "rollbackRevision", "adoptionHead"]);\n    if (value.schema !== "pocket.sync.persistence-authority.v1"\n        || value.currentMode !== "whole-record" || value.rollbackRevision !== null\n        || value.adoptionHead !== null) throw remoteError("remote-response-invalid");\n    const authorityRevision = revision(value.authorityRevision, 1, "remote-response-invalid");\n    let transition = null;\n    if (value.transition !== null) {\n      const current = exactObject(value.transition, ["transitionId", "expectedAuthorityRevision"],\n        ["transitionId", "expectedAuthorityRevision"]);\n      transition = frozen({ transitionId: identifier(current.transitionId, "remote-response-invalid"),\n        expectedAuthorityRevision: revision(current.expectedAuthorityRevision, 1, "remote-response-invalid") });\n      if (transition.expectedAuthorityRevision + 1 !== authorityRevision) {\n        throw remoteError("remote-response-invalid");\n      }\n    }\n    return frozen({ ...value, authorityRevision, transition });\n  }\n\n  function validatePersistenceAuthorityReadRequest(input) {\n    const value = exactObject(input, ["apiVersion", "operationId", "syncedPocketId"],\n      ["apiVersion", "operationId", "syncedPocketId"], "remote-request-invalid");\n    if (value.apiVersion !== 1) throw remoteError("remote-request-invalid");\n    return frozen({ apiVersion: 1, operationId: identifier(value.operationId),\n      syncedPocketId: identifier(value.syncedPocketId) });\n  }\n\n  function validatePersistenceAuthorityFenceRequest(input) {\n    const fields = ["apiVersion", "operationId", "syncedPocketId",\n      "expectedAuthorityRevision", "transitionId"];\n    const value = exactObject(input, fields, fields, "remote-request-invalid");\n    const expectedAuthorityRevision = revision(value.expectedAuthorityRevision, 1);\n    if (value.apiVersion !== 1 || expectedAuthorityRevision >= Number.MAX_SAFE_INTEGER) {\n      throw remoteError("remote-request-invalid");\n    }\n    return frozen({ apiVersion: 1, operationId: identifier(value.operationId),\n      syncedPocketId: identifier(value.syncedPocketId), expectedAuthorityRevision,\n      transitionId: identifier(value.transitionId) });\n  }\n\n  function validatePersistenceAuthorityBase(input, request) {\n    const value = exactObject(input, ["apiVersion", "ok", "operationId", "syncedPocketId", "authority"],\n      ["apiVersion", "ok", "operationId", "syncedPocketId", "authority"]);\n    if (value.apiVersion !== 1 || value.ok !== true || value.operationId !== request.operationId\n        || value.syncedPocketId !== request.syncedPocketId) throw remoteError("remote-response-invalid");\n    return frozen({ ...value, authority: validatePersistenceAuthorityState(value.authority) });\n  }\n\n  function createPersistenceAuthorityService({ transport } = {}) {\n    const remote = validateTransport(transport);\n    async function read(input) {\n      const request = validatePersistenceAuthorityReadRequest(input);\n      const result = validateTransportResult(await callTransport(remote, "readPersistenceAuthority", request), [200]);\n      return validatePersistenceAuthorityBase(result.body, request);\n    }\n    async function acquireFence(input) {\n      const request = validatePersistenceAuthorityFenceRequest(input);\n      const result = validateTransportResult(await callTransport(remote, "acquirePersistenceAuthorityFence", request), [200, 409]);\n      if (result.status === 200) {\n        const value = exactObject(result.body, ["apiVersion", "ok", "operationId", "syncedPocketId",\n          "status", "replayed", "authority"], ["apiVersion", "ok", "operationId", "syncedPocketId",\n          "status", "replayed", "authority"]);\n        if (value.apiVersion !== 1 || value.ok !== true || value.status !== "fenced"\n            || value.operationId !== request.operationId || value.syncedPocketId !== request.syncedPocketId\n            || typeof value.replayed !== "boolean") throw remoteError("remote-response-invalid");\n        return frozen({ ...value, authority: validatePersistenceAuthorityState(value.authority) });\n      }\n      const value = exactObject(result.body, ["apiVersion", "ok", "operationId", "syncedPocketId",\n        "status", "reason", "authority"], ["apiVersion", "ok", "operationId", "syncedPocketId",\n        "status", "reason", "authority"]);\n      if (value.apiVersion !== 1 || value.ok !== false || value.status !== "conflict"\n          || value.reason !== "authority-conflict" || value.operationId !== request.operationId\n          || value.syncedPocketId !== request.syncedPocketId) throw remoteError("remote-response-invalid");\n      return frozen({ ...value, authority: validatePersistenceAuthorityState(value.authority) });\n    }\n    async function releaseFence(input) {\n      const request = validatePersistenceAuthorityFenceRequest(input);\n      const result = validateTransportResult(await callTransport(remote, "releasePersistenceAuthorityFence", request), [200, 409]);\n      if (result.status === 200) {\n        const value = exactObject(result.body, ["apiVersion", "ok", "operationId", "syncedPocketId",\n          "status", "authority"], ["apiVersion", "ok", "operationId", "syncedPocketId", "status", "authority"]);\n        if (value.apiVersion !== 1 || value.ok !== true || value.status !== "released"\n            || value.operationId !== request.operationId || value.syncedPocketId !== request.syncedPocketId) {\n          throw remoteError("remote-response-invalid");\n        }\n        return frozen({ ...value, authority: validatePersistenceAuthorityState(value.authority) });\n      }\n      const value = exactObject(result.body, ["apiVersion", "ok", "operationId", "syncedPocketId",\n        "status", "reason", "authority"], ["apiVersion", "ok", "operationId", "syncedPocketId",\n        "status", "reason", "authority"]);\n      if (value.apiVersion !== 1 || value.ok !== false || value.status !== "conflict"\n          || value.reason !== "authority-conflict" || value.operationId !== request.operationId\n          || value.syncedPocketId !== request.syncedPocketId) throw remoteError("remote-response-invalid");\n      return frozen({ ...value, authority: validatePersistenceAuthorityState(value.authority) });\n    }\n    return Object.freeze({ read, acquireFence, releaseFence });\n  }\n\n'''
if marker not in s: raise SystemExit("remote object service marker missing")
s = s.replace(marker, auth_service + marker, 1)
# Head CAS explicit authority rejection at object service boundary
needle = '''    async function compareAndSetShadowHead(input) {'''
idx = s.index(needle)
end = s.index('\n    return Object.freeze({', idx)
head_block = s[idx:end]
# after transport result is available, existing minified implementation may be one line; handle by replacing 409 conflict branch token
head_block = head_block.replace('if (result.status===409) {', 'if (result.status===409 && result.body?.reason==="service-persistence-authority-transition-active") return frozen({apiVersion:1,ok:false,operationId:request.operationId,syncedPocketId:request.syncedPocketId,reason:"authority-transition-active"}); if (result.status===409) {', 1)
s = s[:idx] + head_block + s[end:]
s = once(s,
'''    createContentService,\n    createObjectHeadService,''',
'''    createContentService,\n    createPersistenceAuthorityService,\n    createObjectHeadService,''', "remote export")
write(p, s)

# --- focused P166 service/lock proof ---
p = "tests/p166-persistence-authority-fence.test.js"
write(p, r'''"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createServiceCore } = require("../sync-service/pocket-sync-service-core.js");
const { createPostgresStore } = require("../sync-service/pocket-sync-postgres-store.js");
const { createMemoryServiceStore } = require("./helpers/p034-memory-service-store.js");

const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2044-01-01T00:00:00.000Z");
const ORIGIN = "https://sync.pocket.example";
const b64 = (n, seed = 1) => Buffer.from(Uint8Array.from({ length: n }, (_, i) => (seed + i) & 255)).toString("base64url");
const plain = (v) => JSON.parse(JSON.stringify(v));
const encrypted = (seed = 1) => ({ format: "pocket.sync.content.opaque", version: 1,
  algorithm: "AES-GCM-256", nonce: b64(12, seed), ciphertext: b64(32, seed + 30) });
const context = (sessionId = "session") => ({ method: "POST", origin: ORIGIN,
  fetchSite: "same-origin", contentType: "application/json", sessionId });
const call = (body, sessionId = "session") => ({ context: context(sessionId), body });

function seed() {
  return {
    accounts: { account: { kind: "pocket.sync.service-account", schemaVersion: 1, storeVersion: 1,
      accountId: "account", accountPolicyVersion: 1, prfEvaluationInput: b64(32, 2),
      credentialIds: ["credential"], syncedPocketId: "pocket", createdAt: "2043-01-01T00:00:00.000Z" } },
    credentials: { credential: { kind: "pocket.sync.service-credential", schemaVersion: 1, storeVersion: 1,
      credentialId: "credential", accountId: "account", credentialVersion: 1, status: "active",
      publicKey: b64(64, 4), publicKeyAlgorithm: -7, signCount: 0, transports: ["internal"],
      backupEligible: true, backedUp: true, createdAt: "2043-01-01T00:00:00.000Z" } },
    sessions: { session: { kind: "pocket.sync.service-session", schemaVersion: 1, storeVersion: 1,
      sessionId: "session", accountId: "account", credentialId: "credential", status: "active",
      createdAt: "2043-01-01T00:00:00.000Z", expiresAt: "2045-01-01T00:00:00.000Z", replacedBy: null } },
    pockets: { pocket: { kind: "pocket.sync.service-pocket", schemaVersion: 1, storeVersion: 1,
      accountId: "account", syncedPocketId: "pocket", revision: 1,
      encryptedRecordSize: 32, encryptedRecord: encrypted(8), createdAt: "2043-01-01T00:00:00.000Z" } },
    persistenceAuthorities: { pocket: { kind: "pocket.sync.persistence-authority", schemaVersion: 1,
      storeVersion: 1, accountId: "account", syncedPocketId: "pocket", authorityRevision: 1,
      currentMode: "whole-record", transition: null, rollbackRevision: null, adoptionHead: null } },
  };
}

function headStore() {
  let head = { schema: "pocket.starling.head.v1", revision: 1, sealRef: "seal-one" };
  return Object.freeze({
    async putObject() { return { ok: true, created: true }; },
    async getObject() { return null; },
    async presence(_pocket, refs) { return refs.map((storageRef) => ({ storageRef, present: true })); },
    async initialiseHead() { return head; },
    async readHead() { return head; },
    async compareAndSetHead(_pocket, expected, candidate) {
      if (head.revision !== expected.revision || head.sealRef !== expected.sealRef) return { ok: false, reason: "head-conflict" };
      head = { schema: head.schema, revision: head.revision + 1, sealRef: candidate };
      return { ok: true, head };
    },
  });
}

function coreWithStore(store, objectHeadStore = headStore()) {
  return createServiceCore({ store, objectHeadStore,
    webAuthnVerifier: Object.freeze({ async verifyRegistration() { throw new Error("unused"); }, async verifyAuthentication() { throw new Error("unused"); } }),
    recoveryProofVerifier: Object.freeze({ async verifyRecoveryProof() { return { verified: true }; } }),
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => i + 1), now: () => NOW,
    trustedOrigin: ORIGIN, rpId: "sync.pocket.example", rpName: "Pocket", credentialAlgorithms: [-7],
    ceremonyLifetimeMs: 300000, sessionLifetimeMs: 86400000 });
}

function upload(operationId, expectedRevision, seed = 20) {
  return { apiVersion: 1, syncedPocketId: "pocket", expectedRevision, operationId,
    logicalChangeId: `${operationId}-change`, attemptKind: "new-change", encryptedRecord: encrypted(seed) };
}
function fence(operationId, expectedAuthorityRevision, transitionId = "transition-one") {
  return { apiVersion: 1, operationId, syncedPocketId: "pocket", expectedAuthorityRevision, transitionId };
}
function cas(operationId, revision = 1, sealRef = "seal-one", candidate = "seal-two") {
  return { apiVersion: 1, operationId, syncedPocketId: "pocket",
    expectedHead: { schema: "pocket.starling.head.v1", revision, sealRef }, candidateSealStorageRef: candidate };
}

function harness(storeOverride = null) {
  const driver = createMemoryServiceStore({ seed: seed() });
  const store = storeOverride ? storeOverride(driver.store) : driver.store;
  return { driver, core: coreWithStore(store) };
}

test("P166 authority is shared server metadata, fences both mutation families, and release restores admission", async () => {
  const h = harness();
  const before = h.driver.snapshot().pockets.pocket;
  const read = await h.core.readPersistenceAuthority(call({ apiVersion: 1, operationId: "read-one", syncedPocketId: "pocket" }));
  assert.equal(read.body.authority.authorityRevision, 1);
  assert.equal(read.body.authority.currentMode, "whole-record");
  assert.equal(read.body.authority.transition, null);

  const saved = await h.core.conditionalUpload(call(upload("save-one", 1)));
  assert.equal(saved.status, 200);
  const mirrored = await h.core.compareAndSetShadowHead(call(cas("cas-one")));
  assert.equal(mirrored.status, 200);

  const acquired = await h.core.acquirePersistenceAuthorityFence(call(fence("fence-one", 1)));
  assert.equal(acquired.status, 200);
  assert.equal(acquired.body.authority.authorityRevision, 2);
  assert.deepEqual(plain(acquired.body.authority.transition), { transitionId: "transition-one", expectedAuthorityRevision: 1 });

  await assert.rejects(h.core.conditionalUpload(call(upload("blocked-save", 2))),
    (error) => error?.code === "service-persistence-authority-transition-active" && error.status === 409);
  await assert.rejects(h.core.compareAndSetShadowHead(call(cas("blocked-cas", 2, "seal-two", "seal-three"))),
    (error) => error?.code === "service-persistence-authority-transition-active" && error.status === 409);

  const during = h.driver.snapshot();
  assert.deepEqual(during.pockets.pocket.encryptedRecord, saved.body.revision === 2 ? encrypted(20) : before.encryptedRecord);
  const replay = await h.core.acquirePersistenceAuthorityFence(call(fence("fence-replay", 1)));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  const stale = await h.core.acquirePersistenceAuthorityFence(call(fence("fence-stale", 1, "other-transition")));
  assert.equal(stale.status, 409);
  assert.equal(stale.body.reason, "authority-conflict");

  const released = await h.core.releasePersistenceAuthorityFence(call(fence("release-one", 2)));
  assert.equal(released.status, 200);
  assert.equal(released.body.authority.authorityRevision, 3);
  assert.equal(released.body.authority.transition, null);
  const savedAgain = await h.core.conditionalUpload(call(upload("save-two", 2, 40)));
  assert.equal(savedAgain.status, 200);
  assert.equal(savedAgain.body.revision, 3);
});

test("P166 exact operation replay stays truthful while a transition fence blocks only new mutations", async () => {
  const h = harness();
  const first = await h.core.conditionalUpload(call(upload("same-save", 1)));
  assert.equal(first.status, 200);
  await h.core.acquirePersistenceAuthorityFence(call(fence("fence", 1)));
  const retry = upload("same-save", 1);
  retry.attemptKind = "idempotent-retry";
  const replay = await h.core.conditionalUpload(call(retry));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  await assert.rejects(h.core.conditionalUpload(call(upload("new-save", 2))),
    (error) => error?.code === "service-persistence-authority-transition-active");
});

function controlledFirstLock(baseStore) {
  let firstEnteredResolve;
  let releaseFirstResolve;
  const firstEntered = new Promise((resolve) => { firstEnteredResolve = resolve; });
  const releaseFirst = new Promise((resolve) => { releaseFirstResolve = resolve; });
  let calls = 0;
  return {
    store: Object.freeze({ transact: baseStore.transact,
      withPocketAuthorityLock(pocket, callback) {
        calls += 1;
        const ordinal = calls;
        return baseStore.withPocketAuthorityLock(pocket, async () => {
          if (ordinal === 1) { firstEnteredResolve(); await releaseFirst; }
          return callback();
        });
      } }),
    firstEntered,
    release: () => releaseFirstResolve(),
  };
}

test("P166 in-flight whole-record mutation and fence acquisition serialize in both directions", async () => {
  {
    const base = createMemoryServiceStore({ seed: seed() });
    const controlled = controlledFirstLock(base.store);
    const core = coreWithStore(controlled.store);
    const savePromise = core.conditionalUpload(call(upload("racing-save", 1)));
    await controlled.firstEntered;
    let fenceSettled = false;
    const fencePromise = core.acquirePersistenceAuthorityFence(call(fence("racing-fence", 1))).then((v) => { fenceSettled = true; return v; });
    await Promise.resolve();
    assert.equal(fenceSettled, false);
    controlled.release();
    const [saveResult, fenceResult] = await Promise.all([savePromise, fencePromise]);
    assert.equal(saveResult.status, 200);
    assert.equal(fenceResult.status, 200);
    assert.equal(base.snapshot().pockets.pocket.revision, 2);
    assert.notEqual(base.snapshot().persistenceAuthorities.pocket.transition, null);
  }
  {
    const base = createMemoryServiceStore({ seed: seed() });
    const controlled = controlledFirstLock(base.store);
    const core = coreWithStore(controlled.store);
    const fencePromise = core.acquirePersistenceAuthorityFence(call(fence("racing-fence-first", 1)));
    await controlled.firstEntered;
    let saveSettled = false;
    const savePromise = core.conditionalUpload(call(upload("racing-save-second", 1))).then(
      (v) => { saveSettled = true; return v; },
      (error) => { saveSettled = true; throw error; }
    );
    await Promise.resolve();
    assert.equal(saveSettled, false);
    controlled.release();
    const fenced = await fencePromise;
    assert.equal(fenced.status, 200);
    await assert.rejects(savePromise, (error) => error?.code === "service-persistence-authority-transition-active");
    assert.equal(base.snapshot().pockets.pocket.revision, 1);
  }
});

test("P166 PostgreSQL store takes and releases the shared advisory lock around the whole callback", async () => {
  const events = [];
  const client = { async query(sql, values) {
    if (sql.includes("pg_advisory_lock")) { events.push(["lock", values[0]]); return { rows: [{ locked: null }], rowCount: 1 }; }
    if (sql.includes("pg_advisory_unlock")) { events.push(["unlock", values[0]]); return { rows: [{ unlocked: true }], rowCount: 1 }; }
    throw new Error(sql);
  }, release() { events.push(["release"]); } };
  const store = createPostgresStore({ pool: { async connect() { events.push(["connect"]); return client; } } });
  const result = await store.withPocketAuthorityLock("pocket", async () => { events.push(["callback"]); return 17; });
  assert.equal(result, 17);
  assert.deepEqual(events.map((entry) => entry[0]), ["connect", "lock", "callback", "unlock", "release"]);
});

test("P166 migration backfills operational authority metadata without rewriting encrypted Pocket content", () => {
  const sql = fs.readFileSync(path.join(ROOT, "sync-service/migrations/003-pocket-sync-persistence-authority.sql"), "utf8");
  assert.match(sql, /persistenceAuthorities/);
  assert.match(sql, /WHERE collection = 'pockets'/);
  assert.doesNotMatch(sql, /UPDATE\s+public\.pocket_sync_records[\s\S]*encryptedRecord/i);
  assert.doesNotMatch(sql, /currentMode['\"]?\s*[,=]\s*['\"]starling/i);
});
''')

print("P166 patch applied")
