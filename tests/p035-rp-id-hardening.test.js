"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serviceModule = require("../sync-service/pocket-sync-service-core.js");

const ROOT = path.resolve(__dirname, "..");
const METHOD_NAMES = Object.freeze([
  "beginRegistration",
  "finishRegistration",
  "beginAuthentication",
  "finishAuthentication",
  "readSyncedPocket",
  "readRevision",
  "downloadEncryptedRecord",
  "conditionalUpload",
  "listEnvelopes",
  "downloadEnvelope",
  "addEnvelope",
  "revokeEnvelope",
  "initialiseRecovery",
  "beginRecovery",
  "finishRecovery",
  "rotateRecovery",
]);

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function errorCode(code) {
  return (error) => error && error.code === code;
}

function configuration(overrides = {}) {
  const calls = {
    store: 0,
    random: 0,
    clock: 0,
    registrationVerifier: 0,
    authenticationVerifier: 0,
    recoveryVerifier: 0,
  };
  const value = {
    store: Object.freeze({
      async transact() {
        calls.store += 1;
        throw new Error("store must not be called during factory creation");
      },
    }),
    webAuthnVerifier: Object.freeze({
      async verifyRegistration() {
        calls.registrationVerifier += 1;
        throw new Error("verifier must not be called during factory creation");
      },
      async verifyAuthentication() {
        calls.authenticationVerifier += 1;
        throw new Error("verifier must not be called during factory creation");
      },
    }),
    recoveryProofVerifier: Object.freeze({
      async verifyRecoveryProof() {
        calls.recoveryVerifier += 1;
        throw new Error("verifier must not be called during factory creation");
      },
    }),
    randomBytes(length) {
      calls.random += 1;
      return new Uint8Array(length);
    },
    now() {
      calls.clock += 1;
      return Date.parse("2032-01-01T00:00:00.000Z");
    },
    trustedOrigin: "https://sync.pocket.example",
    rpId: "sync.pocket.example",
    rpName: "Pocket",
    credentialAlgorithms: Object.freeze([-7]),
    ceremonyLifetimeMs: 5 * 60 * 1000,
    sessionLifetimeMs: 30 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
  return { value, calls };
}

test("production service core keeps its exact frozen export and method surfaces", () => {
  assert.deepEqual(Object.keys(serviceModule), ["POLICY", "COLLECTIONS", "createServiceCore"]);
  assert.equal(Object.isFrozen(serviceModule), true);
  const setup = configuration();
  const core = serviceModule.createServiceCore(setup.value);
  assert.deepEqual(Object.keys(core), METHOD_NAMES);
  assert.equal(Object.isFrozen(core), true);
  assert.deepEqual(setup.calls, {
    store: 0,
    random: 0,
    clock: 0,
    registrationVerifier: 0,
    authenticationVerifier: 0,
    recoveryVerifier: 0,
  });
});

test("version 1 accepts only the exact trusted-origin hostname, including origins with ports", () => {
  const ordinary = configuration();
  assert.doesNotThrow(() => serviceModule.createServiceCore(ordinary.value));

  const port = configuration({
    trustedOrigin: "https://sync.pocket.example:8443",
    rpId: "sync.pocket.example",
  });
  assert.doesNotThrow(() => serviceModule.createServiceCore(port.value));
  assert.deepEqual(port.calls, {
    store: 0,
    random: 0,
    clock: 0,
    registrationVerifier: 0,
    authenticationVerifier: 0,
    recoveryVerifier: 0,
  });
});

test("parent, public, sibling, non-canonical and URL-like RP IDs fail before any dependency", () => {
  const rejected = [
    "pocket.example",
    "example",
    "com",
    "sibling.pocket.example",
    "unrelated.example",
    "sync.pocket.example.",
    "SYNC.pocket.example",
    " sync.pocket.example",
    "sync.pocket.example ",
    "https://sync.pocket.example",
    "sync.pocket.example:8443",
    "sync.pocket.example/path",
    "sync.pocket.example?query=1",
    "sync.pocket.example#fragment",
    "user@sync.pocket.example",
  ];
  for (const rpId of rejected) {
    const setup = configuration({ rpId });
    assert.throws(
      () => serviceModule.createServiceCore(setup.value),
      errorCode("service-core-invalid"),
      rpId
    );
    assert.deepEqual(setup.calls, {
      store: 0,
      random: 0,
      clock: 0,
      registrationVerifier: 0,
      authenticationVerifier: 0,
      recoveryVerifier: 0,
    }, rpId);
  }
  const trailingOrigin = configuration({
    trustedOrigin: "https://sync.pocket.example.",
    rpId: "sync.pocket.example.",
  });
  assert.throws(
    () => serviceModule.createServiceCore(trailingOrigin.value),
    errorCode("service-core-invalid")
  );
  assert.deepEqual(trailingOrigin.calls, {
    store: 0,
    random: 0,
    clock: 0,
    registrationVerifier: 0,
    authenticationVerifier: 0,
    recoveryVerifier: 0,
  });
});

test("P035 adds no browser loader or P035 package script", () => {
  assert.doesNotMatch(source("index.html"), /pocket-sync-service-core|p035-rp-id/i);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-service-core|p035-rp-id/i);
  const packageJson = JSON.parse(source("package.json"));
  assert.deepEqual(packageJson.dependencies, { "@simplewebauthn/server": "13.3.2", pg: "8.22.0" });
  assert.equal(Object.hasOwn(packageJson, "devDependencies"), false);
  assert.equal(Object.keys(packageJson.scripts).some((name) => /p035/i.test(name)), false);
});
