"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { createHandoverUserIdentityPreflight } =
  require("../sync-service/pocket-handover-user-identity-preflight.js");
const { createProjectDocumentsJwtTokenVerifier, createProjectDocumentsTokenVerifier } =
  require("../sync-service/pocket-project-documents-auth.js");

const ISSUER = "https://pocket.synthetic.auth0.test/";
const API = "https://pocket.synthetic.test/project-docs/mcp";
const USERINFO = ISSUER + "userinfo";
const READ = "pocket.project-documents.read";
const OPENID = "openid";
const subject = "auth0|synthetic-user";
const tokenTime = () => Math.floor(Date.now() / 1000);
const tokenClaims = () => ({
  iss: ISSUER, aud: API, sub: subject,
  scope: OPENID + " " + READ, gty: "authorization_code",
  exp: tokenTime() + 600, iat: tokenTime() - 3,
});

function userinfoResponse(url, state) {
  const data = state.body === undefined ? {sub: subject} : state.body;
  const text = typeof data === "string" ? data : JSON.stringify(data);
  const bytes = new TextEncoder().encode(text);
  return {
    status: state.status ?? 200,
    redirected: state.redirected ?? false,
    url: state.url ?? url,
    headers: new Headers({
      "content-type": state.contentType ?? "application/json",
      "content-length": String(state.reportedLength ?? bytes.byteLength),
    }),
    body: new ReadableStream({
      start(controller) { controller.enqueue(bytes); controller.close(); },
    }),
  };
}

