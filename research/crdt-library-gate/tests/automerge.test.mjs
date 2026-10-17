import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@automerge/automerge';

const baseText='Review supplier before processing payment.';
const initial=()=>A.from({body:baseText, references:{}, nodes:{'root-1':{kind:'paragraph'}}});
const insert=(d,index,value)=>A.change(d, draft=>A.splice(draft,['body'],index,0,value));

test('A01: real collaborative text supports splice insertion',()=>{
  const d=insert(initial(),7,'Blackwoods ');
  assert.equal(d.body,'Review Blackwoods supplier before processing payment.');
});
test('A02: independently changed clones merge disjoint edits',()=>{
  const original=initial();
  const a=insert(original,7,'Blackwoods ');
  const b=A.change(A.clone(original),d=>{
    const at=baseText.indexOf('payment');
    A.splice(d,['body'],at,7,'invoice');
  });
  const merged=A.merge(a,b);
  assert.equal(merged.body,'Review Blackwoods supplier before processing invoice.');
});
test('A03: merging the same changes in reverse order gives equivalent content',()=>{
  const original=initial();
  const a=insert(original,0,'Please ');
  const b=insert(A.clone(original),baseText.length,' Urgent.');
  assert.equal(A.merge(a,b).body,A.merge(b,a).body);
});
test('A04: cursor remains anchored after a prefix insertion',()=>{
  const d=initial();
  const cursor=A.getCursor(d,['body'],7);
  const newer=insert(d,0,'Please ');
  assert.equal(A.getCursorPosition(newer,['body'],cursor),14);
});
test('A05: cursor string survives document save/load',()=>{
  const d=initial();
  const cursor=A.getCursor(d,['body'],7);
  const loaded=A.load(A.save(d));
  assert.equal(A.getCursorPosition(loaded,['body'],cursor),7);
});
test('A06: semantic reference has independently preserved stable target identity',()=>{
  const d=A.change(initial(),draft=>{
    draft.references['ref-1']={targetNodeId:'creditor:blackwoods',anchorId:'passage-1',label:'Blackwoods'};
  });
  const loaded=A.load(A.save(d));
  assert.equal(loaded.references['ref-1'].targetNodeId,'creditor:blackwoods');
});
test('A07: nested idea identity survives changes and save/load',()=>{
  const d=A.change(initial(),draft=>{
    draft.nodes['idea-23']={kind:'idea',parentId:'root-1',text:'Explanatory note'};
  });
  const loaded=A.load(A.save(d));
  assert.equal(loaded.nodes['idea-23'].parentId,'root-1');
});
test('A08: same-position concurrent insertions converge without assigning product meaning',()=>{
  const original=initial();
  const a=insert(original,7,'A');
  const b=insert(A.clone(original),7,'B');
  const forward=A.merge(a,b).body, reverse=A.merge(b,a).body;
  assert.equal(forward,reverse);
  assert.ok(['AB','BA'].some(s=>forward.includes('Review '+s)));
});
test('A09: rich text mark can be addressed independently of plaintext',()=>{
  const d=A.change(initial(),draft=>{
    A.mark(draft,['body'],{start:7,end:15,expand:'none'},'pocket-reference','creditor:blackwoods');
  });
  const marks=A.marks(d,['body']);
  assert.ok(marks.some(m=>m.name==='pocket-reference'&&m.value==='creditor:blackwoods'));
});
