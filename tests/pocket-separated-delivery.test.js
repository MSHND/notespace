"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createPostgresStore } = require("../sync-service/pocket-sync-postgres-store.js");
const { createObjectHeadPostgresStore, REFERENCE_PREFIX } = require("../sync-service/pocket-sync-object-head-postgres-store.js");
const { POLICY, ROUTES } = require("../sync-service/pocket-sync-http-adapter.js");
const { SCHEMA, openSourceCapsule } = require("../tools/pocket-legacy-intake-bridge.js");
const { issueWriterGrant } = require("../tools/pocket-writer-format-admission.js");
const custody = require("../tools/pocket-source-custody.js");
const split = require("../tools/pocket-separated-delivery-lab.js");
const { setupPostgres } = require("./helpers/pocket-writer-postgres-lab.js");
const preview = require("../js/pocket-natural-unit-preview.js");
const { createPeTestDom } = require("./helpers/pe-test-dom.js");

function fixture(file, names, adapt = source => source) {
  const source = fs.readFileSync(path.join(__dirname, file), "utf8")
    .replace('const test = require("node:test");', "const test = () => {};");
  return new Function("require", "__dirname", adapt(source) + "\nreturn " + names)(require, __dirname);
}

const { scenario, p168, worker, post, prior, httpOptions, SESSION, PEER, pocketId } =
  fixture("pocket-writer-format-admission.test.js",
    "{ scenario, p168, worker, post, prior, httpOptions, SESSION, PEER, pocketId }", source => source
      .replace("input = prior.legacy();", "input = prior.legacy(2, 0);")
      .replace("runtime, head: copy(opened.head)", "runtime, accountKey: key.masterKey, head: copy(opened.head)"));
const { seedViewer } = fixture("pocket-source-custody.test.js", "{ seedViewer }");
const CAPSULE = "peMigrationLegacySourcePreserved";
const OWNER = "credential", VIEWER = "fictional-viewer";
const { hash } = prior;
const copy = value => JSON.parse(JSON.stringify(value));
const future = () => new Date(Date.now() + 120000);
const hiddenBucket = split.privateBucket(pocketId);
const placement = { sourceId: "original-y", ownerId: OWNER, nodeId: "n0", parentId: "root" };
const missing = { ok: false, reason: "source-unavailable" };
const noRecord = { apiVersion: 1, ok: false, reason: "service-record-not-found" };
const guessedRef = REFERENCE_PREFIX + Buffer.alloc(32, 19).toString("base64url");
const legacyRoot = httpOptions.serviceRoot;
let sequence = 0;
const id = prefix => prefix + "-" + (++sequence);

function target(world, { root = split.VIEW_ROOT, actor = PEER, trace = null } = {}) {
  return async request => {
    const incoming = new URL(request.url);
    const route = incoming.pathname.replace(legacyRoot, root);
    const headers = new Headers(request.headers);
    headers.set("Cookie", POLICY.sessionCookieName + "=" + actor);
    const response = await world.http(new Request(incoming.origin + route + incoming.search, {
      method: request.method, headers, body: await request.text(),
    }));
    if (trace) trace.push({ route, status: response.status, text: await response.clone().text() });
    return response;
  };
}

async function mirror(from, to, tables) {
  for (const table of tables) {
    const publicObjects = table === "pocket_sync_objects";
    const { rows } = await from.query("SELECT * FROM public." + table + (publicObjects ? " WHERE synced_pocket_id=$1" : ""),
      publicObjects ? [pocketId] : []);
    await to.query("INSERT INTO public." + table + " SELECT * FROM jsonb_populate_recordset(NULL::public."
      + table + ", $1::jsonb) ON CONFLICT DO NOTHING", [JSON.stringify(rows)]);
  }
}

