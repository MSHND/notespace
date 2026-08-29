"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { webcrypto } = require("node:crypto");

const ROOT = path.resolve(__dirname, ".."),
  MODULE = "js/pocket-starling-crypto-shadow.js",
  SYNC_MODULE = "js/pocket-sync-crypto.js",
  P109_MODULE = "js/pocket-starling-object-seal-shadow.js";
const plain = (value) => JSON.parse(JSON.stringify(value));

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function context(crypto = webcrypto) {
  const c = {
    crypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    Object,
    Array,
    Number,
    String,
    Boolean,
    JSON,
    Error,
    Map,
    Set,
    WeakMap,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
  };
  c.window = c;
  c.globalThis = c;
  vm.createContext(c);
  for (const file of [SYNC_MODULE, P109_MODULE, MODULE])
    vm.runInContext(source(file), c, { filename: file });
  return c;
}

function envelopeContext(kind = "device", envelopeId = `${kind}-envelope`) {
  return {
    syncedPocketId: "pocket-p111-tests",
    envelopeId,
    envelopeKind: kind,
    envelopeVersion: 1,
  };
}

function objectContext(syncedPocketId = "pocket-p111-tests") {
  return { syncedPocketId };
}

function logicalFixture(c) {
  const object = {
      schema: c.PocketStarlingObjectSealShadow.OBJECT_SCHEMA,
      kind: "content-record",
      nodeId: "node-p111-distinctive",
      payload: {
        label: "P111 plaintext must remain opaque",
        parentId: "parent-p111-distinctive",
      },
    },
    canonical = c.PocketStarlingObjectSealShadow.canonical(object);
  assert.equal(canonical.ok, true);
  return {
    object,
    bytes: canonical.bytes,
    logicalRef: c.PocketStarlingObjectSealShadow.refFor(
      object.kind,
      canonical.bytes,
    ),
  };
}

async function masterKeyBundle(c) {
  const wrappingKey = await c.PocketSyncCrypto.generateDeviceWrappingKey(),
    context = envelopeContext(),
    bundle = await c.PocketSyncCrypto.createMasterKeyBundle([
      { context, wrappingKey },
    ]);
  return { wrappingKey, context, bundle };
}

function changeBase64url(value) {
  const changed = Buffer.from(value, "base64url");
  changed[0] ^= 1;
  return changed.toString("base64url");
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error && error.code === code);
}

test("P111 encrypts exact P109 bytes under the existing rewrappable master key", async () => {
  const c = context(),
    sync = c.PocketSyncCrypto,
    api = c.PocketStarlingCryptoShadow,
    logical = logicalFixture(c),
    foundation = await masterKeyBundle(c),
    sealed = await api.sealObject(
      logical.bytes,
      foundation.bundle.masterKey,
      objectContext(),
    );

  assert.equal(
    await api.openObject(
      sealed.record,
      sealed.ref,
      foundation.bundle.masterKey,
      objectContext(),
    ),
    logical.bytes,
  );
  assert.equal(Object.isFrozen(sealed), true);
  assert.equal(Object.isFrozen(sealed.record), true);
  assert.deepEqual(Object.keys(sealed.record), [
    "format",
    "version",
    "algorithm",
    "nonce",
    "ciphertext",
  ]);

  const rotationKey = await sync.generateDeviceWrappingKey(),
    rotationContext = envelopeContext("device-transfer", "rotated-envelope"),
    rewrapped = await sync.openMasterKeyBundle(
      foundation.bundle.envelopes[0].record,
      foundation.wrappingKey,
      foundation.context,
      [{ context: rotationContext, wrappingKey: rotationKey }],
    ),
    reopened = await sync.openMasterKeyBundle(
      rewrapped.envelopes[0].record,
      rotationKey,
      rotationContext,
    );
  assert.equal(
    await api.openObject(
      sealed.record,
      sealed.ref,
      reopened.masterKey,
      objectContext(),
    ),
    logical.bytes,
  );
});

