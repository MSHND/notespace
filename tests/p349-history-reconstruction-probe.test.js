"use strict";
// P349 isolated regression/negative proof. Synthetic identities and in-memory
// SQL adapter only: NOT a PostgreSQL trigger, real OAuth or publish authority.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {fakeTransactionalPool}=require("./helpers/p349-dormant-transaction-fake.js");
const {NAMES} = require("../sync-service/pocket-handover-release-witness.js");
const {SQL,createHandoverReleaseSafetyStore} =
  require("../sync-service/pocket-handover-release-safety-store.js");
const {captureVerifiedRelease,reconstructVerifiedRelease} =
  require("../sync-service/pocket-handover-release-reconstruction-probe.js");
const hash = s => createHash("sha256").update(s, "utf8").digest("hex");

function fixture() {
  const entries=new Map(), pointers=new Map();
  const auth = Object.freeze({
    aliceStage: Object.freeze({}), aliceRead: Object.freeze({}),
    alicePublish: Object.freeze({}), bobRead: Object.freeze({}),
    bobStage: Object.freeze({}), forged: Object.freeze({ownerId:"alice"}),
  });
  const identities=new WeakMap([
    [auth.aliceStage,{ownerId:"alice",resourceId:"models",principalId:"a-stage",capabilities:["stage","read"]}],
    [auth.aliceRead,{ownerId:"alice",resourceId:"models",principalId:"a-read",capabilities:["read"]}],
    [auth.alicePublish,{ownerId:"alice",resourceId:"models",principalId:"a-publish",capabilities:["read","publish"]}],
    [auth.bobRead,{ownerId:"bob",resourceId:"models",principalId:"b-read",capabilities:["read"]}],
    [auth.bobStage,{ownerId:"bob",resourceId:"models",principalId:"b-stage",capabilities:["stage","read"]}],
  ]);
  let approval=false, failure=null, queryCount=0;
  const key = (...v) => JSON.stringify(v);
  const pool=fakeTransactionalPool(async function query(sql,v=[]) {
    queryCount++;
    const entryKey=key(...v.slice(0,4));
    const pointerKey=key(...v.slice(0,2));
    let row=null;
    if (sql===SQL.createEntry) {
      if (entries.has(entryKey)) return {rowCount:0,rows:[]};
      row={owner_id:v[0],resource_id:v[1],release_id:v[2],name:v[3],
        kind:v[4],content:v[5],sha256:v[6],revision:"1"};
      entries.set(entryKey,row);
    } else if (sql===SQL.readEntry) {
      row=entries.get(entryKey) || null;
    } else if (sql===SQL.createPointer || sql===SQL.updatePointer) {
      if (failure==="before") throw new Error("synthetic interrupted before write");
      const prior=pointers.get(pointerKey);
      if (sql===SQL.createPointer && prior) return {rowCount:0,rows:[]};
      if (sql===SQL.updatePointer && (!prior || Number(prior.revision)!==v[4]))
        return {rowCount:0,rows:[]};
      row={owner_id:v[0],resource_id:v[1],release_id:v[2],content:v[3],
        revision:sql===SQL.createPointer?"1":String(Number(prior.revision)+1)};
      pointers.set(pointerKey,row);
      // Lost COMMIT acknowledgment is injected at the transaction boundary.
    } else if (sql===SQL.readPointer) {
      row=pointers.get(pointerKey) || null;
    } else { throw new Error("Unexpected synthetic SQL"); }
    return {rowCount:row?1:0,rows:row?[{...row}]:[]};
  }, {commitError:()=>failure==="after"});
  const store=createHandoverReleaseSafetyStore({
    pool,
    async resolvePrincipal(token) { return identities.get(token); },
    async verifyPublisherApproval(proof) {
      return approval ? {...proof,approved:true,revoked:false,oneAttempt:true} : null;
    },
  });
  const docText=(releaseId,name)=>"Disposable "+releaseId+" "+name+" — Café / 你好 / 🌿\n";
  const stageAll=async(releaseId="r1")=>{
    for(const name of NAMES) {
      const r=await store.createEntry({auth:auth.aliceStage,releaseId,
        name,kind:"document",content:docText(releaseId,name)});
      assert.equal(r.ok,true);
    }
  };
  const manifest=(releaseId="r1",valid=true)=>JSON.stringify({
    releaseId,authorityEpoch:"GOOGLE_ONLY",
    documents:NAMES.map(name=>({name,releaseId,
      digest:valid?hash(docText(releaseId,name)):"a".repeat(64)})),
  });
  return {entries,pointers,store,auth,stageAll,manifest,docText,
    enableApproval:()=>{approval=true;},setFailure:x=>{failure=x;},
    count:()=>queryCount,key};
}
async function denied(fn,reason) {
  await assert.rejects(fn,e=>e?.code==="handover-release-safety-denied"
    && (!reason || e.reason===reason));
}
async function exportDenied(fn,reason) {
  await assert.rejects(fn,e=>e?.code==="p349-history-probe-denied"
    && (!reason || e.reason===reason));
}

