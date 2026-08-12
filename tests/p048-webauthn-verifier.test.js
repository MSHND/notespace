"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const simpleWebAuthn = require("@simplewebauthn/server");
const simpleWebAuthnHelpers = require("@simplewebauthn/server/helpers");
const VERIFIER_PATH = require.resolve("../sync-service/pocket-sync-webauthn-verifier.js");
const { createWebAuthnVerifier } = require(VERIFIER_PATH);
const { createServiceCore } = require("../sync-service/pocket-sync-service-core.js");
const { createMemoryServiceStore } = require("./helpers/p034-memory-service-store.js");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://sync.pocket.example";
const RP_ID = "sync.pocket.example";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function b64(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function registrationCredential(overrides = {}) {
  return {
    id: b64([1, 2, 3]),
    rawId: b64([1, 2, 3]),
    response: {
      clientDataJSON: b64([1]),
      attestationObject: b64([2]),
      publicKey: b64([99]),
      publicKeyAlgorithm: 12345,
      transports: ["usb"],
    },
    clientExtensionResults: { prf: { enabled: true } },
    type: "public-key",
    ...overrides,
  };
}

function authenticationCredential(overrides = {}) {
  return {
    id: b64([1, 2, 3]),
    rawId: b64([1, 2, 3]),
    response: {
      clientDataJSON: b64([1]),
      authenticatorData: b64([2]),
      signature: b64([3]),
    },
    clientExtensionResults: {},
    type: "public-key",
    ...overrides,
  };
}

function registrationInput(overrides = {}) {
  return {
    trustedOrigin: ORIGIN,
    rpId: RP_ID,
    challenge: b64(Buffer.alloc(32, 7)),
    publicKeyCreationOptions: { challenge: b64(Buffer.alloc(32, 7)), rp: { id: RP_ID, name: "Pocket" } },
    credential: registrationCredential(),
    ...overrides,
  };
}

function authenticationInput(overrides = {}) {
  return {
    trustedOrigin: ORIGIN,
    rpId: RP_ID,
    challenge: b64(Buffer.alloc(32, 8)),
    publicKeyRequestOptions: { challenge: b64(Buffer.alloc(32, 8)), rpId: RP_ID },
    credential: authenticationCredential(),
    storedCredential: {
      credentialId: b64([1, 2, 3]),
      publicKey: b64([9, 8, 7]),
      signCount: 4,
      transports: ["internal"],
      backupEligible: true,
    },
    ...overrides,
  };
}

async function withLibrary(library, helpers, callback) {
  const originalLoad = Module._load;
  const originalVerifier = require.cache[VERIFIER_PATH];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "@simplewebauthn/server") return library;
    if (request === "@simplewebauthn/server/helpers") return helpers;
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[VERIFIER_PATH];
  try {
    return await callback(require(VERIFIER_PATH).createWebAuthnVerifier);
  } finally {
    Module._load = originalLoad;
    require.cache[VERIFIER_PATH] = originalVerifier;
  }
}

async function withControlledLibrary(control, callback) {
  return withLibrary(
    Object.freeze({
      verifyRegistrationResponse: control.verifyRegistrationResponse,
      verifyAuthenticationResponse: control.verifyAuthenticationResponse,
    }),
    Object.freeze({
      decodeCredentialPublicKey: control.decodeCredentialPublicKey,
      cose: Object.freeze({ COSEKEYS: Object.freeze({ alg: 3 }) }),
    }),
    callback,
  );
}

function controlledResults(calls) {
  return {
    async verifyRegistrationResponse(options) {
      calls.registration.push(options);
      if (options.expectedChallenge !== b64(Buffer.alloc(32, 7))
          || options.expectedOrigin !== ORIGIN
          || options.expectedRPID !== RP_ID
          || options.requireUserVerification !== true) {
        throw new Error("unexpected trusted registration values");
      }
      return {
        verified: true,
        registrationInfo: {
          userVerified: true,
          credential: { id: b64([1, 2, 3]), publicKey: new Uint8Array([9, 8, 7]), counter: 4, transports: ["internal"] },
          credentialDeviceType: "multiDevice",
          credentialBackedUp: true,
        },
      };
    },
    async verifyAuthenticationResponse(options) {
      calls.authentication.push(options);
      if (options.expectedChallenge !== b64(Buffer.alloc(32, 8))
          || options.expectedOrigin !== ORIGIN
          || options.expectedRPID !== RP_ID
          || options.requireUserVerification !== true) {
        throw new Error("unexpected trusted authentication values");
      }
      return {
        verified: true,
        authenticationInfo: {
          credentialID: b64([1, 2, 3]),
          newCounter: 5,
          userVerified: true,
          credentialDeviceType: "multiDevice",
          credentialBackedUp: false,
        },
      };
    },
    decodeCredentialPublicKey(publicKey) {
      calls.publicKeys.push(Array.from(publicKey));
      return new Map([[3, -7]]);
    },
  };
}

