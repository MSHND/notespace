"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createHttpAdapter, POLICY, ROUTES } = require("../sync-service/pocket-sync-http-adapter.js");
const { createPostgresStore } = require("../sync-service/pocket-sync-postgres-store.js");
const { createObjectHeadPostgresStore } = require("../sync-service/pocket-sync-object-head-postgres-store.js");
const { openSourceCapsule } = require("../tools/pocket-legacy-intake-bridge.js");
const { createWriterAdmissionHandler, GRANT_HEADER, issueWriterGrant } = require("../tools/pocket-writer-format-admission.js");
const { instrumentHeadPool, setupPostgres } = require("./helpers/pocket-writer-postgres-lab.js");

function fixture(file, exports) {
  const text = fs.readFileSync(path.join(__dirname, file), "utf8")
    .replace('const test = require("node:test");', "const test = () => {};");
  return new Function("require", "__dirname", text + "\nreturn " + exports)(require, __dirname);
}

const prior = fixture("legacy-intake-bridge.test.js", "{ core, legacy, setup, hash }");
const p168 = fixture("p168-authority-adoption.test.js", "{ ORIGIN, core, seed, upload, fence, adoption }");
const httpOptions = { trustedOrigin: p168.ORIGIN, serviceRoot: "/pocket-sync/v1" };
const copy = value => JSON.parse(JSON.stringify(value));
const ids = prefix => (kind, index) => [prefix, kind, index].join("-");
const SESSION = "session", PEER = "peer-session";
const capsuleField = "peMigrationLegacySourcePreserved";
const pocketId = "p146";

async function post(handle, route, command, token, sessionId = SESSION) {
  const headers = { Origin: p168.ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json",
    Cookie: POLICY.sessionCookieName + "=" + sessionId };
  if (token !== undefined) headers[GRANT_HEADER] = token;
  const response = await handle(new Request(p168.ORIGIN + httpOptions.serviceRoot + ROUTES[route], {
    method: "POST", headers, body: JSON.stringify({ syncedPocketId: pocketId, ...command }),
  }));
  return { status: response.status, body: await response.json() };
}

function worker(lab, hooks = {}) {
  const raw = lab.app(), store = createPostgresStore({ pool: raw });
  const createCore = objectHeadStore => p168.core({ store }, { store: objectHeadStore });
  const handle = createWriterAdmissionHandler({ pool: instrumentHeadPool(raw, hooks), createCore, httpOptions });
  const old = createHttpAdapter({ ...httpOptions, core: createCore(createObjectHeadPostgresStore({ pool: raw })) });
  return { handle, old: old.handle, raw };
}

function client(pocket, server, options = {}) {
  return pocket.PocketSyncRemoteClient.createObjectHeadService({
    transport: {
      async request(route, body) {
        if (route === "readShadowHead" && options.readUnavailable?.()) throw new Error("Synthetic read cut");
        if (route !== "compareAndSetShadowHead") return post(server, route, body, undefined, options.sessionId);
        const command = options.epoch ? { ...body, expectedAuthorityRevision: options.epoch } : body;
        const token = await options.grant?.(command);
        const reply = await post(server, route, command, token, options.sessionId);
        if (reply.status === 200 && options.loseReply) throw new Error("Synthetic lost acknowledgement after CAS");
        return reply;
      },
    },
  });
}

async function seedAccount(admin, encrypted) {
  const rows = p168.seed();
  rows.sessions[PEER] = { ...rows.sessions[SESSION], sessionId: PEER };
  rows.pockets.pocket.encryptedRecord = copy(encrypted);
  rows.pockets.pocket.encryptedRecordSize = Buffer.from(encrypted.ciphertext, "base64url").length;
  const store = createPostgresStore({ pool: admin });
  await store.transact("readwrite", async tx => {
    for (const [collection, records] of Object.entries(rows)) {
      for (const [key, record] of Object.entries(records)) {
        if (record.syncedPocketId === "pocket") record.syncedPocketId = pocketId;
        await tx.insert(collection, key === "pocket" ? pocketId : key, record);
      }
    }
  });
}

