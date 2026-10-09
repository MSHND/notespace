"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createNineSourceBracketRehearsal } =
  require("../sync-service/pocket-nine-source-bracket-rehearsal.js");
const { NAMES } = require("../sync-service/pocket-handover-release-witness.js");

const digest = s => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const pins = () => NAMES.map((name, i) => ({
  name, documentId: "synthetic-doc-" + (i + 1), tabId: "t.0",
  revisionId: "revision-" + (i + 1),
}));
function native(pin, values) {
  let cursor = 1;
  const body = [{ endIndex: 1, sectionBreak: { sectionStyle: {
    sectionType: "CONTINUOUS", columnSeparatorStyle: "NONE",
    contentDirection: "LEFT_TO_RIGHT",
  } } }];
  for (const parts of values) {
    const runs = Array.isArray(parts) ? parts : [parts];
    const elements = [];
    const start = cursor;
    for (let i = 0; i < runs.length; i++) {
      const text = runs[i] + (i === runs.length - 1 ? "\n" : "");
      elements.push({ startIndex: cursor, endIndex: cursor + text.length,
        textRun: { content: text, textStyle: { italic: i % 2 === 0 } } });
      cursor += text.length;
    }
    body.push({ startIndex: start, endIndex: cursor,
      paragraph: { elements, paragraphStyle: { namedStyleType: "NORMAL_TEXT" } } });
  }
  return {
    documentId: pin.documentId, revisionId: pin.revisionId,
    suggestionsViewMode: "SUGGESTIONS_INLINE",
    tabs: [{ tabId: pin.tabId, documentId: pin.documentId,
      body: { content: body }, parentTabId: null }],
  };
}
const values = i => [
  "", "synthetic source " + i, ["🍃 Māori\t", " •  text  "], "", "end " + i,
];
const pass = (identity = pins()) => identity.map((pin, i) =>
  ({ name: pin.name, snapshot: native(pin, values(i)) }));
function fixture({ first = pass(), second = structuredClone(first), attemptId = "synthetic-try-1",
  readPass } = {}) {
  const pinned = pins();
  let count = 0;
  const callback = readPass ?? (async passNumber => {
    count++;
    return structuredClone(passNumber === 1 ? first : second);
  });
  const model = createNineSourceBracketRehearsal({
    attemptId, expectedSources: pinned, readPass: callback,
  });
  return { model, callCount: () => count, pinned };
}
async function denied(f, reason) {
  const r = await f.model.run();
  assert.equal(r.ok, false);
  assert.equal(r.reason, reason);
  assert.equal(Object.hasOwn(r, "receipt"), false);
  assert.equal(f.model.state(), "aborted");
}
function independentReceiptHash(r) {
  // Independent fixed-format UTF-8 length-framed fixture implementation;
  // this MUST NOT depend on property insertion or JSON key order.
  const fields = ["p349xy-length-framed-utf8-v1", "google-native-paragraph-text-v1",
    r.attemptId, "two-full-passes-match", "9"];
  for (const source of r.orderedSources) fields.push(
    source.name, source.documentId, source.tabId, source.revisionId,
    String(source.byteCount), source.sha256);
  return digest(fields.map(x=>Buffer.byteLength(x,"utf8") + ":" + x).join(""));
}

