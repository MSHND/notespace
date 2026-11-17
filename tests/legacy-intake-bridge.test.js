"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { SCHEMA, stageLegacyIntake, openSourceCapsule } = require("../tools/pocket-legacy-intake-bridge.js");
const { preflightLegacyMigration } = require("../tools/pocket-legacy-migration-preflight.js");
const { splitRecord, joinRecord } = require("../sync-service/pocket-sync-opaque-record-fragments.js");

const fixture = fs.readFileSync(path.join(__dirname, "p146-starling-accepted-document-materialize.test.js"), "utf8");
const harness = new Function("require", "__dirname",
  fixture.replace('const test = require("node:test"),', "const test = () => {},")
  + "\nreturn { runtime, remote, service, context };")(require, __dirname);
const core = () => {
  const pocket = harness.runtime();
  for (const name of ["device-changes", "sync-owner-controller", "starling-owner-bootstrap"]) {
    const filename = path.join(__dirname, "../js/pocket-" + name + ".js");
    vm.runInContext(fs.readFileSync(filename, "utf8"), pocket, { filename });
  }
  return pocket;
};
const time = "2026-01-07T00:00:00.000Z";
const guard = { schema: "pocket.guard.v1", instanceId: "fictional-instance", sourceFileName: "fictional.json",
  sourceWrittenAt: time, backupWrittenAt: time };
const hash = text => createHash("sha256").update(text).digest("hex");
const plain = value => JSON.parse(JSON.stringify(value));
const ids = prefix => (kind, index) => [prefix, kind, index].join("-");
const capsuleField = "peMigrationLegacySourcePreserved";
const long = "  Fixture 👩🏽‍💻 \r\n e\u0301 / “?” \n\n" + "a".repeat(33500) + "  ";

function legacy(size = 4, deleted = 2, capsuleSize = 16000) {
  const nodes = Array.from({ length: size }, (_, index) => ({
    id: "n" + index, parentId: index < 24 ? "root" : "n" + (index % 24), order: index * 200 - 17,
    label: index < 24 ? "  Repeated \r\n" + "o".repeat(240) + " 🔭 e\u0301  " : "Repeated",
    source: "manual", updatedAt: time, lineage: { sourceId: "origin-" + Math.floor(index / 2), index },
    ...(index === 0 ? { details: long, editor: { folded: false } } : {}),
    ...(index < 4 ? { [capsuleField]: { relationship: { id: "link-" + index, from: "n" + index, to: "n1",
      access: "source-custody", type: "context" }, nested: [index, { numbers: { 2: "two", 9: "nine" },
      text: "  Fictional private 🌔\n\n" + String(index).repeat(capsuleSize) + "  " }] } } : {}),
  }));
  const tombstones = Array.from({ length: deleted }, (_, index) => ({ id: "gone-" + index,
    deletedAt: time, origin: { index } }));
  const tree = { mainThoughtTree: nodes, mainThoughtTreeTombstones: tombstones, pocketGuard: guard };
  return { schema: "portal.export.v1", writtenAt: time, exportedAt: time, ...tree, data: { ...tree } };
}

