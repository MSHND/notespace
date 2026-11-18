"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { createPostgresStore } = require("../sync-service/pocket-sync-postgres-store.js");
const { issueWriterGrant } = require("../tools/pocket-writer-format-admission.js");
const { instrumentHeadPool } = require("./helpers/pocket-writer-postgres-lab.js");
const save = require("../tools/pocket-private-source-save-lab.js");

const source = fs.readFileSync(path.join(__dirname, "pocket-separated-delivery.test.js"), "utf8");
const prior = new Function("require", "__dirname", source
  .replace('const test = require("node:test");', "const test = () => {};")
  + "\nreturn { scenario, setupPostgres, seedViewer, mirror, originalFor, mount, prepare, review, call,"
  + "target, issue, read, copy, future, split, custody, p168, post, httpOptions, SESSION, PEER, pocketId,"
  + "placement, missing, guessedRef, CAPSULE, VIEWER, OWNER, ROUTES };")(require, __dirname);
const { scenario, setupPostgres, seedViewer, mirror, originalFor, mount, prepare, review, call, target,
  issue, read, copy, future, split, custody, p168, post, httpOptions, SESSION, PEER, pocketId,
  placement, missing, guessedRef, CAPSULE, VIEWER, OWNER, ROUTES } = prior;
let sequence = 0;
const id = prefix => prefix + "-" + (++sequence);
const send = (world, route, body, token, actor = PEER) => post(
  target({ http: world.save.handle }, { root: save.SAVE_ROOT, actor }), route, body, token, actor,
);
const publish = (world, command, token) => send(world, "compareAndSetShadowHead", command, token);
const status = (world, command) => send(world, "readRevision", {
  apiVersion: 1, operationId: "status-probe", commandId: command.operationId,
});
const sameBytes = (a, b) => assert.equal(JSON.stringify(a) === JSON.stringify(b), true);

async function inspect(h, world, command) {
  const before = await h.reader(world.writer.handle, id("inspect-base")), records = {};
  const after = await h.reader(async request => {
    const response = await world.writer.handle(request);
    if (new URL(request.url).pathname.endsWith(ROUTES.getOpaqueObject)) {
      const body = await response.clone().json();
      if (body.present) records[body.storageRef] = body.record;
    }
    if (!new URL(request.url).pathname.endsWith(ROUTES.readShadowHead)) return response;
    const body = await response.json();
    return Response.json({ ...body, head: { ...command.expectedHead,
      revision: command.expectedHead.revision + 1, sealRef: command.candidateSealStorageRef } });
  }, id("inspect-candidate"));
  async function seal(view) {
    const ref = view.head.sealRef, record = await world.stock.getObject(pocketId, ref);
    const bytes = await view.runtime.PocketStarlingCryptoShadow.openObject(record, ref, view.accountKey, h.context);
    return view.runtime.PocketStarlingStorageShadow.validateCapsuleBytes(bytes);
  }
  const [baseSeal, candidateSeal] = await Promise.all([seal(before), seal(after)]);
  return { before, after: after.document, records, baseLogicalSeal: baseSeal.logicalRef,
    previousLogicalSeal: candidateSeal.object.previousSealRef };
}

function mountSave(h, world, original) {
  mount(h, world, original);
  const instrumented = instrumentHeadPool(world.writer.raw, world.hooks);
  world.save = save.createPrivateSourceSaveLab({
    issuerPool: world.admin, httpOptions,
    // The inherited beforeCommit hook deliberately kills the connection.
    // This additional observation point allows a live transaction to resume.
    writerPool: { async connect() {
      const client = await instrumented.connect();
      return {
        async query(sql, values) {
          const result = await client.query(sql, values);
          if (sql.startsWith("UPDATE public.pocket_sync_heads SET revision") && result.rowCount === 1 && world.hooks.afterUpdate) {
            const { rows: [row] } = await client.query("SELECT pg_backend_pid() AS pid");
            await world.hooks.afterUpdate(row.pid);
          }
          return result;
        },
        release: discard => client.release(discard),
      };
    } },
    createCore: objects => p168.core({ store: createPostgresStore({ pool: world.writer.raw }) }, { store: objects }),
    inspect: command => inspect(h, world, command),
    beforeRelease: result => world.hooks.beforeRelease?.(result),
  });
}

