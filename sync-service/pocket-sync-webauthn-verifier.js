"use strict";

const simpleWebAuthn = require("@simplewebauthn/server");
const simpleWebAuthnHelpers = require("@simplewebauthn/server/helpers");

function verifierError() {
  const error = new Error("Pocket Sync WebAuthn verification failed.");
  error.code = "webauthn-verification-failed";
  return error;
}

function isObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalBase64url(value) {
  if (typeof value !== "string" || value.length < 1 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw verifierError();
  }
  let bytes;
  try {
    bytes = Buffer.from(value, "base64url");
  } catch (_error) {
    throw verifierError();
  }
  if (!bytes.length || bytes.toString("base64url") !== value) throw verifierError();
  return bytes;
}

function positiveOrZeroSafeInteger(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw verifierError();
  return value;
}

function canonicalCredentialId(value) {
  return canonicalBase64url(value).toString("base64url");
}

function verifiedRegistrationInfo(result) {
  if (!isObject(result) || result.verified !== true || !isObject(result.registrationInfo)) throw verifierError();
  const info = result.registrationInfo;
  if (info.userVerified !== true
      || !isObject(info.credential)
      || !["singleDevice", "multiDevice"].includes(info.credentialDeviceType)
      || typeof info.credentialBackedUp !== "boolean") {
    throw verifierError();
  }
  return info;
}

function verifiedAuthenticationInfo(result) {
  if (!isObject(result) || result.verified !== true || !isObject(result.authenticationInfo)) throw verifierError();
  const info = result.authenticationInfo;
  if (info.userVerified !== true
      || !["singleDevice", "multiDevice"].includes(info.credentialDeviceType)
      || typeof info.credentialBackedUp !== "boolean") {
    throw verifierError();
  }
  return info;
}

function publicKeyAlgorithm(publicKey) {
  let decoded;
  try {
    decoded = simpleWebAuthnHelpers.decodeCredentialPublicKey(publicKey);
  } catch (_error) {
    throw verifierError();
  }
  const algorithm = decoded && typeof decoded.get === "function"
    ? decoded.get(simpleWebAuthnHelpers.cose.COSEKEYS.alg)
    : undefined;
  if (!Number.isSafeInteger(algorithm)) throw verifierError();
  return algorithm;
}

function registrationResult(result) {
  const info = verifiedRegistrationInfo(result);
  const credentialId = canonicalCredentialId(info.credential.id);
  const publicKey = info.credential.publicKey;
  if (!(publicKey instanceof Uint8Array) || publicKey.byteLength < 1) throw verifierError();
  const transports = info.credential.transports === undefined ? [] : info.credential.transports;
  if (!Array.isArray(transports) || transports.some((transport) => typeof transport !== "string")) throw verifierError();
  return Object.freeze({
    credentialId,
    publicKey: Buffer.from(publicKey).toString("base64url"),
    publicKeyAlgorithm: publicKeyAlgorithm(publicKey),
    signCount: positiveOrZeroSafeInteger(info.credential.counter),
    transports: Object.freeze(transports.slice()),
    backupEligible: info.credentialDeviceType === "multiDevice",
    backedUp: info.credentialBackedUp,
  });
}

function authenticationResult(result, storedCredential) {
  const info = verifiedAuthenticationInfo(result);
  const credentialId = canonicalCredentialId(info.credentialID);
  if (credentialId !== storedCredential.credentialId
      || (info.credentialDeviceType === "multiDevice") !== storedCredential.backupEligible) {
    throw verifierError();
  }
  return Object.freeze({
    credentialId,
    signCount: positiveOrZeroSafeInteger(info.newCounter),
    backedUp: info.credentialBackedUp,
  });
}

function validateRegistrationInput(input) {
  if (!isObject(input)
      || typeof input.trustedOrigin !== "string"
      || typeof input.rpId !== "string"
      || typeof input.challenge !== "string"
      || !isObject(input.publicKeyCreationOptions)
      || !isObject(input.credential)) {
    throw verifierError();
  }
  return input;
}

function validateAuthenticationInput(input) {
  if (!isObject(input)
      || typeof input.trustedOrigin !== "string"
      || typeof input.rpId !== "string"
      || typeof input.challenge !== "string"
      || !isObject(input.publicKeyRequestOptions)
      || !isObject(input.credential)
      || !isObject(input.storedCredential)
      || typeof input.storedCredential.credentialId !== "string"
      || typeof input.storedCredential.publicKey !== "string"
      || !Array.isArray(input.storedCredential.transports)
      || input.storedCredential.transports.some((transport) => typeof transport !== "string")
      || typeof input.storedCredential.backupEligible !== "boolean") {
    throw verifierError();
  }
  return input;
}

function createWebAuthnVerifier() {
  async function verifyRegistration(input) {
    const value = validateRegistrationInput(input);
    try {
      const result = await simpleWebAuthn.verifyRegistrationResponse({
        response: value.credential,
        expectedChallenge: value.challenge,
        expectedOrigin: value.trustedOrigin,
        expectedRPID: value.rpId,
        requireUserVerification: true,
      });
      return registrationResult(result);
    } catch (_error) {
      throw verifierError();
    }
  }

  async function verifyAuthentication(input) {
    const value = validateAuthenticationInput(input);
    let publicKey;
    try {
      publicKey = new Uint8Array(canonicalBase64url(value.storedCredential.publicKey));
      const result = await simpleWebAuthn.verifyAuthenticationResponse({
        response: value.credential,
        expectedChallenge: value.challenge,
        expectedOrigin: value.trustedOrigin,
        expectedRPID: value.rpId,
        credential: {
          id: canonicalCredentialId(value.storedCredential.credentialId),
          publicKey,
          counter: positiveOrZeroSafeInteger(value.storedCredential.signCount),
          transports: value.storedCredential.transports.slice(),
        },
        requireUserVerification: true,
      });
      return authenticationResult(result, value.storedCredential);
    } catch (_error) {
      throw verifierError();
    }
  }

  return Object.freeze({ verifyRegistration, verifyAuthentication });
}

module.exports = Object.freeze({ createWebAuthnVerifier });