async function setup() {
  const pocket = core(), remote = harness.remote(), context = harness.context();
  const fragments = new Map();
  remote.objects = {
    set(ref, record) { fragments.set(ref, splitRecord(ref, plain(record))); },
    has(ref) { return fragments.has(ref); },
    get(ref) { return fragments.has(ref) ? joinRecord(ref, fragments.get(ref)) : undefined; },
  };
  const wrap = await pocket.PocketSyncCrypto.generateDeviceWrappingKey();
  const capsuleKey = await pocket.PocketSyncCrypto.generateDeviceWrappingKey();
  const device = { ...context, envelopeId: "bridge-proof", envelopeKind: "device", envelopeVersion: 1 };
  const bundle = await pocket.PocketSyncCrypto.createMasterKeyBundle(
    [{ context: device, wrappingKey: wrap }], { semanticAuthority: true },
  );
  const service = { ...harness.service(pocket, remote), async initialiseShadowHead() { return { head: remote.head }; } };
  const options = { masterKey: bundle.masterKey, semanticAuthority: bundle.semanticAuthority,
    objectHeadService: service, operationIdFactory: ids("intake") };
  const cas = () => remote.calls.filter(([name]) => name === "compareAndSetShadowHead").length;
  const stage = (text, extra) => stageLegacyIntake(pocket, { writerSchema: SCHEMA, text, sourceSha256: hash(text),
    instanceId: guard.instanceId, ...context, capsuleKey, hasSourceAuthority: () => true, ...extra });
  async function fresh(prefix, wrongKey = false) {
    const reader = harness.runtime(), target = harness.service(reader, remote);
    const key = await reader.PocketSyncCrypto.openMasterKeyBundle(
      bundle.envelopes[0].record, wrap, device, [], { semanticAuthority: true },
    );
    const input = { context, semanticAuthority: key.semanticAuthority,
      masterKey: wrongKey ? await reader.PocketSyncCrypto.generateDeviceWrappingKey() : key.masterKey };
    const opened = await reader.PocketStarlingRemoteOpenShadow.createRemoteOpener({
      objectHeadService: target, operationIdFactory: ids(prefix),
    }).openRemote(input);
    return {
      reader, opened, key: key.masterKey,
      material: () => reader.PocketStarlingMaterializeShadow.materializeAccepted(opened.session),
      payload: async nodeId => plain((await opened.session.readContent(nodeId)).payload),
      transaction: (name, objectHeadService = target) => reader.PocketStarlingRemoteSaveShadow.createTransaction({
        ...input, opened, objectHeadService, operationIdFactory: ids(name),
      }),
    };
  }
  return { pocket, remote, fragments, context, capsuleKey, options, service, cas, stage, fresh };
}

test("exact mirrored legacy intake reaches real bootstrap, encrypted Head CAS and an independent Open", async () => {
  const h = await setup(), source = legacy(2894, 902, 125200);
  const original = source.mainThoughtTree[0][capsuleField];
  const raw = JSON.stringify(original).replace('"2":"two","9":"nine"', '"9":"nine",   "2":"two"');
  const text = JSON.stringify(source).replace(JSON.stringify(original), raw);
  assert.equal(preflightLegacyMigration(text).reason, "label-would-change");
  const staged = await h.stage(text);
  assert.equal(staged.outcome, "staged", staged.reason);
  assert.equal(h.remote.calls.length, 0);
  const saved = await staged.save(h.options);
  assert.equal(saved.outcome, "verified", saved.reason);
  assert.equal(saved.head.revision, 1);
  assert.equal(h.cas(), 1);

  const fresh = await h.fresh("full-open"), material = await fresh.material();
  assert.equal(material.ok, true, material.reason);
  const doc = plain(material.document), byId = new Map(doc.nodes.map(node => [node.id, node]));
  assert.equal(byId.size, 2894);
  assert.deepEqual(doc.tombstones, source.mainThoughtTreeTombstones);
  assert.deepEqual(doc.dataExtras.pocketGuard, guard);
  assert.deepEqual(doc.rootExtras.pocketGuard, guard);
  assert.deepEqual(doc.rootExtras.pocketLegacyIntake, { schema: SCHEMA, sourceSha256: hash(text), exportedAt: time });
  assert.equal(doc.writtenAt, source.writtenAt);
  const ranks = new Map();
  for (const node of source.mainThoughtTree) {
    const rank = ranks.get(node.parentId) || 0;
    ranks.set(node.parentId, rank + 1);
    const { order, pocketLegacySourceOrder, [capsuleField]: capsule, ...visible } = byId.get(node.id);
    const { [capsuleField]: expected, ...originalNode } = node;
    assert.deepEqual({ ...visible, order: pocketLegacySourceOrder ?? order }, originalNode);
    assert.equal(order, rank);
    if (!expected) continue;
    const args = { capsule, ...h.context, sourceSha256: hash(text), nodeId: node.id };
    const data = await openSourceCapsule(fresh.reader, { ...args, capsuleKey: h.capsuleKey });
    assert.deepEqual(JSON.parse(data.json), expected);
    assert.equal(data.json, node.id === "n0" ? raw : JSON.stringify(expected));
    assert.deepEqual(await openSourceCapsule(fresh.reader, { ...args, capsuleKey: fresh.key }),
      { ok: false, reason: "source-unavailable" });
    assert.deepEqual(await openSourceCapsule(fresh.reader, { ...args, nodeId: "n-other", capsuleKey: h.capsuleKey }),
      { ok: false, reason: "source-unavailable" });
  }
  assert.ok([...h.fragments.values()].filter(record => record.parts.length > 40).length >= 4);
  await assert.rejects(h.fresh("wrong-key", true), { code: "object-authentication-failed" });
});

