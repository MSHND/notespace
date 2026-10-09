"use strict";

function projectDocumentsAuthError(code = "project-documents-auth-invalid") {
  const error = new Error("Pocket project documents authentication failed.");
  error.code = code;
  return error;
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanScopes(payload) {
  const raw = typeof payload.scope === "string"
    ? payload.scope.split(/\s+/).filter(Boolean)
    : (Array.isArray(payload.scp)
      ? payload.scp
      : (typeof payload.scp === "string" ? payload.scp.split(/\s+/).filter(Boolean) : []));
  if (raw.length > 128 || raw.some((item) => typeof item !== "string" || item.length < 1 || item.length > 160)) {
    throw projectDocumentsAuthError();
  }
  return Object.freeze([...new Set(raw)]);
}

function audienceMatches(value, expected) {
  if (typeof value === "string") return value === expected;
  return Array.isArray(value) && value.length > 0
    && value.every((item) => typeof item === "string")
    && value.includes(expected);
}

// Only the dormant, explicitly opted-in handover observer consumes this
// canonicalisation. Legacy OAuth/MCP audience validation is deliberately unchanged.
function handoverAudience(payload, config, scopes) {
  if (payload.aud === config.audience) return config.audience;
  const audiences = payload.aud;
  if (!Array.isArray(audiences) || audiences.length !== 2
      || audiences.some(value => typeof value !== "string" || value.length === 0)
      || audiences[0] === audiences[1] || !scopes.includes("openid")) return null;

  // No token-supplied domain, alternative issuer, or arbitrary second audience:
  // the /userinfo URL must be derived solely from the EXACT verified issuer.
  let issuer;
  try { issuer = new URL(config.issuer); } catch (_error) { return null; }
  if (payload.iss !== config.issuer || issuer.href !== config.issuer
      || issuer.protocol !== "https:" || issuer.pathname !== "/"
      || issuer.username || issuer.password || issuer.search || issuer.hash) return null;
  const userinfo = new URL("/userinfo", issuer).href;
  if (config.audience === userinfo) return null;
  return (audiences[0] === config.audience && audiences[1] === userinfo)
    || (audiences[1] === config.audience && audiences[0] === userinfo)
    ? config.audience : null;
}

function authInfoFromPayload(token, payload, config) {
  if (typeof token !== "string" || token.length < 1 || token.length > 16384
      || !isObject(payload) || !Number.isFinite(payload.exp)
      || payload.exp <= Math.floor(Date.now() / 1000)
      || payload.iss !== config.issuer
      || !audienceMatches(payload.aud, config.audience)) {
    throw projectDocumentsAuthError();
  }
  const clientId = typeof payload.client_id === "string" && payload.client_id.length > 0
    ? payload.client_id
    : (typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null);
  if (!clientId || clientId.length > 512) throw projectDocumentsAuthError();
  return Object.freeze({
    token,
    clientId,
    scopes: cleanScopes(payload),
    expiresAt: payload.exp,
    resource: new URL(config.resourceUrl),
  });
}

function validateConfig(config) {
  if (!isObject(config)
      || typeof config.issuer !== "string" || typeof config.audience !== "string"
      || typeof config.jwksUrl !== "string" || typeof config.resourceUrl !== "string") {
    throw projectDocumentsAuthError("project-documents-auth-config-invalid");
  }
  return config;
}

function createProjectDocumentsTokenVerifier(input) {
  const withObserver = isObject(input) && Object.hasOwn(input, "verifiedSubjectObserver");
  if (!isObject(input) || Object.keys(input).length !== (withObserver ? 3 : 2)
      || !Object.hasOwn(input, "config") || !Object.hasOwn(input, "verifyJwt")
      || typeof input.verifyJwt !== "function"
      || (withObserver && typeof input.verifiedSubjectObserver !== "function")) {
    throw projectDocumentsAuthError("project-documents-auth-config-invalid");
  }
  const config = validateConfig(input.config);
  return Object.freeze({
    async verifyAccessToken(token) {
      if (typeof token !== "string" || token.length < 1 || token.length > 16384) {
        throw projectDocumentsAuthError();
      }
      let payload;
      try {
        payload = await input.verifyJwt(token, config);
      } catch (_error) {
        throw projectDocumentsAuthError();
      }
      const authInfo = authInfoFromPayload(token, payload, config);
      // Opt-in server-only observer: verified claims are passed once from THIS
      // verifier after signature/issuer/audience/expiry validation. Never decode
      // the raw bearer token again, and never mutate legacy authInfo shape.
      if (withObserver) {
        try {
          input.verifiedSubjectObserver(authInfo, Object.freeze({
            issuer: payload.iss,
            subject: typeof payload.sub === "string" ? payload.sub : null,
            // Restricted Auth0 Custom API + same verified-issuer /userinfo form;
            // legacy authInfo/scopes are unchanged even when this is null.
            audience: handoverAudience(payload, config, authInfo.scopes),
            resourceUrl: config.resourceUrl,
            expiresAt: payload.exp,
          }));
        } catch (_error) {
          throw projectDocumentsAuthError();
        }
      }
      return authInfo;
    },
  });
}

function createProjectDocumentsJwtTokenVerifier(configInput, options = null) {
  const config = validateConfig(configInput);
  if (options !== null && (!isObject(options) || Object.keys(options).length !== 1
      || typeof options.verifiedSubjectObserver !== "function")) {
    throw projectDocumentsAuthError("project-documents-auth-config-invalid");
  }
  let verifier = null;
  return createProjectDocumentsTokenVerifier({
    config,
    ...(options ? { verifiedSubjectObserver: options.verifiedSubjectObserver } : {}),
    async verifyJwt(token) {
      let jose;
      try { jose = await import("jose"); } catch (_error) {
        throw projectDocumentsAuthError("project-documents-auth-verifier-unavailable");
      }
      if (!verifier) {
        let jwksUrl;
        try { jwksUrl = new URL(config.jwksUrl); } catch (_error) {
          throw projectDocumentsAuthError("project-documents-auth-config-invalid");
        }
        verifier = jose.createRemoteJWKSet(jwksUrl);
      }
      const verified = await jose.jwtVerify(token, verifier, {
        issuer: config.issuer,
        audience: config.audience,
      });
      if (!verified || !isObject(verified.payload)) throw projectDocumentsAuthError();
      return verified.payload;
    },
  });
}

function hasScope(authInfo, requiredScope) {
  return !!authInfo && Array.isArray(authInfo.scopes)
    && typeof requiredScope === "string" && authInfo.scopes.includes(requiredScope);
}

module.exports = Object.freeze({
  createProjectDocumentsJwtTokenVerifier,
  createProjectDocumentsTokenVerifier,
  hasScope,
  projectDocumentsAuthError,
});
