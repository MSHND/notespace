"use strict";
// PROOF-ONLY PostgreSQL 16 integration: disposable Actions service, NOT Render.
// Tests production-shaped dormant P349 release-store with real SQL transactions.
// Publisher approval here is injected/synthetic, never a human ceremony.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createHash}=require("node:crypto");
const {Pool}=require("pg");
const {NAMES}=require("../sync-service/pocket-handover-release-witness.js");
const {SQL,createHandoverReleaseSafetyStore}=
  require("../sync-service/pocket-handover-release-safety-store.js");

const hash=s=>createHash("sha256").update(s,"utf8").digest("hex");
const ddl=fs.readFileSync(path.resolve(__dirname,
  "../sync-service/migrations/005-pocket-handover-release-safety.proposed.sql"),"utf8");
const documentText=(r,n)=>"P349 disposable "+r+"/"+n+" — Café / 你好 / 🌿\n";
const manifest=(r,patch={})=>JSON.stringify({
  releaseId:r,authorityEpoch:"GOOGLE_ONLY",
  documents:NAMES.map(name=>({name,releaseId:r,
    digest:patch[name]||hash(documentText(r,name))})),
});
const identities=new WeakMap();
const auth={
  stage:Object.freeze({}), read:Object.freeze({}),publish:Object.freeze({}),
  bobStage:Object.freeze({}),bobRead:Object.freeze({}),unauthorised:Object.freeze({}),
};
identities.set(auth.stage,{ownerId:"alice",resourceId:"handover",principalId:"alice-stage",capabilities:["stage","read"]});
identities.set(auth.read,{ownerId:"alice",resourceId:"handover",principalId:"alice-read",capabilities:["read"]});
identities.set(auth.publish,{ownerId:"alice",resourceId:"handover",principalId:"alice-pub",capabilities:["publish","read"]});
identities.set(auth.bobStage,{ownerId:"bob",resourceId:"handover",principalId:"bob-stage",capabilities:["stage","read"]});
identities.set(auth.bobRead,{ownerId:"bob",resourceId:"handover",principalId:"bob-read",capabilities:["read"]});
const connectionOptions={host:"127.0.0.1",port:5432,user:"postgres",
  password:"disposable_only_password",database:"postgres"};

test("P349 digest: direct PostgreSQL 16 INSERT enforces SHA-256 of exact UTF-8 bytes",{timeout:30000},async()=>{
  const db=new Pool({...connectionOptions,max:3,connectionTimeoutMillis:3000});
  const owner="digest-admission-probe";
  const insert=(releaseId,name,content,suppliedDigest)=>db.query(
    "INSERT INTO public.pocket_handover_release_entries "+
    "(owner_id,resource_id,release_id,name,kind,content,sha256,revision) "+
    "VALUES ($1,'handover',$2,$3,'document',$4,$5,1) "+
    "RETURNING owner_id,release_id,name,content,sha256,revision",
    [owner,releaseId,name,content,suppliedDigest]);
  try {
    await db.query(ddl);
    const version=await db.query("SHOW server_version_num");
    assert.ok(Number(version.rows[0].server_version_num)>=160000);
    const enc=await db.query("SHOW server_encoding");
    assert.equal(enc.rows[0].server_encoding,"UTF8");
    // PostgreSQL's built-in pg_catalog.sha256(bytea); no pgcrypto extension.
    const extensions=await db.query(
      "SELECT extname FROM pg_extension WHERE extname='pgcrypto'");
    assert.equal(extensions.rowCount,0);
    const schema=await db.query(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint "+
      "WHERE conrelid='public.pocket_handover_release_entries'::regclass "+
      "AND contype='c'");
    assert.ok(schema.rows.some(r=>r.definition.includes("sha256(")
      && r.definition.includes("convert_to(")
      && r.definition.includes("UTF8")));
    const text="Café / 你好 / 🌿\ncombining e\u0301 and composed é\n";
    const digest=hash(text);
    const native=await db.query("SELECT pg_catalog.encode(pg_catalog.sha256("+
      "pg_catalog.convert_to($1::text, 'UTF8')), 'hex') AS digest",[text]);
    assert.equal(native.rows[0].digest,digest);
    const good=await insert("r70","pocket.start-here",text,digest);
    assert.equal(good.rowCount,1);
    assert.equal(good.rows[0].content,text);
    assert.equal(good.rows[0].sha256,digest);
    assert.equal(Number(good.rows[0].revision),1);
    await assert.rejects(
      ()=>insert("r71","pocket.start-here",text,"f".repeat(64)),
      e=>e.code==="23514"); // Valid syntax; wrong content fingerprint.
    await assert.rejects(
      ()=>insert("r72","pocket.start-here",text,"z".repeat(64)),
      e=>e.code==="23514"); // Invalid digest syntax.
    await assert.rejects(
      ()=>insert("r70","pocket.start-here",text,digest),
      e=>e.code==="23505"); // Identity uniqueness unchanged.
    await assert.rejects(
      ()=>db.query("UPDATE public.pocket_handover_release_entries SET "+
        "content='tampered' WHERE owner_id=$1 AND release_id='r70'",[owner]),
      e=>/immutable/.test(e.message));
    await assert.rejects(
      ()=>db.query("DELETE FROM public.pocket_handover_release_entries "+
        "WHERE owner_id=$1 AND release_id='r70'",[owner]),
      e=>/immutable/.test(e.message));
    const count=await db.query(
      "SELECT release_id,content,sha256 FROM "+
      "public.pocket_handover_release_entries WHERE owner_id=$1 "+
      "ORDER BY release_id",[owner]);
    assert.equal(count.rowCount,1);
    assert.equal(count.rows[0].release_id,"r70");
    assert.equal(count.rows[0].sha256,digest);
    assert.equal(count.rows[0].content,text);
    const pointer=await db.query(
      "SELECT count(*)::int AS n FROM public.pocket_handover_release_pointers "+
      "WHERE owner_id=$1",[owner]);
    assert.equal(pointer.rows[0].n,0);
    console.log("P349_DB_DIGEST=PASS; native=pg_catalog.sha256; "+
      "invalid-64hex=23514; invalid-syntax=23514; duplicate=23505; "+
      "UTF8=PASS; immutable-update-delete=PASS; rejected-insert-no-pointer=PASS");
  } finally {await db.end();}
});