test("preflight refuses malformed or ineligible sources before object or Head calls", async () => {
  const h = await setup(), text = JSON.stringify(legacy());
  const cases = [
    ["invalid-node", s => { s.mainThoughtTree[1].id = "n0"; }],
    ["invalid-node", s => { s.mainThoughtTree[0].label = ["bad"]; }],
    ["invalid-node", s => { s.mainThoughtTree[0].details = ["bad"]; }],
    ["invalid-node", s => { s.mainThoughtTree[0][capsuleField] = null; }],
    ["invalid-placement", s => { s.mainThoughtTree[0].parentId = "n1"; s.mainThoughtTree[1].parentId = "n0"; }],
    ["invalid-placement", s => { s.mainThoughtTree[0].parentId = "missing"; }],
    ["invalid-tombstone", s => { s.mainThoughtTreeTombstones[0].id = "n0"; }],
    ["invalid-guard", s => { s.pocketGuard = { ...guard, instanceId: "different" }; s.data.pocketGuard = s.pocketGuard; }],
    ["invalid-envelope", s => { s.schema = "portal.export.v2"; }],
    ["mirror-mismatch", s => { s.data.mainThoughtTree = s.mainThoughtTree.slice(1); }],
    ["oversized-record", s => { s.mainThoughtTree[0].details = "🌙".repeat(1100000); }],
  ];
  for (const [reason, change] of cases) {
    const source = legacy();
    change(source);
    assert.deepEqual(await h.stage(JSON.stringify(source)), { ok: false, reason });
  }
  for (const [reason, extra] of [
    ["unsupported-writer", { writerSchema: "legacy" }],
    ["source-integrity-mismatch", { sourceSha256: hash("different") }],
    ["source-unavailable", { hasSourceAuthority: () => false }],
  ]) assert.deepEqual(await h.stage(text, extra), { ok: false, reason });
  assert.deepEqual(await h.stage(text.replace('"schema":', '"schema":"duplicate","schema":')),
    { ok: false, reason: "duplicate-json-key" });
  assert.equal(h.remote.calls.length, 0);
  assert.equal(h.fragments.size, 0);
});

test("revocation during publication refuses acceptance and bootstrap reconciles a lost reply without re-CAS", async () => {
  const h = await setup(), text = JSON.stringify(legacy());
  let granted = true;
  const staged = await h.stage(text, { hasSourceAuthority: () => granted });
  const stopped = await staged.save({ ...h.options, objectHeadService: {
    ...h.service,
    async objectPresence(...args) {
      const result = await h.service.objectPresence(...args);
      granted = false;
      return result;
    },
  } });
  assert.deepEqual(stopped, { ok: false, reason: "bootstrap-source-stale" });
  assert.equal(h.cas(), 0);
  assert.equal(h.remote.head.revision, 0);
  granted = true;
  h.remote.mode = "apply";
  const saved = await staged.save(h.options);
  assert.equal(saved.outcome, "verified", saved.reason);
  assert.equal(h.cas(), 1);
  assert.equal(h.remote.head.revision, 1);
  h.remote.mode = "normal";
  assert.equal((await (await h.fresh("after-lost")).material()).ok, true);
  assert.equal((await staged.save(h.options)).outcome, "verified");
  assert.equal(h.cas(), 1);

  const different = legacy();
  different.mainThoughtTree[0].label = "Different source";
  const retry = await h.stage(JSON.stringify(different));
  assert.deepEqual(await retry.save(h.options), { ok: false, reason: "bootstrap-existing-head-incompatible" });
  assert.equal(h.cas(), 1);
});

