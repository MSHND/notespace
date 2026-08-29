"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createServiceCore } = require("../sync-service/pocket-sync-service-core.js");
const { ROUTES, createHttpAdapter } = require("../sync-service/pocket-sync-http-adapter.js");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://sync.pocket.example";

function objectHeadStore() {
  return Object.freeze({
    async putObject() { return { ok: true, created: true }; }, async getObject() { return null; },
    async presence(_id, refs) { return refs.map((storageRef) => ({ storageRef, present: false })); },
    async initialiseHead() { return Object.freeze({ schema: "pocket.starling.head.v1", revision: 0, sealRef: null }); },
    async readHead() { return null; }, async compareAndSetHead() { return { ok: false, reason: "head-conflict" }; },
  });
}

function coreConfig(overrides = {}) {
  return {
    store: Object.freeze({ async transact(_mode, callback) { return callback(Object.freeze({ async get() { return null; }, async insert() {}, async replace() {}, async remove() {} })); } }),
    objectHeadStore: objectHeadStore(),
    webAuthnVerifier: Object.freeze({ async verifyRegistration() {}, async verifyAuthentication() {} }),
    recoveryProofVerifier: Object.freeze({ async verifyRecoveryProof() {} }), randomBytes() { return new Uint8Array(32); }, now() { return Date.parse("2032-01-01T00:00:00.000Z"); },
    trustedOrigin: ORIGIN, rpId: "sync.pocket.example", rpName: "Pocket", credentialAlgorithms: [-7], ceremonyLifetimeMs: 300000, sessionLifetimeMs: 2592000000,
    ...overrides,
  };
}

function invocation(body) {
  return { context: { method: "POST", origin: ORIGIN, fetchSite: "same-origin", contentType: "application/json", sessionId: null }, body };
}

