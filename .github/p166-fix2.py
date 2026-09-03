from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def read(path): return (ROOT / path).read_text()
def write(path, text): (ROOT / path).write_text(text)
def once(text, old, new, label):
    count = text.count(old)
    if count != 1: raise SystemExit(f"{label}: expected 1, found {count}")
    return text.replace(old, new, 1)

# Preserve the historic exact public store surface {transact}. The new shared
# fence is a non-enumerable private capability on that existing function.
p = "sync-service/pocket-sync-postgres-store.js"
s = read(p)
s = once(s,
'''  return Object.freeze({ transact, withPocketAuthorityLock });''',
'''  Object.defineProperty(transact, "withPocketAuthorityLock", { value: withPocketAuthorityLock });
  return Object.freeze({ transact });''', "postgres private lock")
write(p, s)

p = "tests/helpers/p034-memory-service-store.js"
s = read(p)
s = once(s,
'''  const store = Object.freeze({ transact, withPocketAuthorityLock });''',
'''  Object.defineProperty(transact, "withPocketAuthorityLock", { value: withPocketAuthorityLock });
  const store = Object.freeze({ transact });''', "memory private lock")
write(p, s)

p = "sync-service/pocket-sync-service-core.js"
s = read(p)
s = once(s,
'''      || !sameKeys(input.store, ["transact", "withPocketAuthorityLock"])
      || typeof input.store.transact !== "function"
      || typeof input.store.withPocketAuthorityLock !== "function"''',
'''      || !sameKeys(input.store, ["transact"])
      || typeof input.store.transact !== "function"''', "core public store surface")
s = once(s,
'''      pending = store.withPocketAuthorityLock(syncedPocketId, callback);
      if (!thenable(pending)) throw serviceError("service-core-invalid", 500);''',
'''      const lock = store.transact.withPocketAuthorityLock;
      if (typeof lock !== "function") throw serviceError("service-core-invalid", 500);
      pending = lock(syncedPocketId, callback);
      if (!thenable(pending)) throw serviceError("service-core-invalid", 500);''', "core private lock capability")
s = once(s,
'''      } else if (authority !== null) {
        throw serviceError("service-state-invalid", 500);
      }
      const actualRevision''',
'''      }
      const actualRevision''', "ownership collision ordering")
s = once(s,
'''    return withPocketAuthorityLock(request.syncedPocketId, async () => {
      const account = await authoriseObjectHead(context, request.syncedPocketId);
      const authority = await transact("readonly", (transaction) =>''',
'''    const account = await authoriseObjectHead(context, request.syncedPocketId);
    return withPocketAuthorityLock(request.syncedPocketId, async () => {
      const authority = await transact("readonly", (transaction) =>''', "head auth before lock")
write(p, s)

p = "tests/p032-sync-remote-client.test.js"
s = read(p)
s = once(s,
'''    conditionalUpload: "/pockets/content/conditional-upload",
    listEnvelopes:''',
'''    conditionalUpload: "/pockets/content/conditional-upload",
    readPersistenceAuthority: "/pockets/authority/read",
    acquirePersistenceAuthorityFence: "/pockets/authority/fence/acquire",
    releasePersistenceAuthorityFence: "/pockets/authority/fence/release",
    listEnvelopes:''', "p032 routes")
s = once(s,
'''  assert.throws(() => api.createContentService({ transport: {} }), remoteErrorCode("remote-transport-invalid"));''',
'''  assert.deepEqual(
    Object.keys(api.createPersistenceAuthorityService({ transport })),
    ["read", "acquireFence", "releaseFence"]
  );
  assert.throws(() => api.createContentService({ transport: {} }), remoteErrorCode("remote-transport-invalid"));''', "p032 authority surface")
write(p, s)

p = "tests/p034-sync-service-core.test.js"
s = read(p)
s = once(s,
'''    "recoveryCeremonies",
    "keyOperations",
  ]);''',
'''    "recoveryCeremonies",
    "keyOperations",
    "persistenceAuthorities",
  ]);''', "p034 collections")
