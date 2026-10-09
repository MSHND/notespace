"use strict";

// P349xf candidate-only, dormant release storage. NOT a live publisher or OAuth binding.
// Legacy pocket_project_documents table/MCP/runtime are deliberately untouched.
const { createHash } = require("node:crypto");
const { NAMES } = require("./pocket-handover-release-witness.js");
const { MAX_CONTENT_BYTES, NAME_PATTERN } = require("./pocket-project-documents-postgres-store.js");

const ID = /^[a-z][a-z0-9._:-]{0,127}$/;
const RELEASE = /^r[0-9]{1,18}$/;
const EVIDENCE = /^evidence\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const DIGEST = /^[a-f0-9]{64}$/;
const sha256 = text => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

const SQL = Object.freeze({
  createEntry: `INSERT INTO public.pocket_handover_release_entries
    (owner_id,resource_id,release_id,name,kind,content,sha256,revision,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,1,clock_timestamp())
    ON CONFLICT DO NOTHING
    RETURNING owner_id,resource_id,release_id,name,kind,content,sha256,revision`,
  readEntry: `SELECT owner_id,resource_id,release_id,name,kind,content,sha256,revision
    FROM public.pocket_handover_release_entries
    WHERE owner_id=$1 AND resource_id=$2 AND release_id=$3 AND name=$4`,
  createPointer: `INSERT INTO public.pocket_handover_release_pointers
    (owner_id,resource_id,release_id,content,revision,updated_at)
    VALUES ($1,$2,$3,$4,1,clock_timestamp())
    ON CONFLICT DO NOTHING
    RETURNING owner_id,resource_id,release_id,content,revision`,
  updatePointer: `UPDATE public.pocket_handover_release_pointers
    SET release_id=$3, content=$4, revision=revision+1, updated_at=clock_timestamp()
    WHERE owner_id=$1 AND resource_id=$2 AND revision=$5 AND revision<9007199254740991
    RETURNING owner_id,resource_id,release_id,content,revision`,
  readPointer: `SELECT owner_id,resource_id,release_id,content,revision
    FROM public.pocket_handover_release_pointers
    WHERE owner_id=$1 AND resource_id=$2`,
});
const own = (x,k) => Object.prototype.hasOwnProperty.call(x,k);
const validText = s => typeof s==="string" && s.length>0 && Buffer.byteLength(s,"utf8")<=MAX_CONTENT_BYTES;
const validId = s => typeof s==="string" && ID.test(s);
const validRevision = n => Number.isSafeInteger(n) && n>=0 && n<9007199254740991;
const parsedRevision = n => typeof n==="string" && /^[1-9][0-9]*$/.test(n) ? Number(n) : n;

function fail(reason) {
  const error = new Error("Handover release safety gate refused the operation.");
  error.code = "handover-release-safety-denied";
  error.reason = reason;
  throw error;
}
function expectedRelease(id) {
  if(typeof id!=="string" || !RELEASE.test(id)) fail("release-invalid");
  return id;
}
function expectedName(name,kind) {
  if(typeof name!=="string" || name.length>120 || !NAME_PATTERN.test(name)) fail("name-invalid");
  if((kind==="document" && !NAMES.includes(name)) ||
     (kind==="evidence" && !EVIDENCE.test(name)) ||
     !["document","evidence"].includes(kind)) fail("kind-or-name-invalid");
  return name;
}
function safeResult(r) {
  if(!r || !Array.isArray(r.rows) || !Number.isSafeInteger(r.rowCount) ||
     r.rowCount!==r.rows.length || r.rowCount>1) fail("storage-result-invalid");
  return r.rows[0]??null;
}
function asEntry(row,binding,releaseId,name) {
  if(!row || row.owner_id!==binding.ownerId || row.resource_id!==binding.resourceId ||
     row.release_id!==releaseId || row.name!==name ||
     !["document","evidence"].includes(row.kind) ||
     expectedName(name,row.kind)!==name || !validText(row.content) ||
     !DIGEST.test(row.sha256) || sha256(row.content)!==row.sha256 ||
     parsedRevision(row.revision)!==1) fail("entry-integrity-invalid");
  return Object.freeze({name:row.name,kind:row.kind,content:row.content,
    digest:row.sha256,revision:1,releaseId});
}
function asPointer(row,binding) {
  const revision=parsedRevision(row?.revision);
  if(!row || row.owner_id!==binding.ownerId || row.resource_id!==binding.resourceId ||
     !RELEASE.test(row.release_id) || !validText(row.content) ||
     !validRevision(revision) || revision===0) fail("pointer-integrity-invalid");
  return Object.freeze({releaseId:row.release_id,content:row.content,revision});
}
function validateManifest(content,releaseId) {
  if(!validText(content)) fail("manifest-invalid");
  let m;
  try { m=JSON.parse(content); } catch { fail("manifest-invalid"); }
  if(!m || typeof m!=="object" || Array.isArray(m) ||
     m.releaseId!==releaseId || m.authorityEpoch!=="GOOGLE_ONLY" ||
     !Array.isArray(m.documents) || m.documents.length!==NAMES.length ||
     !m.documents.every((doc,i)=>doc && typeof doc==="object" &&
        doc.name===NAMES[i] && doc.releaseId===releaseId &&
        typeof doc.digest==="string" && DIGEST.test(doc.digest))) fail("manifest-invalid");
  return content;
}

