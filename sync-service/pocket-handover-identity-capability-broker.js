"use strict";
// P349 DORMANT: server-only synthetic-JWT -> DB capability broker.
// No live routes, auth issuer, real human approval or production credentials.
const {randomBytes,createHash}=require("node:crypto");
const {createProjectDocumentsTokenVerifier}=
  require("./pocket-project-documents-auth.js");
const {createHandoverVerifiedSubjectBinding}=
  require("./pocket-handover-verified-subject-binding.js");
const {createOneShotPublicationExecutor}=
  require("./pocket-handover-one-shot-executor.js");
const digest=s=>createHash("sha256").update(s,"utf8").digest("hex");
const OPS=new Set(["read","stage","publish"]);
const LOGIN=/^[a-z][a-z0-9_]{0,62}$/;

function createDormantIdentityCapabilityBroker({
  config,verifyJwt,readApprovedPolicy,issuerPool,executorPool,executorLogin,
  readApprovedPublication,now=()=>Date.now(),
}={}) {
  if(typeof verifyJwt!=="function"||typeof readApprovedPolicy!=="function"
      ||typeof readApprovedPublication!=="function"
      ||typeof issuerPool?.query!=="function"
      ||typeof executorPool?.query!=="function"
      ||typeof executorPool?.connect!=="function"
      ||typeof now!=="function"||!LOGIN.test(executorLogin||"")) {
    throw Error("p349-trusted-broker-dependencies-required");
  }
  const verifiedSubjectByAuth=new WeakMap();
  const binding=createHandoverVerifiedSubjectBinding({readApprovedPolicy});
  const verifier=createProjectDocumentsTokenVerifier({
    config,verifyJwt,
    verifiedSubjectObserver(authInfo,claims) {
      binding.verifiedSubjectObserver(authInfo,claims);
      if(typeof claims.subject==="string"&&claims.subject.length>0)
        verifiedSubjectByAuth.set(authInfo,claims.subject);
    },
  });
  const privateCapability=new WeakMap();
  const opaque=()=>Object.freeze(Object.create(null));

  async function prepare(token,operation) {
    if(!OPS.has(operation))return null;
    let principal,subject,authExpiryMs;
    try {
      const auth=await verifier.verifyAccessToken(token);
      principal=await binding.resolvePrincipal(auth);
      subject=verifiedSubjectByAuth.get(auth);
      authExpiryMs=auth.expiresAt*1000;
      if(!principal.capabilities.includes(operation)||typeof subject!=="string")
        return null;
    } catch{return null;}
    const limit=Math.min(now()+30000,authExpiryMs);
    if(!Number.isFinite(limit)||limit<=now())return null;
    const expiresAt=new Date(limit);
    const id="cap"+randomBytes(16).toString("hex");
    const secret=randomBytes(32).toString("hex");
    try {
      const r=await issuerPool.query(
        "SELECT public.pocket_handover_issue_capability("+
        "$1,$2,$3,$4,$5,$6::name,$7,$8,$9,$10::timestamptz) AS ok",
        [config.issuer,subject,principal.principalId,principal.ownerId,
         principal.resourceId,executorLogin,operation,id,digest(secret),expiresAt]);
      if(r.rowCount!==1||r.rows[0]?.ok!==true)return null;
    }catch{return null;}
    const handle=opaque();
    privateCapability.set(handle,Object.freeze({
      principal,operation,id,secret,expiresAt:expiresAt.getTime(),
    }));
    return handle;
  }

  async function check(handle,operation) {
    const c=privateCapability.get(handle);
    if(!c||c.operation!==operation||now()>=c.expiresAt)return false;
    try {
      const r=await executorPool.query(
        "SELECT public.pocket_handover_check_capability($1,$2,$3,$4,$5,$6) AS ok",
        [c.id,c.secret,c.principal.principalId,c.principal.ownerId,
         c.principal.resourceId,operation]);
      return r.rowCount===1&&r.rows[0]?.ok===true;
    }catch{return false;}
  }

  async function resolveTrustedIntent(handle) {
    const c=privateCapability.get(handle);
    if(!c||c.operation!=="publish"||!await check(handle,"publish"))
      throw Error("p349-capability-denied");
    // Separate protected synthetic receipt provider. JWT alone NEVER approves.
    const intent=await readApprovedPublication(Object.freeze({
      ownerId:c.principal.ownerId,resourceId:c.principal.resourceId,
      principalId:c.principal.principalId,dbLogin:executorLogin,
    }));
    if(!intent||typeof intent.receiptId!=="string"
      ||typeof intent.secret!=="string"||typeof intent.manifest!=="string")
      throw Error("p349-separate-approval-required");
    return Object.freeze({receiptId:intent.receiptId,
      secret:intent.secret,manifest:intent.manifest});
  }

  const executor=createOneShotPublicationExecutor({
    pool:executorPool,resolveTrustedIntent,
  });
  return Object.freeze({prepare,check,
    execute:executor.execute,reconcile:executor.reconcile});
}
module.exports=Object.freeze({createDormantIdentityCapabilityBroker});
