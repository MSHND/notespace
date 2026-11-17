"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { createPostgresStore } = require("../sync-service/pocket-sync-postgres-store.js");
const { POLICY } = require("../sync-service/pocket-sync-http-adapter.js");
const { splitRecord, joinRecord } = require("../sync-service/pocket-sync-opaque-record-fragments.js");
const { openSourceCapsule } = require("../tools/pocket-legacy-intake-bridge.js");
const { issueWriterGrant } = require("../tools/pocket-writer-format-admission.js");
const { INSTALL_SQL, custodyEnvelopeContext, createSourceCustody } = require("../tools/pocket-source-custody.js");
const preview = require("../js/pocket-natural-unit-preview.js");
const { createPeTestDom } = require("./helpers/pe-test-dom.js");

const fixture = fs.readFileSync(path.join(__dirname, "pocket-writer-format-admission.test.js"), "utf8");
const { scenario, prior, worker, post, SESSION, PEER } = new Function("require", "__dirname",
  fixture.replace('const test = require("node:test");', "const test = () => {};")
    .replace('runtime, head: copy(opened.head)', 'runtime, accountKey: key.masterKey, head: copy(opened.head)')
  + "\nreturn { scenario, prior, worker, post, SESSION, PEER };")(require, __dirname);
const CAPSULE = "peMigrationLegacySourcePreserved";
const OWNER = "credential", VIEWER = "fictional-viewer";
const hash = text => createHash("sha256").update(text).digest("hex");
const copy = value => JSON.parse(JSON.stringify(value));
const expiry = () => new Date(Date.now() + 120000);
const denied = { ok: false, reason: "source-unavailable" };
const placement = { sessionId: PEER, nodeId: "n0", parentId: "root" };

async function seedViewer(admin) {
  const store = createPostgresStore({ pool: admin });
  await store.transact("readwrite", async tx => {
    const credential = await tx.get("credentials", OWNER);
    const account = await tx.get("accounts", credential.accountId);
    await tx.insert("credentials", VIEWER, { ...credential, credentialId: VIEWER,
      publicKey: Buffer.alloc(64, 37).toString("base64url") });
    await tx.replace("accounts", account.accountId, account.storeVersion, { ...account,
      storeVersion: account.storeVersion + 1, credentialIds: [...account.credentialIds, VIEWER] });
    const session = await tx.get("sessions", PEER);
    await tx.replace("sessions", PEER, session.storeVersion, { ...session, storeVersion: session.storeVersion + 1,
      credentialId: VIEWER });
  });
}