test("P048 exports only a frozen server verifier surface with the reviewed dependency", () => {
  const module = require("../sync-service/pocket-sync-webauthn-verifier.js");
  assert.deepEqual(Object.keys(module), ["createWebAuthnVerifier"]);
  assert.equal(Object.isFrozen(module), true);
  const verifier = createWebAuthnVerifier();
  assert.deepEqual(Object.keys(verifier), ["verifyRegistration", "verifyAuthentication"]);
  assert.equal(Object.isFrozen(verifier), true);
  assert.match(source("package.json"), /"@simplewebauthn\/server": "13\.3\.2"/);
  assert.match(source("package-lock.json"), /"version": "13\.3\.2"/);
  const production = source("sync-service/pocket-sync-webauthn-verifier.js");
  assert.match(production, /require\("@simplewebauthn\/server"\)/);
  assert.doesNotMatch(production, /process\.env|console\.|neon|supabase|aws|rds|vercel|retry|prf.*result|derive|crypto/i);
  assert.doesNotMatch(source("index.html"), /pocket-sync-webauthn-verifier/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-webauthn-verifier/);
  assert.doesNotMatch(source("js/pocket-sync-account-client.js"), /simplewebauthn\/server/i);
});

test("P048 binds registration and authentication to core-trusted values and verified results", async () => {
  const calls = { registration: [], authentication: [], publicKeys: [] };
  await withControlledLibrary(controlledResults(calls), async (createControlledVerifier) => {
    const verifier = createControlledVerifier();
    const registered = await verifier.verifyRegistration(registrationInput());
    assert.deepEqual(registered, {
      credentialId: b64([1, 2, 3]), publicKey: b64([9, 8, 7]), publicKeyAlgorithm: -7,
      signCount: 4, transports: ["internal"], backupEligible: true, backedUp: true,
    });
    assert.equal(Object.keys(registered).length, 7);
    assert.deepEqual(calls.registration[0], {
      response: registrationInput().credential,
      expectedChallenge: b64(Buffer.alloc(32, 7)),
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
    assert.deepEqual(calls.publicKeys[0], [9, 8, 7]);

    const authenticated = await verifier.verifyAuthentication(authenticationInput());
    assert.deepEqual(authenticated, { credentialId: b64([1, 2, 3]), signCount: 5, backedUp: false });
    assert.deepEqual(calls.authentication[0].credential, {
      id: b64([1, 2, 3]), publicKey: new Uint8Array([9, 8, 7]), counter: 4, transports: ["internal"],
    });
    assert.equal(Object.keys(authenticated).length, 3);

    await assert.rejects(verifier.verifyRegistration(registrationInput({ challenge: "wrong" })), (error) => error && error.code === "webauthn-verification-failed");
    await assert.rejects(verifier.verifyAuthentication(authenticationInput({ trustedOrigin: "https://wrong.example" })), (error) => error && error.code === "webauthn-verification-failed");
    await assert.rejects(verifier.verifyAuthentication(authenticationInput({ rpId: "wrong.example" })), (error) => error && error.code === "webauthn-verification-failed");
  });
});

test("P048 rejects inconsistent backup eligibility and never trusts claimed credential key fields", async () => {
  const calls = { registration: [], authentication: [], publicKeys: [] };
  const controlled = controlledResults(calls);
  controlled.verifyAuthenticationResponse = async () => ({
    verified: true,
    authenticationInfo: {
      credentialID: b64([1, 2, 3]), newCounter: 5, userVerified: true,
      credentialDeviceType: "singleDevice", credentialBackedUp: false,
    },
  });
  await withControlledLibrary(controlled, async (createControlledVerifier) => {
    const verifier = createControlledVerifier();
    await assert.rejects(verifier.verifyAuthentication(authenticationInput()), (error) => error && error.code === "webauthn-verification-failed");
  });
});

test("P048 invokes the actual installed library for invalid WebAuthn input and exposes only a safe failure", async () => {
  let invoked = 0;
  await withLibrary(Object.freeze({
    async verifyRegistrationResponse(options) {
      invoked += 1;
      return simpleWebAuthn.verifyRegistrationResponse(options);
    },
    verifyAuthenticationResponse: simpleWebAuthn.verifyAuthenticationResponse,
  }), simpleWebAuthnHelpers, async (createObservedVerifier) => {
    const verifier = createObservedVerifier();
    let error;
    await assert.rejects(verifier.verifyRegistration(registrationInput({ credential: registrationCredential({ id: "bad", rawId: "bad" }) })), (value) => {
      error = value;
      return value && value.code === "webauthn-verification-failed";
    });
    assert.equal(error.message.includes("bad"), false);
  });
  assert.equal(invoked, 1);
});

test("P048 real-library failures leave the service core without a credential or session", async () => {
  const driver = createMemoryServiceStore();
  let invoked = 0;
  await withLibrary(Object.freeze({
    async verifyRegistrationResponse(options) {
      invoked += 1;
      return simpleWebAuthn.verifyRegistrationResponse(options);
    },
    verifyAuthenticationResponse: simpleWebAuthn.verifyAuthenticationResponse,
  }), simpleWebAuthnHelpers, async (createObservedVerifier) => {
    const core = createServiceCore({
      store: driver.store,
      webAuthnVerifier: createObservedVerifier(),
      recoveryProofVerifier: Object.freeze({ async verifyRecoveryProof() { return { verified: true }; } }),
      randomBytes(length) { return Uint8Array.from({ length }, () => 7); },
      now: () => Date.parse("2032-01-01T00:00:00.000Z"),
      trustedOrigin: ORIGIN, rpId: RP_ID, rpName: "Pocket", credentialAlgorithms: [-7],
      ceremonyLifetimeMs: 300000, sessionLifetimeMs: 2592000000,
    });
    const context = { method: "POST", origin: ORIGIN, fetchSite: "same-origin", contentType: "application/json", sessionId: null };
    const begin = await core.beginRegistration({ context, body: {
      apiVersion: 1, operationId: "invalid-register-operation", accountIntent: "create-or-add-credential", deviceId: "device-opaque",
    } });
    await assert.rejects(core.finishRegistration({ context, body: {
      apiVersion: 1, operationId: "invalid-register-operation", ceremonyId: begin.body.ceremonyId,
      deviceId: "device-opaque", credential: registrationCredential(),
    } }), (error) => error && error.code === "service-webauthn-failed");
  });
  const snapshot = driver.snapshot();
  assert.equal(invoked, 1);
  assert.deepEqual(Object.keys(snapshot.accounts), []);
  assert.deepEqual(Object.keys(snapshot.credentials), []);
  assert.deepEqual(Object.keys(snapshot.sessions), []);
});

test("P048 adapter works through the unchanged service core registration boundary", async () => {
  const calls = { registration: [], authentication: [], publicKeys: [] };
  await withControlledLibrary(controlledResults(calls), async (createControlledVerifier) => {
    const driver = createMemoryServiceStore();
    const core = createServiceCore({
      store: driver.store,
      webAuthnVerifier: createControlledVerifier(),
      recoveryProofVerifier: Object.freeze({ async verifyRecoveryProof() { return { verified: true }; } }),
      randomBytes(length) { return Uint8Array.from({ length }, () => 7); },
      now: () => Date.parse("2032-01-01T00:00:00.000Z"),
      trustedOrigin: ORIGIN, rpId: RP_ID, rpName: "Pocket", credentialAlgorithms: [-7],
      ceremonyLifetimeMs: 300000, sessionLifetimeMs: 2592000000,
    });
    const context = { method: "POST", origin: ORIGIN, fetchSite: "same-origin", contentType: "application/json", sessionId: null };
    const begin = await core.beginRegistration({ context, body: {
      apiVersion: 1, operationId: "register-operation", accountIntent: "create-or-add-credential", deviceId: "device-opaque",
    } });
    const finish = await core.finishRegistration({ context, body: {
      apiVersion: 1, operationId: "register-operation", ceremonyId: begin.body.ceremonyId,
      deviceId: "device-opaque", credential: registrationCredential(),
    } });
    assert.equal(finish.status, 200);
    assert.equal(driver.snapshot().credentials[b64([1, 2, 3])].publicKeyAlgorithm, -7);
  });
});

test("P048 has one registration verifier path for ordinary and recovery-shaped ceremonies", async () => {
  const calls = { registration: [], authentication: [], publicKeys: [] };
  await withControlledLibrary(controlledResults(calls), async (createControlledVerifier) => {
    const verifier = createControlledVerifier();
    await verifier.verifyRegistration(registrationInput());
    await verifier.verifyRegistration(registrationInput({ publicKeyCreationOptions: {
      challenge: b64(Buffer.alloc(32, 7)), rp: { id: RP_ID, name: "Pocket recovery" }, user: { id: b64([4]), name: "recovery", displayName: "recovery" },
    } }));
    assert.equal(calls.registration.length, 2);
    assert.equal(calls.registration.every((call) => call.requireUserVerification === true), true);
  });
});
