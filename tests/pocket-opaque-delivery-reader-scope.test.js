"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { createHttpAdapter, POLICY, ROUTES } = require("../sync-service/pocket-sync-http-adapter.js");
const { createPostgresStore } = require("../sync-service/pocket-sync-postgres-store.js");
const { createObjectHeadPostgresStore, REFERENCE_PREFIX } = require("../sync-service/pocket-sync-object-head-postgres-store.js");
const { openSourceCapsule } = require("../tools/pocket-legacy-intake-bridge.js");

function fixture(file, exports, adapt = source => source) {
  const source = fs.readFileSync(path.join(__dirname, file), "utf8")
    .replace('const test = require("node:test");', "const test = () => {};");
  return new Function("require", "__dirname", adapt(source) + "\nreturn " + exports)(require, __dirname);
}

const { world, request, grant, placement, post, SESSION, PEER } = fixture("pocket-source-custody.test.js",
  "{ world, request, grant, placement, post, SESSION, PEER }", source => source
    .replace("get admin() { return admin; },", "get server() { return server; }, get admin() { return admin; },")
    .replace("runtime, accountKey: key.masterKey, head: copy(opened.head)",
      "runtime, accountKey: key.masterKey, semanticAuthority: key.semanticAuthority, head: copy(opened.head)"));
const { ORIGIN, core } = fixture("p168-authority-adoption.test.js", "{ ORIGIN, core }");
const serviceRoot = "/pocket-sync/v1";
const context = { syncedPocketId: "p146" };
const CAPSULE = "peMigrationLegacySourcePreserved";
const noSource = { ok: false, reason: "source-unavailable" };
const guessed = REFERENCE_PREFIX + Buffer.alloc(32, 109).toString("base64url");
const hash = text => createHash("sha256").update(text).digest("hex");
const publicContent = ({ label, details }) => ({ label, details });
let sequence = 0;
const id = kind => kind + "-" + (++sequence);
const call = (handle, route, params = {}, actor = PEER) =>
  post(handle, route, { apiVersion: 1, operationId: id(route), ...params }, undefined, actor);

async function decode(viewer, ref, record) {
  const bytes = await viewer.runtime.PocketStarlingCryptoShadow.openObject(record, ref, viewer.accountKey, context);
  return viewer.runtime.PocketStarlingStorageShadow.validateCapsuleBytes(bytes);
}

async function openReader(viewer, handle, interrupt) {
  const records = new Map();
  const factory = id("reader");
  const objectHeadService = viewer.runtime.PocketSyncRemoteClient.createObjectHeadService({
    transport: {
      async request(route, body) {
        if (route === "getOpaqueObject" && body.storageRef === interrupt) throw new Error("Synthetic transport interruption");
        const reply = await post(handle, route, body, undefined, PEER);
        if (route === "getOpaqueObject" && reply.body.present) records.set(body.storageRef, reply.body.record);
        return reply;
      },
    },
  });
  const opened = await viewer.runtime.PocketStarlingRemoteOpenShadow.createRemoteOpener({
    objectHeadService, operationIdFactory: (kind, index) => [factory, kind, index].join("-"),
  }).openRemote({ masterKey: viewer.accountKey, semanticAuthority: viewer.semanticAuthority, context });
  assert.equal(opened.outcome, "opened");
  return { opened, records };
}

async function readThought(viewer, handle) {
  const { opened, records } = await openReader(viewer, handle);
  const thought = await opened.session.readContent(placement.nodeId);
  assert.equal(thought.ok, true);
  const bound = [];
  for (const [ref, record] of records) {
    const capsule = await decode(viewer, ref, record);
    if (capsule.logicalKind === "content-record" && capsule.object.nodeId === placement.nodeId) {
      bound.push({ ref, record, payload: capsule.object.payload });
    }
  }
  assert.equal(bound.length, 1);
  return { ...bound[0], head: JSON.parse(JSON.stringify(opened.head)) };
}

function storeVariant(world, alter) {
  const pool = world.server.raw;
  const objectHeadStore = alter(createObjectHeadPostgresStore({ pool }));
  const sync = core({ store: createPostgresStore({ pool }) }, { store: objectHeadStore });
  return createHttpAdapter({ core: sync, trustedOrigin: ORIGIN, serviceRoot }).handle;
}

function withhold(world, target, hidePresence = true) {
  return storeVariant(world, stock => Object.freeze({
    ...stock,
    async getObject(pocket, ref) {
      return ref === target ? null : stock.getObject(pocket, ref);
    },
    async presence(pocket, refs) {
      const result = await stock.presence(pocket, refs);
      return hidePresence ? result.map(row => row.storageRef === target ? { ...row, present: false } : row) : result;
    },
  }));
}

function assertAbsent(reply) {
  assert.equal(reply.status, 200);
  assert.equal(reply.body.present, false);
  assert.equal(reply.body.record, null);
}

