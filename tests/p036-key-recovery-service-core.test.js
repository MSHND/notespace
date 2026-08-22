"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serviceModule = require("../sync-service/pocket-sync-service-core.js");
const { createMemoryServiceStore, FAILURE_POINTS } = require("./helpers/p034-memory-service-store.js");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://sync.pocket.example";
const NOW = Date.parse("2033-01-01T00:00:00.000Z");
const METHODS = Object.freeze([
  "beginRegistration", "finishRegistration", "beginAuthentication", "finishAuthentication",
  "readSyncedPocket", "readRevision", "downloadEncryptedRecord", "conditionalUpload", "listEnvelopes",
  "downloadEnvelope", "addEnvelope", "revokeEnvelope", "initialiseRecovery",
  "beginRecovery", "finishRecovery", "rotateRecovery",
]);
const COLLECTIONS = Object.freeze([
  "accounts", "credentials", "sessions", "ceremonies", "pockets", "operations",
  "keySets", "envelopes", "recoveryLocators", "recoveryCeremonies", "keyOperations",
]);

function source(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function bytes(length, start = 1) {
  return Uint8Array.from({ length }, (_value, index) => (start + index) & 255);
}
function b64(length, start = 1) { return Buffer.from(bytes(length, start)).toString("base64url"); }
function errorCode(code) { return (error) => error && error.code === code; }
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function context(sessionId = null) {
  return { method: "POST", origin: ORIGIN, fetchSite: "same-origin",
    contentType: "application/json", sessionId };
}
function call(body, sessionId = null) { return { context: context(sessionId), body }; }
function registrationCredential(id = b64(32, 101)) {
  return { id, rawId: id, response: { clientDataJSON: b64(17, 2),
    attestationObject: b64(24, 4), authenticatorData: b64(19, 6),
    transports: ["internal"], publicKey: b64(23, 8), publicKeyAlgorithm: -7 },
  authenticatorAttachment: "platform", clientExtensionResults: { prf: { enabled: true } },
  type: "public-key" };
}
function contentRecord(seed = 10) {
  return { format: "pocket.sync.content.opaque", version: 1, algorithm: "AES-GCM-256",
    nonce: b64(12, seed), ciphertext: b64(32, seed + 30) };
}
function encryptedEnvelope(seed = 20) {
  return { format: "pocket.sync.master-key-envelope.opaque", version: 1,
    algorithm: "AES-GCM-256", nonce: b64(12, seed), ciphertext: b64(48, seed + 30) };
}
function deviceEnvelope(id = "device-envelope", seed = 20) {
  return { envelopeId: id, envelopeKind: "device", envelopeVersion: 1,
    deviceId: "device-one", credentialId: null, kdf: "none", kdfSalt: null,
    derivationVersion: null, encryptedEnvelope: encryptedEnvelope(seed) };
}
function transferEnvelope(id = "transfer-envelope", seed = 30) {
  return { envelopeId: id, envelopeKind: "device-transfer", envelopeVersion: 1,
    deviceId: null, credentialId: null, kdf: "HKDF-SHA-256", kdfSalt: b64(32, 71),
    derivationVersion: 1, encryptedEnvelope: encryptedEnvelope(seed) };
}
function recoveryEnvelope(version = 1, id = `recovery-envelope-${version}`, seed = 40) {
  return { envelopeId: id, envelopeKind: "recovery", envelopeVersion: version,
    deviceId: null, credentialId: null, kdf: "HKDF-SHA-256", kdfSalt: b64(32, 91 + version),
    derivationVersion: 1, encryptedEnvelope: encryptedEnvelope(seed + version) };
}
function recoveryVerifier(_version = 1, seed = 110) {
  return { version: 1, algorithm: "Ed25519", publicKeyFormat: "spki",
    publicKey: b64(32, seed + 40) };
}
function proof(seed = 170) {
  return { version: 1, algorithm: "Ed25519", signature: b64(64, seed) };
}
function mutation(operationId, expectedKeySetVersion, extra = {}) {
  return { apiVersion: 1, operationId, logicalChangeId: `${operationId}-change`,
    attemptKind: "new-change", syncedPocketId: "pocket-one", expectedKeySetVersion, ...extra };
}

function createHarness(options = {}) {
  const driver = options.driver || createMemoryServiceStore();
  let randomCall = 0;
  let currentTime = options.now || NOW;
  const calls = { registration: 0, authentication: 0, recovery: 0,
    recoveryDuringTransaction: false, registrationDuringTransaction: false };
  const verifier = Object.freeze({
    async verifyRegistration(input) {
      calls.registration += 1;
      const counters = driver.counters();
      calls.registrationDuringTransaction ||= counters.readwrite > counters.commits + counters.rollbacks;
      if (options.verifyRegistration) return options.verifyRegistration(input);
      return { credentialId: input.credential.id, publicKey: b64(64, 61),
        publicKeyAlgorithm: -7, signCount: 0, transports: ["internal"],
        backupEligible: true, backedUp: false };
    },
    async verifyAuthentication(input) {
      calls.authentication += 1;
      return { credentialId: input.credential.id,
        signCount: input.storedCredential.signCount + 1, backedUp: true };
    },
  });
  const recoveryProofVerifier = Object.freeze({
    async verifyRecoveryProof(input) {
      calls.recovery += 1;
      const counters = driver.counters();
      calls.recoveryDuringTransaction ||= counters.readwrite > counters.commits + counters.rollbacks;
      if (options.verifyRecoveryProof) return options.verifyRecoveryProof(input);
      return { verified: true };
    },
  });
  const config = { store: driver.store, webAuthnVerifier: verifier,
    recoveryProofVerifier,
    randomBytes(length) { randomCall += 1; return bytes(length, randomCall * 19); },
    now: () => currentTime, trustedOrigin: ORIGIN, rpId: "sync.pocket.example",
    rpName: "Pocket", credentialAlgorithms: Object.freeze([-7]),
    ceremonyLifetimeMs: 300000, sessionLifetimeMs: 2592000000 };
  return { core: serviceModule.createServiceCore(config), driver, calls, config,
    setTime(value) { currentTime = value; } };
}

async function registerAndBind(harness) {
  const begin = await harness.core.beginRegistration(call({ apiVersion: 1,
    operationId: "register-one", accountIntent: "create-or-add-credential",
    deviceId: "device-one" }));
  const credential = registrationCredential();
  const finish = await harness.core.finishRegistration(call({ apiVersion: 1,
    operationId: "register-one", ceremonyId: begin.body.ceremonyId,
    deviceId: "device-one", credential }));
  const sessionId = finish.session.sessionId;
  await harness.core.conditionalUpload(call({ apiVersion: 1, syncedPocketId: "pocket-one",
    expectedRevision: 0, operationId: "upload-one", logicalChangeId: "upload-one-change",
    attemptKind: "new-change", encryptedRecord: contentRecord() }, sessionId));
  return { begin, finish, sessionId, accountId: finish.body.accountId,
    credentialId: credential.id };
}

async function initialise(harness, sessionId, expectedKeySetVersion = 0) {
  return harness.core.initialiseRecovery(call(mutation("initialise-recovery",
    expectedKeySetVersion, { recoveryVerifier: recoveryVerifier(1),
      recoveryEnvelope: recoveryEnvelope(1) }), sessionId));
}

async function finishRecoveryFlow(harness, locator) {
  const begin = await harness.core.beginRecovery(call({ apiVersion: 1,
    operationId: "recover-one", accountLocator: locator, deviceId: "device-recovered" }));
  const credential = registrationCredential(b64(32, 141));
  const finish = await harness.core.finishRecovery(call({ apiVersion: 1,
    operationId: "recover-one", recoveryCeremonyId: begin.body.recoveryCeremonyId,
    deviceId: "device-recovered", proof: proof(), credential }));
  return { begin, finish, credential };
}

test("P036 core remains isolated from P046-P049 server adapters and browser loading", () => {
  assert.deepEqual(Object.keys(serviceModule), ["POLICY", "COLLECTIONS", "createServiceCore"]);
  assert.deepEqual(Object.values(serviceModule.COLLECTIONS), COLLECTIONS);
  assert.equal(Object.isFrozen(serviceModule.COLLECTIONS), true);
  const harness = createHarness();
  assert.deepEqual(Object.keys(harness.core), METHODS);
  assert.equal(Object.isFrozen(harness.core), true);
  assert.doesNotMatch(source("index.html"), /pocket-sync-service-core/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-service-core/);
  assert.doesNotMatch(source("index.html"), /pocket-sync-postgres-store/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-postgres-store/);
  assert.doesNotMatch(source("index.html"), /pocket-sync-webauthn-verifier/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-webauthn-verifier/);
  assert.doesNotMatch(source("index.html"), /pocket-sync-server/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-server/);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, "sync-service")).sort(), [
    "migrations",
    "pocket-sync-db-migrate.js",
    "pocket-sync-http-adapter.js",
    "pocket-sync-local-integration-server.js",
    "pocket-sync-postgres-schema.js",
    "pocket-sync-postgres-store.js",
    "pocket-sync-private-alpha-gate.js",
    "pocket-sync-production-manifest.js",
    "pocket-sync-production-security-policy.js",
    "pocket-sync-production-server.js",
    "pocket-sync-recovery-proof-verifier.js",
    "pocket-sync-server-config.js",
    "pocket-sync-server-runtime.js",
    "pocket-sync-server.js",
    "pocket-sync-service-core.js",
    "pocket-sync-static-assets.js",
    "pocket-sync-webauthn-verifier.js",
  ]);
});

