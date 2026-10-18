"use strict";
// PROOF-ONLY: ephemeral GitHub Actions PostgreSQL, never Render.
const test=require("node:test"), assert=require("node:assert/strict");
const fs=require("node:fs"), path=require("node:path");
const {createHash}=require("node:crypto"), {Client}=require("pg");
const hash=s=>createHash("sha256").update(s,"utf8").digest("hex");
const ddl=fs.readFileSync(path.resolve(__dirname,
  "../sync-service/migrations/005-pocket-handover-release-safety.proposed.sql"),"utf8");

test("P349 disposable PostgreSQL: immutable history, CAS, rollback, reconstruction",async()=>{
  const c=new Client({host:"127.0.0.1",port:5432,user:"postgres",
    password:"disposable_only_password",database:"postgres"});
  await c.connect();
  const Q=(sql,params=[])=>c.query(sql,params);
  const add=(releaseId,name,content,digest=hash(content))=>Q(
    "INSERT INTO public.pocket_handover_release_entries "+
    "(owner_id,resource_id,release_id,name,kind,content,sha256,revision) "+
    "VALUES ('alice','probe',$1,$2,'document',$3,$4,1) RETURNING *",
    [releaseId,name,content,digest]);
  try {
    await Q(ddl);
    const content="Pocket disposable DB probe — Café / 你好 / 🌿";
    const a=await add("r1","pocket.start-here",content);
    assert.equal(a.rows[0].sha256,hash(content));
    await assert.rejects(()=>add("r1","pocket.start-here",content),e=>e.code==="23505");
    await assert.rejects(()=>Q("UPDATE public.pocket_handover_release_entries "+
      "SET content='tamper' WHERE owner_id='alice'"),e=>/immutable/.test(e.message));
    await assert.rejects(()=>Q("UPDATE public.pocket_handover_release_entries "+
      "SET sha256=$1 WHERE owner_id='alice'",["a".repeat(64)]),
      e=>/immutable/.test(e.message));
    await assert.rejects(()=>Q("DELETE FROM public.pocket_handover_release_entries "+
      "WHERE owner_id='alice'"),e=>/immutable/.test(e.message));
    const intact=(await Q("SELECT content,sha256,revision FROM "+
      "public.pocket_handover_release_entries WHERE release_id='r1'")).rows[0];
    assert.equal(intact.content,content);
    assert.equal(intact.sha256,hash(content));
    assert.equal(Number(intact.revision),1);

    await Q("CREATE ROLE p349_disposable_reader NOLOGIN");
    await Q("SET ROLE p349_disposable_reader");
    try {
      await assert.rejects(()=>Q("SELECT content FROM public.pocket_handover_release_entries"),
        e=>e.code==="42501");
      await assert.rejects(()=>Q("DELETE FROM public.pocket_handover_release_entries"),
        e=>e.code==="42501");
    } finally { await Q("RESET ROLE"); }

    await add("r2","pocket.start-here","next version");
    await Q("INSERT INTO public.pocket_handover_release_pointers "+
      "(owner_id,resource_id,release_id,content,revision,updated_at) "+
      "VALUES ('alice','probe','r1','candidate only',1,clock_timestamp())");
    const cas=(expected,releaseId)=>Q(
      "UPDATE public.pocket_handover_release_pointers SET release_id=$1,"+
      "revision=revision+1,updated_at=clock_timestamp() "+
      "WHERE owner_id='alice' AND resource_id='probe' AND revision=$2 "+
      "RETURNING revision,release_id",[releaseId,expected]);
    const winner=await cas(1,"r2"),stale=await cas(1,"r1");
    assert.equal(winner.rowCount,1);
    assert.equal(Number(winner.rows[0].revision),2);
    assert.equal(stale.rowCount,0);

    await Q("BEGIN");
    await add("r3","pocket.start-here","interrupted version");
    await Q("ROLLBACK");
    assert.equal((await Q("SELECT count(*)::int AS n FROM "+
      "public.pocket_handover_release_entries WHERE release_id='r3'")).rows[0].n,0);
    assert.equal((await Q("SELECT release_id FROM public.pocket_handover_release_pointers "+
      "WHERE owner_id='alice'")).rows[0].release_id,"r2");

    const original=(await Q("SELECT owner_id,resource_id,release_id,name,kind,"+
      "content,sha256,revision FROM public.pocket_handover_release_entries "+
      "WHERE owner_id='alice' ORDER BY release_id")).rows;
    assert.equal(original.length,2);
    await Q("CREATE TEMP TABLE recovered (LIKE public.pocket_handover_release_entries "+
      "INCLUDING DEFAULTS INCLUDING CONSTRAINTS)");
    for(const row of original){
      assert.equal(hash(row.content),row.sha256);
      await Q("INSERT INTO recovered (owner_id,resource_id,release_id,name,kind,"+
        "content,sha256,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [row.owner_id,row.resource_id,row.release_id,row.name,row.kind,
          row.content,row.sha256,row.revision]);
    }
    const restored=(await Q("SELECT release_id,content,sha256 "+
      "FROM recovered ORDER BY release_id")).rows;
    assert.deepEqual(restored,original.map(x=>({
      release_id:x.release_id,content:x.content,sha256:x.sha256})));

    // Negative proof: format-only DB digest CHECK allows bogus INSERT.
    await add("r4","pocket.start-here","altered bytes","f".repeat(64));
    const bogus=(await Q("SELECT content,sha256 FROM "+
      "public.pocket_handover_release_entries WHERE release_id='r4'")).rows[0];
    assert.notEqual(hash(bogus.content),bogus.sha256);
    console.log("P349_PG_PROOF=PASS; UNPROVEN=database-digest-admission,tenant-RLS,Render");
  } finally { await c.end(); }
});