async function originalFor(h) {
  const intake = await prior.setup();
  const legacy = prior.legacy(2, 0, 125200);
  delete legacy.mainThoughtTree[1][CAPSULE];
  const compact = JSON.stringify(legacy.mainThoughtTree[0][CAPSULE]);
  const json = compact.replace('"2":"two","9":"nine"', '"9":"nine",  "2":"two"');
  const source = JSON.stringify(legacy).replace(compact, json);
  const exportDigest = hash(source);
  const wrappingKey = await intake.pocket.PocketSyncCrypto.generateDeviceWrappingKey();
  const keyContext = custody.custodyEnvelopeContext(pocketId, OWNER, exportDigest);
  const bundle = await intake.pocket.PocketSyncCrypto.createMasterKeyBundle([{ context: keyContext, wrappingKey }]);
  const staged = await intake.stage(source, { ...h.context, capsuleKey: bundle.masterKey });
  assert.equal((await staged.save(intake.options)).outcome, "verified");
  const material = await (await intake.fresh("original-snapshot")).material();
  const capsule = material.document.nodes[0][CAPSULE];
  assert.ok(json.length > 125000);
  assert.equal(bundle.masterKey.extractable, false);
  return { binding: { ...placement, ref: capsule.ref, version: hash(json), exportDigest,
    envelope: bundle.envelopes[0].record }, capsule, json, wrappingKey };
}

function mount(h, world, original) {
  world.writer = worker(world.lab, world.hooks);
  world.stock = createObjectHeadPostgresStore({ pool: world.writer.raw });
  world.http = split.createScopedHttp({
    pool: world.writer.raw, httpOptions, canView: actor => actor === OWNER || actor === VIEWER,
    createCore: objectStore => p168.core({ store: createPostgresStore({ pool: world.writer.raw }) }, { store: objectStore }),
    stock: {
      ...world.stock,
      async getObject(pocket, ref) {
        const record = await world.stock.getObject(pocket, ref);
        await world.hooks.afterGet?.(ref);
        return record;
      },
    },
  });
  world.custody = custody.createSourceCustody({
    pool: world.admin, syncedPocketId: pocketId,
    async authenticate(actor) {
      const reply = await post(target(world, { actor }), "readShadowHead", { apiVersion: 1, operationId: id("holder") });
      return reply.body.ok ? reply.body.head : null;
    },
    async ownerWrappingKey(owner) {
      await world.hooks.beforeUnwrap?.();
      return owner === OWNER ? original?.wrappingKey : null;
    },
    async openAccepted() {
      const view = await h.reader(target(world, { actor: SESSION }), id("holder-open"));
      const { rows: [head] } = await world.admin.query(`SELECT lab_source_ref FROM public.pocket_sync_heads
        WHERE synced_pocket_id = $1 AND revision = $2 AND seal_storage_ref = $3`,
      [pocketId, view.head.revision, view.head.sealRef]);
      if (!head?.lab_source_ref) return view;
      const record = await world.stock.getObject(hiddenBucket, head.lab_source_ref);
      const node = view.document.nodes.find(row => row.id === placement.nodeId && row.parentId === placement.parentId);
      if (record && node) node[CAPSULE] = { schema: SCHEMA, ref: head.lab_source_ref, record };
      return view;
    },
  });
}

const sameBytes = (a, b) => assert.equal(JSON.stringify(a) === JSON.stringify(b), true);
const call = (world, route, params = {}, options = {}) =>
  post(target(world, options), route, { apiVersion: 1, operationId: "scope-probe", ...params });
const cas = (handle, command, token) => post(handle, "compareAndSetShadowHead", command, token, PEER);

async function prepare(h, world, payload) {
  let command;
  const current = await h.reader(world.writer.handle, id("base"));
  const tx = await current.transaction(id("reviewed-x"), { sessionId: PEER, async grant(input) {
    command = input;
    return "unsigned-draft";
  } });
  assert.equal((await tx.savePayload({ nodeId: placement.nodeId, payload })).outcome, "conflict");
  assert.ok(command);
  const document = copy(current.document);
  document.nodes[0] = { id: placement.nodeId, parentId: placement.parentId, order: 0, ...payload };
  return { command, document };
}

