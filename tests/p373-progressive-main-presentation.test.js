"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const plain = (value) => JSON.parse(JSON.stringify(value));
const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const node = (id, parentId, order) => ({ id, parentId, order, label: id });

function acceptedFixture(relative, names) {
  const location = path.join(__dirname, relative);
  const content = fs.readFileSync(location, "utf8");
  const declaration = 'const test = require("node:test");';
  assert.ok(content.includes(declaration), "accepted fixture test declaration remains available");
  const module = { exports: {} };
  new Function("require", "module", "exports", "__filename", "__dirname",
    content.replace(declaration, "const test = () => {};")
      + "\nmodule.exports = { " + names.join(", ") + " };\n")(
        require, module, module.exports, location, __dirname);
  return module.exports;
}

// P236 is the existing browser-faithful Main DOM and real Main renderer/actions harness.
const { createHarness } = acceptedFixture("p236-main-local-reorder-projection.test.js", ["createHarness"]);
const real = acceptedFixture("p368-accepted-snapshot-reader.test.js", ["runtime", "fixture"]);

function harness() {
  const h = createHarness();
  const mount = h.document.createElement("ul");
  mount.ownerDocument = h.document;
  mount.scrollTop = 61;
  return { h, mount };
}
function loadP370(context) {
  vm.runInContext(source("js/pocket-progressive-open-state.js"), context,
    { filename: "js/pocket-progressive-open-state.js" });
  return context.PocketProgressiveOpenState;
}
function injected(context, readChildren, seal = "test-accepted-seal") {
  return loadP370(context).createKnowledgeOwner(Object.freeze({
    ok: true, scope: "incomplete", acceptedSealRef: seal, readChildren,
    async readReachedNode() { throw Error("presentation must not revalidate P368"); },
  }));
}
const ok = (parentId, nodes) => ({ ok: true, scope: "incomplete", parentId, nodes });
function present(h, mount, knowledge, guard = () => true) {
  return h.context.createProgressiveMainPresentation({ knowledge, mount, isCurrent: guard });
}
function directBranches(list) {
  return list.childNodes.filter(x => x.className === "treeNode");
}
function row(branch) {
  return branch.childNodes[0];
}
function rowId(branch) {
  return row(branch).getAttribute("data-node-id");
}
function entry(list, id) {
  return directBranches(list).find(x => rowId(x) === id) || null;
}
function childGroup(branch) {
  return branch.childNodes[1];
}
function childStatus(branch) {
  return row(branch).childNodes[1];
}
function rootStatus(mount) {
  return mount.firstChild?.firstChild || null;
}
function ids(list) {
  return directBranches(list).map(rowId);
}
function snapshotMain(h) {
  const s = h.context.state;
  return JSON.stringify({
    nodes: s.nodes, tombstones: s.tombstones, ops: s.ops,
    selectedId: s.selectedId, focusRootId: s.focusRootId,
    operationHighWater: s.operationHighWater,
  });
}
function instrumentation(h) {
  const counts = { create: 0, append: 0, remove: 0, attributes: 0,
    text: 0, queries: 0, focus: 0, fullRender: 0 };
  let active = false;
  const create = h.document.createElement;
  h.document.createElement = function (...args) {
    const element = create.apply(this, args);
    if (active) counts.create += 1;
    // Model textContent mutation on the created DOM element; the accepted
    // P236 harness stores textContent as an own property.
    let current = element.textContent;
    Object.defineProperty(element, "textContent", {
      configurable: true, get() { return current; },
      set(value) { if (active) counts.text += 1; current = String(value); },
    });
    return element;
  };
  const proto = h.HTMLElement.prototype;
  for (const [method, key] of [
    ["appendChild", "append"], ["removeChild", "remove"],
    ["setAttribute", "attributes"], ["querySelectorAll", "queries"],
    ["querySelector", "queries"], ["focus", "focus"],
  ]) {
    const original = proto[method];
    proto[method] = function (...args) {
      if (active) counts[key] += 1;
      return original.apply(this, args);
    };
  }
  const originalRender = h.context.renderTree;
  h.context.renderTree = function (...args) {
    if (active) counts.fullRender += 1;
    return originalRender.apply(this, args);
  };
  return {
    begin() {
      for (const key of Object.keys(counts)) counts[key] = 0;
      active = true;
    },
    end() { active = false; return { ...counts }; },
  };
}

