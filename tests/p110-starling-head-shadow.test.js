"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");

const ROOT = path.resolve(__dirname, ".."),
  MODULE = "js/pocket-starling-head-shadow.js",
  SCRIPTS = [
    "js/pocket-state.js",
    "js/pocket-data.js",
    "js/pocket-outline-persistence-policy.js",
    "js/pocket-editor-metadata.js",
    "js/pocket-pe-import-preserve.js",
    "js/pocket-storage.js",
    "js/pocket-import.js",
    "js/pocket-starling-shadow.js",
    "js/pocket-starling-sequence-shadow.js",
    "js/pocket-starling-placement-shadow.js",
    "js/pocket-starling-bridge-shadow.js",
    "js/pocket-starling-root-shadow.js",
    "js/pocket-starling-object-seal-shadow.js",
    MODULE,
  ];
const plain = (value) => JSON.parse(JSON.stringify(value));

function context() {
  const c = {
    URL,
    Date,
    Math,
    JSON,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Promise,
    console: { log() {}, info() {}, warn() {}, error() {} },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {},
    },
    document: {
      body: { classList: { add() {}, remove() {}, toggle() {} } },
      getElementById() {
        return null;
      },
      addEventListener() {},
    },
    navigator: { clipboard: {} },
    location: { href: "https://example.test" },
    indexedDB: null,
    open() {},
    close() {},
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    requestAnimationFrame() {
      return 1;
    },
    cancelAnimationFrame() {},
  };
  c.window = c;
  c.globalThis = c;
  vm.createContext(c);
  for (const file of SCRIPTS)
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), c, {
      filename: file,
    });
  return c;
}

function normalised(nodes) {
  return {
    schema: "portal.mtt.web.v1",
    writtenAt: "2026-08-29T00:00:00.000Z",
    nodes,
    tombstones: [{ id: "gone" }],
    rootExtras: { rootMarker: true },
    dataExtras: { dataMarker: true },
  };
}

function rootNodes(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `n${index}`,
    parentId: "root",
    order: index * 10,
    label: `Node ${String(index).padStart(4, "0")}`,
    value: index,
  }));
}

function stateFor(c, nodes) {
  const encoded = c.PocketStarlingBridgeShadow.encode(normalised(nodes), {
    capacity: 4,
  });
  assert.equal(encoded.ok, true);
  const built = c.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(built.ok, true);
  return built.state;
}

