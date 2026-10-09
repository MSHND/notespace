"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createHash}=require("node:crypto");
const {projectCompleteGoogleDocument:project}=require("../sync-service/pocket-google-full-source-projection.js");
const {stateIdentity}=require("../sync-service/pocket-handover-minimum-release-witness.js");
const {preflightPublishHandover}=require("../sync-service/pocket-handover-publication-preflight.js");
const hash=s=>createHash("sha256").update(Buffer.from(s,"utf8")).digest("hex");
const taskId="P349wz";
const stateParagraphs=[
  {runs:["POCKET — CURRENT STATE & DEVELOPMENT PATH"],style:"NORMAL_TEXT"},
  {runs:[""],style:"NORMAL_TEXT"},
  {runs:["FAST RESUME — 9 OCTOBER 2026"],style:"NORMAL_TEXT"},
  {runs:[""],style:"NORMAL_TEXT"},
  {runs:["P349wy independently GREEN. NEXT P349wz — projection proof."],style:"NORMAL_TEXT"},
  {runs:[""],style:"NORMAL_TEXT"},
  {runs:["Historical NEXT P349ww is parked."],style:"NORMAL_TEXT"},
];
const taskParagraphs=[
  {runs:["P349wz — COMPLETE GOOGLE-SOURCE PROJECTION"],style:"NORMAL_TEXT"},
  {runs:[""],style:"NORMAL_TEXT"},
  {runs:["Read the exact source and retain blanks."],style:"NORMAL_TEXT"},
];
const startParagraphs=[
  {runs:[""],style:"TITLE"},
  {runs:[""],style:"TITLE"},
  {runs:["POCKET"],style:"TITLE",headingId:"h.title"},
  {runs:["Start here"],style:"SUBTITLE"},
  {runs:[""],style:"NORMAL_TEXT"},
  {runs:["HEADING ", "ONE"],style:"HEADING_1",runStyles:[{bold:true},{}]},
  {runs:[""],style:"NORMAL_TEXT"},
  {runs:["Emoji 🍃 and ", "two runs"],style:"NORMAL_TEXT",runStyles:[{}, {italic:true}]},
  {runs:["   "],style:"NORMAL_TEXT"},
  {runs:[""],style:"NORMAL_TEXT"},
];
function makeDoc(name,paras,opts={}) {
  let index=1;
  const content=[{endIndex:1,sectionBreak:{sectionStyle:{
    columnSeparatorStyle:"NONE",contentDirection:"LEFT_TO_RIGHT",sectionType:"CONTINUOUS"}}}];
  for(const p of paras){
    const runs=p.runs.map((raw,i)=>raw+(i===p.runs.length-1?"\n":""));
    const elements=[];
    for(let i=0;i<runs.length;i++){
      const run=runs[i],endIndex=index+run.length;
      elements.push({startIndex:index,endIndex,textRun:{
        content:run,textStyle:p.runStyles?.[i]??{}}});
      index=endIndex;
    }
    const startIndex=elements[0].startIndex;
    content.push({startIndex,endIndex:index,paragraph:{elements,
      paragraphStyle:{namedStyleType:p.style??"NORMAL_TEXT",
        ...(p.headingId?{headingId:p.headingId}:{}),
        direction:"LEFT_TO_RIGHT"}}});
  }
  const id=opts.id??"google-"+name;
  return {documentId:id,revisionId:opts.revision??"google-source-revision-"+name,
    suggestionsViewMode:"SUGGESTIONS_INLINE",tabs:[{
      tabId:"t.0",documentId:id,body:{content},
      parentTabId:null,nestingLevel:null,headers:null,footers:null,footnotes:null,
      lists:null,namedRanges:null,inlineObjects:null,positionedObjects:null,
      dropdownDefinitions:null,
    }]};
}
const args=(doc,name,principal="google-reader")=>({snapshot:doc,name,readPrincipal:principal,
  expectedDocumentId:doc.documentId,expectedRevisionId:doc.revisionId,
  expectedTabId:"t.0"});
