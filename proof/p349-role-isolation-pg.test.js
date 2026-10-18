"use strict";
// P349 PROOF ONLY. Ephemeral PostgreSQL 16, real LOGIN credentials and RLS.
// The independent trusted identity-to-DB-login service broker DOES NOT EXIST.
// All auth bindings and owner-confirmation in this test are synthetic.
// Test deliberately witnesses the direct publisher SQL bypass: NOT RELEASE READY.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createHash}=require("node:crypto");
const {Pool}=require("pg");
const {NAMES}=require("../sync-service/pocket-handover-release-witness.js");
const {createHandoverReleaseSafetyStore}=
  require("../sync-service/pocket-handover-release-safety-store.js");
const h=s=>createHash("sha256").update(s,"utf8").digest("hex");
const base=fs.readFileSync(path.resolve(__dirname,
  "../sync-service/migrations/005-pocket-handover-release-safety.proposed.sql"),"utf8");
const isolation=fs.readFileSync(path.resolve(__dirname,
  "../sync-service/migrations/006-pocket-handover-role-isolation.proposed.sql"),"utf8");
const opts={host:"127.0.0.1",port:5432,database:"postgres",max:3,
  connectionTimeoutMillis:3000};
const text=(releaseId,name)=>"P349 role-isolated "+releaseId+" "+name+" — Café / 你好 / 🌿\n";
const manifest=releaseId=>JSON.stringify({releaseId,authorityEpoch:"GOOGLE_ONLY",
  documents:NAMES.map(name=>({name,releaseId,digest:h(text(releaseId,name))}))});
