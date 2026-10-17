import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import * as A from '@automerge/automerge';
import {TEXT,baseState,replace,reconcileIntents,guardedUndoPromotion} from '../policy.mjs';

const ySeed=()=>{const d=new Y.Doc();d.getText('body').insert(0,TEXT);d.getMap('ideas').set('root',{id:'root'});return d;};
const yFork=()=>{
  const seed=ySeed(),a=new Y.Doc(),b=new Y.Doc(),update=Y.encodeStateAsUpdate(seed);
  Y.applyUpdate(a,update);Y.applyUpdate(b,update);return [a,b];
};
const yEdit=(d,word,value)=>{
  const t=d.getText('body'),index=t.toString().indexOf(word);
  assert.ok(index>=0,'word present');
  d.transact(()=>{t.delete(index,word.length);t.insert(index,value);});
};
const ySync=(a,b)=>{
  const uA=Y.encodeStateAsUpdate(a,Y.encodeStateVector(b)),uB=Y.encodeStateAsUpdate(b,Y.encodeStateVector(a));
  Y.applyUpdate(a,uB);Y.applyUpdate(b,uA);
};
const aSeed=()=>A.from({body:TEXT,ideas:{root:{id:'root'}},references:{}});
const aEdit=(d,word,value)=>A.change(d,draft=>{
  const ix=draft.body.indexOf(word);
  assert.ok(ix>=0,'word present');
  A.splice(draft,['body'],ix,word.length,value);
});