test("damaged physical fragments fail fresh materialisation without returning any document", async () => {
  const h = await setup(), staged = await h.stage(JSON.stringify(legacy()));
  assert.equal((await staged.save(h.options)).outcome, "verified");
  const [ref, record] = [...h.fragments].find(([, item]) => item.parts.length > 5);
  const parts = record.parts;
  const tampered = (parts[0][0] === "A" ? "B" : "A") + parts[0].slice(1);
  for (const damaged of [parts.slice(1), [tampered, ...parts.slice(1)], [...parts].reverse()]) {
    h.fragments.set(ref, { ...record, parts: damaged });
    const fresh = await h.fresh("damaged");
    const read = await fresh.material();
    assert.equal(read.ok, false);
    assert.deepEqual(Object.keys(read), ["ok", "reason"]);
    assert.equal(h.remote.head.revision, 1);
  }
  h.fragments.set(ref, record);
  assert.equal((await (await h.fresh("restored")).material()).ok, true);
});

test("post-import edit and targeted inverse keep one identity and preserve the independent edit", async () => {
  const h = await setup(), staged = await h.stage(JSON.stringify(legacy()));
  assert.equal((await staged.save(h.options)).outcome, "verified");
  const a = await h.fresh("writer"), before = await a.payload("n0");
  const changed = { ...before, details: long.slice(0, 3100) + " 🧩 \n" + long.slice(7100) };
  const interrupted = await a.transaction("interrupted", { ...h.service,
    async compareAndSetShadowHead() { throw new Error("interrupted before CAS"); } });
  assert.equal((await interrupted.savePayload({ nodeId: "n0", payload: changed })).outcome, "ambiguous");
  assert.equal((await interrupted.reconcileAmbiguous()).outcome, "not-committed");
  assert.equal(h.remote.head.revision, 1);
  const edit = await a.transaction("edit");
  assert.equal((await edit.savePayload({ nodeId: "n0", payload: changed })).outcome, "committed");
  assert.equal(h.remote.head.revision, 2);
  const stale = await a.transaction("stale");
  assert.equal((await stale.savePayload({ nodeId: "n0", payload: { ...before, details: "stale" } })).outcome, "conflict");

  const b = await h.fresh("edited"), other = { ...await b.payload("n1"), details: "Independent edit" };
  assert.deepEqual(await b.payload("n0"), changed);
  assert.equal((await (await b.transaction("other")).savePayload({ nodeId: "n1", payload: other })).outcome, "committed");
  const c = await h.fresh("inverse-base");
  assert.equal((await (await c.transaction("inverse")).savePayload({ nodeId: "n0", payload: before })).outcome, "committed");
  const final = await h.fresh("inverse-open");
  assert.equal(h.remote.head.revision, 4);
  assert.deepEqual(await final.payload("n0"), before);
  assert.deepEqual(await final.payload("n1"), other);
});

test("negative witness for existing Starling writer compatibility", async () => {
  const h = await setup(), staged = await h.stage(JSON.stringify(legacy()));
  assert.equal((await staged.save(h.options)).outcome, "verified");
  const old = await h.fresh("old-writer");
  const document = (await old.material()).document;
  const [legacyNode] = old.reader.normaliseNodes([document.nodes[0]]);
  const { id, parentId, order, ...lossy } = legacyNode;
  assert.equal(lossy.label.length, 220);
  assert.equal(Object.hasOwn(lossy, capsuleField), false);
  const result = await (await old.transaction("old-loss"))
    .savePayload({ nodeId: id, payload: lossy });
  assert.equal(result.outcome, "committed");
  const after = await h.fresh("old-loss-readback");
  assert.equal(after.opened.head.revision, 2);
  assert.deepEqual(await after.payload(id), plain(lossy));
});
