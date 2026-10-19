"use strict";
// P349 DORMANT read-only outcome broker. NEVER imports the one-shot executor,
// reads a publication approval secret, admits SPENT or retries publication.
// Caller receipt ID is a locator, not authority. The issuer and outcome
// connections have different real PostgreSQL LOGIN credentials.
const {createHash,randomBytes}=require("node:crypto");
const {createProjectDocumentsTokenVerifier}=
  require("./pocket-project-documents-auth.js");
const {createHandoverVerifiedSubjectBinding}=
  require("./pocket-handover-verified-subject-binding.js");
const SHA=s=>createHash("sha256").update(s,"utf8").digest("hex");
const RECEIPT=/^ap[a-z0-9]{12,48}$/;
const LOGIN=/^[a-z][a-z0-9_]{0,62}$/;
const VALID=new Set(["PUBLISHED","DENIED","UNRESOLVED","UNKNOWN","ACCESS_DENIED"]);
const accessDenied=()=>Object.freeze({status:"ACCESS_DENIED"});
const unknown=()=>Object.freeze({status:"UNKNOWN"});

function createDormantPublicationOutcomeReader({
  config,verifyJwt,readApprovedPolicy,issuerPool,statusPool,statusLogin,
  now=()=>Date.now(),
}={}) {
  if(typeof verifyJwt!=="function"||typeof readApprovedPolicy!=="function"
      ||typeof issuerPool?.query!=="function"
      ||typeof statusPool?.query!=="function"
      ||typeof now!=="function"||!LOGIN.test(statusLogin||"")) {
    throw Error("p349-status-trusted-dependencies-required");
  }
  const subjects=new WeakMap();
  const binding=createHandoverVerifiedSubjectBinding({readApprovedPolicy});
  const verifier=createProjectDocumentsTokenVerifier({
    config,verifyJwt,
    verifiedSubjectObserver(auth,claims){
      binding.verifiedSubjectObserver(auth,claims);
      if(typeof claims.subject==="string"&&claims.subject.length)
        subjects.set(auth,claims.subject);
    },
  });

  async function status({token,receiptId}={}) {
    // Unknown IDs and other owners get indistinguishable ACCESS_DENIED.
    if(!RECEIPT.test(receiptId||""))return accessDenied();
    let auth,principal,subject;
    try {
      auth=await verifier.verifyAccessToken(token);
      principal=await binding.resolvePrincipal(auth);
      subject=subjects.get(auth);
      if(!principal.capabilities.includes("read")||typeof subject!=="string")
        return accessDenied();
    }catch{return accessDenied();}
    const ttl=Math.min(now()+30000,auth.expiresAt*1000);
    if(!Number.isFinite(ttl)||ttl<=now())return accessDenied();
    const id="cap"+randomBytes(16).toString("hex");
    const secret=randomBytes(32).toString("hex");
    try {
      const issued=await issuerPool.query(
        "SELECT public.pocket_handover_issue_capability("+
        "$1,$2,$3,$4,$5,$6::name,'read',$7,$8,$9::timestamptz) AS ok",
        [config.issuer,subject,principal.principalId,principal.ownerId,
          principal.resourceId,statusLogin,id,SHA(secret),new Date(ttl)]);
      if(issued.rowCount!==1||issued.rows[0]?.ok!==true)return accessDenied();
    }catch{return accessDenied();}
    let row;
    try {
      const result=await statusPool.query(
        "SELECT public.pocket_handover_read_publication_outcome($1,$2,$3) AS result",
        [receiptId,id,secret]);
      row=result.rows?.[0]?.result;
    } catch {return unknown();}
    if(!row||typeof row!=="object"||!VALID.has(row.status))return unknown();
    if(row.status==="PUBLISHED") {
      if(typeof row.releaseId!=="string"||!Number.isSafeInteger(Number(row.publishedRevision))
          ||Number(row.publishedRevision)<=0) return unknown();
      return Object.freeze({status:"PUBLISHED",releaseId:row.releaseId,
        publishedRevision:Number(row.publishedRevision)});
    }
    if(["DENIED","UNRESOLVED"].includes(row.status)) {
      if(typeof row.releaseId!=="string")return unknown();
      return Object.freeze({status:row.status,releaseId:row.releaseId});
    }
    // Never leak raw SQL, credentials, owner records, pointers or secrets.
    return Object.freeze({status:row.status});
  }
  return Object.freeze({status});
}
module.exports=Object.freeze({createDormantPublicationOutcomeReader});