test('P01 Pocket reference policy admits independent text intentions atomically',()=>{
  const ops=[replace('a','alice',7,'supplier','Blackwoods'),replace('b','bob',33,'payment','invoice')];
  const result=reconcileIntents(baseState(),ops);
  assert.equal(result.status,'ready');
  assert.equal(result.state.nodes['note-1'].text,'Review Blackwoods before processing invoice.');
  assert.deepEqual(result.admitted,['a','b']);
});
test('P02 Pocket reference policy refuses same-word conflicting changes without partially applying batch',()=>{
  const initial=baseState();
  const ops=[replace('a','alice',7,'supplier','Blackwoods'),replace('b','bob',7,'supplier','creditor'),
  {type:'reference',id:'c',actor:'alice',revision:'r1',nodeId:'note-1',referenceId:'ref-1',targetId:'creditor:blackwoods'}];
  const result=reconcileIntents(initial,ops);
  assert.equal(result.status,'needs-decision');
  assert.equal(result.reason,'overlapping-human-intents');
  assert.equal(result.pending.length,3);
  assert.equal(JSON.stringify(initial),JSON.stringify(result.state));
});
test('P03 Pocket reference policy refuses duplicate semantic operation ID',()=>{
  const op=replace('a','alice',7,'supplier','Blackwoods');
  assert.equal(reconcileIntents(baseState(),[op,op]).reason,'duplicate-or-missing-operation');
});
test('P04 Pocket reference policy refuses stale selection rather than guessing target',()=>{
  assert.equal(reconcileIntents(baseState(),[replace('a','alice',7,'not here','X')]).reason,'stale-or-invalid-target');
});
test('P05 Pocket references and promoted ideas have separately addressable identities',()=>{
  const ops=[{type:'reference',id:'l',revision:'r1',nodeId:'note-1',referenceId:'ref-44',targetId:'creditor:blackwoods'},
  {type:'promote',id:'p',revision:'r1',nodeId:'note-1',ideaId:'idea-23',parentId:'note-1',text:'Check approval'}];
  const result=reconcileIntents(baseState(),ops);
  assert.equal(result.status,'ready');assert.equal(result.state.references['ref-44'].targetId,'creditor:blackwoods');
  assert.equal(result.state.ideas['idea-23'].parentId,'note-1');
});
test('P06 Pocket reference policy blocks Undo of promoted idea after someone else edits it',()=>{
  const s=baseState();s.ideas['idea-23']={id:'idea-23',parentId:'note-1',text:'updated',lastEditedRevision:'r3'};
  assert.equal(guardedUndoPromotion(s,'idea-23','r2').reason,'dependent-work-would-be-destroyed');
  assert.equal(s.ideas['idea-23'].text,'updated');
});
test('P07 Pocket reference policy blocks Undo of an idea with descendants',()=>{
  const s=baseState();s.ideas.parent={id:'parent',parentId:'note-1'};s.ideas.child={id:'child',parentId:'parent'};
  assert.equal(guardedUndoPromotion(s,'parent','r1').reason,'descendants-would-be-destroyed');
});
test('Y01 Yjs two offline editors reconcile disjoint word replacements',()=>{
  const [a,b]=yFork();yEdit(a,'supplier','Blackwoods');yEdit(b,'payment','invoice');ySync(a,b);
  assert.equal(a.getText('body').toString(),b.getText('body').toString());
  assert.equal(a.getText('body').toString(),'Review Blackwoods before processing invoice.');
});
test('A01 Automerge two offline editors reconcile disjoint word replacements',()=>{
  const seed=aSeed(),a=aEdit(seed,'supplier','Blackwoods'),b=aEdit(A.clone(seed),'payment','invoice');
  const merged=A.merge(a,b),reverse=A.merge(b,a);
  assert.equal(merged.body,reverse.body);assert.equal(merged.body,'Review Blackwoods before processing invoice.');
});
test('Y02 Yjs converges overlapping human intentions, without classifying their meaning',()=>{
  const [a,b]=yFork();yEdit(a,'supplier','Blackwoods');yEdit(b,'supplier','creditor');ySync(a,b);
  assert.equal(a.getText('body').toString(),b.getText('body').toString());
  console.log('YJS_OVERLAP_OBSERVED='+JSON.stringify(a.getText('body').toString()));
});
test('A02 Automerge converges overlapping human intentions, without classifying their meaning',()=>{
  const seed=aSeed(),a=aEdit(seed,'supplier','Blackwoods'),b=aEdit(A.clone(seed),'supplier','creditor');
  assert.equal(A.merge(a,b).body,A.merge(b,a).body);
  console.log('AUTOMERGE_OVERLAP_OBSERVED='+JSON.stringify(A.merge(a,b).body));
});
test('Y03 Yjs joins promoted idea identity and @ target without duplicating source',()=>{
  const [a,b]=yFork();
  a.getMap('references').set('ref-44',{sourceNodeId:'note-1',targetNodeId:'creditor:blackwoods',selectionId:'sel-1'});
  yEdit(a,'supplier','Blackwoods');
  b.getMap('ideas').set('idea-23',{id:'idea-23',parentId:'note-1',text:'Check approval'});
  yEdit(b,'payment','invoice');
  ySync(a,b);
  for(const d of [a,b]){
    assert.equal(d.getMap('references').get('ref-44').targetNodeId,'creditor:blackwoods');
    assert.equal(d.getMap('ideas').get('idea-23').parentId,'note-1');
    assert.equal(d.getText('body').toString(),'Review Blackwoods before processing invoice.');
  }
});
test('A03 Automerge joins promoted idea identity and @ target without duplicating source',()=>{
  const seed=aSeed();
  const a=A.change(seed,d=>{
    A.splice(d,['body'],7,8,'Blackwoods');
    d.references['ref-44']={sourceNodeId:'note-1',targetNodeId:'creditor:blackwoods',selectionId:'sel-1'};
  });
  const b=A.change(A.clone(seed),d=>{
    A.splice(d,['body'],33,7,'invoice');
    d.ideas['idea-23']={id:'idea-23',parentId:'note-1',text:'Check approval'};
  });
  const merged=A.merge(a,b);
  assert.equal(merged.body,'Review Blackwoods before processing invoice.');
  assert.equal(merged.references['ref-44'].targetNodeId,'creditor:blackwoods');
  assert.equal(merged.ideas['idea-23'].parentId,'note-1');
});
test('Y04 Yjs persistent selection is stable after prefix insertion and reopen',()=>{
  const d=ySeed(),anchor=Y.createRelativePositionFromTypeIndex(d.getText('body'),7);
  d.getText('body').insert(0,'Please ');
  const reopened=new Y.Doc();Y.applyUpdate(reopened,Y.encodeStateAsUpdate(d));
  const rebuilt=Y.decodeRelativePosition(Y.encodeRelativePosition(anchor));
  assert.equal(Y.createAbsolutePositionFromRelativePosition(rebuilt,reopened).index,14);
});
test('A04 Automerge persistent selection is stable after prefix insertion and reopen',()=>{
  const d=aSeed(),anchor=A.getCursor(d,['body'],7);
  const changed=A.change(d,draft=>A.splice(draft,['body'],0,0,'Please '));
  const reopened=A.load(A.save(changed));
  assert.equal(A.getCursorPosition(reopened,['body'],anchor),14);
});
test('Y05 Yjs local scoped Undo leaves a concurrent remote change intact',()=>{
  const [a,b]=yFork(),origin={editor:'A'},manager=new Y.UndoManager(a.getText('body'),{trackedOrigins:new Set([origin]),captureTimeout:0});
  a.transact(()=>{const t=a.getText('body');t.delete(7,8);t.insert(7,'Blackwoods');},origin);
  yEdit(b,'payment','invoice');ySync(a,b);
  assert.equal(a.getText('body').toString(),'Review Blackwoods before processing invoice.');
  manager.undo();
  assert.equal(a.getText('body').toString(),'Review supplier before processing invoice.');
  manager.destroy();
});
test('A05 Automerge inverse semantic edit leaves disjoint remote change intact (NOT native Undo)',()=>{
  const seed=aSeed(),a=aEdit(seed,'supplier','Blackwoods'),b=aEdit(A.clone(seed),'payment','invoice');
  const merged=A.merge(a,b);
  const undone=A.change(merged,d=>A.splice(d,['body'],7,10,'supplier'));
  assert.equal(undone.body,'Review supplier before processing invoice.');
});
test('P08 Same-position automatic ordering remains a separate Pocket product decision',()=>{
  const ops=[replace('a','alice',7,'','A'),replace('b','bob',7,'','B')];
  const result=reconcileIntents(baseState(),ops);
  assert.equal(result.status,'needs-decision');
  assert.equal(result.reason,'overlapping-human-intents');
});
test('Y06 Yjs same-position insertions converge without human choice',()=>{
  const [a,b]=yFork();a.getText('body').insert(7,'A');b.getText('body').insert(7,'B');ySync(a,b);
  assert.equal(a.getText('body').toString(),b.getText('body').toString());
  assert.match(a.getText('body').toString(),/Review (AB|BA)supplier/);
});
test('A06 Automerge same-position insertions converge without human choice',()=>{
  const seed=aSeed();
  const a=A.change(seed,d=>A.splice(d,['body'],7,0,'A'));
  const b=A.change(A.clone(seed),d=>A.splice(d,['body'],7,0,'B'));
  const output=A.merge(a,b).body;
  assert.equal(output,A.merge(b,a).body);
  assert.match(output,/Review (AB|BA)supplier/);
});
test('P09 Read-only/authority remains Pocket policy rather than editable text',()=>{
  const s=baseState(); const grant={subject:'collaborator-x',canEdit:false};
  const label='editable';
  assert.equal(grant.canEdit,false);assert.equal(label,'editable');
  assert.equal(s.nodes['note-1'].text,TEXT);
});