s = once(s,
'''    "conditionalUpload",
    "listEnvelopes",''',
'''    "conditionalUpload",
    "readPersistenceAuthority",
    "acquirePersistenceAuthorityFence",
    "releasePersistenceAuthorityFence",
    "listEnvelopes",''', "p034 methods")
write(p, s)

p = "tests/p047-postgres-store.test.js"
s = read(p)
s = once(s,
'''    "keySets", "envelopes", "recoveryLocators", "recoveryCeremonies", "keyOperations",
  ]);''',
'''    "keySets", "envelopes", "recoveryLocators", "recoveryCeremonies", "keyOperations",
    "persistenceAuthorities",
  ]);''', "p047 collections")
write(p, s)

p = "tests/p049-sync-server-runtime.test.js"
s = read(p)
s = s.replace("'recoveryCeremonies','keyOperations'))", "'recoveryCeremonies','keyOperations','persistenceAuthorities'))")
s = once(s,
'''    versions: [{ schema_name: "pocket-sync-store", schema_version: 1 }, { schema_name: "pocket-sync-object-head-store", schema_version: 1 }],''',
'''    versions: [{ schema_name: "pocket-sync-store", schema_version: 1 }, { schema_name: "pocket-sync-object-head-store", schema_version: 1 }, { schema_name: "pocket-sync-persistence-authority", schema_version: 1 }],''', "p049 versions")
s = once(s,
'''          if (!began) throw new Error("query outside transaction");
          const rowKey = key(values[0], values[1]);''',
'''          if (sql.includes("pg_advisory_lock")) return { rows: [{ locked: null }], rowCount: 1 };
          if (sql.includes("pg_advisory_unlock")) return { rows: [{ unlocked: true }], rowCount: 1 };
          if (!began) throw new Error("query outside transaction");
          const rowKey = key(values[0], values[1]);''', "p049 advisory SQL")
s = once(s,
'''    assert.equal(calls[2], source("sync-service/migrations/002-pocket-sync-object-head-store.sql"));
    assert.equal(calls[3], "verify");''',
'''    assert.equal(calls[2], source("sync-service/migrations/002-pocket-sync-object-head-store.sql"));
    assert.equal(calls[3], source("sync-service/migrations/003-pocket-sync-persistence-authority.sql"));
    assert.equal(calls[4], "verify");''', "p049 migrations")
write(p, s)

p = "tests/p118-object-head-schema-adoption.test.js"
s = read(p)
s = once(s,
'''const SECOND_MIGRATION = path.join(ROOT, "sync-service/migrations/002-pocket-sync-object-head-store.sql");''',
'''const SECOND_MIGRATION = path.join(ROOT, "sync-service/migrations/002-pocket-sync-object-head-store.sql");
const THIRD_MIGRATION = path.join(ROOT, "sync-service/migrations/003-pocket-sync-persistence-authority.sql");''', "p118 const")
s = s.replace("'recoveryCeremonies','keyOperations'))", "'recoveryCeremonies','keyOperations','persistenceAuthorities'))")
s = once(s,
'''      { schema_name: "pocket-sync-object-head-store", schema_version: 1 },
    ],''',
'''      { schema_name: "pocket-sync-object-head-store", schema_version: 1 },
      { schema_name: "pocket-sync-persistence-authority", schema_version: 1 },
    ],''', "p118 versions")
s = once(s,
'''test("P118 runs the two fixed additive migrations in order before verification", async () => {''',
'''test("P118 runs the three fixed additive migrations in order before verification", async () => {''', "p118 title")
s = once(s,
'''    fs.readFileSync(SECOND_MIGRATION, "utf8"),
    "verify",''',
'''    fs.readFileSync(SECOND_MIGRATION, "utf8"),
    fs.readFileSync(THIRD_MIGRATION, "utf8"),
    "verify",''', "p118 expected migrations")