function entry(world) {
  return async request => {
    const route = new URL(request.url).pathname;
    const writes = ["putOpaqueObject", "objectPresence", "compareAndSetShadowHead"].some(name => route.endsWith(ROUTES[name]));
    const response = await (writes
      ? target({ http: world.save.handle }, { root: save.SAVE_ROOT })
      : target(world))(request);
    if (route.endsWith(ROUTES.compareAndSetShadowHead)) {
      world.lastCas = { status: response.status, body: await response.clone().json() };
    }
    return response;
  };
}

async function rights(world, change) {
  const row = (await world.admin.query("SELECT * FROM public.pocket_lab_x_edit_authority")).rows[0];
  await world.admin.query(`UPDATE public.pocket_lab_x_edit_authority
    SET epoch=epoch+1, allowed=$1, dependency_source_id=$2`,
  [change.allowed ?? row.allowed, Object.hasOwn(change, "dependency") ? change.dependency : row.dependency_source_id]);
}

test("an X-only Save carries current hidden scope while retaining material conflict controls", { timeout: 120000 }, async t => {
  const h = await scenario(t), emptyLab = await setupPostgres(t);
  const y = { lab: h.lab, admin: h.admin, hooks: {} }, empty = { lab: emptyLab, admin: emptyLab.admin(), hooks: {} };
  const worlds = [empty, y];
  await seedViewer(y.admin);
  await mirror(y.admin, empty.admin, ["pocket_sync_objects", "pocket_sync_records", "pocket_sync_heads"]);
  const original = await originalFor(h);
  y.wrappingKey = original.wrappingKey;
  for (const world of worlds) {
    await world.admin.query(custody.INSTALL_SQL);
    await world.admin.query(split.INSTALL_SQL);
    mount(h, world, world === y ? original : null);
  }
  const { label, details, editor, source: origin, updatedAt } = h.input.mainThoughtTree[0];
  const payload = { label, details, editor, source: origin, updatedAt };
  const upgrade = await prepare(h, y, payload);
  await mirror(y.admin, empty.admin, ["pocket_sync_objects"]);
  await y.stock.putObject(split.privateBucket(pocketId), original.capsule.ref, original.capsule.record);
  for (const world of worlds) {
    const token = await review(h, world, upgrade, world === y ? original : undefined);
    assert.equal((await post(world.writer.handle, "compareAndSetShadowHead", upgrade.command, token, PEER)).status, 200);
  }
  const scopeChange = () => y.custody.changeScope({ ownerSession: SESSION, sourceId: placement.sourceId });
  const sourceRow = async () => (await y.admin.query("SELECT * FROM public.pocket_lab_source_custody")).rows[0];

  await t.test("the unchanged earlier gate reproduces HTTP 200 without Y and 409 after private scope change", async () => {
    const draft = await prepare(h, y, { ...payload, details: "Fictional baseline.\n" + details });
    await mirror(y.admin, empty.admin, ["pocket_sync_objects"]);
    const tickets = await Promise.all(worlds.map(world => review(h, world, draft)));
    assert.equal(await scopeChange(), true);
    const responses = await Promise.all(worlds.map((world, index) =>
      post(world.writer.handle, "compareAndSetShadowHead", draft.command, tickets[index], PEER)));
    assert.deepEqual(responses.map(reply => reply.status), [200, 409]);
    await y.admin.query("DELETE FROM public.pocket_lab_scoped_candidates WHERE candidate_seal=$1",
      [draft.command.candidateSealStorageRef]);
    assert.equal((await post(y.writer.handle, "compareAndSetShadowHead", draft.command, await review(h, y, draft), PEER)).status, 200);
    payload.details = draft.document.nodes[0].details;
    t.diagnostic("Original gate: W0 HTTP 200, W1 HTTP 409 after a private scope update.");
  });

  for (const world of worlds) {
    await world.admin.query(save.INSTALL_SQL);
    await world.admin.query("INSERT INTO public.pocket_lab_x_edit_authority VALUES ($1,$2,$3,$4,1,true,NULL)",
      [pocketId, VIEWER, placement.nodeId, placement.parentId]);
    mountSave(h, world, world === y ? original : null);
  }

  async function pairedEdit(text, { beforeReview, afterReview, loseReply = false, receiptEpoch } = {}) {
    const base = await h.reader(entry(y), id("normal-open"));
    const { id: nodeId, parentId, order, ...priorPayload } = base.document.nodes[0];
    let command, peerReply;
    const transaction = await base.transaction(id("normal-save"), { sessionId: PEER, loseReply, async grant(input) {
      command = input;
      await beforeReview?.();
      const token = await y.save.review(PEER, input);
      await mirror(y.admin, empty.admin, ["pocket_sync_objects"]);
      const peerToken = await empty.save.review(PEER, input);
      await afterReview?.();
      peerReply = await publish(empty, input, peerToken);
      return token;
    } });
    const result = await transaction.savePayload({ nodeId, payload: { ...priorPayload, details: text } });
    assert.equal(result.outcome, loseReply ? "ambiguous" : "committed");
    sameBytes(y.lastCas, peerReply);
    assert.equal(y.lastCas.status, 200);
    const snapshots = await Promise.all(worlds.map(world => h.reader(entry(world), id("fresh-visible"))));
    sameBytes(snapshots[0].document, snapshots[1].document);
    sameBytes(snapshots[0].head, snapshots[1].head);
    assert.equal(snapshots[0].head.revision, base.head.revision + 1);
    assert.equal(snapshots[0].document.nodes[0].details, text);
    assert.deepEqual({ ...snapshots[0].document.nodes[0], details: base.document.nodes[0].details }, base.document.nodes[0]);
    assert.deepEqual({ ...snapshots[0].document, nodes: base.document.nodes }, base.document);
    assert.deepEqual(snapshots[0].document.nodes.slice(1), base.document.nodes.slice(1));
    const statuses = await Promise.all(worlds.map(world => status(world, command)));
    sameBytes(statuses[0], statuses[1]);
    assert.equal(statuses[0].body.state, "committed");
    assert.equal(statuses[0].body.receipt.schema, save.RECEIPT_SCHEMA);
    const stored = (await y.admin.query("SELECT * FROM public.pocket_lab_x_receipts WHERE operation_id=$1",
      [command.operationId])).rows[0];
    const currentSource = await sourceRow();
    assert.deepEqual(stored.private_source, { ...currentSource, epoch: receiptEpoch ?? currentSource.epoch });
    assert.equal(JSON.stringify(statuses).includes(original.capsule.ref), false);
    return { base, transaction, command, status: statuses[0], current: snapshots[0] };
  }
  const checkOriginal = async () => {
    const owner = await read(y, original, await issue(y, original, SESSION), { sessionId: SESSION });
    assert.equal(owner.json === original.json, true);
    const retained = await sourceRow();
    assert.equal(retained.capsule_ref, original.capsule.ref);
    assert.equal(retained.version, original.binding.version);
    assert.equal(retained.node_id, placement.nodeId);
    assert.equal(retained.parent_id, placement.parentId);
    assert.deepEqual(await read(y, original), missing);
  };

  let accepted;
  await t.test("ordinary Save is byte-equivalent before and after unrelated private epoch updates", async () => {
    const revoked = await issue(y, original), firstEpoch = (await sourceRow()).epoch;
    accepted = await pairedEdit("A fictional permitted edit.\n" + details, { afterReview: scopeChange });
    assert.equal((await sourceRow()).epoch, firstEpoch + 1);
    assert.deepEqual(await read(y, original, revoked), missing);
    const stillLive = await issue(y, original);
    await pairedEdit("Another fictional edit.\n" + details, { beforeReview: scopeChange });
    assert.deepEqual(await read(y, original, stillLive), missing);
    await checkOriginal();
    const traces = await Promise.all(worlds.map(async world => ({
      head: await call(world, "readShadowHead"),
      get: await call(world, "getOpaqueObject", { storageRef: original.capsule.ref }),
      presence: await call(world, "objectPresence", { storageRefs: [original.capsule.ref, guessedRef] }),
      staged: await send(world, "objectPresence", { apiVersion: 1, operationId: "presence-probe",
        storageRefs: [original.capsule.ref, guessedRef] }),
      history: await status(world, accepted.command),
    })));
    sameBytes(traces[0], traces[1]);
    assert.equal(traces[0].history.body.state, "superseded");
    t.diagnostic("New normal Starling Save: W0/W1 HTTP 200 with identical envelopes, exact X and current private epoch.");
  });

  await t.test("a targeted inverse preserves later private grant changes and reports historical acceptance truthfully", async () => {
    const before = await h.reader(entry(y), id("undo-target"));
    const edit = await pairedEdit("A reversible fictional edit.\n" + details);
    const token = await issue(y, original);
    assert.equal(await scopeChange(), true);
    const latest = await sourceRow();
    const currentGrant = await issue(y, original);
    await pairedEdit(before.document.nodes[0].details);
    assert.deepEqual(await sourceRow(), latest);
    assert.deepEqual(await read(y, original, token), missing);
    assert.equal((await read(y, original, currentGrant)).json === original.json, true);
    assert.equal((await status(y, edit.command)).body.state, "superseded");
    await checkOriginal();
  });

  await t.test("private epoch updates interleaved with the actual Head transaction are carried without rollback", async () => {
    const beforeEpoch = (await sourceRow()).epoch;
    y.hooks.beforeUpdate = async () => { delete y.hooks.beforeUpdate; assert.equal(await scopeChange(), true); };
    await pairedEdit("A fictional interleaved edit.\n" + details);
    assert.equal((await sourceRow()).epoch, beforeEpoch + 1);
    let update;
    const client = await y.admin.connect();
    try {
      y.hooks.afterUpdate = async blockingPid => {
        delete y.hooks.afterUpdate;
        update = client.query("UPDATE public.pocket_lab_source_custody SET epoch=epoch+1 RETURNING epoch");
        let blocked = false;
        for (let attempt = 0; attempt < 50 && !blocked; attempt += 1) {
          blocked = (await y.admin.query("SELECT $1 = ANY(pg_blocking_pids($2)) AS blocked",
            [blockingPid, client.processID])).rows[0].blocked;
          if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(blocked, true);
      };
      const edit = await pairedEdit("A fictional lock-ordered edit.\n" + details, { receiptEpoch: (await sourceRow()).epoch });
      await update;
      const { rows: [stored] } = await y.admin.query("SELECT private_source FROM public.pocket_lab_x_receipts WHERE operation_id=$1",
        [edit.command.operationId]);
      assert.equal((await sourceRow()).epoch, stored.private_source.epoch + 1);
      sameBytes(await status(empty, edit.command), await status(y, edit.command));
    } finally { await update; client.release(); }
    await checkOriginal();
    t.diagnostic("Source update before the Head UPDATE was included; an update blocked by publication completed afterwards without being reverted.");
  });

  await t.test("crash rollback retains the old Head and a lost acknowledgement reconciles after restart", async () => {
    const draft = await prepare(h, y, { ...payload, details: "Fictional rollback.\n" + details });
    const ticket = await y.save.review(PEER, draft.command);
    const before = (await call(y, "readShadowHead")).body.head, privateBefore = await sourceRow();
    y.hooks.beforeCommit = async pid => {
      delete y.hooks.beforeCommit;
      assert.equal((await y.admin.query("SELECT pg_terminate_backend($1, 5000) AS stopped", [pid])).rows[0].stopped, true);
    };
    assert.equal((await publish(y, draft.command, ticket)).status, 503);
    assert.deepEqual((await call(y, "readShadowHead")).body.head, before);
    assert.deepEqual(await sourceRow(), privateBefore);
    assert.equal((await status(y, draft.command)).body.state, "unknown");
    const lost = await pairedEdit("Fictional lost reply.\n" + details, { loseReply: true, afterReview: scopeChange });
    for (const world of worlds) {
      await world.lab.restart();
      world.admin = world.lab.admin();
      mountSave(h, world, world === y ? original : null);
    }
    assert.equal((await lost.transaction.reconcileAmbiguous()).outcome, "committed");
    sameBytes(await status(empty, lost.command), await status(y, lost.command));
    assert.equal((await call(y, "readShadowHead")).body.head.revision, lost.base.head.revision + 1);
    await checkOriginal();
  });

  await t.test("current X authority, wrong placement and source-altering payloads refuse without partial acceptance", async () => {
    const draft = await prepare(h, y, { ...payload, details: "Fictional revoked edit." });
    const token = await y.save.review(PEER, draft.command);
    const before = (await call(y, "readShadowHead")).body.head, privateBefore = await sourceRow();
    await rights(y, { allowed: false });
    assert.equal((await publish(y, draft.command, token)).status, 409);
    assert.equal((await status(y, draft.command)).body.state, "unknown");
    await rights(y, { allowed: true });
    await assert.rejects(y.save.review(SESSION, { ...draft.command, operationId: id("wrong-actor") }), { code: "head-conflict" });
    const current = await h.reader(entry(y), id("illegal-operation"));
    const attempt = async action => {
      let refused;
      const tx = await current.transaction(id("illegal-write"), { sessionId: PEER, async grant(command) {
        try { return await y.save.review(PEER, command); }
        catch (error) { refused = error; throw error; }
      } });
      assert.equal((await action(tx)).outcome, "ambiguous");
      assert.equal(refused?.code, "head-conflict");
      assert.equal((await tx.reconcileAmbiguous()).outcome, "not-committed");
    };
    await attempt(tx => tx.saveMove({ nodeId: "n0", fromIndex: 0, newParentId: "n1", toIndex: 0 }));
    const { id: ignored, parentId, order, ...currentPayload } = current.document.nodes[0];
    for (const capsule of [null, original.capsule]) {
      await attempt(tx => tx.savePayload({ nodeId: "n0", payload: { ...currentPayload, [CAPSULE]: capsule } }));
    }
    await attempt(tx => tx.savePayload({ nodeId: "n1", payload: { label: "A fictional sibling", details: "Unauthorised sibling edit" } }));
    assert.deepEqual((await call(y, "readShadowHead")).body.head, before);
    assert.deepEqual(await sourceRow(), privateBefore);
  });

  await t.test("forged grants, old writers and public private-field injection fail closed", async () => {
    const draft = await prepare(h, y, { ...payload, details: "Fictional unapproved writer." });
    const before = (await call(y, "readShadowHead")).body.head;
    const unreviewed = await issueWriterGrant(y.admin, PEER, draft.command, future());
    for (const token of [undefined, "v3", "Z".repeat(43), unreviewed]) {
      assert.equal((await publish(y, draft.command, token)).status, 409);
    }
    assert.notEqual((await post(y.writer.old, "compareAndSetShadowHead", draft.command, undefined, PEER)).status, 200);
    for (const change of [{ existing_epoch: 1 }, { sourceRef: original.capsule.ref }, { unrelated: true }]) {
      const injected = { ...draft.command, ...change };
      await assert.rejects(y.save.review(PEER, injected), { code: "service-request-invalid" });
      assert.equal((await publish(y, injected, unreviewed)).status, 400);
    }
    const expired = await y.save.review(PEER, draft.command);
    await y.admin.query("UPDATE public.pocket_lab_writer_grants SET expires_at=clock_timestamp() WHERE token_hash=$1",
      [createHash("sha256").update(expired).digest("hex")]);
    assert.equal((await publish(y, draft.command, expired)).status, 409);
    assert.equal((await publish(y, { ...draft.command, expectedAuthorityRevision: h.epoch + 1 }, expired)).status, 409);
    assert.equal((await call(y, "downloadEncryptedRecord", { revision: 1 }, { root: httpOptions.serviceRoot })).status, 404);
    assert.deepEqual((await call(y, "readShadowHead")).body.head, before);
    assert.equal((await status(y, draft.command)).body.state, "unknown");
  });

  await t.test("duplicate and competing CAS commands advance one revision and preserve another writer", async () => {
    const first = await prepare(h, y, { ...payload, details: "A fictional winning edit." });
    const stale = await prepare(h, y, { ...payload, details: "A fictional competing edit." });
    const ticket = await y.save.review(PEER, first.command), staleTicket = await y.save.review(PEER, stale.command);
    await mirror(y.admin, empty.admin, ["pocket_sync_objects"]);
    const peerTicket = await empty.save.review(PEER, first.command);
    const replies = await Promise.all([publish(y, first.command, ticket), publish(y, first.command, ticket)]);
    assert.ok(replies.some(reply => reply.status === 200));
    assert.ok(replies.every(reply => [200, 409].includes(reply.status)));
    assert.equal((await publish(empty, first.command, peerTicket)).status, 200);
    assert.equal((await publish(y, stale.command, staleTicket)).status, 409);
    assert.equal((await status(y, stale.command)).body.state, "unknown");
    assert.equal((await call(y, "readShadowHead")).body.head.revision, first.command.expectedHead.revision + 1);
    assert.equal((await h.reader(entry(y), id("winner-open"))).document.nodes[0].details, first.document.nodes[0].details);
    assert.equal((await y.admin.query("SELECT 1 FROM public.pocket_lab_x_receipts WHERE operation_id=$1",
      [first.command.operationId])).rowCount, 1);
    sameBytes(await status(empty, first.command), await status(y, first.command));
  });

  await t.test("a second accepted X edit before reply makes the earlier acknowledgement ambiguous", async () => {
    const base = await h.reader(entry(y), id("delivery-base"));
    const { id: nodeId, parentId, order, ...currentPayload } = base.document.nodes[0];
    let command;
    const transaction = await base.transaction(id("delivery-race"), { sessionId: PEER, async grant(input) {
      command = input;
      const token = await y.save.review(PEER, input);
      await mirror(y.admin, empty.admin, ["pocket_sync_objects"]);
      assert.equal((await publish(empty, input, await empty.save.review(PEER, input))).status, 200);
      return token;
    } });
    const laterText = "A fictional later editor won.\n" + details;
    y.hooks.beforeRelease = async result => {
      if (result?.status !== 200) return;
      delete y.hooks.beforeRelease;
      await pairedEdit(laterText);
    };
    assert.equal((await transaction.savePayload({ nodeId, payload: { ...currentPayload,
      details: "A fictional earlier accepted edit.\n" + details } })).outcome, "ambiguous");
    assert.equal(y.lastCas.status, 503);
    assert.equal(y.lastCas.body.reason, "service-publication-ambiguous");
    const observed = await status(y, command);
    sameBytes(observed, await status(empty, command));
    assert.equal(observed.body.state, "superseded");
    assert.equal(observed.body.head.revision, base.head.revision + 2);
    assert.equal(observed.body.receipt.head.revision, base.head.revision + 1);
    assert.equal((await h.reader(entry(y), id("later-current"))).document.nodes[0].details, laterText);
    await checkOriginal();
    t.diagnostic("A later accepted X edit before response produced HTTP 503/ambiguous; status retained the historical receipt and current Head.");
  });

  await t.test("a trusted material source dependency retains the observable refusal contradiction", async () => {
    await rights(y, { dependency: placement.sourceId });
    const draft = await prepare(h, y, { ...payload, details: "A fictional materially dependent edit." });
    await mirror(y.admin, empty.admin, ["pocket_sync_objects"]);
    const tickets = await Promise.all(worlds.map(world => world.save.review(PEER, draft.command)));
    assert.equal(await scopeChange(), true);
    const replies = await Promise.all(worlds.map((world, index) => publish(world, draft.command, tickets[index])));
    assert.deepEqual(replies.map(reply => reply.status), [200, 409]);
    assert.equal((await status(y, draft.command)).body.state, "unknown");
    assert.equal((await status(empty, draft.command)).body.state, "committed");
    assert.equal((await call(y, "readShadowHead")).body.head.revision, draft.command.expectedHead.revision);
    await checkOriginal();
    t.diagnostic("Material dependency witness: W0 HTTP 200, W1 HTTP 409. Current source-dependent editing rights differ; hidden-dependency refusal privacy remains unproved.");
    await rights(y, { dependency: null });
  });

  await t.test("revocation after commit withholds the Save reply and current-authority status", async () => {
    const draft = await prepare(h, y, { ...payload, details: "A fictional in-flight edit." });
    const ticket = await y.save.review(PEER, draft.command);
    y.hooks.beforeRelease = async result => {
      if (result?.status !== 200) return;
      delete y.hooks.beforeRelease;
      await createPostgresStore({ pool: y.admin }).transact("readwrite", async tx => {
        const session = await tx.get("sessions", PEER);
        await tx.replace("sessions", PEER, session.storeVersion, { ...session,
          storeVersion: session.storeVersion + 1, status: "revoked", replacedBy: SESSION });
      });
    };
    assert.equal((await publish(y, draft.command, ticket)).status, 401);
    assert.equal((await status(y, draft.command)).status, 401);
    assert.equal((await publish(y, draft.command, ticket)).status, 401);
    const privateReceipt = (await y.admin.query("SELECT * FROM public.pocket_lab_x_receipts WHERE operation_id=$1",
      [draft.command.operationId])).rows[0];
    assert.equal(privateReceipt.public_receipt.head.revision, draft.command.expectedHead.revision + 1);
    assert.deepEqual(privateReceipt.private_source, await sourceRow());
    assert.equal((await h.reader(target(y, { actor: SESSION }), id("owner-after-revoke"))).document.nodes[0].details,
      draft.document.nodes[0].details);
    await checkOriginal();
    t.diagnostic("Commit followed by revocation returned HTTP 401; revoked status/retry stayed 401 and one durable acceptance receipt survived.");
  });
});
