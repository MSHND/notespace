"use strict";

/* P386 DISPOSABLE RESEARCH ONLY.
 * Two separately constructed Pocket browser-runtime contexts use the accepted
 * encrypted Starling Open/Edit/Publication code and one in-memory remote.
 * No production network, account, device credential, service or real Pocket.
 *
 * Reuses the actual accepted P126 production-module test harness rather than
 * creating another fake implementation of encryption, Open, edits or CAS.
 * Its sharing of a copied test key is NOT proof of real device enrolment.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const P126 = path.resolve(__dirname, "../../tests/p126-starling-remote-edit-publication-loop.test.js");

function acceptedHarness() {
  let source = fs.readFileSync(P126, "utf8");
  const marker = 'const test = require("node:test"), assert = require("node:assert/strict"),';
  assert.ok(source.includes(marker), "P126 acceptance harness source changed");
  source = source.replace(marker, 'const test = () => {}, assert = require("node:assert/strict"),');
  source += "\nmodule.exports={setup,openFresh,prepare,publisher,plain};\n";
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", "__filename", "__dirname", source)(
    createRequire(P126), moduleRecord, moduleRecord.exports, P126, path.dirname(P126)
  );
  return moduleRecord.exports;
}

function label(snapshot) { return snapshot.payload?.label; }
function revision(remote) { return remote.head.revision; }
function remotePayloads(remote) { return JSON.stringify([...remote.objects.values()]); }

test("P386 simulated two independent sessions: A Save → B fresh Open/Save → A fresh Open, stale B blocked",
  { timeout: 60000 }, async () => {
    const { setup, openFresh, prepare, publisher } = acceptedHarness();

    // A shared *disposable* encrypted remote, initially 48 ideas.
    const fixture = await setup(48);
    const a = await openFresh(fixture, "p386-device-A-initial");
    const b = await openFresh(fixture, "p386-device-B-initial");
    assert.equal(a.opened.outcome, "opened");
    assert.equal(b.opened.outcome, "opened");
    assert.notEqual(a.reader, b.reader, "separate browser VM contexts");
    assert.equal(revision(fixture.remote), 1);

    const initialA = await a.opened.session.readContent("n20");
    const initialB = await b.opened.session.readContent("n20");
    assert.equal(label(initialA), "Node 20");
    assert.equal(label(initialB), "Node 20");

    // Both devices have independently opened the old revision before A saves.
    // B's stale candidate intentionally edits a DIFFERENT node, but whole-Head
    // CAS must reject it rather than overwrite A's already accepted change.
    const oldB = await prepare(b.reader, b.opened, b.key, b.semanticAuthority,
      "n21", { label: "Unsaved stale B draft", value: 21 });
    assert.equal(oldB.outcome, "prepared");

    const aPrepared = await prepare(a.reader, a.opened, a.key, a.semanticAuthority,
      "n20", { label: "Saved by A", value: 1001 });
    assert.equal(aPrepared.outcome, "prepared");
    assert.equal(revision(fixture.remote), 1, "preparing an edit is not Save");
    assert.equal(label(await b.opened.session.readContent("n20")), "Node 20",
      "B does not silently replace its old, already opened view");

    // Explicit A publish is the simulated Save/Sync acceptance boundary.
    const aSaved = await publisher(a.reader, fixture.remote, "p386-A-save").publishCandidate({
      stage: aPrepared.stage, expectedHead: aPrepared.expectedHead
    });
    assert.equal(aSaved.outcome, "committed");
    assert.equal(revision(fixture.remote), 2);

    const attemptedStaleB = await publisher(b.reader, fixture.remote, "p386-B-stale").publishCandidate({
      stage: oldB.stage, expectedHead: oldB.expectedHead
    });
    assert.deepEqual(JSON.parse(JSON.stringify(attemptedStaleB)),
      { outcome: "conflict", reason: "head-conflict" });
    assert.equal(revision(fixture.remote), 2, "stale B cannot roll back A");

    // B deliberately reopens current accepted truth before doing new work.
    const bFresh = await openFresh(fixture, "p386-device-B-reopen");
    assert.equal(bFresh.opened.outcome, "opened");
    assert.equal(bFresh.opened.head.revision, 2);
    assert.deepEqual(JSON.parse(JSON.stringify((await bFresh.opened.session.readContent("n20")).payload)),
      { label: "Saved by A", value: 1001 });
    assert.equal(label(await bFresh.opened.session.readContent("n21")), "Node 21");

    const bPrepared = await prepare(bFresh.reader, bFresh.opened, bFresh.key,
      bFresh.semanticAuthority, "n21", { label: "Saved by B", value: 2002 });
    assert.equal(bPrepared.outcome, "prepared");
    assert.equal(revision(fixture.remote), 2, "B's local edit isn't a remote Save");
    const bSaved = await publisher(bFresh.reader, fixture.remote, "p386-B-save").publishCandidate({
      stage: bPrepared.stage, expectedHead: bPrepared.expectedHead
    });
    assert.equal(bSaved.outcome, "committed");
    assert.equal(revision(fixture.remote), 3);

    // A deliberately reopens after B's Save. Both edits and the unrelated
    // third idea must remain present, with no stale snapshot overwriting them.
    const aFresh = await openFresh(fixture, "p386-device-A-reopen");
    assert.equal(aFresh.opened.outcome, "opened");
    assert.equal(aFresh.opened.head.revision, 3);
    const aOwn = await aFresh.opened.session.readContent("n20");
    const bOwn = await aFresh.opened.session.readContent("n21");
    const unchanged = await aFresh.opened.session.readContent("n22");
    assert.deepEqual(JSON.parse(JSON.stringify(aOwn.payload)),
      { label: "Saved by A", value: 1001 });
    assert.deepEqual(JSON.parse(JSON.stringify(bOwn.payload)),
      { label: "Saved by B", value: 2002 });
    assert.deepEqual(JSON.parse(JSON.stringify(unchanged.payload)),
      { label: "Node 22", value: 22 });

    // Explicit proof that server-side stored objects are opaque, not these
    // cleartext labels. This checks the fixture; it does not certify E2EE.
    assert.equal(remotePayloads(fixture.remote).includes("Saved by A"), false);
    assert.equal(remotePayloads(fixture.remote).includes("Saved by B"), false);

    // Safe summarised evidence, intentionally no keys/tokens/payload objects.
    console.log("P386_SIMULATION_RECEIPT="+JSON.stringify({
      baselineHead: 1, afterASave: 2, afterBSave: 3,
      independentRuntimeContexts: true,
      beforeSaveNoRemoteAdvance: true,
      staleBResult: attemptedStaleB.reason,
      bReopenedAChange: true, aReopenedBothChanges: true,
      unrelatedIdeaPreserved: true, remoteOpaqueFixture: true,
      actualLiveServerTouched: false, actualDeviceEnrolmentProved: false,
      actualPEButtonSaveProvedByThisTest: false
    }));
  }
);