test("P349xy two COMPLETE matching passes produce only an external ATTESTATION CANDIDATE", async () => {
  const f = fixture(), r = await f.model.run();
  assert.equal(r.ok, true);
  assert.equal(f.callCount(), 2);
  assert.equal(f.model.state(), "candidate");
  assert.equal(r.classification, "candidate-for-future-external-attestation");
  assert.equal(r.receipt.passCount, 2);
  assert.equal(r.receipt.passesMatch, true);
  assert.equal(r.receipt.orderedSources.length, 9);
  assert.deepEqual(r.receipt.orderedSources.map(s => s.name), NAMES);
  assert.ok(Object.isFrozen(r.receipt.orderedSources));
  assert.ok(Object.isFrozen(r.receipt.orderedSources[0]));
  assert.equal(r.receipt.sha256, independentReceiptHash(r.receipt));
  assert.match(r.receipt.sha256, /^[a-f0-9]{64}$/);
  for (let i = 0; i < 9; i++) {
    const row = r.receipt.orderedSources[i], p = pins()[i];
    assert.deepEqual(Object.keys(row), [
      "name", "documentId", "tabId", "revisionId", "byteCount", "sha256",
    ]);
    assert.deepEqual([row.name, row.documentId, row.tabId, row.revisionId],
      [p.name, p.documentId, p.tabId, p.revisionId]);
    const expected = values(i).map(v => Array.isArray(v) ? v.join("") : v).join("\n");
    assert.equal(row.byteCount, Buffer.byteLength(expected,"utf8"));
    assert.equal(row.sha256, digest(expected));
  }
  const serialized = JSON.stringify(r.receipt);
  assert.ok(!serialized.includes("synthetic source "));
  assert.ok(!serialized.includes("🍃"));
  assert.ok(!serialized.includes("•"));
  assert.equal(r.receipt.approved, undefined);
  assert.equal(r.receipt.published, undefined);
  assert.equal(r.receipt.authorityEpoch, undefined);
});
test("P349xy no retry of a completed attempt, even when still matching", async () => {
  const f = fixture();
  assert.equal((await f.model.run()).ok, true);
  assert.deepEqual(await f.model.run(), {ok:false, reason:"attempt-not-reusable"});
  assert.equal(f.callCount(), 2);
});
test("P349xy changed Last Report BODY at same revision in pass2 denies OLD bytes", async () => {
  const a=pass(), b=structuredClone(a);
  b[6].snapshot.tabs[0].body.content[2].paragraph.elements[0].textRun.content =
    "changed but index unchanged length?\n";
  // A valid changed source must have consistent native index geometry:
  const newContents = values(6).map(v => Array.isArray(v) ? v.join("") : v);
  newContents[1] = "different exact Last Report contents";
  b[6].snapshot = native(pins()[6], newContents);
  await denied(fixture({ first:a, second:b }), "source-changed-between-passes");
});
test("P349xy changed Current Task body with unchanged revision denies", async () => {
  const a=pass(), b=structuredClone(a);
  b[3].snapshot = native(pins()[3], ["", "new task", "", "other"]);
  await denied(fixture({first:a,second:b}), "source-changed-between-passes");
});
test("P349xy Last Report revision mutation between passes denies", async () => {
  const a=pass(),b=structuredClone(a);
  b[6].snapshot.revisionId="revision-new-last-report";
  await denied(fixture({first:a,second:b}),"source-identity-revision-or-structure-invalid");
});
test("P349xy Current Task revision mutation between passes denies", async () => {
  const a=pass(),b=structuredClone(a);
  b[3].snapshot.revisionId="revision-new-task";
  await denied(fixture({first:a,second:b}),"source-identity-revision-or-structure-invalid");
});
test("P349xy first-pass stale pinned revision denies before second pass", async () => {
  const a=pass();a[0].snapshot.revisionId="wrong";
  const f=fixture({first:a});
  await denied(f,"source-identity-revision-or-structure-invalid");
  assert.equal(f.callCount(),1);
});
test("P349xy missing source, partial pass and extra source deny any receipt", async () => {
  for (const source of [
    {first:pass().slice(0,8)}, {second:pass().slice(0,8)},
    {first:[...pass(), structuredClone(pass()[0])]},
    {second:[...pass(), structuredClone(pass()[0])]},
    {first:null}, {second:null},
  ]) {
    await denied(fixture(source), "incomplete-or-extra-source-pass");
  }
});
test("P349xy duplicate, swapped and out-of-order source fails closed", async () => {
  for (const change of [
    p=>{p[8] = structuredClone(p[0]);},
    p=>{[p[1],p[2]] = [p[2],p[1]];},
    p=>{p[0].name = "unknown-extra";},
    p=>{p[7]={name:p[7].name, snapshot:p[7].snapshot, extra:"foo"};},
  ]) {
    for (const which of ["first","second"]) {
      const altered = pass();change(altered);
      await denied(fixture({[which]:altered}),
        "missing-duplicate-or-out-of-order-source");
    }
  }
});
test("P349xy wrong Google ID and tab on either pass deny", async () => {
  for (const change of [
    p=>{p[0].snapshot.documentId="other-google-document";},
    p=>{p[5].snapshot.tabs[0].tabId="t.2";},
    p=>{p[3].snapshot.tabs[0].documentId="wrong";},
  ]) {
    for (const which of ["first","second"]) {
      const altered=pass();change(altered);
      await denied(fixture({[which]:altered}),
        "source-identity-revision-or-structure-invalid");
    }
  }
});
test("P349xy unsupported native structure blocks receipt on both passes", async () => {
  for (const which of ["first", "second"]) {
    const altered=pass();
    altered[2].snapshot.tabs[0].body.content.push({table:{tableRows:[]}});
    await denied(fixture({[which]:altered}),
      "source-identity-revision-or-structure-invalid");
  }
});
test("P349xy interrupted/throwing pass1 or pass2 is a terminal non-reusable attempt", async () => {
  for (const brokenPass of [1,2]) {
    let called=0;
    const f=fixture({readPass:async passNumber=>{
      called++;
      if(passNumber===brokenPass) throw Error("synthetic read interrupted");
      return pass();
    }});
    await denied(f,"source-read-interrupted-or-failed");
    assert.equal(called,brokenPass);
    assert.deepEqual(await f.model.run(),{ok:false,reason:"attempt-not-reusable"});
    assert.equal(called,brokenPass);
  }
});
test("P349xy an abandoned/stale attempt NEVER succeeds after input is fixed", async () => {
  let changed=true,called=0;
  const f=fixture({readPass:async passNumber=>{
    called++;
    const p=pass();
    if(passNumber===2&&changed)p[6].snapshot.revisionId="wrong";
    return p;
  }});
  await denied(f,"source-identity-revision-or-structure-invalid");
  changed=false;
  assert.deepEqual(await f.model.run(),{ok:false,reason:"attempt-not-reusable"});
  assert.equal(called,2);
  // Only a separately constructed, explicitly new invented attempt can run.
  const fresh=fixture({attemptId:"explicit-new-synthetic-attempt"});
  const result=await fresh.model.run();
  assert.equal(result.ok,true);
  assert.equal(result.receipt.attemptId,"explicit-new-synthetic-attempt");
});
test("P349xy concurrent invocations of ONE rehearsal cannot each seal a receipt", async () => {
  let release;
  const hold=new Promise(resolve=>{release=resolve;});
  const f=fixture({readPass:async i=>{
    if(i===1) await hold;
    return pass();
  }});
  const left=f.model.run();
  const right=f.model.run();
  release();
  const results=await Promise.all([left,right]);
  assert.equal(results.filter(x=>x.ok).length,1);
  assert.equal(results.filter(x=>x.reason==="attempt-not-reusable").length,1);
});
test("P349xy an INCLUDED Last Report evidence write after capture INVALIDATES fingerprint", async () => {
  const f=fixture(),r=await f.model.run();
  assert.equal(r.ok,true);
  const old=r.receipt.orderedSources[6];
  const afterReport=pass();
  const newPin={...pins()[6],revisionId:"revision-after-result-written"};
  afterReport[6]={name:NAMES[6],snapshot:native(newPin,[
    "", "P349xy result written into Last Report", "some new evidence", "",
  ])};
  assert.notEqual(newPin.revisionId,old.revisionId);
  const captured=["", "P349xy result written into Last Report", "some new evidence", ""].join("\n");
  assert.notEqual(digest(captured),old.sha256);
  // Rechecking against old pin fails; prior receipt does not self-update.
  const g=fixture({first:afterReport,second:structuredClone(afterReport)});
  await denied(g,"source-identity-revision-or-structure-invalid");
  assert.equal(r.receipt.orderedSources[6].sha256,old.sha256);
  assert.equal(r.receipt.sha256,independentReceiptHash(r.receipt));
});
test("P349xy deterministic receipt encoding length-prefix disambiguates UTF-8", async () => {
  const f=fixture(),r=await f.model.run();
  assert.equal(r.ok,true);
  assert.equal(r.receipt.encoding,"p349xy-length-framed-utf8-v1");
  const differentlyNamed=fixture({attemptId:"synthetic-try-2"});
  const v=await differentlyNamed.model.run();
  assert.equal(v.ok,true);
  assert.notEqual(r.receipt.sha256,v.receipt.sha256);
});
test("P349xy supplied expected pins must be ALL nine unique ordered IDs/revisions", () => {
  const base=pins();
  for(const change of [
    p=>p.pop(),p=>p.push({...p[0]}),
    p=>{p[3]={...p[2]};},
    p=>{p[0].documentId="";},
    p=>{p[4].documentId=p[0].documentId;},
    p=>{p[0].revisionId="";},
    p=>{p[0].tabId="";},
  ]) {
    const arr=structuredClone(base);change(arr);
    assert.throws(()=>createNineSourceBracketRehearsal({
      attemptId:"try",expectedSources:arr,readPass:async()=>pass(),
    }),TypeError);
  }
});