async function scenario(t) {
  const lab = await setupPostgres(t), admin = lab.admin(), hooks = {}, app = worker(lab, hooks);
  const pocket = prior.core(), context = { syncedPocketId: pocketId }, input = prior.legacy();
  const oldNodes = copy(pocket.normaliseNodes(input.mainThoughtTree));
  const payload = { ...input, mainThoughtTree: oldNodes, data: { ...input.data, mainThoughtTree: oldNodes } };
  const wrappingKey = await pocket.PocketSyncCrypto.generateDeviceWrappingKey();
  const device = { ...context, envelopeId: "head-lab-device", envelopeKind: "device", envelopeVersion: 1 };
  const bundle = await pocket.PocketSyncCrypto.createMasterKeyBundle([{ context: device, wrappingKey }], { semanticAuthority: true });
  const cryptoInput = { masterKey: bundle.masterKey, semanticAuthority: bundle.semanticAuthority };
  const encrypted = await pocket.PocketSyncCrypto.sealContent(payload, bundle.masterKey, {
    ...context, revision: 1, contentType: pocket.PocketSyncCrypto.FORMAT.contentType,
  });
  await seedAccount(admin, encrypted);
  const boot = await pocket.PocketStarlingOwnerBootstrap.composeInitialBootstrap({
    objectHeadService: client(pocket, app.handle), operationIdFactory: ids("v1-bootstrap"),
    normaliseInput: pocket.normaliseInput, normaliseRootExtras: data => pocket.normaliseRootExtras(data) || {},
  }, { ...context, ...cryptoInput, payload });
  assert.equal(boot.ok, true, boot.reason);
  const postOn = (route, body) => post(app.handle, route, { ...body, ...context });
  const fenced = await postOn("acquirePersistenceAuthorityFence", p168.fence("adoption-fence", 1));
  assert.equal(fenced.body.status, "fenced");
  const adopted = await postOn("commitStarlingAuthorityAdoption", p168.adoption("adoption", 2, 1, boot.head));
  assert.equal(adopted.body.status, "adopted");
  const epoch = adopted.body.authority.authorityRevision;

  async function reader(server, prefix) {
    const runtime = prior.core();
    const key = await runtime.PocketSyncCrypto.openMasterKeyBundle(
      bundle.envelopes[0].record, wrappingKey, device, [], { semanticAuthority: true },
    );
    const keyInput = { masterKey: key.masterKey, semanticAuthority: key.semanticAuthority, context };
    const opened = await runtime.PocketStarlingRemoteOpenShadow.createRemoteOpener({
      objectHeadService: client(runtime, server), operationIdFactory: ids(prefix),
    }).openRemote(keyInput);
    const result = await runtime.PocketStarlingMaterializeShadow.materializeAccepted(opened.session);
    assert.equal(result.ok, true, result.reason);
    return {
      runtime, head: copy(opened.head), document: copy(result.document),
      transaction: (name, options = {}) => runtime.PocketStarlingRemoteSaveShadow.createTransaction({
        ...keyInput, opened, objectHeadService: client(runtime, server, { epoch, ...options }),
        operationIdFactory: ids(name),
      }),
    };
  }
  async function head(pool) {
    const row = (await pool.query("SELECT revision, seal_storage_ref, required_writer_format FROM public.pocket_sync_heads WHERE synced_pocket_id=$1", [pocketId])).rows[0];
    return { revision: Number(row.revision), sealRef: row.seal_storage_ref, format: row.required_writer_format };
  }
  return { lab, admin, hooks, app, reader, head, epoch, context, input };
}

const asPayload = ({ id, parentId, order, ...payload }) => payload;
const future = () => new Date(Date.now() + 60000);
const refused = result => {
  assert.equal(result.status, 409);
  assert.equal(result.body.reason, "head-conflict");
  assert.deepEqual(Object.keys(result.body).sort(), ["apiVersion", "ok", "operationId", "reason", "syncedPocketId"]);
};

