"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { sha256Utf8 } = require("../sync-service/pocket-handover-release-witness.js");
const { CORE, GOVERNING, HISTORICAL, taskIdentity, stateIdentity,
  verifyMinimumHandoverRelease: verify } =
  require("../sync-service/pocket-handover-minimum-release-witness.js");

const TASK_ID = "P349wt";
const SHA = "a".repeat(40);
const approval = "approval:safe-decision@2";
const evidence = Object.freeze([
  { id: "ci-check", taskId: TASK_ID, kind: "CI", ref: "git:" + SHA, outcome: "PASS" },
  { id: "signoff", taskId: TASK_ID, kind: "APPROVAL", ref: approval, outcome: "APPROVED" },
]);

function fixture({ taskClass = "INVESTIGATION", dependencies = [], receipts = [] } = {}) {
  const requiredDocuments = [...dependencies].sort();
  const policy = { taskId: TASK_ID, taskClass, releaseId: "minimum-release-3",
    requiredDocuments, requiredEvidence: structuredClone(receipts) };
  const names = [...CORE, ...requiredDocuments].sort();
  const documents = Object.fromEntries(names.map((name, i) => [name, {
    name, revision: i + 1,
    content: name === "pocket.current-task"
      ? TASK_ID + " — MINIMUM HANDOVER PROOF\nFull task instruction."
      : name === "pocket.current-state"
        ? "POCKET — CURRENT STATE & DEVELOPMENT PATH\nFAST RESUME — 9 OCTOBER 2026\nP349ws independently GREEN; NEXT P349wt — execute approved bounded task.\nMore detail."
        : "Complete document: " + name + "\n🍃",
  }]));
  const manifest = {
    name: "pocket.handover-release", schemaVersion: 2, revision: 9,
    releaseId: policy.releaseId, authorityEpoch: "simulated-approved-epoch",
    taskId: TASK_ID,
    documents: names.map(name => ({
      name, revision: documents[name].revision,
      digest: sha256Utf8(documents[name].content),
      sourceRevision: "google-source-" + name,
      sourceDigest: sha256Utf8(documents[name].content),
    })),
    evidence: structuredClone(receipts),
  };
  const currency = { verified: true, documents: manifest.documents.map(d => ({
    name: d.name, sourceRevision: d.sourceRevision, sourceDigest: d.sourceDigest, verified: true,
  })) };
  const gate = { mode: "POCKET", approved: true, epoch: manifest.authorityEpoch,
    releaseId: manifest.releaseId, manifestRevision: manifest.revision, taskId: TASK_ID };
  const checked = Object.fromEntries(receipts.map(r => [r.id, {
    ...structuredClone(r), verified: true, revoked: false,
  }]));
  const calls = { manifest: 0, policy: 0, gate: 0, currency: 0, document: [],
    evidence: [], historical: 0, execute: 0 };
  const f = { manifest, policy, gate, currency, documents, checked, calls };
  f.readManifest = async () => { calls.manifest++; return structuredClone(f.manifest); };
  f.readTrustedTaskPolicy = async () => { calls.policy++; return structuredClone(f.policy); };
  f.readTrustedAuthorityGate = async () => { calls.gate++; return structuredClone(f.gate); };
  f.checkSourceCurrency = async () => { calls.currency++; return structuredClone(f.currency); };
  f.readDocument = async name => {
    calls.document.push(name);
    if (HISTORICAL.includes(name)) calls.historical++;
    return f.documents[name] === undefined ? undefined : structuredClone(f.documents[name]);
  };
  f.readIndependentEvidence = async r => {
    calls.evidence.push(r.id);
    return f.checked[r.id] === undefined ? undefined : structuredClone(f.checked[r.id]);
  };
  f.executeStoredTask = () => { calls.execute++; };
  return f;
}

