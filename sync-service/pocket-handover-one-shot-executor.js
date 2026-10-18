"use strict";

// P349 DORMANT TEST SEAM. NO production route or credentials.
// resolveTrustedIntent is a trusted, injected authority boundary. The
// attached test substitutes synthetic receipts, NOT genuine human approval.
// The executor owns BOTH committed SPENT admission and exactly one dispatch.
// It never interprets a timeout, worker crash or unknown COMMIT as retry permission.
const ID = /^ap[a-z0-9]{12,48}$/;

function createOneShotPublicationExecutor({
  pool, resolveTrustedIntent, afterAdmissionCommitted,
  beforeDispatch,
} = {}) {
  if (!pool || typeof pool.connect !== "function"
      || typeof resolveTrustedIntent !== "function"
      || (afterAdmissionCommitted && typeof afterAdmissionCommitted !== "function")
      || (beforeDispatch && typeof beforeDispatch !== "function")) {
    throw new Error("p349-one-shot-trusted-dependencies-required");
  }

  // Caller receives no raw SQL capability and cannot supply receipt identity
  // directly. Both values come from the injected trusted resolver.
  async function execute(auth) {
    let intent;
    try {intent = await resolveTrustedIntent(auth);}
    catch {return Object.freeze({ok:false,reason:"unverified-intent"});}
    if (!intent || !ID.test(intent.receiptId)
        || typeof intent.secret !== "string" || intent.secret.length < 16
        || typeof intent.manifest !== "string" || intent.manifest.length < 1) {
      return Object.freeze({ok:false,reason:"unverified-intent"});
    }
    const {receiptId,secret,manifest} = intent;
    let c, claimCommitted=false, commitStarted=false, discard=false;
    try {
      c = await pool.connect();
      await c.query("BEGIN");
      const result = await c.query(
        "SELECT public.pocket_handover_spend_receipt($1,$2,$3) AS decision",
        [receiptId,secret,manifest]);
      if (result.rowCount !== 1 || result.rows[0].decision !== "spent") {
        await c.query("ROLLBACK");
        return Object.freeze({ok:false,reason:"admission-denied"});
      }
      commitStarted=true;
      await c.query("COMMIT");
      claimCommitted=true;
    } catch {
      // COMMIT may have occurred. NEVER dispatch without clear ACK.
      if (!commitStarted && c) {
        try {await c.query("ROLLBACK");} catch {discard=true;}
      }
      if (commitStarted) {
        // A fresh authoritative read is diagnostic ONLY. Even if SPENT
        // committed, uncertain admission is never permission to dispatch.
        const reconciliation=await reconcile(auth);
        return Object.freeze({ok:false,
          reason:"admission-acknowledgement-unknown",reconciliation});
      }
      return Object.freeze({ok:false,reason:"admission-failed"});
    } finally {
      if(c) {try {c.release(discard || (commitStarted && !claimCommitted));}catch {}}
    }

    // Deliberate fault-injection seam. A crash here leaves SPENT, not pending.
    if(afterAdmissionCommitted) {
      try {await afterAdmissionCommitted({receiptId});}
      catch {return Object.freeze({ok:false,reason:"spent-without-dispatch"});}
    }

    let p, dispatchStarted=false, commitAttempted=false, bad=false;
    try {
      p=await pool.connect();
      await p.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      if(beforeDispatch) await beforeDispatch({receiptId});
      dispatchStarted=true;
      // THE ONLY FINALISATION DISPATCH. No loop, retry, worker resumption,
      // request-level fallback or idempotency replay.
      const r=await p.query(
        "SELECT public.pocket_handover_publish_claimed($1,$2,$3) AS result",
        [receiptId,secret,manifest]);
      if(r.rowCount!==1 || !r.rows[0].result || typeof r.rows[0].result.ok!=="boolean"){
        throw Error("p349-unexpected-finaliser-result");
      }
      commitAttempted=true;
      await p.query("COMMIT");
      return Object.freeze(r.rows[0].result.ok ?
        {ok:true,result:r.rows[0].result} :
        {ok:false,reason:r.rows[0].result.reason||"publication-denied"});
    } catch {
      if(!commitAttempted && p){
        try {await p.query("ROLLBACK");}catch{bad=true;}
      }
      if (commitAttempted) {
        const reconciliation=await reconcile(auth);
        return Object.freeze({ok:false,
          reason:"publication-acknowledgement-unknown",reconciliation});
      }
      return Object.freeze({ok:false,reason:dispatchStarted?
        "publication-failed-spent":"spent-before-dispatch"});
    } finally {
      if(p){try {p.release(bad||commitAttempted);}catch {}}
    }
  }

  async function reconcile(auth) {
    let intent;
    try {intent=await resolveTrustedIntent(auth);}catch {
      return Object.freeze({ok:false,reason:"unverified-intent"});
    }
    if(!intent || !ID.test(intent.receiptId) || typeof intent.secret!=="string")
      return Object.freeze({ok:false,reason:"unverified-intent"});
    try {
      const r=await pool.query(
        "SELECT public.pocket_handover_publication_status($1,$2) AS result",
        [intent.receiptId,intent.secret]);
      return Object.freeze(r.rows[0].result);
    } catch {return Object.freeze({ok:false,reason:"status-unavailable"});}
  }
  return Object.freeze({execute,reconcile});
}
module.exports=Object.freeze({createOneShotPublicationExecutor});
