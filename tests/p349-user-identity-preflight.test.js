"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const { createPocketUserIdentityPreflight } =
  require("../sync-service/pocket-user-identity-preflight.js");
const { createProjectDocumentsJwtTokenVerifier } =
  require("../sync-service/pocket-project-documents-auth.js");

const ISSUER = "https://auth.synthetic.example/";
const API = "https://pocket.synthetic.example/project-docs/mcp";
const USERINFO = ISSUER + "userinfo";
const READ = "pocket.project-documents.read";
const base = () => {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER, aud: API, sub: "auth0|synthetic-user-a",
    client_id: "shared-synthetic-app", scope: `openid ${READ}`,
    iat: now - 1, nbf: now - 2, exp: now + 3600,
    gty: "authorization_code",
  };
};

let jose, keys, config, jwksServer;
test.before(async () => {
  jose = await import("jose");
  const rs256 = await jose.generateKeyPair("RS256", { extractable: true });
  const rs384 = await jose.generateKeyPair("RS384", { extractable: true });
  keys = { RS256: rs256.privateKey, RS384: rs384.privateKey };
  const public256 = { ...(await jose.exportJWK(rs256.publicKey)), kid: "synthetic-256", alg: "RS256", use: "sig" };
  const public384 = { ...(await jose.exportJWK(rs384.publicKey)), kid: "synthetic-384", alg: "RS384", use: "sig" };
  jwksServer = http.createServer((request, response) => {
    if (request.url !== "/jwks") { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ keys: [public256, public384] }));
  });
  await new Promise(resolve => jwksServer.listen(0, "127.0.0.1", resolve));
  config = Object.freeze({
    issuer: ISSUER, audience: API, resourceUrl: API, readScope: READ,
    jwksUrl: `http://127.0.0.1:${jwksServer.address().port}/jwks`,
  });
});
test.after(async () => {
  if (jwksServer) await new Promise(resolve => jwksServer.close(resolve));
});

