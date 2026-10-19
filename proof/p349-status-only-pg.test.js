"use strict";
// P349 PROOF ONLY. Real PostgreSQL 16 roles, protected caps and ES256 JWTs.
// Runs after exact earlier 005/006 and identity/007/008 suites in ephemeral CI.
// No real human approval, Render, account, or production credentials.
const test=require("node:test"),assert=require("node:assert/strict");
const {Pool}=require("pg"),{createHash}=require("node:crypto");
const {generateKeyPair,SignJWT,jwtVerify}=require("jose");
const fs=require("node:fs"),path=require("node:path");
const {NAMES}=require("../sync-service/pocket-handover-release-witness.js");
const {createDormantPublicationOutcomeReader}=
  require("../sync-service/pocket-handover-outcome-reader.js");
const SQL=fs.readFileSync(path.join(__dirname,
 "../sync-service/migrations/009-pocket-handover-status-only.proposed.sql"),"utf8");
const H=s=>createHash("sha256").update(s,"utf8").digest("hex");
const pg=user=>new Pool({host:"127.0.0.1",port:5432,database:"postgres",user,
 password:user==="postgres"?"disposable_only_password":"only_test_"+user,
 max:5,connectionTimeoutMillis:3000});
const cfg={issuer:"https://p349.test/",audience:"urn:p349:synthetic",
 resourceUrl:"https://p349.test/resource",jwksUrl:"https://p349.test/jwks"};
const policy=(sub,principal,owner)=>({
 issuer:cfg.issuer,subject:sub,audience:cfg.audience,resourceUrl:cfg.resourceUrl,
 ownerId:owner,resourceId:"handover",principalId:principal,role:"publisher",
 capabilities:["read","publish"],approved:true,ownerApproved:true,revoked:false,
 expiresAtMs:Date.now()+120000,
});
const content=(r,n)=>"P349 identity "+r+"/"+n+" — Café / 你好 / 🌿\n";
const manifest=r=>JSON.stringify({releaseId:r,authorityEpoch:"GOOGLE_ONLY",
 documents:NAMES.map(name=>({name,releaseId:r,digest:H(content(r,name))}))});
