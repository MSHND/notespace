"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {createProjectDocumentsTokenVerifier} = require("../sync-service/pocket-project-documents-auth.js");
const {createHandoverVerifiedSubjectBinding} =
  require("../sync-service/pocket-handover-verified-subject-binding.js");
const {createHandoverReleaseSafetyStore,SQL} =
  require("../sync-service/pocket-handover-release-safety-store.js");

const config = Object.freeze({
  issuer:"https://issuer.synthetic/", audience:"synthetic-pocket-docs",
  resourceUrl:"https://pocket.synthetic.example/project-docs/mcp",
  jwksUrl:"https://issuer.synthetic/keys",
});
const future=()=>Math.floor(Date.now()/1000)+600;
const basePayload=(sub="user-alpha")=>({
  iss:config.issuer,aud:config.audience,exp:future(),
  sub,client_id:"one-shared-client",scope:"pocket.project-documents.read pocket.project-documents.write",
});
const row=(subject,owner,role="stager")=>({
  issuer:config.issuer,subject,audience:config.audience,resourceUrl:config.resourceUrl,
  ownerId:owner,resourceId:"handover",principalId:owner+"-"+subject,
  approved:true,ownerApproved:true,revoked:false,expiresAtMs:Date.now()+600000,
  role,capabilities:role==="stager"?["read","stage"]:role==="reader"?["read"]:["read","publish"],
});
function fixture(){
  const bridge=createHandoverVerifiedSubjectBinding({
    async readApprovedPolicy(){return policy;},
  });
  let policy={version:1,approved:true,revoked:false,
    bindings:[row("user-alpha","owner-alpha"),row("user-beta","owner-beta")]};
  let payload=basePayload(), dbCalls=0, lastDb=null;
  const verifier=createProjectDocumentsTokenVerifier({
    config,verifyJwt:async()=>payload,verifiedSubjectObserver:bridge.verifiedSubjectObserver,
  });
  const pool={async query(sql,values){
    dbCalls++;lastDb={sql,values};
    if(sql===SQL.createEntry){
      return {rowCount:1,rows:[{
        owner_id:values[0],resource_id:values[1],release_id:values[2],name:values[3],
        kind:values[4],content:values[5],sha256:values[6],revision:1,
      }]};
    }
    throw Error("unexpected SQL "+sql);
  }};
  const store=createHandoverReleaseSafetyStore({
    pool,resolvePrincipal:bridge.resolvePrincipal,
    verifyPublisherApproval:async()=>null,
  });
  const auth=async v=>{payload=v;return verifier.verifyAccessToken("synthetic-token")};
  const stage=authInfo=>store.createEntry({auth:authInfo,
    releaseId:"r1",name:"pocket.start-here",kind:"document",content:"safe text"});
  return {bridge,verifier,store,auth,stage,
    calls:()=>dbCalls,last:()=>lastDb,
    policy:()=>policy,setPolicy:p=>{policy=p;},getPayload:()=>payload};
}
async function bindingDenied(action, f){
  const before=f.calls();
  await assert.rejects(action, e=>e?.code==="handover-release-safety-denied"&&
    e.reason==="owner-unverified");
  assert.equal(f.calls(),before,"no SQL on failed subject/owner binding");
}
async function scopeDenied(action,f){
  const before=f.calls();
  await assert.rejects(action,e=>e?.code==="handover-release-safety-denied"&&
    e.reason==="owner-or-capability-denied");
  assert.equal(f.calls(),before,"no SQL on insufficient scoped capability");
}
test("P349xh shared client_id is NOT subject identity; two verified sub values resolve to different owners",async()=>{
  const f=fixture();
  const a=await f.auth(basePayload("user-alpha"));
  const b=await f.auth(basePayload("user-beta"));
  assert.equal(a.clientId,b.clientId);
  assert.deepEqual(Object.keys(a).sort(),["clientId","expiresAt","resource","scopes","token"].sort());
  assert.equal(Object.hasOwn(a,"subject"),false);
  assert.equal(Object.isFrozen(a),true);
  assert.equal((await f.bridge.resolvePrincipal(a)).ownerId,"owner-alpha");
  assert.equal((await f.bridge.resolvePrincipal(b)).ownerId,"owner-beta");
  assert.equal((await f.stage(a)).ok,true);
  assert.equal(f.last().values[0],"owner-alpha");
  assert.equal(f.last().values[1],"handover");
  assert.equal((await f.stage(b)).ok,true);
  assert.equal(f.last().values[0],"owner-beta");
  assert.equal(f.calls(),2);
});
test("P349xh no sub, unrecognised sub, fake authInfo, or shared app client_id alone cannot grant owner",async()=>{
  const f=fixture();
  const missing=await f.auth({...basePayload(),sub:undefined});
  assert.equal(missing.clientId,"one-shared-client","legacy token behaviour retained");
  await bindingDenied(()=>f.stage(missing),f);
  const unknown=await f.auth(basePayload("user-unknown"));
  await bindingDenied(()=>f.stage(unknown),f);
  const forged=Object.freeze({...unknown,clientId:"one-shared-client"});
  await bindingDenied(()=>f.stage(forged),f);
  await bindingDenied(()=>f.stage(Object.freeze({clientId:"one-shared-client"})),f);
  const noSubButFallback=await f.auth({...basePayload(),sub:""});
  await bindingDenied(()=>f.stage(noSubButFallback),f);
});
test("P349xh wrong JWT issuer/audience/expiry rejected before observer and SQL",async()=>{
  const f=fixture();
  for(const payload of [
    {...basePayload(),iss:"https://wrong.synthetic/"},
    {...basePayload(),aud:"other-audience"},
    {...basePayload(),exp:Math.floor(Date.now()/1000)-5},
  ]){
    await assert.rejects(()=>f.auth(payload),e=>e?.code==="project-documents-auth-invalid");
    assert.equal(f.calls(),0);
  }
  const ambiguousAud=await f.auth({...basePayload(),aud:[config.audience,"another"]});
  await bindingDenied(()=>f.stage(ambiguousAud),f);
});
test("P349xh wrong exact policy issuer/audience/resource denies despite valid legacy JWT",async()=>{
  for(const bad of [
    r=>{r.issuer="https://different.synthetic/";},
    r=>{r.audience="other-audience";},
    r=>{r.resourceUrl="https://other.synthetic/project-docs/mcp";},
  ]){
    const f=fixture(),p=f.policy(),r={...p.bindings[0]};bad(r);
    f.setPolicy({...p,bindings:[r,p.bindings[1]]});
    await bindingDenied(async()=>f.stage(await f.auth(basePayload())),f);
  }
});
test("P349xh revoked, expired, unapproved or inconsistent owner policy fails closed",async()=>{
  for(const change of [
    p=>{p.revoked=true;},
    p=>{p.approved=false;},
    p=>{p.bindings[0].revoked=true;},
    p=>{p.bindings[0].expiresAtMs=Date.now()-1;},
    p=>{p.bindings[0].approved=false;},
    p=>{p.bindings[0].ownerApproved=false;},
    p=>{p.bindings[0].ownerId="unapproved owner!";},
    p=>{p.bindings[0].role="administrator";},
    p=>{p.bindings[0].capabilities=["read","stage","publish"];},
    p=>{p.bindings.push({...p.bindings[0]});}, // ambiguous same subject
    p=>{p.bindings.push({...row("user-gamma","owner-charlie"),principalId:p.bindings[0].principalId});},
    p=>{p.bindings.push({...row("user-alpha","owner-else"),principalId:"owner-else-actor"});},
  ]){
    const f=fixture(),p=structuredClone(f.policy());change(p);f.setPolicy(p);
    await bindingDenied(async()=>f.stage(await f.auth(basePayload())),f);
  }
});
test("P349xh live policy re-evaluates each request; approval revoked after first use denies SQL",async()=>{
  const f=fixture(),a=await f.auth(basePayload());
  assert.equal((await f.stage(a)).ok,true);
  const p=structuredClone(f.policy());p.bindings[0].revoked=true;f.setPolicy(p);
  await bindingDenied(()=>f.stage(a),f);
  assert.equal(f.calls(),1);
});
test("P349xh approved reader and ordinary OAuth write scope do NOT confer staging/publishing",async()=>{
  const f=fixture(),p=structuredClone(f.policy());
  p.bindings[0]=row("user-alpha","owner-alpha","reader");f.setPolicy(p);
  const a=await f.auth(basePayload());
  assert.ok(a.scopes.includes("pocket.project-documents.write"));
  await scopeDenied(()=>f.stage(a),f);
  await scopeDenied(()=>f.store.publishPointer({auth:a,releaseId:"r1",
    content:"{}",expectedRevision:0}),f);
  p.bindings[0]=row("user-alpha","owner-alpha","publisher");f.setPolicy(p);
  const b=await f.auth(basePayload());
  await scopeDenied(()=>f.stage(b),f);
  // Even a publisher role is NOT a separate approved publisher grant.
  await assert.rejects(()=>f.store.publishPointer({auth:b,releaseId:"r1",
    content:"{}",expectedRevision:0}),e=>e?.code==="handover-release-safety-denied"&&
    e.reason==="manifest-invalid");
  assert.equal(f.calls(),0);
});
test("P349xh document content/name cannot spoof owner/resource; trusted resolver controls DB owner",async()=>{
  const f=fixture(),a=await f.auth(basePayload());
  const r=await f.store.createEntry({
    auth:a,releaseId:"r1",name:"pocket.current-task",kind:"document",
    content:'{"ownerId":"owner-beta","resourceId":"evil","client_id":"admin"}',
  });
  assert.equal(r.ok,true);
  assert.equal(f.last().values[0],"owner-alpha");
  assert.equal(f.last().values[1],"handover");
  assert.equal(f.last().values[3],"pocket.current-task");
  await assert.rejects(()=>f.store.createEntry({
    auth:a,releaseId:"r1",name:"owner-beta.pocket.current-task",kind:"document",content:"spoof",
  }),e=>e?.code==="handover-release-safety-denied");
  assert.equal(f.calls(),1);
});
test("P349xh verifier remains opt-in; legacy no-observer JWT authInfo and clientId shape unchanged",async()=>{
  const payload=basePayload();
  const verifier=createProjectDocumentsTokenVerifier({config,verifyJwt:async()=>payload});
  const a=await verifier.verifyAccessToken("token");
  assert.equal(a.clientId,"one-shared-client");
  assert.deepEqual(Object.keys(a).sort(),["clientId","expiresAt","resource","scopes","token"].sort());
  const fallback=createProjectDocumentsTokenVerifier({
    config,verifyJwt:async()=>({...payload,client_id:undefined}),
  });
  assert.equal((await fallback.verifyAccessToken("token")).clientId,"user-alpha");
  assert.throws(()=>createProjectDocumentsTokenVerifier({
    config,verifyJwt:async()=>payload,verifiedSubjectObserver:"not a function",
  }),e=>e?.code==="project-documents-auth-config-invalid");
  const failed=createProjectDocumentsTokenVerifier({
    config,verifyJwt:async()=>payload,verifiedSubjectObserver:()=>{throw Error("failure");},
  });
  await assert.rejects(()=>failed.verifyAccessToken("token"),
    e=>e?.code==="project-documents-auth-invalid");
});
