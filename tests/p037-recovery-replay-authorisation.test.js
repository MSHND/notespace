"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const serviceModule = require("../sync-service/pocket-sync-service-core.js");
const { createMemoryServiceStore } = require("./helpers/p034-memory-service-store.js");

const ORIGIN = "https://sync.pocket.example";
const NOW = Date.parse("2034-01-01T00:00:00.000Z");
const METHODS = Object.freeze([
  "beginRegistration", "finishRegistration", "beginAuthentication", "finishAuthentication",
  "readRevision", "downloadEncryptedRecord", "conditionalUpload", "listEnvelopes",
  "downloadEnvelope", "addEnvelope", "revokeEnvelope", "initialiseRecovery",
  "beginRecovery", "finishRecovery", "rotateRecovery",
]);

function bytes(length, seed = 1) {
  return Uint8Array.from({ length }, (_value, index) => (seed + index) & 255);
}

function b64(length, seed = 1) {
  return Buffer.from(bytes(length, seed)).toString("base64url");
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function context(sessionId = null) {
  return {
    method: "POST",
    origin: ORIGIN,
    fetchSite: "same-origin",
    contentType: "application/json",
    sessionId,
  };
}

function call(body, sessionId = null) {
  return { context: context(sessionId), body };
}

function registrationCredential(id) {
  return {
    id,
    rawId: id,
    response: {
      clientDataJSON: b64(17, 2),
      attestationObject: b64(24, 4),
      authenticatorData: b64(19, 6),
      transports: ["internal"],
      publicKey: b64(23, 8),
      publicKeyAlgorithm: -7,
    },
    authenticatorAttachment: "platform",
    clientExtensionResults: { prf: { enabled: true } },
    type: "public-key",
  };
}

function contentRecord() {
  return {
    format: "pocket.sync.content.opaque",
    version: 1,
    algorithm: "AES-GCM-256",
    nonce: b64(12, 21),
    ciphertext: b64(32, 41),
  };
}

function encryptedEnvelope(version) {
  return {
    format: "pocket.sync.master-key-envelope.opaque",
    version: 1,
    algorithm: "AES-GCM-256",
    nonce: b64(12, 51 + version),
    ciphertext: b64(48, 71 + version),
  };
}

function recoveryVerifier(_version) {
  return {
    version: 1,
    algorithm: "Ed25519",
    publicKeyFormat: "spki",
    publicKey: b64(32, 121),
  };
}

function recoveryEnvelope(version) {
  return {
    envelopeId: `recovery-envelope-${version}`,
    envelopeKind: "recovery",
    envelopeVersion: version,
    deviceId: null,
    credentialId: null,
    kdf: "HKDF-SHA-256",
    kdfSalt: b64(32, 151 + version),
    derivationVersion: 1,
    encryptedEnvelope: encryptedEnvelope(version),
  };
}

function recoveryProof() {
  return {
    version: 1,
    algorithm: "Ed25519",
    signature: b64(64, 181),
  };
}

function createHarness() {
  const driver = createMemoryServiceStore();
  let randomCall = 0;
  const core = serviceModule.createServiceCore({
    store: driver.store,
    webAuthnVerifier: Object.freeze({
      async verifyRegistration(input) {
        return {
          credentialId: input.credential.id,
          publicKey: b64(64, 201),
          publicKeyAlgorithm: -7,
          signCount: 0,
          transports: ["internal"],
          backupEligible: true,
          backedUp: false,
        };
      },
      async verifyAuthentication(input) {
        return {
          credentialId: input.credential.id,
          signCount: input.storedCredential.signCount + 1,
          backedUp: true,
        };
      },
    }),
    recoveryProofVerifier: Object.freeze({
      async verifyRecoveryProof() {
        return { verified: true };
      },
    }),
    randomBytes(length) {
      randomCall += 1;
      return bytes(length, randomCall * 17);
    },
    now: () => NOW,
    trustedOrigin: ORIGIN,
    rpId: "sync.pocket.example",
    rpName: "Pocket",
    credentialAlgorithms: Object.freeze([-7]),
    ceremonyLifetimeMs: 300000,
    sessionLifetimeMs: 2592000000,
  });
  return { core, driver };
}

async function prepareRotatedRecovery() {
  const harness = createHarness();
  const originalCredential = registrationCredential(b64(32, 11));
  const registrationBegin = await harness.core.beginRegistration(call({
    apiVersion: 1,
    operationId: "register-original",
    accountIntent: "create-or-add-credential",
    deviceId: "device-original",
  }));
  const registrationFinish = await harness.core.finishRegistration(call({
    apiVersion: 1,
    operationId: "register-original",
    ceremonyId: registrationBegin.body.ceremonyId,
    deviceId: "device-original",
    credential: originalCredential,
  }));
  const originalSessionId = registrationFinish.session.sessionId;
  await harness.core.conditionalUpload(call({
    apiVersion: 1,
    syncedPocketId: "pocket-one",
    expectedRevision: 0,
    operationId: "upload-one",
    logicalChangeId: "upload-one-change",
    attemptKind: "new-change",
    encryptedRecord: contentRecord(),
  }, originalSessionId));
  const initialised = await harness.core.initialiseRecovery(call({
    apiVersion: 1,
    operationId: "initialise-recovery",
    logicalChangeId: "initialise-recovery-change",
    attemptKind: "new-change",
    syncedPocketId: "pocket-one",
    expectedKeySetVersion: 0,
    recoveryVerifier: recoveryVerifier(1),
    recoveryEnvelope: recoveryEnvelope(1),
  }, originalSessionId));
  const recoveryBegin = await harness.core.beginRecovery(call({
    apiVersion: 1,
    operationId: "recover-one",
    accountLocator: initialised.body.accountLocator,
    deviceId: "device-recovered",
  }));
  const recoveredCredential = registrationCredential(b64(32, 31));
  const recoveryFinish = await harness.core.finishRecovery(call({
    apiVersion: 1,
    operationId: "recover-one",
    recoveryCeremonyId: recoveryBegin.body.recoveryCeremonyId,
    deviceId: "device-recovered",
    proof: recoveryProof(),
    credential: recoveredCredential,
  }));
  const recoveredSessionId = recoveryFinish.session.sessionId;
  const rotationRequest = {
    apiVersion: 1,
    operationId: "rotate-one",
    logicalChangeId: "rotate-one-change",
    attemptKind: "new-change",
    recoveryOperationId: "recover-one",
    syncedPocketId: "pocket-one",
    expectedKeySetVersion: recoveryFinish.body.keySetVersion,
    expectedRecoveryVersion: 1,
    recoveryVerifier: recoveryVerifier(2),
    recoveryEnvelope: recoveryEnvelope(2),
  };
  const rotated = await harness.core.rotateRecovery(call(rotationRequest, recoveredSessionId));
  return {
    ...harness,
    originalCredential,
    originalSessionId,
    recoveredCredential,
    recoveredSessionId,
    rotationRequest,
    rotated,
  };
}

test("rotation replay rejects another active account credential before revealing its stored result", async () => {
  const prepared = await prepareRotatedRecovery();
  const snapshot = plain(prepared.driver.snapshot());
  const retry = { ...prepared.rotationRequest, attemptKind: "idempotent-retry" };
  let rejected;
  await assert.rejects(
    prepared.core.rotateRecovery(call(retry, prepared.originalSessionId)),
    (error) => {
      rejected = error;
      return error && error.code === "service-authorisation-failed";
    }
  );
  const exposed = JSON.stringify({
    code: rejected.code,
    status: rejected.status,
    message: rejected.message,
    retryable: rejected.retryable,
    clearSession: rejected.clearSession,
  });
  for (const secret of [
    prepared.rotated.body.accountLocator,
    retry.recoveryOperationId,
    prepared.recoveredCredential.id,
    prepared.recoveredSessionId,
    retry.recoveryEnvelope.encryptedEnvelope.ciphertext,
  ]) assert.equal(exposed.includes(secret), false);
  assert.deepEqual(prepared.driver.snapshot(), snapshot);
});

test("the recovered credential replays the exact rotation without creating or changing state", async () => {
  const prepared = await prepareRotatedRecovery();
  const before = plain(prepared.driver.snapshot());
  const retry = { ...prepared.rotationRequest, attemptKind: "idempotent-retry" };
  const replay = await prepared.core.rotateRecovery(call(retry, prepared.recoveredSessionId));
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.accountLocator, prepared.rotated.body.accountLocator);
  assert.equal(replay.body.recoveryVersion, prepared.rotated.body.recoveryVersion);
  assert.equal(replay.body.keySetVersion, prepared.rotated.body.keySetVersion);
  assert.deepEqual(prepared.driver.snapshot(), before);
  for (const collection of [
    "keyOperations", "recoveryLocators", "envelopes", "credentials", "sessions",
  ]) {
    assert.equal(
      Object.keys(prepared.driver.snapshot()[collection]).length,
      Object.keys(before[collection]).length,
      collection
    );
  }
  await assert.rejects(prepared.core.rotateRecovery(call({
    ...retry,
    recoveryEnvelope: { ...retry.recoveryEnvelope, envelopeId: "changed-envelope" },
  }, prepared.recoveredSessionId)), (error) => error && error.code === "service-operation-reuse");
});

