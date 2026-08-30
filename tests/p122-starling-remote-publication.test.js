"use strict";

const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { webcrypto } = require("node:crypto"),
  ROOT = path.resolve(__dirname, ".."),
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
    "js/pocket-sync-crypto.js",
    "js/pocket-starling-crypto-shadow.js",
    "js/pocket-starling-storage-shadow.js",
    "js/pocket-starling-head-shadow.js",
    "js/pocket-sync-remote-client.js",
    "js/pocket-starling-publication-shadow.js",
  ];

const HEAD_SCHEMA = "pocket.starling.head.v1",
  context = () => {
    const c = {
      crypto: webcrypto,
      TextEncoder,
      TextDecoder,
      Uint8Array,
      ArrayBuffer,
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
      Error,
      btoa: (value) => Buffer.from(value, "binary").toString("base64"),
      atob: (value) => Buffer.from(value, "base64").toString("binary"),
      localStorage: { getItem() {}, setItem() {}, removeItem() {} },
      document: {
        body: { classList: { add() {}, remove() {}, toggle() {} } },
        getElementById() {},
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
  },
  plain = (value) => JSON.parse(JSON.stringify(value)),
  genesis = () => ({ schema: HEAD_SCHEMA, revision: 0, sealRef: null }),
  storageContext = () => ({ syncedPocketId: "p122" });

function stateFor(c, count = 8, capacity = 4) {
  const encoded = c.PocketStarlingBridgeShadow.encode(
      {
        schema: "portal.mtt.web.v1",
        writtenAt: "2026-08-30T00:00:00.000Z",
        nodes: Array.from({ length: count }, (_, index) => ({
          id: `n${index}`,
          parentId: "root",
          order: index,
          label: `Node ${index}`,
          value: index,
        })),
        tombstones: [],
        rootExtras: {},
        dataExtras: {},
      },
      { capacity },
    ),
    built = c.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(encoded.ok, true);
  assert.equal(built.ok, true);
  return built.state;
}

function logicalStage(c, stager, state, base = null) {
  const result = c.PocketStarlingObjectSealShadow.stageCandidate(
    stager,
    state,
    base
      ? { previousSealRef: base.sealRef, baseStage: base }
      : { previousSealRef: null },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.stage;
}

function logicalConfirm(c, stager, stage) {
  const result = c.PocketStarlingObjectSealShadow.verifyNewObjectPresence(
    stage,
    (ref) => stager.store.has(ref),
    stage.sealObject.previousSealRef === null ? {} : { baseComplete: true },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
}

async function keyFor(c) {
  const wrappingKey = await c.PocketSyncCrypto.generateDeviceWrappingKey(),
    bundle = await c.PocketSyncCrypto.createMasterKeyBundle([
      {
        context: {
          syncedPocketId: "p122",
          envelopeId: "device-envelope",
          envelopeKind: "device",
          envelopeVersion: 1,
        },
        wrappingKey,
      },
    ]);
  return bundle.masterKey;
}

async function physicalStage(c, stager, logical, key, baseStage = null) {
  return c.PocketStarlingStorageShadow.stageCandidate({
    sealRef: logical.sealRef,
    resolveLogical: (ref) => stager.store.get(ref),
    masterKey: key,
    context: storageContext(),
    ...(baseStage ? { baseStage } : {}),
  });
}

async function initialStage(c, count = 8, capacity = 4) {
  const state = stateFor(c, count, capacity),
    stager = c.PocketStarlingObjectSealShadow.createStager(),
    logical = logicalStage(c, stager, state),
    key = await keyFor(c),
    physical = await physicalStage(c, stager, logical, key);
  logicalConfirm(c, stager, logical);
  return { state, stager, logical, key, physical };
}

async function successor(c, base, label = "successor") {
  const edited = c.PocketStarlingRootShadow.editPayload(base.state, "n3", {
      label,
      value: label.length,
    }),
    logical = logicalStage(c, base.stager, edited.state, base.logical),
    physical = await physicalStage(c, base.stager, logical, base.key, base.physical);
  assert.equal(edited.ok, true);
  logicalConfirm(c, base.stager, logical);
  return { ...base, state: edited.state, logical, physical };
}

function operationIds(kind, index) {
  return `${kind}-${index}`;
}

function fakeService(calls, behaviour = {}) {
  return {
    async putOpaqueObject(input) {
      calls.push(["put", plain(input)]);
      if (behaviour.put) return behaviour.put(input, calls.length);
      return { created: true };
    },
    async objectPresence(input) {
      calls.push(["presence", plain(input)]);
      if (behaviour.presence) return behaviour.presence(input, calls.length);
      return {
        rows: input.storageRefs.map((storageRef) => ({ storageRef, present: true })),
      };
    },
    async compareAndSetShadowHead(input) {
      calls.push(["cas", plain(input)]);
      if (behaviour.cas) return behaviour.cas(input, calls.length);
      return {
        ok: true,
        head: {
          schema: HEAD_SCHEMA,
          revision: input.expectedHead.revision + 1,
          sealRef: input.candidateSealStorageRef,
        },
      };
    },
  };
}

function publisher(c, calls, behaviour = {}, operationIdFactory = operationIds) {
  return c.PocketStarlingPublicationShadow.createPublisher({
    objectHeadService: fakeService(calls, behaviour),
    operationIdFactory,
  });
}

async function expectIncomplete(c, base) {
  await assert.rejects(
    physicalStage(c, base.stager, base.logical, base.key, base.physical),
    (error) => error && error.code === "base-stage-incomplete",
  );
}

test("P122 publishes a genuine initial stage in put, presence, CAS order and completes it only on success", async () => {
  const c = context(),
    base = await initialStage(c),
    calls = [],
    result = await publisher(c, calls).publishCandidate({
      stage: base.physical,
      expectedHead: genesis(),
    });
  assert.deepEqual(plain(result), {
    outcome: "committed",
    head: {
      schema: HEAD_SCHEMA,
      revision: 1,
      sealRef: base.physical.sealStorageRef,
    },
  });
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(
    calls.slice(0, base.physical.newRecords.length).map(([kind]) => kind),
    Array(base.physical.newRecords.length).fill("put"),
  );
  assert.deepEqual(
    calls.slice(0, base.physical.newRecords.length).map(([, body]) => body),
    base.physical.newRecords.map((entry, index) => ({
      apiVersion: 1,
      operationId: operationIds("put-object", index),
      syncedPocketId: "p122",
      storageRef: entry.storageRef,
      record: plain(entry.record),
    })),
  );
  assert.equal(calls.at(-1)[0], "cas");
  assert.deepEqual(calls.at(-1)[1], {
    apiVersion: 1,
    operationId: operationIds("compare-and-set-head", 0),
    syncedPocketId: "p122",
    expectedHead: genesis(),
    candidateSealStorageRef: base.physical.sealStorageRef,
  });
  assert.equal(calls.some(([kind]) => ["read", "init", "get"].includes(kind)), false);
  const next = await successor(c, base);
  assert.ok(next.physical.newRecords.length > 0);
});

test("P122 uses physical Head lineage for non-genesis stages and rejects a logical Seal before I/O", async () => {
  const c = context(),
    base = await initialStage(c),
    initialCalls = [];
  await publisher(c, initialCalls).publishCandidate({
    stage: base.physical,
    expectedHead: genesis(),
  });
  const next = await successor(c, base),
    calls = [],
    expected = {
      schema: HEAD_SCHEMA,
      revision: 1,
      sealRef: base.physical.sealStorageRef,
    },
    result = await publisher(c, calls).publishCandidate({
      stage: next.physical,
      expectedHead: expected,
    });
  assert.equal(result.head.sealRef, next.physical.sealStorageRef);
  assert.equal(calls.at(-1)[1].expectedHead.sealRef, base.physical.sealStorageRef);
  const rejectedCalls = [];
  await assert.rejects(
    publisher(c, rejectedCalls).publishCandidate({
      stage: next.physical,
      expectedHead: { schema: HEAD_SCHEMA, revision: 1, sealRef: base.logical.sealRef },
    }),
    (error) => error && error.code === "publication-head-lineage-mismatch",
  );
  assert.equal(rejectedCalls.length, 0);
});

test("P122 preflight rejects lookalikes, bad heads, public disagreement and invalid operation IDs without I/O", async () => {
  const c = context(), base = await initialStage(c);
  for (const input of [
    { stage: { ...base.physical }, expectedHead: genesis() },
    { stage: base.physical, expectedHead: {} },
    {
      stage: base.physical,
      expectedHead: { schema: HEAD_SCHEMA, revision: 1, sealRef: base.physical.sealStorageRef },
    },
    { stage: { ...base.physical, sealStorageRef: "redirected" }, expectedHead: genesis() },
  ]) {
    const calls = [];
    await assert.rejects(
      publisher(c, calls).publishCandidate(input),
      (error) =>
        error &&
        [
          "publication-stage-invalid",
          "publication-head-invalid",
          "publication-head-lineage-mismatch",
        ].includes(error.code),
    );
    assert.equal(calls.length, 0);
  }
  for (const factory of [
    () => " ",
    () => {
      throw new Error("factory failed");
    },
    () => "duplicate",
  ]) {
    const calls = [];
    await assert.rejects(
      publisher(c, calls, {}, factory).publishCandidate({
        stage: base.physical,
        expectedHead: genesis(),
      }),
      (error) => error && error.code === "publication-operation-id-invalid",
    );
    assert.equal(calls.length, 0);
  }
  await expectIncomplete(c, base);
});

test("P122 presence, put, and presence failures leave the genuine stage incomplete without CAS or retry", async () => {
  const cases = [
    {
      name: "missing",
      behaviour: {
        presence: (input) => ({
          rows: input.storageRefs.map((storageRef, index) => ({
            storageRef,
            present: index !== 0,
          })),
        }),
      },
      code: "publication-remote-presence-missing",
    },
    { name: "put", behaviour: { put: () => { throw Object.assign(new Error("put"), { code: "remote-unavailable" }); } }, code: "remote-unavailable" },
    { name: "presence throw", behaviour: { presence: () => { throw Object.assign(new Error("presence"), { code: "remote-unavailable" }); } }, code: "remote-unavailable" },
  ];
  for (const item of cases) {
    const c = context(), base = await initialStage(c), calls = [];
    await assert.rejects(
      publisher(c, calls, item.behaviour).publishCandidate({
        stage: base.physical,
        expectedHead: genesis(),
      }),
      (error) => error && error.code === item.code,
      item.name,
    );
    assert.equal(calls.filter(([kind]) => kind === "cas").length, 0);
    await expectIncomplete(c, base);
  }
});

test("P122 maps every definite CAS conflict once and never completes the stage", async () => {
  for (const reason of [
    "head-conflict",
    "candidate-object-missing",
    "head-revision-exhausted",
  ]) {
    const c = context(), base = await initialStage(c), calls = [], result = await publisher(c, calls, {
      cas: () => ({ ok: false, reason }),
    }).publishCandidate({ stage: base.physical, expectedHead: genesis() });
    assert.deepEqual(
      plain(result),
      reason === "head-conflict"
        ? { outcome: "conflict", reason }
        : { outcome: "not-committed", reason },
    );
    assert.equal(Object.isFrozen(result), true);
    assert.equal(calls.filter(([kind]) => kind === "cas").length, 1);
    await expectIncomplete(c, base);
  }
});

test("P122 treats a thrown CAS as unknown without read, retry, or stage completion", async () => {
  const c = context(), base = await initialStage(c), calls = [];
  await assert.rejects(
    publisher(c, calls, {
      cas: () => {
        throw Object.assign(new Error("lost response"), { code: "remote-unavailable" });
      },
    }).publishCandidate({ stage: base.physical, expectedHead: genesis() }),
    (error) => error && error.code === "publication-outcome-unknown",
  );
  assert.equal(calls.filter(([kind]) => kind === "cas").length, 1);
  assert.equal(calls.some(([kind]) => ["read", "init"].includes(kind)), false);
  await expectIncomplete(c, base);
});

test("P122 batches genuine large stages at 512 refs after all puts and before one CAS", async () => {
  const c = context(), base = await initialStage(c, 800, 2), calls = [];
  assert.ok(base.physical.newRecords.length > 512);
  await publisher(c, calls).publishCandidate({
    stage: base.physical,
    expectedHead: genesis(),
  });
  const putCount = base.physical.newRecords.length,
    presence = calls.filter(([kind]) => kind === "presence"),
    expectedRefs = base.physical.newRecords.map((entry) => entry.storageRef);
  assert.equal(calls.slice(0, putCount).every(([kind]) => kind === "put"), true);
  assert.equal(calls.at(-1)[0], "cas");
  assert.ok(presence.every(([, body]) => body.storageRefs.length <= 512));
  assert.deepEqual(
    presence.flatMap(([, body]) => body.storageRefs),
    expectedRefs,
  );
  assert.equal(presence.length, Math.ceil(expectedRefs.length / 512));
});

test("P122 composes with the real P120 object Head service over its transport contract", async () => {
  const c = context(), base = await initialStage(c), calls = [], transportCalls = [],
    transport = {
      async request(route, body) {
        transportCalls.push([route, plain(body)]);
        const common = {
          apiVersion: 1,
          ok: true,
          operationId: body.operationId,
          syncedPocketId: body.syncedPocketId,
        };
        if (route === "putOpaqueObject")
          return { status: 200, body: { ...common, storageRef: body.storageRef, created: true } };
        if (route === "objectPresence")
          return {
            status: 200,
            body: {
              ...common,
              rows: body.storageRefs.map((storageRef) => ({ storageRef, present: true })),
            },
          };
        return {
          status: 200,
          body: {
            ...common,
            head: {
              schema: HEAD_SCHEMA,
              revision: body.expectedHead.revision + 1,
              sealRef: body.candidateSealStorageRef,
            },
          },
        };
      },
    },
    service = c.PocketSyncRemoteClient.createObjectHeadService({ transport }),
    result = await c.PocketStarlingPublicationShadow.createPublisher({
      objectHeadService: service,
      operationIdFactory: operationIds,
    }).publishCandidate({ stage: base.physical, expectedHead: genesis() });
  assert.equal(result.outcome, "committed");
  assert.deepEqual(
    transportCalls.map(([route]) => route),
    [
      ...Array(base.physical.newRecords.length).fill("putOpaqueObject"),
      "objectPresence",
      "compareAndSetShadowHead",
    ],
  );
  assert.deepEqual(transportCalls.at(-1)[1], {
    apiVersion: 1,
    operationId: operationIds("compare-and-set-head", 0),
    syncedPocketId: "p122",
    expectedHead: genesis(),
    candidateSealStorageRef: base.physical.sealStorageRef,
  });
  assert.equal(calls.length, 0);
});
