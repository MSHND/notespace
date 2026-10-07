"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const ROOT = path.resolve(__dirname, "..");
const P190 = path.join(__dirname, "p190-starling-save-observability-and-reentry.test.js");
const OWNER = path.join(ROOT, "js/pocket-starling-owner-successor.js");
const TIMEOUT = 30000;
const CAS = "/pockets/head/compare-and-set";
const GET = "/pockets/objects/get";
const PUT = "/pockets/objects/put";
const PRESENCE = "/pockets/objects/presence";

const plain = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function loadP190Helpers() {
  let code = fs.readFileSync(P190, "utf8");
  const declaration = 'const test = require("node:test");';
  assert.ok(code.includes(declaration), "P190 harness test declaration changed");
  code = code.replace(declaration, "const test = () => {};");
  code += "\nmodule.exports = { readyPostReentry };\n";
  const localRequire = createRequire(P190);
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", "__filename", "__dirname", code)(
    localRequire, moduleRecord, moduleRecord.exports, P190, __dirname
  );
  return moduleRecord.exports;
}

async function dirtySteadySave() {
  const { readyPostReentry } = loadP190Helpers();
  const { h, helpers } = await readyPostReentry();
  h.context.moveNodeWithinSiblings("beta", 1);
  assert.deepEqual(helpers.rootOrder(h.context), ["Alpha", "Beta", "Restore Me"]);
  assert.equal(h.context.__p180State.ops.length, 1);
  return { h, helpers };
}

function observeMaterialize(h) {
  const base = h.context.PocketStarlingMaterializeShadow;
  let calls = 0;
  h.context.PocketStarlingMaterializeShadow = Object.freeze({
    ...base,
    async materializeAccepted(...args) {
      calls += 1;
      return base.materializeAccepted(...args);
    },
  });
  return () => calls;
}

function saveRequestDelta(h, start) {
  return h.requests.slice(start).map((entry) => ({
    url: entry.url,
    method: entry.method,
    status: entry.status,
  }));
}

function count(entries, suffix) {
  return entries.filter((entry) => entry.url.endsWith(suffix)).length;
}

function postCas(entries) {
  const index = entries.findIndex((entry) => entry.url.endsWith(CAS));
  assert.ok(index >= 0, "authoritative CAS must occur");
  return entries.slice(index + 1);
}

function installAmbiguousAfterAppliedCas(h) {
  const base = h.context.PocketStarlingDurablePublication;
  let thrown = false;
  h.context.PocketStarlingDurablePublication = Object.freeze({
    ...base,
    createCoordinator(...args) {
      const coordinator = base.createCoordinator(...args);
      return Object.freeze({
        ...coordinator,
        async attemptHead(...headArgs) {
          const result = await coordinator.attemptHead(...headArgs);
          if (!thrown && result?.outcome === "committed") {
            thrown = true;
            throw new Error("P346y simulated lost response after committed CAS");
          }
          return result;
        },
      });
    },
  });
}

function installPostCasHeadMismatch(h, casBefore) {
  const base = h.context.PocketStarlingRemoteOpenShadow;
  h.context.PocketStarlingRemoteOpenShadow = Object.freeze({
    ...base,
    createRemoteOpener(...args) {
      const opener = base.createRemoteOpener(...args);
      return Object.freeze({
        ...opener,
        async openRemote(...openArgs) {
          const opened = await opener.openRemote(...openArgs);
          if (h.routeCount(CAS) > casBefore && opened?.outcome === "opened") {
            return Object.freeze({
              ...opened,
              head: Object.freeze({ ...opened.head, revision: opened.head.revision + 1 }),
            });
          }
          return opened;
        },
      });
    },
  });
}

function installPostCasMissingObject(h, casBefore, missingGetIndex) {
  const base = h.context.PocketStarlingRemoteOpenShadow;
  h.context.PocketStarlingRemoteOpenShadow = Object.freeze({
    ...base,
    createRemoteOpener(options) {
      let postCasGets = 0;
      const service = options.objectHeadService;
      const wrappedService = Object.freeze({
        ...service,
        async getOpaqueObject(input) {
          const result = await service.getOpaqueObject(input);
          if (h.routeCount(CAS) > casBefore) {
            postCasGets += 1;
            if (postCasGets === missingGetIndex) {
              return Object.freeze({
                ...result,
                present: false,
                record: null,
              });
            }
          }
          return result;
        },
      });
      return base.createRemoteOpener({ ...options, objectHeadService: wrappedService });
    },
  });
}