const projected=(name,paras)=>project(args(makeDoc(name,paras),name));

test("native body preserves two leading blanks, blank interior, trailing blank, Unicode and heading styles", {timeout:5000},()=>{
  const x=projected("pocket.start-here",startParagraphs);
  assert.equal(x.ok,true);
  assert.equal(x.fixture.paragraphs.length,10);
  assert.equal(x.witness.blankOrWhitespaceOnlyCount,6);
  assert.equal(x.fixture.paragraphs[0].text,"");
  assert.equal(x.fixture.paragraphs[1].text,"");
  assert.equal(x.fixture.paragraphs[8].text,"   ");
  assert.equal(x.fixture.paragraphs.at(-1).text,"");
  assert.ok(x.fixture.canonicalText.startsWith("\n\nPOCKET\nStart here\n\n"));
  assert.ok(x.fixture.canonicalText.endsWith("   \n"));
  assert.ok(x.fixture.canonicalText.includes("Emoji 🍃 and two runs"));
  assert.equal(x.fixture.digest,hash(x.fixture.canonicalText));
  assert.deepEqual(x.witness.styles.map(x=>x.namedStyleType),
    startParagraphs.map(x=>x.style));
  assert.equal(x.witness.styles[5].runs.length,2);
  assert.deepEqual(x.witness.styles[5].runs[0].textStyle,{bold:true});
  assert.equal(x.witness.styles[2].headingId,"h.title");
  assert.equal(x.witness.terminalParagraphIsBlank,true);
  assert.equal(x.witness.sha256,hash(JSON.stringify({
    version:x.witness.version,paragraphCount:x.witness.paragraphCount,
    blankOrWhitespaceOnlyCount:x.witness.blankOrWhitespaceOnlyCount,
    terminalParagraphIsBlank:x.witness.terminalParagraphIsBlank,
    styles:x.witness.styles,
  })));
});
test("get_document_text-style omission is demonstrably lossy, not a current-source substitute",()=>{
  const x=projected("pocket.start-here",startParagraphs);
  assert.equal(x.ok,true);
  const lossy=x.fixture.paragraphs.filter(p=>p.text.trim()!=="").map(p=>p.text).join("\n");
  assert.notEqual(lossy,x.fixture.canonicalText);
  assert.notEqual(hash(lossy),x.fixture.digest);
  assert.equal(x.fixture.paragraphs.length,10);
  assert.equal(lossy.split("\n").length,4);
});
test("multi-run UTF-16 indexes are checked without breaking emoji UTF-8 hashing",()=>{
  const doc=makeDoc("pocket.start-here",startParagraphs);
  const x=project(args(doc,"pocket.start-here"));assert.equal(x.ok,true);
  const p=doc.tabs[0].body.content.find(b=>b.paragraph?.elements?.some(e=>e.textRun.content.includes("🍃")));
  p.paragraph.elements[0].endIndex-=1;
  assert.deepEqual(project(args(doc,"pocket.start-here")),{ok:false,reason:"unsupported-or-gapped-text-run"});
});
test("full Current State keeps blank separators and identifies ONLY current FAST RESUME NEXT",()=>{
  const x=projected("pocket.current-state",stateParagraphs);
  assert.equal(x.ok,true);
  assert.equal(stateIdentity(x.fixture.canonicalText),taskId);
  assert.ok(x.fixture.canonicalText.includes("\n\nFAST RESUME — "));
  const bad=x.fixture.canonicalText.replace("NEXT P349wz","NEXT P349ww");
  assert.equal(stateIdentity(bad),"P349ww");
  assert.equal(stateIdentity(x.fixture.canonicalText.replace("NEXT P349wz","NEXT P349wz; NEXT P349ww")),null);
  assert.equal(stateIdentity("POCKET — CURRENT STATE & DEVELOPMENT PATH\n\nwrong text\nFAST RESUME — date\nNEXT P349wz"),null);
});
test("empty paragraph differs from unavailable or unsupported paragraph",()=>{
  const valid=makeDoc("pocket.start-here",startParagraphs);
  assert.equal(project(args(valid,"pocket.start-here")).ok,true);
  const noRun=structuredClone(valid);noRun.tabs[0].body.content[1].paragraph.elements=[];
  assert.equal(project(args(noRun,"pocket.start-here")).ok,false);
  const noText=structuredClone(valid);delete noText.tabs[0].body.content[1].paragraph.elements[0].textRun.content;
  assert.equal(project(args(noText,"pocket.start-here")).ok,false);
});
test("fail closed for missing/wrong revision, document ID, tab ID and untrusted projection input",()=>{
  const edits=[
    d=>{delete d.revisionId;},d=>{d.revisionId="wrong";},
    d=>{d.documentId="other";},d=>{d.tabs[0].tabId="t.1";},
    d=>{d.tabs[0].documentId="other";},
    d=>{d.tabs.push(structuredClone(d.tabs[0]));},
    d=>{d.tabs=[];},
  ];
  for(const edit of edits){
    const doc=makeDoc("pocket.current-task",taskParagraphs);
    const expected=args(doc,"pocket.current-task");
    edit(doc);
    assert.equal(project(expected).ok,false);
  }
  const doc=makeDoc("pocket.current-task",taskParagraphs);
  assert.equal(project({...args(doc,"pocket.current-task"),readPrincipal:""}).ok,false);
  assert.equal(project({...args(doc,"pocket.current-task"),expectedRevisionId:"other"}).ok,false);
  assert.equal(project({...args(doc,"pocket.current-task"),expectedDocumentId:"other"}).ok,false);
});
test("reject tables, inline objects, unsupported lists/structures, suggestions and headings",()=>{
  const edits=[
    d=>{d.tabs[0].body.content.push({table:{tableRows:[]}});},
    d=>{d.tabs[0].inlineObjects={x:{}};},
    d=>{d.tabs[0].lists={x:{}};},
    d=>{d.tabs[0].body.content[1].paragraph.bullet={listId:"x"};},
    d=>{d.tabs[0].body.content[1].paragraph.elements[0].inlineObjectElement={inlineObjectId:"x"};},
    d=>{d.tabs[0].body.content[1].paragraph.elements[0].suggestedInsertionIds=["123"];},
    d=>{d.tabs[0].body.content[1].paragraph.paragraphStyle.namedStyleType="UNKNOWN";},
    d=>{d.tabs[0].body.content[1].paragraph.elements[0].textRun.textStyle={link:{url:"https://example.com"}};},
    d=>{d.tabs[0].body.content[0].sectionBreak.sectionStyle.sectionType="NEXT_PAGE";},
  ];
  for(const edit of edits){
    const doc=makeDoc("pocket.start-here",startParagraphs);
    edit(doc);
    assert.equal(project(args(doc,"pocket.start-here")).ok,false);
  }
});
test("reject absent text runs, inconsistent paragraph termination, indexes, or unsupported legacy body",()=>{
  for(const mutation of [
    d=>{d.tabs[0].body.content[2].startIndex++;},
    d=>{d.tabs[0].body.content[2].paragraph.elements[0].startIndex++;},
    d=>{d.tabs[0].body.content[2].paragraph.elements[0].textRun.content="without term";},
    d=>{d.tabs[0].body.content[2].paragraph.elements[0].textRun.content="embedded\nline\n";},
    d=>{d.body={content:[{paragraph:{}}]};},
    d=>{d.tabs[0].body.content.pop();d.tabs[0].body.content.push({startIndex:10,endIndex:11,paragraph:{elements:[]}});},
  ]){
    const doc=makeDoc("pocket.current-task",taskParagraphs);
    mutation(doc);assert.equal(project(args(doc,"pocket.current-task")).ok,false);
  }
});

