import * as Y from 'yjs';
import * as A from '@automerge/automerge';
import {performance} from 'node:perf_hooks';
const sizes=[128,1024,2048], measurements=[];
const pad=n=>String(n).padStart(5,'0');
const sample=n=>Object.fromEntries(Array.from({length:n},(_,i)=>['n-'+pad(i),'Thought '+pad(i)+' about work, writing, and ideas.']));
for(const n of sizes){
  const plain=sample(n), key='n-'+pad(42);
  {
    const d=new Y.Doc(),nodes=d.getMap('nodes');
    d.transact(()=>{for(const [id,value] of Object.entries(plain))nodes.set(id,value)});
    const full=Y.encodeStateAsUpdate(d).byteLength,vec=Y.encodeStateVector(d);
    const start=performance.now();nodes.set(key,'Changed only one idea.');const delta=Y.encodeStateAsUpdate(d,vec);
    const editAndDeltaMs=performance.now()-start;
    measurements.push({engine:'Yjs',count:n,fullBytes:full,deltaBytes:delta.byteLength,editAndDeltaMs:+editAndDeltaMs.toFixed(3)});
    d.destroy();
  }
  {
    const original=A.from({nodes:plain});
    const full=A.save(original).byteLength,start=performance.now();
    const updated=A.change(original,d=>{d.nodes[key]='Changed only one idea.'});
    const changes=A.getChanges(original,updated);
    const deltaBytes=changes.reduce((sum,c)=>sum+c.byteLength,0);
    const editAndDeltaMs=performance.now()-start;
    measurements.push({engine:'Automerge',count:n,fullBytes:full,deltaBytes,editAndDeltaMs:+editAndDeltaMs.toFixed(3)});
  }
}
console.log('RESEARCH_METRICS_JSON='+JSON.stringify({platform:process.platform,node:process.version,disclaimer:'Illustrative single-run API workloads only; these are not Pocket benchmarks or a performance winner. Do not compare storage formats as equivalent.',measurements}));
for(const m of measurements){
  if(!Number.isFinite(m.editAndDeltaMs)||m.deltaBytes<=0||m.fullBytes<=0)throw Error('Invalid measurement '+JSON.stringify(m));
}
