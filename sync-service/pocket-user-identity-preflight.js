"use strict";

// P349: dormant, explicitly constructed synthetic-first user identity preflight.
// No production composition, Pocket store, owner resolver, capability or receipt.
const { createProjectDocumentsJwtTokenVerifier, hasScope } =
  require("./pocket-project-documents-auth.js");

const USERINFO_TIMEOUT_MS = 2000;
const USERINFO_MAX_BYTES = 8192;
const MAX_SUBJECT_LENGTH = 512;
const delegatedGrants = new Set(["authorization_code", "refresh_token"]);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function trustedUserinfoUrl(issuer) {
  try {
    const value = new URL(issuer);
    if (typeof issuer !== "string" || value.href !== issuer
        || value.protocol !== "https:" || value.pathname !== "/"
        || value.username || value.password || value.search || value.hash) return null;
    return new URL("/userinfo", value).href;
  } catch { return null; }
}

function validSubject(subject) {
  return typeof subject === "string" && subject.length > 0
    && subject.length <= MAX_SUBJECT_LENGTH && subject === subject.trim()
    && !/[\u0000-\u001f\u007f]/.test(subject)
    && !subject.endsWith("@clients");
}

function isDelegated(claims) {
  if (![claims.grantType, claims.grantTypeAlias].every(value =>
    value === null || (typeof value === "string" && delegatedGrants.has(value)))) return false;
  if (claims.grantType !== null && claims.grantTypeAlias !== null
      && claims.grantType !== claims.grantTypeAlias) return false;
  return claims.tokenUse === null || claims.tokenUse === "access";
}

// The only outbound interaction is with an INJECTED fetch implementation.
// In this proof all responses are synthetic. Future live use requires a separately
// approved network adapter and privacy review; do not activate from production.
async function boundedUserinfo(fetchImpl, url, token) {
  const signal = AbortSignal.timeout(USERINFO_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "GET", redirect: "manual", signal, cache: "no-store",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
    if (signal.aborted || !response || response.status !== 200
        || response.redirected === true || response.url !== url
        || !response.headers?.get("content-type")?.toLowerCase().startsWith("application/json")
        || !response.body || typeof response.body.getReader !== "function") return null;
    const advertisedSize = response.headers.get("content-length");
    if (advertisedSize !== null
        && (!/^\d+$/.test(advertisedSize) || Number(advertisedSize) > USERINFO_MAX_BYTES)) return null;
    const reader = response.body.getReader();
    let bytes = 0;
    const pieces = [];
    try {
      while (true) {
        const next = await reader.read();
        if (signal.aborted) return null;
        if (next.done) break;
        if (!(next.value instanceof Uint8Array)) return null;
        bytes += next.value.byteLength;
        if (bytes > USERINFO_MAX_BYTES) return null;
        pieces.push(next.value);
      }
    } finally {
      try { await reader.cancel(); } catch { /* no log / no claims */ }
    }
    const body = Buffer.concat(pieces.map(piece => Buffer.from(piece))).toString("utf8");
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function createPocketUserIdentityPreflight(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).length !== 2
      || !input.config || typeof input.config !== "object"
      || typeof input.fetchUserinfo !== "function"
      || typeof input.config.readScope !== "string"
      || typeof input.config.resourceUrl !== "string") {
    throw new Error("P349 identity preflight configuration invalid.");
  }
  const config = input.config;
  const userinfoUrl = trustedUserinfoUrl(config.issuer);
  if (!userinfoUrl || config.audience === userinfoUrl) {
    throw new Error("P349 identity preflight configuration invalid.");
  }
  // Private verified provenance. Never expose or serialise claims or bearer.
  const verified = new WeakMap();
  const verifier = createProjectDocumentsJwtTokenVerifier(config, {
    expectedAlgorithm: "RS256",
    verifiedSubjectObserver(authInfo, claims) {
      if (!authInfo || !Object.isFrozen(authInfo) || !claims
          || !Object.isFrozen(claims)) throw new Error("P349 observer denied.");
      verified.set(authInfo, claims);
    },
  });

  async function checkToken(token) {
    try {
      const authInfo = await verifier.verifyAccessToken(token);
      const claims = verified.get(authInfo);
      const now = Math.floor(Date.now() / 1000);
      if (!claims || claims.issuer !== config.issuer || claims.audience !== config.audience
          || claims.resourceUrl !== config.resourceUrl
          || !validSubject(claims.subject)
          || !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= now
          || (claims.issuedAt !== null
              && (!Number.isSafeInteger(claims.issuedAt) || claims.issuedAt > now))
          || !isDelegated(claims)
          || !hasScope(authInfo, config.readScope) || !hasScope(authInfo, "openid")) return "DENY";
      const profile = await boundedUserinfo(input.fetchUserinfo, userinfoUrl, token);
      return profile && validSubject(profile.sub) && profile.sub === claims.subject
        ? "PASS" : "DENY";
    } catch {
      return "DENY";
    }
  }
  return Object.freeze({ checkToken });
}

module.exports = Object.freeze({ createPocketUserIdentityPreflight });