test("factory requires the exact isolated recovery verifier before any dependency use", () => {
  const harness = createHarness();
  for (const recoveryProofVerifier of [undefined, {}, { verifyRecoveryProof() {}, extra() {} }]) {
    const config = { ...harness.config, recoveryProofVerifier };
    assert.throws(() => serviceModule.createServiceCore(config), errorCode("service-core-invalid"));
  }
  assert.deepEqual(harness.driver.counters(), { transactions: 0, readonly: 0,
    readwrite: 0, commits: 0, rollbacks: 0 });
  assert.deepEqual(harness.calls, { registration: 0, authentication: 0, recovery: 0,
    recoveryDuringTransaction: false, registrationDuringTransaction: false });
});

test("missing key set lists as version zero and list responses contain deterministic metadata only", async () => {
  const harness = createHarness();
  const registered = await registerAndBind(harness);
  const empty = await harness.core.listEnvelopes(call({ apiVersion: 1,
    operationId: "list-empty", syncedPocketId: "pocket-one" }, registered.sessionId));
  assert.deepEqual(empty.body, { apiVersion: 1, ok: true, operationId: "list-empty",
    syncedPocketId: "pocket-one", keySetVersion: 0, recoveryStatus: "unconfigured",
    recoveryVersion: 0, envelopes: [] });
  await harness.core.addEnvelope(call(mutation("add-z", 0,
    { envelope: deviceEnvelope("z-envelope") }), registered.sessionId));
  await harness.core.addEnvelope(call(mutation("add-a", 1,
    { envelope: transferEnvelope("a-envelope") }), registered.sessionId));
  const listed = await harness.core.listEnvelopes(call({ apiVersion: 1,
    operationId: "list-two", syncedPocketId: "pocket-one" }, registered.sessionId));
  assert.deepEqual(listed.body.envelopes.map((item) => item.envelopeId),
    ["a-envelope", "z-envelope"]);
  assert.equal(JSON.stringify(listed).includes("ciphertext"), false);
  assert.equal(JSON.stringify(listed).includes("accountLocator"), false);
  assert.equal(JSON.stringify(listed).includes("verifier"), false);
});