function createHandoverReleaseSafetyStore({pool,resolvePrincipal,verifyPublisherApproval}={}) {
  if(!pool || typeof pool.query!=="function" ||
     typeof resolvePrincipal!=="function" ||
     typeof verifyPublisherApproval!=="function") fail("trusted-dependencies-missing");

  async function binding(auth,capability) {
    // This callback must be server-owned and backed by a VERIFIED subject -> owner/resource mapping.
    // No document text or user-provided owner ID can select the target tenant.
    let b;
    try { b=await resolvePrincipal(auth); } catch { fail("owner-unverified"); }
    if(!b || !validId(b.ownerId) || !validId(b.resourceId) ||
       !validId(b.principalId) || !Array.isArray(b.capabilities) ||
       !b.capabilities.includes(capability)) fail("owner-or-capability-denied");
    return b;
  }
  async function execute(sql,values) {
    try { return safeResult(await pool.query(sql,values)); }
    catch(e) { if(e?.code==="handover-release-safety-denied") throw e; fail("storage-failed"); }
  }
  async function createEntry({auth,releaseId,name,kind,content}={}) {
    const b=await binding(auth,"stage");
    expectedRelease(releaseId); expectedName(name,kind);
    if(!validText(content)) fail("content-invalid");
    const digest=sha256(content);
    const row=await execute(SQL.createEntry,
      [b.ownerId,b.resourceId,releaseId,name,kind,content,digest]);
    return row?Object.freeze({ok:true,entry:asEntry(row,b,releaseId,name)}):
      Object.freeze({ok:false,reason:"already-exists"});
  }
  async function readEntry({auth,releaseId,name}={}) {
    const b=await binding(auth,"read");
    expectedRelease(releaseId);
    if(typeof name!=="string" || !NAME_PATTERN.test(name) || name.length>120) fail("name-invalid");
    const row=await execute(SQL.readEntry,[b.ownerId,b.resourceId,releaseId,name]);
    return row?Object.freeze({ok:true,entry:asEntry(row,b,releaseId,name)}):
      Object.freeze({ok:false,reason:"not-found"});
  }
  async function readPointer({auth}={}) {
    const b=await binding(auth,"read");
    const row=await execute(SQL.readPointer,[b.ownerId,b.resourceId]);
    return row?Object.freeze({ok:true,pointer:asPointer(row,b)}):
      Object.freeze({ok:false,reason:"not-found"});
  }
  async function publishPointer({auth,releaseId,content,expectedRevision}={}) {
    const b=await binding(auth,"publish");
    expectedRelease(releaseId); validateManifest(content,releaseId);
    if(!validRevision(expectedRevision)) fail("expected-revision-invalid");
    // Independently trusted, narrow, one-use publisher approval; NOT the generic write OAuth scope.
    // Verification of real grant expiry/replay/subject is an external, UNIMPLEMENTED boundary.
    const proof={ownerId:b.ownerId,resourceId:b.resourceId,
      principalId:b.principalId,releaseId,expectedRevision,digest:sha256(content)};
    let g;
    try {g=await verifyPublisherApproval(Object.freeze({...proof}));}
    catch {fail("publisher-approval-denied");}
    if(!g || g.approved!==true || g.revoked!==false || g.oneAttempt!==true ||
       Object.keys(proof).some(k=>g[k]!==proof[k])) fail("publisher-approval-denied");
    const values=[b.ownerId,b.resourceId,releaseId,content];
    const row=await execute(expectedRevision===0?SQL.createPointer:SQL.updatePointer,
      expectedRevision===0?values:[...values,expectedRevision]);
    if(!row) {
      const existing=await execute(SQL.readPointer,[b.ownerId,b.resourceId]);
      return Object.freeze({ok:false,reason:existing?"revision-conflict":"not-found"});
    }
    const pointer=asPointer(row,b);
    if(pointer.revision!==expectedRevision+1 || pointer.releaseId!==releaseId ||
       pointer.content!==content) fail("publication-result-invalid");
    return Object.freeze({ok:true,pointer});
  }
  return Object.freeze({createEntry,readEntry,readPointer,publishPointer});
}
module.exports=Object.freeze({SQL,createHandoverReleaseSafetyStore});
