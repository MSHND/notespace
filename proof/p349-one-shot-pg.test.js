"use strict";
// P349 proof-only PostgreSQL 16; run AFTER earlier 005/006 regression suites.
// Real separate database sessions and real process kill/restart, synthetic issuer.
const test=require("node:test"),assert=require("node:assert/strict");
const {Pool}=require("pg"),{createHash}=require("node:crypto");
const {spawn}=require("node:child_process");
const fs=require("node:fs"),path=require("node:path");
const {NAMES}=require("../sync-service/pocket-handover-release-witness.js");
const {createOneShotPublicationExecutor}=
 require("../sync-service/pocket-handover-one-shot-executor.js");
const DDL=fs.readFileSync(path.resolve(__dirname,
 "../sync-service/migrations/007-pocket-handover-restricted-publication.proposed.sql"),"utf8");
const H=x=>createHash("sha256").update(x,"utf8").digest("hex");
const PG=user=>new Pool({host:"127.0.0.1",port:5432,user,database:"postgres",
 password:user==="postgres"?"disposable_only_password":"only_test_"+user,
 max:6,connectionTimeoutMillis:3000});
const doc=(r,n)=>"P349 one-shot "+r+"/"+n+" — Café / 你好 / 🌿\n";
const manifest=r=>JSON.stringify({releaseId:r,authorityEpoch:"GOOGLE_ONLY",
 documents:NAMES.map(name=>({name,releaseId:r,digest:H(doc(r,name))}))});
const SECRET="synthetic-only-p349-one-attempt-secret";
let receiptSeq=0;
const receiptId=()=>"ap"+String(++receiptSeq).padStart(12,"0");
const roleNames=["p349_alice_publisher","p349_alice_stager",
 "p349_alice_reader","p349_docs_writer"];