function installPostCasSemanticFailure(h, casBefore) {
  const base = h.context.PocketStarlingSemanticAuthorityShadow;
  h.context.PocketStarlingSemanticAuthorityShadow = Object.freeze({
    ...base,
    async authenticate(input) {
      if (h.routeCount(CAS) > casBefore) {
        return Object.freeze({ ok: false, reason: "semantic-validity-invalid" });
      }
      return base.authenticate(input);
    },
  });
}

async function saveFromMain(h) {
  return h.context.exportTree({ returnDetails: true, downloadFallback: false });
}

test("P346y direct COMMITTED Save accepts through bounded fresh proof with no second materialisation or post-CAS mutation", { timeout: TIMEOUT }, async () => {
  const { h } = await dirtySteadySave();
  const materializeCalls = observeMaterialize(h);
  const start = h.requests.length;
  const casBefore = h.routeCount(CAS);
  const saved = await saveFromMain(h);
  const requests = saveRequestDelta(h, start);
  const afterCas = postCas(requests);

  assert.equal(saved.ok, true, JSON.stringify({ saved, requests }));
  assert.equal(materializeCalls(), 0, "steady P172 acceptance must not call post-CAS materializeAccepted");
  assert.equal(h.routeCount(CAS), casBefore + 1);
  assert.equal(count(afterCas, CAS), 0, "no second CAS may occur after committed Head");
  assert.equal(count(afterCas, PUT), 0, "post-CAS proof must not publish objects");
  assert.equal(count(afterCas, PRESENCE), 0, "post-CAS proof must not add a third presence pass");
  assert.equal(count(afterCas, GET), 2, "fresh committed proof is bounded to candidate Seal + Root GETs");

  const local = h.context.PocketOwnerSaveBoundary.captureOwnerSaveSession()
    .controller.getStarlingBootstrapState();
  assert.equal(local?.head?.revision, 3);
  assert.equal(h.context.__p180State.ops.length, 0);

  const diagnostic = h.context.PocketStarlingSaveDiagnostic.getLatest();
  assert.equal(diagnostic.outcome, "accepted");
  assert.notEqual(diagnostic.detailElapsedMs.proofOpened, null);
  assert.equal(diagnostic.detailElapsedMs.proofMaterialized, null);
  assert.notEqual(diagnostic.detailElapsedMs.proofVerified, null);
  assert.ok(diagnostic.detailElapsedMs.proofVerified >= diagnostic.detailElapsedMs.proofOpened);
});

test("P346y ambiguous applied CAS reconciles COMMITTED into the same bounded verifier without retry CAS", { timeout: TIMEOUT }, async () => {
  const { h } = await dirtySteadySave();
  const materializeCalls = observeMaterialize(h);
  installAmbiguousAfterAppliedCas(h);
  const start = h.requests.length;
  const casBefore = h.routeCount(CAS);
  const saved = await saveFromMain(h);
  const requests = saveRequestDelta(h, start);

  assert.equal(saved.ok, true, JSON.stringify({ saved, requests }));
  assert.equal(h.routeCount(CAS), casBefore + 1, "reconcile must not retry CAS");
  assert.equal(count(requests, CAS), 1);
  assert.equal(materializeCalls(), 0);
  assert.ok(count(postCas(requests), GET) >= 3,
    "reconcile lineage plus fresh Seal/Root proof may read objects but must stay bounded");
  assert.equal(count(postCas(requests), PUT), 0);
  assert.equal(count(postCas(requests), PRESENCE), 0);
});

