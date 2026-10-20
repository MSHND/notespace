"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const ISSUER = "https://auth.synthetic.example/";
const API = "https://pocket.synthetic.example/project-docs/mcp";
const READ = "pocket.project-documents.read";
const CLIENT = "synthetic-owner-confirmed-chatgpt-client";
const now = () => Math.floor(Date.now() / 1000);
const baseClaims = () => ({
  iss: ISSUER, aud: API, sub: "auth0|disposable-user",
  azp: CLIENT, scope: READ, exp: now() + 600, iat: now() - 3,
  nbf: now() - 2, gty: "authorization_code",
});

test("P349 diagnostic: genuine JOSE, one-tool HTTP MCP and forbidden-module isolation", async t => {
  const forbidden = /(?:^pg$|pocket-project-documents-(?:runtime|postgres|mcp|application)|pocket-sync-(?:server|production)|pocket-handover-(?:release|verified-subject)|pocket-account)/;
  const before = new Set(Object.keys(require.cache));
  const originalLoad = Module._load;
  let forbiddenLoads = 0;
  Module._load = function(request, parent, isMain) {
    if (forbidden.test(request)) {
      forbiddenLoads++;
      throw new Error("Forbidden Pocket data module requested");
    }
    return originalLoad.apply(this, arguments);
  };
  let makeDiagnostic;
  try {
    ({createPocketConnectionDiagnostic: makeDiagnostic} =
      require("../sync-service/pocket-connection-diagnostic.js"));
  } finally { Module._load = originalLoad; }
  assert.equal(forbiddenLoads, 0);
  const newlyLoaded = Object.keys(require.cache).filter(x => !before.has(x));
  assert.equal(newlyLoaded.some(x => forbidden.test(x)), false);

  const jose = await import("jose");
  const pair = await jose.generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
  const rsaPublic = await jose.exportJWK(pair.publicKey);
  Object.assign(rsaPublic, {kid:"disposable-key", alg:"RS256", use:"sig"});
  let jwksReads = 0;
  const jwks = http.createServer((req, res) => {
    jwksReads++;
    res.writeHead(200, {"content-type":"application/json"});
    res.end(JSON.stringify({keys:[rsaPublic]}));
  });
  await new Promise(resolve => jwks.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => jwks.close(resolve)); });
  const config = Object.freeze({
    issuer: ISSUER, audience: API, resourceUrl: API, mcpRoot: "/project-docs/mcp",
    resourceMetadataUrl: "https://pocket.synthetic.example/.well-known/oauth-protected-resource/project-docs/mcp",
    jwksUrl: "http://127.0.0.1:" + jwks.address().port + "/jwks",
    readScope: READ, writeScope: "pocket.project-documents.write",
  });
  const registration = Object.freeze({
    verified: true, thirdPartyCimd: true, delegatedOnly: true,
    machineGrantsDisabled: true, clientId: CLIENT, issuer: ISSUER,
  });
  const instance = (reg = registration) => makeDiagnostic({
    diagnosticOnly: true, config, registeredClient: reg,
  });
  const sign = async (claims = baseClaims(), alg = "RS256") => new jose.SignJWT(claims)
    .setProtectedHeader({alg, kid:"disposable-key"})
    .sign(alg === "HS256" ? new TextEncoder().encode("synthetic-only-hmac-signing-key") : pair.privateKey);
  const diagnostic = instance();

  await t.test("positive: genuine signed RS256, exact issuer/audience, verified approved client, delegated claim", async () => {
    assert.equal(await diagnostic.checkToken(await sign()), "PASS");
    assert.ok(jwksReads > 0, "genuine JOSE remote JWKS used");
  });
  await t.test("positive: missing optional grant claim supported by owner-verified delegated-only registration", async () => {
    const claims = baseClaims(); delete claims.gty;
    assert.equal(await diagnostic.checkToken(await sign(claims)), "PASS");
    assert.equal(await diagnostic.checkToken(await sign({...claims, client_id:CLIENT, azp:undefined})), "PASS");
    assert.equal(await diagnostic.checkToken(await sign({...claims, gty:"refresh_token"})), "PASS");
  });

  const denied = async (claims, expected = "DENY", alg = "RS256") =>
    assert.equal(await diagnostic.checkToken(await sign(claims, alg)), expected);
  await t.test("negative: malformed/tampered signature, wrong issuer/audience, unsupported algorithm, time, missing scope", async () => {
    const jwt = await sign(), parts = jwt.split(".");
    const replacement = (await sign({...baseClaims(), sub:"auth0|forged-user"})).split(".");
    assert.equal(await diagnostic.checkToken([parts[0], replacement[1], parts[2]].join(".")), "DENY");
    assert.equal(await diagnostic.checkToken("garbage"), "DENY");
    await denied(baseClaims(), "DENY", "HS256");
    for (const c of [
      {...baseClaims(), iss:"https://wrong.synthetic.example/"},
      {...baseClaims(), aud:"https://wrong.synthetic.example/"},
      {...baseClaims(), aud:[API, "https://additional.synthetic.example/"]},
      {...baseClaims(), aud:[API]},
      {...baseClaims(), aud:[API, API]},
      {...baseClaims(), exp:now()-10},
      {...baseClaims(), nbf:now()+1000},
      {...baseClaims(), iat:now()+1000},
      {...baseClaims(), scope:"pocket.project-documents.write"},
    ]) await denied(c);
  });
  await t.test("negative: missing, invalid, conflicting and wrong client attribution", async () => {
    await denied({...baseClaims(), azp:undefined}, "UNVERIFIED");
    await denied({...baseClaims(), azp:undefined, client_id:undefined}, "UNVERIFIED");
    await denied({...baseClaims(), azp:"some-other-client"}, "DENY");
    await denied({...baseClaims(), azp:CLIENT, client_id:"other-client"}, "UNVERIFIED");
    await denied({...baseClaims(), azp:42}, "UNVERIFIED");
    await denied({...baseClaims(), azp:undefined, client_id:CLIENT}, "PASS");
    await denied({...baseClaims(), azp:CLIENT, client_id:CLIENT}, "PASS");
  });
  await t.test("negative: machines, impossible grants, contradictory grants, malformed subjects", async () => {
    for (const c of [
      {...baseClaims(), sub:"test-machine@clients"},
      {...baseClaims(), gty:"client_credentials"},
      {...baseClaims(), gty:"client-credentials"},
      {...baseClaims(), grant_type:"client_credentials"},
      {...baseClaims(), grant_type:"password"},
      {...baseClaims(), token_use:"id"},
      {...baseClaims(), sub:"bad subject"},
      {...baseClaims(), sub:undefined},
      {...baseClaims(), sub:""},
      {...baseClaims(), sub:42},
    ]) await denied(c);
    await denied({...baseClaims(), gty:"authorization_code", grant_type:"refresh_token"}, "UNVERIFIED");
    await denied({...baseClaims(), gty:"unknown_new_grant"}, "UNVERIFIED");
    await denied({...baseClaims(), grant_type:123}, "UNVERIFIED");
  });

  await t.test("registration must be independently trusted, never inferred from subject/client field", async () => {
    for (const patch of [
      {verified:false}, {thirdPartyCimd:false}, {delegatedOnly:false},
      {machineGrantsDisabled:false}, {clientId:""}, {issuer:"https://wrong.synthetic.example/"},
    ]) assert.throws(() => instance({...registration, ...patch}));
    assert.throws(() => makeDiagnostic({config, registeredClient:registration}));
    assert.throws(() => makeDiagnostic({
      diagnosticOnly:true, config,
      registeredClient:{...registration, clientId: "auth0|disposable-user", verified:false},
    }));
  });

  await t.test("HTTP MCP: only diagnostic tool, no ordinary Project Documents tools or store", async () => {
    const local = http.createServer((req,res) => {
      Promise.resolve(diagnostic.matches(req) ? diagnostic.handle(req,res)
        : (res.writeHead(404),res.end())).catch(() => {
          if (!res.headersSent) {res.writeHead(500);res.end();}
        });
    });
    await new Promise(resolve => local.listen(0, "127.0.0.1", resolve));
    t.after(async () => { await new Promise(resolve => local.close(resolve)); });
    const url = "http://127.0.0.1:" + local.address().port + config.mcpRoot;
    const token = await sign();
    const rpc = async (method, params, id) => {
      const response = await fetch(url, {
        method:"POST",
        headers: {
          Authorization:"Bearer " + token,
          Accept:"application/json, text/event-stream",
          "Content-Type":"application/json",
          "MCP-Protocol-Version":"2025-06-18",
        },
        body:JSON.stringify({jsonrpc:"2.0",id,method,params}),
      });
      const body = await response.text();
      if (response.status !== 200) throw new Error("Synthetic RPC non-200 " + response.status);
      const text = body.includes("data: ") ? body.split("\n").filter(x=>x.startsWith("data: ")).at(-1).slice(6) : body;
      return JSON.parse(text);
    };
    const initialize = await rpc("initialize", {
      protocolVersion:"2025-06-18",capabilities:{},
      clientInfo:{name:"disposable",version:"1.0"},
    },1);
    assert.equal(initialize.result?.serverInfo?.name,"pocket-connection-diagnostic");
    const listed = await rpc("tools/list", {}, 2);
    assert.deepEqual(listed.result?.tools?.map(x=>x.name), ["connection_identity_check"]);
    const checked = await rpc("tools/call", {
      name:"connection_identity_check", arguments:{},
    },3);
    assert.deepEqual(checked.result?.structuredContent, {result:"PASS"});
    const wrong = await rpc("tools/call", {
      name:"read_project_document", arguments:{name:"secret"},
    },4);
    assert.ok(wrong.error);
    for (const name of ["list_project_documents","read_project_document",
      "create_project_document","update_project_document"]) {
      assert.ok(!listed.result.tools.some(t=>t.name===name));
    }
    const unauthorized = await fetch(url,{
      method:"POST",
      headers: {Accept:"application/json, text/event-stream","Content-Type":"application/json"},
      body:JSON.stringify({jsonrpc:"2.0",id:5,method:"tools/list",params:{}}),
    });
    assert.equal(unauthorized.status,401);
    const text = await unauthorized.text();
    assert.equal(text.includes("disposable-user"),false);
    assert.ok(unauthorized.headers.get("www-authenticate")?.includes(config.resourceMetadataUrl));
    assert.equal((await fetch(url,{method:"GET"})).status,405);
    assert.equal((await fetch("http://127.0.0.1:"+local.address().port+"/documents")).status,404);
  });

  await t.test("zero-data: no data runtime/config routing modified; one import, no persistent storage", () => {
    const sourcePath = require.resolve("../sync-service/pocket-connection-diagnostic.js");
    const source = fs.readFileSync(sourcePath,"utf8");
    const imports = [...source.matchAll(/require\("([^"]+)"\)/g)].map(x=>x[1]);
    assert.deepEqual(imports, [
      "@modelcontextprotocol/sdk/server/index.js",
      "@modelcontextprotocol/sdk/server/streamableHttp.js",
      "@modelcontextprotocol/sdk/types.js",
      "./pocket-project-documents-auth.js",
    ]);
    const prohibited = ["new Pool(", "pool.query(", "postgres", "createProjectDocumentsRuntime",
      "createProjectDocumentsMcpServer", "createHandoverVerifiedSubjectBinding",
      "resolvePrincipal(", "publishPointer(", "registerPasskey(", "read_project_document"];
    for (const bad of prohibited) {
      if (bad === "read_project_document") continue; // absent from implementation, checked below
      assert.equal(source.includes(bad),false,bad);
    }
    assert.equal(source.includes('"read_project_document"'),false);
    assert.equal(source.includes("console."),false);
    assert.equal(source.includes("JSON.stringify(claims)"),false);
    const prod = fs.readFileSync(path.resolve(__dirname,"../sync-service/pocket-sync-production-server.js"),"utf8");
    const runtime = fs.readFileSync(path.resolve(__dirname,"../sync-service/pocket-project-documents-runtime.js"),"utf8");
    assert.equal(prod.includes("pocket-connection-diagnostic"),false);
    assert.equal(runtime.includes("pocket-connection-diagnostic"),false);
    assert.equal(forbiddenLoads,0);
    assert.equal(["PASS","DENY","UNVERIFIED"].length,3);
    assert.equal(JSON.stringify({result:"PASS"}).includes("disposable-user"),false);
  });
});