async function reject(f, reason) {
  assert.deepEqual(await verify(f), { eligible: false, reason });
  assert.equal(f.calls.execute, 0);
}
async function accept(f) {
  const result = await verify(f);
  assert.deepEqual(result, { eligible: true, releaseId: f.manifest.releaseId,
    taskId: TASK_ID, manifestRevision: f.manifest.revision,
    authorityEpoch: f.manifest.authorityEpoch });
  assert.equal(f.calls.execute, 0);
  assert.equal(f.calls.historical, 0);
}

test("three exact core documents, no applicable extras: model eligibility only", { timeout: 5000 }, async () => {
  const f = fixture();
  await accept(f);
  assert.deepEqual(f.calls.document, [...CORE].sort());
  assert.deepEqual([f.calls.manifest, f.calls.policy, f.calls.gate, f.calls.currency],
    [2, 2, 2, 2]);
  assert.deepEqual(f.calls.evidence, []);
  assert.deepEqual(HISTORICAL, ["pocket.last-report", "pocket.task-ledger"]);
});

test("implementation independently requires How We Build even if editable manifest omits it", { timeout: 5000 }, async () => {
  const f = fixture({ taskClass: "IMPLEMENTATION" });
  await reject(f, "task-policy-invalid");
  assert.equal(f.calls.document.length, 0);
  const withPolicy = fixture({ taskClass: "IMPLEMENTATION",
    dependencies: ["pocket.how-we-build"] });
  await accept(withPolicy);
  delete withPolicy.documents["pocket.how-we-build"];
  await reject(withPolicy, "document-invalid-or-stale");
  const stale = fixture({ taskClass: "IMPLEMENTATION",
    dependencies: ["pocket.how-we-build"] });
  stale.documents["pocket.how-we-build"].revision++;
  await reject(stale, "document-invalid-or-stale");
});

test("other architecture/interaction/continuity policy dependencies are explicitly pinned", { timeout: 5000 }, async () => {
  for (const name of GOVERNING.filter(x => x !== "pocket.how-we-build")) {
    const f = fixture({ taskClass: "IMPLEMENTATION",
      dependencies: ["pocket.how-we-build", name] });
    await accept(f);
    const g = fixture({ taskClass: "IMPLEMENTATION",
      dependencies: ["pocket.how-we-build", name] });
    g.manifest.documents = g.manifest.documents.filter(d => d.name !== name);
    await reject(g, "manifest-invalid");
    const z = fixture({ taskClass: "IMPLEMENTATION",
      dependencies: ["pocket.how-we-build", name] });
    z.documents[name].content += "changed governing safety rule";
    await reject(z, "document-invalid-or-stale");
  }
});

test("Last Report and Task Ledger changes, even mid-read, never invalidate core release", { timeout: 5000 }, async () => {
  const f = fixture();
  f.documents["pocket.last-report"] = { name: "pocket.last-report", revision: 99,
    content: "Unrelated new evidence" };
  f.documents["pocket.task-ledger"] = { name: "pocket.task-ledger", revision: 103,
    content: "Unrelated backlog history" };
  const original = f.readDocument;
  f.readDocument = async name => {
    const x = await original(name);
    f.documents["pocket.last-report"].revision++;
    f.documents["pocket.task-ledger"].revision++;
    return x;
  };
  await accept(f);
  assert.equal(f.calls.historical, 0);
  assert.equal(f.documents["pocket.last-report"].revision, 102);
});

test("pinned independently checkable CI and approval receipts pass only with exact evidence", { timeout: 5000 }, async () => {
  const f = fixture({ receipts: evidence });
  await accept(f);
  assert.deepEqual(f.calls.evidence, ["ci-check", "signoff", "ci-check", "signoff"]);
  for (const action of [
    f => { delete f.checked["ci-check"]; },
    f => { f.checked["ci-check"].ref = "git:" + "b".repeat(40); },
    f => { f.checked["ci-check"].outcome = "FAIL"; },
    f => { f.checked.signoff.revoked = true; },
    f => { f.checked.signoff.verified = false; },
    f => { f.checked.signoff.taskId = "P349ws"; },
  ]) {
    const g = fixture({ receipts: evidence }); action(g);
    await reject(g, "required-evidence-unverified");
  }
  const g = fixture({ receipts: evidence });
  g.readIndependentEvidence = async r => {
    g.calls.evidence.push(r.id);
    const receipt = structuredClone(g.checked[r.id]);
    if (g.calls.evidence.length > evidence.length && r.id === "ci-check")
      receipt.revoked = true;
    return receipt;
  };
  await reject(g, "required-evidence-changed");
});

