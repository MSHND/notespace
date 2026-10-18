"use strict";
// P349 proof ONLY: disposable PostgreSQL 16, real JOSE ES256, separate LOGINs.
// Reuses previous proof suites and one-shot executor; NO real user accounts.
const test=require("node:test"),assert=require("node:assert/strict");
const {Pool}=require("pg"),{randomBytes,createHash}=require("node:crypto");
const {generateKeyPair,SignJWT,jwtVerify}=require("jose");
const fs=require("node:fs"),path=require("node:path");
const {NAMES}=require("../sync-service/pocket-handover-release-witness.js");
const {createDormantIdentityCapabilityBroker}=
  require("../sync-service/pocket-handover-identity-capability-broker.js");
const DDL7=fs.readFileSync(path.join(__dirname,
 "../sync-service/migrations/007-pocket-handover-restricted-publication.proposed.sql"),"utf8");
const DDL=fs.readFileSync(path.join(__dirname,
 "../sync-service/migrations/008-pocket-handover-identity-capability.proposed.sql"),"utf8");
const H=s=>createHash("sha256").update(s,"utf8").digest("hex");
const pg=user=>new Pool({host:"127.0.0.1",port:5432,database:"postgres",
 user,password:user==="postgres"?"disposable_only_password":"only_test_"+user,
 max:4,connectionTimeoutMillis:3000});
const doc=(r,n)=>"P349 identity "+r+"/"+n+" — Café / 你好 / 🌿\n";
const manifest=r=>JSON.stringify({releaseId:r,authorityEpoch:"GOOGLE_ONLY",
 documents:NAMES.map(name=>({name,releaseId:r,digest:H(doc(r,name))}))});
const cfg={issuer:"https://p349.test/",audience:"urn:p349:synthetic",
 resourceUrl:"https://p349.test/resource",jwksUrl:"https://p349.test/jwks"};