test("P111 rejects tampering, wrong Pocket context and reference mismatch", async () => {
  const c = context(),
    api = c.PocketStarlingCryptoShadow,
    logical = logicalFixture(c),
    { bundle } = await masterKeyBundle(c),
    sealed = await api.sealObject(
      logical.bytes,
      bundle.masterKey,
      objectContext(),
    );

  for (const field of ["format", "version", "algorithm"]) {
    const changed = {
      ...plain(sealed.record),
      [field]: field === "version" ? 2 : `wrong-${field}`,
    };
    await expectCode(
      api.openObject(changed, sealed.ref, bundle.masterKey, objectContext()),
      "object-record-invalid",
    );
  }
  for (const field of ["nonce", "ciphertext"]) {
    const changed = {
      ...plain(sealed.record),
      [field]: changeBase64url(sealed.record[field]),
    };
    await expectCode(
      api.openObject(changed, sealed.ref, bundle.masterKey, objectContext()),
      "object-reference-mismatch",
    );
    await expectCode(
      api.openObject(
        changed,
        await api.referenceForRecord(changed),
        bundle.masterKey,
        objectContext(),
      ),
      "object-authentication-failed",
    );
  }
  await expectCode(
    api.openObject(
      sealed.record,
      sealed.ref + "x",
      bundle.masterKey,
      objectContext(),
    ),
    "object-reference-mismatch",
  );
  await expectCode(
    api.openObject(
      sealed.record,
      sealed.ref,
      bundle.masterKey,
      objectContext("different-pocket"),
    ),
    "object-authentication-failed",
  );
});

test("P111 rejects revision authority while exact encrypted reuse remains valid", async () => {
  const c = context(),
    api = c.PocketStarlingCryptoShadow,
    logical = logicalFixture(c),
    { bundle } = await masterKeyBundle(c),
    sealed = await api.sealObject(
      logical.bytes,
      bundle.masterKey,
      objectContext(),
    );

  for (const operation of [
    () =>
      api.sealObject(logical.bytes, bundle.masterKey, {
        ...objectContext(),
        revision: 1,
      }),
    () =>
      api.openObject(sealed.record, sealed.ref, bundle.masterKey, {
        ...objectContext(),
        revision: 99,
      }),
  ])
    await expectCode(operation(), "object-context-invalid");

  for (const laterHeadRevision of [1, 2, 1000, Number.MAX_SAFE_INTEGER]) {
    assert.ok(Number.isSafeInteger(laterHeadRevision));
    assert.equal(
      await api.openObject(
        sealed.record,
        sealed.ref,
        bundle.masterKey,
        objectContext(),
      ),
      logical.bytes,
    );
  }
});

test("P111 fresh encryption is random while exact encrypted reuse stays opaque", async () => {
  const c = context(),
    api = c.PocketStarlingCryptoShadow,
    logical = logicalFixture(c),
    { bundle } = await masterKeyBundle(c),
    first = await api.sealObject(
      logical.bytes,
      bundle.masterKey,
      objectContext(),
    ),
    second = await api.sealObject(
      logical.bytes,
      bundle.masterKey,
      objectContext(),
    );

  assert.notEqual(first.record.nonce, second.record.nonce);
  assert.notEqual(first.record.ciphertext, second.record.ciphertext);
  assert.notEqual(first.ref, second.ref);
  assert.notEqual(first.ref, logical.logicalRef);
  const publicMaterial = JSON.stringify([first.record, first.ref]);
  for (const secret of [
    logical.object.nodeId,
    logical.object.payload.label,
    logical.object.payload.parentId,
    logical.logicalRef,
    logical.object.kind,
  ])
    assert.equal(publicMaterial.includes(secret), false, secret);
  assert.equal(
    await api.openObject(
      first.record,
      first.ref,
      bundle.masterKey,
      objectContext(),
    ),
    logical.bytes,
  );
});

