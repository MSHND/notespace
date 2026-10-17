// RESEARCH REFERENCE MODEL ONLY, not imported from Pocket production.
export const TEXT = 'Review supplier before processing payment.';
export const baseState = () => ({revision:'r1', nodes:{'note-1':{id:'note-1',text:TEXT}}, references:{}, ideas:{}});
export const replace = (id, actor, start, expected, replacement) => ({
  type:'replace',id,actor,nodeId:'note-1',revision:'r1',start,end:start+expected.length,expected,replacement
});
export function reconcileIntents(state, operations) {
  const seen=new Set();
  for(const op of operations) {
    if(!op || !op.id || seen.has(op.id)) return {status:'needs-decision',reason:'duplicate-or-missing-operation',pending:operations,state};
    seen.add(op.id);
    if(op.revision!==state.revision || op.nodeId!=='note-1') return {status:'needs-decision',reason:'unknown-base-or-target',pending:operations,state};
    if(op.type==='replace' && (!Number.isInteger(op.start)||op.start<0||op.end<op.start||state.nodes[op.nodeId].text.slice(op.start,op.end)!==op.expected))
      return {status:'needs-decision',reason:'stale-or-invalid-target',pending:operations,state};
    if(!['replace','reference','promote'].includes(op.type)) return {status:'needs-decision',reason:'unknown-intent',pending:operations,state};
    if(op.type==='reference' && (!op.referenceId || !op.targetId)) return {status:'needs-decision',reason:'invalid-reference',pending:operations,state};
    if(op.type==='promote' && (!op.ideaId || !op.parentId)) return {status:'needs-decision',reason:'invalid-promotion',pending:operations,state};
  }
  const edits=operations.filter(x=>x.type==='replace');
  for(let i=0;i<edits.length;i++) for(let j=i+1;j<edits.length;j++){
    const a=edits[i],b=edits[j];
    // Two insertions at the same point, or edits intersecting, require Pocket intent policy.
    const bothInsert=a.start===a.end&&b.start===b.end&&a.start===b.start;
    const intersects=Math.max(a.start,b.start)<Math.min(a.end,b.end);
    const insertWithin=(a.start===a.end&&a.start>b.start&&a.start<b.end)||(b.start===b.end&&b.start>a.start&&b.start<a.end);
    if(bothInsert||intersects||insertWithin) return {status:'needs-decision',reason:'overlapping-human-intents',conflicts:[a.id,b.id],pending:operations,state};
  }
  const next=structuredClone(state);
  for(const op of [...edits].sort((a,b)=>b.start-a.start)){
    next.nodes[op.nodeId].text=next.nodes[op.nodeId].text.slice(0,op.start)+op.replacement+next.nodes[op.nodeId].text.slice(op.end);
  }
  for(const op of operations) {
    if(op.type==='reference'){
      if(next.references[op.referenceId]) return {status:'needs-decision',reason:'reference-id-collision',pending:operations,state};
      next.references[op.referenceId]={id:op.referenceId,targetId:op.targetId,sourceNodeId:op.nodeId};
    }
    if(op.type==='promote'){
      if(next.ideas[op.ideaId]) return {status:'needs-decision',reason:'idea-id-collision',pending:operations,state};
      next.ideas[op.ideaId]={id:op.ideaId,parentId:op.parentId,text:op.text};
    }
  }
  return {status:'ready',state:next,admitted:operations.map(op=>op.id)};
}
export function guardedUndoPromotion(state,ideaId,observedRevision){
  const idea=state.ideas[ideaId];
  if(!idea) return {status:'needs-decision',reason:'missing-idea'};
  if(idea.lastEditedRevision && idea.lastEditedRevision!==observedRevision)
    return {status:'needs-decision',reason:'dependent-work-would-be-destroyed'};
  if(Object.values(state.ideas).some(x=>x.parentId===ideaId))
    return {status:'needs-decision',reason:'descendants-would-be-destroyed'};
  const next=structuredClone(state);delete next.ideas[ideaId];return {status:'ready',state:next};
}
