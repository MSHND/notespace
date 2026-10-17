"use strict";
// Research only. Neither text engine can Save, Sync, grant authority, or pick a Pocket target.
const Y = require("yjs");
function open(input) {
  if (!input || typeof input.nodeId!=="string" || !input.nodeId || typeof input.text!=="string") throw Error("owner-open-required");
  return Object.freeze({nodeId:input.nodeId,text:input.text});
}
function editValid(text,e) {
  return e&&Number.isInteger(e.start)&&Number.isInteger(e.end)&&e.start>=0&&e.end>=e.start&&e.end<=text.length
    &&typeof e.expected==="string"&&text.slice(e.start,e.end)===e.expected&&typeof e.replacement==="string";
}
function proposal(engine,base,text){return Object.freeze({schema:"pocket.research.text-proposal.v1",engine,nodeId:base.nodeId,baseText:base.text,nextText:text});}
function createYjs(input) {
  const base=open(input),doc=new Y.Doc(),t=doc.getText("body");t.insert(0,base.text);
  return Object.freeze({
    edit(e){if(!editValid(t.toString(),e))return {ok:false,reason:"invalid-or-stale-range"};doc.transact(()=>{t.delete(e.start,e.end-e.start);t.insert(e.start,e.replacement)});return {ok:true};},
    pin(i){return Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(t,i));},
    resolve(value){const v=Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(value),doc);return v?.index??null;},
    proposal(){return proposal("yjs",base,t.toString());},
    close(){doc.destroy();}
  });
}
async function createAutomerge(input){
  const base=open(input),A=await import("@automerge/automerge");let doc=A.from({body:base.text});
  return Object.freeze({
    edit(e){if(!editValid(doc.body,e))return {ok:false,reason:"invalid-or-stale-range"};doc=A.change(doc,d=>A.splice(d,["body"],e.start,e.end-e.start,e.replacement));return {ok:true};},
    pin(i){return A.getCursor(doc,["body"],i);},
    resolve(value){return A.getCursorPosition(doc,["body"],value);},
    proposal(){return proposal("automerge",base,doc.body);},
    close(){doc=null;}
  });
}
// The adapter boundary only prepares a candidate. Pocket's real PE owner performs
// revision, source identity, content envelope, dirty journal and Save checks.
function bridge(opened,p){
  if(!p||p.schema!=="pocket.research.text-proposal.v1"||!["yjs","automerge"].includes(p.engine)
    ||typeof p.baseText!=="string"||typeof p.nextText!=="string")return {ok:false,reason:"invalid-proposal"};
  if(p.nodeId!==opened?.id)return {ok:false,reason:"wrong-target"};
  if(p.baseText!==opened?.text)return {ok:false,reason:"stale-opening"};
  return Object.freeze({ok:true,payload:Object.freeze({...opened,text:p.nextText,body:p.nextText})});
}
module.exports={createYjs,createAutomerge,bridge};
