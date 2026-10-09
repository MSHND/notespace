"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createProjectDocumentsTokenVerifier } =
  require("../sync-service/pocket-project-documents-auth.js");
const { createHandoverVerifiedSubjectBinding } =
  require("../sync-service/pocket-handover-verified-subject-binding.js");
const { SQL, createHandoverReleaseSafetyStore } =
  require("../sync-service/pocket-handover-release-safety-store.js");
const { NAMES } = require("../sync-service/pocket-handover-release-witness.js");

const config = Object.freeze({
  issuer: "https://login.synthetic.auth0.test/",
  audience: "https://pocket.synthetic.test/project-docs/mcp",
  resourceUrl: "https://pocket.synthetic.test/project-docs/mcp",
  jwksUrl: "https://login.synthetic.auth0.test/.well-known/jwks.json",
});
const userinfo = "https://login.synthetic.auth0.test/userinfo";
const exp = () => Math.floor(Date.now() / 1000) + 600;
const payload = (aud = config.audience, sub = "user-alpha", scope = "openid pocket.project-documents.write") => ({
  iss: config.issuer, aud, sub, scope, client_id: "same-app-client", exp: exp(),
});
function row(sub, owner, role = "stager", overrides = {}) {
  const roles = { stager: ["read", "stage"], reader: ["read"], publisher: ["read", "publish"] };
  return {
    issuer: config.issuer, subject: sub, audience: config.audience,
    resourceUrl: config.resourceUrl, ownerId: owner, resourceId: "handover",
    principalId: owner + "-principal", role, capabilities: roles[role],
    approved: true, ownerApproved: true, revoked: false,
    expiresAtMs: Date.now() + 600000, ...overrides,
  };
}
function fixture(options = {}) {
  let approvedPolicy = {
    version: 1, approved: true, revoked: false,
    bindings: [row("user-alpha", "owner-alpha"), row("user-beta", "owner-beta")],
  };
  let current = payload(), sqlCalls = [], publisherChecks = 0, observedClaims = [];
  const binding = createHandoverVerifiedSubjectBinding({
    async readApprovedPolicy() { return approvedPolicy; },
  });
  const verifier = createProjectDocumentsTokenVerifier({
    config: { ...config, ...(options.config || {}) },
    async verifyJwt() { return current; },
    verifiedSubjectObserver(auth, claims) {
      observedClaims.push(claims);
      binding.verifiedSubjectObserver(auth, claims);
    },
  });
  const store = createHandoverReleaseSafetyStore({
    pool: {
      async query(sql, values) {
        sqlCalls.push({ sql, values });
        if (sql !== SQL.createEntry) throw Error("unexpected SQL");
        return {
          rowCount: 1,
          rows: [{
            owner_id: values[0], resource_id: values[1], release_id: values[2],
            name: values[3], kind: values[4], content: values[5],
            sha256: values[6], revision: 1,
          }],
        };
      },
    },
    resolvePrincipal: binding.resolvePrincipal,
    async verifyPublisherApproval() { publisherChecks += 1; return null; },
  });
  return {
    binding, store, verifier,
    auth: async p => { current = p; return verifier.verifyAccessToken("synthetic-only"); },
    stage: auth => store.createEntry({
      auth, releaseId: "r1", name: "pocket.start-here",
      kind: "document", content: "synthetic document",
    }),
    getCalls: () => sqlCalls,
    getClaims: () => observedClaims,
    publisherChecks: () => publisherChecks,
    policy: () => approvedPolicy,
    setPolicy: p => { approvedPolicy = p; },
  };
}
async function deniedBeforeSql(f, p, reason = "owner-unverified") {
  const before = f.getCalls().length;
  const a = await f.auth(p);
  await assert.rejects(() => f.stage(a),
    e => e?.code === "handover-release-safety-denied" && e.reason === reason);
  assert.equal(f.getCalls().length, before, "no DB access on denied binding");
  return a;
}