async function world(t, hiddenPresent) {
  const h = await scenario(t);
  let admin = h.admin, server = h.app, index = 0, custody;
  const faults = {};
  const command = name => name + "-" + (++index);
  const authenticate = async sessionId => {
    const result = await post(server.handle, "readShadowHead", { apiVersion: 1, operationId: command("auth") },
      undefined, sessionId);
    return result.status === 200 && result.body.ok ? result.body.head : null;
  };
  await admin.query(INSTALL_SQL);
  await seedViewer(admin);

  const source = await prior.setup(), original = prior.legacy(4, 2, 125200);
  for (const node of original.mainThoughtTree) {
    if (node.id === "n2" || node.id === "n3" || (node.id === "n0" && !hiddenPresent)) delete node[CAPSULE];
  }
  const first = original.mainThoughtTree[0][CAPSULE], second = original.mainThoughtTree[1][CAPSULE];
  const firstJson = first && JSON.stringify(first).replace('"2":"two","9":"nine"', '"9":"nine",  "2":"two"');
  const raw = JSON.stringify(original);
  const sourceText = first ? raw.replace(JSON.stringify(first), firstJson) : raw;
  const exportDigest = hash(sourceText), context = h.context.syncedPocketId;
  const wrappingKey = await source.pocket.PocketSyncCrypto.generateDeviceWrappingKey();
  const { masterKey, envelopes } = await source.pocket.PocketSyncCrypto.createMasterKeyBundle([
    { context: custodyEnvelopeContext(context, OWNER, exportDigest), wrappingKey },
  ]);
  assert.equal(wrappingKey.extractable, false);
  assert.equal(masterKey.extractable, false);
  const staged = await source.stage(sourceText, { capsuleKey: masterKey, hasSourceAuthority: async scope => {
    const ownerHead = await authenticate(SESSION);
    const owner = await createPostgresStore({ pool: admin }).transact("readonly", tx => tx.get("sessions", SESSION));
    return !!ownerHead && owner?.credentialId === OWNER && owner.status === "active" && scope.sourceSha256 === exportDigest
      && scope.syncedPocketId === context && scope.instanceId === original.pocketGuard.instanceId;
  } });
  assert.equal((await staged.save(source.options)).outcome, "verified");
  const target = copy((await (await source.fresh("custody-intake")).material()).document);
  const grantFor = session => request => issueWriterGrant(admin, session, request, expiry());
  const base = await h.reader(server.handle, command("pre-upgrade"));
  const store = await base.transaction(command("grant-upgrade"), { grant: grantFor(SESSION) });
  const updates = target.nodes.map(({ id, parentId, order, ...payload }) => ({
    type: "payload", input: { nodeId: id, payload },
  }));
  const { schema, writtenAt, tombstones, rootExtras, dataExtras } = target;
  assert.equal((await store.saveWorkingSet(updates, { source: { schema, writtenAt }, tombstones, rootExtras, dataExtras })).outcome,
    "committed");

  const coordinates = new Map();
  for (const [nodeId, sourceId, json] of [["n0", "original-y", firstJson], ["n1", "original-z", JSON.stringify(second)]]) {
    const node = target.nodes.find(item => item.id === nodeId);
    const version = json ? hash(json) : "absent-source-version";
    coordinates.set(sourceId, { sourceId, nodeId, parentId: node.parentId, version });
    if (json) await admin.query(
      "INSERT INTO public.pocket_lab_source_custody (pocket_id, source_id, owner_id, node_id, parent_id, version, export_digest, capsule_ref, envelope) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [context, sourceId, OWNER, nodeId, node.parentId, version, exportDigest, node[CAPSULE].ref,
        JSON.stringify(envelopes[0].record)],
    );
  }

  const read = () => h.reader(server.handle, command("custody-open"));
  function build() {
    custody = createSourceCustody({
      pool: admin, syncedPocketId: context, authenticate,
      async ownerWrappingKey(ownerId) {
        await faults.beforeKey?.();
        return ownerId === OWNER && !faults.keyUnavailable ? faults.wrongKey ?? wrappingKey : null;
      },
      async openAccepted() {
        const current = await read();
        if (faults.capsule) {
          const node = current.document.nodes.find(item => item.id === "n0");
          node[CAPSULE] = faults.capsule(node[CAPSULE], current.document.nodes[1][CAPSULE]);
        }
        return current;
      },
      placementScope: (actor, nodeId, parentId) => parentId === "root"
        && (actor === OWNER || (actor === VIEWER && nodeId === "n0")) ? { view: true, edit: true } : null,
      async publishDetails(current, sessionId, nodeId, payload) {
        const tx = await current.transaction(command("visible-edit"), { sessionId, grant: grantFor(sessionId),
          loseReply: faults.loseReply === true });
        faults.lastWrite = tx;
        return tx.savePayload({ nodeId, payload });
      },
    });
  }
  build();
  return {
    read, faults, coordinates, firstJson, exportDigest,
    get admin() { return admin; }, get custody() { return custody; },
    async rawViewer() {
      const requested = request => {
        const headers = new Headers(request.headers);
        headers.set("Cookie", POLICY.sessionCookieName + "=" + PEER);
        return server.handle(new Request(request, { headers }));
      };
      return h.reader(requested, command("unscoped-account-read"));
    },
    async restart() { await h.lab.restart(); admin = h.lab.admin(); server = worker(h.lab); build(); },
  };
}

function request(world, token, extra = {}) {
  return { ...world.coordinates.get("original-y"), sessionId: PEER, operation: "read", token, ...extra };
}

