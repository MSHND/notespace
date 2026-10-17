import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

const startingText = 'Review supplier before processing payment.';
const initial = () => {
  const d = new Y.Doc({ guid: 'pocket-test' });
  d.getText('body').insert(0, startingText);
  return d;
};
const replicas = () => {
  const original = initial();
  const a = new Y.Doc({ guid: 'pocket-test' });
  const b = new Y.Doc({ guid: 'pocket-test' });
  const baseline = Y.encodeStateAsUpdate(original);
  Y.applyUpdate(a, baseline);
  Y.applyUpdate(b, baseline);
  return [a,b];
};
const sync = (a,b) => {
  const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  Y.applyUpdate(a, toA);
  Y.applyUpdate(b, toB);
};

test('Y01: real shared text supports local insertion', () => {
  const d = initial();
  d.getText('body').insert(7, 'Blackwoods ');
  assert.equal(d.getText('body').toString(), 'Review Blackwoods supplier before processing payment.');
});
test('Y02: concurrent disjoint edits converge in both replicas', () => {
  const [a,b] = replicas();
  a.getText('body').insert(7, 'Blackwoods ');
  b.getText('body').delete(startingText.indexOf('payment'), 'payment'.length);
  b.getText('body').insert(startingText.indexOf('payment'), 'invoice');
  sync(a,b);
  assert.equal(a.getText('body').toString(), b.getText('body').toString());
  assert.equal(a.getText('body').toString(), 'Review Blackwoods supplier before processing invoice.');
});
test('Y03: order of state-update delivery does not change final text', () => {
  const [a,b] = replicas();
  a.getText('body').insert(0, 'Please ');
  b.getText('body').insert(startingText.length, ' Urgent.');
  const uA=Y.encodeStateAsUpdate(a), uB=Y.encodeStateAsUpdate(b);
  const x=new Y.Doc(), y=new Y.Doc();
  Y.applyUpdate(x,uA); Y.applyUpdate(x,uB);
  Y.applyUpdate(y,uB); Y.applyUpdate(y,uA);
  assert.equal(x.getText('body').toString(), y.getText('body').toString());
});
test('Y04: relative position follows surrounding inserts', () => {
  const d=initial(), t=d.getText('body');
  const anchor=Y.createRelativePositionFromTypeIndex(t,7);
  t.insert(0,'Please ');
  const absolute=Y.createAbsolutePositionFromRelativePosition(anchor,d);
  assert.equal(absolute.index,14);
});
test('Y05: relative position survives encode/decode', () => {
  const d=initial(), t=d.getText('body');
  const rel=Y.createRelativePositionFromTypeIndex(t,7);
  const stored=Y.encodeRelativePosition(rel);
  const restored=Y.decodeRelativePosition(stored);
  assert.equal(Y.createAbsolutePositionFromRelativePosition(restored,d).index,7);
});
test('Y06: scoped undo reverts a local text edit', () => {
  const d=initial(), t=d.getText('body');
  const undo=new Y.UndoManager(t, {captureTimeout:0});
  t.insert(7,'Blackwoods ');
  assert.equal(t.toString().includes('Blackwoods'),true);
  undo.undo();
  assert.equal(t.toString(),startingText);
  undo.destroy();
});
test('Y07: target identity is stored as external semantic metadata, not inferred from a string', () => {
  const d=initial(), links=d.getMap('references');
  links.set('ref-1', {targetNodeId:'creditor:blackwoods', anchorId:'passage-1', label:'Blackwoods'});
  const saved=Y.encodeStateAsUpdate(d); const opened=new Y.Doc();
  Y.applyUpdate(opened,saved);
  assert.equal(opened.getMap('references').get('ref-1').targetNodeId,'creditor:blackwoods');
});
test('Y08: same-position concurrent insertion converges, ordering is not a Pocket intention policy', () => {
  const [a,b]=replicas();
  a.getText('body').insert(7,'A'); b.getText('body').insert(7,'B');
  sync(a,b);
  assert.equal(a.getText('body').toString(),b.getText('body').toString());
  assert.ok(['AB','BA'].some(seq=>a.getText('body').toString().includes('Review '+seq)));
});