test("add validates envelope kinds, credential ownership, exact ciphertext and durable idempotency", async () => {
  const harness = createHarness();
  const registered = await registerAndBind(harness);
  const request = mutation("add-device", 0, { envelope: deviceEnvelope() });
  const committed = await harness.core.addEnvelope(call(request, registered.sessionId));
  assert.deepEqual(committed.body, { apiVersion: 1, ok: true, status: "committed",
    wrote: true, operationId: "add-device", replayed: false, keySetVersion: 1,
    masterKeyGeneration: 1, masterKeyContentEncryptionLimit: 2 ** 20 });
  const replay = await harness.core.addEnvelope(call({ ...request,
    attemptKind: "idempotent-retry" }, registered.sessionId));
  assert.equal(replay.body.replayed, true);
  await assert.rejects(harness.core.addEnvelope(call(request, registered.sessionId)),
    errorCode("service-operation-reuse"));
  await assert.rejects(harness.core.addEnvelope(call({ ...request,
    attemptKind: "idempotent-retry", envelope: deviceEnvelope("changed") },
  registered.sessionId)), errorCode("service-operation-reuse"));
  await assert.rejects(harness.core.addEnvelope(call(mutation("add-recovery", 1,
    { envelope: recoveryEnvelope() }), registered.sessionId)), errorCode("service-envelope-invalid"));
  await assert.rejects(harness.core.addEnvelope(call(mutation("unsafe-key-version",
    Number.MAX_SAFE_INTEGER, { envelope: transferEnvelope("unsafe-version") }),
  registered.sessionId)), errorCode("service-request-invalid"));
  const malformed = deviceEnvelope("short");
  malformed.encryptedEnvelope = { ...malformed.encryptedEnvelope, ciphertext: b64(47, 3) };
  await assert.rejects(harness.core.addEnvelope(call(mutation("add-short", 1,
    { envelope: malformed }), registered.sessionId)), errorCode("service-envelope-invalid"));
  const prf = { ...transferEnvelope("prf-envelope"), envelopeKind: "passkey-prf",
    credentialId: registered.credentialId };
  await harness.core.addEnvelope(call(mutation("add-prf", 1, { envelope: prf }),
    registered.sessionId));
  const other = { ...prf, envelopeId: "other-prf", credentialId: b64(32, 221) };
  await assert.rejects(harness.core.addEnvelope(call(mutation("add-other-prf", 2,
    { envelope: other }), registered.sessionId)), errorCode("service-authorisation-failed"));
});