async function grant(world, extra = {}) {
  const { sourceId, version } = world.coordinates.get("original-y");
  return world.custody.issue({ ownerSession: SESSION, readerSession: PEER, sourceId, version,
    operation: "read", expiresAt: expiry(), ...extra });
}

test("protected source custody uses real Starling Save, authenticated sessions and disposable PostgreSQL", { timeout: 120000 }, async t => {
  const y = await world(t, true), noY = await world(t, false);

  await t.test("scoped projection is equivalent while the existing account view exposes ciphertext presence", async () => {
    const observe = async world => {
      const view = await world.custody.view(placement);
      assert.equal(view.ok, true);
      const { Element } = createPeTestDom();
      const element = preview({ createElement: tag => new Element(tag) }, view.thought.details);
      const { runtime } = await world.read();
      const exported = runtime.buildCanonicalPocketPayload({ nodes: [view.thought], tombstones: [] },
        { writtenAt: "2026-01-07T00:00:00.000Z" });
      return {
        view, preview: element.textContent, exported: copy(exported),
        visibleMatches: [view.thought].filter(thought => thought.label.includes("Repeated")).length,
        otherPlacement: await world.custody.view({ ...placement, parentId: "n1" }),
        unavailableSibling: await world.custody.view({ ...placement, nodeId: "n1" }),
        source: await world.custody.open(request(world)),
        history: await world.custody.open(request(world, "Z".repeat(43), { operation: "history" })),
      };
    };
    const a = await observe(y), b = await observe(noY);
    assert.deepEqual(a, b);
    assert.deepEqual(Object.keys(a.view.thought), ["id", "parentId", "label", "details"]);
    assert.deepEqual(a.source, denied);
    const raw = (await y.rawViewer()).document.nodes[0], absent = (await noY.rawViewer()).document.nodes[0];
    assert.equal(Object.hasOwn(raw, CAPSULE), true);
    assert.equal(Object.hasOwn(absent, CAPSULE), false);
    assert.ok(raw[CAPSULE].record.ciphertext.length > 125000);
    t.diagnostic("Existing same-account reader can distinguish hidden source presence and ciphertext size.");
  });

  await t.test("fresh custody read requires a one-use exact source, placement, actor and operation grant", async () => {
    assert.deepEqual(await grant(y, { ownerSession: PEER }), denied);
    const ownerGrant = await grant(y, { readerSession: SESSION });
    assert.ok(ownerGrant.ok);
    assert.equal((await y.custody.view({ ...placement, sessionId: SESSION })).ok, true);
    const openedByOwner = await y.custody.open(request(y, ownerGrant.token, { sessionId: SESSION }));
    assert.equal(openedByOwner.json === y.firstJson, true);
    const allowed = await grant(y);
    assert.ok(allowed.ok);
    await y.restart();
    for (const change of [{ sessionId: "missing-session" }, { sessionId: SESSION }, { nodeId: "n1" },
      { ...y.coordinates.get("original-z") }, { parentId: "another-placement" }, { version: "older-version" },
      { operation: "copy" }, { operation: "export" }, { token: "Z".repeat(43) }]) {
      assert.deepEqual(await y.custody.open(request(y, allowed.token, change)), denied);
    }
    const replay = await Promise.all([y.custody.open(request(y, allowed.token)), y.custody.open(request(y, allowed.token))]);
    const success = replay.filter(r => r.ok);
    assert.equal(success.length, 1);
    assert.deepEqual(Object.keys(success[0]), ["ok", "json"]);
    assert.ok(y.firstJson.length > 125000);
    assert.equal(success[0].json === y.firstJson, true);
    assert.equal(hash(success[0].json), y.coordinates.get("original-y").version);
    assert.deepEqual(await y.custody.open(request(y, allowed.token)), denied);
    const exportGrant = await grant(y, { operation: "export" });
    assert.deepEqual(await y.custody.open(request(y, exportGrant.token, { operation: "copy" })), denied);
    assert.equal((await y.custody.open(request(y, exportGrant.token, { operation: "export" }))).json === y.firstJson, true);

    const sameAccount = await y.rawViewer();
    assert.equal(sameAccount.accountKey.extractable, false);
    const wrong = await openSourceCapsule(sameAccount.runtime, { capsule: sameAccount.document.nodes[0][CAPSULE],
      capsuleKey: sameAccount.accountKey, syncedPocketId: "p146", sourceSha256: y.exportDigest, nodeId: "n0" });
    assert.deepEqual(wrong, denied);
  });

  await t.test("revocation, expiry, custody scope and missing or damaged fragments withhold plaintext", async () => {
    const active = await grant(y);
    assert.equal(await y.custody.revoke({ ownerSession: PEER, token: active.token }), false);
    y.faults.beforeKey = async () => {
      delete y.faults.beforeKey;
      assert.equal(await y.custody.revoke({ ownerSession: SESSION, token: active.token }), true);
    };
    assert.deepEqual(await y.custody.open(request(y, active.token)), denied);
    const timeLimited = await grant(y);
    await y.admin.query("UPDATE public.pocket_lab_source_grants SET expires_at=clock_timestamp() WHERE token_hash=$1",
      [hash(timeLimited.token)]);
    assert.deepEqual(await y.custody.open(request(y, timeLimited.token)), denied);
    const stale = await grant(y);
    assert.equal(await y.custody.changeScope({ ownerSession: SESSION, sourceId: "original-y" }), true);
    assert.deepEqual(await y.custody.open(request(y, stale.token)), denied);

    const retry = await grant(y);
    y.faults.keyUnavailable = true;
    assert.deepEqual(await y.custody.open(request(y, retry.token)), denied);
    y.faults.keyUnavailable = false;
    y.faults.wrongKey = await (await y.read()).runtime.PocketSyncCrypto.generateDeviceWrappingKey();
    assert.deepEqual(await y.custody.open(request(y, retry.token)), denied);
    delete y.faults.wrongKey;
    for (const fail of [
      () => undefined,
      (capsule, other) => ({ ...capsule, record: other.record }),
      capsule => ({ ...capsule, ref: "wrong-source-reference" }),
      ...[parts => parts.slice(1), parts => parts.slice().reverse(),
        parts => [(parts[0][0] === "A" ? "B" : "A") + parts[0].slice(1), ...parts.slice(1)]]
        .map(change => capsule => {
          const fragmented = splitRecord(capsule.ref, capsule.record);
          try { return { ...capsule, record: joinRecord(capsule.ref, { ...fragmented, parts: change(fragmented.parts) }) }; }
          catch { return { ...capsule, record: null }; }
        }),
    ]) {
      y.faults.capsule = fail;
      assert.deepEqual(await y.custody.open(request(y, retry.token)), denied);
      assert.equal((await y.custody.view(placement)).ok, true);
    }
    delete y.faults.capsule;
    assert.equal((await y.custody.open(request(y, retry.token))).json === y.firstJson, true);
  });

  await t.test("ordinary derived editing and lost acknowledgement preserve attached source", async () => {
    const old = await y.read();
    const edit = { ...placement, details: "An ordinary derived edit." };
    const a = await y.custody.editDetails(edit), b = await noY.custody.editDetails(edit);
    assert.deepEqual(a, { outcome: "committed" });
    assert.deepEqual(a, b);
    assert.deepEqual(await y.custody.view(placement), await noY.custody.view(placement));
    y.faults.loseReply = true;
    assert.deepEqual(await y.custody.editDetails({ ...edit, details: "One more edit." }), { outcome: "ambiguous" });
    assert.equal((await y.faults.lastWrite.reconcileAmbiguous()).outcome, "committed");
    const fresh = await y.read();
    assert.equal(fresh.head.revision, old.head.revision + 2);
    assert.equal(fresh.document.nodes[0].details, "One more edit.");
    assert.deepEqual(fresh.document.nodes[0][CAPSULE], old.document.nodes[0][CAPSULE]);
    assert.deepEqual(fresh.document.nodes.slice(1), old.document.nodes.slice(1));
    const good = await grant(y);
    assert.equal((await y.custody.open(request(y, good.token))).json === y.firstJson, true);
    assert.deepEqual(await y.custody.open(request(y)), denied);
  });
});
