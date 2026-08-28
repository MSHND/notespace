/* Dormant P107a1 reference sequence. Capacity is a proof parameter only. */
(function (global) {
  "use strict";
  const fail = (reason) => ({ ok: false, reason });
  const count = (page) => page.count;
  const leaf = (items, capacity) => Object.freeze({ kind: "leaf", items: Object.freeze(items), count: items.length, capacity });
  const branch = (children, capacity) => Object.freeze({ kind: "branch", children: Object.freeze(children), count: children.reduce((n, child) => n + count(child), 0), capacity });
  function root(pages, capacity) { return pages.length === 1 ? pages[0] : branch(pages, capacity); }
  function build(items, options = {}) { if (!Array.isArray(items)) return fail("invalid-items"); const cap = Number.isInteger(options.capacity) && options.capacity >= 2 ? options.capacity : 4; let level=[]; for(let i=0;i<items.length;i+=cap)level.push(leaf(items.slice(i,i+cap),cap)); if(!level.length)return {ok:true,root:leaf([],cap),capacity:cap}; while(level.length>1){const next=[];for(let i=0;i<level.length;i+=cap)next.push(branch(level.slice(i,i+cap),cap));level=next;} return {ok:true,root:level[0],capacity:cap}; }
  function materialise(page, out=[]) { if(page.kind==="leaf")out.push(...page.items);else page.children.forEach(child=>materialise(child,out));return out; }
  function insertPage(page,index,item,cap) { if(page.kind==="leaf"){const items=page.items.slice();items.splice(index,0,item);if(items.length<=cap)return [leaf(items,cap)];const mid=Math.ceil(items.length/2);return [leaf(items.slice(0,mid),cap),leaf(items.slice(mid),cap)];}let child=0,at=index;while(child<page.children.length-1&&at>count(page.children[child])){at-=count(page.children[child]);child++;}const replacement=insertPage(page.children[child],at,item,cap),children=page.children.slice();children.splice(child,1,...replacement);if(children.length<=cap)return [branch(children,cap)];const mid=Math.ceil(children.length/2);return [branch(children.slice(0,mid),cap),branch(children.slice(mid),cap)]; }
  function insertAt(page,index,item) { const cap=page&&page.capacity;if(!Number.isInteger(cap)||!page||index<0||index>count(page))return fail("invalid-index");return {ok:true,root:root(insertPage(page,index,item,cap),cap),capacity:cap}; }
  function removePage(page,index){const cap=page.capacity;if(page.kind==="leaf"){const items=page.items.slice();items.splice(index,1);return items.length?[leaf(items,cap)]:[];}let child=0,at=index;while(child<page.children.length-1&&at>=count(page.children[child])){at-=count(page.children[child]);child++;}const replacement=removePage(page.children[child],at),children=page.children.slice();children.splice(child,1,...replacement);return children.length?[branch(children,cap)]:[];}
  function removeAt(page,index){const cap=page&&page.capacity;if(!Number.isInteger(cap)||!page||index<0||index>=count(page))return fail("invalid-index");let pages=removePage(page,index);let next=pages.length?root(pages,cap):leaf([],cap);while(next.kind==="branch"&&next.children.length===1)next=next.children[0];return {ok:true,root:next,capacity:cap};}
  function pages(page,out=[]){out.push(page);if(page.kind==="branch")page.children.forEach(child=>pages(child,out));return out;}
  function height(page){return page.kind==="leaf"?0:1+height(page.children[0]);}
  global.PocketStarlingSequenceShadow=Object.freeze({build,materialise,insertAt,removeAt,pages,height});
})(typeof window!=="undefined"?window:globalThis);