test("candidate: create-once rejects duplicate; original text and UTF-8 digest survive",async()=>{
  const f=fixture();
  const one=await f.store.createEntry({auth:f.auth.aliceStage,releaseId:"r1",
    name:NAMES[0],kind:"document",content:f.docText("r1",NAMES[0])});
  assert.equal(one.entry.digest,hash(one.entry.content));
  assert.deepEqual(await f.store.createEntry({auth:f.auth.aliceStage,releaseId:"r1",
    name:NAMES[0],kind:"document",content:"replacement"}),{ok:false,reason:"already-exists"});
  const old=await f.store.readEntry({auth:f.auth.aliceRead,releaseId:"r1",name:NAMES[0]});
  assert.equal(old.entry.content,f.docText("r1",NAMES[0]));
});

test("candidate: exact nine-document read, export, in-memory reconstruction",async()=>{
  const f=fixture();await f.stageAll();
  const bundle=await captureVerifiedRelease({store:f.store,auth:f.auth.aliceRead,
    releaseId:"r1",manifestContent:f.manifest()});
  assert.match(bundle.sha256,/^[a-f0-9]{64}$/);
  const restored=reconstructVerifiedRelease(JSON.parse(JSON.stringify(bundle)));
  assert.equal(restored.length,NAMES.length);
  assert.equal(restored[0].content,f.docText("r1",NAMES[0]));
  assert.deepEqual(restored.map(x=>x.name),NAMES);
});

test("candidate: missing entry, bogus digest, mutated storage and export tamper are rejected",async()=>{
  const f=fixture();await f.stageAll();
  const capture=()=>captureVerifiedRelease({store:f.store,auth:f.auth.aliceRead,
    releaseId:"r1",manifestContent:f.manifest()});
  await exportDenied(()=>captureVerifiedRelease({store:f.store,auth:f.auth.aliceRead,
    releaseId:"r1",manifestContent:f.manifest("r1",false)}),"entry-missing-or-invalid");
  const bundle=await capture();
  const edited=JSON.parse(JSON.stringify(bundle));
  edited.snapshot.documents[0].content="changed";
  await exportDenied(async()=>reconstructVerifiedRelease(edited),"export-fingerprint-invalid");
  edited.sha256=hash(JSON.stringify(edited.snapshot));
  await exportDenied(async()=>reconstructVerifiedRelease(edited),"entry-digest-or-identity-invalid");
  const key=f.key("alice","models","r1",NAMES[0]);
  const original=f.entries.get(key);
  original.content="tampered directly";
  await denied(()=>f.store.readEntry({auth:f.auth.aliceRead,releaseId:"r1",
    name:NAMES[0]}),"entry-integrity-invalid");
  await denied(capture,"entry-integrity-invalid");
  f.entries.delete(key);
  await exportDenied(capture,"entry-missing-or-invalid");
});