test("unknown, pending, malformed and foreign completed recovery ceremonies cannot authorise replay", async () => {
  const cases = ["unknown", "pending", "malformed", "other-account", "other-pocket"];
  for (const kind of cases) {
    const prepared = await prepareRotatedRecovery();
    const snapshot = prepared.driver.snapshot();
    const completed = snapshot.recoveryCeremonies["recover-one"];
    const operationId = `${kind}-recovery`;
    if (kind === "pending") {
      prepared.driver.unsafeReplaceForTest("recoveryCeremonies", operationId, {
        ...completed,
        operationId,
        storeVersion: 1,
        finishDigest: null,
        completedCredentialId: null,
        completedSessionId: null,
        completedKeySetVersion: null,
      });
    } else if (kind === "malformed") {
      prepared.driver.unsafeReplaceForTest("recoveryCeremonies", operationId, {
        ...completed,
        operationId,
        unexpected: true,
      });
    } else if (kind === "other-account") {
      prepared.driver.unsafeReplaceForTest("recoveryCeremonies", operationId, {
        ...completed,
        operationId,
        accountId: "other-account",
        publicKeyCreationOptions: {
          ...completed.publicKeyCreationOptions,
          user: {
            ...completed.publicKeyCreationOptions.user,
            name: "other-account",
            displayName: "other-account",
          },
        },
      });
    } else if (kind === "other-pocket") {
      prepared.driver.unsafeReplaceForTest("recoveryCeremonies", operationId, {
        ...completed,
        operationId,
        syncedPocketId: "other-pocket",
      });
    }
    const before = plain(prepared.driver.snapshot());
    const retry = {
      ...prepared.rotationRequest,
      attemptKind: "idempotent-retry",
      recoveryOperationId: operationId,
    };
    await assert.rejects(
      prepared.core.rotateRecovery(call(retry, prepared.recoveredSessionId)),
      (error) => error && (kind === "other-account" || kind === "other-pocket"
        ? error.code === "service-authorisation-failed"
        : error.code === "service-state-invalid")
    );
    assert.deepEqual(prepared.driver.snapshot(), before, kind);
  }
});

test("P037 preserves the frozen module exports and fifteen-method service surface", () => {
  assert.deepEqual(Object.keys(serviceModule), ["POLICY", "COLLECTIONS", "createServiceCore"]);
  assert.equal(Object.isFrozen(serviceModule), true);
  const harness = createHarness();
  assert.deepEqual(Object.keys(harness.core), METHODS);
  assert.equal(Object.isFrozen(harness.core), true);
});