test("version conflicts are durable non-writes and first-seen idempotent retry may commit", async () => {
  const harness = createHarness();
  const registered = await registerAndBind(harness);
  await harness.core.addEnvelope(call(mutation("first-retry", 0,
    { attemptKind: "idempotent-retry", envelope: deviceEnvelope() }), registered.sessionId));
  const before = plain(harness.driver.snapshot());
  const request = mutation("stale-add", 0, { envelope: transferEnvelope() });
  const conflict = await harness.core.addEnvelope(call(request, registered.sessionId));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.actualKeySetVersion, 1);
  const after = plain(harness.driver.snapshot());
  assert.deepEqual(after.keySets, before.keySets);
  assert.deepEqual(after.envelopes, before.envelopes);
  const replay = await harness.core.addEnvelope(call({ ...request,
    attemptKind: "idempotent-retry" }, registered.sessionId));
  assert.deepEqual(replay, conflict);
});

test("download returns only active ciphertext and revoke tombstones it without changing Pocket content", async () => {
  const harness = createHarness();
  const registered = await registerAndBind(harness);
  await harness.core.addEnvelope(call(mutation("add-device", 0,
    { envelope: deviceEnvelope() }), registered.sessionId));
  const downloaded = await harness.core.downloadEnvelope(call({ apiVersion: 1,
    operationId: "download-device", syncedPocketId: "pocket-one",
    envelopeId: "device-envelope" }, registered.sessionId));
  assert.deepEqual(downloaded.body.envelope.encryptedEnvelope, encryptedEnvelope(20));
  const pocketBefore = plain(harness.driver.snapshot().pockets);
  await harness.core.revokeEnvelope(call(mutation("revoke-device", 1,
    { envelopeId: "device-envelope" }), registered.sessionId));
  const record = harness.driver.snapshot().envelopes["device-envelope"];
  assert.equal(record.status, "revoked");
  assert.equal(record.encryptedEnvelopeSize, 0);
  assert.equal(record.encryptedEnvelope, null);
  assert.deepEqual(harness.driver.snapshot().pockets, pocketBefore);
  await assert.rejects(harness.core.downloadEnvelope(call({ apiVersion: 1,
    operationId: "download-revoked", syncedPocketId: "pocket-one",
    envelopeId: "device-envelope" }, registered.sessionId)),
  errorCode("service-envelope-revoked"));
});

test("initial recovery atomically stores one locator, verifier and active envelope with replay", async () => {
  const harness = createHarness();
  const registered = await registerAndBind(harness);
  const committed = await initialise(harness, registered.sessionId);
  assert.equal(committed.body.recoveryVersion, 1);
  assert.equal(committed.body.recoveryCopyRequired, true);
  const locator = committed.body.accountLocator;
  const snapshot = harness.driver.snapshot();
  assert.equal(snapshot.keySets["pocket-one"].recoveryStatus, "ready");
  assert.equal(snapshot.keySets["pocket-one"].accountLocator, locator);
  assert.equal(snapshot.recoveryLocators[locator].status, "active");
  assert.equal(snapshot.envelopes["recovery-envelope-1"].encryptedEnvelopeSize, 48);
  const replay = await harness.core.initialiseRecovery(call({ ...mutation("initialise-recovery", 0,
    { recoveryVerifier: recoveryVerifier(1), recoveryEnvelope: recoveryEnvelope(1) }),
  attemptKind: "idempotent-retry" }, registered.sessionId));
  assert.equal(replay.body.accountLocator, locator);
  assert.equal(Object.keys(harness.driver.snapshot().recoveryLocators).length, 1);
  await assert.rejects(harness.core.initialiseRecovery(call(mutation("initialise-again", 1,
    { recoveryVerifier: recoveryVerifier(1), recoveryEnvelope: recoveryEnvelope(1, "other") }),
  registered.sessionId)), errorCode("service-recovery-already-configured"));
});

test("initial recovery failure rolls back and raw-root or package fields fail strict validation", async () => {
  for (const point of FAILURE_POINTS) {
    const harness = createHarness();
    const registered = await registerAndBind(harness);
    const before = plain(harness.driver.snapshot());
    harness.driver.failAt(point);
    await assert.rejects(initialise(harness, registered.sessionId),
      (error) => ["service-storage-failed", "service-transaction-conflict"].includes(error.code));
    assert.deepEqual(harness.driver.snapshot(), before, point);
  }
  const harness = createHarness();
  const registered = await registerAndBind(harness);
  for (const extra of [{ recoveryRoot: b64(32, 2) }, { packageVersion: 1 },
    { rootMaterial: b64(32, 3) }]) {
    await assert.rejects(harness.core.initialiseRecovery(call({ ...mutation("bad-initialise", 0,
      { recoveryVerifier: recoveryVerifier(), recoveryEnvelope: recoveryEnvelope() }), ...extra },
    registered.sessionId)), errorCode("service-request-invalid"));
  }
});