async function review(h, world, draft, original) {
  const { command, document } = draft, records = new Map();
  const handle = async request => {
    const response = await world.writer.handle(request);
    const route = new URL(request.url).pathname;
    if (route.endsWith(ROUTES.getOpaqueObject)) {
      const body = await response.clone().json();
      if (body.present) records.set(body.storageRef, body.record);
    }
    if (!route.endsWith(ROUTES.readShadowHead)) return response;
    const data = await response.json();
    return Response.json({ ...data, head: { ...command.expectedHead, revision: command.expectedHead.revision + 1,
      sealRef: command.candidateSealStorageRef } });
  };
  const candidate = await h.reader(handle, id("review"));
  assert.deepEqual(candidate.document, document);
  const { rows: [current] } = await world.admin.query(`SELECT c.* FROM public.pocket_sync_heads h
    LEFT JOIN public.pocket_lab_source_custody c ON c.pocket_id=h.synced_pocket_id AND c.capsule_ref=h.lab_source_ref
    WHERE h.synced_pocket_id=$1`, [pocketId]);
  let sourceRecord = null;
  if (original || current.capsule_ref) {
    const binding = original?.binding ?? { ref: current.capsule_ref, ownerId: current.owner_id,
      nodeId: current.node_id, parentId: current.parent_id, version: current.version,
      exportDigest: current.export_digest, envelope: current.envelope };
    assert.ok(candidate.document.nodes.some(node => node.id === binding.nodeId && node.parentId === binding.parentId));
    sourceRecord = await world.stock.getObject(hiddenBucket, binding.ref);
    assert.ok(sourceRecord);
    const { runtime } = candidate;
    const keys = await runtime.PocketSyncCrypto.openMasterKeyBundle(binding.envelope, world.wrappingKey,
      custody.custodyEnvelopeContext(pocketId, binding.ownerId, binding.exportDigest));
    const opened = await openSourceCapsule(runtime, { capsule: { schema: SCHEMA, ref: binding.ref, record: sourceRecord },
      capsuleKey: keys.masterKey, syncedPocketId: pocketId, sourceSha256: binding.exportDigest, nodeId: binding.nodeId });
    assert.equal(opened.ok && hash(opened.json), binding.version, "Source digest differs from the reviewed original");
  }
  await world.admin.query(`INSERT INTO public.pocket_lab_scoped_candidates SELECT $1,$2,$3,$4,
    (SELECT jsonb_object_agg(key, encode(sha256(convert_to(value::text, 'UTF8')), 'hex')) FROM jsonb_each($5::jsonb)),
    $6,$7,sha256(convert_to(($8::jsonb)::text, 'UTF8'))`,
    [pocketId, command.expectedHead.revision, command.expectedHead.sealRef, command.candidateSealStorageRef,
      JSON.stringify(Object.fromEntries(records)), current.epoch, original ? JSON.stringify(original.binding) : null,
      sourceRecord && JSON.stringify(sourceRecord)]);
  return issueWriterGrant(world.admin, PEER, command, future());
}

const issue = (world, original, readerSession = PEER, operation = "read") => world.custody.issue({
  ownerSession: SESSION, readerSession, sourceId: placement.sourceId, version: original.binding.version,
  operation, expiresAt: future(),
});
const read = (world, original, grant, extra = {}) => world.custody.open({
  ...placement, version: original.binding.version, token: grant?.token, sessionId: PEER, operation: "read", ...extra,
});