test("P346y bounded verifier requires exact Head, descriptor and semantic fingerprint continuity", () => {
  let code = fs.readFileSync(OWNER, "utf8");
  const tail = "})(typeof window !== \"undefined\" ? window : globalThis);";
  assert.ok(code.includes(tail), "owner-successor IIFE tail changed");
  code = code.replace(tail, "global.__p346yBounded = proveBoundedCommittedCandidate;\n" + tail);
  const context = {
    Object, Array, String, Number, Boolean, JSON, Math, Date, Promise, Error, TypeError,
    Set, Map, WeakMap, WeakSet, Uint8Array, TextEncoder,
    PocketSyncOwnerController: Object.freeze({ createSyncedOwnerController() { return {}; } }),
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(code, context, { filename: OWNER });
  const prove = context.__p346yBounded;
  assert.equal(typeof prove, "function");

  const expected = Object.freeze({ schema: "pocket.starling.head.v1", revision: 7, sealRef: "old" });
  const candidate = Object.freeze({ schema: "pocket.starling.head.v1", revision: 8, sealRef: "new" });
  const fingerprint = "sha256:" + "A".repeat(43);
  const opened = Object.freeze({
    outcome: "opened",
    head: candidate,
    session: Object.freeze({ semanticBaseProof: Object.freeze({}) }),
  });
  const witness = Object.freeze({
    expectedHead: expected,
    targetFingerprint: fingerprint,
    descriptor: Object.freeze({
      expectedHead: expected,
      candidateSealStorageRef: "new",
      semanticFingerprint: fingerprint,
    }),
  });

  assert.equal(prove(opened, candidate, witness), true);
  assert.equal(prove({ ...opened, outcome: "empty" }, candidate, witness), false);
  assert.equal(prove({ ...opened, session: {} }, candidate, witness), false);
  assert.equal(prove({ ...opened, head: { ...candidate, revision: 9 } }, candidate, witness), false);
  assert.equal(prove(opened, { ...candidate, revision: 9 }, witness), false);
  assert.equal(prove(opened, candidate, {
    ...witness, descriptor: { ...witness.descriptor, expectedHead: { ...expected, revision: 6 } },
  }), false);
  assert.equal(prove(opened, candidate, {
    ...witness, descriptor: { ...witness.descriptor, candidateSealStorageRef: "other" },
  }), false);
  assert.equal(prove(opened, candidate, {
    ...witness, descriptor: { ...witness.descriptor, semanticFingerprint: "invalid" },
  }), false);
  assert.equal(prove(opened, candidate, {
    ...witness, targetFingerprint: "sha256:" + "B".repeat(43),
  }), false);
});

test("P346y fresh committed Head mismatch fails closed after CAS and keeps prior local acceptance", { timeout: TIMEOUT }, async () => {
  const { h } = await dirtySteadySave();
  const materializeCalls = observeMaterialize(h);
  const casBefore = h.routeCount(CAS);
  installPostCasHeadMismatch(h, casBefore);
  const saved = await saveFromMain(h);

  assert.equal(saved.ok, false, JSON.stringify(saved));
  assert.equal(saved.reason, "starling-save-unsettled");
  assert.equal(h.routeCount(CAS), casBefore + 1, "remote Head may be committed but local proof must fail closed");
  assert.equal(materializeCalls(), 0);
  const local = h.context.PocketOwnerSaveBoundary.captureOwnerSaveSession()
    .controller.getStarlingBootstrapState();
  assert.equal(local?.head?.revision, 2, "failed bounded proof must not persist clean H3 locally");
  assert.equal(h.context.__p180State.ops.length, 1);
});

for (const [label, missingGetIndex] of [["candidate Seal", 1], ["candidate Root", 2]]) {
  test(`P346y missing committed ${label} fails closed without whole-document fallback`, { timeout: TIMEOUT }, async () => {
    const { h } = await dirtySteadySave();
    const materializeCalls = observeMaterialize(h);
    const casBefore = h.routeCount(CAS);
    installPostCasMissingObject(h, casBefore, missingGetIndex);
    const saved = await saveFromMain(h);

    assert.equal(saved.ok, false, JSON.stringify(saved));
    assert.equal(saved.reason, "starling-save-unsettled");
    assert.equal(h.routeCount(CAS), casBefore + 1);
    assert.equal(materializeCalls(), 0);
    assert.equal(h.context.__p180State.ops.length, 1);
  });
}

test("P346y invalid fresh semantic-validity authentication fails closed after committed Head", { timeout: TIMEOUT }, async () => {
  const { h } = await dirtySteadySave();
  const materializeCalls = observeMaterialize(h);
  const casBefore = h.routeCount(CAS);
  installPostCasSemanticFailure(h, casBefore);
  const saved = await saveFromMain(h);

  assert.equal(saved.ok, false, JSON.stringify(saved));
  assert.equal(saved.reason, "starling-save-unsettled");
  assert.equal(h.routeCount(CAS), casBefore + 1);
  assert.equal(materializeCalls(), 0);
  assert.equal(h.context.__p180State.ops.length, 1);
});

test("P346y preserves legacy full-proof fallback and reentry full reconstruction in source", () => {
  const owner = fs.readFileSync(OWNER, "utf8");
  assert.match(owner,
    /const proved = hasSemanticFingerprint\s*\? proveBoundedCommittedCandidate\(opened, candidateHead, witness\)\s*:\s*await proveOpened\(/,
    "descriptor without P172 semanticFingerprint must retain proveOpened fallback");
  const start = owner.indexOf("async function rebuildStarlingReentry");
  const end = owner.indexOf("\n    async function adoptSyncedOwner", start);
  assert.ok(start >= 0 && end > start, "rebuildStarlingReentry boundary must remain");
  const reentry = owner.slice(start, end);
  assert.match(reentry, /PocketStarlingMaterializeShadow/);
  assert.match(reentry, /materializeAccepted\(opened\.session\)/,
    "reentry must retain full reconstruction");
});