test("P349 atomic publication: PostgreSQL 16 real transactions and locked nine-snapshot CAS",{timeout:30000},async()=>{
  const db=new Pool({...connectionOptions,max:10,connectionTimeoutMillis:3000});
  let approved=true, confirmed=0;
  const createStore=(pool=db)=>createHandoverReleaseSafetyStore({
    pool,
    async resolvePrincipal(token) {return identities.get(token);},
    async verifyPublisherApproval(proof) {
      confirmed++;
      return approved ? {...proof,approved:true,revoked:false,oneAttempt:true} : null;
    },
  });
  const store=createStore();
  const stage=async(releaseId,who=auth.stage,names=NAMES)=>{
    for(const name of names) {
      const r=await store.createEntry({auth:who,releaseId,name,kind:"document",
        content:documentText(releaseId,name)});
      assert.equal(r.ok,true,"each disposable snapshot exists exactly once");
    }
  };
  const publish=(releaseId,expectedRevision=0,who=auth.publish,content=manifest(releaseId),
    targetStore=store)=>targetStore.publishPointer({
      auth:who,releaseId,content,expectedRevision,
    });
  const current=async()=>store.readPointer({auth:auth.read});
  const unchanged=async(expected)=>{
    const p=await current();
    assert.equal(p.ok,true);
    assert.equal(p.pointer.revision,expected.revision);
    assert.equal(p.pointer.releaseId,expected.releaseId);
  };
  const denied=async(run,reason)=>{
    await assert.rejects(run,e=>e?.code==="handover-release-safety-denied"
      && e.reason===reason);
  };
  try {
    await db.query(ddl);
    const trace=[];
    const tracedStore=createStore({
      query:db.query.bind(db),
      async connect(){
        const client=await db.connect();
        const id=trace.length+1;
        const ops=[];trace.push({id,ops});
        return {
          query:async(sql,v=[])=>{ops.push(sql);return client.query(sql,v);},
          release:bad=>client.release(bad),
        };
      },
    });

    // Verified nine records and the pointer write use the SAME pinned connection.
    await stage("r1");
    const p1=await publish("r1",0,auth.publish,manifest("r1"),tracedStore);
    assert.equal(p1.ok,true);
    assert.equal(p1.pointer.revision,1);
    assert.equal(trace.length,1);
    assert.equal(trace[0].ops[0],"BEGIN ISOLATION LEVEL SERIALIZABLE");
    assert.equal(trace[0].ops.filter(sql=>sql===SQL.lockEntry).length,9);
    assert.ok(trace[0].ops.indexOf(SQL.createPointer)>
      trace[0].ops.lastIndexOf(SQL.lockEntry));
    assert.equal(trace[0].ops.at(-1),"COMMIT");

    const initial=(await current()).pointer;
    // No release, partially staged release, forged manifest and bad stored content.
    await denied(()=>publish("r99",1),"release-incomplete-or-invalid");
    await unchanged(initial);
    await stage("r2",auth.stage,NAMES.slice(0,8));
    await denied(()=>publish("r2",1),"release-incomplete-or-invalid");
    await unchanged(initial);
    await stage("r3");
    await denied(()=>publish("r3",1,auth.publish,
      manifest("r3",{[NAMES[8]]:"a".repeat(64)})),"release-incomplete-or-invalid");
    await unchanged(initial);

    // Another verified owner and another release can never supply missing rows.
    await stage("r4",auth.bobStage);
    await denied(()=>publish("r4",1),"release-incomplete-or-invalid");
    await unchanged(initial);
    await stage("r5");
    await denied(()=>publish("r6",1,auth.publish,manifest("r6")),
      "release-incomplete-or-invalid");
    await unchanged(initial);
    // PostgreSQL 16 rejects an invalid digest at INSERT, before the
    // application's independent publication verification runs.
    await stage("r7",auth.stage,NAMES.slice(0,8));
    await assert.rejects(()=>db.query(
      "INSERT INTO public.pocket_handover_release_entries "+
      "(owner_id,resource_id,release_id,name,kind,content,sha256,revision) "+
      "VALUES ('alice','handover','r7',$1,'document',$2,$3,1)",
      [NAMES[8],documentText("r7",NAMES[8]),"f".repeat(64)]),
      e=>e.code==="23514");
    await denied(()=>publish("r7",1),"release-incomplete-or-invalid");
    await unchanged(initial);

    await denied(()=>publish("r3",1,auth.stage),"owner-or-capability-denied");
    approved=false;
    await denied(()=>publish("r3",1),"publisher-approval-denied");
    await unchanged(initial);
    approved=true;

    // Valid successor; old immutable r1 remains reachable.
    await stage("r8");
    const p2=await publish("r8",1);
    assert.equal(p2.ok,true);
    assert.equal(p2.pointer.revision,2);
    const old=await store.readEntry({auth:auth.read,releaseId:"r1",name:NAMES[0]});
    assert.equal(old.entry.content,documentText("r1",NAMES[0]));
    assert.equal(old.entry.digest,hash(old.entry.content));
    await denied(()=>publish("r8",1,auth.unauthorised),"owner-or-capability-denied");

    // Same base writers: at most one committed CAS; serialization failures
    // are terminal, never silently retried.
    await stage("r9");await stage("r10");
    const outcomes=await Promise.allSettled([
      publish("r9",2),publish("r10",2),
    ]);
    assert.equal(outcomes.filter(x=>x.status==="fulfilled"&&x.value.ok).length,1);
    assert.equal(outcomes.filter(x=>
      x.status==="fulfilled"&&!x.value.ok ||
      x.status==="rejected"&&x.reason?.code==="handover-release-safety-denied").length,1);
    const afterRace=(await current()).pointer;
    assert.equal(afterRace.revision,3);
    assert.ok(["r9","r10"].includes(afterRace.releaseId));
    const stale=await publish("r8",2);
    assert.equal(stale.ok,false);
    assert.equal(stale.reason,"revision-conflict");
    await unchanged(afterRace);

    // Inject pre-write interruption INSIDE the PostgreSQL transaction.
    // ROLLBACK must preserve the original pointer and all earlier rows.
    await stage("r11");
    const interrupted=createStore({
      query:db.query.bind(db),
      async connect(){
        const client=await db.connect();
        return {
          query:async(sql,v=[])=>{
            if(sql===SQL.updatePointer) throw Error("simulated interrupted transaction");
            return client.query(sql,v);
          },
          release:bad=>client.release(bad),
        };
      },
    });
    await denied(()=>publish("r11",3,auth.publish,manifest("r11"),interrupted),
      "storage-failed");
    await unchanged(afterRace);
    assert.equal((await store.readEntry({auth:auth.read,releaseId:"r11",
      name:NAMES[0]})).ok,true);

    // Lost response AFTER a genuine PostgreSQL COMMIT: outcome unknown.
    // Only a new authoritative read tells us what was committed.
    await stage("r12");
    const lostAck=createStore({
      query:db.query.bind(db),
      async connect(){
        const client=await db.connect();
        return {
          query:async(sql,v=[])=>{
            if(sql==="COMMIT"){
              await client.query(sql,v);
              throw Error("synthetic lost acknowledgement after durable COMMIT");
            }
            return client.query(sql,v);
          },
          release:bad=>client.release(bad),
        };
      },
    });
    await denied(()=>publish("r12",3,auth.publish,manifest("r12"),lostAck),
      "publication-outcome-unknown");
    const authoritativeRead=await current();
    assert.equal(authoritativeRead.pointer.releaseId,"r12");
    assert.equal(authoritativeRead.pointer.revision,4);
    assert.equal((await store.readEntry({auth:auth.read,releaseId:"r1",
      name:NAMES[0]})).entry.digest,hash(documentText("r1",NAMES[0])));
    assert.ok(confirmed>0);
    console.log("P349_ATOMIC_PG=PASS; verified=9; same-client-transaction=PASS; "+
      "serializable-CAS=PASS; unknown-commit-ACK=fresh-read-required; "+
      "human-approval=synthetic-only; digest-rejection=PG23514; production=UNTOUCHED");
  } finally { await db.end(); }
});
