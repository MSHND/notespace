"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{createRequire}=require("node:module");
const ROOT=path.resolve(__dirname,"../../.."),P360=path.join(ROOT,"tests/p360-main-pe-owner-save-admission.test.js");
const {createYjs,createAutomerge,bridge}=require("../adapter.cjs");
// Reuse the *actual* accepted Pocket P360 production harness. No product mocks
// substitute for canonical PE, P160 operation capture or P172 Save admission.
function p360Helpers(){
 let source=fs.readFileSync(P360,"utf8");
 const marker='const test = require("node:test");';
 assert.ok(source.includes(marker),"P360 harness drifted");
 source=source.replace(marker,'const test = () => {};');
 source+="\nmodule.exports={loadP180Helpers,installFixture,state,loadRealPeSurface,installPeSourceIdentity,materialiseAccepted};\n";
 const obj={exports:{}};
 new Function("require","module","exports","__filename","__dirname",source)(createRequire(P360),obj,obj.exports,P360,path.dirname(P360));
 return obj.exports;
}
async function pocket(){
 const api=p360Helpers(),p180=api.loadP180Helpers(),p176=p180.loadP176Harness(),h=p176.productionHarness();
 api.installFixture(h.context);await p176.activateFresh(h);
 h.context.__p180State=api.state(h.context);p180.loadRealMainSaveSurface(h.context);
 api.installPeSourceIdentity(h.context);api.loadRealPeSurface(h.context);
 const node=h.context.nodeMap().get("b");
 assert.ok(node);
 const opened=JSON.parse(JSON.stringify(h.context.PocketNodePopoutModel.buildPayload(node)));
 return {api,h,node,opened,state:api.state(h.context)};
}
for(const [label,factory] of [["Yjs",createYjs],["Automerge",createAutomerge]]){
 test(label+" engine text reaches real Pocket canonical PE and explicit semantic Save",{timeout:60000},async()=>{
  const {api,h,node,opened,state}=await pocket(),e=await factory({nodeId:opened.id,text:opened.text});
  assert.equal(typeof e.save,"undefined");
  assert.equal(typeof e.sync,"undefined");
  assert.equal(typeof e.grant,"undefined");
  const beforeCAS=h.routeCount("/pockets/head/compare-and-set");
  const beforeOps=state.ops.length,anchor=e.pin(9);
  assert.deepEqual(e.edit({start:0,end:6,expected:"Before",replacement:"After"}),{ok:true});
  assert.equal(e.resolve(anchor),8);
  const proposal=e.proposal();
  assert.equal(Object.isFrozen(proposal),true);
  assert.equal(proposal.nextText,"After\n  child");
  assert.equal(node.details,"Before\n  child","engine cannot modify Pocket state");
  assert.equal(state.ops.length,beforeOps,"engine cannot record Pocket ops");
  assert.equal(h.routeCount("/pockets/head/compare-and-set"),beforeCAS,"engine cannot publish");
  const prepared=bridge(opened,proposal);assert.equal(prepared.ok,true);
  const applied=h.context.PocketNodePopoutEditor.apply(prepared.payload,{returnDetails:true});
  assert.equal(applied.ok,true,JSON.stringify(applied));
  assert.equal(applied.id,"b");assert.equal(node.details,"After\n  child");
  assert.equal(state.ops.length,beforeOps+1);
  const op=state.ops.at(-1);
  const operations=JSON.parse(JSON.stringify(h.context.freezePocketStarlingOwnerWorkingSetThrough(op.seq).operations));
  assert.deepEqual(operations.map(o=>o.type),["payload"]);
  assert.equal(operations[0].input.nodeId,"b");
  assert.equal(operations[0].input.payload.editor.text,"After\n  child");
  assert.equal(h.context.nodeMap().get("b-child").parentId,"b");
  assert.equal(h.context.nodeMap().get("unrelated").details,"unrelated content");
  assert.equal(h.routeCount("/pockets/head/compare-and-set"),beforeCAS,"PE apply is not accepted remote Save");
  const saved=await h.context.exportTree({returnDetails:true,downloadFallback:false});
  assert.equal(saved.ok,true,JSON.stringify(saved));
  assert.equal(state.ops.length,0,"only accepted Save retires covered ops");
  const actual=await api.materialiseAccepted(h.context);
  assert.equal(actual.nodes.find(n=>n.id==="b").editor.text,"After\n  child");
  assert.equal(actual.nodes.find(n=>n.id==="unrelated").details,"unrelated content");
  assert.equal(actual.nodes.find(n=>n.id==="b-child").parentId,"b");
  assert.ok(h.routeCount("/pockets/head/compare-and-set")>beforeCAS);
  e.close();
 });
 test(label+" stale competing edit rejected by real Pocket revision owner",{timeout:60000},async()=>{
  const {h,node,opened,state}=await pocket();
  const a=await factory({nodeId:opened.id,text:opened.text}),b=await factory({nodeId:opened.id,text:opened.text});
  assert.equal(a.edit({start:0,end:6,expected:"Before",replacement:"First"}).ok,true);
  assert.equal(b.edit({start:0,end:6,expected:"Before",replacement:"Other"}).ok,true);
  assert.equal(bridge(opened,{...b.proposal(),nodeId:"unrelated"}).reason,"wrong-target");
  const first=bridge(opened,a.proposal());assert.equal(first.ok,true);
  const result=h.context.PocketNodePopoutEditor.apply(first.payload,{returnDetails:true});
  assert.equal(result.ok,true,JSON.stringify(result));
  const journal=state.ops.length;
  const later=bridge(opened,b.proposal());assert.equal(later.ok,true);
  const rejected=h.context.PocketNodePopoutEditor.apply(later.payload,{returnDetails:true});
  assert.equal(rejected.reason,"node-revision-changed");
  assert.equal(rejected.ok,false);
  assert.equal(node.details,"First\n  child");assert.equal(state.ops.length,journal);
  assert.equal(bridge({...opened,text:"different base"},b.proposal()).reason,"stale-opening");
  a.close();b.close();
 });
 test(label+" cannot bypass real Pocket source and editor-envelope safeguards",{timeout:60000},async()=>{
  const {h,node,opened,state}=await pocket();
  const e=await factory({nodeId:opened.id,text:opened.text});
  assert.equal(e.edit({start:0,end:6,expected:"Before",replacement:"After"}).ok,true);
  const p=bridge(opened,e.proposal());assert.equal(p.ok,true);
  const wrongFile=h.context.PocketNodePopoutEditor.apply({...p.payload,sourceFileName:"wrong-file.json"},{returnDetails:true});
  assert.equal(wrongFile.ok,false);assert.equal(wrongFile.reason,"file-session-changed");
  const huge="x".repeat(h.context.PocketNodeContent.LIMITS.canonicalBytes+1);
  const tooLong=h.context.PocketNodePopoutEditor.apply({...p.payload,text:huge,body:huge},{returnDetails:true});
  assert.equal(tooLong.ok,false);assert.equal(tooLong.reason,"editor-text-too-large");
  assert.equal(node.details,"Before\n  child");assert.equal(state.ops.length,0);
  e.close();
 });
}
test("both adapters reject stale selected bytes before proposing changes",async()=>{
 for(const factory of [createYjs,createAutomerge]){
  const e=await factory({nodeId:"b",text:"Before\n  child"});
  const initial=e.proposal().nextText;
  assert.equal(e.edit({start:0,end:6,expected:"Wrong!",replacement:"After"}).reason,"invalid-or-stale-range");
  assert.equal(e.proposal().nextText,initial);
  e.close();
 }
});
