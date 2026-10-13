"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const plain = (value) => JSON.parse(JSON.stringify(value));

function runtime() {
  const c = { Object, Array, String, Number, Boolean, Map, Set, Promise, Error, JSON, Math, RegExp };
  c.window = c; c.globalThis = c; vm.createContext(c);
  for (const file of ["js/pocket-starling-object-seal-shadow.js", "js/pocket-starling-materialize-shadow.js"])
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), c, { filename: file });
  return c;
}

function fixture(c, count = 4, badNode = null) {
  const logical = c.PocketStarlingObjectSealShadow, store = new Map(), calls = [];
  const put = (kind, value) => { const bytes = logical.canonical(value).bytes, ref = logical.refFor(kind, bytes); store.set(ref, bytes); return ref; };
  const sequence = (items) => put("sequence-leaf", { schema: logical.SEQUENCE_SCHEMA, kind: "sequence-leaf", capacity: 4, count: items.length, items });
  const entries = [["root", sequence(["visible", "unrelated"])], ["visible", sequence(["visible-first", "visible-second"])] , ["visible-first", sequence([])], ["visible-second", sequence([])]];
  let parent = "unrelated";
  for (let index = 0; index < count - 4; index += 1) { const id = `bulk-${index}`; entries.push([parent, sequence([id])]); entries.push([id, sequence([])]); parent = id; }
  if (count > 4) entries.push(["unrelated", sequence(["bulk-0"])]); else entries.push(["unrelated", sequence([])]);
  const trie = (kind, values) => {
    const root = {};
    for (const [key, valueRef] of values) { let at = root; for (const ch of key) at = at[ch] || (at[ch] = {}); at.valueRef = valueRef; }
    const build = (at) => put(kind, { schema: logical.OBJECT_SCHEMA, kind, hasValue: !!at.valueRef, valueRef: at.valueRef || null, children: Object.keys(at).filter((key) => key !== "valueRef").sort().map((key) => ({ key, ref: build(at[key]) })) });
    return build(root);
  };
  const preservationRef = put("preservation", { schema: logical.OBJECT_SCHEMA, kind: "preservation", value: { source: { schema: "portal.mtt.web.v1", writtenAt: "2026-10-13T00:00:00.000Z" }, tombstones: [], rootExtras: {}, dataExtras: {} } });
  const empty = trie("content-trie", []), placement = trie("placement-trie", []), childrenRef = trie("children-trie", entries);
  const rootRef = put("pocket-root", { schema: logical.ROOT_SCHEMA, kind: "pocket-root", capacity: 4, contentRef: empty, placementRef: placement, childrenRef, preservationRef });
  const sealRef = put("candidate-seal", { schema: logical.SEAL_SCHEMA, kind: "candidate-seal", rootRef, previousSealRef: null });
  const session = { acceptedSealRef: sealRef, async resolveLogical(ref) { calls.push(ref); return store.get(ref); }, async readContent(nodeId) { return { ok: true, nodeId, payload: { label: nodeId } }; }, async readPlacement(nodeId) { return { ok: true, nodeId, parentId: nodeId === badNode ? "wrong" : nodeId.startsWith("bulk-") ? (nodeId === "bulk-0" ? "unrelated" : `bulk-${Number(nodeId.slice(5)) - 1}`) : nodeId.startsWith("visible-") ? "visible" : "root" }; } };
  return { session, calls, sealRef, store };
}

async function childSequenceRef(session, childrenRef, parentId) {
  let ref = childrenRef;
  for (let index = 0; ; index += 1) {
    const trie = JSON.parse(await session.resolveLogical(ref));
    if (index === parentId.length) return trie.valueRef;
    ref = trie.children.find((edge) => edge.key === parentId[index]).ref;
  }
}

