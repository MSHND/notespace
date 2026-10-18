"use strict";
// Disposable GitHub Actions child worker ONLY. Synthetic protected intent.
// Modes: after-admission (SIGKILL before dispatch), blocked-publication
// (signal after query submission, parent holds pointer row lock), lost-ack.
const {Pool}=require("pg");
const {createOneShotPublicationExecutor}=
  require("../sync-service/pocket-handover-one-shot-executor.js");
const mode=process.env.P349_CHILD_MODE;
const intent=JSON.parse(Buffer.from(process.env.P349_CHILD_INTENT||"","base64").toString("utf8"));
const settings={host:"127.0.0.1",port:5432,database:"postgres",
 user:"p349_alice_executor",password:"only_test_p349_alice_executor",
 max:2,connectionTimeoutMillis:3000};
const raw=new Pool(settings);
const wrapped={
 connect:async()=>{
   const client=await raw.connect();
   return {
     async query(sql,args){
       if(mode==="blocked-publication" && typeof sql==="string"
          && sql.includes("pocket_handover_publish_claimed")){
         const p=client.query(sql,args);
         process.stdout.write("FINALISER_SUBMITTED\n");
         return p;
       }
       if(mode==="lost-ack" && sql==="COMMIT"){
         await client.query(sql,args);
         throw Error("synthetic lost COMMIT acknowledgement AFTER real PG COMMIT");
       }
       return client.query(sql,args);
     },
     release:bad=>client.release(bad),
   };
 },
 query:(sql,args)=>raw.query(sql,args),
};
const x=createOneShotPublicationExecutor({
 pool:wrapped,
 resolveTrustedIntent:async()=>Object.freeze(intent),
 afterAdmissionCommitted:mode==="after-admission"?
   async()=>{process.stdout.write("SPENT_COMMITTED\n");process.kill(process.pid,"SIGKILL");}:undefined,
});
(async()=>{
  const result=await x.execute(Object.freeze({}));
  process.stdout.write("RESULT="+JSON.stringify(result)+"\n");
  await raw.end();
})().catch(e=>{process.stderr.write(String(e));process.exit(1);});