test("begin recovery is unauthenticated, replays exactly, omits secrets and builds valid passkey options", async () => {
  const harness = createHarness();
  const registered = await registerAndBind(harness);
  const initial = await initialise(harness, registered.sessionId);
  const request = { apiVersion: 1, operationId: "recover-one",
    accountLocator: initial.body.accountLocator, deviceId: "device-recovered" };
  const begin = await harness.core.beginRecovery(call(request));
  const replay = await harness.core.beginRecovery(call(request));
  assert.deepEqual(replay, begin);
  assert.equal(begin.body.prfEvaluationInput, registered.begin.body.prfEvaluationInput);
  assert.equal(begin.body.publicKeyCreationOptions.authenticatorSelection.residentKey, "required");
  assert.equal(begin.body.publicKeyCreationOptions.authenticatorSelection.userVerification, "required");
  assert.equal(begin.body.publicKeyCreationOptions.attestation, "none");
  assert.deepEqual(begin.body.publicKeyCreationOptions.excludeCredentials.map((item) => item.id),
    [registered.credentialId]);
  assert.equal(Object.hasOwn(begin.body, "recoveryAuthorisation"), false);
  assert.equal(JSON.stringify(begin).includes("ciphertext"), false);
  const snapshot = harness.driver.snapshot();
  assert.equal(Object.keys(snapshot.credentials).length, 1);
  assert.equal(Object.keys(snapshot.sessions).length, 1);
  await assert.rejects(harness.core.beginRecovery(call({ ...request, deviceId: "changed" })),
    errorCode("service-operation-reuse"));
  await assert.rejects(harness.core.beginRecovery(call({ ...request, operationId: "unknown",
    accountLocator: b64(32, 250) })), errorCode("service-recovery-unavailable"));
});

test("finish recovery verifies outside write transactions and atomically creates one credential/session", async () => {
  const harness = createHarness();
  const registered = await registerAndBind(harness);
  const initial = await initialise(harness, registered.sessionId);
  const recovered = await finishRecoveryFlow(harness, initial.body.accountLocator);
  assert.equal(harness.calls.recovery, 1);
  assert.equal(harness.calls.registration, 2);
  assert.equal(harness.calls.recoveryDuringTransaction, false);
  assert.equal(harness.calls.registrationDuringTransaction, false);
  assert.equal(recovered.finish.body.replacementCopyRequired, true);
  assert.equal(recovered.finish.body.recoveryEnvelope.encryptedEnvelopeSize, 48);
  assert.equal(Object.hasOwn(recovered.finish.body, "contentUnlocked"), false);
  const snapshot = harness.driver.snapshot();
  assert.equal(snapshot.keySets["pocket-one"].recoveryStatus, "rotation-required");
  assert.equal(snapshot.keySets["pocket-one"].recoveryCredentialId, recovered.credential.id);
  assert.equal(Object.keys(snapshot.credentials).length, 2);
  assert.equal(Object.keys(snapshot.sessions).length, 2);
  const ceremony = snapshot.recoveryCeremonies["recover-one"];
  assert.equal(Object.hasOwn(ceremony, "proof"), false);
  assert.equal(Object.hasOwn(ceremony, "credential"), false);
  assert.equal(Object.hasOwn(ceremony, "encryptedEnvelope"), false);
  const replay = await harness.core.finishRecovery(call({ apiVersion: 1,
    operationId: "recover-one", recoveryCeremonyId: recovered.begin.body.recoveryCeremonyId,
    deviceId: "device-recovered", proof: proof(), credential: recovered.credential }));
  assert.equal(replay.session.sessionId, recovered.finish.session.sessionId);
  assert.equal(Object.keys(harness.driver.snapshot().credentials).length, 2);
  await assert.rejects(harness.core.beginRecovery(call({ apiVersion: 1,
    operationId: "recover-two", accountLocator: initial.body.accountLocator,
    deviceId: "another-device" })), errorCode("service-recovery-unavailable"));
});

test("recovery proof failures are stable, non-secret and leave state complete", async () => {
  for (const outcome of [false, "malformed", "throw"]) {
    const harness = createHarness({ verifyRecoveryProof() {
      if (outcome === "throw") throw new Error("secret native proof message");
      if (outcome === false) return { verified: false };
      return { verified: true, extra: true };
    } });
    const registered = await registerAndBind(harness);
    const initial = await initialise(harness, registered.sessionId);
    const begin = await harness.core.beginRecovery(call({ apiVersion: 1,
      operationId: "recover-one", accountLocator: initial.body.accountLocator,
      deviceId: "device-recovered" }));
    const before = plain(harness.driver.snapshot());
    await assert.rejects(harness.core.finishRecovery(call({ apiVersion: 1,
      operationId: "recover-one", recoveryCeremonyId: begin.body.recoveryCeremonyId,
      deviceId: "device-recovered", proof: proof(),
      credential: registrationCredential(b64(32, 141)) })), (error) => {
      assert.equal(error.code, "service-recovery-proof-failed");
      assert.doesNotMatch(error.message, /secret|native/i);
      return true;
    });
    assert.deepEqual(harness.driver.snapshot(), before);
  }
});

