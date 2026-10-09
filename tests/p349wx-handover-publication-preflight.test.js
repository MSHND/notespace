"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { sha256Utf8 } = require("../sync-service/pocket-handover-release-witness.js");
const { preflightPublishHandover: publish, PROJECTION, STRUCTURE } =
  require("../sync-service/pocket-handover-publication-preflight.js");

const P = "P349wx";
const core = ["pocket.current-state", "pocket.current-task", "pocket.start-here"];
const receipt = { id: "approved-check", taskId: P, kind: "CI",
  ref: "git:" + "a".repeat(40), outcome: "PASS" };
const sourceId = n => "google-id-" + n;
const textFor = n => n === "pocket.current-task"
  ? "P349wx — BOUNDED HANDOVER PROOF\nSource task instruction"
  : n === "pocket.current-state"
    ? "POCKET — CURRENT STATE & DEVELOPMENT PATH\nFAST RESUME — 9 OCTOBER 2026\nP349wv independently GREEN. NEXT P349wx — bounded proof.\nOther history"
    : n + "\nComplete source text\n🍃";

function fixture({ taskClass = "INVESTIGATION", dependencies = [], evidence = [] } = {}) {
  const p = { releaseId: "release-p349wx-v1", taskId: P, taskClass,
    requiredDocuments: [...dependencies].sort(), requiredEvidence: structuredClone(evidence) };
  const names = [...core, ...dependencies].sort();
  const sources = Object.fromEntries(names.map(name => {
    const canonicalText = textFor(name);
    const paragraphs = canonicalText.split("\n").map(text => ({ text }));
    return [name, {
      name, documentId: sourceId(name), tabId: "t.0",
      revisionId: "google-revision-" + name, readPrincipal: "google-reader",
      structure: STRUCTURE, projectionVersion: PROJECTION,
      canonicalText, paragraphs, digest: sha256Utf8(canonicalText),
    }];
  }));
  const g = { approved: true, revoked: false, principal: "approved-publisher",
    sourceReaderPrincipal: "google-reader", action: "publish-handover-release",
    releaseId: p.releaseId, taskId: p.taskId, maxAttempts: 1, expiresAtMs: 2000,
    allowedSources: names.map(n => ({
      name: n, documentId: sourceId(n), tabId: "t.0",
      revisionId: sources[n].revisionId, digest: sources[n].digest,
    })),
  };
  const store = Object.fromEntries(names.map(name => [name,
    { name, revision: 3, content: "historical old text" }]));
  let manifest = { name: "pocket.handover-release", revision: 4,
    content: "previous-witness-contents" };
  const receipts = Object.fromEntries(evidence.map(e => [e.id,
    { ...structuredClone(e), verified: true, revoked: false }]));
  const calls = { policy: 0, principal: 0, clock: 0, mode: 0, grant: 0, manifest: 0,
    source: [], evidence: [], record: [], stage: [], publish: 0, execution: 0 };
  const f = { policy: p, grant: g, sources, store, receipts, calls, clock: 100,
    principal: "approved-publisher", mode: { mode: "GOOGLE_ONLY", epoch: "GOOGLE_ONLY" } };
  f.readTrustedPolicy = async () => { calls.policy++; return structuredClone(f.policy); };
  f.readAuthenticatedPrincipal = async () => { calls.principal++; return f.principal; };
  f.readTrustedClock = async () => { calls.clock++; return f.clock; };
  f.readAuthorityMode = async () => { calls.mode++; return structuredClone(f.mode); };
  f.readPublisherGrant = async () => { calls.grant++; return structuredClone(f.grant); };
  f.readGoogleSource = async name => {
    calls.source.push(name);
    return f.sources[name] === undefined ? undefined : structuredClone(f.sources[name]);
  };
  f.readEvidenceReceipt = async expected => {
    calls.evidence.push(expected.id);
    return f.receipts[expected.id] === undefined
      ? undefined : structuredClone(f.receipts[expected.id]);
  };
  f.readPocketRecord = async name => {
    calls.record.push(name);
    return f.store[name] === undefined ? undefined : structuredClone(f.store[name]);
  };
  f.casStagePocketRecord = async ({ name, expectedRevision, content }) => {
    calls.stage.push({ name, expectedRevision });
    if (!f.store[name] || f.store[name].revision !== expectedRevision) return null;
    f.store[name] = { name, revision: expectedRevision + 1, content };
    return structuredClone(f.store[name]);
  };
  f.readManifest = async () => { calls.manifest++; return structuredClone(manifest); };
  f.casPublishManifest = async ({ name, expectedRevision, content }) => {
    calls.publish++;
    if (name !== manifest.name || expectedRevision !== manifest.revision) return null;
    manifest = { name, revision: expectedRevision + 1, content };
    return structuredClone(manifest);
  };
  f.executeStoredTask = () => { calls.execution++; };
  f.manifest = () => structuredClone(manifest);
  return f;
}
async function denied(f, reason) {
  assert.deepEqual(await publish(f), { published: false, executable: false, reason });
  assert.equal(f.calls.execution, 0);
}
async function accepted(f, size) {
  const result = await publish(f);
  assert.deepEqual(result, { published: true, executable: false, mode: "GOOGLE_ONLY",
    releaseId: f.policy.releaseId, taskId: P, manifestRevision: 5, stagedDocuments: size });
  assert.equal(f.calls.publish, 1);
  assert.equal(f.calls.stage.length, size);
  assert.equal(f.calls.record.length, size * 2);
  assert.equal(f.calls.source.length, size * 2);
  assert.equal(f.calls.manifest, 2);
  assert.equal(f.calls.grant, 2);
  assert.equal(f.calls.policy, 2);
  assert.equal(f.calls.execution, 0);
  assert.ok(!f.calls.record.includes("pocket.last-report"));
  assert.ok(!f.calls.record.includes("pocket.task-ledger"));
  const witness = JSON.parse(f.manifest().content);
  assert.equal(witness.authorityEpoch, "GOOGLE_ONLY");
  assert.equal(witness.documents.length, size);
}