async function revokeSession(world) {
  const store = createPostgresStore({ pool: world.admin });
  await store.transact("readwrite", async tx => {
    const viewer = await tx.get("sessions", PEER);
    await tx.replace("sessions", PEER, viewer.storeVersion, {
      ...viewer, storeVersion: viewer.storeVersion + 1, status: "revoked", replacedBy: SESSION,
    });
  });
}

test("current opaque delivery cannot hide a source in the same encrypted record as an authorised thought", { timeout: 120000 }, async t => {
  const hidden = await world(t, true), absent = await world(t, false);
  const [withSource, withoutSource] = await Promise.all([hidden.rawViewer(), absent.rawViewer()]);
  const [x, plainX] = await Promise.all([
    readThought(withSource, hidden.server.handle), readThought(withoutSource, absent.server.handle),
  ]);
  const inner = x.payload[CAPSULE];
  assert.ok(inner);
  assert.equal(Object.hasOwn(plainX.payload, CAPSULE), false);
  assert.deepEqual(publicContent(x.payload), publicContent(plainX.payload));
  assert.equal(x.head.revision, plainX.head.revision);
  assert.ok(x.record.ciphertext.length > plainX.record.ciphertext.length);
  assert.ok(inner.record.ciphertext.length > 125000);

  await t.test("the actual Head, object lookup and presence routes expose the combined record", async () => {
    assert.deepEqual(await hidden.custody.view(placement), await absent.custody.view(placement));
    assert.deepEqual(await hidden.custody.open(request(hidden)), noSource);
    assert.deepEqual(await absent.custody.open(request(absent)), noSource);
    const owner = await grant(hidden, { readerSession: SESSION });
    assert.equal(owner.ok, true);
    const original = await hidden.custody.open(request(hidden, owner.token, { sessionId: SESSION }));
    assert.ok(hidden.firstJson.length > 125000);
    assert.equal(original.json === hidden.firstJson, true);
    assert.equal(hash(original.json), hidden.coordinates.get("original-y").version);
    assert.deepEqual(await openSourceCapsule(withSource.runtime, {
      capsule: inner, capsuleKey: withSource.accountKey, ...context, sourceSha256: hidden.exportDigest,
      nodeId: placement.nodeId,
    }), noSource);

    const lengths = [];
    for (const [sample, captured] of [[hidden, x], [absent, plainX]]) {
      const handle = sample.server.handle;
      const head = await call(handle, "readShadowHead");
      assert.equal(head.status, 200);
      assert.deepEqual(head.body.head, captured.head);
      const replay = await call(handle, "getOpaqueObject", { storageRef: captured.ref });
      assert.equal(replay.status, 200);
      assert.equal(replay.body.present, true);
      assert.equal(replay.body.record.ciphertext === captured.record.ciphertext, true);
      const refs = [captured.head.sealRef, captured.ref, inner.ref, guessed];
      const presence = await call(handle, "objectPresence", { storageRefs: refs });
      assert.equal(presence.status, 200);
      assert.deepEqual(presence.body.rows, refs.map((storageRef, index) => ({ storageRef, present: index < 2 })));
      for (const ref of [inner.ref, guessed]) assertAbsent(await call(handle, "getOpaqueObject", { storageRef: ref }));
      const invalidRef = await call(handle, "getOpaqueObject", { storageRef: "invalid" });
      assert.equal(invalidRef.status, 400);
      assert.deepEqual(invalidRef.body, { apiVersion: 1, ok: false, reason: "service-request-invalid" });
      assert.equal((await call(handle, "getOpaqueObject", { storageRef: captured.ref, syncedPocketId: "unowned-pocket" })).status, 403);
      const alias = new Request(ORIGIN + serviceRoot + ROUTES.getOpaqueObject + "?view=alternative", {
        method: "POST",
      });
      assert.equal((await handle(alias)).status, 404);
      lengths.push(replay.body.record.ciphertext.length);
    }
    t.diagnostic("Viewer-observable X ciphertext lengths with / without the hidden original: " + lengths.join(" / "));
  });

  await t.test("withholding the inner reference exposes the capsule, withholding the outer record also removes X", async () => {
    const innerOnly = withhold(hidden, inner.ref);
    const stillCombined = await readThought(withSource, innerOnly);
    assert.equal(stillCombined.payload[CAPSULE].ref, inner.ref);
    const getOnly = withhold(hidden, x.ref, false);
    assertAbsent(await call(getOnly, "getOpaqueObject", { storageRef: x.ref }));
    assert.equal((await call(getOnly, "objectPresence", { storageRefs: [x.ref] })).body.rows[0].present, true);

    const both = withhold(hidden, x.ref);
    assertAbsent(await call(both, "getOpaqueObject", { storageRef: x.ref }));
    const presence = await call(both, "objectPresence", { storageRefs: [x.ref, guessed] });
    assert.deepEqual(presence.body.rows.map(row => row.present), [false, false]);
    const blocked = await openReader(withSource, both);
    assert.equal(blocked.opened.head.sealRef, x.head.sealRef);
    assert.equal(blocked.opened.head.revision, x.head.revision);
    await assert.rejects(blocked.opened.session.readContent(placement.nodeId), { code: "remote-open-object-missing" });
    const openElsewhere = await readThought(withoutSource, absent.server.handle);
    assert.deepEqual(publicContent(openElsewhere.payload), publicContent(x.payload));
    const interrupted = await openReader(withSource, hidden.server.handle, x.ref);
    await assert.rejects(interrupted.opened.session.readContent(placement.nodeId));
    assert.deepEqual((await call(hidden.server.handle, "readShadowHead")).body.head, x.head);
  });

  await t.test("the retained whole record and portable serializers have distinct observed behaviour", async () => {
    const rollbackDocuments = [];
    for (const [sample, viewer, record] of [[hidden, withSource, x], [absent, withoutSource, plainX]]) {
      const rollback = await call(sample.server.handle, "downloadEncryptedRecord", { revision: 1 });
      assert.equal(rollback.status, 200);
      const content = await viewer.runtime.PocketSyncCrypto.openContent(rollback.body.encryptedRecord, viewer.accountKey,
        { ...context, revision: 1, contentType: viewer.runtime.PocketSyncCrypto.FORMAT.contentType });
      assert.equal(Object.hasOwn(content.mainThoughtTree[0], CAPSULE), false);
      rollbackDocuments.push(hash(JSON.stringify(content)));
      assert.equal((await call(sample.server.handle, "downloadEncryptedRecord", { revision: record.head.revision })).status, 404);
      const exported = viewer.runtime.buildCanonicalPocketPayload(viewer.document);
      assert.equal(Object.hasOwn(exported.mainThoughtTree[0], CAPSULE), sample === hidden);
      const portable = viewer.runtime.buildPortablePocketSnapshot(viewer.document, { writtenAt: viewer.document.writtenAt });
      assert.equal(portable.reason, "semantic-round-trip-loss");
      assert.equal(Object.hasOwn(portable, "json"), false);
    }
    assert.equal(rollbackDocuments[0], rollbackDocuments[1]);
  });

  await t.test("a Head advance leaves an old reference readable and revocation does not recall cached ciphertext", async () => {
    const changed = await hidden.custody.editDetails({ ...placement, details: "An authorised new derived revision." });
    assert.equal(changed.outcome, "committed");
    const fresh = await readThought(withSource, hidden.server.handle);
    assert.equal(fresh.head.revision, x.head.revision + 1);
    assert.equal(fresh.payload.details, "An authorised new derived revision.");
    assert.equal(fresh.payload[CAPSULE].ref, inner.ref);
    assert.equal((await call(hidden.server.handle, "getOpaqueObject", { storageRef: x.ref })).body.present, true);

    let reached, resume;
    const waiting = new Promise(resolve => { reached = resolve; });
    const release = new Promise(resolve => { resume = resolve; });
    const delayed = storeVariant(hidden, stock => Object.freeze({
      ...stock,
      async getObject(pocket, ref) {
        reached();
        await release;
        return stock.getObject(pocket, ref);
      },
    }));
    const pending = call(delayed, "getOpaqueObject", { storageRef: fresh.ref });
    try {
      assert.equal(await Promise.race([waiting.then(() => true), pending.then(() => false)]), true);
      await revokeSession(hidden);
    } finally {
      resume();
    }
    const inFlight = await pending;
    assert.equal(inFlight.status, 200);
    assert.equal(inFlight.body.present, true);
    for (const [route, params] of [["getOpaqueObject", { storageRef: fresh.ref }],
      ["objectPresence", { storageRefs: [x.ref, guessed] }], ["readShadowHead", {}],
      ["downloadEncryptedRecord", { revision: 1 }]]) {
      const denied = await call(hidden.server.handle, route, params);
      assert.equal(denied.status, 401);
      assert.deepEqual(denied.body, { apiVersion: 1, ok: false, reason: "service-session-invalid" });
    }
    const cached = await decode(withSource, x.ref, x.record);
    assert.equal(cached.object.payload[CAPSULE].ref, inner.ref);
    const owner = await grant(hidden, { readerSession: SESSION });
    const original = await hidden.custody.open(request(hidden, owner.token, { sessionId: SESSION }));
    assert.equal(original.json === hidden.firstJson, true);
    assert.deepEqual((await call(hidden.server.handle, "readShadowHead", {}, SESSION)).body.head, fresh.head);
    t.diagnostic("An object read authorised before session revocation still delivered after revocation; subsequent reads refused.");
  });
});
