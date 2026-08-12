"use strict";

const CONFIG_FIELDS = Object.freeze(["environment", "readFile"]);

function configError() {
  const error = new Error("Pocket Sync local configuration is invalid.");
  error.code = "sync-server-config-invalid";
  return error;
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactObject(value, fields) {
  if (!isObject(value) || Object.keys(value).length !== fields.length
      || fields.some((field) => !Object.prototype.hasOwnProperty.call(value, field))) {
    throw configError();
  }
  return value;
}

function required(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value.length < 1 || value !== value.trim()) throw configError();
  return value;
}

function optional(environment, name, fallback) {
  const value = environment[name];
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length < 1 || value !== value.trim()) throw configError();
  return value;
}

function localPort(value) {
  if (!/^[1-9][0-9]{0,4}$/.test(value)) throw configError();
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65535) throw configError();
  return port;
}

function trustedOriginAndRpId(origin, rpId) {
  let parsed;
  try { parsed = new URL(origin); } catch (_error) { throw configError(); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/"
      || parsed.search || parsed.hash || parsed.origin !== origin || parsed.hostname !== rpId) {
    throw configError();
  }
}

function createUnavailableRecoveryProofVerifier() {
  return Object.freeze({
    async verifyRecoveryProof() {
      const error = new Error("Pocket Sync recovery proof is unavailable.");
      error.code = "recovery-proof-unavailable";
      throw error;
    },
  });
}

function createLocalServerConfig(input) {
  exactObject(input, CONFIG_FIELDS);
  if (!isObject(input.environment) || typeof input.readFile !== "function") throw configError();
  const environment = input.environment;
  const certFile = required(environment, "POCKET_SYNC_TLS_CERT_FILE");
  const keyFile = required(environment, "POCKET_SYNC_TLS_KEY_FILE");
  let cert;
  let key;
  try {
    cert = input.readFile(certFile);
    key = input.readFile(keyFile);
  } catch (_error) {
    throw configError();
  }
  if (!(cert instanceof Uint8Array) || !(key instanceof Uint8Array) || cert.byteLength < 1 || key.byteLength < 1) {
    throw configError();
  }
  const trustedOrigin = required(environment, "POCKET_SYNC_TRUSTED_ORIGIN");
  const rpId = required(environment, "POCKET_SYNC_RP_ID");
  trustedOriginAndRpId(trustedOrigin, rpId);
  const runtime = Object.freeze({
    trustedOrigin,
    rpId,
    rpName: optional(environment, "POCKET_SYNC_RP_NAME", "Pocket local Sync"),
    serviceRoot: optional(environment, "POCKET_SYNC_SERVICE_ROOT", "/pocket-sync/v1"),
    postgres: Object.freeze({ connectionString: required(environment, "POCKET_SYNC_DATABASE_URL") }),
    credentialAlgorithms: Object.freeze([-7, -257]),
    ceremonyLifetimeMs: 300000,
    sessionLifetimeMs: 2592000000,
    recoveryProofVerifier: createUnavailableRecoveryProofVerifier(),
    tls: Object.freeze({ cert: new Uint8Array(cert), key: new Uint8Array(key) }),
  });
  return Object.freeze({
    runtime,
    listen: Object.freeze({ host: "127.0.0.1", port: localPort(optional(environment, "POCKET_SYNC_PORT", "8443")) }),
  });
}

function readDatabaseConnection(input) {
  if (!isObject(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input, "environment")
      || !isObject(input.environment)) {
    throw configError();
  }
  return required(input.environment, "POCKET_SYNC_DATABASE_URL");
}

module.exports = Object.freeze({
  createLocalServerConfig,
  createUnavailableRecoveryProofVerifier,
  readDatabaseConnection,
});