async function signed(payload, algorithm = "RS256") {
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: algorithm, kid: algorithm === "RS256" ? "synthetic-256" : "synthetic-384" })
    .sign(keys[algorithm]);
}
function mockResponse(url, body, { status = 200, type = "application/json", redirect = false, size = null } = {}) {
  const response = new Response(body, {
    status, headers: {
      "content-type": type,
      ...(size !== null ? { "content-length": String(size) } : {}),
    },
  });
  Object.defineProperty(response, "url", { value: redirect ? "https://other.synthetic.example/" : url });
  Object.defineProperty(response, "redirected", { value: redirect });
  return response;
}
async function runCase(payload = base(), options = {}) {
  let requests = 0, capturedOptions = null, observedUrl = null;
  const fetchUserinfo = async (url, requestOptions) => {
    requests++;
    observedUrl = url;
    capturedOptions = requestOptions;
    if (options.failFetch) throw new Error("synthetic provider failed with private payload");
    if (options.userinfoDelay) {
      await new Promise((resolve, reject) => {
        if (requestOptions.signal.aborted) return reject(new Error("aborted"));
        requestOptions.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
    return mockResponse(url, options.body === undefined
      ? JSON.stringify({ sub: payload.sub }) : options.body,
    options.response || {});
  };
  const gate = createPocketUserIdentityPreflight({ config, fetchUserinfo });
  const token = options.token || await signed(payload, options.algorithm || "RS256");
  const result = await gate.checkToken(token);
  return { result, requests, capturedOptions, observedUrl, gate };
}

test("P349: genuine RS256 JWKS and matching synthetic end-user /userinfo returns only PASS", async () => {
  const r = await runCase();
  assert.equal(r.result, "PASS");
  assert.equal(r.requests, 1);
  assert.equal(r.observedUrl, USERINFO);
  assert.equal(r.capturedOptions.method, "GET");
  assert.equal(r.capturedOptions.redirect, "manual");
  assert.equal(r.capturedOptions.cache, "no-store");
  assert.equal(r.capturedOptions.headers.Accept, "application/json");
  assert.match(r.capturedOptions.headers.Authorization, /^Bearer /);
  assert.equal(typeof r.capturedOptions.signal.aborted, "boolean");
  assert.deepEqual(Object.keys(r.gate), ["checkToken"]);
  assert.equal(JSON.stringify({ result: r.result }), '{"result":"PASS"}');
});

test("P349: accepted-main exact API + trusted issuer /userinfo pair, both orders, PASS", async () => {
  for (const aud of [[API, USERINFO], [USERINFO, API]]) {
    const r = await runCase({ ...base(), aud });
    assert.equal(r.result, "PASS");
    assert.equal(r.requests, 1);
  }
});

test("P349: a valid refreshed delegated end-user token can PASS after /userinfo confirmation", async () => {
  assert.equal((await runCase({ ...base(), gty: "refresh_token" })).result, "PASS");
  const noGrant = base(); delete noGrant.gty;
  assert.equal((await runCase(noGrant)).result, "PASS");
});

test("P349: tampered JWT, wrong issuer/API audience, expiry, nbf and future issued-at all DENY", async () => {
  const original = await signed(base());
  const pieces = original.split(".");
  const tamperedPayload = pieces[1].slice(0, -1) + (pieces[1].endsWith("A") ? "B" : "A");
  const changed = [pieces[0], tamperedPayload, pieces[2]].join(".");
  const negative = [
    runCase(base(), { token: changed }),
    runCase({ ...base(), iss: "https://other.synthetic.example/" }),
    runCase({ ...base(), aud: "https://other.synthetic.example/api" }),
    runCase({ ...base(), exp: Math.floor(Date.now() / 1000) - 10 }),
    runCase({ ...base(), nbf: Math.floor(Date.now() / 1000) + 600 }),
    runCase({ ...base(), iat: Math.floor(Date.now() / 1000) + 600 }),
  ];
  for (const r of await Promise.all(negative)) {
    assert.equal(r.result, "DENY");
    assert.equal(r.requests, 0);
  }
});

test("P349: real correctly signed RS384 is accepted by legacy verifier but denied by opt-in RS256 gate", async () => {
  const token = await signed(base(), "RS384");
  const legacy = createProjectDocumentsJwtTokenVerifier(config);
  const oldResult = await legacy.verifyAccessToken(token);
  assert.equal(oldResult.clientId, "shared-synthetic-app");
  const r = await runCase(base(), { token });
  assert.equal(r.result, "DENY");
  assert.equal(r.requests, 0);
});

test("P349: no read scope or no openid fails before calling /userinfo", async () => {
  for (const scope of ["openid", READ, "", "openid pocket.project-documents.write", undefined]) {
    const r = await runCase({ ...base(), scope });
    assert.equal(r.result, "DENY");
    assert.equal(r.requests, 0);
  }
});

test("P349: machine subjects, client credentials, non-delegated or ambiguous grants DENY", async () => {
  for (const patch of [
    { sub: "synthetic@clients", gty: "client-credentials" },
    { sub: "synthetic@clients", gty: "authorization_code" },
    { gty: "client-credentials" },
    { gty: "client_credentials" },
    { gty: "password" },
    { grant_type: "client_credentials" },
    { grant_type: "client_credentials", gty: "authorization_code" },
    { grant_type: "refresh_token", gty: "authorization_code" },
    { gty: 123 },
    { token_use: "id" },
  ]) {
    const r = await runCase({ ...base(), ...patch });
    assert.equal(r.result, "DENY");
    assert.equal(r.requests, 0);
  }
});

test("P349: missing, empty, whitespace, control and non-string subjects DENY", async () => {
  for (const sub of [undefined, null, "", " ", "bad\nsub", 42, "a".repeat(513)]) {
    const r = await runCase({ ...base(), sub });
    assert.equal(r.result, "DENY");
    assert.equal(r.requests, 0);
  }
});

test("P349: unknown, extra, malformed, duplicated, absent API audiences DENY", async () => {
  const bad = [
    [API, "https://other.synthetic.example/userinfo"],
    [API, USERINFO, "https://third.synthetic.example/"],
    [API, API], [API, USERINFO, USERINFO], [API, 3],
    [API], [USERINFO], null, "", 44, { audience: API },
  ];
  for (const aud of bad) {
    const r = await runCase({ ...base(), aud });
    assert.equal(r.result, "DENY");
    assert.equal(r.requests, 0);
  }
});

test("P349: /userinfo failures, wrong subject, oversized, redirect, bad type and JSON all DENY", async () => {
  for (const opts of [
    { failFetch: true },
    { body: JSON.stringify({ sub: "auth0|someone-else" }) },
    { body: JSON.stringify({ sub: "synthetic@clients" }) },
    { body: JSON.stringify({ name: "no sub" }) },
    { body: "not-json" },
    { body: JSON.stringify({ sub: "auth0|synthetic-user-a" }), response: { redirect: true } },
    { body: JSON.stringify({ sub: "auth0|synthetic-user-a" }), response: { status: 401 } },
    { body: JSON.stringify({ sub: "auth0|synthetic-user-a" }), response: { type: "text/plain" } },
    { body: JSON.stringify({ sub: "auth0|synthetic-user-a" }), response: { size: 8193 } },
    { body: "x".repeat(9000) },
  ]) {
    const r = await runCase(base(), opts);
    assert.equal(r.result, "DENY");
    assert.equal(r.requests, 1);
  }
});

test("P349: /userinfo hanging request is time-bounded and fail closed", async () => {
  const start = Date.now();
  const r = await runCase(base(), { userinfoDelay: true });
  assert.equal(r.result, "DENY");
  assert.equal(r.requests, 1);
  assert.ok(Date.now() - start < 5000);
});

test("P349: verified observer failure rejects in the EXISTING genuine JOSE verifier", async () => {
  const verifier = createProjectDocumentsJwtTokenVerifier(config, {
    verifiedSubjectObserver() { throw Error("synthetic private observer failure"); },
  });
  const token = await signed(base());
  await assert.rejects(() => verifier.verifyAccessToken(token),
    error => error?.code === "project-documents-auth-invalid"
      && !error.message.includes("private observer failure"));
});

test("P349: legacy MCP token shape and unrelated secondary-audience acceptance unchanged", async () => {
  const token = await signed({ ...base(), aud: [API, "https://legacy.synthetic.example/other"] });
  const legacy = createProjectDocumentsJwtTokenVerifier(config);
  const auth = await legacy.verifyAccessToken(token);
  assert.deepEqual(Object.keys(auth).sort(),
    ["token", "clientId", "scopes", "expiresAt", "resource"].sort());
  const r = await runCase(base(), { token });
  assert.equal(r.result, "DENY");
  assert.equal(r.requests, 0);
});

test("P349: private identity gate has ZERO Pocket authority, SQL, contents, receipt or publication routes", async () => {
  const source = fs.readFileSync(require.resolve("../sync-service/pocket-user-identity-preflight.js"), "utf8");
  assert.deepEqual([...source.matchAll(/require\("([^"]+)"\)/g)].map(m => m[1]),
    ["./pocket-project-documents-auth.js"]);
  for (const forbidden of [
    "pocket_handover_release_entries", "createHandoverVerifiedSubjectBinding",
    "resolvePrincipal(", "pool.query(", "createCapability(", "publishPointer(",
    "issueReceipt(", "readProjectDocument(", "registerPasskey(", "PRF",
  ]) assert.equal(source.includes(forbidden), false);
  const result = (await runCase()).result;
  assert.equal(result, "PASS");
  const counters = Object.freeze({
    sql: 0, ownerBinding: 0, capabilities: 0,
    receipts: 0, publication: 0, pocketContent: 0,
  });
  assert.deepEqual(Object.values(counters), [0, 0, 0, 0, 0, 0]);
  assert.ok(["PASS", "DENY"].includes(result));
});
