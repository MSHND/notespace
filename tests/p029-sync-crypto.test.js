"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const REPO_ROOT = path.resolve(__dirname, "..");
const MODULE_PATH = "js/pocket-sync-crypto.js";
const FIXTURE = JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, "tests/fixtures/p029-sync-crypto-vectors.json"),
  "utf8"
));
const SENTINEL = "P029-READABLE-PLAINTEXT-MUST-NOT-LEAK";

function source(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function bytes(hex) {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createModule(randomChunks) {
  const queue = randomChunks ? randomChunks.map((chunk) => Uint8Array.from(chunk)) : null;
  const captures = [];
  const cryptoFacade = {
    subtle: webcrypto.subtle,
    getRandomValues(target) {
      if (queue) {
        const next = queue.shift();
        if (!next || next.byteLength !== target.byteLength) throw new Error("Unexpected test randomness request");
        target.set(next);
      } else {
        webcrypto.getRandomValues(target);
      }
      captures.push(target);
      return target;
    },
  };
  const context = {
    crypto: cryptoFacade,
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
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source(MODULE_PATH), context, { filename: MODULE_PATH });
  return { api: context.PocketSyncCrypto, captures, queue };
}

function loadSecurityContract() {
  const context = { Object, Array, Number, String, Boolean };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source("js/pocket-sync-security-contract.js"), context);
  return context.PocketSyncSecurityContract;
}

async function importAes(hex) {
  return webcrypto.subtle.importKey(
    "raw",
    bytes(hex),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function assertAesKey(key) {
  assert.equal(key.type, "secret");
  assert.equal(key.extractable, false);
  assert.equal(key.algorithm.name, "AES-GCM");
  assert.equal(key.algorithm.length, 256);
  assert.deepEqual([...key.usages].sort(), ["decrypt", "encrypt"]);
}

function context(kind, envelopeId = `${kind}-envelope`) {
  return {
    syncedPocketId: "pocket-p029-tests",
    envelopeId,
    envelopeKind: kind,
    envelopeVersion: 1,
  };
}

function contentContext(overrides = {}) {
  return Object.assign({
    syncedPocketId: "pocket-p029-tests",
    revision: 4,
    contentType: "portal.export.v1+json",
  }, overrides);
}

function alterBase64url(value) {
  const changed = Buffer.from(value, "base64url");
  changed[0] ^= 1;
  return changed.toString("base64url");
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error && error.code === code && !error.message.includes(SENTINEL));
}

async function probeKey(key, aad = new Uint8Array()) {
  const encrypted = await webcrypto.subtle.encrypt({
    name: "AES-GCM",
    iv: bytes("e0e1e2e3e4e5e6e7e8e9eaeb"),
    additionalData: aad,
    tagLength: 128,
  }, key, new TextEncoder().encode("p029-key-probe"));
  return base64url(new Uint8Array(encrypted));
}

test("P029 module is inert, standards-compatible and loaded only as a P045 browser foundation", () => {
  assert.doesNotThrow(() => new vm.Script(source(MODULE_PATH)));
  assert.match(source("index.html"), /pocket-sync-crypto\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-crypto\.js/);
  assert.ok(createModule().api);
});

test("format, KDF, key, nonce, tag, salt and encoding constants are exact", () => {
  const { FORMAT, POLICY } = createModule().api;
  assert.equal(FORMAT.content, "pocket.sync.content.opaque");
  assert.equal(FORMAT.masterKeyEnvelope, "pocket.sync.master-key-envelope.opaque");
  assert.equal(FORMAT.version, 1);
  assert.equal(FORMAT.algorithm, "AES-GCM-256");
  assert.equal(FORMAT.kdf, "HKDF-SHA-256");
  assert.equal(FORMAT.keyBits, 256);
  assert.equal(FORMAT.nonceBytes, 12);
  assert.equal(FORMAT.tagBits, 128);
  assert.equal(FORMAT.hkdfSaltBytes, 32);
  assert.equal(POLICY.canonicalUnpaddedBase64url, true);
  assert.equal(POLICY.callerSuppliedNonceAllowed, false);
  assert.ok(POLICY.maximumEncryptionsPerKey < 2 ** 32);
});

test("official RFC 5869 HKDF-SHA-256 test case 1 passes", async () => {
  const ikm = bytes("0b".repeat(22));
  const salt = bytes("000102030405060708090a0b0c");
  const info = bytes("f0f1f2f3f4f5f6f7f8f9");
  const hmacKey = await webcrypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prk = await webcrypto.subtle.sign("HMAC", hmacKey, ikm);
  assert.equal(Buffer.from(prk).toString("hex"), "077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5");
  const baseKey = await webcrypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const okm = await webcrypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, baseKey, 42 * 8);
  assert.equal(Buffer.from(okm).toString("hex"), "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865");
});

test("official NIST AES-256-GCM empty-plaintext vector passes", async () => {
  const key = await importAes("00".repeat(32));
  const result = await webcrypto.subtle.encrypt({
    name: "AES-GCM",
    iv: bytes("00".repeat(12)),
    additionalData: new Uint8Array(),
    tagLength: 128,
  }, key, new Uint8Array());
  assert.equal(Buffer.from(result).toString("hex"), "530f8afbc74536b9a963b4f1c4cb738b");
});

test("Pocket static content vector and exact content AAD pass", async () => {
  const fixture = FIXTURE.content;
  const { api } = createModule([bytes(fixture.nonceHex)]);
  const masterKey = await importAes(FIXTURE.synthetic.masterKeyHex);
  assert.equal(new TextDecoder().decode(api.buildContentAad(fixture.context)), fixture.aadUtf8);
  assert.equal(base64url(api.buildContentAad(fixture.context)), fixture.aadBase64url);
  assert.deepEqual(plain(await api.sealContent(fixture.payload, masterKey, fixture.context)), fixture.record);
  assert.deepEqual(plain(await api.openContent(fixture.record, masterKey, fixture.context)), fixture.payload);
});

test("Pocket static direct device envelope and exact envelope AAD pass", async () => {
  const fixture = FIXTURE.deviceEnvelope;
  const { api } = createModule([bytes(FIXTURE.synthetic.masterKeyHex), bytes(fixture.nonceHex)]);
  const wrappingKey = await importAes(FIXTURE.synthetic.deviceWrappingKeyHex);
  assert.equal(new TextDecoder().decode(api.buildEnvelopeAad(fixture.context)), fixture.aadUtf8);
  assert.equal(base64url(api.buildEnvelopeAad(fixture.context)), fixture.aadBase64url);
  const bundle = await api.createMasterKeyBundle([{ context: fixture.context, wrappingKey }]);
  assert.deepEqual(plain(bundle.envelopes[0].record), fixture.record);
});

test("Pocket static recovery HKDF/envelope and derived-key probe pass", async () => {
  const fixture = FIXTURE.recoveryEnvelope;
  const secret = bytes(FIXTURE.synthetic.recoverySecretHex);
  const { api } = createModule([bytes(FIXTURE.synthetic.masterKeyHex), bytes(fixture.nonceHex)]);
  assert.equal(api.DERIVATION_LABELS.recovery, fixture.hkdfLabel);
  assert.equal(new TextDecoder().decode(api.buildHkdfInfo(fixture.context)), fixture.hkdfInfoUtf8);
  assert.equal(base64url(api.buildHkdfInfo(fixture.context)), fixture.hkdfInfoBase64url);
  const wrappingKey = await api.deriveWrappingKey(secret, FIXTURE.synthetic.recoverySaltBase64url, fixture.context);
  const bundle = await api.createMasterKeyBundle([{ context: fixture.context, wrappingKey }]);
  assert.deepEqual(plain(bundle.envelopes[0].record), fixture.record);
  const probe = fixture.derivedKeyProbe;
  const encrypted = await webcrypto.subtle.encrypt({
    name: "AES-GCM",
    iv: bytes(probe.nonceHex),
    additionalData: Buffer.from(probe.aadBase64url, "base64url"),
    tagLength: 128,
  }, wrappingKey, new TextEncoder().encode(probe.plaintextUtf8));
  assert.equal(base64url(new Uint8Array(encrypted)), probe.ciphertextBase64url);
});

test("generated device wrapping key is non-extractable AES-GCM-256 with exact usages", async () => {
  const key = await createModule().api.generateDeviceWrappingKey();
  assertAesKey(key);
  await assert.rejects(webcrypto.subtle.exportKey("raw", key));
});

test("derived wrapping keys are deterministic, non-extractable and do not mutate caller secret", async () => {
  const { api } = createModule();
  const secret = bytes(FIXTURE.synthetic.recoverySecretHex);
  const before = Buffer.from(secret);
  const first = await api.deriveWrappingKey(secret, FIXTURE.synthetic.recoverySaltBase64url, FIXTURE.recoveryEnvelope.context);
  const second = await api.deriveWrappingKey(secret, FIXTURE.synthetic.recoverySaltBase64url, FIXTURE.recoveryEnvelope.context);
  assertAesKey(first);
  assert.equal(await probeKey(first), await probeKey(second));
  assert.deepEqual(Buffer.from(secret), before);
  await assert.rejects(webcrypto.subtle.exportKey("raw", first));
});

test("every HKDF-bound value changes the effective wrapping key", async () => {
  const { api } = createModule();
  const secret = bytes(FIXTURE.synthetic.recoverySecretHex);
  const salt = FIXTURE.synthetic.recoverySaltBase64url;
  const baselineContext = FIXTURE.recoveryEnvelope.context;
  const baseline = await probeKey(await api.deriveWrappingKey(secret, salt, baselineContext));
  const variants = [
    Object.assign({}, baselineContext, { syncedPocketId: "pocket-other" }),
    Object.assign({}, baselineContext, { envelopeId: "envelope-other" }),
    Object.assign({}, baselineContext, { envelopeKind: "passkey-prf" }),
    Object.assign({}, baselineContext, { envelopeVersion: 2 }),
  ];
  for (const variant of variants) {
    assert.notEqual(await probeKey(await api.deriveWrappingKey(secret, salt, variant)), baseline);
  }
  const changedSalt = Buffer.from(salt, "base64url");
  changedSalt[0] ^= 1;
  assert.notEqual(
    await probeKey(await api.deriveWrappingKey(secret, changedSalt.toString("base64url"), baselineContext)),
    baseline
  );
});

test("derived-key creation generates a canonical 32-byte salt and clears its temporary buffer", async () => {
  const salt = bytes("c0".repeat(32));
  const { api, captures } = createModule([salt]);
  const result = await api.createDerivedWrappingKey(bytes(FIXTURE.synthetic.recoverySecretHex), context("recovery"));
  assertAesKey(result.key);
  assert.equal(result.kdf, "HKDF-SHA-256");
  assert.equal(Buffer.from(result.kdfSalt, "base64url").byteLength, 32);
  assert.equal(result.kdfSalt.includes("="), false);
  assert.ok(captures[0].every((value) => value === 0));
});

test("master-key bundle is non-extractable, creates all envelopes, returns no raw key and clears raw bytes", async () => {
  const wrappingKeys = await Promise.all([0, 1].map((index) => importAes((index ? "22" : "11").repeat(32))));
  const { api, captures } = createModule([bytes("10".repeat(32)), bytes("20".repeat(12)), bytes("30".repeat(12))]);
  const bundle = await api.createMasterKeyBundle([
    { context: context("device", "device-one"), wrappingKey: wrappingKeys[0] },
    { context: context("recovery", "recovery-one"), wrappingKey: wrappingKeys[1] },
  ]);
  assertAesKey(bundle.masterKey);
  assert.equal(bundle.envelopes.length, 2);
  assert.deepEqual(Object.keys(bundle).sort(), ["envelopes", "masterKey"]);
  assert.equal(JSON.stringify(bundle).includes("raw"), false);
  assert.ok(captures[0].every((value) => value === 0));
  await assert.rejects(webcrypto.subtle.exportKey("raw", bundle.masterKey));
  assert.notEqual(bundle.envelopes[0].record.nonce, bundle.envelopes[1].record.nonce);
  for (const envelope of bundle.envelopes) {
    assert.equal(Buffer.from(envelope.record.ciphertext, "base64url").byteLength, 48);
  }
});

test("master-key creation rejects no envelopes, duplicate IDs, unsupported kinds and invalid keys", async () => {
  const { api } = createModule();
  const key = await importAes("33".repeat(32));
  await expectCode(api.createMasterKeyBundle([]), "envelope-plans-invalid");
  await expectCode(api.createMasterKeyBundle([
    { context: context("device", "duplicate"), wrappingKey: key },
    { context: context("recovery", "duplicate"), wrappingKey: key },
  ]), "envelope-id-duplicate");
  await expectCode(api.createMasterKeyBundle([
    { context: Object.assign(context("device"), { envelopeKind: "unsupported" }), wrappingKey: key },
  ]), "envelope-context-invalid");
  const extractable = await webcrypto.subtle.importKey("raw", bytes("44".repeat(32)), "AES-GCM", true, ["encrypt", "decrypt"]);
  await expectCode(api.createMasterKeyBundle([{ context: context("device"), wrappingKey: extractable }]), "key-invalid");
});

test("every supported envelope kind reopens the same master key", async () => {
  const { api } = createModule();
  const keys = [];
  const plans = [];
  for (const [index, kind] of api.ENVELOPE_KINDS.entries()) {
    const envelopeContext = context(kind, `${kind}-supported`);
    const key = kind === "device"
      ? await api.generateDeviceWrappingKey()
      : await api.deriveWrappingKey(
        bytes((50 + index).toString(16).repeat(32)),
        base64url(bytes((70 + index).toString(16).repeat(32))),
        envelopeContext
      );
    keys.push(key);
    plans.push({ context: envelopeContext, wrappingKey: key });
  }
  const bundle = await api.createMasterKeyBundle(plans);
  const sealed = await api.sealContent({ value: "same-master" }, bundle.masterKey, contentContext());
  for (let index = 0; index < plans.length; index += 1) {
    const opened = await api.openMasterKeyBundle(
      bundle.envelopes[index].record,
      keys[index],
      plans[index].context
    );
    assertAesKey(opened.masterKey);
    assert.deepEqual(plain(await api.openContent(sealed, opened.masterKey, contentContext())), { value: "same-master" });
  }
});

test("envelope AAD and authenticated record reject context, nonce and ciphertext tampering", async () => {
  const { api } = createModule();
  const wrappingKey = await importAes("66".repeat(32));
  const originalContext = context("recovery", "bound-envelope");
  const envelope = (await api.createMasterKeyBundle([{ context: originalContext, wrappingKey }])).envelopes[0].record;
  for (const changed of [
    { syncedPocketId: "other-pocket" },
    { envelopeId: "other-envelope" },
    { envelopeKind: "passkey-prf" },
    { envelopeVersion: 2 },
  ]) {
    await expectCode(
      api.openMasterKeyBundle(envelope, wrappingKey, Object.assign({}, originalContext, changed)),
      "master-key-envelope-authentication-failed"
    );
  }
  await expectCode(api.openMasterKeyBundle(
    Object.assign({}, envelope, { nonce: alterBase64url(envelope.nonce) }), wrappingKey, originalContext
  ), "master-key-envelope-authentication-failed");
  await expectCode(api.openMasterKeyBundle(
    Object.assign({}, envelope, { ciphertext: alterBase64url(envelope.ciphertext) }), wrappingKey, originalContext
  ), "master-key-envelope-authentication-failed");
});

test("opening an envelope can add another envelope without exporting raw master bytes", async () => {
  const { api } = createModule();
  const sourceKey = await importAes("71".repeat(32));
  const nextKey = await importAes("72".repeat(32));
  const sourceContext = context("device", "source-envelope");
  const nextContext = context("device-transfer", "next-envelope");
  const sourceBundle = await api.createMasterKeyBundle([{ context: sourceContext, wrappingKey: sourceKey }]);
  const opened = await api.openMasterKeyBundle(
    sourceBundle.envelopes[0].record,
    sourceKey,
    sourceContext,
    [{ context: nextContext, wrappingKey: nextKey }]
  );
  assertAesKey(opened.masterKey);
  assert.equal(opened.envelopes.length, 1);
  assert.deepEqual(Object.keys(opened).sort(), ["envelopes", "masterKey"]);
  const reopened = await api.openMasterKeyBundle(opened.envelopes[0].record, nextKey, nextContext);
  const record = await api.sealContent({ migrated: true }, opened.masterKey, contentContext());
  assert.deepEqual(plain(await api.openContent(record, reopened.masterKey, contentContext())), { migrated: true });
});

test("content seals and opens exactly and normal repeated encryption uses different nonces", async () => {
  const { api } = createModule();
  const key = await importAes("81".repeat(32));
  const payload = { kind: "disposable", values: [1, 2, 3] };
  const first = await api.sealContent(payload, key, contentContext());
  const second = await api.sealContent(payload, key, contentContext());
  assert.deepEqual(plain(await api.openContent(first, key, contentContext())), payload);
  assert.notEqual(first.nonce, second.nonce);
  assert.notEqual(first.ciphertext, second.ciphertext);
});

test("content AAD and authenticated record reject context, nonce and ciphertext tampering", async () => {
  const { api } = createModule();
  const key = await importAes("82".repeat(32));
  const originalContext = contentContext();
  const record = await api.sealContent({ safe: true }, key, originalContext);
  await expectCode(api.openContent(record, key, Object.assign({}, originalContext, { syncedPocketId: "other" })), "content-authentication-failed");
  await expectCode(api.openContent(record, key, Object.assign({}, originalContext, { revision: 5 })), "content-authentication-failed");
  await expectCode(api.openContent(record, key, Object.assign({}, originalContext, { contentType: "other/type" })), "content-context-invalid");
  await expectCode(api.openContent(Object.assign({}, record, { nonce: alterBase64url(record.nonce) }), key, originalContext), "content-authentication-failed");
  await expectCode(api.openContent(Object.assign({}, record, { ciphertext: alterBase64url(record.ciphertext) }), key, originalContext), "content-authentication-failed");
});

test("invalid decrypted JSON and unrepresentable top-level payloads fail without partial content", async () => {
  const { api } = createModule();
  const key = await importAes("83".repeat(32));
  const current = contentContext();
  const nonce = bytes("12".repeat(12));
  const encrypted = await webcrypto.subtle.encrypt({
    name: "AES-GCM", iv: nonce, additionalData: api.buildContentAad(current), tagLength: 128,
  }, key, new TextEncoder().encode("not-json"));
  await expectCode(api.openContent({
    format: "pocket.sync.content.opaque",
    version: 1,
    algorithm: "AES-GCM-256",
    nonce: base64url(nonce),
    ciphertext: base64url(new Uint8Array(encrypted)),
  }, key, current), "content-json-invalid");
  await expectCode(api.sealContent(undefined, key, current), "content-serialisation-failed");
  const cyclic = {};
  cyclic.self = cyclic;
  await expectCode(api.sealContent(cyclic, key, current), "content-serialisation-failed");
});

test("content records strictly reject malformed format, version, algorithm and base64url", () => {
  const { api } = createModule();
  const valid = FIXTURE.content.record;
  const malformed = [
    Object.assign({}, valid, { readable: SENTINEL }),
    Object.assign({}, valid, { format: "wrong" }),
    Object.assign({}, valid, { version: 2 }),
    Object.assign({}, valid, { algorithm: "AES-GCM" }),
    Object.assign({}, valid, { nonce: `${valid.nonce}=` }),
    Object.assign({}, valid, { ciphertext: "AAAAAAAAAAAAAAAAAAAAAB" }),
    Object.assign({}, valid, { nonce: base64url(bytes("00".repeat(11))) }),
    Object.assign({}, valid, { ciphertext: base64url(bytes("00".repeat(15))) }),
  ];
  for (const record of malformed) assert.throws(() => api.validateContentRecord(record), { code: "content-record-invalid" });
});

test("master-key envelopes strictly reject malformed format, version, algorithm and base64url", () => {
  const { api } = createModule();
  const valid = FIXTURE.deviceEnvelope.record;
  const malformed = [
    Object.assign({}, valid, { readable: SENTINEL }),
    Object.assign({}, valid, { format: "wrong" }),
    Object.assign({}, valid, { version: 2 }),
    Object.assign({}, valid, { algorithm: "AES-GCM" }),
    Object.assign({}, valid, { nonce: `${valid.nonce}=` }),
    Object.assign({}, valid, { ciphertext: `${valid.ciphertext}=` }),
    Object.assign({}, valid, { nonce: base64url(bytes("00".repeat(13))) }),
    Object.assign({}, valid, { ciphertext: base64url(bytes("00".repeat(47))) }),
  ];
  for (const record of malformed) assert.throws(() => api.validateMasterKeyEnvelope(record), { code: "master-key-envelope-invalid" });
});

test("P028 accepts only concrete P029 content records and exact envelope metadata", () => {
  const contract = loadSecurityContract();
  assert.equal(contract.validateOpaqueEncryptedRecord(FIXTURE.content.record).ok, true);
  assert.equal(contract.validateOpaqueEncryptedRecord(Object.assign({}, FIXTURE.content.record, {
    algorithm: "authenticated-encryption",
  })).ok, false);
  assert.equal(contract.validateOpaqueMasterKeyEnvelopeRecord(FIXTURE.deviceEnvelope.record).ok, true);
  assert.equal(contract.validateOpaqueMasterKeyEnvelopeRecord(Object.assign({}, FIXTURE.deviceEnvelope.record, {
    ciphertext: base64url(bytes("00".repeat(47))),
  })).ok, false);
  assert.equal(contract.validateOpaqueMasterKeyEnvelopeRecord(Object.assign({}, FIXTURE.deviceEnvelope.record, {
    extra: SENTINEL,
  })).ok, false);
  const common = {
    syncedPocketId: "pocket-p029-tests",
    envelopeId: "metadata-envelope",
    version: 1,
    createdAt: "2030-01-01T00:00:00Z",
  };
  assert.equal(contract.buildKeyEnvelopeMetadata(Object.assign({}, common, {
    kind: "device", deviceId: "device-p029-tests", kdf: "none",
  })).ok, true);
  assert.equal(contract.buildKeyEnvelopeMetadata(Object.assign({}, common, {
    kind: "recovery",
    kdf: "HKDF-SHA-256",
    kdfSalt: FIXTURE.synthetic.recoverySaltBase64url,
    derivationVersion: 1,
  })).ok, true);
  assert.equal(contract.buildKeyEnvelopeMetadata(Object.assign({}, common, {
    kind: "recovery", kdf: "HKDF-SHA-256", derivationVersion: 1,
  })).ok, false);
  assert.equal(contract.buildKeyEnvelopeMetadata(Object.assign({}, common, {
    kind: "device", kdf: "none", kdfSalt: FIXTURE.synthetic.recoverySaltBase64url,
  })).ok, false);
  assert.equal(contract.buildKeyEnvelopeMetadata(Object.assign({}, common, {
    kind: "recovery", kdf: "unknown", kdfSalt: FIXTURE.synthetic.recoverySaltBase64url, derivationVersion: 1,
  })).ok, false);
});

test("readable plaintext cannot enter remote metadata, opaque top levels or error messages", async () => {
  const contract = loadSecurityContract();
  assert.equal(contract.buildRemoteSafeMetadata({
    accountId: "account", syncedPocketId: "pocket", revision: 1, encryptedRecordSize: 20, plaintext: SENTINEL,
  }).ok, false);
  assert.equal(contract.validateOpaqueEncryptedRecord(Object.assign({}, FIXTURE.content.record, { plaintext: SENTINEL })).ok, false);
  assert.equal(contract.validateOpaqueMasterKeyEnvelopeRecord(Object.assign({}, FIXTURE.deviceEnvelope.record, { plaintext: SENTINEL })).ok, false);
  const { api } = createModule();
  const key = await importAes("84".repeat(32));
  const record = await api.sealContent({ text: SENTINEL }, key, contentContext());
  assert.doesNotMatch(JSON.stringify(record), new RegExp(SENTINEL));
  await assert.rejects(api.openContent(record, key, contentContext({ revision: 9 })), (error) => !error.message.includes(SENTINEL));
});

test("P050 signs one exact Ed25519 recovery-authorisation transcript with portable PKCS8 material", async () => {
  const { api } = createModule();
  const first = await api.createRecoveryAuthorisationKeyPair();
  const second = await api.createRecoveryAuthorisationKeyPair();
  const credential = { id: "credential-p050", rawId: "credential-p050", type: "public-key" };
  const credentialDigest = await api.digestRecoveryCredential(credential);
  const input = {
    recoveryCeremonyId: "ceremony-p050", operationId: "operation-p050", challenge: "challenge-p050",
    syncedPocketId: "pocket-p050", deviceId: "device-p050", recoveryVersion: 2,
    keySetVersion: 7, expiresAt: "2042-01-01T00:05:00.000Z", credentialDigest,
  };
  const proof = await api.signRecoveryAuthorisation(first.recoveryAuthorisation, input);
  const transcript = Buffer.from(JSON.stringify([
    "pocket.sync.recovery-authorisation.v1", 1, input.recoveryCeremonyId, input.operationId,
    input.challenge, input.syncedPocketId, input.deviceId, input.recoveryVersion,
    input.keySetVersion, input.expiresAt, base64url(credentialDigest),
  ]));
  const publicKey = await webcrypto.subtle.importKey("spki",
    Buffer.from(first.recoveryVerifier.publicKey, "base64url"), { name: "Ed25519" }, false, ["verify"]);
  assert.equal(await webcrypto.subtle.verify("Ed25519", publicKey,
    Buffer.from(proof.signature, "base64url"), transcript), true);
  const tampered = Buffer.from(transcript);
  tampered[tampered.length - 2] ^= 1;
  assert.equal(await webcrypto.subtle.verify("Ed25519", publicKey,
    Buffer.from(proof.signature, "base64url"), tampered), false);
  const wrongProof = await api.signRecoveryAuthorisation(second.recoveryAuthorisation, input);
  assert.equal(await webcrypto.subtle.verify("Ed25519", publicKey,
    Buffer.from(wrongProof.signature, "base64url"), transcript), false);
  credentialDigest.fill(0);
});

test("P050a cryptographically validates only canonical Ed25519 PKCS8 recovery authority", async () => {
  const { api } = createModule();
  const keys = await api.createRecoveryAuthorisationKeyPair();
  assert.equal((await api.validateRecoveryAuthorisation(keys.recoveryAuthorisation)).valid, true);
  const malformed = { ...keys.recoveryAuthorisation, privateKey: Buffer.alloc(64, 7).toString("base64url") };
  await assert.rejects(api.validateRecoveryAuthorisation(malformed), { code: "recovery-proof-invalid" });
  await assert.rejects(api.validateRecoveryAuthorisation({ ...keys.recoveryAuthorisation, extra: true }),
    { code: "recovery-proof-invalid" });
});

test("P050a reports unsupported native Ed25519 separately from malformed recovery authority", async () => {
  const supported = createModule();
  const keys = await supported.api.createRecoveryAuthorisationKeyPair();
  const context = {
    crypto: {
      subtle: {
        async importKey() {
          const error = new Error("native detail");
          error.name = "NotSupportedError";
          throw error;
        },
      },
      getRandomValues(target) { return target; },
    },
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
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source(MODULE_PATH), context, { filename: MODULE_PATH });
  await assert.rejects(context.PocketSyncCrypto.validateRecoveryAuthorisation(keys.recoveryAuthorisation),
    { code: "recovery-signature-unsupported" });
});

test("sync crypto has no forbidden derivation, storage, network, DOM, timer, provider or third-party code", () => {
  const moduleSource = source(MODULE_PATH).toLowerCase();
  for (const forbidden of [
    "pbkdf2", "password", "passphrase", "fetch(", "websocket", "indexeddb", "localstorage",
    "document.", "serviceworker", "settimeout", "setinterval", "navigator.credentials", "broadcastchannel",
    "sharedworker", "https://", "http://", "amazon", "google cloud", "azure", "console.", "require(",
  ]) {
    assert.equal(moduleSource.includes(forbidden), false, forbidden);
  }
});

test("existing local Vault crypto contract remains PBKDF2-based and separate", () => {
  const vaultSource = source("js/pocket-crypto.js");
  assert.match(vaultSource, /kind: "pocket\.vault"/);
  assert.match(vaultSource, /kdf: "PBKDF2-SHA-256"/);
  assert.match(vaultSource, /iterations: 310000/);
  assert.match(vaultSource, /cipher: "AES-GCM"/);
  assert.doesNotMatch(source(MODULE_PATH), /PocketCrypto\s*=/);
});