function stage(c, stager, state, baseStage = null) {
  const result = c.PocketStarlingObjectSealShadow.stageCandidate(
    stager,
    state,
    baseStage
      ? { previousSealRef: baseStage.sealRef, baseStage }
      : { previousSealRef: null },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.stage;
}

function eligibleHarness(c, stager) {
  const eligible = new Set(),
    resolver = (ref) => stager.store.get(ref);
  return {
    eligible,
    resolver,
    register(candidate) {
      const presence = c.PocketStarlingObjectSealShadow.verifyNewObjectPresence(
        candidate,
        (ref) => stager.store.has(ref),
        candidate.sealObject.previousSealRef === null
          ? {}
          : { baseComplete: true },
      );
      assert.equal(presence.ok, true, JSON.stringify(presence));
      const audited = c.PocketStarlingObjectSealShadow.auditCandidateSeal(
        candidate.sealRef,
        resolver,
      );
      assert.equal(audited.ok, true, JSON.stringify(audited));
      eligible.add(candidate.sealRef);
      return candidate;
    },
    authority(initialHead) {
      return c.PocketStarlingHeadShadow.createAuthority({
        initialHead,
        isCandidateEligible: (ref) => eligible.has(ref),
        resolveSeal: resolver,
      });
    },
  };
}

function adopt(authority, expected, candidate) {
  const result = authority.conditionalAdopt(expected, candidate.sealRef);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.head;
}

function reconcile(api, authority, expectedHead, candidate, resolver) {
  return api.reconcileAmbiguous({
    expectedHead,
    candidateSealRef: candidate.sealRef,
    readCurrentHead: authority.readHead,
    resolveSeal: resolver,
  });
}

test("P110 conditionally adopts genesis and a durable successor", () => {
  const c = context(),
    sealApi = c.PocketStarlingObjectSealShadow,
    stager = sealApi.createStager(),
    gate = eligibleHarness(c, stager),
    genesisState = stateFor(c, rootNodes(3)),
    genesis = gate.register(stage(c, stager, genesisState)),
    authority = gate.authority(),
    head0 = authority.readHead(),
    entriesBefore = new Map(stager.store);

  assert.deepEqual(plain(head0), {
    schema: "pocket.starling.head.v1",
    revision: 0,
    sealRef: null,
  });
  assert.equal(Object.isFrozen(head0), true);
  assert.throws(() => {
    head0.revision = 99;
  }, TypeError);
  assert.equal(authority.readHead().revision, 0);

  const head1 = adopt(authority, head0, genesis);
  assert.equal(head1.revision, 1);
  assert.equal(head1.sealRef, genesis.sealRef);
  const changed = c.PocketStarlingRootShadow.editPayload(genesisState, "n1", {
      label: "changed",
      value: 1,
    }),
    successor = gate.register(stage(c, stager, changed.state, genesis));
  assert.equal(changed.ok, true);
  assert.equal(successor.sealObject.previousSealRef, genesis.sealRef);
  const head2 = adopt(authority, head1, successor);
  assert.equal(head2.revision, 2);
  assert.equal(head2.sealRef, successor.sealRef);
  for (const [ref, bytes] of entriesBefore)
    assert.equal(stager.store.get(ref), bytes);
  assert.equal(
    sealApi.auditCandidateSeal(genesis.sealRef, gate.resolver).ok,
    true,
  );
  assert.equal(Object.isFrozen(head2), true);
});

test("P110 rejects ineligible, invalid, stale, mismatched and exhausted adoption", () => {
  const c = context(),
    sealApi = c.PocketStarlingObjectSealShadow,
    stager = sealApi.createStager(),
    gate = eligibleHarness(c, stager),
    state = stateFor(c, rootNodes(2)),
    genesis = stage(c, stager, state),
    authority = gate.authority(),
    before = authority.readHead();

  assert.equal(
    sealApi.auditCandidateSeal(genesis.sealRef, gate.resolver).ok,
    true,
  );
  assert.equal(
    authority.conditionalAdopt(before, genesis.sealRef).reason,
    "candidate-not-eligible",
  );
  assert.strictEqual(authority.readHead(), before);
  gate.eligible.add("proof-ref:v1:candidate-seal:00000000");
  assert.equal(
    authority.conditionalAdopt(before, "proof-ref:v1:candidate-seal:00000000")
      .reason,
    "candidate-invalid",
  );
  assert.strictEqual(authority.readHead(), before);
  const authenticBytes = stager.store.get(genesis.sealRef);
  gate.eligible.add(genesis.sealRef);
  stager.store.set(genesis.sealRef, authenticBytes + " ");
  assert.equal(
    authority.conditionalAdopt(before, genesis.sealRef).reason,
    "candidate-invalid",
  );
  assert.strictEqual(authority.readHead(), before);
  stager.store.set(genesis.sealRef, authenticBytes);
  gate.register(genesis);
  const head1 = adopt(authority, before, genesis);

  assert.equal(
    authority.conditionalAdopt(
      { ...plain(head1), unexpected: true },
      genesis.sealRef,
    ).reason,
    "invalid-expected-head",
  );
  assert.equal(
    authority.conditionalAdopt(before, genesis.sealRef).reason,
    "head-conflict",
  );
  assert.equal(
    authority.conditionalAdopt(head1, genesis.sealRef).reason,
    "candidate-lineage-mismatch",
  );
  assert.strictEqual(authority.readHead(), head1);

  assert.equal(
    c.PocketStarlingHeadShadow.createAuthority({
      initialHead: { schema: "wrong", revision: 0, sealRef: null },
      isCandidateEligible() {
        return true;
      },
      resolveSeal: gate.resolver,
    }).reason,
    "invalid-head",
  );

  const successorState = c.PocketStarlingRootShadow.editPayload(state, "n0", {
      label: "next",
      value: 0,
    }).state,
    successor = gate.register(stage(c, stager, successorState, genesis)),
    exhausted = gate.authority({
      schema: "pocket.starling.head.v1",
      revision: Number.MAX_SAFE_INTEGER,
      sealRef: genesis.sealRef,
    }),
    maxHead = exhausted.readHead();
  assert.equal(
    exhausted.conditionalAdopt(maxHead, successor.sealRef).reason,
    "head-revision-exhausted",
  );
  assert.strictEqual(exhausted.readHead(), maxHead);
});

test("P110 lets only one same-base candidate win while retaining the rival", () => {
  const c = context(),
    sealApi = c.PocketStarlingObjectSealShadow,
    stager = sealApi.createStager(),
    gate = eligibleHarness(c, stager),
    state = stateFor(c, rootNodes(4)),
    genesis = gate.register(stage(c, stager, state)),
    authority = gate.authority(),
    head1 = adopt(authority, authority.readHead(), genesis),
    editA = c.PocketStarlingRootShadow.editPayload(state, "n0", {
      label: "candidate-a",
      value: 0,
    }).state,
    editB = c.PocketStarlingRootShadow.editPayload(state, "n1", {
      label: "candidate-b",
      value: 1,
    }).state,
    candidateA = gate.register(stage(c, stager, editA, genesis)),
    candidateB = gate.register(stage(c, stager, editB, genesis)),
    rivalEntries = candidateB.newRefs.map((ref) => [
      ref,
      stager.store.get(ref),
    ]),
    head2 = adopt(authority, head1, candidateA);

  assert.equal(
    authority.conditionalAdopt(head1, candidateB.sealRef).reason,
    "head-conflict",
  );
  assert.strictEqual(authority.readHead(), head2);
  assert.equal(head2.sealRef, candidateA.sealRef);
  for (const [ref, bytes] of rivalEntries)
    assert.equal(stager.store.get(ref), bytes);
  assert.equal(
    sealApi.auditCandidateSeal(candidateB.sealRef, gate.resolver).ok,
    true,
  );
  assert.equal(
    authority.conditionalAdopt(
      { ...plain(head2), revision: head1.revision },
      candidateB.sealRef,
    ).reason,
    "head-conflict",
  );
  assert.equal(
    authority.conditionalAdopt(
      { ...plain(head2), sealRef: head1.sealRef },
      candidateB.sealRef,
    ).reason,
    "head-conflict",
  );
  assert.strictEqual(authority.readHead(), head2);
});

test("P110 reconciles lost outcomes without mutating or retrying authority", () => {
  const make = () => {
    const c = context(),
      stager = c.PocketStarlingObjectSealShadow.createStager(),
      gate = eligibleHarness(c, stager),
      state = stateFor(c, rootNodes(3)),
      genesis = gate.register(stage(c, stager, state)),
      authority = gate.authority(),
      head1 = adopt(authority, authority.readHead(), genesis),
      candidateState = c.PocketStarlingRootShadow.editPayload(state, "n0", {
        label: "attempted",
        value: 0,
      }).state,
      candidate = gate.register(stage(c, stager, candidateState, genesis));
    return {
      c,
      stager,
      gate,
      state,
      genesis,
      authority,
      head1,
      candidateState,
      candidate,
    };
  };

  const committed = make();
  adopt(committed.authority, committed.head1, committed.candidate);
  const committedHead = committed.authority.readHead();
  assert.deepEqual(
    plain(
      reconcile(
        committed.c.PocketStarlingHeadShadow,
        committed.authority,
        committed.head1,
        committed.candidate,
        committed.gate.resolver,
      ),
    ),
    { outcome: "committed", examined: 1 },
  );
  assert.strictEqual(committed.authority.readHead(), committedHead);

  const notCommitted = make(),
    beforeRead = notCommitted.authority.readHead();
  assert.equal(
    reconcile(
      notCommitted.c.PocketStarlingHeadShadow,
      notCommitted.authority,
      notCommitted.head1,
      notCommitted.candidate,
      notCommitted.gate.resolver,
    ).outcome,
    "not-committed",
  );
  assert.strictEqual(notCommitted.authority.readHead(), beforeRead);

  const superseded = make(),
    candidateHead = adopt(
      superseded.authority,
      superseded.head1,
      superseded.candidate,
    ),
    laterState = superseded.c.PocketStarlingRootShadow.editPayload(
      superseded.candidateState,
      "n1",
      { label: "later", value: 1 },
    ).state,
    later = superseded.gate.register(
      stage(superseded.c, superseded.stager, laterState, superseded.candidate),
    );
  adopt(superseded.authority, candidateHead, later);
  const supersededHead = superseded.authority.readHead(),
    supersededResult = reconcile(
      superseded.c.PocketStarlingHeadShadow,
      superseded.authority,
      superseded.head1,
      superseded.candidate,
      superseded.gate.resolver,
    );
  assert.deepEqual(plain(supersededResult), {
    outcome: "committed-and-superseded",
    examined: 2,
  });
  assert.strictEqual(superseded.authority.readHead(), supersededHead);

  const conflict = make(),
    rivalState = conflict.c.PocketStarlingRootShadow.editPayload(
      conflict.state,
      "n1",
      { label: "rival", value: 1 },
    ).state,
    rival = conflict.gate.register(
      stage(conflict.c, conflict.stager, rivalState, conflict.genesis),
    );
  adopt(conflict.authority, conflict.head1, rival);
  assert.equal(
    reconcile(
      conflict.c.PocketStarlingHeadShadow,
      conflict.authority,
      conflict.head1,
      conflict.candidate,
      conflict.gate.resolver,
    ).outcome,
    "conflict",
  );
  assert.equal(
    conflict.c.PocketStarlingObjectSealShadow.auditCandidateSeal(
      conflict.candidate.sealRef,
      conflict.gate.resolver,
    ).ok,
    true,
  );
});

test("P110 returns unknown for broken or impossible reconciliation lineage", () => {
  const c = context(),
    stager = c.PocketStarlingObjectSealShadow.createStager(),
    gate = eligibleHarness(c, stager),
    state = stateFor(c, rootNodes(3)),
    genesis = gate.register(stage(c, stager, state)),
    authority = gate.authority(),
    head1 = adopt(authority, authority.readHead(), genesis),
    nextState = c.PocketStarlingRootShadow.editPayload(state, "n0", {
      label: "attempted",
      value: 0,
    }).state,
    candidate = gate.register(stage(c, stager, nextState, genesis)),
    head2 = adopt(authority, head1, candidate),
    laterState = c.PocketStarlingRootShadow.editPayload(nextState, "n1", {
      label: "later",
      value: 1,
    }).state,
    later = gate.register(stage(c, stager, laterState, candidate));
  adopt(authority, head2, later);
  const acceptedHead = authority.readHead();
  stager.store.delete(candidate.sealRef);
  let reads = 0;
  const broken = c.PocketStarlingHeadShadow.reconcileAmbiguous({
    expectedHead: head1,
    candidateSealRef: candidate.sealRef,
    readCurrentHead() {
      reads += 1;
      return authority.readHead();
    },
    resolveSeal: gate.resolver,
  });
  assert.equal(broken.outcome, "unknown");
  assert.equal(reads, 1);
  assert.strictEqual(authority.readHead(), acceptedHead);

  for (const impossible of [
    { ...plain(head1), sealRef: later.sealRef },
    { ...plain(head1), revision: 0, sealRef: null },
  ])
    assert.equal(
      c.PocketStarlingHeadShadow.reconcileAmbiguous({
        expectedHead: head1,
        candidateSealRef: candidate.sealRef,
        readCurrentHead: () => impossible,
        resolveSeal: gate.resolver,
      }).outcome,
      "unknown",
    );
});

test("P110 treats same-root Seals as distinct lineage events without ABA", () => {
  const c = context(),
    stager = c.PocketStarlingObjectSealShadow.createStager(),
    gate = eligibleHarness(c, stager),
    state = stateFor(c, rootNodes(2)),
    genesis = gate.register(stage(c, stager, state)),
    authority = gate.authority(),
    head0 = authority.readHead(),
    head1 = adopt(authority, head0, genesis),
    sameRootSuccessor = gate.register(stage(c, stager, state, genesis));
  assert.equal(sameRootSuccessor.rootRef, genesis.rootRef);
  assert.notEqual(sameRootSuccessor.sealRef, genesis.sealRef);
  assert.equal(
    authority.conditionalAdopt(head1, genesis.sealRef).reason,
    "candidate-lineage-mismatch",
  );
  const head2 = adopt(authority, head1, sameRootSuccessor);
  assert.deepEqual([head0.revision, head1.revision, head2.revision], [0, 1, 2]);
  assert.notDeepEqual(plain(head0), plain(head2));
  assert.equal(
    authority.conditionalAdopt(head0, genesis.sealRef).reason,
    "head-conflict",
  );
  assert.strictEqual(authority.readHead(), head2);
});

test("P110 Head stays fixed-size across small and large Pocket candidates", () => {
  const shapes = [];
  for (const count of [2, 2000]) {
    const c = context(),
      stager = c.PocketStarlingObjectSealShadow.createStager(),
      gate = eligibleHarness(c, stager),
      candidate = gate.register(
        stage(c, stager, stateFor(c, rootNodes(count))),
      ),
      authority = gate.authority(),
      head = adopt(authority, authority.readHead(), candidate);
    shapes.push(Object.keys(head).sort());
    assert.deepEqual(Object.keys(head).sort(), [
      "revision",
      "schema",
      "sealRef",
    ]);
    for (const forbidden of [
      "rootRef",
      "newRefs",
      "baseStage",
      "manifest",
      "operationId",
      "timestamp",
    ])
      assert.equal(Object.hasOwn(head, forbidden), false);
  }
  assert.deepEqual(shapes[0], shapes[1]);
});

test("P110 remains a dormant in-memory proof", () => {
  const source = fs.readFileSync(path.join(ROOT, MODULE), "utf8");
  assert.equal(
    fs.readFileSync(path.join(ROOT, "index.html"), "utf8").includes(MODULE),
    false,
  );
  for (const forbidden of [
    "indexedDB",
    "localStorage",
    "fetch(",
    "XMLHttpRequest",
    "WebSocket",
    "conditionalUpload",
  ])
    assert.equal(source.includes(forbidden), false, forbidden);
});
