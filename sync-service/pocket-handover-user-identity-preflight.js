"use strict";

// P349: DORMANT opt-in verification of an Auth0 end-user access token.
// This module has no production caller, Pocket storage, owner policy or grants.
// A future authorised caller must provide a tightly controlled HTTP transport.
const {
  createProjectDocumentsJwtTokenVerifier,
  hasScope,
} = require("./pocket-project-documents-auth.js");

const MAX_USERINFO_BYTES = 4096;
const DEFAULT_TIMEOUT_MS = 1500;
const MAX_TIMEOUT_MS = 2000;
const USER_GRANTS = new Set(["authorization_code", "refresh_token"]);
const validSubject = value => typeof value === "string"
  && value.length > 0 && value.length <= 512
  && value === value.trim() && !/[\s\x00-\x1f\x7f]/u.test(value)
  && !value.toLowerCase().endsWith("@clients");

function validGrants(claims) {
  const values = [claims.grantType, claims.oauthGrantType].filter(x => x !== undefined);
  if (values.some(x => typeof x !== "string" || !USER_GRANTS.has(x))) return false;
  return values.length < 2 || values[0] === values[1];
}

function trustedUserinfoUrl(config) {
  if (!config || typeof config.issuer !== "string"
      || typeof config.audience !== "string" || typeof config.resourceUrl !== "string"
      || typeof config.readScope !== "string"
      || typeof config.jwksUrl !== "string") throw new TypeError("Invalid preflight configuration.");
  const issuer = new URL(config.issuer);
  if (issuer.protocol !== "https:" || issuer.href !== config.issuer
      || issuer.pathname !== "/" || issuer.username || issuer.password
      || issuer.search || issuer.hash) throw new TypeError("Invalid preflight issuer.");
  return new URL("/userinfo", issuer).href;
}

async function readBoundedUserinfo(response, expectedUrl) {
  if (!response || response.status !== 200 || response.redirected !== false
      || response.url !== expectedUrl || !response.headers
      || typeof response.headers.get !== "function") return null;
  const type = response.headers.get("content-type");
  if (typeof type !== "string" || !/^application\/json(?:\s*;|\s*$)/i.test(type)) return null;
  const length = response.headers.get("content-length");
  if (length !== null && (!/^[0-9]{1,10}$/.test(length)
      || Number(length) > MAX_USERINFO_BYTES)) return null;
  const reader = response.body?.getReader?.();
  if (!reader) return null;
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) return null;
      size += value.byteLength;
      if (size > MAX_USERINFO_BYTES) {
        void reader.cancel().catch(() => {});
        return null;
      }
      parts.push(Buffer.from(value));
    }
    const body = JSON.parse(Buffer.concat(parts).toString("utf8"));
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } finally {
    try { reader.releaseLock(); } catch (_error) {}
  }
}

function createHandoverUserIdentityPreflight(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some(k => !["config", "fetchUserinfo", "timeoutMs"].includes(k))
      || typeof input.fetchUserinfo !== "function"
      || (input.timeoutMs !== undefined
        && (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1
          || input.timeoutMs > MAX_TIMEOUT_MS))) {
    throw new TypeError("Invalid identity preflight dependencies.");
  }
  const url = trustedUserinfoUrl(input.config);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // The existing JWT verifier, not a decoded token or caller-supplied subject,
  // is the sole source of verified identity evidence.
  const observed = new WeakMap();
  const verifier = createProjectDocumentsJwtTokenVerifier(input.config, {
    requireRs256: true,
    verifiedSubjectObserver(authInfo, claims) { observed.set(authInfo, claims); },
  });

  async function check(token) {
    try {
      const auth = await verifier.verifyAccessToken(token);
      const claims = observed.get(auth);
      observed.delete(auth); // verified subject cannot persist beyond this call
      if (!claims || claims.issuer !== input.config.issuer
          || claims.audience !== input.config.audience
          || claims.resourceUrl !== input.config.resourceUrl
          || !Number.isSafeInteger(claims.expiresAt)
          || claims.expiresAt <= Math.floor(Date.now() / 1000)
          || !validSubject(claims.subject) || !validGrants(claims)
          || !hasScope(auth, input.config.readScope)
          || !hasScope(auth, "openid")) return "DENY";

      // No default fetch: merely importing or constructing this dormant module
      // cannot contact Auth0. The future injected transport MUST honour:
      // HTTPS to this issuer-derived URL ONLY, no redirects, no credentials/
      // cookies, no logs, no token retention, no caching, and abort/timeout.
      const controller = new AbortController();
      let timer;
      try {
        const expired = new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("userinfo-timeout"));
          }, timeoutMs);
        });
        const attempt = (async () => {
          const response = await input.fetchUserinfo(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            redirect: "error",
            credentials: "omit",
            cache: "no-store",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
          });
          return readBoundedUserinfo(response, url);
        })();
        const userinfo = await Promise.race([attempt, expired]);
        if (controller.signal.aborted || !userinfo || !validSubject(userinfo.sub)
            || userinfo.sub !== claims.subject) return "DENY";
        return "PASS";
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    } catch (_error) {
      // Never surface exception text, bearer, subject, email or provider body.
      return "DENY";
    }
  }

  return Object.freeze({check});
}

module.exports = Object.freeze({createHandoverUserIdentityPreflight});