test("real HTTP and PostgreSQL writer admission preserve the effective Starling Head", { timeout: 90000 }, async t => {
  const h = await scenario(t);
  const readV1 = await h.reader(h.app.handle, "legacy-read");
  const oldSave = await readV1.transaction("ordinary-v1-save");
  const oldPayload = { ...asPayload(readV1.document.nodes[0]), label: "Ordinary v1 edit" };
  assert.equal((await oldSave.savePayload({ nodeId: "n0", payload: oldPayload })).outcome, "committed");
  const v1 = await h.reader(h.app.handle, "legacy-accepted");
  assert.equal(v1.document.nodes[0].label, oldPayload.label);
  const starting = await h.head(h.admin);
  assert.deepEqual(starting, { revision: 2, sealRef: v1.head.sealRef, format: 1 });
  refused(await post(h.app.handle, "compareAndSetShadowHead", {
    apiVersion: 1, operationId: "advertised-version", expectedHead: v1.head,
    expectedAuthorityRevision: h.epoch, candidateSealStorageRef: v1.head.sealRef,
  }, "2"));
  assert.deepEqual(await h.head(h.admin), starting);
  t.diagnostic("Ordinary v1 writer committed revision 2. A self-declared version did not change it.");

  const source = await prior.setup(), text = JSON.stringify(h.input);
  const staged = await source.stage(text);
  assert.equal((await staged.save(source.options)).outcome, "verified");
  const target = copy((await (await source.fresh("protected-source")).material()).document);
  const operations = target.nodes.map(node => ({ type: "payload", input: { nodeId: node.id, payload: asPayload(node) } }));
  const { schema, writtenAt, tombstones, rootExtras, dataExtras } = target;
  const projection = { source: { schema, writtenAt }, tombstones, rootExtras, dataExtras };

  let upgrade, grant;
  const prepare = await v1.transaction("prepare-upgrade", { grant: async command => {
    upgrade = command;
    grant = await issueWriterGrant(h.admin, SESSION, command, future());
    return grant;
  } });
  h.hooks.beforeCommit = async pid => {
    h.hooks.beforeCommit = undefined;
    const killed = await h.admin.query("SELECT pg_terminate_backend($1, 5000) AS stopped", [pid]);
    assert.equal(killed.rows[0].stopped, true);
  };
  assert.equal((await prepare.saveWorkingSet(operations, projection)).outcome, "ambiguous");
  assert.equal((await prepare.reconcileAmbiguous()).outcome, "not-committed");
  assert.deepEqual(await h.head(h.admin), starting);
  const contender = worker(h.lab);
  const double = await Promise.all([post(h.app.handle, "compareAndSetShadowHead", upgrade, grant),
    post(contender.handle, "compareAndSetShadowHead", upgrade, grant)]);
  assert.deepEqual(double.map(result => result.status).sort(), [200, 409]);
  assert.equal((await h.head(h.admin)).format, 2);

  await h.lab.restart();
  const admin = h.lab.admin(), hooks = {}, app = worker(h.lab, hooks), peer = worker(h.lab);
  const upgraded = await h.reader(app.handle, "restart-open");
  assert.equal(upgraded.head.revision, 3);
  assert.deepEqual(upgraded.document, target);
  const protectedHead = await h.head(admin);
  assert.deepEqual(protectedHead, { revision: 3, sealRef: upgraded.head.sealRef, format: 2 });
  t.diagnostic("Backend termination rolled back both changes. Duplicate upgrade accepted once. PostgreSQL crash recovery retained revision 3 and format 2.");

  let lossyCommand;
  const oldNode = upgraded.runtime.normaliseNodes([upgraded.document.nodes[0]])[0];
  const lossy = asPayload(oldNode);
  assert.equal(lossy.label.length, 220);
  assert.equal(Object.hasOwn(lossy, capsuleField), false);
  const oldWriter = await upgraded.transaction("exact-old-witness", { grant: command => { lossyCommand = command; } });
  const refusedSave = await oldWriter.savePayload({ nodeId: "n0", payload: lossy });
  assert.deepEqual(copy(refusedSave), { outcome: "conflict", reason: "head-conflict" });
  assert.deepEqual(await h.head(admin), protectedHead);
  const candidate = await app.raw.query("SELECT 1 FROM public.pocket_sync_objects WHERE synced_pocket_id=$1 AND storage_ref=$2",
    [pocketId, lossyCommand.candidateSealStorageRef]);
  assert.equal(candidate.rowCount, 1);
  assert.notEqual(lossyCommand.candidateSealStorageRef, protectedHead.sealRef);
  assert.deepEqual((await h.reader(peer.handle, "loss-refused")).document, target);
  t.diagnostic("Same-account lossy CAS returned conflict. Fresh Open matched the complete imported document.");

  const call = (command, token, sessionId) => post(app.handle, "compareAndSetShadowHead", command, token, sessionId);
  for (const token of ["2", "v3", "Z".repeat(43), grant]) refused(await call(lossyCommand, token));
  const snapshot = { ...lossyCommand, operationId: "pre-upgrade-snapshot", candidateSealStorageRef: v1.head.sealRef };
  refused(await call(snapshot));
  let scopeCommand, scopedGrant;
  const scopeProbe = await upgraded.transaction("scope-probe", { grant: async command => {
    scopeCommand = command;
    scopedGrant = await issueWriterGrant(admin, SESSION, command, future());
  } });
  const scopeEdit = await scopeProbe.savePayload({ nodeId: "n0", payload: { ...asPayload(target.nodes[0]), details: "Scope control" } });
  assert.equal(scopeEdit.outcome, "conflict");
  const expired = await issueWriterGrant(admin, SESSION, scopeCommand, new Date(0));
  refused(await call(scopeCommand, expired));
  const staleGrant = await issueWriterGrant(admin, SESSION, { ...scopeCommand, expectedAuthorityRevision: h.epoch - 1 }, future());
  refused(await call(scopeCommand, staleGrant));
  refused(await call({ ...scopeCommand, operationId: "wrong-operation" }, scopedGrant));
  refused(await call({ ...scopeCommand, candidateSealStorageRef: v1.head.sealRef }, scopedGrant));
  refused(await call(scopeCommand, scopedGrant, PEER));
  assert.equal((await call({ ...scopeCommand, writerFormat: 2 }, scopedGrant)).status, 400);
  assert.equal((await call(scopeCommand, scopedGrant, "nonexistent")).status, 401);
  const { expectedAuthorityRevision, ...legacyCommand } = snapshot;
  assert.equal((await call(legacyCommand)).body.reason, "authority-conflict");
  assert.equal((await post(app.old, "compareAndSetShadowHead", snapshot)).status, 503);
  assert.equal((await post(app.handle, "conditionalUpload", { ...p168.upload("legacy-whole-record", 1), ...h.context })).status, 409);
  assert.equal((await post(app.handle, "initialiseShadowHead", { apiVersion: 1, operationId: "reset-head" })).status, 409);
  assert.equal((await post(app.handle, "acquirePersistenceAuthorityFence", { ...p168.fence("old-fence", h.epoch), ...h.context })).status, 409);
  await assert.rejects(app.raw.query("UPDATE public.pocket_sync_heads SET required_writer_format=1"), { code: "42501" });
  await assert.rejects(app.raw.query("DELETE FROM public.pocket_sync_heads"), { code: "42501" });
  assert.deepEqual(await h.head(admin), protectedHead);

  const original = target.nodes[0];
  const authorisedPayload = { ...asPayload(original), details: original.details + "\nAuthorised edit 🧪" };
  let unreadable = true, lostRequest, lostGrant;
  const save = await upgraded.transaction("supported-lost", { loseReply: true, readUnavailable: () => unreadable,
    grant: async command => {
      lostRequest = command;
      lostGrant = await issueWriterGrant(admin, SESSION, command, future());
      return lostGrant;
    } });
  assert.equal((await save.savePayload({ nodeId: "n0", payload: authorisedPayload })).outcome, "ambiguous");
  assert.equal((await save.reconcileAmbiguous()).outcome, "unknown");
  unreadable = false;
  assert.equal((await save.reconcileAmbiguous()).outcome, "committed");
  refused(await call(lostRequest, lostGrant));
  const postEdit = await h.reader(app.handle, "after-lost");
  assert.equal(postEdit.head.revision, 4);
  assert.deepEqual(asPayload(postEdit.document.nodes[0]), authorisedPayload);
  const custody = await openSourceCapsule(postEdit.runtime, { capsule: postEdit.document.nodes[0][capsuleField],
    capsuleKey: source.capsuleKey, ...h.context, sourceSha256: prior.hash(text), nodeId: "n0" });
  assert.deepEqual(JSON.parse(custody.json), h.input.mainThoughtTree[0][capsuleField]);

  const sameBase = await h.reader(peer.handle, "race-peer");
  const [a, b] = await Promise.all([
    postEdit.transaction("race-a", { grant: command => issueWriterGrant(admin, SESSION, command, future()) }),
    sameBase.transaction("race-b", { grant: command => issueWriterGrant(admin, SESSION, command, future()) }),
  ]);
  const race = await Promise.all([
    a.savePayload({ nodeId: "n0", payload: { ...authorisedPayload, details: "Writer A" } }),
    b.savePayload({ nodeId: "n0", payload: { ...authorisedPayload, details: "Writer B" } }),
  ]);
  assert.deepEqual(race.map(result => result.outcome).sort(), ["committed", "conflict"]);

  const latest = await h.reader(app.handle, "after-race"), last = await h.head(admin);
  assert.equal(last.revision, 5);
  assert.equal(last.format, 2);
  assert.equal(latest.document.nodes[0].label, original.label);
  const sessionStore = createPostgresStore({ pool: admin });
  hooks.beforeUpdate = async () => {
    hooks.beforeUpdate = undefined;
    await sessionStore.transact("readwrite", async tx => {
      const old = await tx.get("sessions", PEER);
      await tx.replace("sessions", PEER, old.storeVersion, { ...old, storeVersion: old.storeVersion + 1,
        status: "revoked", replacedBy: SESSION });
    });
  };
  const revoke = await latest.transaction("revoked-at-cas", { sessionId: PEER,
    grant: command => issueWriterGrant(admin, PEER, command, future()) });
  const result = await revoke.savePayload({ nodeId: "n0", payload: { ...authorisedPayload, details: "Revoked" } });
  assert.equal(result.outcome, "conflict");
  assert.deepEqual(await h.head(admin), last);
  assert.equal((await post(app.handle, "readShadowHead", { apiVersion: 1, operationId: "revoked-read" }, undefined, PEER)).status, 401);
  assert.deepEqual((await h.reader(peer.handle, "final-read")).document, latest.document);
  t.diagnostic("Lost reply reconciled as unknown then committed. Concurrent writes accepted once, and session replacement at CAS refused the pending write.");
});
