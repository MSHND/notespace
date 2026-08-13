"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { webcrypto } = require("node:crypto");
const { createRecoveryProofVerifier } = require("../sync-service/pocket-sync-recovery-proof-verifier.js");

const ROOT = path.resolve(__dirname, "..");
const DOMAIN = "pocket.sync.recovery-authorisation.v1";

function source(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }

async function keyPair() {
  const pair = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  return {
    privateKey: pair.privateKey,
    publicVerifier: {
      version: 1,
      algorithm: "Ed25519",
      publicKeyFormat: "spki",
      publicKey: Buffer.from(await webcrypto.subtle.exportKey("spki", pair.publicKey)).toString("base64url"),
    },
  };
}

async function proof(privateKey, input) {
  const transcript = Buffer.from(JSON.stringify([
    DOMAIN, 1, input.recoveryCeremonyId, input.operationId, input.challenge,
    input.syncedPocketId, input.deviceId, input.recoveryVersion, input.keySetVersion,
    input.expiresAt, input.credentialDigest,
  ]));
  return { version: 1, algorithm: "Ed25519", signature: Buffer.from(
    await webcrypto.subtle.sign("Ed25519", privateKey, transcript)
  ).toString("base64url") };
}

test("P050 production verifier is Ed25519 verify-only and rejects every bound transcript alteration", async () => {
  const first = await keyPair();
  const other = await keyPair();
  const credentialDigest = Buffer.from(await webcrypto.subtle.digest("SHA-256",
    Buffer.from(JSON.stringify(["pocket.sync.recovery-credential.v1", { id: "credential-p050" }]))
  )).toString("base64url");
  const input = {
    recoveryCeremonyId: "ceremony-p050", operationId: "operation-p050", challenge: "challenge-p050",
    syncedPocketId: "pocket-p050", deviceId: "device-p050", recoveryVersion: 2,
    keySetVersion: 7, expiresAt: "2042-01-01T00:05:00.000Z", credentialDigest,
  };
  const verifier = createRecoveryProofVerifier();
  assert.deepEqual(await verifier.assertSupported(), { supported: true });
  assert.deepEqual(Object.keys(verifier), ["verifyRecoveryProof"]);
  const valid = { ...input, storedVerifier: first.publicVerifier, proof: await proof(first.privateKey, input) };
  assert.deepEqual(await verifier.verifyRecoveryProof(valid), { verified: true });
  const wrongKey = { ...valid, proof: await proof(other.privateKey, input) };
  await assert.rejects(verifier.verifyRecoveryProof(wrongKey), { code: "service-recovery-proof-failed" });
  for (const [field, value] of Object.entries({
    recoveryCeremonyId: "ceremony-other", operationId: "operation-other", challenge: "challenge-other",
    syncedPocketId: "pocket-other", deviceId: "device-other", recoveryVersion: 3,
    keySetVersion: 8, expiresAt: "2042-01-01T00:06:00.000Z",
    credentialDigest: Buffer.alloc(32, 9).toString("base64url"),
  })) {
    await assert.rejects(verifier.verifyRecoveryProof({ ...valid, [field]: value }),
      { code: "service-recovery-proof-failed" }, field);
  }
  assert.doesNotMatch(source("sync-service/pocket-sync-recovery-proof-verifier.js"), /subtle\.sign/);
  assert.doesNotMatch(JSON.stringify(valid), /privateKey|rootMaterial|recoveryPackage/);
});