test("P373 real P368 → P370 → mounted Main projection shows unresolved, pending, ordered arrival and scoped child group", async () => {
  const c = real.runtime();
  const f = real.fixture(c);
  const original = c.PocketStarlingMaterializeShadow;
  let fullCalls = 0;
  c.PocketStarlingMaterializeShadow = Object.freeze({
    ...original, materializeAccepted() { fullCalls += 1; throw Error("whole document forbidden"); },
  });
  loadP370(c);
  const reader = await c.PocketStarlingMaterializeShadow.createAcceptedSnapshotReader(f.session);
  assert.equal(reader.ok, true);
  const knowledge = c.PocketProgressiveOpenState.createKnowledgeOwner(reader);
  const targetedKnowledge = { inspect(id) { return knowledge.inspect(id); },
    snapshot() { throw Error("snapshot is not an incremental API"); } };
  const { h, mount } = harness();
  const unchanged = snapshotMain(h);
  const nodesRef = h.context.state.nodes;
  const projectorRef = h.context.projectMainPrimarySelection;
  const presenter = present(h, mount, targetedKnowledge);
  assert.equal(mount.childNodes.length, 0, "dormant factory does not mount until refresh");
  assert.equal(presenter.refresh("root").childrenState, "unresolved");
  assert.equal(rootStatus(mount).getAttribute("data-children-state"), "unresolved");
  assert.deepEqual(ids(mount), []);
  const rootRead = knowledge.requestChildren("root");
  assert.equal(presenter.refresh("root").childrenState, "pending");
  assert.equal(rootStatus(mount).getAttribute("data-children-state"), "pending");
  assert.deepEqual(ids(mount), []);
  assert.equal((await rootRead).ok, true);
  const rootPaint = presenter.refresh("root");
  assert.equal(rootPaint.childrenState, "ready");
  assert.equal(rootPaint.scope, "incomplete");
  assert.equal(rootPaint.acceptedSealRef, f.sealRef);
  assert.equal(mount.getAttribute("data-pocket-scope"), "incomplete");
  assert.equal(mount.getAttribute("data-accepted-seal-ref"), f.sealRef);
  assert.deepEqual(ids(mount), ["visible", "unrelated"]);
  const visible = entry(mount, "visible"), unrelated = entry(mount, "unrelated");
  assert.equal(childStatus(visible).getAttribute("data-children-state"), "unresolved");
  assert.deepEqual(ids(childGroup(visible)), []);
  assert.deepEqual(ids(childGroup(unrelated)), []);
  const childrenRead = knowledge.requestChildren("visible");
  assert.equal(presenter.refresh("visible").childrenState, "pending");
  assert.equal((await childrenRead).ok, true);
  const childPaint = presenter.refresh("visible");
  assert.equal(childPaint.childrenState, "ready");
  assert.deepEqual(ids(childGroup(visible)), ["visible-first", "visible-second"]);
  assert.strictEqual(entry(mount, "visible"), visible);
  assert.strictEqual(entry(mount, "unrelated"), unrelated);
  assert.equal(childStatus(entry(childGroup(visible), "visible-first")).getAttribute("data-children-state"), "unresolved");
  assert.equal(fullCalls, 0);
  assert.strictEqual(h.context.state.nodes, nodesRef);
  assert.strictEqual(h.context.projectMainPrimarySelection, projectorRef);
  assert.equal(snapshotMain(h), unchanged);
});