test("favourable latest Last Report cannot replace required failed evidence", { timeout: 5000 }, async () => {
  const f = fixture({ receipts: evidence });
  f.documents["pocket.last-report"] = { name: "pocket.last-report", revision: 1000,
    content: "CI PASS and approval granted (unverified latest prose)" };
  f.checked["ci-check"].outcome = "FAIL";
  await reject(f, "required-evidence-unverified");
  assert.equal(f.calls.historical, 0);
});

test("trusted task identity must match Current Task first line and State FAST RESUME NEXT", { timeout: 5000 }, async () => {
  assert.equal(taskIdentity("P349wt — Task\nbody"), TASK_ID);
  assert.equal(stateIdentity("POCKET — CURRENT STATE & DEVELOPMENT PATH\nFAST RESUME — date\nNEXT P349wt"), TASK_ID);
  for (const change of [
    f => { f.documents["pocket.current-task"].content = "P349ws — old task"; },
    f => { f.documents["pocket.current-state"].content = "POCKET — CURRENT STATE & DEVELOPMENT PATH\nFAST RESUME — date\nNEXT P349ws"; },
    f => { f.documents["pocket.current-state"].content = "POCKET — CURRENT STATE & DEVELOPMENT PATH\nFAST RESUME — date\nNEXT P349wt; NEXT P349ws"; },
    f => { f.documents["pocket.current-state"].content = "POCKET — CURRENT STATE & DEVELOPMENT PATH\nFAST RESUME — date\nNo NEXT"; },
    f => { f.documents["pocket.current-task"].content = "P349wt P349ws — ambiguous"; },
  ]) {
    const f = fixture(); change(f);
    const d = f.manifest.documents.find(x => x.name ===
      (change.toString().includes("current-task") ? "pocket.current-task" : "pocket.current-state"));
    const record = f.documents[d.name];
    d.digest = sha256Utf8(record.content);
    d.sourceDigest = d.digest;
    const curr = f.currency.documents.find(x => x.name === d.name);
    curr.sourceDigest = d.digest;
    await reject(f, "task-identity-mismatch");
  }
});

test("core mismatches and stale governing START HERE always reject", { timeout: 5000 }, async () => {
  for (const name of CORE) {
    for (const field of ["revision", "content", "name"]) {
      const f = fixture();
      if (field === "revision") f.documents[name].revision++;
      if (field === "content") f.documents[name].content += "\nstale";
      if (field === "name") f.documents[name].name = "wrong";
      await reject(f, "document-invalid-or-stale");
    }
  }
});

test("wrong source revision/digest and independently unverified currency fail closed", { timeout: 5000 }, async () => {
  for (const mutate of [
    f => { f.currency.verified = false; },
    f => { f.currency.documents[0].sourceRevision = "old"; },
    f => { f.currency.documents[1].sourceDigest = "b".repeat(64); },
    f => { f.currency.documents[1].verified = false; },
    f => { f.currency.documents.pop(); },
    f => { f.manifest.documents[0].sourceDigest = "b".repeat(64); },
  ]) {
    const f = fixture(); mutate(f);
    await reject(f, f.manifest.documents[0].sourceDigest !== f.manifest.documents[0].digest
      ? "manifest-invalid" : "source-currency-unverified");
  }
  const f = fixture();
  f.checkSourceCurrency = async () => {
    f.calls.currency++;
    const c = structuredClone(f.currency);
    if (f.calls.currency === 2) c.documents[0].sourceDigest = "b".repeat(64);
    return c;
  };
  await reject(f, "source-currency-changed");
});