test("every injected recovery-finish failure leaves no partial credential, session or consumed version", async () => {
  for (const point of FAILURE_POINTS) {
    const harness = createHarness();
    const registered = await registerAndBind(harness);
    const initial = await initialise(harness, registered.sessionId);
    const begin = await harness.core.beginRecovery(call({ apiVersion: 1,
      operationId: `finish-failure-${point}`, accountLocator: initial.body.accountLocator,
      deviceId: "device-failure" }));
    const before = plain(harness.driver.snapshot());
    harness.driver.failAt(point);
    await assert.rejects(harness.core.finishRecovery(call({ apiVersion: 1,
      operationId: `finish-failure-${point}`,
      recoveryCeremonyId: begin.body.recoveryCeremonyId, deviceId: "device-failure",
      proof: proof(), credential: registrationCredential(b64(32, 144)) })));
    assert.deepEqual(harness.driver.snapshot(), before, point);
  }
});

test("expired ceremonies and changed finish replays fail without consuming recovery", async () => {
  const harness = createHarness();
  const registered = await registerAndBind(harness);
  const initial = await initialise(harness, registered.sessionId);
  const begin = await harness.core.beginRecovery(call({ apiVersion: 1,
    operationId: "expired-recovery", accountLocator: initial.body.accountLocator,
    deviceId: "device-expired" }));
  harness.setTime(NOW + 300001);
  await assert.rejects(harness.core.finishRecovery(call({ apiVersion: 1,
    operationId: "expired-recovery", recoveryCeremonyId: begin.body.recoveryCeremonyId,
    deviceId: "device-expired", proof: proof(),
    credential: registrationCredential(b64(32, 142)) })), errorCode("service-ceremony-expired"));
  assert.equal(harness.driver.snapshot().keySets["pocket-one"].recoveryStatus, "ready");

  const fresh = createHarness();
  const freshRegistered = await registerAndBind(fresh);
  const freshInitial = await initialise(fresh, freshRegistered.sessionId);
  const recovered = await finishRecoveryFlow(fresh, freshInitial.body.accountLocator);
  await assert.rejects(fresh.core.finishRecovery(call({ apiVersion: 1,
    operationId: "recover-one", recoveryCeremonyId: recovered.begin.body.recoveryCeremonyId,
    deviceId: "device-recovered", proof: proof(171), credential: recovered.credential })),
  errorCode("service-operation-reuse"));
  assert.equal(Object.keys(fresh.driver.snapshot().credentials).length, 2);
});

test("concurrent key mutations and recovery finishes cannot commit duplicate state", async () => {
  const driver = createMemoryServiceStore();
  const first = createHarness({ driver });
  const second = createHarness({ driver });
  const registered = await registerAndBind(first);
  const results = await Promise.allSettled([
    first.core.addEnvelope(call(mutation("concurrent-a", 0,
      { envelope: deviceEnvelope("concurrent-a") }), registered.sessionId)),
    second.core.addEnvelope(call(mutation("concurrent-b", 0,
      { envelope: transferEnvelope("concurrent-b") }), registered.sessionId)),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled"
    && item.value.status === 200).length, 1);
  assert.equal(results.filter((item) => item.status === "fulfilled"
    && item.value.status === 409).length, 1);
  assert.equal(Object.values(driver.snapshot().envelopes)
    .filter((item) => item.status === "active").length, 1);

  const recoveryDriver = createMemoryServiceStore();
  const recoveryA = createHarness({ driver: recoveryDriver });
  const recoveryB = createHarness({ driver: recoveryDriver });
  const recoveryRegistration = await registerAndBind(recoveryA);
  const initial = await initialise(recoveryA, recoveryRegistration.sessionId);
  const begin = await recoveryA.core.beginRecovery(call({ apiVersion: 1,
    operationId: "recover-concurrent", accountLocator: initial.body.accountLocator,
    deviceId: "device-concurrent" }));
  const request = { apiVersion: 1, operationId: "recover-concurrent",
    recoveryCeremonyId: begin.body.recoveryCeremonyId, deviceId: "device-concurrent",
    proof: proof(), credential: registrationCredential(b64(32, 143)) };
  const finishes = await Promise.all([
    recoveryA.core.finishRecovery(call(request)), recoveryB.core.finishRecovery(call(request)),
  ]);
  assert.equal(finishes[0].body.credentialId, finishes[1].body.credentialId);
  assert.equal(finishes[0].session.sessionId, finishes[1].session.sessionId);
  assert.equal(Object.keys(recoveryDriver.snapshot().credentials).length, 2);
  assert.equal(Object.keys(recoveryDriver.snapshot().sessions).length, 2);
});