const RECEIPT_OLD="r4101";
const DENIED_OLD="r4102";
test("P349 STATUS: independent owner read after publish revoke, genuine PG permission and commit",
 {timeout:65000},async()=>{
 const admin=pg("postgres"),issuer=pg("p349_capability_service"),
   approver=pg("p349_issuer"),alice=pg("p349_alice_status"),
   bob=pg("p349_bob_status"),aliceExec=pg("p349_alice_executor"),
   stager=pg("p349_alice_stager"),writer=pg("p349_docs_writer");
 const opened=[admin,issuer,approver,alice,bob,aliceExec,stager,writer];
 const {privateKey,publicKey}=await generateKeyPair("ES256",{extractable:false});
 const token=async(sub,{key=privateKey,iss=cfg.issuer,aud=cfg.audience,exp="2m"}={})=>
   new SignJWT({scope:"openid handover:read",client_id:"shared-mcp-app"})
     .setProtectedHeader({alg:"ES256",typ:"JWT"})
     .setIssuer(iss).setAudience(aud).setSubject(sub)
     .setIssuedAt().setExpirationTime(exp).sign(key);
 const verifyJwt=async t=>(await jwtVerify(t,publicKey,{
   algorithms:["ES256"],issuer:cfg.issuer,audience:cfg.audience})).payload;
 const readPolicy=async()=>({version:1,approved:true,revoked:false,
   bindings:[policy("alice-user","alice.principal","alice"),
             policy("bob-user","bob.principal","bob")]});
 const broker=(dbLogin,pool)=>createDormantPublicationOutcomeReader({
   config:cfg,verifyJwt,readApprovedPolicy:readPolicy,issuerPool:issuer,
   statusPool:pool,statusLogin:dbLogin,
 });
 const aliceReader=broker("p349_alice_status",alice);
 const bobReader=broker("p349_bob_status",bob);
 const auditReceipt=async release=>(await admin.query(
   "SELECT receipt_id FROM public.pocket_handover_approval_receipts "+
   "WHERE release_id=$1 ORDER BY receipt_id LIMIT 1",[release])).rows[0]?.receipt_id;
 const eventCounts=async()=>(await admin.query(
   "SELECT status,count(*)::int AS n FROM public.pocket_handover_approval_receipts "+
   "GROUP BY status ORDER BY status")).rows;
 try{
   await admin.query(SQL);
   // App-owned status credential with NO publication/approval privilege.
   for(const who of ["alice","bob"]){
     const login="p349_"+who+"_status";
     await admin.query("CREATE ROLE "+login+" LOGIN PASSWORD 'only_test_"+login+"'");
     await admin.query("GRANT pocket_handover_outcome_reader TO "+login);
     await admin.query("INSERT INTO public.pocket_handover_principal_bindings "+
       "(principal_id,issuer,subject,owner_id,resource_id,db_login,operation,approved) "+
       "VALUES($1,$2,$3,$4,'handover',$5,'read',true)",
       [who+".principal",cfg.issuer,who+"-user",who,login]);
   }
   const original=await auditReceipt(RECEIPT_OLD),deniedReceipt=await auditReceipt(DENIED_OLD);
   assert.ok(original&&deniedReceipt);
   const aliceToken=await token("alice-user"),bobToken=await token("bob-user");
   const read=async(receiptId=original,t=aliceToken)=>aliceReader.status({token:t,receiptId});
   const revBefore=await admin.query("SELECT count(*)::int AS n FROM "+
      "public.pocket_handover_scoped_capabilities WHERE operation='publish' "+
      "AND principal_id='alice.principal' AND revoked=false");
   await admin.query("UPDATE public.pocket_handover_scoped_capabilities "+
     "SET revoked=true WHERE operation='publish' AND principal_id='alice.principal'");
   await admin.query("UPDATE public.pocket_handover_principal_bindings "+
     "SET revoked=true WHERE issuer=$1 AND subject='alice-user' "+
     "AND operation='publish'",[cfg.issuer]);
   const first=await read();
   assert.equal(first.status,"PUBLISHED");
   assert.equal(first.releaseId,RECEIPT_OLD);
   assert.equal(first.publishedRevision,1);
   // A: expired publish credentials alone cannot block independent read.
   await admin.query("UPDATE public.pocket_handover_scoped_capabilities "+
     "SET expires_at=clock_timestamp()-interval '1 second' "+
     "WHERE operation='publish' AND principal_id='alice.principal'");
   assert.equal((await read()).status,"PUBLISHED");

   // B: revoked publishing role and capabilities cannot restore publication.
   assert.equal((await read()).status,"PUBLISHED");
   const pub=await aliceExec.query(
     "SELECT public.pocket_handover_check_capability("+
     "$1,$2,'alice.principal','alice','handover','publish') AS ok",
     ["cap"+"0".repeat(32),"unknown"]);
   assert.equal(pub.rows[0].ok,false);
   // Cross-owner and non-existent IDs give the SAME response.
   const notFound="ap"+"0".repeat(12);
   const bobCross=await bobReader.status({token:bobToken,receiptId:original});
   const bobMissing=await bobReader.status({token:bobToken,receiptId:notFound});
   assert.deepEqual(bobCross,{status:"ACCESS_DENIED"});
   assert.deepEqual(bobCross,bobMissing);
   assert.deepEqual(await read(notFound),{status:"ACCESS_DENIED"});
   assert.deepEqual(await read("malformed"),{status:"ACCESS_DENIED"});

   // E: signature, issuer, audience, and human subject cannot be forged.
   const fake=await generateKeyPair("ES256");
   for(const t of [
      await token("alice-user",{key:fake.privateKey}),
      await token("alice-user",{iss:"https://evil.test/"}),
      await token("alice-user",{aud:"urn:wrong"}),
      await token("alice-user",{exp:-10}),
      await token("bob-user"),
      "invalid-token",
   ])assert.deepEqual(await read(original,t),{status:"ACCESS_DENIED"});

   // F: effective least-privilege grants and attempted SQL bypass.
   const noPower=async user=>{
     const p=(await admin.query(
       "SELECT has_table_privilege($1,'public.pocket_handover_approval_receipts','UPDATE') AS modify_receipts,"+
       "has_table_privilege($1,'public.pocket_handover_release_pointers','UPDATE') AS pointer,"+
       "has_function_privilege($1,'public.pocket_handover_publish_claimed(text,text,text)','EXECUTE') AS finalise,"+
       "has_function_privilege($1,'public.pocket_handover_spend_receipt_scoped(text,text,text,text,text)','EXECUTE') AS spend,"+
       "has_function_privilege($1,'public.pocket_handover_issue_capability(text,text,text,text,text,name,text,text,text,timestamptz)','EXECUTE') AS mint",
       [user])).rows[0];
     assert.deepEqual(p,{modify_receipts:false,pointer:false,finalise:false,
        spend:false,mint:false});
   };
   for(const u of ["p349_alice_status","p349_bob_status","p349_docs_writer"])
     await noPower(u);
   for(const forbidden of [
      "UPDATE public.pocket_handover_approval_receipts SET status='approved'",
      "INSERT INTO public.pocket_handover_release_pointers "+
      "(owner_id,resource_id,release_id,content,revision,updated_at) "+
      "VALUES('alice','handover','r999','bad',1,clock_timestamp())",
      "SELECT public.pocket_handover_publish_claimed('ap000000000000','x','{}')",
      "SELECT public.pocket_handover_spend_receipt_scoped('x','x','x','x','x')",
   ])await assert.rejects(alice.query(forbidden),e=>e.code==="42501");
   await assert.rejects(alice.query(
     "SELECT * FROM public.pocket_handover_approval_receipts"),
     e=>e.code==="42501");
   // G: committed SPENT with no pointer result remains UNRESOLVED.
   const unresolved="ap000000009911";
   await approver.query("INSERT INTO public.pocket_handover_approval_receipts "+
     "(receipt_id,owner_id,resource_id,principal_login,principal_id,release_id,"+
     "expected_revision,manifest_sha256,secret_sha256,expires_at,status,spent_at) "+
     "VALUES($1,'alice','handover','p349_alice_executor','alice.principal',"+
     "'r4991',2,$2,$3,clock_timestamp()+interval '1 minute','spent',clock_timestamp())",
     [unresolved,H(manifest("r4991")),H("synthetic approval only")]);
   assert.deepEqual(await read(unresolved),{status:"UNRESOLVED",releaseId:"r4991"});
   assert.equal((await admin.query("SELECT status FROM "+
     "public.pocket_handover_approval_receipts WHERE receipt_id=$1",
     [unresolved])).rows[0].status,"spent");
   // Denials and inconsistent/legacy receipts never become fake publication.
   assert.deepEqual(await read(deniedReceipt),
     {status:"DENIED",releaseId:DENIED_OLD});
   const malformed="ap000000009912";
   await approver.query("INSERT INTO public.pocket_handover_approval_receipts "+
     "(receipt_id,owner_id,resource_id,principal_login,principal_id,release_id,"+
     "expected_revision,manifest_sha256,secret_sha256,expires_at,status,settled_at) "+
     "VALUES($1,'alice','handover','p349_alice_executor','alice.principal',"+
     "'r4992',2,$2,$3,clock_timestamp()+interval '1 minute','settled',clock_timestamp())",
     [malformed,H(manifest("r4992")),H("synthetic other")]);
   assert.deepEqual(await read(malformed),{status:"UNKNOWN"});

   // C: revoke the underlying READ binding. A fresh JWT alone cannot help.
   await admin.query("UPDATE public.pocket_handover_principal_bindings "+
     "SET revoked=true WHERE issuer=$1 AND subject='alice-user' "+
     "AND operation='read'",[cfg.issuer]);
   assert.deepEqual(await read(),{status:"ACCESS_DENIED"});
   await admin.query("UPDATE public.pocket_handover_principal_bindings "+
     "SET revoked=false WHERE issuer=$1 AND subject='alice-user' "+
     "AND operation='read'",[cfg.issuer]);

   // Revocation between verified broker binding and actual SQL executes:
   // deliberately revoke after issuance but before calling status function.
   const intercepted={query:async(sql,args)=>{
     if(sql.includes("pocket_handover_read_publication_outcome")){
       await admin.query("UPDATE public.pocket_handover_principal_bindings "+
         "SET revoked=true WHERE issuer=$1 AND subject='alice-user' "+
         "AND operation='read'",[cfg.issuer]);
     }
     return alice.query(sql,args);
   }};
   const racy=broker("p349_alice_status",intercepted);
   assert.deepEqual(await racy.status({token:aliceToken,receiptId:original}),
     {status:"ACCESS_DENIED"});
   await admin.query("UPDATE public.pocket_handover_principal_bindings "+
      "SET revoked=false WHERE issuer=$1 AND subject='alice-user' "+
      "AND operation='read'",[cfg.issuer]);

   // Expiry after cap issuance and before SQL must refuse at protected DB.
   const expiryPool={query:async(sql,args)=>{
     if(sql.includes("pocket_handover_read_publication_outcome")){
       await admin.query("UPDATE public.pocket_handover_scoped_capabilities "+
         "SET expires_at=clock_timestamp()-interval '1 second' "+
         "WHERE capability_id=$1",[args[1]]);
     }
     return alice.query(sql,args);
   }};
   const expires=broker("p349_alice_status",expiryPool);
   assert.deepEqual(await expires.status({token:aliceToken,receiptId:original}),
     {status:"ACCESS_DENIED"});

   // Exact issuer/subject binding. A different issuing identity with all
   // other fields equal cannot rescue a revoked original read binding.
   await admin.query("INSERT INTO public.pocket_handover_principal_bindings "+
     "(principal_id,issuer,subject,owner_id,resource_id,db_login,operation,approved) "+
     "VALUES('alice.principal','https://other-issuer.test/','wrong-sub',"+
     "'alice','handover','p349_alice_status','read',true)");
   await admin.query("UPDATE public.pocket_handover_principal_bindings "+
     "SET revoked=true WHERE issuer=$1 AND subject='alice-user' "+
     "AND operation='read'",[cfg.issuer]);
   assert.deepEqual(await read(),{status:"ACCESS_DENIED"});
   await admin.query("UPDATE public.pocket_handover_principal_bindings "+
     "SET revoked=false WHERE issuer=$1 AND subject='alice-user' "+
     "AND operation='read'",[cfg.issuer]);

   // H: complete release -> real COMMIT -> synthetic lost acknowledgement ->
   // status read only with independent fresh JWT and NO FINALISER REPLAY.
   await admin.query("UPDATE public.pocket_handover_principal_bindings "+
     "SET revoked=false WHERE issuer=$1 AND subject='alice-user' "+
     "AND operation='publish'",[cfg.issuer]);
   const capId="cap"+("a".repeat(31))+"4",capSecret="disposable-finaliser-privilege-only";
   const issued=await issuer.query("SELECT public.pocket_handover_issue_capability("+
     "$1,$2,$3,$4,$5,$6::name,'publish',$7,$8,$9::timestamptz) AS ok",
     [cfg.issuer,"alice-user","alice.principal","alice","handover",
      "p349_alice_executor",capId,H(capSecret),new Date(Date.now()+45000)]);
   assert.equal(issued.rows[0].ok,true);
   const current=await admin.query("SELECT revision FROM public.pocket_handover_release_pointers "+
     "WHERE owner_id='alice' AND resource_id='handover'");
   const expected=Number(current.rows[0].revision);
   for(const name of NAMES)await stager.query(
     "INSERT INTO public.pocket_handover_release_entries "+
     "(owner_id,resource_id,release_id,name,kind,content,sha256,revision) "+
     "VALUES('alice','handover','r4200',$1,'document',$2,$3,1)",
     [name,content("r4200",name),H(content("r4200",name))]);
   const publishedReceipt="ap000000009913",approvalSecret="disposable-independent-approval-secret";
   const man=manifest("r4200");
   await approver.query("INSERT INTO public.pocket_handover_approval_receipts "+
     "(receipt_id,owner_id,resource_id,principal_login,principal_id,release_id,"+
     "expected_revision,manifest_sha256,secret_sha256,expires_at) "+
     "VALUES($1,'alice','handover','p349_alice_executor','alice.principal',"+
     "'r4200',$2,$3,$4,clock_timestamp()+interval '2 minutes')",
     [publishedReceipt,expected,H(man),H(approvalSecret)]);
   const writerConnection=await aliceExec.connect();
   let finaliserCalls=0,ackUnknown=false;
   try {
     await writerConnection.query("BEGIN");
     const admission=await writerConnection.query(
       "SELECT public.pocket_handover_spend_receipt_scoped($1,$2,$3,$4,$5) AS decision",
       [publishedReceipt,approvalSecret,man,capId,capSecret]);
     assert.equal(admission.rows[0].decision,"spent");
     await writerConnection.query("COMMIT");
     await writerConnection.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
     finaliserCalls++;
     const pub=await writerConnection.query(
       "SELECT public.pocket_handover_publish_claimed($1,$2,$3) AS result",
       [publishedReceipt,approvalSecret,man]);
     assert.equal(pub.rows[0].result.ok,true);
     await writerConnection.query("COMMIT"); // real durable PostgreSQL commit
     throw Error("synthetic lost COMMIT acknowledgement");
   }catch(e){
     if(e.message==="synthetic lost COMMIT acknowledgement")ackUnknown=true;
     else throw e;
   }finally{writerConnection.release();}
   assert.equal(ackUnknown,true);
   await admin.query("UPDATE public.pocket_handover_scoped_capabilities "+
      "SET revoked=true WHERE capability_id=$1",[capId]);
   await admin.query("UPDATE public.pocket_handover_principal_bindings "+
      "SET revoked=true WHERE issuer=$1 AND subject='alice-user' "+
      "AND operation='publish'",[cfg.issuer]);
   assert.deepEqual(await read(publishedReceipt),
     {status:"PUBLISHED",releaseId:"r4200",publishedRevision:expected+1});
   assert.equal(finaliserCalls,1);
   // I: prior historical result stays attributable after later pointer CAS.
   assert.equal((await read(original)).status,"PUBLISHED");
   assert.equal((await admin.query("SELECT release_id FROM "+
     "public.pocket_handover_release_pointers WHERE owner_id='alice' "+
     "AND resource_id='handover'")).rows[0].release_id,"r4200");

   // J: pooled, concurrently fetched status does not retain identity state.
   const beforeState=await eventCounts();
   const results=await Promise.all(Array.from({length:16},(_,i)=>
     i%2?aliceReader.status({token:aliceToken,receiptId:original}):
     bobReader.status({token:bobToken,receiptId:original})));
   results.forEach((x,i)=>assert.deepEqual(x,
      i%2?{status:"PUBLISHED",releaseId:RECEIPT_OLD,publishedRevision:1}:
      {status:"ACCESS_DENIED"}));
   assert.deepEqual(await eventCounts(),beforeState);
   assert.equal(finaliserCalls,1);
   assert.deepEqual(await read(original),await read(original));

   // K: corrupted snapshot admission, immutable history and atomic CAS
   // were rerun by earlier original suites in this workflow.
   const intact=await admin.query("SELECT content,sha256 FROM "+
      "public.pocket_handover_release_entries WHERE owner_id='alice' "+
      "AND resource_id='handover' AND release_id='r4101' AND name=$1",[NAMES[0]]);
   assert.equal(H(intact.rows[0].content),intact.rows[0].sha256);
   console.log("P349_STATUS_PG=PASS; PG16=real; JWT=ES256; revoked-publish=read-success; "+
      "expired-publish=read-success; owner-revoked=deny; cross-owner=deny; "+
      "status-role-DML/finalise=42501; spent=UNRESOLVED; "+
      "lost-COMMIT=fresh-read; historic-advance=unchanged; status-DML=ZERO; "+
      "human-approval=synthetic-only");
 }finally{await Promise.allSettled(opened.map(p=>p.end()));}
});