test("P349xn string API audience canonicalises without openid; legacy shape unchanged", async () => {
  const f = fixture();
  const a = await f.auth(payload(config.audience, "user-alpha", "pocket.project-documents.write"));
  assert.equal(f.getClaims()[0].audience, config.audience);
  assert.deepEqual(Object.keys(a).sort(), ["token", "clientId", "scopes", "expiresAt", "resource"].sort());
  assert.equal(a.clientId, "same-app-client");
  assert.equal((await f.stage(a)).ok, true);
  assert.deepEqual(f.getCalls()[0].values.slice(0, 2), ["owner-alpha", "handover"]);
});
test("P349xn exactly documented API plus issuer-derived /userinfo array works in BOTH orders", async () => {
  for (const audience of [[config.audience, userinfo], [userinfo, config.audience]]) {
    const f = fixture();
    const a = await f.auth(payload(audience));
    assert.equal(f.getClaims()[0].audience, config.audience);
    assert.equal((await f.binding.resolvePrincipal(a)).ownerId, "owner-alpha");
    assert.equal((await f.stage(a)).ok, true);
    assert.equal(f.getCalls().length, 1);
    assert.equal(f.getCalls()[0].values[0], "owner-alpha");
  }
});
test("P349xn trusted verified scp array also supplies openid for exact two-audience token", async () => {
  const f = fixture();
  const p = { ...payload([userinfo, config.audience]), scope: undefined,
    scp: ["openid", "pocket.project-documents.write"] };
  assert.equal((await f.stage(await f.auth(p))).ok, true);
  assert.equal(f.getClaims()[0].audience, config.audience);
});
test("P349xn documented two-audience form without verified openid remains legacy-valid but handover-denied", async () => {
  for (const scope of ["pocket.project-documents.write", "", undefined]) {
    const f = fixture();
    const p = { ...payload([config.audience, userinfo]), scope };
    await deniedBeforeSql(f, p);
    assert.equal(f.getClaims()[0].audience, null);
  }
});
test("P349xn only exact two distinct string audiences: arbitrary extras, duplicates and malformed arrays deny storage", async () => {
  const forms = [
    [config.audience, "https://other.synthetic.test/userinfo"],
    ["https://else.synthetic.auth0.test/userinfo", config.audience],
    [config.audience, userinfo, "https://third.synthetic.test"],
    [config.audience, userinfo, userinfo],
    [config.audience, config.audience],
    [config.audience, ""],
    [config.audience, 123],
    [config.audience, null],
    [config.audience],
    [config.audience, { another: "string" }],
  ];
  for (const aud of forms) {
    const f = fixture();
    // A malformed array can be rejected by baseline verifier as well. Either
    // outcome must prevent SQL while legacy accepts only its original shapes.
    try {
      await deniedBeforeSql(f, payload(aud));
    } catch (error) {
      if (error?.code !== "project-documents-auth-invalid") throw error;
      assert.equal(f.getCalls().length, 0);
    }
  }
});
test("P349xn wrong or missing API audience, wrong issuer and expired token reject before observer/store", async () => {
  const f = fixture();
  for (const p of [
    payload("https://wrong.synthetic.test"),
    payload([userinfo, "https://wrong.synthetic.test"]),
    { ...payload(), aud: undefined },
    { ...payload(), iss: "https://other.synthetic.auth0.test/" },
    { ...payload(), exp: Math.floor(Date.now() / 1000) - 1 },
  ]) {
    await assert.rejects(() => f.auth(p), e => e?.code === "project-documents-auth-invalid");
    assert.equal(f.getCalls().length, 0);
  }
});
test("P349xn non-root issuer cannot manufacture /userinfo audience; string still works", async () => {
  const nested = "https://login.synthetic.auth0.test/oauth/";
  const f = fixture({ config: { issuer: nested } });
  const nestedPayload = { ...payload([config.audience, userinfo]), iss: nested };
  await deniedBeforeSql(f, nestedPayload);
  assert.equal(f.getClaims()[0].audience, null);
  // Direct-string audience is valid, but still requires a separately approved
  // policy bound to the SAME non-root issuer; the old issuer must not match.
  const policy = structuredClone(f.policy());
  for (const record of policy.bindings) record.issuer = nested;
  f.setPolicy(policy);
  const direct = await f.auth({ ...nestedPayload, aud: config.audience });
  assert.equal((await f.stage(direct)).ok, true);
});
test("P349xn missing subject, M2M @clients subject (even approved), and unknown subject deny before SQL", async () => {
  const f = fixture();
  const p = structuredClone(f.policy());
  p.bindings.push(row("service-id@clients", "owner-machine"));
  f.setPolicy(p);
  for (const sub of [undefined, "", "service-id@clients", "unapproved-human"]) {
    await deniedBeforeSql(f, { ...payload([userinfo, config.audience]), sub });
  }
  assert.equal(f.getCalls().length, 0);
});
test("P349xn two human sub values sharing client_id map to distinct approved owners", async () => {
  const f = fixture();
  const first = await f.auth(payload([config.audience, userinfo], "user-alpha"));
  const second = await f.auth(payload([userinfo, config.audience], "user-beta"));
  assert.equal(first.clientId, second.clientId);
  assert.notEqual((await f.binding.resolvePrincipal(first)).ownerId,
    (await f.binding.resolvePrincipal(second)).ownerId);
  await f.stage(first);
  await f.stage(second);
  assert.deepEqual(f.getCalls().map(x => x.values[0]), ["owner-alpha", "owner-beta"]);
});
test("P349xn policy owner/resource/capability, expiry, revocation and ambiguity all remain fail-closed", async () => {
  const changes = [
    p => { p.bindings[0].approved = false; },
    p => { p.bindings[0].ownerApproved = false; },
    p => { p.bindings[0].revoked = true; },
    p => { p.bindings[0].expiresAtMs = Date.now() - 1; },
    p => { p.bindings[0].resourceUrl = "https://wrong.synthetic.test/"; },
    p => { p.bindings[0].audience = userinfo; },
    p => { p.bindings[0].role = "reader"; p.bindings[0].capabilities = ["read"]; },
    p => { p.bindings.push({ ...p.bindings[0] }); },
  ];
  for (const modify of changes) {
    const f = fixture(), policy = structuredClone(f.policy());
    modify(policy); f.setPolicy(policy);
    await deniedBeforeSql(f, payload([config.audience, userinfo]),
      policy.bindings[0].role === "reader" ? "owner-or-capability-denied" : "owner-unverified");
  }
});
test("P349xn publish still needs separate independent receipt; ordinary write scope is insufficient", async () => {
  const f = fixture();
  const p = structuredClone(f.policy());
  p.bindings[0] = row("user-alpha", "owner-alpha", "publisher");
  f.setPolicy(p);
  const a = await f.auth(payload([userinfo, config.audience]));
  const releaseManifest = JSON.stringify({
    releaseId: "r1", authorityEpoch: "GOOGLE_ONLY",
    documents: NAMES.map(name => ({ name, releaseId: "r1", digest: "a".repeat(64) })),
  });
  await assert.rejects(
    () => f.store.publishPointer({ auth: a, releaseId: "r1", content: releaseManifest, expectedRevision: 0 }),
    e => e?.code === "handover-release-safety-denied" && e.reason === "publisher-approval-denied"
  );
  assert.equal(f.publisherChecks(), 1);
  assert.equal(f.getCalls().length, 0);
});
test("P349xn legacy verifier remains permissive for unrelated string-array API tokens, without handover permission", async () => {
  const f = fixture();
  const legacy = createProjectDocumentsTokenVerifier({
    config, async verifyJwt() { return payload([config.audience, "arbitrary-secondary"]); },
  });
  const normal = await legacy.verifyAccessToken("legacy-synthetic");
  assert.equal(normal.clientId, "same-app-client");
  assert.equal(normal.scopes.includes("openid"), true);
  await deniedBeforeSql(f, payload([config.audience, "arbitrary-secondary"]));
  assert.equal(f.getCalls().length, 0);
});