const principals=[
  ["p349_alice_reader","alice","handover","reader"],
  ["p349_alice_stager","alice","handover","stager"],
  ["p349_alice_publisher","alice","handover","publisher"],
  ["p349_alice_notes_stager","alice","notes","stager"],
  ["p349_bob_reader","bob","handover","reader"],
  ["p349_bob_stager","bob","handover","stager"],
  ["p349_unbound_stager",null,null,"stager"],
  ["p349_docs_writer",null,null,null],
  ["p349_eve_publisher","eve","handover","publisher"],
];
async function rejectsDb(fn,codes){
  await assert.rejects(fn,e=>codes.includes(e?.code),
    "PostgreSQL must reject via SQLSTATE: "+codes.join(","));
}
test("P349 real login and RLS owner isolation on disposable PostgreSQL 16",{timeout:35000},async()=>{
  const admin=new Pool({...opts,user:"postgres",password:"disposable_only_password"});
  const opened=[];
  const conn=user=>{
    const p=new Pool({...opts,user,password:"only_test_"+user});
    opened.push(p);return p;
  };
  const ids=new WeakMap();
  const token=()=>Object.freeze({});
  const grant=(id,ownerId,resourceId,capabilities)=>{
    const t=token();
    ids.set(t,{ownerId,resourceId,principalId:id,capabilities});
    return t;
  };
  const rolePools={};
  const makeStore=(pool,acceptApproval=true)=>createHandoverReleaseSafetyStore({
    pool,
    async resolvePrincipal(t){return ids.get(t);},
    async verifyPublisherApproval(p) {
      return acceptApproval?{...p,approved:true,revoked:false,oneAttempt:true}:null;
    },
  });
  try {
    await admin.query(base);
    // New, isolated disposable fixture after the separate historical
    // PostgreSQL regression suite; never run on a persistent database.
    await admin.query("TRUNCATE TABLE public.pocket_handover_release_pointers, public.pocket_handover_release_entries");
    await admin.query(isolation);
    // Real database LOGIN identities have no shared role membership.
    for(const [login,owner,resource,capability] of principals){
      await admin.query("CREATE ROLE "+login+" LOGIN PASSWORD 'only_test_"+login+"'");
      if(capability){
        await admin.query("GRANT pocket_handover_"+capability+" TO "+login);
      }
      if(owner){
        await admin.query("INSERT INTO public.pocket_handover_role_bindings "+
          "(db_login,owner_id,resource_id,capability) VALUES ($1,$2,$3,$4)",
          [login,owner,resource,capability]);
      }
      rolePools[login]=conn(login);
    }
    // A disposable legacy writer has writing rights to an unrelated table.
    await admin.query("CREATE TABLE public.p349_disposable_docs_writer "+
      "(id TEXT PRIMARY KEY,content TEXT NOT NULL)");
    await admin.query("GRANT SELECT,INSERT,UPDATE,DELETE ON "+
      "public.p349_disposable_docs_writer TO p349_docs_writer");
    const writer=rolePools.p349_docs_writer;
    assert.equal((await writer.query("INSERT INTO public.p349_disposable_docs_writer "+
      "(id,content) VALUES ('a','ordinary doc') RETURNING content")).rows[0].content,
      "ordinary doc");
    await rejectsDb(()=>writer.query(
      "SELECT * FROM public.pocket_handover_release_entries"),["42501"]);
    await rejectsDb(()=>writer.query(
      "UPDATE public.pocket_handover_release_entries SET content='tampered'"),["42501"]);
    await rejectsDb(()=>writer.query(
      "INSERT INTO public.pocket_handover_release_pointers "+
      "(owner_id,resource_id,release_id,content,revision,updated_at) "+
      "VALUES ('alice','handover','r999','forged',1,clock_timestamp())"),["42501"]);
    const reader=rolePools.p349_alice_reader;
    const stagePool=rolePools.p349_alice_stager;
    const pubPool=rolePools.p349_alice_publisher;
    const bobPool=rolePools.p349_bob_stager;
    const bobRead=rolePools.p349_bob_reader;
    const notesPool=rolePools.p349_alice_notes_stager;
    const unbound=rolePools.p349_unbound_stager;
    const stagerAuth=grant("alice-stage","alice","handover",["read","stage"]);
    const readerAuth=grant("alice-reader","alice","handover",["read"]);
    const pubAuth=grant("alice-pub","alice","handover",["read","publish"]);
    const bobAuth=grant("bob-stage","bob","handover",["read","stage"]);
    const notesAuth=grant("alice-notes","alice","notes",["read","stage"]);
    const aliceStore=makeStore(stagePool),aliceRead=makeStore(reader);
    const bobStore=makeStore(bobPool),notesStore=makeStore(notesPool);
    const publishStore=makeStore(pubPool),deniedPublisher=makeStore(pubPool,false);
    const r1="r1001";
    for(const name of NAMES){
      const r=await aliceStore.createEntry({auth:stagerAuth,releaseId:r1,
        name,kind:"document",content:text(r1,name)});
      assert.equal(r.ok,true);
    }
    assert.equal((await aliceRead.readEntry({
      auth:readerAuth,releaseId:r1,name:NAMES[0]})).entry.content,text(r1,NAMES[0]));
    assert.equal((await reader.query("SELECT session_user, current_user")).rows[0].session_user,
      "p349_alice_reader");
    await rejectsDb(()=>reader.query(
      "INSERT INTO public.pocket_handover_release_entries "+
      "(owner_id,resource_id,release_id,name,kind,content,sha256,revision) "+
      "VALUES ('alice','handover','r1111',$1,'document',$2,$3,1)",
      [NAMES[0],text("r1111",NAMES[0]),h(text("r1111",NAMES[0]))]),["42501"]);
    assert.deepEqual(await bobStore.readEntry({
      auth:bobAuth,releaseId:r1,name:NAMES[0]}),{ok:false,reason:"not-found"});
    assert.deepEqual(await notesStore.readEntry({
      auth:notesAuth,releaseId:r1,name:NAMES[0]}),{ok:false,reason:"not-found"});
    // Forged caller owner/resource in direct SQL cannot override SESSION_USER binding.
    await rejectsDb(()=>stagePool.query(
      "INSERT INTO public.pocket_handover_release_entries "+
      "(owner_id,resource_id,release_id,name,kind,content,sha256,revision) "+
      "VALUES ('bob','handover','r1112',$1,'document',$2,$3,1)",
      [NAMES[0],text("r1112",NAMES[0]),h(text("r1112",NAMES[0]))]),["42501"]);
    await rejectsDb(()=>stagePool.query(
      "INSERT INTO public.pocket_handover_release_entries "+
      "(owner_id,resource_id,release_id,name,kind,content,sha256,revision) "+
      "VALUES ('alice','notes','r1113',$1,'document',$2,$3,1)",
      [NAMES[0],text("r1113",NAMES[0]),h(text("r1113",NAMES[0]))]),["42501"]);
    await rejectsDb(()=>unbound.query(
      "INSERT INTO public.pocket_handover_release_entries "+
      "(owner_id,resource_id,release_id,name,kind,content,sha256,revision) "+
      "VALUES ('alice','handover','r1114',$1,'document',$2,$3,1)",
      [NAMES[0],text("r1114",NAMES[0]),h(text("r1114",NAMES[0]))]),["42501"]);
    // SQL GUC and role switches do not create a new owner or publishing right.
    const pinned=await stagePool.connect();
    try{
      await pinned.query("SELECT set_config('pocket.handover.owner_id','bob',false)");
      assert.equal((await pinned.query("SELECT session_user")).rows[0].session_user,
        "p349_alice_stager");
      assert.equal((await pinned.query(
        "SELECT count(*)::int AS n FROM public.pocket_handover_release_entries "+
        "WHERE owner_id='bob'")).rows[0].n,0);
      await rejectsDb(()=>pinned.query("SET ROLE pocket_handover_publisher"),["42501"]);
      await rejectsDb(()=>pinned.query("SET ROLE p349_bob_stager"),["42501"]);
      await rejectsDb(()=>pinned.query(
        "UPDATE public.pocket_handover_release_pointers "+
        "SET release_id='r1115' WHERE owner_id='alice'"),["42501"]);
      await rejectsDb(()=>pinned.query(
        "DELETE FROM public.pocket_handover_release_entries "+
        "WHERE owner_id='alice'"),["42501"]);
    }finally{pinned.release();}
    await rejectsDb(()=>stagePool.query(
      "SELECT * FROM public.pocket_handover_role_bindings"),["42501"]);
    await rejectsDb(()=>stagePool.query(
      "UPDATE public.pocket_handover_role_bindings "+
      "SET capability='publisher'"),["42501"]);
    // Direct snapshot hash and immutable protection remain database-enforced.
    await rejectsDb(()=>stagePool.query(
      "INSERT INTO public.pocket_handover_release_entries "+
      "(owner_id,resource_id,release_id,name,kind,content,sha256,revision) "+
      "VALUES ('alice','handover','r1116',$1,'document',$2,$3,1)",
      [NAMES[0],text("r1116",NAMES[0]),"f".repeat(64)]),["23514"]);
    // Failed approval cannot publish, despite publisher DB role.
    await assert.rejects(()=>deniedPublisher.publishPointer({
      auth:pubAuth,releaseId:r1,content:manifest(r1),expectedRevision:0}),
      e=>e?.reason==="publisher-approval-denied");
    assert.deepEqual(await aliceRead.readPointer({auth:readerAuth}),
      {ok:false,reason:"not-found"});
    // Real publisher DB login, application synthetic approval, nine locked
    // snapshots and revision-CAS: publication still succeeds atomically.
    const published=await publishStore.publishPointer({
      auth:pubAuth,releaseId:r1,content:manifest(r1),expectedRevision:0});
    assert.equal(published.ok,true);
    assert.equal(published.pointer.revision,1);
    await rejectsDb(()=>stagePool.query(
      "UPDATE public.pocket_handover_release_pointers "+
      "SET release_id='r999' WHERE owner_id='alice'"),["42501"]);
    await rejectsDb(()=>bobPool.query(
      "INSERT INTO public.pocket_handover_release_pointers "+
      "(owner_id,resource_id,release_id,content,revision,updated_at) "+
      "VALUES ('alice','handover','r999','forged',1,clock_timestamp())"),["42501"]);
    assert.deepEqual(await bobStore.readPointer({auth:bobAuth}),
      {ok:false,reason:"not-found"});
    const previous=await aliceRead.readPointer({auth:readerAuth});
    const stale=await publishStore.publishPointer({
      auth:pubAuth,releaseId:r1,content:manifest(r1),expectedRevision:0});
    assert.equal(stale.ok,false);
    assert.equal(stale.reason,"revision-conflict");
    assert.deepEqual(await aliceRead.readPointer({auth:readerAuth}),previous);
    // Two physically distinct authenticated logins plus pool reuse / concurrent
    // database connections never share owner authority or session state.
    const observed=await Promise.all(Array.from({length:12},(_,i)=>{
      const login=i%2?reader:bobRead;
      return login.query("SELECT session_user AS who,(SELECT count(*)::int "+
        "FROM public.pocket_handover_release_entries "+
        "WHERE owner_id='alice' AND resource_id='handover') AS n");
    }));
    for(let i=0;i<observed.length;i++){
      assert.equal(observed[i].rows[0].who,i%2?
        "p349_alice_reader":"p349_bob_reader");
      assert.equal(observed[i].rows[0].n,i%2?9:0);
    }
    const retained=await aliceRead.readEntry({auth:readerAuth,releaseId:r1,name:NAMES[0]});
    assert.equal(retained.entry.digest,h(retained.entry.content));
    // Explicit remaining GAP. Trusted publisher DB login has raw DML privilege,
    // so direct SQL can forge a pointer without the independent approval gate.
    // This test demonstrates and records the bypass; it does not bless it.
    const eve=rolePools.p349_eve_publisher;
    const bypass=await eve.query(
      "INSERT INTO public.pocket_handover_release_pointers "+
      "(owner_id,resource_id,release_id,content,revision,updated_at) "+
      "VALUES ('eve','handover','r999','NO APPROVAL OR SNAPSHOTS',1,clock_timestamp()) "+
      "RETURNING release_id");
    assert.equal(bypass.rows[0].release_id,"r999");
    assert.equal((await eve.query("SELECT count(*)::int AS n FROM "+
      "public.pocket_handover_release_entries WHERE owner_id='eve'")).rows[0].n,0);
    console.log("P349_ROLE_POSTGRES=PASS; separate-authenticated-logins=PASS; "+
      "RLS-forged-id-denial=PASS; docs-writer/stager-publish-denied=PASS; "+
      "pool-cross-contamination=DENIED; valid-nine-document-publication=PASS; "+
      "REMAINING_BYPASS=publisher-login-direct-pointer-SQL; "+
      "trusted-owner-to-DB-login-broker=UNPROVEN");
  } finally {
    await Promise.allSettled(opened.map(p=>p.end()));
    await admin.end();
  }
});