test("X and Y have separate delivery under one accepted PostgreSQL Head", { timeout: 120000 }, async t => {
  const h = await scenario(t), emptyLab = await setupPostgres(t);
  const y = { lab: h.lab, admin: h.admin, hooks: {} };
  const empty = { lab: emptyLab, admin: emptyLab.admin(), hooks: {} };
  await seedViewer(y.admin);
  await mirror(y.admin, empty.admin, ["pocket_sync_objects", "pocket_sync_records", "pocket_sync_heads"]);
  const original = await originalFor(h);
  y.wrappingKey = original.wrappingKey;
  for (const world of [y, empty]) {
    await world.admin.query(custody.INSTALL_SQL);
    await world.admin.query(split.INSTALL_SQL);
    mount(h, world, world === y ? original : null);
  }
  const legacy = { root: legacyRoot };
  const old = await h.reader(target(y, legacy), "legacy-compatible");
  assert.equal((await call(y, "downloadEncryptedRecord", { revision: 1 }, legacy)).status, 200);
  assert.equal((await call(y, "readShadowHead")).status, 404);
  assert.equal(Object.hasOwn(old.document.nodes[0], CAPSULE), false);
  const { label, details, editor, source, updatedAt } = h.input.mainThoughtTree[0];
  const payload = { label, details, editor, source, updatedAt };
  assert.ok(details.length > 33000);
  const draft = await prepare(h, y, payload);
  await mirror(y.admin, empty.admin, ["pocket_sync_objects"]);
  const putOriginal = () => y.stock.putObject(hiddenBucket, original.capsule.ref, original.capsule.record);
  await putOriginal();
  assert.equal((await call(y, "getOpaqueObject", { storageRef: original.capsule.ref }, legacy)).body.present, false);

  await t.test("broken fragments, wrong digest and rollback cannot half-publish the scope or custody", async () => {
    await assert.rejects(review(h, y, draft, { binding: { ...original.binding, version: hash("altered") } }),
      /Source digest differs from the reviewed original/);
    const token = await review(h, y, draft, original);
    const assertUnpublished = async () => {
      assert.deepEqual((await call(y, "readShadowHead", {}, legacy)).body.head, old.head);
      assert.deepEqual((await call(y, "readShadowHead")).body, noRecord);
      assert.equal((await y.admin.query("SELECT 1 FROM public.pocket_lab_source_custody")).rowCount, 0);
      assert.deepEqual(await issue(y, original), missing);
    };
    const { rows: [fragment] } = await y.admin.query(`DELETE FROM public.pocket_sync_objects WHERE synced_pocket_id=$1
      AND storage_ref=(SELECT ref FROM public.pocket_lab_scoped_candidates c
        CROSS JOIN LATERAL jsonb_object_keys(c.visible_objects) AS ref WHERE ref<>$2 LIMIT 1) RETURNING *`,
    [pocketId, draft.command.candidateSealStorageRef]);
    assert.equal((await cas(y.writer.handle, draft.command, token)).status, 409);
    await assertUnpublished();
    await y.stock.putObject(pocketId, fragment.storage_ref, fragment.record);
    await y.admin.query("DELETE FROM public.pocket_sync_objects WHERE synced_pocket_id=$1", [hiddenBucket]);
    assert.equal((await cas(y.writer.handle, draft.command, token)).status, 409);
    await assertUnpublished();
    await putOriginal();
    await y.admin.query("UPDATE public.pocket_sync_objects SET record = record || '{\"nonce\":\"damaged\"}'::jsonb WHERE synced_pocket_id=$1",
      [hiddenBucket]);
    assert.equal((await cas(y.writer.handle, draft.command, token)).status, 409);
    await assertUnpublished();
    await y.admin.query("UPDATE public.pocket_sync_objects SET record=$2 WHERE synced_pocket_id=$1",
      [hiddenBucket, JSON.stringify(original.capsule.record)]);
    y.hooks.beforeCommit = async pid => {
      delete y.hooks.beforeCommit;
      assert.equal((await y.admin.query("SELECT pg_terminate_backend($1, 5000) AS stopped", [pid])).rows[0].stopped, true);
    };
    assert.equal((await cas(y.writer.handle, draft.command, token)).status, 503);
    await assertUnpublished();
    const attempts = await Promise.all([cas(y.writer.handle, draft.command, token),
      cas(worker(y.lab).handle, draft.command, token)]);
    assert.deepEqual(attempts.map(result => result.status).sort(), [200, 409]);
    assert.equal((await cas(empty.writer.handle, draft.command, await review(h, empty, draft))).status, 200);
  });

  for (const world of [y, empty]) {
    await world.lab.restart();
    world.admin = world.lab.admin();
    mount(h, world, world === y ? original : null);
  }

  async function observe(world) {
    const trace = [];
    const opened = await h.reader(target(world, { trace }), "paired-world");
    const node = opened.document.nodes[0];
    const { Element } = createPeTestDom();
    const element = preview({ createElement: tag => new Element(tag) }, node.details);
    assert.equal(node.id, placement.nodeId);
    assert.equal(node.parentId, placement.parentId);
    assert.equal(node.details, details);
    assert.equal(node.label, label);
    const refs = [];
    for (const entry of trace.filter(row => row.route.endsWith(ROUTES.getOpaqueObject))) {
      const response = JSON.parse(entry.text);
      refs.push(response.storageRef);
      const bytes = await opened.runtime.PocketStarlingCryptoShadow.openObject(response.record,
        response.storageRef, opened.accountKey, h.context);
      const plaintext = Buffer.from(bytes).toString("utf8");
      assert.equal([CAPSULE, original.binding.sourceId, original.binding.exportDigest, original.capsule.ref]
        .some(secret => plaintext.includes(secret)), false);
    }
    const requested = [opened.head.sealRef, original.capsule.ref, guessedRef, old.head.sealRef];
    const presence = await call(world, "objectPresence", { storageRefs: requested });
    assert.deepEqual(presence.body.rows.map(row => row.present), [true, false, false, false]);
    const probes = [presence];
    const lookups = [];
    world.hooks.afterGet = ref => { lookups.push(ref); };
    try {
      for (const storageRef of requested.slice(1)) {
        const response = await call(world, "getOpaqueObject", { storageRef });
        assert.equal(response.status, 200);
        assert.equal(response.body.present, false);
        assert.equal(response.body.record, null);
        probes.push(response);
      }
    } finally {
      delete world.hooks.afterGet;
    }
    assert.deepEqual(lookups, []);
    for (const [route, args] of [["readShadowHead", {}], ["getOpaqueObject", { storageRef: opened.head.sealRef }],
      ["objectPresence", { storageRefs: requested }], ["downloadEncryptedRecord", { revision: 1 }],
      ["readRevision", {}], ["putOpaqueObject", { storageRef: original.capsule.ref, record: original.capsule.record }]]) {
      const response = await call(world, route, args, legacy);
      assert.deepEqual(response, { status: 404, body: noRecord });
      probes.push(response);
    }
    assert.equal((await call(world, "getOpaqueObject", { storageRef: "malformed" })).status, 400);
    assert.equal((await call(world, "getOpaqueObject", { syncedPocketId: hiddenBucket, storageRef: original.capsule.ref })).status, 403);
    assert.equal((await world.http(new Request(p168.ORIGIN + split.VIEW_ROOT + ROUTES.readShadowHead + "?alias=1",
      { method: "POST" }))).status, 404);
    assert.deepEqual(await read(world, original), missing);
    const uniqueRefs = [...new Set(refs)].sort();
    const replay = [];
    const replayTarget = target(world, { trace: replay });
    const command = { apiVersion: 1, operationId: "paired-byte-replay" };
    await post(replayTarget, "readShadowHead", command, undefined, PEER);
    for (const storageRef of uniqueRefs) {
      await post(replayTarget, "getOpaqueObject", { ...command, storageRef }, undefined, PEER);
    }
    return { replay, requests: refs.length, refs: uniqueRefs, probes, document: opened.document, preview: element.textContent };
  }

  await t.test("fresh scoped Open exposes the same full X, preview, refs, bytes and refusals in both worlds", async () => {
    assert.equal((await empty.stock.presence(hiddenBucket, [original.capsule.ref]))[0].present, false);
    const withY = await observe(y), withoutY = await observe(empty);
    sameBytes(withY, withoutY);
    assert.deepEqual(withY.document, draft.document);
    const lengths = withY.replay.filter(e => e.route.endsWith(ROUTES.getOpaqueObject))
      .map(e => JSON.parse(e.text).record.ciphertext.length);
    t.diagnostic("Exact visible details: " + details.length + " JavaScript string units. Private ciphertext: "
      + original.capsule.record.ciphertext.length + " base64url characters.");
    t.diagnostic("Scoped X W0/W1 identical: " + withY.refs.length + " refs, " + withY.requests + " object lookups per Open, "
      + withY.replay.reduce((total, entry) => total + Buffer.byteLength(entry.text), 0)
      + " replay body bytes, largest record " + Math.max(...lengths) + " base64url characters.");
  });

  await t.test("fresh holder reads the exact source and grants are single-use, scoped and operation-specific", async () => {
    const owner = await read(y, original, await issue(y, original, SESSION), { sessionId: SESSION });
    assert.equal(owner.json === original.json, true);
    assert.equal(hash(owner.json), original.binding.version);
    const permit = await issue(y, original);
    for (const change of [{ sessionId: SESSION }, { operation: "export" }, { version: hash("other") },
      { sourceId: "another-source" }, { nodeId: "n1" }, { parentId: "another-placement" }]) {
      assert.deepEqual(await read(y, original, permit, change), missing);
    }
    const raced = await Promise.all([read(y, original, permit), read(y, original, permit)]);
    assert.equal(raced.filter(result => result.json === original.json).length, 1);
    assert.equal(raced.filter(result => !result.ok).length, 1);
    const exportPermit = await issue(y, original, PEER, "export");
    assert.deepEqual(await read(y, original, exportPermit), missing);
    assert.equal((await read(y, original, exportPermit, { operation: "export" })).json === original.json, true);
    const expiry = await issue(y, original);
    await y.admin.query("UPDATE public.pocket_lab_source_grants SET expires_at=clock_timestamp() WHERE token_hash=$1",
      [hash(expiry.token)]);
    assert.deepEqual(await read(y, original, expiry), missing);
    const revoked = await issue(y, original);
    y.hooks.beforeUnwrap = async () => {
      delete y.hooks.beforeUnwrap;
      assert.equal(await y.custody.revoke({ ownerSession: SESSION, token: revoked.token }), true);
    };
    assert.deepEqual(await read(y, original, revoked), missing);
    const viewer = await h.reader(target(y), id("wrong-key"));
    const input = { capsule: original.capsule, syncedPocketId: pocketId, sourceSha256: original.binding.exportDigest,
      nodeId: placement.nodeId, capsuleKey: viewer.accountKey };
    assert.deepEqual(await openSourceCapsule(viewer.runtime, input), missing);
    const key = await viewer.runtime.PocketSyncCrypto.openMasterKeyBundle(original.binding.envelope, original.wrappingKey,
      custody.custodyEnvelopeContext(pocketId, OWNER, original.binding.exportDigest));
    assert.deepEqual(await openSourceCapsule(viewer.runtime, { ...input, capsuleKey: key.masterKey, nodeId: "n1" }), missing);
    t.diagnostic("Holder recovered " + original.json.length + " exact original characters after PostgreSQL restart.");
  });

  await t.test("a legitimate X edit and lost reply leave Y exact and refuse obsolete writers or replay", async () => {
    const permit = await issue(y, original);
    const before = await h.reader(y.writer.handle, id("edit-base"));
    const changed = { ...payload, details: "A fictional continuation.\n\n" + details };
    const expected = copy(before.document);
    expected.nodes[0].details = changed.details;
    let command, token;
    const transaction = await before.transaction(id("lost-reply"), { sessionId: PEER, loseReply: true,
      async grant(input) {
        command = input;
        token = await review(h, y, { command, document: expected });
        return token;
      },
    });
    assert.deepEqual(copy(await transaction.savePayload({ nodeId: placement.nodeId, payload: changed })), { outcome: "ambiguous" });
    assert.equal((await transaction.reconcileAmbiguous()).outcome, "committed");
    assert.equal((await cas(y.writer.handle, command, token)).status, 409);
    const next = { ...command, operationId: id("old-writer"), candidateSealStorageRef: old.head.sealRef,
      expectedHead: (await h.reader(target(y), id("post-edit"))).head };
    assert.notEqual((await cas(y.writer.old, next)).status, 200);
    assert.equal((await call(y, "compareAndSetShadowHead", next, legacy)).status, 404);
    const fresh = await h.reader(target(y), id("post-retry"));
    assert.equal(fresh.head.revision, before.head.revision + 1);
    assert.deepEqual(fresh.document, expected);
    assert.deepEqual(await read(y, original, permit), missing);
    assert.equal((await read(y, original, await issue(y, original, SESSION), { sessionId: SESSION })).json === original.json, true);
    await mirror(y.admin, empty.admin, ["pocket_sync_objects"]);
    assert.equal((await cas(empty.writer.handle, command, await review(h, empty, { command, document: expected }))).status, 200);
  });

  await t.test("the current source-epoch check creates an X Save conflict when only private authority changes", async () => {
    const before = (await call(y, "readShadowHead")).body.head;
    assert.deepEqual((await call(empty, "readShadowHead")).body.head, before);
    const edit = await prepare(h, y, { ...payload, details: "A second fictional continuation.\n\n" + details });
    await mirror(y.admin, empty.admin, ["pocket_sync_objects"]);
    const yTicket = await review(h, y, edit), emptyTicket = await review(h, empty, edit);
    assert.equal(await y.custody.changeScope({ ownerSession: SESSION, sourceId: placement.sourceId }), true);
    const results = await Promise.all([cas(empty.writer.handle, edit.command, emptyTicket), cas(y.writer.handle, edit.command, yTicket)]);
    assert.deepEqual(results.map(result => result.status), [200, 409]);
    assert.deepEqual((await call(y, "readShadowHead")).body.head, before);
    assert.equal((await read(y, original, await issue(y, original, SESSION), { sessionId: SESSION })).json === original.json, true);
    const permit = await issue(y, original);
    await y.admin.query("UPDATE public.pocket_sync_objects SET record = record || '{\"nonce\":\"invalid\"}'::jsonb WHERE synced_pocket_id=$1",
      [hiddenBucket]);
    assert.deepEqual(await read(y, original, permit), missing);
    assert.deepEqual(await read(empty, original, permit), missing);
    assert.deepEqual((await call(y, "readShadowHead")).body.head, before);
    sameBytes((await h.reader(target(y), id("after-source-damage"))).document.nodes,
      (await h.reader(y.writer.handle, id("after-damage-control"))).document.nodes);
    await y.admin.query("DELETE FROM public.pocket_sync_objects WHERE synced_pocket_id=$1", [hiddenBucket]);
    await putOriginal();
    assert.equal((await read(y, original, permit)).json === original.json, true);
    t.diagnostic("Identical X edit after a private permission change: W0 HTTP 200, W1 HTTP 409. A client-visible conflict would expose the hidden state.");
  });

  await t.test("revocation after a real object lookup withholds the in-flight response", async () => {
    const { body: { head } } = await call(y, "readShadowHead");
    const cached = await call(y, "getOpaqueObject", { storageRef: head.sealRef });
    assert.equal(cached.body.present, true);
    let reached, resume;
    const lookedUp = new Promise(resolve => { reached = resolve; });
    const release = new Promise(resolve => { resume = resolve; });
    y.hooks.afterGet = async ref => { reached(ref); await release; };
    const pending = call(y, "getOpaqueObject", { storageRef: head.sealRef });
    try {
      assert.equal(await Promise.race([lookedUp, pending]), head.sealRef);
      await createPostgresStore({ pool: y.admin }).transact("readwrite", async tx => {
        const record = await tx.get("sessions", PEER);
        await tx.replace("sessions", PEER, record.storeVersion, { ...record, storeVersion: record.storeVersion + 1,
          status: "revoked", replacedBy: SESSION });
      });
    } finally {
      delete y.hooks.afterGet;
      resume();
    }
    const denied = { status: 401, body: { apiVersion: 1, ok: false, reason: "service-session-invalid" } };
    assert.deepEqual(await pending, denied);
    assert.deepEqual(await call(y, "readShadowHead"), denied);
    assert.deepEqual(await call(y, "objectPresence", { storageRefs: [head.sealRef] }), denied);
    assert.deepEqual(await call(y, "downloadEncryptedRecord", { revision: 1 }, legacy), denied);
    assert.ok(await old.runtime.PocketStarlingCryptoShadow.openObject(cached.body.record, head.sealRef, old.accountKey, h.context));
    t.diagnostic("An authorised lookup followed by revocation returned 401 without ciphertext. The prior cached X still decrypted.");
  });
});