// Injected synthetic snapshots only. No Google, Pocket, provider, timers, or network I/O.
function mockedPreflight(){
  const specs=[
    ["pocket.current-state",stateParagraphs],
    ["pocket.current-task",taskParagraphs],
    ["pocket.start-here",startParagraphs],
  ];
  const prepared=Object.fromEntries(specs.map(([name,paras])=>{
    const doc=makeDoc(name,paras);const projected=project(args(doc,name));
    assert.equal(projected.ok,true);
    return [name,{doc,projected}];
  }));
  const names=Object.keys(prepared).sort();
  const policy={releaseId:"release-p349wz",taskId:taskId,taskClass:"INVESTIGATION",
    requiredDocuments:[],requiredEvidence:[]};
  const grant={approved:true,revoked:false,principal:"publisher",
    sourceReaderPrincipal:"google-reader",action:"publish-handover-release",
    releaseId:policy.releaseId,taskId,allowedSources:names.map(name=>{
      const f=prepared[name].projected.fixture;
      return {name,documentId:f.documentId,tabId:f.tabId,
        revisionId:f.revisionId,digest:f.digest};
    }),expiresAtMs:2000,maxAttempts:1};
  const store=Object.fromEntries(names.map(name=>[name,{name,revision:4,content:"historical"}]));
  let manifest={name:"pocket.handover-release",revision:3,content:"old published"};
  const calls={source:[],stage:0,read:0,manifest:0,publish:0};
  const f={
    calls,prepared,policy,grant,store,
    readTrustedPolicy:async()=>structuredClone(policy),
    readAuthenticatedPrincipal:async()=>"publisher",
    readTrustedClock:async()=>100,
    readAuthorityMode:async()=>({mode:"GOOGLE_ONLY",epoch:"GOOGLE_ONLY"}),
    readPublisherGrant:async()=>structuredClone(grant),
    readGoogleSource:async name=>{
      calls.source.push(name);
      return structuredClone(prepared[name].projected.fixture);
    },
    readEvidenceReceipt:async()=>{throw Error("no evidence required");},
    readPocketRecord:async name=>{calls.read++;return structuredClone(store[name]);},
    casStagePocketRecord:async({name,expectedRevision,content})=>{
      calls.stage++;
      if(store[name].revision!==expectedRevision)return null;
      store[name]={name,revision:expectedRevision+1,content};
      return structuredClone(store[name]);
    },
    readManifest:async()=>{calls.manifest++;return structuredClone(manifest);},
    casPublishManifest:async({name,expectedRevision,content})=>{
      calls.publish++;
      if(expectedRevision!==manifest.revision)return null;
      manifest={name,revision:expectedRevision+1,content};
      return structuredClone(manifest);
    }
  };
  return f;
}
test("full synthetic structured snapshots feed UNCHANGED P349wx publisher; only historical NON-EXECUTABLE release", {timeout:5000},async()=>{
  const f=mockedPreflight();
  const result=await preflightPublishHandover(f);
  assert.deepEqual(result,{published:true,executable:false,mode:"GOOGLE_ONLY",
    releaseId:"release-p349wz",taskId,manifestRevision:4,stagedDocuments:3});
  assert.equal(f.calls.stage,3);
  assert.equal(f.calls.read,6);
  assert.equal(f.calls.source.length,6);
  assert.equal(f.calls.manifest,2);
  assert.equal(f.calls.publish,1);
});
test("full synthetic second source recheck rejects same-revision text change and changed revision", {timeout:5000},async()=>{
  for(const mutate of [
    doc=>{const e=doc.tabs[0].body.content[1].paragraph.elements[0]; e.textRun.content="X"+e.textRun.content; e.endIndex++;},
    doc=>{doc.revisionId="new-current-revision";},
  ]){
    const f=mockedPreflight(),original=f.readGoogleSource;
    let n=0;
    f.readGoogleSource=async name=>{
      const result=await original(name);
      if(name==="pocket.current-task"&&++n===2){
        const d=structuredClone(f.prepared[name].doc);
        mutate(d);
        const p=project({...args(d,name),expectedRevisionId:d.revisionId});
        return p.ok?p.fixture:null;
      }
      return result;
    };
    const result=await preflightPublishHandover(f);
    assert.equal(result.published,false);
    assert.equal(result.executable,false);
    assert.equal(f.calls.publish,0);
  }
});
