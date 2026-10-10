"use strict";
/* P355fj PROOF-ONLY. Never deploy/adopt this proof branch.
 * Fixed catalogue SQL only; no Pocket application imports or dynamic SQL.
 */
const { Client } = require("pg");
const DATABASE = "pocket_postgres";
const MAJOR = 18;
const LIMITS = Object.freeze({statement_timeout:3000,lock_timeout:250,
  idle_in_transaction_session_timeout:60000,transaction_timeout:120000});
const TABLES = Object.freeze(["pocket_sync_records","pocket_sync_schema",
  "pocket_sync_objects","pocket_sync_heads","pocket_project_documents"]);
const STARTUP_OPTIONS = "-c statement_timeout=3000 -c lock_timeout=250" +
  " -c idle_in_transaction_session_timeout=60000 -c transaction_timeout=120000" +
  " -c default_transaction_read_only=on";
// Entire fixed SELECT allowlist; no caller-selected SQL, tables or query names.
const QUERIES = Object.freeze([
  Object.freeze({id:"tables",maxRows:80,
    fields:Object.freeze(["table_name","table_exists","column_name","data_type","is_nullable"]),
    sql:`WITH expected(table_name) AS (
      VALUES ('pocket_sync_records'),('pocket_sync_schema'),
        ('pocket_sync_objects'),('pocket_sync_heads'),('pocket_project_documents'))
    SELECT e.table_name,(r.oid IS NOT NULL) AS table_exists,
      col.column_name,col.data_type,col.is_nullable FROM expected e
    LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='public'
    LEFT JOIN pg_catalog.pg_class r ON r.relnamespace=n.oid
      AND r.relname=e.table_name AND r.relkind IN ('r','p')
    LEFT JOIN information_schema.columns col ON col.table_schema='public'
      AND col.table_name=e.table_name
    ORDER BY e.table_name,col.ordinal_position LIMIT 81`}),
  Object.freeze({id:"constraints",maxRows:100,
    fields:Object.freeze(["table_name","constraint_name","constraint_type","validated","definition"]),
    sql:`SELECT r.relname AS table_name,c.conname AS constraint_name,
      c.contype AS constraint_type,c.convalidated AS validated,
      pg_catalog.pg_get_constraintdef(c.oid) AS definition
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class r ON r.oid=c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname='public' AND r.relname IN (
      'pocket_sync_records','pocket_sync_schema','pocket_sync_objects',
      'pocket_sync_heads','pocket_project_documents')
    ORDER BY r.relname,c.conname LIMIT 101`}),
  Object.freeze({id:"schemaMarkers",maxRows:20,
    fields:Object.freeze(["schema_name","schema_version"]),
    sql:`SELECT schema_name,schema_version FROM public.pocket_sync_schema
      ORDER BY schema_name LIMIT 21`}),
  Object.freeze({id:"tableEstimates",maxRows:10,
    fields:Object.freeze(["table_name","estimated_rows","table_bytes","total_bytes"]),
    sql:`SELECT c.relname AS table_name,c.reltuples::bigint AS estimated_rows,
      pg_catalog.pg_relation_size(c.oid) AS table_bytes,
      pg_catalog.pg_total_relation_size(c.oid) AS total_bytes
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND c.relname IN ('pocket_sync_records','pocket_sync_schema',
        'pocket_sync_objects','pocket_sync_heads','pocket_project_documents')
    ORDER BY c.relname LIMIT 11`}),
  Object.freeze({id:"aggregateLocks",maxRows:50,
    fields:Object.freeze(["table_name","mode","granted","lock_count"]),
    sql:`SELECT c.relname AS table_name,l.mode,l.granted,COUNT(*) AS lock_count
    FROM pg_catalog.pg_locks l
    JOIN pg_catalog.pg_class c ON c.oid=l.relation
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN
      ('pocket_sync_records','pocket_sync_schema')
    GROUP BY c.relname,l.mode,l.granted
    ORDER BY c.relname,l.mode,l.granted LIMIT 51`}),
  Object.freeze({id:"aggregateTransactions",maxRows:50,
    fields:Object.freeze(["state","wait_event_type","connection_count","oldest_transaction_seconds"]),
    sql:`SELECT state,wait_event_type,COUNT(*) AS connection_count,
      MAX(LEAST(3600,GREATEST(0,
        EXTRACT(EPOCH FROM clock_timestamp()-xact_start))))::bigint
        AS oldest_transaction_seconds
    FROM pg_catalog.pg_stat_activity
    WHERE datname=current_database()
    GROUP BY state,wait_event_type
    ORDER BY state NULLS FIRST,wait_event_type NULLS FIRST LIMIT 51`}),
]);
// Only locally minted errors carry trusted codes. External exceptions cannot forge this WeakMap.
const TRUSTED_CODES = new Set([
  "identity-unavailable", "wrong-database", "wrong-postgres-version",
  "not-read-only", "timeout-not-enforced", "unexpected-settings-shape",
  "unexpected-result-shape", "unbounded-result", "unbounded-output",
  "unsupported-arguments", "missing-runtime-configuration",
  "invalid-client", "missing-session-identity", "changed-session",
  "rollback-failed", "close-failed", "inspection-failed",
]);
const ownedErrorCodes=new WeakMap();
function safeError(code) {
  const ownedCode=TRUSTED_CODES.has(code)?code:"inspection-failed";
  const error=new Error("P355fj catalogue inspection failed");
  Object.defineProperty(error,"safeCode",{value:ownedCode,enumerable:false});
  ownedErrorCodes.set(error,ownedCode);
  return error;
}
function ownedFailureCode(error) {
  return ownedErrorCodes.get(error)||"inspection-failed";
}
function milliseconds(value) {
  if(typeof value!=="string") return null;
  const m=/^(\d+)(ms|s|min|h)$/.exec(value.replace(/\s+/g,""));
  if(!m) return null;
  const x=Number(m[1])*({ms:1,s:1000,min:60000,h:3600000}[m[2]]);
  return Number.isSafeInteger(x)?x:null;
}
function assertIdentity(row) {
  if(!row || typeof row!=="object") throw safeError("identity-unavailable");
  if(row.database_name!==DATABASE) throw safeError("wrong-database");
  const version=Number(row.server_version_num);
  if(!Number.isSafeInteger(version)||Math.floor(version/10000)!==MAJOR)
    throw safeError("wrong-postgres-version");
  if(row.read_only!=="on") throw safeError("not-read-only");
  for(const [setting,expected] of Object.entries(LIMITS))
    if(milliseconds(row[setting])!==expected) throw safeError("timeout-not-enforced");
  if(typeof row.default_isolation!=="string"||row.default_isolation.length>64)
    throw safeError("unexpected-settings-shape");
}
function approvedValue(key,val) {
  if(val===null) return null;
  if(["table_exists","validated","granted"].includes(key)) {
    if(typeof val!=="boolean") throw safeError("unexpected-result-shape");
    return val;
  }
  if(key==="schema_version") {
    if(!Number.isSafeInteger(val)) throw safeError("unexpected-result-shape");
    return val;
  }
  if(["estimated_rows","table_bytes","total_bytes","lock_count",
    "connection_count","oldest_transaction_seconds"].includes(key)) {
    const s=typeof val==="number"?String(val):val;
    if(typeof s!=="string"||!/^-?\d{1,18}$/.test(s))
      throw safeError("unexpected-result-shape");
    return s;
  }
  if(typeof val!=="string"||val.length>(key==="definition"?8192:256)||
     /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(val))
    throw safeError("unexpected-result-shape");
  return val;
}
function permittedRows(spec,result) {
  if(!result||!Array.isArray(result.rows)||result.rows.length>spec.maxRows)
    throw safeError("unbounded-result");
  return result.rows.map(row=>{
    if(!row||typeof row!=="object"||Array.isArray(row))
      throw safeError("unexpected-result-shape");
    const actual=Object.keys(row);
    if(actual.length!==spec.fields.length||
      actual.some(k=>!spec.fields.includes(k))) throw safeError("unexpected-result-shape");
    const safe={};
    for(const field of spec.fields) {
      if(!Object.hasOwn(row,field)) throw safeError("unexpected-result-shape");
      safe[field]=approvedValue(field,row[field]);
    }
    if(Object.hasOwn(safe,"table_name")&&!TABLES.includes(safe.table_name))
      throw safeError("unexpected-result-shape");
    return safe;
  });
}
async function runInspector(options={}) {
  if(!options||typeof options!=="object"||Array.isArray(options)||
     Object.keys(options).some(k=>!["makeClient","environment"].includes(k)))
    throw safeError("unsupported-arguments");
  const environment=options.environment??process.env;
  const connectionString=environment?.POCKET_SYNC_DATABASE_URL;
  if(typeof connectionString!=="string"||!connectionString.length)
    throw safeError("missing-runtime-configuration");
  const makeClient=options.makeClient??(config=>new Client(config));
  if(typeof makeClient!=="function") throw safeError("unsupported-arguments");
  let client,connected=false,failure=null,result=null;
  try {
    client=makeClient({connectionString,options:STARTUP_OPTIONS,
      connectionTimeoutMillis:5000,query_timeout:4000,
      application_name:"p355fj-offline-proof-inspector"});
    if(!client||typeof client.connect!=="function"||
       typeof client.query!=="function"||typeof client.end!=="function")
      throw safeError("invalid-client");
    await client.connect();
    connected=true;
    const pid=client.processID;
    if(!Number.isSafeInteger(pid)||pid<=0) throw safeError("missing-session-identity");
    const query=async sql=>{
      if(client.processID!==pid) throw safeError("changed-session");
      const answer=await client.query(sql);
      if(client.processID!==pid) throw safeError("changed-session");
      return answer;
    };
    // PostgreSQL startup options enforce timeouts BEFORE this first SQL.
    await query("BEGIN TRANSACTION READ ONLY");
    await query("SET LOCAL statement_timeout = '3000ms'");
    await query("SET LOCAL lock_timeout = '250ms'");
    await query("SET LOCAL idle_in_transaction_session_timeout = '60000ms'");
    await query("SET LOCAL transaction_timeout = '120000ms'");
    const id=await query("SELECT current_database() AS database_name, "+
      "current_setting('server_version_num') AS server_version_num, "+
      "current_setting('transaction_read_only') AS read_only, "+
      "current_setting('default_transaction_isolation') AS default_isolation, "+
      "current_setting('statement_timeout') AS statement_timeout, "+
      "current_setting('lock_timeout') AS lock_timeout, "+
      "current_setting('idle_in_transaction_session_timeout') AS idle_in_transaction_session_timeout, "+
      "current_setting('transaction_timeout') AS transaction_timeout");
    if(id?.rows?.length!==1) throw safeError("identity-unavailable");
    assertIdentity(id.rows[0]);
    const catalogue={};
    for(const spec of QUERIES)
      catalogue[spec.id]=permittedRows(spec,await query(spec.sql));
    result=Object.freeze({status:"complete",targetMatched:true,
      postgresMajor:MAJOR,readOnlyVerified:true,timeoutsVerified:true,catalogue});
    if(Buffer.byteLength(JSON.stringify(result),"utf8")>65536)
      throw safeError("unbounded-output");
  } catch(error) {
    failure=ownedFailureCode(error);
  } finally {
    if(client) {
      // Never reconnect or retry, including on transaction failure.
      if(connected) {
        try { await client.query("ROLLBACK"); }
        catch(_) { failure=failure||"rollback-failed"; }
      }
      try { await client.end(); }
      catch(_) { failure=failure||"close-failed"; }
    }
  }
  if(failure) throw safeError(failure);
  return result; // Publish only after rollback and connection closure.
}
if(require.main===module) {
  runInspector().then(
    safe=>process.stdout.write(JSON.stringify(safe)+"\n"),
    error=>{
      process.stderr.write("P355fj inspector FAILED ["+
        ownedFailureCode(error)+"]\n");
      process.exitCode=1;
    }
  );
}
module.exports=Object.freeze({runInspector});