test("P373 ready-empty, failed reads and incompatible or malformed reached descriptions never invent rows", async () => {
  const { h, mount } = harness();
  let attempt = 0;
  const model = injected(h.context, async (parent) => {
    if (parent === "root") return ok(parent, [node("A", "root", 0), node("B", "root", 1)]);
    if (parent === "A") {
      attempt += 1;
      return attempt === 1 ? { ok: false, reason: "logical-resolution-failed" } : ok(parent, []);
    }
    return ok(parent, [node("B-one", "B", 0)]);
  });
  const presenter = present(h, mount, model);
  await model.requestChildren("root");
  assert.equal(presenter.refresh("root").ok, true);
  const a = entry(mount, "A"), b = entry(mount, "B");
  assert.equal(childStatus(a).getAttribute("data-children-state"), "unresolved");
  assert.equal(childStatus(a).textContent, "Children not loaded");
  assert.equal((await model.requestChildren("A")).ok, false);
  assert.equal(presenter.refresh("A").childrenState, "failed");
  assert.match(childStatus(a).textContent, /logical-resolution-failed/);
  assert.deepEqual(ids(childGroup(a)), []);
  assert.strictEqual(entry(mount, "B"), b);
  assert.equal((await model.requestChildren("A", { retry: true })).ok, true);
  assert.equal(presenter.refresh("A").childrenState, "ready");
  assert.equal(childStatus(a).getAttribute("data-children-state"), "ready");
  assert.equal(childStatus(a).textContent, "No children (validated)");
  assert.deepEqual(ids(childGroup(a)), []);
  assert.strictEqual(entry(mount, "B"), b);

  await model.requestChildren("B");
  const incompatible = {
    inspect(id) {
      const value = model.inspect(id);
      return id === "B-one" ? { ...value, acceptedSealRef: "wrong-seal" } : value;
    },
  };
  const separateMount = h.document.createElement("ul");
  separateMount.ownerDocument = h.document;
  const damaged = present(h, separateMount, incompatible);
  assert.equal(damaged.refresh("root").ok, true);
  const priorB = entry(separateMount, "B");
  const before = priorB.childNodes.slice();
  const invalid = damaged.refresh("B");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, "incompatible-knowledge");
  assert.deepEqual(ids(childGroup(priorB)), []);
  assert.strictEqual(entry(separateMount, "B"), priorB);
  assert.strictEqual(priorB.childNodes[0], before[0]);
  assert.strictEqual(entry(separateMount, "A").childNodes[0].getAttribute("data-node-id"), "A");
});

test("P373 invalidation and disposal reject late projection; old instance cannot touch a replacement using the same mount", async () => {
  const { h, mount } = harness();
  let settle;
  const waiting = new Promise(resolve => { settle = resolve; });
  const old = injected(h.context, () => waiting, "seal-old");
  let alive = true;
  const oldPresenter = present(h, mount, old, () => alive);
  assert.equal(oldPresenter.refresh("root").ok, true);
  const pending = old.requestChildren("root");
  assert.equal(oldPresenter.refresh("root").childrenState, "pending");
  alive = false;
  settle(ok("root", [node("old-node", "root", 0)]));
  await pending;
  const stateBefore = rootStatus(mount);
  assert.equal(oldPresenter.refresh("root").reason, "stale-session");
  assert.strictEqual(rootStatus(mount), stateBefore);

  const newer = injected(h.context, async () => ok("root", [node("new-node", "root", 0)]), "seal-new");
  await newer.requestChildren("root");
  const current = present(h, mount, newer, () => true);
  assert.equal(current.refresh("root").ok, true);
  assert.deepEqual(ids(mount), ["new-node"]);
  const replacement = entry(mount, "new-node");
  const checks = instrumentation(h);
  checks.begin();
  assert.equal(oldPresenter.refresh("root").reason, "stale-session");
  assert.equal(oldPresenter.dispose(), true);
  assert.equal(oldPresenter.refresh("root").reason, "stale-session");
  assert.equal(oldPresenter.dispose(), false);
  const counts = checks.end();
  assert.deepEqual(counts, { create: 0, append: 0, remove: 0,
    attributes: 0, text: 0, queries: 0, focus: 0, fullRender: 0 });
  assert.strictEqual(entry(mount, "new-node"), replacement);
  assert.equal(mount.getAttribute("data-accepted-seal-ref"), "seal-new");
  assert.equal(current.refresh("root").changed, false);
});