test("rotation requires the recovered credential and atomically invalidates old recovery state", async () => {
  const harness = createHarness();
  const registered = await registerAndBind(harness);
  const initial = await initialise(harness, registered.sessionId);
  const recovered = await finishRecoveryFlow(harness, initial.body.accountLocator);
  const before = harness.driver.snapshot();
  const keySet = before.keySets["pocket-one"];
  const request = mutation("rotate-one", keySet.keySetVersion, {
    recoveryOperationId: "recover-one", expectedRecoveryVersion: 1,
    recoveryVerifier: recoveryVerifier(2, 210),
    recoveryEnvelope: recoveryEnvelope(2, "recovery-envelope-2", 80),
  });
  await assert.rejects(harness.core.rotateRecovery(call(request, registered.sessionId)),
    errorCode("service-authorisation-failed"));
  const rotated = await harness.core.rotateRecovery(call(request,
    recovered.finish.session.sessionId));
  assert.equal(rotated.body.recoveryVersion, 2);
  assert.equal(rotated.body.previousRecoveryInvalidated, true);
  assert.equal(rotated.body.replacementCopyRequired, true);
  assert.notEqual(rotated.body.accountLocator, initial.body.accountLocator);
  const after = harness.driver.snapshot();
  assert.equal(after.keySets["pocket-one"].recoveryStatus, "ready");
  assert.equal(after.keySets["pocket-one"].recoveryVerifier.version, 1);
  assert.equal(after.keySets["pocket-one"].recoveryOperationId, null);
  assert.equal(after.recoveryLocators[initial.body.accountLocator].status, "revoked");
  assert.equal(after.envelopes["recovery-envelope-1"].status, "revoked");
  assert.equal(after.envelopes["recovery-envelope-1"].encryptedEnvelope, null);
  assert.equal(after.envelopes["recovery-envelope-1"].encryptedEnvelopeSize, 0);
  assert.equal(JSON.stringify(after).includes(encryptedEnvelope(41).ciphertext), false);
  await assert.rejects(harness.core.beginRecovery(call({ apiVersion: 1,
    operationId: "old-locator", accountLocator: initial.body.accountLocator,
    deviceId: "old-device" })), errorCode("service-recovery-unavailable"));
  const replay = await harness.core.rotateRecovery(call({ ...request,
    attemptKind: "idempotent-retry" }, recovered.finish.session.sessionId));
  assert.equal(replay.body.accountLocator, rotated.body.accountLocator);
  assert.equal(Object.keys(harness.driver.snapshot().recoveryLocators).length, 2);
  await assert.rejects(harness.core.rotateRecovery(call({ ...request,
    attemptKind: "idempotent-retry", recoveryEnvelope: recoveryEnvelope(2, "changed-envelope") },
  recovered.finish.session.sessionId)), errorCode("service-operation-reuse"));
  await assert.rejects(harness.core.revokeEnvelope(call(mutation("revoke-recovery", 3,
    { envelopeId: "recovery-envelope-2" }), recovered.finish.session.sessionId)),
  errorCode("service-envelope-invalid"));
  await assert.rejects(harness.core.finishRecovery(call({ apiVersion: 1,
    operationId: "recover-one", recoveryCeremonyId: recovered.begin.body.recoveryCeremonyId,
    deviceId: "device-recovered", proof: proof(), credential: recovered.credential })),
  errorCode("service-ceremony-complete"));
});