test("three-core exact source, publisher grant, 3 CAS stage/readbacks, one manifest CAS; never executable", { timeout: 5000 }, async () => {
  const f = fixture(); await accepted(f, 3);
  assert.deepEqual(f.calls.source, [...core].sort().flatMap(() => []).concat(
    [...core].sort(), [...core].sort()));
  const witness = JSON.parse(f.manifest().content);
  assert.equal(witness.schemaVersion, 2);
  assert.equal(witness.taskId, P);
  assert.ok(witness.documents.every(x => x.digest === x.sourceDigest
    && x.revision === 4));
});
test("implementation requires independently mandated How We Build and extra governing dependency", { timeout: 5000 }, async () => {
  const f = fixture({ taskClass: "IMPLEMENTATION" });
  await denied(f, "policy-invalid");
  assert.equal(f.calls.source.length, 0);
  const g = fixture({ taskClass: "IMPLEMENTATION", dependencies:
    ["pocket.how-we-build", "pocket.architecture-grammar"] });
  await accepted(g, 5);
  const h = fixture({ taskClass: "IMPLEMENTATION",
    dependencies: ["pocket.how-we-build"] });
  h.grant.allowedSources.pop();
  await denied(h, "publisher-grant-invalid");
});
test("ordinary Last Report and Task Ledger mutations during staging do not revoke publication", { timeout: 5000 }, async () => {
  const f = fixture(); f.store["pocket.last-report"] = { name: "pocket.last-report", revision: 12, content: "old report" };
  f.store["pocket.task-ledger"] = { name: "pocket.task-ledger", revision: 18, content: "old ledger" };
  const original = f.casStagePocketRecord;
  f.casStagePocketRecord = async args => {
    const r = await original(args);
    f.store["pocket.last-report"].revision += 1;
    f.store["pocket.task-ledger"].revision += 1;
    return r;
  };
  await accepted(f, 3);
  assert.equal(f.store["pocket.last-report"].revision, 15);
  assert.equal(f.store["pocket.task-ledger"].revision, 21);
});
test("required externally verified CI/approval receipts bound to task and rechecked", { timeout: 5000 }, async () => {
  const f = fixture({ evidence: [receipt] }); await accepted(f, 3);
  assert.deepEqual(f.calls.evidence, ["approved-check", "approved-check"]);
  for (const edit of [
    g => { delete g.receipts[receipt.id]; },
    g => { g.receipts[receipt.id].ref = "git:" + "b".repeat(40); },
    g => { g.receipts[receipt.id].outcome = "FAILED"; },
    g => { g.receipts[receipt.id].verified = false; },
    g => { g.receipts[receipt.id].revoked = true; },
    g => { g.receipts[receipt.id].taskId = "P349wv"; },
  ]) {
    const g = fixture({ evidence: [receipt] }); edit(g);
    await denied(g, "evidence-unverified"); assert.equal(g.calls.publish, 0);
  }
  const e = fixture({ evidence: [receipt] });
  const actual = e.readEvidenceReceipt; e.readEvidenceReceipt = async requested => {
    const v = await actual(requested);
    if (e.calls.evidence.length === 2) v.revoked = true;
    return v;
  };
  await denied(e, "evidence-changed");
});
test("favourable newest report never substitutes for denied pinned immutable evidence", { timeout: 5000 }, async () => {
  const f = fixture({ evidence: [receipt] });
  f.store["pocket.last-report"] = { name: "pocket.last-report", revision: 999,
    content: "PASS — all tests approved" };
  f.receipts[receipt.id].outcome = "FAIL";
  await denied(f, "evidence-unverified");
  assert.ok(!f.calls.record.includes("pocket.last-report"));
});
test("source revision drift OR changed full text at same revision fails before publishing", { timeout: 5000 }, async () => {
  for (const edit of [
    s => { s.revisionId = "new-revision"; },
    s => { s.paragraphs[0].text += "changed"; s.canonicalText = s.paragraphs.map(p => p.text).join("\n"); s.digest = sha256Utf8(s.canonicalText); },
    s => { s.paragraphs[0].text += "changed"; },
  ]) {
    const f = fixture(); const original = f.readGoogleSource; let n = 0;
    f.readGoogleSource = async name => {
      const s = await original(name);
      if (name === "pocket.current-state" && ++n === 2) edit(s);
      return s;
    };
    await denied(f, "source-changed-before-publish");
    assert.equal(f.calls.publish, 0);
    assert.equal(f.calls.stage.length, 3);
  }
});
test("bad source fields, missing paragraphs, wrong reader, unsupported tab/structure fail closed", { timeout: 5000 }, async () => {
  const edits = [
    s => { s.extra = true; },
    s => { delete s.documentId; },
    s => { s.paragraphs = []; },
    s => { s.paragraphs[0].unexpected = true; },
    s => { s.structure = "rich-table"; },
    s => { s.projectionVersion = "unknown"; },
    s => { s.tabId = "t.other"; },
    s => { s.readPrincipal = "untrusted"; },
    s => { s.digest = "a".repeat(64); },
    s => { s.canonicalText = "not complete"; },
  ];
  for (const edit of edits) {
    const f = fixture(); edit(f.sources["pocket.start-here"]);
    await denied(f, "source-invalid-or-stale"); assert.equal(f.calls.stage.length, 0);
  }
  const f = fixture(); delete f.sources["pocket.start-here"];
  await denied(f, "source-invalid-or-stale");
});
test("wrong P identity or ambiguous Current State NEXT rejects before stage", { timeout: 5000 }, async () => {
  const edits = [
    s => { s.paragraphs[0].text = "P349wv — wrong task"; },
    s => { s.paragraphs[2].text = "P349wv independently GREEN. NEXT P349ww"; },
    s => { s.paragraphs[2].text = "NEXT P349wx and NEXT P349ww"; },
    s => { s.paragraphs[2].text = "No active task"; },
  ];
  for(let i=0;i<edits.length;i++) {
    const f=fixture();
    const name=i===0?"pocket.current-task":"pocket.current-state";
    const s=f.sources[name]; edits[i](s);
    s.canonicalText=s.paragraphs.map(p=>p.text).join("\n");
    s.digest=sha256Utf8(s.canonicalText);
    f.grant.allowedSources.find(x=>x.name===name).digest=s.digest;
    await denied(f, "task-identity-mismatch");
    assert.equal(f.calls.stage.length, 0);
  }
});
test("grant is distinct, exact scope, approved, unexpired, unrevoked and single attempt", { timeout: 5000 }, async () => {
  const mutations = [
    f => { f.grant.approved = false; },
    f => { f.grant.revoked = true; },
    f => { f.grant.principal = "someone else"; },
    f => { f.grant.sourceReaderPrincipal = "different-reader"; },
    f => { f.grant.action = "write-any-project-document"; },
    f => { f.grant.releaseId = "other-release"; },
    f => { f.grant.taskId = "P349wv"; },
    f => { f.grant.maxAttempts = 2; },
    f => { f.grant.expiresAtMs = 100; },
    f => { f.grant.allowedSources.push({ ...f.grant.allowedSources[0], name: "pocket.last-report" }); },
    f => { f.grant.allowedSources[0].digest = "b".repeat(64); },
    f => { f.grant.allowedSources[0].revisionId = "stale"; },
    f => { f.grant.unexpected = "expanded"; },
    f => { f.principal = "wrong-account"; },
  ];
  for(const mutate of mutations){
    const f=fixture();mutate(f);
    const mismatchSource = f.grant.allowedSources.length===3
      && f.grant.allowedSources.some(x => x.digest !== f.sources[x.name]?.digest
        || x.revisionId !== f.sources[x.name]?.revisionId);
    await denied(f, mismatchSource?"source-invalid-or-stale":"publisher-grant-invalid");
    assert.equal(f.calls.stage.length,0);
  }
});
test("revoked/expired/modified grant, principal, policy or authority mode immediately before publish stops", { timeout: 5000 }, async () => {
  const modifications=[
    ["readPublisherGrant", x => { x.revoked=true; }],
    ["readPublisherGrant", x => { x.maxAttempts=2; }],
    ["readAuthenticatedPrincipal", () => "new-publisher"],
    ["readTrustedClock", () => 2000],
    ["readTrustedPolicy", x => { x.taskId="P349wv"; }],
    ["readAuthorityMode", x => { x.mode="POCKET"; }],
  ];
  for(const [fn,change] of modifications){
    const f=fixture();const orig=f[fn];let count=0;
    f[fn]=async (...args)=>{
      const v=await orig(...args); count++;
      return count===2 ? (typeof v==="object"?(change(v),v):change(v)) : v;
    };
    await denied(f,"permission-or-policy-changed");
    assert.equal(f.calls.stage.length,3);
    assert.equal(f.calls.publish,0);
  }
});
test("GOOGLE_ONLY is the only permitted preflight mode, no Pocket cutover", { timeout: 5000 }, async () => {
  for(const mode of ["POCKET","UNKNOWN",null]){
    const f=fixture();f.mode.mode=mode;
    await denied(f,"authority-mode-not-google-only");
    assert.equal(f.calls.stage.length,0);
  }
});
test("missing or corrupt staged row, CAS conflict, partial readback or ambiguous write never publishes", { timeout: 5000 }, async () => {
  const missing=fixture();delete missing.store["pocket.current-task"];
  await denied(missing,"stage-precondition-failed");
  const conflict=fixture();conflict.casStagePocketRecord=async()=>null;
  await denied(conflict,"stage-write-uncertain");
  const wrong=fixture();const base=wrong.casStagePocketRecord;
  wrong.casStagePocketRecord=async arg=>{const r=await base(arg);r.content="corrupt";return r;};
  await denied(wrong,"stage-write-uncertain");
  const partial=fixture();const op=partial.readPocketRecord;
  partial.readPocketRecord=async name=>{
    const v=await op(name);if(partial.calls.record.length===2)v.content+="corrupt";
    return v;
  };
  await denied(partial,"stage-readback-invalid");
  for(const f of [missing,conflict,wrong,partial])assert.equal(f.calls.publish,0);
});
test("changed manifest or competing writer rejects; exactly one publish CAS attempt even on error", { timeout: 5000 }, async () => {
  const changed=fixture();const orig=changed.readManifest;
  changed.readManifest=async ()=>{
    const m=await orig();if(changed.calls.manifest===2)m.revision++;return m;
  };
  await denied(changed,"manifest-concurrently-changed");
  assert.equal(changed.calls.publish,0);
  const competing=fixture();competing.casPublishManifest=async ()=>{
    competing.calls.publish++;return null;
  };
  await denied(competing,"publish-uncertain-or-conflict");
  assert.equal(competing.calls.publish,1);
  const exception=fixture();exception.casPublishManifest=async()=>{
    exception.calls.publish++;throw Error("unknown acknowledgement");
  };
  await denied(exception,"read-or-write-failed");
  assert.equal(exception.calls.publish,1);
});
test("unreadable source, grant, record, receipt or manifest: finite single-call error path, no retry", { timeout: 5000 }, async () => {
  for(const fn of ["readGoogleSource","readPublisherGrant","readPocketRecord",
    "readManifest","readEvidenceReceipt"]){
    const f=fixture({evidence:[receipt]});
    let n=0;f[fn]=async()=>{n++;throw Error("unavailable")};
    await denied(f,"read-or-write-failed");
    assert.equal(n,1);
    assert.equal(f.calls.publish,0);
  }
});
test("older witness cannot read overwritten latest-only rows during staging: fails closed unavailable", { timeout: 5000 }, async () => {
  const f=fixture();
  const original={...f.store["pocket.current-state"]};
  let priorWitness={name:"pocket.current-state",
    revision:original.revision,digest:sha256Utf8(original.content)};
  const oldMatches=()=> {
    const live=f.store["pocket.current-state"];
    return live.revision===priorWitness.revision
      && sha256Utf8(live.content)===priorWitness.digest;
  };
  assert.equal(oldMatches(),true);
  const stage=f.casStagePocketRecord;
  f.casStagePocketRecord=async arg=>{
    const result=await stage(arg);
    if(arg.name==="pocket.current-state") assert.equal(oldMatches(),false);
    return result;
  };
  await accepted(f,3);
  assert.equal(oldMatches(),false);
  // This demonstrates safe temporary unavailability, not atomic snapshots.
});
