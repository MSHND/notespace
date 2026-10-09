"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const {NAMES} = require("../sync-service/pocket-handover-release-witness.js");
const {SQL,createHandoverReleaseSafetyStore} =
  require("../sync-service/pocket-handover-release-safety-store.js");

function fixture() {
  const entries=new Map(), pointers=new Map(), calls=[];
  const owner=(id,resource,capabilities)=>({ownerId:id,resourceId:resource,
    principalId:id+"-actor",capabilities});
  const identities={
    "alice-stage":owner("alice","pocket",["stage","read"]),
    "alice-reader":owner("alice","pocket",["read"]),
    "alice-publisher":owner("alice","pocket",["read","publish"]),
    "bob-stage":owner("bob","pocket",["stage","read"]),
    "bob-reader":owner("bob","pocket",["read"]),
    "alice-other-resource":owner("alice","different",["stage","read"]),
    "generic-writer":owner("alice","pocket",["read","stage"]),
    "bad-binding":{ownerId:"alice",resourceId:"pocket",principalId:"alice-actor",capabilities:[]},
  };
  const key=(...parts)=>parts.join("|");
  const query=async(sql,v=[])=>{
    calls.push({sql,values:v});
    let row=null;
    if(sql===SQL.createEntry){
      const id=key(v[0],v[1],v[2],v[3]);
      if(!entries.has(id)){
        row={owner_id:v[0],resource_id:v[1],release_id:v[2],name:v[3],
          kind:v[4],content:v[5],sha256:v[6],revision:"1"};
        entries.set(id,row);
      }
      else return {rowCount:0,rows:[]};
    } else if(sql===SQL.readEntry){
      row=entries.get(key(...v))??null;
    } else if(sql===SQL.createPointer){
      const id=key(v[0],v[1]);
      if(pointers.has(id)) return {rowCount:0,rows:[]};
      row={owner_id:v[0],resource_id:v[1],release_id:v[2],content:v[3],revision:"1"};
      pointers.set(id,row);
    } else if(sql===SQL.updatePointer){
      const id=key(v[0],v[1]);
      const prev=pointers.get(id);
      if(!prev || Number(prev.revision)!==v[4])return {rowCount:0,rows:[]};
      row={owner_id:v[0],resource_id:v[1],release_id:v[2],content:v[3],
        revision:String(Number(prev.revision)+1)};
      pointers.set(id,row);
    } else if(sql===SQL.readPointer){
      row=pointers.get(key(v[0],v[1]))??null;
    } else throw new Error("Unexpected SQL");
    return {rowCount:row?1:0,rows:row?[{...row}]:[]};
  };
  let approvalEnabled=true, approvalMutator=null;
  const store=createHandoverReleaseSafetyStore({
    pool:{query},
    async resolvePrincipal(auth){return identities[auth];},
    async verifyPublisherApproval(proof){
      if(!approvalEnabled)return null;
      const grant={...proof,approved:true,revoked:false,oneAttempt:true};
      if(approvalMutator)approvalMutator(grant);
      return grant;
    }
  });
  const manifest=releaseId=>JSON.stringify({releaseId,authorityEpoch:"GOOGLE_ONLY",
    documents:NAMES.map(name=>({name,releaseId,digest:"a".repeat(64)}))});
  const stage=(auth="alice-stage",name="pocket.start-here",releaseId="r1")=>
    store.createEntry({auth,releaseId,name,kind:"document",content:"complete text\n"});
  return {store,identities,entries,pointers,calls,stage,manifest,
    permit(v){approvalEnabled=v;},mutateApproval(fn){approvalMutator=fn;}};
}
async function denial(fn,reason){
  await assert.rejects(fn,e=>e?.code==="handover-release-safety-denied"&&e.reason===reason);
}
test("P349xf verified owner/resource plus capability gate: cross-owner and cross-resource denied", {timeout:5000},async()=>{
  const f=fixture();
  assert.equal((await f.stage()).entry.revision,1);
  const own=await f.store.readEntry({auth:"alice-reader",releaseId:"r1",name:"pocket.start-here"});
  assert.equal(own.ok,true);
  for(const auth of ["bob-reader","alice-other-resource"]){
    assert.deepEqual(await f.store.readEntry({auth,releaseId:"r1",name:"pocket.start-here"}),
      {ok:false,reason:"not-found"});
  }
  assert.equal((await f.stage("bob-stage")).ok,true);
  assert.equal((await f.stage("alice-other-resource")).ok,true);
  assert.equal(f.entries.size,3);
  assert.equal(f.calls.every(x=>x.values[0]==="alice"||x.values[0]==="bob"),true);
  assert.ok(SQL.readEntry.includes("owner_id=$1 AND resource_id=$2"));
  assert.ok(SQL.updatePointer.includes("owner_id=$1 AND resource_id=$2 AND revision=$5"));
});
test("missing or unverified identity and insufficient scope are rejected before DB", {timeout:5000},async()=>{
  const f=fixture();
  for(const auth of [undefined,"claimed-owner","bad-binding","alice-reader"]){
    await denial(()=>f.store.createEntry({auth,releaseId:"r1",name:"pocket.start-here",
      kind:"document",content:"text"}),"owner-or-capability-denied");
  }
  assert.equal(f.calls.length,0);
  await denial(()=>f.store.publishPointer({auth:"generic-writer",
    releaseId:"r1",content:f.manifest("r1"),expectedRevision:0}),"owner-or-capability-denied");
  assert.equal(f.calls.length,0);
});
test("generation and evidence are create-once; collisions do not mutate prior records", {timeout:5000},async()=>{
  const f=fixture();
  const a=await f.stage();
  assert.equal(a.entry.content,"complete text\n");
  assert.deepEqual(await f.stage(),{ok:false,reason:"already-exists"});
  const evidence=await f.store.createEntry({auth:"alice-stage",releaseId:"r1",
    name:"evidence.approval-1",kind:"evidence",content:"independent receipt"});
  assert.equal(evidence.ok,true);
  assert.deepEqual(await f.store.createEntry({auth:"alice-stage",releaseId:"r1",
    name:"evidence.approval-1",kind:"evidence",content:"tamper"}),
    {ok:false,reason:"already-exists"});
  assert.equal((await f.store.readEntry({auth:"alice-reader",releaseId:"r1",
    name:"evidence.approval-1"})).entry.content,"independent receipt");
  assert.equal(typeof f.store.updateEntry,"undefined");
  await denial(()=>f.store.createEntry({auth:"alice-stage",releaseId:"r1",
    name:"pocket.start-here",kind:"evidence",content:"bad"}),"kind-or-name-invalid");
  assert.equal(f.entries.size,2);
});
test("publisher is separate from stage permission AND independently exact-approved", {timeout:5000},async()=>{
  const f=fixture();
  const content=f.manifest("r1");
  f.permit(false);
  await denial(()=>f.store.publishPointer({auth:"alice-publisher",
    releaseId:"r1",content,expectedRevision:0}),"publisher-approval-denied");
  f.permit(true);
  f.mutateApproval(g=>{g.digest="a".repeat(64);});
  await denial(()=>f.store.publishPointer({auth:"alice-publisher",
    releaseId:"r1",content,expectedRevision:0}),"publisher-approval-denied");
  f.mutateApproval(null);
  assert.equal(f.pointers.size,0);
  await denial(()=>f.store.publishPointer({auth:"alice-publisher",
    releaseId:"r1",content:"{}",expectedRevision:0}),"manifest-invalid");
  assert.equal(f.calls.length,0);
});
test("first pointer create is exact absent-only; later update requires CAS and retains old generations", {timeout:5000},async()=>{
  const f=fixture();
  await f.stage();
  const initial=await f.store.publishPointer({auth:"alice-publisher",
    releaseId:"r1",content:f.manifest("r1"),expectedRevision:0});
  assert.equal(initial.ok,true);
  assert.equal(initial.pointer.revision,1);
  assert.deepEqual(await f.store.publishPointer({auth:"alice-publisher",
    releaseId:"r2",content:f.manifest("r2"),expectedRevision:0}),
    {ok:false,reason:"revision-conflict"});
  assert.deepEqual(await f.store.publishPointer({auth:"alice-publisher",
    releaseId:"r2",content:f.manifest("r2"),expectedRevision:9}),
    {ok:false,reason:"revision-conflict"});
  const next=await f.store.publishPointer({auth:"alice-publisher",
    releaseId:"r2",content:f.manifest("r2"),expectedRevision:1});
  assert.equal(next.pointer.revision,2);
  assert.equal(next.pointer.releaseId,"r2");
  assert.equal((await f.store.readEntry({auth:"alice-reader",releaseId:"r1",
    name:"pocket.start-here"})).entry.revision,1);
  assert.deepEqual(await f.store.readPointer({auth:"bob-reader"}),{ok:false,reason:"not-found"});
  assert.equal((await f.store.readPointer({auth:"alice-reader"})).pointer.revision,2);
  const f2=fixture();
  assert.deepEqual(await f2.store.publishPointer({auth:"alice-publisher",
    releaseId:"r2",content:f2.manifest("r2"),expectedRevision:1}),
    {ok:false,reason:"not-found"});
});
test("same expected revision permits only one publisher pointer winner", {timeout:5000},async()=>{
  const f=fixture();
  await f.store.publishPointer({auth:"alice-publisher",
    releaseId:"r1",content:f.manifest("r1"),expectedRevision:0});
  const [left,right]=await Promise.all(["r2","r3"].map(releaseId=>
    f.store.publishPointer({auth:"alice-publisher",
      releaseId,content:f.manifest(releaseId),expectedRevision:1})));
  assert.equal([left,right].filter(x=>x.ok===true).length,1);
  assert.equal([left,right].filter(x=>x.reason==="revision-conflict").length,1);
  assert.equal((await f.store.readPointer({auth:"alice-reader"})).pointer.revision,2);
});
test("P349xf proposed isolated SQL has scoped keys and database immutable UPDATE/DELETE trigger; legacy untouched", {timeout:5000},()=>{
  const root=path.resolve(__dirname,"..");
  const ddl=fs.readFileSync(path.join(root,"sync-service/migrations/005-pocket-handover-release-safety.proposed.sql"),"utf8");
  const current=fs.readFileSync(path.join(root,"sync-service/migrations/004-pocket-project-documents.sql"),"utf8");
  const migrator=fs.readFileSync(path.join(root,"sync-service/pocket-sync-db-migrate.js"),"utf8");
  assert.match(ddl,/PRIMARY KEY \(owner_id, resource_id, release_id, name\)/);
  assert.match(ddl,/PRIMARY KEY \(owner_id, resource_id\)/);
  assert.match(ddl,/BEFORE UPDATE OR DELETE ON public\.pocket_handover_release_entries/);
  assert.match(ddl,/RAISE EXCEPTION 'Pocket handover generation\/evidence is immutable'/);
  assert.doesNotMatch(migrator,/005-pocket-handover-release-safety/);
  assert.match(current,/PRIMARY KEY/);
  assert.equal(SQL.updatePointer.includes("revision=$5"),true);
  assert.equal(Object.keys(SQL).some(name=>/updateEntry|deleteEntry/i.test(name)),false);
});
