"use strict";

// P349xh: DORMANT opt-in bridge for the existing verified JWT path and the
// P349xf release-store resolvePrincipal seam. No routes, credentials or grants.
// Call verifiedSubjectObserver ONLY from createProjectDocumentsJwtTokenVerifier
// (or its existing injected verified-JWT test seam) in a trusted server scope.
const ROLE_CAPABILITIES = Object.freeze({
  reader: Object.freeze(["read"]),
  stager: Object.freeze(["read", "stage"]),
  publisher: Object.freeze(["read", "publish"]),
});
const ID = /^[a-z][a-z0-9._:-]{0,127}$/;
const identityText = x => typeof x === "string" && x.length > 0 && x.length <= 512
  && x === x.trim();
const id = x => typeof x === "string" && ID.test(x);
const object = x => !!x && typeof x === "object" && !Array.isArray(x);
const own = (x,k) => Object.prototype.hasOwnProperty.call(x,k);

function denied() {
  const error = new Error("Pocket handover verified identity / resource binding denied.");
  error.code = "handover-subject-binding-denied";
  throw error;
}
function safeVerifiedClaims(claims) {
  if (!object(claims) || !identityText(claims.subject)
      || !identityText(claims.issuer) || !identityText(claims.audience)
      || !identityText(claims.resourceUrl)
      || !Number.isSafeInteger(claims.expiresAt)
      || claims.expiresAt <= Date.now() / 1000) return null;
  return Object.freeze({
    issuer: claims.issuer, subject: claims.subject,
    audience: claims.audience, resourceUrl: claims.resourceUrl,
    expiresAt: claims.expiresAt,
  });
}
function validRecord(record) {
  if (!object(record)
      || !["issuer","subject","audience","resourceUrl"].every(k=>identityText(record[k]))
      || !["ownerId","resourceId","principalId"].every(k=>id(record[k]))
      || record.approved !== true || record.ownerApproved !== true || record.revoked !== false
      || !Number.isSafeInteger(record.expiresAtMs)
      || !own(ROLE_CAPABILITIES, record.role)
      || !Array.isArray(record.capabilities)) return false;
  const expected = ROLE_CAPABILITIES[record.role];
  return record.capabilities.length === expected.length
    && expected.every(x=>record.capabilities.includes(x))
    && new Set(record.capabilities).size === expected.length;
}
function validPolicy(policy) {
  if (!object(policy) || policy.version !== 1 || policy.approved !== true
      || policy.revoked !== false || !Array.isArray(policy.bindings)
      || policy.bindings.length > 128) return false;
  const uniqueSubjects = new Set(), uniquePrincipals = new Set();
  for (const record of policy.bindings) {
    if (!validRecord(record)) return false;
    // A subject in more than one role, tenant or resource is ambiguous.
    const subject = JSON.stringify([record.issuer,record.subject]);
    if (uniqueSubjects.has(subject) || uniquePrincipals.has(record.principalId)) return false;
    uniqueSubjects.add(subject); uniquePrincipals.add(record.principalId);
  }
  return true;
}
function createHandoverVerifiedSubjectBinding(input) {
  if (!object(input) || Object.keys(input).length !== 1
      || typeof input.readApprovedPolicy !== "function") denied();
  // Non-exported WeakMap: arbitrary authInfo, client_id or user-provided document
  // content cannot impersonate an object observed by the trusted token verifier.
  const verified = new WeakMap();
  function verifiedSubjectObserver(authInfo, claims) {
    if (!object(authInfo) || !Object.isFrozen(authInfo)) denied();
    const safe = safeVerifiedClaims(claims);
    if (safe) verified.set(authInfo, safe);
    // No extra property on existing OAuth/MCP authInfo. Legacy tokens without
    // a unique sub may still use the legacy API, but cannot bind to a release.
  }
  async function resolvePrincipal(authInfo) {
    const claims = object(authInfo) ? verified.get(authInfo) : null;
    if (!claims || claims.expiresAt <= Date.now() / 1000
        || authInfo.expiresAt !== claims.expiresAt
        || authInfo.resource?.href !== claims.resourceUrl) denied();
    let policy;
    try { policy = await input.readApprovedPolicy(); }
    catch (_error) { denied(); }
    if (!validPolicy(policy)) denied();
    const matching = policy.bindings.filter(record =>
      record.issuer === claims.issuer && record.subject === claims.subject
      && record.audience === claims.audience
      && record.resourceUrl === claims.resourceUrl);
    if (matching.length !== 1) denied();
    const entry = matching[0];
    if (entry.expiresAtMs <= Date.now()) denied();
    // Exact separate server-policy roles. Ordinary OAuth write scope alone
    // neither supplies owner/resource nor grants pointer publication.
    return Object.freeze({
      ownerId: entry.ownerId,
      resourceId: entry.resourceId,
      principalId: entry.principalId,
      capabilities: Object.freeze([...entry.capabilities]),
    });
  }
  return Object.freeze({verifiedSubjectObserver, resolvePrincipal});
}
module.exports = Object.freeze({createHandoverVerifiedSubjectBinding});
