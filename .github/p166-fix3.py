from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text()

def write(path, text):
    (ROOT / path).write_text(text)

def once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1, found {count}")
    return text.replace(old, new, 1)

# Preserve the pre-existing ownership error ordering: an unbound account must
# reach the existing-Pocket collision check before authority metadata belonging
# to another account is interpreted as service state.
p = "sync-service/pocket-sync-service-core.js"
s = read(p)
s = once(s,
'''      const authority = await readPersistenceAuthorityRecord(
        transaction, account, request.syncedPocketId,
        { allowMissing: pocket === null && account.syncedPocketId === null }
      );''',
'''      const authority = account.syncedPocketId === null
        ? null
        : await readPersistenceAuthorityRecord(transaction, account, request.syncedPocketId);''',
"conditional upload ownership ordering")
write(p, s)

# P047's compatibility harness predates the now-required object/Head service
# dependency. Supply the inert exact six-method fixture already required by the
# accepted service-core contract; this test exercises registration only.
p = "tests/p047-postgres-store.test.js"
s = read(p)
s = once(s,
'''    store: createPostgresStore({ pool: controlled.pool }),
    webAuthnVerifier:''',
'''    store: createPostgresStore({ pool: controlled.pool }),
    objectHeadStore: Object.freeze({
      async putObject() { return { ok: true, created: true }; },
      async getObject() { return null; },
      async presence(_pocket, refs) { return refs.map((storageRef) => ({ storageRef, present: false })); },
      async initialiseHead() { return Object.freeze({ schema: "pocket.starling.head.v1", revision: 0, sealRef: null }); },
      async readHead() { return null; },
      async compareAndSetHead() { return { ok: false, reason: "head-conflict" }; },
    }),
    webAuthnVerifier:''',
"p047 object head fixture")
write(p, s)

# P052 has two service-core construction sites which also predate the accepted
# object/Head dependency. Keep them production-shaped with the same inert exact
# fixture; P052 does not exercise Starling transport itself.
p = "tests/p052-additional-device.test.js"
s = read(p)
needle = '''    store: serviceDriver.store,
    webAuthnVerifier:'''
replacement = '''    store: serviceDriver.store,
    objectHeadStore: Object.freeze({
      async putObject() { return { ok: true, created: true }; },
      async getObject() { return null; },
      async presence(_pocket, refs) { return refs.map((storageRef) => ({ storageRef, present: false })); },
      async initialiseHead() { return Object.freeze({ schema: "pocket.starling.head.v1", revision: 0, sealRef: null }); },
      async readHead() { return null; },
      async compareAndSetHead() { return { ok: false, reason: "head-conflict" }; },
    }),
    webAuthnVerifier:'''
count = s.count(needle)
if count != 2:
    raise SystemExit(f"p052 object head fixtures: expected 2, found {count}")
s = s.replace(needle, replacement)
write(p, s)

# The P118 version fixture gained a third marker. Removing the last row now
# means persistence-authority, not object/Head; remove the object/Head row by
# identity position so the historical assertion still proves what it names.
p = "tests/p118-object-head-schema-adoption.test.js"
s = read(p)
s = once(s,
'''    ["missing object Head row", "object-head-schema-version-value", (fixture) => { fixture.versions.pop(); }],''',
'''    ["missing object Head row", "object-head-schema-version-value", (fixture) => { fixture.versions.splice(1, 1); }],''',
"p118 missing object head row")
write(p, s)

print("P166 affected compatibility repairs applied")