test("P111 encrypted references are canonical, deterministic and exact", async () => {
  const c = context(),
    api = c.PocketStarlingCryptoShadow,
    logical = logicalFixture(c),
    { bundle } = await masterKeyBundle(c),
    sealed = await api.sealObject(
      logical.bytes,
      bundle.masterKey,
      objectContext(),
    ),
    reordered = {
      ciphertext: sealed.record.ciphertext,
      nonce: sealed.record.nonce,
      algorithm: sealed.record.algorithm,
      version: sealed.record.version,
      format: sealed.record.format,
    },
    changed = {
      ...plain(sealed.record),
      ciphertext: changeBase64url(sealed.record.ciphertext),
    };

  assert.equal(await api.referenceForRecord(sealed.record), sealed.ref);
  assert.equal(await api.referenceForRecord(reordered), sealed.ref);
  assert.notEqual(await api.referenceForRecord(changed), sealed.ref);
  assert.match(
    sealed.ref,
    /^pocket\.sync\.starling-object\.reference\.v1:sha256:[A-Za-z0-9_-]{43}$/,
  );
  assert.equal(
    api.canonicalEncryptedRecord(reordered),
    api.canonicalEncryptedRecord(sealed.record),
  );
});

test("P111 rejects malformed records, contexts, keys and randomness", async () => {
  const c = context(),
    api = c.PocketStarlingCryptoShadow,
    logical = logicalFixture(c),
    { bundle } = await masterKeyBundle(c),
    sealed = await api.sealObject(
      logical.bytes,
      bundle.masterKey,
      objectContext(),
    );

  for (const changed of [
    { ...plain(sealed.record), nonce: sealed.record.nonce + "=" },
    { ...plain(sealed.record), nonce: "!invalid" },
    { ...plain(sealed.record), ciphertext: "a" },
    { ...plain(sealed.record), revision: 1 },
  ])
    await expectCode(
      api.openObject(changed, sealed.ref, bundle.masterKey, objectContext()),
      "object-record-invalid",
    );
  for (const badContext of [
    {},
    { syncedPocketId: " pocket " },
    { syncedPocketId: "pocket", nonce: "caller-controlled" },
  ])
    await expectCode(
      api.sealObject(logical.bytes, bundle.masterKey, badContext),
      "object-context-invalid",
    );
  await expectCode(
    api.sealObject(logical.bytes, null, objectContext()),
    "key-invalid",
  );
  const extractable = await webcrypto.subtle.importKey(
    "raw",
    new Uint8Array(32),
    "AES-GCM",
    true,
    ["encrypt", "decrypt"],
  );
  await expectCode(
    api.sealObject(logical.bytes, extractable, objectContext()),
    "key-invalid",
  );

  const failedRandom = context({
    subtle: webcrypto.subtle,
    getRandomValues() {
      throw new Error("synthetic random failure");
    },
  });
  await expectCode(
    failedRandom.PocketStarlingCryptoShadow.sealObject(
      logical.bytes,
      bundle.masterKey,
      objectContext(),
    ),
    "random-generation-failed",
  );
});

test("P111 leaves P029 whole-content encryption revision-bound and unchanged", async () => {
  const c = context(),
    sync = c.PocketSyncCrypto,
    { bundle } = await masterKeyBundle(c),
    currentContext = {
      syncedPocketId: "pocket-p111-tests",
      revision: 7,
      contentType: sync.FORMAT.contentType,
    },
    record = await sync.sealContent(
      { legacyWholeRecord: true },
      bundle.masterKey,
      currentContext,
    );

  assert.equal(sync.FORMAT.content, "pocket.sync.content.opaque");
  assert.equal(sync.FORMAT.contentType, "portal.export.v1+json");
  assert.equal(record.format, sync.FORMAT.content);
  assert.deepEqual(
    plain(await sync.openContent(record, bundle.masterKey, currentContext)),
    { legacyWholeRecord: true },
  );
  await expectCode(
    sync.openContent(record, bundle.masterKey, {
      ...currentContext,
      revision: 8,
    }),
    "content-authentication-failed",
  );
  assert.notDeepEqual(
    [...sync.buildContentAad(currentContext)],
    [...sync.buildContentAad({ ...currentContext, revision: 8 })],
  );
});

test("P111 remains a dormant crypto-only proof", () => {
  const moduleSource = source(MODULE);
  assert.equal(source("index.html").includes(MODULE), false);
  for (const forbidden of [
    "indexedDB",
    "localStorage",
    "fetch(",
    "XMLHttpRequest",
    "WebSocket",
    "conditionalUpload",
    "PocketStarlingHeadShadow",
    "PocketStarlingObjectSealShadow",
    "document.",
  ])
    assert.equal(moduleSource.includes(forbidden), false, forbidden);
});