const approved=(subject,principal,owner,resource,role)=>({
 issuer:cfg.issuer,subject,audience:cfg.audience,resourceUrl:cfg.resourceUrl,
 ownerId:owner,resourceId:resource,principalId:principal,role,
 capabilities:role==="publisher"?["read","publish"]:
  role==="stager"?["read","stage"]:["read"],
 approved:true,ownerApproved:true,revoked:false,expiresAtMs:Date.now()+120000,
});
let n=0;const rid=()=>"ap"+String(++n).padStart(12,"0");
test("P349 real ES256 JWT + protected PostgreSQL capability + one-shot executor",
 {timeout:55000},async()=>{
 const admin=pg("postgres"),issuer=pg("p349_capability_service"),
   approvalIssuer=pg("p349_issuer"),aliceExec=pg("p349_alice_executor"),
   bobExec=pg("p349_bob_executor"),aliceRead=pg("p349_alice_reader"),
   aliceStage=pg("p349_alice_stager"),bobStage=pg("p349_bob_stager"),
   docs=pg("p349_docs_writer");
 const pools=[admin,issuer,approvalIssuer,aliceExec,bobExec,aliceRead,aliceStage,bobStage,docs];
 const {privateKey,publicKey}=await generateKeyPair("ES256",{extractable:false});
 const sign=async(sub,{issuer=cfg.issuer,audience=cfg.audience,expiry="2m",key=privateKey}={})=>
   new SignJWT({scope:"openid handover:read"})
     .setProtectedHeader({alg:"ES256",typ:"JWT"})
     .setIssuer(issuer).setAudience(audience).setSubject(sub)
     .setIssuedAt().setExpirationTime(expiry).sign(key);
 const verifyJwt=async token=>(await jwtVerify(token,publicKey,{
   issuer:cfg.issuer,audience:cfg.audience,algorithms:["ES256"],
 })).payload;
 const policies=[
  approved("alice-user","alice.principal","alice","handover","publisher"),
  approved("bob-user","bob.principal","bob","handover","publisher"),
  approved("alice-reader","alice.reader.principal","alice","handover","reader"),
  approved("alice-stager","alice.stager.principal","alice","handover","stager"),
 ];
 const readApprovedPolicy=async()=>({version:1,approved:true,revoked:false,
  bindings:policies});
 const intents=new Map();
 let dispatches=0;
 function monitored(pool) {
   return {
     query:(sql,args)=>pool.query(sql,args),
     connect:async()=>{
       const c=await pool.connect();
       return {query:(sql,args)=>{
         if(typeof sql==="string"&&sql.includes("pocket_handover_publish_claimed"))
           dispatches++;
         return c.query(sql,args);
       },release:bad=>c.release(bad)};
     },
   };
 }
 const make=(dbLogin,executorPool)=>{
   return createDormantIdentityCapabilityBroker({
     config:cfg,verifyJwt,readApprovedPolicy,issuerPool:issuer,
     executorPool,executorLogin:dbLogin,
     readApprovedPublication:async verified=>{
       const intent=intents.get(verified.principalId);
       return intent||null;
     },
   });
 };
 const alice=make("p349_alice_executor",monitored(aliceExec));
 const bob=make("p349_bob_executor",monitored(bobExec));
 const reader=make("p349_alice_reader",aliceRead);
 const stager=make("p349_alice_stager",aliceStage);
 async function stageRelease(r){
   for(const name of NAMES){
     await aliceStage.query("INSERT INTO public.pocket_handover_release_entries"+
       "(owner_id,resource_id,release_id,name,kind,content,sha256,revision) "+
       "VALUES('alice','handover',$1,$2,'document',$3,$4,1)",
       [r,name,doc(r,name),H(doc(r,name))]);
   }
 }
 async function separateConsent(r,rev,principal="alice.principal") {
   const receiptId=rid(),secret=randomBytes(24).toString("hex"),man=manifest(r);
   await approvalIssuer.query("INSERT INTO public.pocket_handover_approval_receipts "+
     "(receipt_id,owner_id,resource_id,principal_login,release_id,expected_revision,"+
     "manifest_sha256,secret_sha256,expires_at) "+
     "VALUES($1,'alice','handover','p349_alice_executor',$2,$3,$4,$5,"+
     "clock_timestamp()+interval '2 minutes')",
     [receiptId,r,rev,H(man),H(secret)]);
   intents.set(principal,Object.freeze({receiptId,secret,manifest:man}));
 }
 const state=async()=>{const x=await aliceRead.query("SELECT release_id,revision FROM "+
   "public.pocket_handover_release_pointers WHERE owner_id='alice' "+
   "AND resource_id='handover'");return x.rows[0];};
 try {
   // Previous role proof leaves disposable 005/006 populated. Initialise
   // previously GREEN dormant 007 here without running the process-kill suite.
   await admin.query("CREATE ROLE p349_issuer LOGIN PASSWORD 'only_test_p349_issuer'");
   await admin.query(DDL7);
   await admin.query("GRANT pocket_handover_approval_issuer TO p349_issuer");
   await admin.query("CREATE ROLE p349_alice_executor LOGIN "+
     "PASSWORD 'only_test_p349_alice_executor'");
   await admin.query("GRANT pocket_handover_publication_executor,"+
     "pocket_handover_publisher TO p349_alice_executor");
   await admin.query("INSERT INTO public.pocket_handover_role_bindings "+
     "(db_login,owner_id,resource_id,capability) "+
     "VALUES('p349_alice_executor','alice','handover','publisher')");
   await admin.query(DDL);
   await admin.query("CREATE ROLE p349_capability_service LOGIN "+
     "PASSWORD 'only_test_p349_capability_service'");
   await admin.query("GRANT pocket_handover_capability_issuer TO p349_capability_service");
   await admin.query("CREATE ROLE p349_bob_executor LOGIN "+
     "PASSWORD 'only_test_p349_bob_executor'");
   await admin.query("GRANT pocket_handover_publication_executor,"+
      "pocket_handover_publisher TO p349_bob_executor");
   await admin.query("INSERT INTO public.pocket_handover_role_bindings "+
      "(db_login,owner_id,resource_id,capability) "+
      "VALUES('p349_bob_executor','bob','handover','publisher')");
   const bindings=[
     ["alice.principal","alice-user","alice","handover",
       "p349_alice_executor","publish"],
     ["bob.principal","bob-user","bob","handover","p349_bob_executor","publish"],
     ["alice.reader.principal","alice-reader","alice","handover",
       "p349_alice_reader","read"],
     ["alice.stager.principal","alice-stager","alice","handover",
       "p349_alice_stager","stage"],
     ["alice.stager.principal","alice-stager","alice","handover",
       "p349_alice_stager","read"],
   ];
   for(const [principal,subject,owner,resource,login,operation] of bindings)
     await admin.query("INSERT INTO public.pocket_handover_principal_bindings "+
       "(principal_id,issuer,subject,owner_id,resource_id,db_login,operation,approved) "+
       "VALUES($1,$2,$3,$4,$5,$6,$7,true)",
       [principal,cfg.issuer,subject,owner,resource,login,operation]);

   // Database denies issuer and execution privileges through actual roles,
   // including ordinary Project Documents writer.
   for(const user of ["p349_docs_writer","p349_alice_stager","p349_alice_publisher",
                      "p349_alice_executor","p349_capability_service"]) {
     const x=(await admin.query("SELECT "+
       "has_function_privilege($1,'public.pocket_handover_issue_capability(text,text,text,text,text,name,text,text,text,timestamptz)','EXECUTE') AS issue,"+
       "has_function_privilege($1,'public.pocket_handover_publish_claimed(text,text,text)','EXECUTE') AS publish,"+
       "has_table_privilege($1,'public.pocket_handover_scoped_capabilities','SELECT') AS secrets,"+
       "has_table_privilege($1,'public.pocket_handover_principal_bindings','UPDATE') AS bindings",
       [user])).rows[0];
     assert.deepEqual(x,{issue:user==="p349_capability_service",
       publish:user==="p349_alice_executor",secrets:false,bindings:false});
   }
   await assert.rejects(docs.query("SELECT * FROM public.pocket_handover_scoped_capabilities"),
     e=>e.code==="42501");
   await assert.rejects(aliceExec.query("SELECT * FROM public.pocket_handover_principal_bindings"),
     e=>e.code==="42501");
   await assert.rejects(aliceStage.query("SET ROLE pocket_handover_capability_issuer"),
     e=>e.code==="42501");
   await assert.rejects(docs.query("SET ROLE pocket_handover_publication_executor"),
     e=>e.code==="42501");
   await assert.rejects(issuer.query("INSERT INTO public.pocket_handover_release_pointers "+
      "(owner_id,resource_id,release_id,content,revision,updated_at) "+
      "VALUES('alice','handover','r999','forged',1,clock_timestamp())"),
     e=>e.code==="42501");

   const aliceToken=await sign("alice-user"),bobToken=await sign("bob-user");
   const readToken=await sign("alice-reader"),stageToken=await sign("alice-stager");
   const a=await alice.prepare(aliceToken,"publish");
   assert.ok(a);
   assert.deepEqual(Object.keys(a),[]); // private secret does not escape
   assert.equal(await alice.check(a,"publish"),true);
   assert.equal(await alice.check(a,"stage"),false);
   assert.equal(await bob.check(a,"publish"),false);
   const b=await bob.prepare(bobToken,"publish");
   assert.ok(b);assert.equal(await bob.check(b,"publish"),true);
   assert.equal(await alice.prepare(bobToken,"publish"),null);
   const readHandle=await reader.prepare(readToken,"read");
   assert.ok(readHandle);assert.equal(await reader.check(readHandle,"read"),true);
   assert.equal(await reader.check(readHandle,"publish"),false);
   assert.equal(await reader.prepare(readToken,"publish"),null);
   const stageHandle=await stager.prepare(stageToken,"stage");
   assert.ok(stageHandle);assert.equal(await stager.check(stageHandle,"stage"),true);
   assert.equal(await stager.check(stageHandle,"publish"),false);

   // Genuine cryptographic rejections (not decode-only checks).
   const fake=await generateKeyPair("ES256");
   const invalid=[
     (await sign("alice-user",{key:fake.privateKey})),
     (await sign("alice-user",{issuer:"https://evil.test/"})),
     (await sign("alice-user",{audience:"urn:wrong"})),
     (await sign("alice-user",{expiry:-20})),
     aliceToken.slice(0,-2)+"aa",
     "eyJhbGciOiJub25lIn0.eyJzdWIiOiJhbGljZS11c2VyIn0.",
     "not-a-token",
   ];
   for(const x of invalid)assert.equal(await alice.prepare(x,"publish"),null);
   assert.equal(await bob.prepare(aliceToken,"publish"),null);
   assert.equal(await alice.prepare(readToken,"publish"),null);
   // Forged DB login/binding/ID or custom session state cannot grant scope.
   const forgery=await issuer.query("SELECT public.pocket_handover_issue_capability("+
     "$1,$2,$3,$4,$5,$6::name,$7,$8,$9,$10::timestamptz) AS ok",
     [cfg.issuer,"alice-user","alice.principal","bob","handover",
      "p349_alice_executor","publish","cap"+"e".repeat(32),"f".repeat(64),
      new Date(Date.now()+15000)]);
   assert.equal(forgery.rows[0].ok,false);
   const before=(await state()).revision;
   // Authentication is NOT consent. No synthetic exact approval yet.
   assert.equal((await alice.execute(a)).reason,"unverified-intent");
   assert.equal((await state()).revision,before);

   // Use-time revocation and expiry are enforced by PostgreSQL.
   const revoked=await alice.prepare(aliceToken,"publish");assert.ok(revoked);
   const latest=await admin.query("SELECT capability_id FROM "+
     "public.pocket_handover_scoped_capabilities "+
     "WHERE principal_id='alice.principal' ORDER BY issued_at DESC LIMIT 1");
   await admin.query("UPDATE public.pocket_handover_scoped_capabilities "+
      "SET revoked=true WHERE capability_id=$1",[latest.rows[0].capability_id]);
   assert.equal(await alice.check(revoked,"publish"),false);
   // Revoke protected admin policy: previously issued capabilities must fail.
   await admin.query("UPDATE public.pocket_handover_principal_bindings "+
     "SET revoked=true WHERE principal_id='bob.principal'");
   assert.equal(await bob.check(b,"publish"),false);
   assert.equal(await bob.prepare(bobToken,"publish"),null);
   await admin.query("UPDATE public.pocket_handover_principal_bindings "+
     "SET revoked=false WHERE principal_id='bob.principal'");
   const expired=await alice.prepare(aliceToken,"publish");assert.ok(expired);
   const latest2=await admin.query("SELECT capability_id FROM "+
     "public.pocket_handover_scoped_capabilities "+
     "WHERE principal_id='alice.principal' ORDER BY issued_at DESC LIMIT 1");
   await admin.query("UPDATE public.pocket_handover_scoped_capabilities "+
     "SET expires_at=clock_timestamp()-interval '1 second' "+
     "WHERE capability_id=$1",[latest2.rows[0].capability_id]);
   assert.equal(await alice.check(expired,"publish"),false);

   // Concurrent callers and pooled sessions remain independently scoped.
   const many=await Promise.all(Array.from({length:10},(_,i)=>
     i%2?alice.prepare(aliceToken,"publish"):bob.prepare(bobToken,"publish")));
   assert.ok(many.every(Boolean));
   for(let i=0;i<many.length;i++)
     assert.equal(await (i%2?alice:bob).check(many[i],"publish"),true);
   assert.equal(await bob.check(many[1],"publish"),false);
   assert.equal(await alice.check(many[0],"publish"),false);
   const sessions=await Promise.all(Array.from({length:12},(_,i)=>
     (i%2?aliceExec:bobExec).query("SELECT session_user AS who")));
   assert.ok(sessions.every((x,i)=>x.rows[0].who===
     (i%2?"p349_alice_executor":"p349_bob_executor")));

   await stageRelease("r4101");
   await separateConsent("r4101",before);
   const one=await alice.execute(a);
   assert.equal(one.ok,true);
   const after=await state();
   assert.equal(after.release_id,"r4101");
   assert.equal(Number(after.revision),Number(before)+1);
   const prevCount=dispatches;
   assert.equal((await alice.execute(a)).reason,"admission-denied");
   assert.equal(dispatches,prevCount);
   assert.equal(await bob.check(b,"publish"),true);
   // Incomplete release + stale CAS keep previous pointer and consume approval.
   await separateConsent("r4102",Number(after.revision));
   // The previous request's handle stays bound to the former SPENT receipt,
   // even after this principal receives a distinct later approval.
   const oldDispatchCount=dispatches;
   assert.equal((await alice.execute(a)).reason,"admission-denied");
   assert.equal(dispatches,oldDispatchCount);
   const next=await alice.prepare(aliceToken,"publish");
   assert.equal((await alice.execute(next)).reason,"incomplete-release");
   assert.equal((await state()).release_id,"r4101");
   assert.equal((await alice.execute(next)).reason,"admission-denied");
   // Original accepted immutable snapshot untouched.
   const old=await aliceRead.query("SELECT content,sha256 FROM "+
     "public.pocket_handover_release_entries WHERE owner_id='alice' "+
     "AND resource_id='handover' AND release_id='r4101' AND name=$1",[NAMES[0]]);
   assert.equal(old.rows[0].sha256,H(old.rows[0].content));

   // ADVERSARIAL PRE-REPAIR reproduction (intentionally fails until repaired).
   const adversarialManifest=manifest("r4198");
   const adversarialSecret="original-test-capability-secret";
   const capId="cap"+("a".repeat(31))+"1";
   const issued=await issuer.query("SELECT public.pocket_handover_issue_capability("+
     "$1,$2,$3,$4,$5,$6::name,$7,$8,$9,$10::timestamptz) AS ok",
     [cfg.issuer,"alice-user","alice.principal","alice","handover",
     "p349_alice_executor","publish",capId,H(adversarialSecret),
     new Date(Date.now()+45000)]);
   assert.equal(issued.rows[0].ok,true);
   const precheck=await aliceExec.query(
     "SELECT public.pocket_handover_check_capability($1,$2,$3,$4,$5,$6) AS ok",
     [capId,adversarialSecret,"alice.principal","alice","handover","publish"]);
   assert.equal(precheck.rows[0].ok,true);
   const approvalId=rid();
   const approvalSecret="separate-adversarial-approval-secret";
   await approvalIssuer.query("INSERT INTO public.pocket_handover_approval_receipts "+
     "(receipt_id,owner_id,resource_id,principal_login,release_id,expected_revision,"+
     "manifest_sha256,secret_sha256,expires_at) "+
     "VALUES($1,'alice','handover','p349_alice_executor','r4198',2,$2,$3,"+
     "clock_timestamp()+interval '2 minutes')",
     [approvalId,H(adversarialManifest),H(approvalSecret)]);
   await admin.query("UPDATE public.pocket_handover_scoped_capabilities "+
     "SET revoked=true WHERE capability_id=$1",[capId]);
   // Previous broker check succeeded before this real committed revocation.
   const revokedAdmission=await aliceExec.query(
     "SELECT public.pocket_handover_spend_receipt_scoped($1,$2,$3,$4,$5) AS decision",
     [approvalId,approvalSecret,adversarialManifest,capId,adversarialSecret]);
   const revocationBug=revokedAdmission.rows[0].decision==="spent";
   // The original 007 unscoped privilege is now revoked on the executor.
   await assert.rejects(aliceExec.query(
     "SELECT public.pocket_handover_spend_receipt($1,$2,$3)",
     [approvalId,approvalSecret,adversarialManifest]),
     e=>e.code==="42501");
   // Identity collision: revoke original binding, leave another issuer/subject
   // approved with identical principal/owner/resource/login/operation.
   await admin.query("INSERT INTO public.pocket_handover_principal_bindings "+
     "(principal_id,issuer,subject,owner_id,resource_id,db_login,operation,approved) "+
     "VALUES('alice.principal','https://other-issuer.test/','other-subject',"+
     "'alice','handover','p349_alice_executor','publish',true)");
   await admin.query("UPDATE public.pocket_handover_principal_bindings SET revoked=true "+
     "WHERE issuer=$1 AND subject='alice-user' AND operation='publish'",
     [cfg.issuer]);
   const wrongBinding=await aliceExec.query(
     "SELECT public.pocket_handover_check_capability($1,$2,$3,$4,$5,$6) AS ok",
     [capId,adversarialSecret,"alice.principal","alice","handover","publish"]);
   // An unrevoked twin capability witnesses the bad partial identity JOIN.
   const capTwin="cap"+("b".repeat(31))+"2";
   await issuer.query("SELECT public.pocket_handover_issue_capability("+
     "$1,$2,$3,$4,$5,$6::name,$7,$8,$9,$10::timestamptz) AS ok",
     ["https://other-issuer.test/","other-subject","alice.principal","alice","handover",
      "p349_alice_executor","publish",capTwin,H(adversarialSecret),
      new Date(Date.now()+45000)]);
   // Restore original binding solely to issue its separate targeted capability.
   await admin.query("UPDATE public.pocket_handover_principal_bindings SET revoked=false "+
     "WHERE issuer=$1 AND subject='alice-user' AND operation='publish'",[cfg.issuer]);
   const originalTwin="cap"+("c".repeat(31))+"3";
   await issuer.query("SELECT public.pocket_handover_issue_capability("+
     "$1,$2,$3,$4,$5,$6::name,$7,$8,$9,$10::timestamptz) AS ok",
     [cfg.issuer,"alice-user","alice.principal","alice","handover",
      "p349_alice_executor","publish",originalTwin,H(adversarialSecret),
      new Date(Date.now()+45000)]);
   await admin.query("UPDATE public.pocket_handover_principal_bindings SET revoked=true "+
     "WHERE issuer=$1 AND subject='alice-user' AND operation='publish'",[cfg.issuer]);
   const collisionResult=await aliceExec.query(
     "SELECT public.pocket_handover_check_capability($1,$2,$3,$4,$5,$6) AS ok",
     [originalTwin,adversarialSecret,"alice.principal","alice","handover","publish"]);
   const collisionBug=collisionResult.rows[0].ok===true;
   console.log("P349_ADVERSARIAL_GATES admission-after-revocation="+revocationBug+
     ";cross-issuer-collision="+collisionBug);
   assert.equal(revocationBug,false,"revoked before SPENT must deny");
   assert.equal(collisionBug,false,"original revoked issuer/subject cannot be rescued by collision");

   console.log("P349_IDENTITY_DB=PASS ES256=real JWT verified; owner-policy=separate; "+
     "PG-capability=scope+revoke+expiry; service-issuer-executor=isolated; "+
     "pooled-login=isolated; separate-consent=PASS; one-shot-replay=0; "+
     "human-confirmation=ABSENT production-broker=ABSENT");
 }finally{await Promise.allSettled(pools.map(x=>x.end()));}
});
