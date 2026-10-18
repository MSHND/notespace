"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {Pool}=require("pg"),{createHash}=require("node:crypto");
const {NAMES}=require("../sync-service/pocket-handover-release-witness.js");
const sql=fs.readFileSync(path.join(__dirname,"../sync-service/migrations/007-pocket-handover-restricted-publication.proposed.sql"),"utf8");
const H=s=>createHash("sha256").update(s,"utf8").digest("hex");
const conn=user=>new Pool({host:"127.0.0.1",port:5432,database:"postgres",user,password:user==="postgres"?"disposable_only_password":"only_test_"+user,max:4});
const txt=(r,n)=>"P349 "+r+"/"+n+" Café / 你好 / 🌿\n";
const man=r=>JSON.stringify({releaseId:r,authorityEpoch:"GOOGLE_ONLY",documents:NAMES.map(name=>({name,releaseId:r,digest:H(txt(r,name))}))});
let counter=0;
test("P349 DB restricted publication, scope, receipt claim and rollback boundaries",{timeout:40000},async()=>{
 const admin=conn("postgres"),issuer=conn("p349_issuer"),stager=conn("p349_alice_stager"),pub=conn("p349_alice_publisher"),reader=conn("p349_alice_reader"),eve=conn("p349_eve_publisher");
 const all=[admin,issuer,stager,pub,reader,eve],secret="disposable-proof-secret-not-human-confirmation";
 const issue=async(release,expected,opts={})=>{
   const id="ap"+String(++counter).padStart(12,"0"),manifest=opts.manifest||man(release);
   await issuer.query("INSERT INTO public.pocket_handover_approval_receipts (receipt_id,owner_id,resource_id,principal_login,release_id,expected_revision,manifest_sha256,secret_sha256,expires_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+($9||' seconds')::interval,$10)",[
      id,opts.owner||"alice",opts.resource||"handover",opts.principal||"p349_alice_publisher",release,expected,H(manifest),H(secret),opts.ttl===undefined?120:opts.ttl,opts.status||"approved"]);
   return {id,manifest};
 };
 const claim=(q,who=pub,s=secret,m=q.manifest)=>who.query("SELECT public.pocket_handover_claim_receipt($1,$2,$3) AS v",[q.id,s,m]).then(r=>r.rows[0].v);
 const publish=(q,who=pub,s=secret,m=q.manifest)=>who.query("SELECT public.pocket_handover_publish_claimed($1,$2,$3) AS v",[q.id,s,m]).then(r=>r.rows[0].v);
 const stage=async(release,names=NAMES)=>{for(const n of names)await stager.query("INSERT INTO public.pocket_handover_release_entries(owner_id,resource_id,release_id,name,kind,content,sha256,revision) VALUES('alice','handover',$1,$2,'document',$3,$4,1)",[release,n,txt(release,n),H(txt(release,n))]);};
 const pointer=async()=>{const r=await reader.query("SELECT release_id,revision FROM public.pocket_handover_release_pointers WHERE owner_id='alice' AND resource_id='handover'");return {release:r.rows[0]?.release_id,rev:Number(r.rows[0]?.revision)};};
 const status=async q=>(await admin.query("SELECT status FROM public.pocket_handover_approval_receipts WHERE receipt_id=$1",[q.id])).rows[0]?.status;
 const denied=async(p,sqlstate="42501")=>assert.rejects(p,e=>e.code===sqlstate);
 try{
  await admin.query("CREATE ROLE p349_issuer LOGIN PASSWORD 'only_test_p349_issuer'");
  await admin.query(sql);
  await admin.query("GRANT pocket_handover_approval_issuer TO p349_issuer");
  const rights=(await admin.query("SELECT has_table_privilege('p349_alice_publisher','public.pocket_handover_release_pointers','INSERT') AS i,has_table_privilege('p349_alice_publisher','public.pocket_handover_release_pointers','UPDATE') AS u,has_function_privilege('p349_alice_publisher','public.pocket_handover_publish_claimed(text,text,text)','EXECUTE') AS x")).rows[0];
  assert.deepEqual(rights,{i:false,u:false,x:true});
  await denied(pub.query("UPDATE public.pocket_handover_release_pointers SET release_id='r999' WHERE owner_id='alice'"));
  await denied(pub.query("INSERT INTO public.pocket_handover_release_pointers(owner_id,resource_id,release_id,content,revision,updated_at) VALUES('alice','handover','r999','NO APPROVAL OR SNAPSHOTS',1,clock_timestamp())"));
  await denied(eve.query("INSERT INTO public.pocket_handover_release_pointers(owner_id,resource_id,release_id,content,revision,updated_at) VALUES('eve','handover','r999','NO APPROVAL OR SNAPSHOTS',1,clock_timestamp())"));
  await denied(pub.query("INSERT INTO public.pocket_handover_approval_receipts(receipt_id,owner_id,resource_id,principal_login,release_id,expected_revision,manifest_sha256,secret_sha256,expires_at) VALUES('ap999999999999','alice','handover','p349_alice_publisher','r2001',1,$1,$2,clock_timestamp()+interval '1 minute')",[H(man("r2001")),H(secret)]));
  assert.equal((await pointer()).rev,1);
  await stage("r2001");
  const good=await issue("r2001",1);
  assert.equal(await claim(good),"claimed");
  assert.equal(await claim(good),"denied");
  assert.equal((await publish(good)).ok,true);
  assert.equal(await status(good),"settled");
  assert.equal((await publish(good)).ok,false);
  assert.deepEqual(await pointer(),{release:"r2001",rev:2});
  const missing={id:"ap000000000000",manifest:man("r2002")};
  assert.equal(await claim(missing),"denied");
  await stage("r2002");
  assert.equal(await claim(await issue("r2002",2,{ttl:-1})),"denied");
  assert.equal(await claim(await issue("r2002",2,{status:"revoked"})),"denied");
  const badSecret=await issue("r2002",2);
  assert.equal(await claim(badSecret,pub,"wrong"),"denied");
  assert.equal(await claim(badSecret,pub,secret,man("r999")),"denied");
  const forged=await issue("r2002",2,{owner:"bob"});
  assert.equal(await claim(forged),"denied");
  const crossResource=await issue("r2002",2,{resource:"notes"});
  assert.equal(await claim(crossResource),"denied");
  const crossPrincipal=await issue("r2002",2,{principal:"p349_eve_publisher"});
  assert.equal(await claim(crossPrincipal),"denied");
  assert.equal(await claim(crossPrincipal,eve),"denied");
  const shared=await issue("r2002",2);
  assert.deepEqual((await Promise.all([claim(shared),claim(shared)])).sort(),["claimed","denied"]);
  const race=await Promise.all([publish(shared),publish(shared)]);
  assert.equal(race.filter(x=>x.ok).length,1);
  assert.equal(await status(shared),"settled");
  assert.deepEqual(await pointer(),{release:"r2002",rev:3});
  await stage("r2003",NAMES.slice(0,8));
  const incomplete=await issue("r2003",3);
  assert.equal(await claim(incomplete),"claimed");
  assert.equal((await publish(incomplete)).reason,"incomplete-release");
  assert.equal(await status(incomplete),"settled");
  await stage("r2003",[NAMES[8]]);
  assert.equal((await publish(incomplete)).ok,false);
  const tampered=JSON.parse(man("r2003"));tampered.documents[0].digest="f".repeat(64);
  const incorrect=await issue("r2003",3,{manifest:JSON.stringify(tampered)});
  assert.equal(await claim(incorrect),"claimed");
  assert.equal((await publish(incorrect)).reason,"incomplete-release");
  const stale=await issue("r2003",2);
  assert.equal(await claim(stale),"claimed");
  assert.equal((await publish(stale)).reason,"revision-conflict");
  assert.equal(await status(stale),"settled");
  assert.deepEqual(await pointer(),{release:"r2002",rev:3});
  await denied(stager.query("INSERT INTO public.pocket_handover_release_entries(owner_id,resource_id,release_id,name,kind,content,sha256,revision) VALUES('alice','handover','r2010',$1,'document','different',$2,1)",[NAMES[0],"f".repeat(64)]),"23514");
  // Durable pre-claim survives explicit rollback, but the second-stage
  // function's invocation is NOT independently at-most-once after rollback.
  const interrupted=await issue("r2003",3);
  assert.equal(await claim(interrupted),"claimed");
  const c=await pub.connect();try{await c.query("BEGIN");const a=await c.query("SELECT public.pocket_handover_publish_claimed($1,$2,$3) AS v",[interrupted.id,secret,interrupted.manifest]);assert.equal(a.rows[0].v.ok,true);await c.query("ROLLBACK");}finally{c.release();}
  assert.equal(await status(interrupted),"claimed");
  assert.equal(await claim(interrupted),"denied");
  assert.deepEqual(await pointer(),{release:"r2002",rev:3});
  const acknowledged=await issue("r2003",3);
  assert.equal(await claim(acknowledged),"claimed");
  const c2=await pub.connect();let unknown=false;
  try{await c2.query("BEGIN");assert.equal((await c2.query("SELECT public.pocket_handover_publish_claimed($1,$2,$3) AS v",[acknowledged.id,secret,acknowledged.manifest])).rows[0].v.ok,true);await c2.query("COMMIT");throw Error("simulated missing COMMIT ACK");}
  catch(e){if(/missing COMMIT ACK/.test(e.message))unknown=true;else throw e;}
  finally{c2.release();}
  assert.equal(unknown,true);
  assert.deepEqual(await pointer(),{release:"r2003",rev:4});
  assert.equal(await status(acknowledged),"settled");
  const old=await reader.query("SELECT content,sha256 FROM public.pocket_handover_release_entries WHERE owner_id='alice' AND resource_id='handover' AND release_id='r2001' AND name=$1",[NAMES[0]]);
  assert.equal(old.rows[0].content,txt("r2001",NAMES[0]));
  assert.equal(old.rows[0].sha256,H(old.rows[0].content));
  console.log("P349_RESTRICTED_DB=PASS; direct SQL pointer bypass denied; ONE_CLAIM=durable; OPEN=post-rollback repeat finalisation; HUMAN=synthetic only");
 }finally{await Promise.allSettled(all.map(p=>p.end()));}
});