test("malformed, partial, duplicate, extra or undeclared dependency manifest rejects", { timeout: 5000 }, async () => {
  const edits = [
    f => { f.manifest.schemaVersion = 1; },
    f => { f.manifest.documents.pop(); },
    f => { f.manifest.documents.push(structuredClone(f.manifest.documents[0])); },
    f => { f.manifest.documents[0].name = f.manifest.documents[1].name; },
    f => { f.manifest.documents[0].name = "pocket.last-report"; },
    f => { f.manifest.evidence.push(structuredClone(evidence[0])); },
    f => { f.manifest.taskId = "P349ws"; },
    f => { f.policy.requiredDocuments = ["pocket.task-ledger"]; },
    f => { f.policy.requiredDocuments = ["pocket.how-we-build", "pocket.how-we-build"]; },
    f => { f.policy.requiredEvidence = [structuredClone(evidence[0]), structuredClone(evidence[0])]; },
  ];
  for (const mutate of edits) {
    const f = fixture(); mutate(f);
    const policyBad = !f.policy.requiredDocuments.every(n => GOVERNING.includes(n))
      || f.policy.requiredDocuments.length !== new Set(f.policy.requiredDocuments).size
      || f.policy.requiredEvidence.length !== new Set(f.policy.requiredEvidence.map(r => r.id)).size;
    await reject(f, policyBad ? "task-policy-invalid" : "manifest-invalid");
  }
});

test("staged updates, release concurrency, policy drift and gate revocation reject without retries", { timeout: 5000 }, async () => {
  const staged = fixture();
  staged.documents[CORE[0]].revision++;
  await reject(staged, "document-invalid-or-stale");
  assert.equal(staged.calls.document.length, 1);

  const change = fixture();
  change.readManifest = async () => {
    change.calls.manifest++;
    const m = structuredClone(change.manifest);
    if (change.calls.manifest === 2) m.revision++;
    return m;
  };
  await reject(change, "manifest-changed");
  assert.equal(change.calls.manifest, 2);

  const policy = fixture();
  policy.readTrustedTaskPolicy = async () => {
    policy.calls.policy++;
    const p = structuredClone(policy.policy);
    if (policy.calls.policy === 2) p.requiredDocuments = ["pocket.how-we-build"];
    return p;
  };
  await reject(policy, "task-policy-changed");

  const revoke = fixture();
  revoke.readTrustedAuthorityGate = async () => {
    revoke.calls.gate++;
    const g = structuredClone(revoke.gate);
    if (revoke.calls.gate === 2) g.approved = false;
    return g;
  };
  await reject(revoke, "authority-changed");
});

test("GOOGLE_ONLY, missing approval, unknown epoch or missing trusted reader forbid execution", { timeout: 5000 }, async () => {
  for (const mutate of [
    g => { g.mode = "GOOGLE_ONLY"; },
    g => { g.mode = "UNKNOWN"; },
    g => { g.approved = false; },
    g => { g.epoch = "wrong"; },
    g => { g.taskId = "P349ws"; },
  ]) {
    const f = fixture(); mutate(f.gate);
    await reject(f, "authority-not-approved");
    assert.equal(f.calls.document.length, 0);
  }
  const f = fixture(); delete f.readTrustedTaskPolicy;
  assert.deepEqual(await verify(f), { eligible: false, reason: "missing-trusted-reader" });
  assert.equal(f.calls.manifest, 0);
});

test("inaccessible records/evidence/policy and ambiguous failures terminate without retry", { timeout: 5000 }, async () => {
  for (const field of ["readManifest", "readDocument", "readTrustedTaskPolicy",
    "readTrustedAuthorityGate", "checkSourceCurrency", "readIndependentEvidence"]) {
    const f = fixture({ receipts: evidence });
    let called = 0;
    f[field] = async () => { called++; throw Error("unavailable"); };
    await reject(f, "read-failed");
    assert.equal(called, 1);
  }
  const f = fixture(); f.readManifest = async () => null;
  await reject(f, "manifest-invalid");
});