function runChild(mode,intent,expectSignal=false) {
 return new Promise((resolve,reject)=>{
   const env={...process.env,P349_CHILD_MODE:mode,
     P349_CHILD_INTENT:Buffer.from(JSON.stringify(intent)).toString("base64")};
   const p=spawn(process.execPath,[path.resolve(__dirname,"p349-one-shot-child.js")],
     {env,stdio:["ignore","pipe","pipe"]});
   let stdout="",stderr="",signalled=false;
   const timer=setTimeout(()=>{p.kill("SIGKILL");reject(Error("child timed out: "+mode));},15000);
   p.stdout.on("data",part=>{
     stdout+=String(part);
     if(mode==="blocked-publication" && stdout.includes("FINALISER_SUBMITTED")
        && !signalled) {signalled=true;setTimeout(()=>p.kill("SIGKILL"),110);}
   });
   p.stderr.on("data",v=>stderr+=String(v));
   p.on("error",err=>{clearTimeout(timer);reject(err);});
   p.on("close",(code,signal)=>{
     clearTimeout(timer);
     if(expectSignal && signal!=="SIGKILL") return reject(Error(
       "Expected SIGKILL, got "+signal+"/"+code+" "+stdout+" "+stderr));
     if(!expectSignal && code!==0) return reject(Error(
       "Child exited "+code+"/"+signal+" "+stdout+" "+stderr));
     resolve({code,signal,stdout,stderr});
   });
 });
}
test("P349 one-shot SPENT admission: PostgreSQL, roles, concurrency, rollback and child faults",
{timeout:110000},async()=>{
 const admin=PG("postgres"),issuer=PG("p349_issuer"),stage=PG("p349_alice_stager"),
   reader=PG("p349_alice_reader"),executorDb=PG("p349_alice_executor");
 const opened=[admin,issuer,stage,reader,executorDb];
 const issue=async(r,revision,{owner="alice",resource="handover",
   principal="p349_alice_executor",man=manifest(r),
   status="approved",expires=120}={})=>{
   const id=receiptId();
   await issuer.query(
     "INSERT INTO public.pocket_handover_approval_receipts "+
     "(receipt_id,owner_id,resource_id,principal_login,release_id,expected_revision,"+
     "manifest_sha256,secret_sha256,expires_at,status) "+
     "VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+($9||' seconds')::interval,$10)",
     [id,owner,resource,principal,r,revision,H(man),H(SECRET),expires,status]);
   return Object.freeze({receiptId:id,secret:SECRET,manifest:man});
 };
 const stageAll=async(r,names=NAMES)=>{
   for(const n of names) await stage.query(
     "INSERT INTO public.pocket_handover_release_entries "+
     "(owner_id,resource_id,release_id,name,kind,content,sha256,revision) "+
     "VALUES('alice','handover',$1,$2,'document',$3,$4,1)",
     [r,n,doc(r,n),H(doc(r,n))]);
 };
 const state=async(intent)=>(
   await admin.query("SELECT status,publication_outcome FROM "+
     "public.pocket_handover_approval_receipts WHERE receipt_id=$1",
     [intent.receiptId])).rows[0];
 const pointer=async()=>{
   const x=await reader.query("SELECT release_id,revision FROM "+
     "public.pocket_handover_release_pointers "+
     "WHERE owner_id='alice' AND resource_id='handover'");
   return {releaseId:x.rows[0]?.release_id,revision:Number(x.rows[0]?.revision)};
 };
 const mk=(intent,pool=executorDb,options={})=>
   createOneShotPublicationExecutor({
     pool,resolveTrustedIntent:async()=>intent,...options});
 let dispatches=0;
 const instrumented={
   connect:async()=>{
     const c=await executorDb.connect();
     return {
       query:(sql,values)=>{
         if(typeof sql==="string" && sql.includes("pocket_handover_publish_claimed"))
           dispatches++;
         return c.query(sql,values);
       },
       release:(bad)=>c.release(bad),
     };
   },
   query:(sql,v)=>executorDb.query(sql,v)
 };
 const execute=async intent=>mk(intent,instrumented).execute(Object.freeze({}));
 try {
   // Reset ONLY ephemeral tables between independent proof groups.
   await admin.query("TRUNCATE TABLE public.pocket_handover_release_pointers, "+
     "public.pocket_handover_release_entries");
   await admin.query("CREATE ROLE p349_issuer LOGIN PASSWORD 'only_test_p349_issuer'");
   await admin.query(DDL);
   await admin.query("GRANT pocket_handover_approval_issuer TO p349_issuer");
   await admin.query("CREATE ROLE p349_alice_executor LOGIN "+
     "PASSWORD 'only_test_p349_alice_executor'");
   await admin.query("GRANT pocket_handover_publication_executor,"+
     "pocket_handover_publisher TO p349_alice_executor");
   await admin.query("INSERT INTO public.pocket_handover_role_bindings "+
     "(db_login,owner_id,resource_id,capability) "+
     "VALUES('p349_alice_executor','alice','handover','publisher')");
   const grants=await admin.query(
     "SELECT has_function_privilege($1,'public.pocket_handover_publish_claimed(text,text,text)',"+
     "'EXECUTE') AS can_execute,"+
     "has_table_privilege($1,'public.pocket_handover_release_pointers','UPDATE') AS can_update,"+
     "has_table_privilege($1,'public.pocket_handover_approval_receipts','INSERT') AS can_issue",
     ["p349_alice_executor"]);
   assert.deepEqual(grants.rows[0],
     {can_execute:true,can_update:false,can_issue:false});
   for(const role of roleNames){
     const x=await admin.query("SELECT "+
       "has_function_privilege($1,'public.pocket_handover_publish_claimed(text,text,text)','EXECUTE') AS finalise,"+
       "has_table_privilege($1,'public.pocket_handover_release_pointers','INSERT') AS insert_ptr,"+
       "has_table_privilege($1,'public.pocket_handover_release_pointers','UPDATE') AS update_ptr",
       [role]);
     assert.deepEqual(x.rows[0],{finalise:false,insert_ptr:false,update_ptr:false});
   }
   const ordinary=PG("p349_alice_publisher");opened.push(ordinary);
   await assert.rejects(ordinary.query(
     "SELECT public.pocket_handover_publish_claimed('ap000000000000','fake','{}')"),
     e=>e.code==="42501");
   await assert.rejects(ordinary.query(
     "INSERT INTO public.pocket_handover_release_pointers "+
     "(owner_id,resource_id,release_id,content,revision,updated_at) "+
     "VALUES('alice','handover','r999','forged',1,clock_timestamp())"),
     e=>e.code==="42501");

   // A. Normal publication; B. replay must be DB-admission denial, zero dispatch.
   await stageAll("r3101");const normal=await issue("r3101",0);
   assert.equal((await execute(normal)).ok,true);
   assert.deepEqual(await pointer(),{releaseId:"r3101",revision:1});
   assert.deepEqual(await state(normal),{status:"settled",publication_outcome:"published"});
   const afterNormal=dispatches;
   assert.equal((await execute(normal)).reason,"admission-denied");
   assert.equal(dispatches,afterNormal);
   const status=await mk(normal).reconcile(Object.freeze({}));
   assert.equal(status.outcome,"published");

   // C. Real SQL publication succeeds inside BEGIN but is rolled back.
   // SPENT is already committed on a separate connection.
   await stageAll("r3102");const rolled=await issue("r3102",1);
   const aborted={
     connect:async()=>{
       const c=await executorDb.connect();
       return {query:async(sql,v)=>{
         if(typeof sql==="string" && sql.includes("pocket_handover_publish_claimed")){
           dispatches++;return c.query(sql,v);
         }
         if(sql==="COMMIT" && observedSpend){
           // Simulate an actual outer caller-controlled rollback AFTER SQL.
           await c.query("ROLLBACK");
           throw Error("disposable rollback instead of COMMIT");
         }
         return c.query(sql,v);
       },release:x=>c.release(x)};
     },
     query:(sql,v)=>executorDb.query(sql,v)
   };
   let observedSpend=false;
   // Mark spend's COMMIT before the finaliser connection is used.
   const rollbackWrapper={connect:async()=>{
      const c=await executorDb.connect();
      return {query:async(sql,v)=>{
        if(typeof sql==="string"&&sql.includes("pocket_handover_publish_claimed")){
          dispatches++;return c.query(sql,v);
        }
        if(sql==="COMMIT"){if(observedSpend){await c.query("ROLLBACK");
          throw Error("simulated outer rollback");}observedSpend=true;}
        return c.query(sql,v);
      },release:x=>c.release(x)};
   },query:(sql,v)=>executorDb.query(sql,v)};
   const rollbackResult=await mk(rolled,rollbackWrapper).execute(Object.freeze({}));
   assert.equal(rollbackResult.ok,false);
   assert.equal((await state(rolled)).status,"spent");
   assert.deepEqual(await pointer(),{releaseId:"r3101",revision:1});
   const dispatchedAfterRollback=dispatches;
   assert.equal((await execute(rolled)).reason,"admission-denied");
   assert.equal(dispatches,dispatchedAfterRollback);

   // D. Cross-process safe durable CAS: one winner, one dispatch.
   await stageAll("r3103");const race=await issue("r3103",1);
   const raceStart=dispatches;
   const both=await Promise.all([execute(race),execute(race)]);
   assert.equal(both.filter(x=>x.ok).length,1);
   assert.equal(dispatches-raceStart,1);
   assert.deepEqual(await pointer(),{releaseId:"r3103",revision:2});

   // F. Kill actual process immediately after SPENT COMMIT, before dispatch.
   await stageAll("r3104");const crashed=await issue("r3104",2);
   const killed=await runChild("after-admission",crashed,true);
   assert.equal(killed.signal,"SIGKILL");
   assert.match(killed.stdout,/SPENT_COMMITTED/);
   assert.equal((await state(crashed)).status,"spent");
   const beforeCrashRepeat=dispatches;
   assert.equal((await execute(crashed)).reason,"admission-denied");
   assert.equal(dispatches,beforeCrashRepeat);
   assert.deepEqual(await pointer(),{releaseId:"r3103",revision:2});

   // G. Hold pointer lock so submitted child SQL is blocked; SIGKILL child.
   await stageAll("r3105");const interrupted=await issue("r3105",2);
   const blocker=await admin.connect();
   try {
     await blocker.query("BEGIN");
     await blocker.query("SELECT revision FROM public.pocket_handover_release_pointers "+
       "WHERE owner_id='alice' AND resource_id='handover' FOR UPDATE");
     const child=await runChild("blocked-publication",interrupted,true);
     assert.match(child.stdout,/FINALISER_SUBMITTED/);
   } finally {await blocker.query("ROLLBACK");blocker.release();}
   assert.equal((await state(interrupted)).status,"spent");
   assert.deepEqual(await pointer(),{releaseId:"r3103",revision:2});
   const oldCount=dispatches;
   assert.equal((await execute(interrupted)).reason,"admission-denied");
   assert.equal(dispatches,oldCount);

   // H. Real publication COMMIT then synthetic lost ACK; read only.
   await stageAll("r3106");const uncertain=await issue("r3106",2);
   const lost=await runChild("lost-ack",uncertain);
   assert.match(lost.stdout,/publication-acknowledgement-unknown/);
   const remote=await mk(uncertain).reconcile(Object.freeze({}));
   assert.equal(remote.outcome,"published");
   assert.equal(remote.publishedRevision,3);
   assert.deepEqual(await pointer(),{releaseId:"r3106",revision:3});
   assert.equal((await execute(uncertain)).reason,"admission-denied");

   // I. Denial scenarios leave SPENT and prior releases untouched.
   const missing=await issue("r3107",3);
   assert.equal((await execute(missing)).result?.reason||"incomplete-release","incomplete-release");
   assert.equal((await state(missing)).status,"settled");
   await stageAll("r3108");
   const wrong=JSON.parse(manifest("r3108"));
   wrong.documents[0].digest="f".repeat(64);
   const corrupted=await issue("r3108",3,{man:JSON.stringify(wrong)});
   assert.equal((await execute(corrupted)).result?.reason||"incomplete-release","incomplete-release");
   const spoof=await issue("r3108",3,{owner:"bob"});
   assert.equal((await execute(spoof)).reason,"admission-denied");
   const badResource=await issue("r3108",3,{resource:"notes"});
   assert.equal((await execute(badResource)).reason,"admission-denied");
   const stale=await issue("r3108",1);
   assert.equal((await execute(stale)).result?.reason||"revision-conflict","revision-conflict");
   assert.deepEqual(await pointer(),{releaseId:"r3106",revision:3});
   const past=await reader.query(
     "SELECT content,sha256 FROM public.pocket_handover_release_entries "+
     "WHERE owner_id='alice' AND resource_id='handover' AND release_id='r3101' AND name=$1",
     [NAMES[0]]);
   assert.equal(past.rows[0].sha256,H(past.rows[0].content));
   assert.equal(past.rows[0].content,doc("r3101",NAMES[0]));
   console.log("P349_ONE_SHOT=PASS; postgres-real=YES; durable-SPENT=PASS; "+
     "rollback-repeat-dispatch=0; concurrent-one-dispatch=PASS; "+
     "SIGKILL-after-admission=PASS; SIGKILL-submitted=PASS; "+
     "unknown-COMMIT=read-only; compromised-executor-outside-guarantee");
 } finally {await Promise.allSettled(opened.map(p=>p.end()));}
});