s = once(s,
'''  for (const failAt of [1, 2]) await t.test(`apply ${failAt}`, async () => {''',
'''  for (const failAt of [1, 2, 3]) await t.test(`apply ${failAt}`, async () => {''', "p118 fail range")
s = once(s,
'''    assert.deepEqual(dependencies.calls, failAt === 1
      ? [fs.readFileSync(FIRST_MIGRATION, "utf8")]
      : [fs.readFileSync(FIRST_MIGRATION, "utf8"), fs.readFileSync(SECOND_MIGRATION, "utf8")]);''',
'''    const expected = [fs.readFileSync(FIRST_MIGRATION, "utf8"), fs.readFileSync(SECOND_MIGRATION, "utf8"), fs.readFileSync(THIRD_MIGRATION, "utf8")];
    assert.deepEqual(dependencies.calls, expected.slice(0, failAt));''', "p118 fail expected")
s = once(s,
'''  const second = fs.readFileSync(SECOND_MIGRATION, "utf8");''',
'''  const second = fs.readFileSync(SECOND_MIGRATION, "utf8");
  const third = fs.readFileSync(THIRD_MIGRATION, "utf8");''', "p118 third read")
s = once(s,
'''  assert.doesNotMatch(second, /INSERT INTO public\.pocket_sync_(objects|heads)|UPDATE public\.pocket_sync_|DELETE FROM public\.pocket_sync_/i);''',
'''  assert.doesNotMatch(second, /INSERT INTO public\.pocket_sync_(objects|heads)|UPDATE public\.pocket_sync_|DELETE FROM public\.pocket_sync_/i);
  assert.match(third, /INSERT INTO public\.pocket_sync_records/);
  assert.match(third, /WHERE collection = 'pockets'/);
  assert.doesNotMatch(third, /UPDATE\s+public\.pocket_sync_records[\s\S]*encryptedRecord/i);''', "p118 third semantics")
s = once(s,
'''    ["wrong object Head version", "object-head-schema-version-value", (fixture) => { fixture.versions[1].schema_version = 2; }],
    ["missing legacy row", "schema-version-value", (fixture) => { fixture.versions.shift(); }],''',
'''    ["wrong object Head version", "object-head-schema-version-value", (fixture) => { fixture.versions[1].schema_version = 2; }],
    ["missing persistence authority row", "schema-version-value", (fixture) => { fixture.versions.pop(); }],
    ["wrong persistence authority version", "schema-version-value", (fixture) => { fixture.versions[2].schema_version = 2; }],
    ["missing legacy row", "schema-version-value", (fixture) => { fixture.versions.shift(); }],''', "p118 version cases")
write(p, s)

p = "tests/p119-object-head-server-transport.test.js"
s = read(p)
s = once(s,
'''  const generic = Object.freeze({ async transact(_mode, fn) { return fn(Object.freeze({ async get(collection,key) { reads.push([collection,key]); return rows.get(`${collection}\\0${key}`) || null; }, async insert(){},async replace(){},async remove(){} })); } });''',
'''  const transact = async function transact(_mode, fn) { return fn(Object.freeze({ async get(collection,key) { reads.push([collection,key]); return rows.get(`${collection}\\0${key}`) || null; }, async insert(){},async replace(){},async remove(){} })); };
  Object.defineProperty(transact, "withPocketAuthorityLock", { value: async (_pocket, callback) => callback() });
  rows.set(`persistenceAuthorities\\0${pocket}`, { kind:"pocket.sync.persistence-authority",schemaVersion:1,storeVersion:1,accountId:id,syncedPocketId:pocket,authorityRevision:1,currentMode:"whole-record",transition:null,rollbackRevision:null,adoptionHead:null });
  const generic = Object.freeze({ transact });''', "p119 lock")
write(p, s)

print("P166 compatibility fixes applied")