test("P349 isolated real RS256 verification + synthetic userinfo, fail-closed", async t => {
  const jose = await import("jose");
  const pair = await jose.generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
  const jwk = await jose.exportJWK(pair.publicKey);
  Object.assign(jwk, {kid: "disposable-rsa", alg: "RS256", use: "sig"});
  let jwksRequests = 0;
  const server = http.createServer((req, res) => {
    jwksRequests++;
    if (req.url !== "/jwks") { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {"content-type":"application/json", "cache-control":"no-store"});
    res.end(JSON.stringify({keys:[jwk]}));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); });
  const config = Object.freeze({
    issuer: ISSUER, audience: API, resourceUrl: API,
    jwksUrl: `http://127.0.0.1:${server.address().port}/jwks`,
    readScope: READ, writeScope: "pocket.project-documents.write",
  });
  const sign = (claims = tokenClaims(), alg = "RS256") => {
    const key = alg === "HS256" ? new TextEncoder().encode("disposable-symmetric-signing-key-32bytes") : pair.privateKey;
    return new jose.SignJWT(claims)
      .setProtectedHeader({alg, kid: "disposable-rsa"})
      .sign(key);
  };
  const fixture = (overrides = {}) => {
    const state = { calls:0, ...overrides };
    const gate = createHandoverUserIdentityPreflight({
      config, timeoutMs: state.timeoutMs ?? 750,
      fetchUserinfo: async (url, init) => {
        state.calls++;
        assert.equal(url, USERINFO, "only issuer-derived /userinfo allowed");
        assert.equal(init.redirect, "error");
        assert.equal(init.credentials, "omit");
        assert.equal(init.referrerPolicy, "no-referrer");
        assert.equal(init.cache, "no-store");
        assert.equal(init.method, "GET");
        assert.equal(init.headers.Accept, "application/json");
        assert.ok(/^Bearer [A-Za-z0-9._-]+$/.test(init.headers.Authorization));
        if (state.hang) return new Promise(() => {});
        if (state.error) throw new Error("Synthetic secret must never be returned.");
        return userinfoResponse(url, state);
      },
    });
    return {state, gate};
  };
  const positive = async (claims = tokenClaims()) => {
    const f = fixture();
    assert.equal(await f.gate.check(await sign(claims)), "PASS");
    assert.equal(f.state.calls, 1, "verified token must reach mock /userinfo exactly once");
  };
  const denied = async (claims, expectedCalls = 0, response = {}, alg = "RS256") => {
    const f = fixture(response);
    const result = await f.gate.check(await sign(claims, alg));
    assert.equal(result, "DENY");
    assert.equal(f.state.calls, expectedCalls);
  };

  await t.test("positive: real signed RS256 JWT, exact API audience, read + openid, matching userinfo", async () => {
    await positive();
    assert.ok(jwksRequests >= 1, "the real JOSE remote JWKS signature path was exercised");
  });
  await t.test("positive: issuer /userinfo audience in either documented order", async () => {
    await positive({...tokenClaims(), aud: [API, USERINFO]});
    await positive({...tokenClaims(), aud: [USERINFO, API]});
  });
  await t.test("positive: verified scp array works and missing grant claim is handled by userinfo", async () => {
    await positive({...tokenClaims(), scope:undefined, scp:[READ, OPENID]});
    await positive({...tokenClaims(), gty:undefined});
  });

  await t.test("DENY invalid signature and token modification without provider access", async () => {
    const original = await sign();
    const parts = original.split(".");
    const altered = parts[2].replace(/^./, parts[2][0] === "A" ? "B" : "A");
    const f = fixture();
    assert.equal(await f.gate.check([parts[0], parts[1], altered].join(".")), "DENY");
    assert.equal(await f.gate.check(original.replace(/.$/, "*")), "DENY");
    assert.equal(f.state.calls, 0);
  });
  await t.test("DENY unsupported signed HS256 despite valid claims", async () => {
    await denied(tokenClaims(), 0, {}, "HS256");
  });
  await t.test("DENY issuer, API audience, expiry and not-before failures", async () => {
    for (const claims of [
      {...tokenClaims(), iss: "https://wrong.synthetic.test/"},
      {...tokenClaims(), aud: "https://wrong.synthetic.test"},
      {...tokenClaims(), aud: [USERINFO, "https://wrong.synthetic.test"]},
      {...tokenClaims(), aud: undefined},
      {...tokenClaims(), exp: tokenTime() - 5},
      {...tokenClaims(), nbf: tokenTime() + 3600},
    ]) await denied(claims);
  });
  await t.test("DENY scope, openid, invalid subject and machine identity", async () => {
    for (const claims of [
      {...tokenClaims(), scope: OPENID},
      {...tokenClaims(), scope: READ},
      {...tokenClaims(), scope: ""},
      {...tokenClaims(), sub: undefined},
      {...tokenClaims(), sub: ""},
      {...tokenClaims(), sub: "synthetic subject with spaces"},
      {...tokenClaims(), sub: "machine@clients"},
      {...tokenClaims(), gty: "client-credentials"},
      {...tokenClaims(), gty: "client_credentials"},
      {...tokenClaims(), grant_type: "client_credentials"},
      {...tokenClaims(), gty: "authorization_code", grant_type: "client_credentials"},
      {...tokenClaims(), gty: "authorization_code", grant_type: "refresh_token"},
      {...tokenClaims(), gty: 42},
      {...tokenClaims(), gty: "unknown-grant"},
    ]) await denied(claims);
  });
  await t.test("DENY unsupported and ambiguous verified audiences (legacy JWT may accept)", async () => {
    for (const aud of [
      [API, "https://evil.synthetic.test/userinfo"],
      [API, USERINFO, "https://extra.synthetic.test"],
      [API, USERINFO, USERINFO],
      [API, API],
      [API, ""],
      [API, 12],
      [API],
      ["https://wrong.synthetic.test", USERINFO],
    ]) await denied({...tokenClaims(), aud});
    await denied({...tokenClaims(), aud:[API, USERINFO], scope:READ});
  });
  await t.test("DENY incomplete or conflicting /userinfo responses, with no identity output", async () => {
    for (const response of [
      {body: {sub: "auth0|other"}},
      {body: {sub: ""}},
      {body: {email: "synthetic@example.invalid"}},
      {body: "{unparseable"},
      {body: {sub:subject, note:"X".repeat(5000)}},
      {reportedLength:5000},
      {status:401},
      {status:500},
      {status:302, redirected:true},
      {redirected:true},
      {url:"https://other.synthetic.test/userinfo"},
      {contentType:"text/html"},
      {error:true},
    ]) await denied(tokenClaims(), 1, response);
  });
  await t.test("DENY unavailable /userinfo and enforce bounded timeout", async () => {
    const f = fixture({hang:true, timeoutMs:25});
    assert.equal(await f.gate.check(await sign()), "DENY");
    assert.equal(f.state.calls, 1);
  });
  await t.test("DENY observer exception with the real signed JWT verifier", async () => {
    const verifier = createProjectDocumentsJwtTokenVerifier(config, {
      requireRs256:true,
      verifiedSubjectObserver() { throw new Error("Synthetic secret must never escape."); },
    });
    const signed = await sign();
    await assert.rejects(() => verifier.verifyAccessToken(signed),
      error => error?.code === "project-documents-auth-invalid");
  });
  await t.test("legacy MCP auth shape and audience matching unchanged", async () => {
    const base = tokenClaims();
    const verifier = createProjectDocumentsTokenVerifier({
      config, async verifyJwt(){return {...base, aud:[API,"arbitrary-secondary"]};},
    });
    const auth = await verifier.verifyAccessToken("synthetic-only");
    assert.deepEqual(Object.keys(auth).sort(), ["token","clientId","scopes","expiresAt","resource"].sort());
    assert.equal(auth.scopes.includes(READ), true);
    assert.equal(Object.hasOwn(auth,"subject"), false);
  });
  await t.test("zero authority, zero content, and sanitized output surface", async () => {
    const f = fixture({error:true});
    const logs=[];
    const prior = [console.log, console.error, console.warn];
    try {
      console.log = (...values) => logs.push(values);
      console.error = (...values) => logs.push(values);
      console.warn = (...values) => logs.push(values);
      const value = await f.gate.check(await sign());
      assert.equal(value, "DENY");
      assert.deepEqual(Object.keys(f.gate), ["check"]);
    } finally {
      [console.log, console.error, console.warn] = prior;
    }
    assert.deepEqual(logs, []);
    const modulePath = require.resolve("../sync-service/pocket-handover-verified-subject-binding.js");
    assert.equal(Object.hasOwn(require.cache, modulePath), false, "no owner-binding module loaded");
    const runtime = fs.readFileSync(path.join(__dirname,"../sync-service/pocket-project-documents-runtime.js"),"utf8");
    assert.equal(runtime.includes("pocket-handover-user-identity-preflight"), false, "no production activation");
    const proof = fs.readFileSync(path.join(__dirname,"../sync-service/pocket-handover-user-identity-preflight.js"),"utf8");
    for(const name of ["pg", "pool.query", "createHandoverVerifiedSubjectBinding",
      "createHandoverReleaseSafetyStore", "publishPointer", "issueCapability",
      "approvalReceipt", "PocketSync", "readProjectDocument", "console."]) {
      assert.equal(proof.includes(name), false, "no forbidden authority/storage/logging: "+name);
    }
    assert.equal(jwksRequests > 0, true);
  });
});