test("rotation conflicts and injected failures retain the previous complete recovery state", async () => {
  const conflictHarness = createHarness();
  const registered = await registerAndBind(conflictHarness);
  const initial = await initialise(conflictHarness, registered.sessionId);
  const recovered = await finishRecoveryFlow(conflictHarness, initial.body.accountLocator);
  const before = plain(conflictHarness.driver.snapshot());
  const conflict = await conflictHarness.core.rotateRecovery(call(mutation("rotate-conflict", 1, {
    recoveryOperationId: "recover-one", expectedRecoveryVersion: 1,
    recoveryVerifier: recoveryVerifier(2), recoveryEnvelope: recoveryEnvelope(2),
  }), recovered.finish.session.sessionId));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.actualKeySetVersion, 2);
  assert.equal(conflict.body.actualRecoveryVersion, 1);
  const after = conflictHarness.driver.snapshot();
  assert.deepEqual(after.keySets, before.keySets);
  assert.deepEqual(after.envelopes, before.envelopes);
  assert.deepEqual(after.recoveryLocators, before.recoveryLocators);

  for (const point of FAILURE_POINTS) {
    const harness = createHarness();
    const reg = await registerAndBind(harness);
    const init = await initialise(harness, reg.sessionId);
    const rec = await finishRecoveryFlow(harness, init.body.accountLocator);
    const snapshot = plain(harness.driver.snapshot());
    const version = snapshot.keySets["pocket-one"].keySetVersion;
    harness.driver.failAt(point);
    await assert.rejects(harness.core.rotateRecovery(call(mutation(`rotate-${point}`, version, {
      recoveryOperationId: "recover-one", expectedRecoveryVersion: 1,
      recoveryVerifier: recoveryVerifier(2), recoveryEnvelope: recoveryEnvelope(2),
    }), rec.finish.session.sessionId)));
    assert.deepEqual(harness.driver.snapshot(), snapshot, point);
  }
});

test("malformed new records fail closed without repair and only active envelope records hold envelope ciphertext", async () => {
  const harness = createHarness();
  const registered = await registerAndBind(harness);
  await initialise(harness, registered.sessionId);
  const snapshot = harness.driver.snapshot();
  const malformed = { ...snapshot.keySets["pocket-one"], recoveryVersion: 2 };
  harness.driver.unsafeReplaceForTest("keySets", "pocket-one", malformed);
  const before = plain(harness.driver.snapshot());
  await assert.rejects(harness.core.listEnvelopes(call({ apiVersion: 1,
    operationId: "list-malformed", syncedPocketId: "pocket-one" }, registered.sessionId)),
  errorCode("service-state-invalid"));
  assert.deepEqual(harness.driver.snapshot(), before);

  const clean = createHarness();
  const cleanRegistration = await registerAndBind(clean);
  await initialise(clean, cleanRegistration.sessionId);
  const records = clean.driver.snapshot();
  const activeRecovery = records.envelopes["recovery-envelope-1"];
  clean.driver.unsafeReplaceForTest("envelopes", "unlisted-envelope", {
    ...activeRecovery, envelopeId: "unlisted-envelope",
  });
  await assert.rejects(clean.core.downloadEnvelope(call({ apiVersion: 1,
    operationId: "download-unlisted", syncedPocketId: "pocket-one",
    envelopeId: "unlisted-envelope" }, cleanRegistration.sessionId)),
  errorCode("service-state-invalid"));
  for (const [collection, values] of Object.entries(records)) {
    for (const record of Object.values(values)) {
      if (collection === "pockets") continue;
      if (collection === "envelopes" && record.status === "active") continue;
      assert.equal(JSON.stringify(record).includes("ciphertext"), false, collection);
    }
  }
});

test("new service state and errors exclude readable content, raw keys, roots and PRF output", async () => {
  const sentinels = ["READABLE-POCKET-SENTINEL", "RAW-MASTER-KEY-SENTINEL",
    "RAW-RECOVERY-ROOT-SENTINEL", "RAW-PRF-OUTPUT-SENTINEL"];
  const harness = createHarness();
  const registered = await registerAndBind(harness);
  await initialise(harness, registered.sessionId);
  const serialised = JSON.stringify(harness.driver.snapshot());
  sentinels.forEach((sentinel) => assert.doesNotMatch(serialised, new RegExp(sentinel)));
  for (const forbidden of ["recoveryRoot", "masterKey", "prfOutput", "notes", "label"]) {
    await assert.rejects(harness.core.addEnvelope(call({ ...mutation(`bad-${forbidden}`, 1,
      { envelope: transferEnvelope(`env-${forbidden}`) }), [forbidden]: sentinels[0] },
    registered.sessionId)), errorCode("service-request-invalid"));
  }
});

test("production source remains provider-neutral and free of background/browser machinery", () => {
  const text = source("sync-service/pocket-sync-service-core.js");
  for (const forbidden of [/\bfetch\s*\(/, /\.listen\s*\(/, /\bexpress\b/i, /\bfastify\b/i,
    /process\.env/, /localStorage/, /sessionStorage/, /indexedDB/, /setTimeout/, /setInterval/,
    /new Worker/, /console\./, /Authorization/i, /Bearer\s/, /require\(["'](?!node:crypto)/]) {
    assert.doesNotMatch(text, forbidden);
  }
  const packageJson = JSON.parse(source("package.json"));
  assert.deepEqual(packageJson.dependencies, { "@simplewebauthn/server": "13.3.2", pg: "8.22.0" });
  assert.equal(Object.hasOwn(packageJson, "devDependencies"), false);
  assert.equal(Object.keys(packageJson.scripts).some((name) => /p036/i.test(name)), false);
});
