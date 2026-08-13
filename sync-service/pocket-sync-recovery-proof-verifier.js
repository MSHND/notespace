"use strict";

const { webcrypto } = require("node:crypto");

const DOMAIN = "pocket.sync.recovery-authorisation.v1";
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function proofError() {
  const error = new Error("Pocket Sync recovery proof failed.");
  error.code = "service-recovery-proof-failed";
  return error;
}

function bytes(value, minimum, maximum) {
  if (typeof value !== "string" || !BASE64URL.test(value) || value.length % 4 === 1) throw proofError();
  let output;
  try { output = new Uint8Array(Buffer.from(value, "base64url")); }
  catch (_error) { throw proofError(); }
  if (output.byteLength < minimum || output.byteLength > maximum
      || Buffer.from(output).toString("base64url") !== value) {
    output.fill(0);
    throw proofError();
  }
  return output;
}

function identifier(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 160 || value !== value.trim()) {
    throw proofError();
  }
  return value;
}

function exact(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== fields.length
      || fields.some((field) => !Object.hasOwn(value, field))) throw proofError();
  return value;
}

function verifier(input) {
  const value = exact(input, ["version", "algorithm", "publicKeyFormat", "publicKey"]);
  if (value.version !== 1 || value.algorithm !== "Ed25519" || value.publicKeyFormat !== "spki") {
    throw proofError();
  }
  return value;
}

function transcript(input) {
  const value = exact(input, ["recoveryCeremonyId", "operationId", "challenge", "syncedPocketId", "deviceId",
    "recoveryVersion", "keySetVersion", "expiresAt", "credentialDigest"]);
  ["recoveryCeremonyId", "operationId", "challenge", "syncedPocketId", "deviceId"].forEach(
    (field) => identifier(value[field])
  );
  if (!Number.isSafeInteger(value.recoveryVersion) || value.recoveryVersion < 1
      || !Number.isSafeInteger(value.keySetVersion) || value.keySetVersion < 1
      || typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))) throw proofError();
  const digest = bytes(value.credentialDigest, 32, 32);
  try {
    return Buffer.from(JSON.stringify([DOMAIN, 1, value.recoveryCeremonyId, value.operationId,
      value.challenge, value.syncedPocketId, value.deviceId, value.recoveryVersion,
      value.keySetVersion, value.expiresAt, value.credentialDigest]));
  } finally { digest.fill(0); }
}

function createRecoveryProofVerifier() {
  if (!webcrypto?.subtle || typeof webcrypto.subtle.importKey !== "function"
      || typeof webcrypto.subtle.verify !== "function") throw proofError();
  return Object.freeze({
    async verifyRecoveryProof(input) {
      let publicBytes;
      let signature;
      try {
        const value = exact(input, ["storedVerifier", "proof", "recoveryCeremonyId", "operationId",
          "challenge", "syncedPocketId", "deviceId", "recoveryVersion", "keySetVersion", "expiresAt",
          "credentialDigest"]);
        const stored = verifier(value.storedVerifier);
        const proof = exact(value.proof, ["version", "algorithm", "signature"]);
        if (proof.version !== 1 || proof.algorithm !== "Ed25519") throw proofError();
        publicBytes = bytes(stored.publicKey, 32, 4096);
        signature = bytes(proof.signature, 32, 1024);
        const key = await webcrypto.subtle.importKey("spki", publicBytes, { name: "Ed25519" }, false, ["verify"]);
        const valid = await webcrypto.subtle.verify("Ed25519", key, signature, transcript({
          recoveryCeremonyId: value.recoveryCeremonyId, operationId: value.operationId,
          challenge: value.challenge, syncedPocketId: value.syncedPocketId, deviceId: value.deviceId,
          recoveryVersion: value.recoveryVersion, keySetVersion: value.keySetVersion,
          expiresAt: value.expiresAt, credentialDigest: value.credentialDigest,
        }));
        if (valid !== true) throw proofError();
        return Object.freeze({ verified: true });
      } catch (error) {
        if (error?.code === "service-recovery-proof-failed") throw error;
        throw proofError();
      } finally {
        if (publicBytes) publicBytes.fill(0);
        if (signature) signature.fill(0);
      }
    },
  });
}

module.exports = Object.freeze({ createRecoveryProofVerifier });