test("candidate: trusted resolver scopes tenants; caller-provided owner cannot impersonate",async()=>{
  const f=fixture();await f.stageAll();
  const before=f.count();
  await denied(()=>f.store.createEntry({auth:f.auth.forged,releaseId:"r1",
    name:NAMES[0],kind:"document",content:"spoof"}),"owner-or-capability-denied");
  assert.equal(f.count(),before);
  assert.deepEqual(await f.store.readEntry({auth:f.auth.bobRead,releaseId:"r1",
    name:NAMES[0]}),{ok:false,reason:"not-found"});
  await exportDenied(()=>captureVerifiedRelease({store:f.store,auth:f.auth.bobRead,
    releaseId:"r1",manifestContent:f.manifest()}),"entry-missing-or-invalid");
});

test("candidate: unauthorised publisher denied; stale pointer CAS cannot overwrite",async()=>{
  const f=fixture();await f.stageAll();await f.stageAll("r2");
  await denied(()=>f.store.publishPointer({auth:f.auth.aliceStage,
    releaseId:"r1",content:f.manifest(),expectedRevision:0}),
    "owner-or-capability-denied");
  await denied(()=>f.store.publishPointer({auth:f.auth.alicePublish,
    releaseId:"r1",content:f.manifest(),expectedRevision:0}),
    "publisher-approval-denied");
  assert.equal(f.pointers.size,0);
  f.enableApproval();
  const first=await f.store.publishPointer({auth:f.auth.alicePublish,
    releaseId:"r1",content:f.manifest(),expectedRevision:0});
  assert.equal(first.pointer.revision,1);
  const stale=await f.store.publishPointer({auth:f.auth.alicePublish,
    releaseId:"r2",content:f.manifest("r2"),expectedRevision:0});
  assert.deepEqual(stale,{ok:false,reason:"revision-conflict"});
  const next=await f.store.publishPointer({auth:f.auth.alicePublish,
    releaseId:"r2",content:f.manifest("r2"),expectedRevision:1});
  assert.equal(next.pointer.revision,2);
  assert.equal((await f.store.readEntry({auth:f.auth.aliceRead,releaseId:"r1",
    name:NAMES[0]})).entry.content,f.docText("r1",NAMES[0]));
  const oldExport=await captureVerifiedRelease({store:f.store,auth:f.auth.aliceRead,
    releaseId:"r1",manifestContent:f.manifest("r1")});
  assert.equal(reconstructVerifiedRelease(oldExport).length,9);
});

test("candidate: interrupted publication preserves staged entries; unknown ACK requires a fresh read",async()=>{
  for(const mode of ["before","after"]) {
    const f=fixture();await f.stageAll();f.enableApproval();
    f.setFailure(mode);
    await denied(()=>f.store.publishPointer({auth:f.auth.alicePublish,
      releaseId:"r1",content:f.manifest(),expectedRevision:0}),
      mode==="before"?"storage-failed":"publication-outcome-unknown");
    f.setFailure(null);
    const pointer=await f.store.readPointer({auth:f.auth.aliceRead});
    assert.equal(pointer.ok,mode==="after");
    assert.equal((await f.store.readEntry({auth:f.auth.aliceRead,releaseId:"r1",
      name:NAMES[0]})).ok,true);
  }
});

test("candidate: non-existent release fails closed without pointer publication",async()=>{
  const f=fixture();f.enableApproval();
  await denied(()=>f.store.publishPointer({auth:f.auth.alicePublish,
    releaseId:"r99",content:f.manifest("r99",false),expectedRevision:0}),
    "release-incomplete-or-invalid");
  assert.equal(f.pointers.size,0);
});

test("candidate: SQL migration immutability remains dormant, not a deployed DB proof",()=>{
  const root=path.resolve(__dirname,"..");
  const ddl=fs.readFileSync(path.join(root,
    "sync-service/migrations/005-pocket-handover-release-safety.proposed.sql"),"utf8");
  const migrator=fs.readFileSync(path.join(root,
    "sync-service/pocket-sync-db-migrate.js"),"utf8");
  assert.match(ddl,/BEFORE UPDATE OR DELETE ON public\.pocket_handover_release_entries/);
  assert.doesNotMatch(migrator,/005-pocket-handover-release-safety/);
  assert.equal(Object.keys(SQL).some(k=>/updateEntry|deleteEntry/i.test(k)),false);
});