test("P373 target-group refresh is bounded with 100/500/2000 unrelated reached nodes and preserves focus, scroll, DOM identity", async () => {
  const rows = [];
  for (const count of [100, 500, 2000]) {
    const { h, mount } = harness();
    const peers = Array.from({ length: count }, (_, i) => node("Unrelated-" + i, "root", i + 1));
    const model = injected(h.context, async (parent) => parent === "root"
      ? ok("root", [node("Target", "root", 0), ...peers])
      : ok(parent, [node("Target-one", "Target", 0), node("Target-two", "Target", 1)]));
    const inspected = { count: 0 };
    const onlyTargeted = {
      inspect(id) { inspected.count += 1; return model.inspect(id); },
      snapshot() { throw Error("snapshot is forbidden during locality projection"); },
    };
    const presenter = present(h, mount, onlyTargeted);
    await model.requestChildren("root");
    assert.equal(presenter.refresh("root").ok, true);
    assert.equal(ids(mount).length, count + 1);
    const target = entry(mount, "Target");
    const otherFirst = entry(mount, "Unrelated-0");
    const otherLast = entry(mount, "Unrelated-" + (count - 1));
    const focused = row(otherLast);
    focused.focus();
    mount.scrollTop = 61;
    const measurement = instrumentation(h);
    const request = model.requestChildren("Target");
    await request;
    inspected.count = 0;
    measurement.begin();
    const outcome = presenter.refresh("Target");
    const metrics = measurement.end();
    assert.equal(outcome.ok, true);
    assert.deepEqual(ids(childGroup(target)), ["Target-one", "Target-two"]);
    assert.strictEqual(entry(mount, "Target"), target);
    assert.strictEqual(entry(mount, "Unrelated-0"), otherFirst);
    assert.strictEqual(entry(mount, "Unrelated-" + (count - 1)), otherLast);
    assert.strictEqual(h.document.activeElement, focused);
    assert.equal(mount.scrollTop, 61);
    assert.equal(inspected.count, 3);
    assert.equal(metrics.queries, 0);
    assert.equal(metrics.fullRender, 0);
    assert.equal(metrics.focus, 0);
    assert.equal(metrics.remove, 0);
    assert.equal(metrics.create, 10);
    rows.push({ count, inspect: inspected.count, ...metrics,
      firstSame: entry(mount, "Unrelated-0") === otherFirst,
      lastSame: entry(mount, "Unrelated-" + (count - 1)) === otherLast,
      focusSame: h.document.activeElement === focused, scrollTop: mount.scrollTop });
  }
  for (const row of rows.slice(1)) {
    for (const metric of ["inspect", "create", "append", "remove",
      "attributes", "text", "queries", "focus", "fullRender"]) {
      assert.equal(row[metric], rows[0][metric], metric + " must not scale with unrelated branches");
    }
  }
  console.log("P373_INCREMENTAL_PRESENTATION_MEASUREMENTS " + JSON.stringify(rows));
});

test("P373 authority fence: actual present/refresh never touch Main truth, commands, Save or real production wiring", async () => {
  const { h, mount } = harness();
  const state = h.context.state;
  const unchanged = snapshotMain(h);
  const truth = state.nodes, commands = h.context.moveNodeWithinSiblings;
  const mainRender = h.context.renderTree;
  let reads = 0;
  const model = injected(h.context, async () => { reads += 1; return ok("root", [node("read-only", "root", 0)]); });
  const p = present(h, mount, model);
  assert.equal(reads, 0);
  assert.equal(mount.childNodes.length, 0);
  assert.equal(p.refresh("root").childrenState, "unresolved");
  assert.equal(reads, 0, "passive projection must not request reads");
  await model.requestChildren("root");
  assert.equal(reads, 1);
  assert.equal(p.refresh("root").ok, true);
  const projected = entry(mount, "read-only");
  assert.equal(row(projected).getAttribute("aria-disabled"), "true");
  assert.equal(row(projected).tabIndex, -1);
  assert.equal(row(projected).listeners.size, 0, "no row editing, copying, context menu or command handlers");
  assert.strictEqual(state.nodes, truth);
  assert.equal(snapshotMain(h), unchanged);
  assert.strictEqual(h.context.moveNodeWithinSiblings, commands);
  assert.strictEqual(h.context.renderTree, mainRender);
  assert.equal(h.counters.fullRender, 0);
  for (const pathName of [
    "index.html",
    "js/pocket-sync-browser-runtime.js",
    "js/pocket-sync-additional-device.js",
    "sync-service/pocket-sync-production-server.js",
  ]) {
    assert.doesNotMatch(source(pathName), /createProgressiveMainPresentation\s*\(/);
  }
  const renderer = source("js/pocket-render.js");
  assert.equal((renderer.match(/function createProgressiveMainPresentation\(/g) || []).length, 1);
  assert.doesNotMatch(renderer.slice(renderer.indexOf("// P373 dormant")), /\b(?:state\.nodes\s*=|buildPocketPayload\s*\(|snapshot\s*\(|requestChildren\s*\(|renderTree\s*\(|saveCurrentContext\s*\()/);
  assert.equal(p.dispose(), true);
});