function authenticatedCore(options = {}) {
  const record = { format: "pocket.sync.content.opaque", version: 1, algorithm: "AES-GCM-256", nonce: "AAAAAAAAAAAAAAAA", ciphertext: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE" };
  const ref = "proof-ref:v1:seal";
  const heads = new Map(), argumentsSeen = [], reads = []; let calls = 0;
  const objectHeadStore = Object.freeze({
    async putObject(...args) { calls += 1; argumentsSeen.push(["putObject", args]); if (options.throwCode) { const error = new Error("provider SQL sentinel"); error.code = options.throwCode; error.providerCode = "PG-23505"; error.sql = "SELECT provider sentinel"; options.capturedError = error; throw error; } return { ok: true, created: args[1] !== "again" }; },
    async getObject(...args) { calls += 1; argumentsSeen.push(["getObject", args]); if (options.throwMethod === "get") { const error=new Error("provider SQL sentinel"); error.code=options.throwCode; throw error; } return args[1] === "missing" ? null : record; },
    async presence(_pocket, refs) { calls += 1; argumentsSeen.push(["presence", [_pocket,refs]]); if (options.throwMethod === "presence") { const error=new Error("provider SQL sentinel"); error.code=options.throwCode; throw error; } return refs.map((storageRef) => ({ storageRef, present: true })); },
    async initialiseHead(pocket) { calls += 1; if (!heads.has(pocket)) heads.set(pocket, { schema: "pocket.starling.head.v1", revision: 0, sealRef: null }); return heads.get(pocket); },
    async readHead(pocket) { calls += 1; return heads.get(pocket) || null; },
    async compareAndSetHead(pocket, expected, candidate) { calls += 1; const current = heads.get(pocket); if (JSON.stringify(current) !== JSON.stringify(expected)) return { ok: false, reason: "head-conflict" }; const head = { schema: "pocket.starling.head.v1", revision: current.revision + 1, sealRef: candidate }; heads.set(pocket, head); return { ok: true, head }; },
  });
  const id = "account", sessionId = "session", credentialId = "credential", pocket = "pocket";
  const rows = new Map([[`sessions\0${sessionId}`, { kind:"pocket.sync.service-session",schemaVersion:1,storeVersion:1,sessionId,accountId:id,credentialId,status:"active",createdAt:"2032-01-01T00:00:00.000Z",expiresAt:"2033-01-01T00:00:00.000Z",replacedBy:null }], [`accounts\0${id}`, { kind:"pocket.sync.service-account",schemaVersion:1,storeVersion:1,accountId:id,accountPolicyVersion:1,prfEvaluationInput:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",credentialIds:[credentialId],syncedPocketId:pocket,createdAt:"2032-01-01T00:00:00.000Z" }], [`credentials\0${credentialId}`, { kind:"pocket.sync.service-credential",schemaVersion:1,storeVersion:1,credentialId,accountId:id,credentialVersion:1,status:"active",publicKey:"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",publicKeyAlgorithm:-7,signCount:0,transports:["internal"],backupEligible:true,backedUp:false,createdAt:"2032-01-01T00:00:00.000Z" }]]);
  if (options.unconfigured) rows.get(`accounts\0${id}`).syncedPocketId = null;
  if (options.boundPocket) rows.get(`accounts\0${id}`).syncedPocketId = options.boundPocket;
  const generic = Object.freeze({ async transact(_mode, fn) { return fn(Object.freeze({ async get(collection,key) { reads.push([collection,key]); return rows.get(`${collection}\0${key}`) || null; }, async insert(){},async replace(){},async remove(){} })); } });
  return { core:createServiceCore(coreConfig({ store:generic, objectHeadStore })), sessionId, pocket, ref, record, calls:()=>calls, argumentsSeen, reads };
}

test("P119b executes authenticated object and Head delegation without reading Pocket", async () => {
  const h=authenticatedCore(); const call=(body)=>({context:{method:"POST",origin:ORIGIN,fetchSite:"same-origin",contentType:"application/json",sessionId:h.sessionId},body});
  assert.equal((await h.core.putOpaqueObject(call({apiVersion:1,operationId:"op",syncedPocketId:h.pocket,storageRef:h.ref,record:h.record}))).body.created,true);
  assert.deepEqual((await h.core.getOpaqueObject(call({apiVersion:1,operationId:"op",syncedPocketId:h.pocket,storageRef:"missing"}))).body.record,null);
  const genesis=(await h.core.initialiseShadowHead(call({apiVersion:1,operationId:"op",syncedPocketId:h.pocket}))).body.head;
  assert.equal((await h.core.compareAndSetShadowHead(call({apiVersion:1,operationId:"op",syncedPocketId:h.pocket,expectedHead:genesis,candidateSealStorageRef:h.ref}))).status,200);
  assert.equal((await h.core.compareAndSetShadowHead(call({apiVersion:1,operationId:"op",syncedPocketId:h.pocket,expectedHead:genesis,candidateSealStorageRef:h.ref}))).status,409);
});

test("P119c executes authority, opaque delegation, and safe errors through the real core", async () => {
  const h=authenticatedCore(), call=(body,pocket=h.pocket)=>({context:{method:"POST",origin:ORIGIN,fetchSite:"same-origin",contentType:"application/json",sessionId:h.sessionId},body:{...body,syncedPocketId:pocket}});
  const put={apiVersion:1,operationId:"op",storageRef:h.ref,record:h.record};
  await h.core.putOpaqueObject(call(put));
  assert.deepEqual(h.argumentsSeen[0], ["putObject", [h.pocket,h.ref,h.record]]);
  assert.equal(h.reads.some(([collection])=>collection==="pockets"),false);
  assert.deepEqual((await h.core.objectPresence(call({apiVersion:1,operationId:"op",storageRefs:["b","a"]}))).body.rows,[{storageRef:"b",present:true},{storageRef:"a",present:true}]);
  await assert.rejects(h.core.readShadowHead(call({apiVersion:1,operationId:"op"},"other")),(error)=>error.code==="service-authorisation-failed");
  const unconfigured=authenticatedCore({unconfigured:true});
  await assert.rejects(unconfigured.core.readShadowHead({context:{method:"POST",origin:ORIGIN,fetchSite:"same-origin",contentType:"application/json",sessionId:unconfigured.sessionId},body:{apiVersion:1,operationId:"op",syncedPocketId:unconfigured.pocket}}),(error)=>error.code==="service-authorisation-failed");
  const failure=authenticatedCore({throwCode:"object-head-store-storage-failed"});
  await assert.rejects(failure.core.putOpaqueObject({context:{method:"POST",origin:ORIGIN,fetchSite:"same-origin",contentType:"application/json",sessionId:failure.sessionId},body:{apiVersion:1,operationId:"op",syncedPocketId:failure.pocket,storageRef:failure.ref,record:failure.record}}),(error)=>error.code==="service-storage-failed"&&error.status===503&&error.retryable===true);
});

test("P119d executes all object authority and exact object operation outcomes", async () => {
  const body={putOpaqueObject:(h)=>({apiVersion:1,operationId:"op",syncedPocketId:h.pocket,storageRef:h.ref,record:h.record}),getOpaqueObject:(h)=>({apiVersion:1,operationId:"op",syncedPocketId:h.pocket,storageRef:h.ref}),objectPresence:(h)=>({apiVersion:1,operationId:"op",syncedPocketId:h.pocket,storageRefs:["z","a"]})};
  for (const [label, options, code] of [["missing",{},"service-authentication-required"],["different",{boundPocket:"other"},"service-authorisation-failed"],["unconfigured",{unconfigured:true},"service-authorisation-failed"]]) {
    const h=authenticatedCore(options); for (const method of Object.keys(body)) await assert.rejects(h.core[method]({context:{method:"POST",origin:ORIGIN,fetchSite:"same-origin",contentType:"application/json",sessionId:label==="missing"?null:h.sessionId},body:body[method](h)}),(error)=>error.code===code);
  }
  const h=authenticatedCore(), call=(method, extra={})=>({context:{method:"POST",origin:ORIGIN,fetchSite:"same-origin",contentType:"application/json",sessionId:h.sessionId},body:{...body[method](h),...extra}});
  assert.equal((await h.core.putOpaqueObject(call("putOpaqueObject"))).body.created,true);
  assert.equal((await h.core.putOpaqueObject(call("putOpaqueObject",{storageRef:"again"}))).body.created,false);
  assert.equal((await h.core.getOpaqueObject(call("getOpaqueObject"))).body.present,true);
  assert.deepEqual((await h.core.getOpaqueObject(call("getOpaqueObject",{storageRef:"missing"}))).body,{apiVersion:1,ok:true,operationId:"op",syncedPocketId:h.pocket,storageRef:"missing",present:false,record:null});
  assert.deepEqual((await h.core.objectPresence(call("objectPresence"))).body.rows,[{storageRef:"z",present:true},{storageRef:"a",present:true}]);
  assert.equal(h.reads.some(([collection])=>collection==="pockets"),false);
  for (const [method, throwMethod] of [["putOpaqueObject",undefined],["objectPresence","presence"]]) { const bad=authenticatedCore({throwCode:"object-head-store-ref-invalid",throwMethod}); await assert.rejects(bad.core[method]({context:{method:"POST",origin:ORIGIN,fetchSite:"same-origin",contentType:"application/json",sessionId:bad.sessionId},body:body[method](bad)}),(error)=>error.code==="service-request-invalid"&&error.status===400); }
});

test("P119e PUT delegates exactly and redacts request errors", async () => {
  const h=authenticatedCore(), request={context:{method:"POST",origin:ORIGIN,fetchSite:"same-origin",contentType:"application/json",sessionId:h.sessionId},body:{apiVersion:1,operationId:"op",syncedPocketId:h.pocket,storageRef:h.ref,record:h.record}};
  assert.deepEqual((await h.core.putOpaqueObject(request)).body,{apiVersion:1,ok:true,operationId:"op",syncedPocketId:h.pocket,storageRef:h.ref,created:true});
  const bad=authenticatedCore({throwCode:"object-head-store-ref-invalid"}); await assert.rejects(bad.core.putOpaqueObject({...request,context:{...request.context,sessionId:bad.sessionId},body:{...request.body,syncedPocketId:bad.pocket,storageRef:bad.ref,record:bad.record}}),(e)=>e.code==="service-request-invalid"&&e.status===400);
});

test("P119f PUT object service contract proves both outcomes and redaction", async () => {
  const run=async (options={},storageRef="proof-ref:v1:seal")=>{const h=authenticatedCore(options), value={context:{method:"POST",origin:ORIGIN,fetchSite:"same-origin",contentType:"application/json",sessionId:h.sessionId},body:{apiVersion:1,operationId:"put",syncedPocketId:h.pocket,storageRef,record:h.record}}; return {h,value,result:await h.core.putOpaqueObject(value)};};
  const created=await run();
  assert.equal(created.h.calls(),1); assert.deepEqual(created.h.argumentsSeen[0],["putObject",[created.h.pocket,created.h.ref,created.h.record]]);
  assert.deepEqual(created.result,{status:200,body:{apiVersion:1,ok:true,operationId:"put",syncedPocketId:created.h.pocket,storageRef:created.h.ref,created:true},session:null});
  const existing=await run({},"again");
  assert.equal(existing.h.calls(),1); assert.deepEqual(existing.h.argumentsSeen[0],["putObject",[existing.h.pocket,"again",existing.h.record]]); assert.deepEqual(existing.result,{status:200,body:{apiVersion:1,ok:true,operationId:"put",syncedPocketId:existing.h.pocket,storageRef:"again",created:false},session:null});
  const options={throwCode:"object-head-store-ref-invalid"}, h=authenticatedCore(options), value={context:{method:"POST",origin:ORIGIN,fetchSite:"same-origin",contentType:"application/json",sessionId:h.sessionId},body:{apiVersion:1,operationId:"put",syncedPocketId:h.pocket,storageRef:h.ref,record:h.record}};
  await assert.rejects(h.core.putOpaqueObject(value),(error)=>{const exposed={message:error.message,...error}; return error.code==="service-request-invalid"&&error.status===400&&!JSON.stringify(exposed).match(/provider SQL sentinel|PG-23505|SELECT provider sentinel/);}); assert.equal(h.calls(),1); assert.match(options.capturedError.message,/provider SQL sentinel/); assert.equal(options.capturedError.providerCode,"PG-23505"); assert.equal(options.capturedError.sql,"SELECT provider sentinel");
});

test("P119h rejects a nonexistent session for every object service method before delegation", async () => {
  const h=authenticatedCore(), context={method:"POST",origin:ORIGIN,fetchSite:"same-origin",contentType:"application/json",sessionId:"does-not-exist"};
  for (const [method,body] of [["putOpaqueObject",{apiVersion:1,operationId:"op",syncedPocketId:h.pocket,storageRef:h.ref,record:h.record}],["getOpaqueObject",{apiVersion:1,operationId:"op",syncedPocketId:h.pocket,storageRef:h.ref}],["objectPresence",{apiVersion:1,operationId:"op",syncedPocketId:h.pocket,storageRefs:[h.ref]}]]) {
    const before=h.calls(); await assert.rejects(h.core[method]({context,body}),(error)=>error.code==="service-session-invalid"); assert.equal(h.calls(),before);
  }
  assert.equal(h.reads.some(([collection])=>collection==="pockets"),false);
});

test("P119h rejects a nonexistent session before every object store call", async () => {
  const h=authenticatedCore(), context={method:"POST",origin:ORIGIN,fetchSite:"same-origin",contentType:"application/json",sessionId:"does-not-exist"}, bodies={putOpaqueObject:{apiVersion:1,operationId:"op",syncedPocketId:h.pocket,storageRef:h.ref,record:h.record},getOpaqueObject:{apiVersion:1,operationId:"op",syncedPocketId:h.pocket,storageRef:h.ref},objectPresence:{apiVersion:1,operationId:"op",syncedPocketId:h.pocket,storageRefs:[h.ref]}};
  for (const method of Object.keys(bodies)) await assert.rejects(h.core[method]({context,body:bodies[method]}),(error)=>error.code==="service-session-invalid");
  assert.equal(h.calls(),0); assert.equal(h.reads.some(([collection])=>collection==="pockets"),false);
});

test("P119e GET and presence preserve exact delegated values", async () => {
  const h=authenticatedCore(), context={method:"POST",origin:ORIGIN,fetchSite:"same-origin",contentType:"application/json",sessionId:h.sessionId};
  assert.equal((await h.core.getOpaqueObject({context,body:{apiVersion:1,operationId:"op",syncedPocketId:h.pocket,storageRef:h.ref}})).body.present,true);
  assert.equal((await h.core.getOpaqueObject({context,body:{apiVersion:1,operationId:"op",syncedPocketId:h.pocket,storageRef:"missing"}})).body.record,null);
  assert.deepEqual((await h.core.objectPresence({context,body:{apiVersion:1,operationId:"op",syncedPocketId:h.pocket,storageRefs:["b","a"]}})).body.rows,[{storageRef:"b",present:true},{storageRef:"a",present:true}]);
});

test("P119 requires the exact object/Head store surface and rejects unauthenticated calls", async () => {
  const config = coreConfig();
  for (const candidate of [undefined, {}, { ...objectHeadStore(), extra() {} },
    { ...objectHeadStore(), putObject: null }]) {
    assert.throws(() => createServiceCore({ ...config, objectHeadStore: candidate }), /service-core-invalid/);
  }
  const core = createServiceCore(config);
  for (const [method, body] of [
    ["putOpaqueObject", { apiVersion: 1, operationId: "op", syncedPocketId: "pocket", storageRef: "opaque", record: {} }],
    ["getOpaqueObject", { apiVersion: 1, operationId: "op", syncedPocketId: "pocket", storageRef: "opaque" }],
    ["objectPresence", { apiVersion: 1, operationId: "op", syncedPocketId: "pocket", storageRefs: [] }],
    ["initialiseShadowHead", { apiVersion: 1, operationId: "op", syncedPocketId: "pocket" }],
    ["readShadowHead", { apiVersion: 1, operationId: "op", syncedPocketId: "pocket" }],
    ["compareAndSetShadowHead", { apiVersion: 1, operationId: "op", syncedPocketId: "pocket", expectedHead: {}, candidateSealStorageRef: "opaque" }],
  ]) await assert.rejects(core[method](invocation(body)), (error) => error?.code === "service-authentication-required");
});

test("P119 keeps the transport contract bounded and maps safe object-store errors", async () => {
  const coreSource = fs.readFileSync(path.join(ROOT, "sync-service/pocket-sync-service-core.js"), "utf8");
  const adapterSource = fs.readFileSync(path.join(ROOT, "sync-service/pocket-sync-http-adapter.js"), "utf8");
  const runtimeSource = fs.readFileSync(path.join(ROOT, "sync-service/pocket-sync-server-runtime.js"), "utf8");
  assert.match(coreSource, /object-head-store-state-invalid[\s\S]*service-state-invalid/);
  assert.match(coreSource, /object-head-store-storage-failed[\s\S]*service-storage-failed/);
  assert.match(adapterSource, /putOpaqueObject[\s\S]*contentJsonLimitBytes/);
  assert.match(adapterSource, /getOpaqueObject[\s\S]*contentJsonLimitBytes/);
  assert.match(adapterSource, /compareAndSetShadowHead[\s\S]*Object\.freeze\(\[200, 409\]\)/);
  assert.match(runtimeSource, /createPostgresStore\(\{ pool \}\)[\s\S]*createObjectHeadPostgresStore\(\{ pool \}\)/);
  assert.doesNotMatch([coreSource, adapterSource].join("\n"), /deleteOpaqueObject|updateOpaqueObject|listOpaqueObject|forceSetHead|deleteHead/);
});

test("P119 exposes exactly six authenticated POST transport routes without browser adoption", () => {
  assert.deepEqual(Object.entries(ROUTES).filter(([name]) => /Object|Presence|ShadowHead/.test(name)), [
    ["putOpaqueObject", "/pockets/objects/put"], ["getOpaqueObject", "/pockets/objects/get"], ["objectPresence", "/pockets/objects/presence"],
    ["initialiseShadowHead", "/pockets/head/initialise"], ["readShadowHead", "/pockets/head/read"], ["compareAndSetShadowHead", "/pockets/head/compare-and-set"],
  ]);
  const core = Object.fromEntries(Object.keys(ROUTES).map((name) => [name, async () => ({ status: 200, body: { apiVersion: 1, ok: true }, session: null })]));
  assert.doesNotThrow(() => createHttpAdapter({ core, trustedOrigin: ORIGIN, serviceRoot: "/pocket-sync/v1" }));
  const browser = ["js/pocket-sync-remote-client.js", "js/pocket-sync-owner-controller.js", "index.html"].map((file) => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");
  assert.doesNotMatch(browser, /pockets\/(objects|head)/);
});