test("P368 shares accepted validation for complete and explicitly incomplete scoped reads", async () => {
  const c = runtime(), f = fixture(c), api = c.PocketStarlingMaterializeShadow;
  const full = await api.materializeAccepted(f.session);
  assert.equal(full.ok, true); assert.deepEqual(plain(full.document.nodes.map((node) => node.id)), ["visible", "visible-first", "visible-second", "unrelated"]);
  let fullCalls = 0;
  c.PocketStarlingMaterializeShadow = Object.freeze({ ...api, async materializeAccepted() { fullCalls += 1; throw Error("must stay dormant"); } });
  const scoped = await api.createAcceptedSnapshotReader(f.session);
  assert.deepEqual(Object.keys(scoped).sort(), ["acceptedSealRef", "diagnostics", "ok", "readChildren", "readReachedNode", "scope"]);
  assert.equal(scoped.scope, "incomplete"); assert.equal(scoped.acceptedSealRef, f.sealRef);
  const root = await scoped.readChildren("root"), visible = await scoped.readChildren("visible"), node = await scoped.readReachedNode("visible-second");
  assert.deepEqual(plain(root.nodes.map((item) => item.id)), ["visible", "unrelated"]);
  assert.deepEqual(plain(visible.nodes.map((item) => item.id)), ["visible-first", "visible-second"]);
  assert.equal(node.node.id, "visible-second"); assert.equal(root.scope, "incomplete"); assert.equal(fullCalls, 0);
  const before = f.calls.length; assert.deepEqual(plain(await scoped.readChildren("visible")), plain(visible)); assert.equal(f.calls.length, before);
  assert.deepEqual(plain(await scoped.readChildren("bulk-0")), { ok: false, reason: "unreachable-parent" });
  assert.match(fs.readFileSync(path.join(ROOT, "js/pocket-starling-materialize-shadow.js"), "utf8"), /function structural\(session\)/);
});

test("P368 rejects bad scoped expansions atomically and keeps other reached truth usable", async () => {
  const c = runtime(), f = fixture(c, 4, "visible-first"), scoped = await c.PocketStarlingMaterializeShadow.createAcceptedSnapshotReader(f.session);
  assert.equal((await scoped.readChildren("root")).ok, true);
  assert.deepEqual(plain(await scoped.readChildren("visible")), { ok: false, reason: "placement-parent-disagreement" });
  assert.deepEqual(plain(await scoped.readReachedNode("visible-first")), { ok: false, reason: "unreachable-node" });
  assert.equal((await scoped.readReachedNode("visible")).node.id, "visible");
  const broken = { ...f.session, async resolveLogical(ref) { return ref === f.sealRef ? "{" : f.session.resolveLogical(ref); } };
  assert.deepEqual(plain(await c.PocketStarlingMaterializeShadow.createAcceptedSnapshotReader(broken)), { ok: false, reason: "logical-ref-mismatch" });
});

test("P368 full materialisation retains accepted placement/content failure precedence over concurrent children failure", async () => {
  const c = runtime(), f = fixture(c);
  const seal = JSON.parse(await f.session.resolveLogical(f.sealRef));
  const root = JSON.parse(await f.session.resolveLogical(seal.rootRef));
  const visibleChildrenRef = await childSequenceRef(f.session, root.childrenRef, "visible");
  const competing = { ...f.session,
    async resolveLogical(ref) { return ref === visibleChildrenRef ? undefined : f.session.resolveLogical(ref); },
    async readPlacement(nodeId) { return nodeId === "visible" ? { ok: true, nodeId, parentId: "wrong" } : f.session.readPlacement(nodeId); },
  };
  assert.deepEqual(plain(await c.PocketStarlingMaterializeShadow.materializeAccepted(competing)), { ok: false, reason: "placement-parent-disagreement" });
});

test("P368 scoped frontier is bounded across unrelated 100, 500, and 2000-node tails", async () => {
  const rows = [];
  for (const count of [100, 500, 2000]) { const c = runtime(), f = fixture(c, count), scoped = await c.PocketStarlingMaterializeShadow.createAcceptedSnapshotReader(f.session); const before = f.calls.length; assert.equal((await scoped.readChildren("root")).ok, true); assert.equal((await scoped.readChildren("visible")).ok, true); rows.push({ count, calls: f.calls.length - before, diagnostics: plain(scoped.diagnostics()) }); }
  assert.equal(new Set(rows.map((row) => row.calls)).size, 1);
  assert.ok(rows.every((row) => row.diagnostics.contentReads === 4 && row.diagnostics.placementReads === 4));
  console.log(`P368_SCOPED_MEASUREMENTS ${JSON.stringify(rows)}`);
});
