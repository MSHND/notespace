"use strict";

// Research-only replacement for the earlier disposable scoped publication gate.
// The existing Core, format grant and PostgreSQL Head CAS still own acceptance.
const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { createWriterAdmissionHandler, issueWriterGrant } = require("./pocket-writer-format-admission.js");
const { REFERENCE_PREFIX, MAXIMUM_PRESENCE_REFS } = require("../sync-service/pocket-sync-object-head-postgres-store.js");

const SAVE_ROOT = "/pocket-sync/research/x-only-save/v1";
const RECEIPT_SCHEMA = "pocket.research.x-edit-receipt.v1";
const STATUS_SCHEMA = "pocket.research.x-edit-status.v1";
const INSTALL_SQL = `CREATE TABLE public.pocket_lab_x_edit_authority (
  pocket_id text NOT NULL, actor_id text NOT NULL, node_id text NOT NULL, parent_id text NOT NULL,
  epoch integer NOT NULL CHECK (epoch > 0), allowed boolean NOT NULL, dependency_source_id text,
  PRIMARY KEY (pocket_id, actor_id, node_id, parent_id)
);
CREATE TABLE public.pocket_lab_x_staged (
  pocket_id text NOT NULL, session_id text NOT NULL, storage_ref text NOT NULL,
  PRIMARY KEY (pocket_id, session_id, storage_ref)
);
CREATE TABLE public.pocket_lab_x_candidates (
  pocket_id text NOT NULL, session_id text NOT NULL, operation_id text NOT NULL, actor_id text NOT NULL,
  expected_revision bigint NOT NULL, expected_seal text NOT NULL, candidate_seal text NOT NULL,
  node_id text NOT NULL, parent_id text NOT NULL, authority_epoch integer NOT NULL,
  dependency_source_id text, dependency_epoch integer, visible_objects jsonb NOT NULL,
  request_digest text NOT NULL, expires_at timestamptz NOT NULL,
  PRIMARY KEY (pocket_id, session_id, operation_id), UNIQUE (pocket_id, candidate_seal)
);
CREATE TABLE public.pocket_lab_x_receipts (
  pocket_id text NOT NULL, session_id text NOT NULL, operation_id text NOT NULL,
  actor_id text NOT NULL, request_digest text NOT NULL, public_receipt jsonb NOT NULL,
  private_source jsonb,
  PRIMARY KEY (pocket_id, session_id, operation_id)
);
CREATE FUNCTION public.pocket_lab_publish_current_x() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $publish$
DECLARE
  proof jsonb := NULLIF(current_setting('pocket_lab.writer_proof', true), '')::jsonb;
  candidate public.pocket_lab_x_candidates;
  authority public.pocket_lab_x_edit_authority;
  protected_source jsonb;
BEGIN
  DELETE FROM public.pocket_lab_x_candidates
    WHERE pocket_id = OLD.synced_pocket_id AND expected_revision = OLD.revision
      AND expected_seal = OLD.seal_storage_ref AND candidate_seal = NEW.seal_storage_ref
      AND session_id = proof->>'sessionId' AND operation_id = proof->>'operationId'
      AND expires_at > clock_timestamp()
    RETURNING * INTO candidate;
  IF NOT FOUND OR OLD.lab_visible_refs IS NULL OR NEW.required_writer_format <> 2 THEN
    RAISE EXCEPTION USING ERRCODE = 'PW001', MESSAGE = 'X publication refused';
  END IF;
  SELECT * INTO authority FROM public.pocket_lab_x_edit_authority
    WHERE pocket_id = OLD.synced_pocket_id AND actor_id = candidate.actor_id
      AND node_id = candidate.node_id AND parent_id = candidate.parent_id AND allowed
      AND epoch = candidate.authority_epoch
      AND dependency_source_id IS NOT DISTINCT FROM candidate.dependency_source_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PW001', MESSAGE = 'X publication refused';
  END IF;
  PERFORM 1 FROM public.pocket_sync_records s
    WHERE s.collection = 'sessions' AND s.record_key = candidate.session_id
      AND s.record->>'credentialId' = candidate.actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PW001', MESSAGE = 'X publication refused';
  END IF;
  IF authority.dependency_source_id IS NOT NULL THEN
    PERFORM 1 FROM public.pocket_lab_source_custody
      WHERE pocket_id = OLD.synced_pocket_id AND source_id = authority.dependency_source_id
        AND epoch = candidate.dependency_epoch FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'PW001', MESSAGE = 'X publication refused';
    END IF;
  END IF;
  IF NOT (candidate.visible_objects ? NEW.seal_storage_ref)
      OR EXISTS (SELECT 1 FROM jsonb_each_text(candidate.visible_objects) reviewed WHERE NOT EXISTS (
        SELECT 1 FROM public.pocket_sync_objects o
        WHERE o.synced_pocket_id = OLD.synced_pocket_id AND o.storage_ref = reviewed.key
          AND encode(sha256(convert_to(o.record::text, 'UTF8')), 'hex') = reviewed.value FOR SHARE OF o
      )) THEN
    RAISE EXCEPTION USING ERRCODE = 'PW001', MESSAGE = 'X publication refused';
  END IF;
  SELECT to_jsonb(c) INTO protected_source FROM public.pocket_lab_source_custody c
    WHERE c.pocket_id = OLD.synced_pocket_id AND c.capsule_ref = OLD.lab_source_ref FOR SHARE OF c;
  NEW.lab_source_ref := OLD.lab_source_ref;
  NEW.lab_visible_refs := ARRAY(SELECT jsonb_object_keys(candidate.visible_objects));
  INSERT INTO public.pocket_lab_x_receipts VALUES (
    OLD.synced_pocket_id, candidate.session_id, candidate.operation_id, candidate.actor_id,
    candidate.request_digest, jsonb_build_object(
      'schema', 'pocket.research.x-edit-receipt.v1', 'commandId', candidate.operation_id,
      'actorId', candidate.actor_id, 'nodeId', candidate.node_id, 'parentId', candidate.parent_id,
      'operation', 'edit-details',
      'previousHead', jsonb_build_object('schema', 'pocket.starling.head.v1',
        'revision', OLD.revision, 'sealRef', OLD.seal_storage_ref),
      'head', jsonb_build_object('schema', 'pocket.starling.head.v1',
        'revision', NEW.revision, 'sealRef', NEW.seal_storage_ref)
    ), protected_source
  );
  RETURN NEW;
END;
$publish$;
-- This replaces one research trigger only inside the disposable upgraded lab.
DROP TRIGGER pocket_lab_z_publish_scoped ON public.pocket_sync_heads;
CREATE TRIGGER pocket_lab_z_publish_current_x BEFORE UPDATE ON public.pocket_sync_heads
  FOR EACH ROW EXECUTE FUNCTION public.pocket_lab_publish_current_x();
REVOKE ALL ON FUNCTION public.pocket_lab_publish_current_x() FROM PUBLIC;`;

const fail = (status = 409, code = "head-conflict") => Object.assign(new Error("X edit unavailable"), { status, code });
const digest = command => createHash("sha256").update(JSON.stringify([
  command.apiVersion, command.operationId, command.syncedPocketId,
  [command.expectedHead.schema, command.expectedHead.revision, command.expectedHead.sealRef],
  command.candidateSealStorageRef, command.expectedAuthorityRevision,
])).digest("hex");
const sameHead = (a, b) => a?.revision === b?.revision && a?.sealRef === b?.sealRef;
const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const validRef = value => typeof value === "string" && value.startsWith(REFERENCE_PREFIX) &&
  /^[A-Za-z0-9_-]{43}$/.test(value.slice(REFERENCE_PREFIX.length));

function validateCommand(command) {
  const fields = ["apiVersion", "operationId", "syncedPocketId", "expectedHead",
    "candidateSealStorageRef", "expectedAuthorityRevision"];
  if (!command || Object.keys(command).length !== fields.length || fields.some(field => !(field in command)) ||
      command.apiVersion !== 1 || !validId(command.operationId) || !validId(command.syncedPocketId) ||
      !validRef(command.candidateSealStorageRef) || !Number.isSafeInteger(command.expectedAuthorityRevision) ||
      command.expectedAuthorityRevision < 1 || command.expectedHead?.schema !== "pocket.starling.head.v1" ||
      Object.keys(command.expectedHead).length !== 3 || !validRef(command.expectedHead.sealRef) ||
      !Number.isSafeInteger(command.expectedHead.revision) || command.expectedHead.revision < 1) {
    throw fail(400, "service-request-invalid");
  }
}

async function actor(pool, sessionId, pocketId) {
  const { rows: [row] } = await pool.query(`SELECT k.record_key AS id
    FROM public.pocket_sync_records s
    JOIN public.pocket_sync_records a ON a.collection='accounts' AND a.record_key=s.record->>'accountId'
    JOIN public.pocket_sync_records k ON k.collection='credentials' AND k.record_key=s.record->>'credentialId'
      AND k.record->>'accountId'=a.record_key AND a.record->'credentialIds' ? k.record_key
      AND k.record->>'status'='active'
    WHERE s.collection='sessions' AND s.record_key=$1 AND s.record->>'status'='active'
      AND (s.record->>'expiresAt')::timestamptz > clock_timestamp()
      AND a.record->>'syncedPocketId'=$2`, [sessionId, pocketId]);
  if (!row) throw fail(401, "service-session-invalid");
  return row.id;
}

async function currentScope(pool, pocketId, actorId, nodeId, parentId) {
  const { rows: [row] } = await pool.query(`SELECT * FROM public.pocket_lab_x_edit_authority
    WHERE pocket_id=$1 AND actor_id=$2 AND node_id=$3 AND parent_id=$4 AND allowed`,
  [pocketId, actorId, nodeId, parentId]);
  if (!row) throw fail();
  return row;
}

function detailsChange(before, after) {
  const changed = after.nodes.filter((node, index) => !isDeepStrictEqual(node, before.nodes[index]));
  if (changed.length !== 1 || typeof changed[0].details !== "string") throw fail();
  const node = changed[0], expected = structuredClone(before);
  const previous = expected.nodes.find(item => item.id === node.id && item.parentId === node.parentId);
  if (!previous) throw fail();
  previous.details = node.details;
  if (!isDeepStrictEqual(expected, after)) throw fail();
  return node;
}

function createPrivateSourceSaveLab({ issuerPool, writerPool, createCore, httpOptions, inspect, beforeRelease }) {
  async function receipt(sessionId, commandId, pocketId) {
    return (await issuerPool.query(`SELECT * FROM public.pocket_lab_x_receipts
      WHERE pocket_id=$1 AND session_id=$2 AND operation_id=$3`, [pocketId, sessionId, commandId])).rows[0];
  }
  async function review(sessionId, command) {
    validateCommand(command);
    const actorId = await actor(issuerPool, sessionId, command.syncedPocketId);
    const { before, after, records, baseLogicalSeal, previousLogicalSeal } = await inspect(command);
    if (!sameHead(before.head, command.expectedHead) || !baseLogicalSeal || previousLogicalSeal !== baseLogicalSeal) throw fail();
    const node = detailsChange(before.document, after);
    const client = await issuerPool.connect();
    try {
      await client.query("BEGIN");
      if (await actor(client, sessionId, command.syncedPocketId) !== actorId) throw fail();
      const authority = await currentScope(client, command.syncedPocketId, actorId, node.id, node.parentId);
      const dependency = authority.dependency_source_id && (await client.query(
        "SELECT epoch FROM public.pocket_lab_source_custody WHERE pocket_id=$1 AND source_id=$2",
        [command.syncedPocketId, authority.dependency_source_id])).rows[0];
      if (authority.dependency_source_id && !dependency) throw fail();
      const expires = new Date(Date.now() + 120000);
      await client.query(`INSERT INTO public.pocket_lab_x_candidates SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
        (SELECT jsonb_object_agg(key, encode(sha256(convert_to(value::text, 'UTF8')), 'hex'))
          FROM jsonb_each($13::jsonb)),$14,$15`,
      [command.syncedPocketId, sessionId, command.operationId, actorId, command.expectedHead.revision,
        command.expectedHead.sealRef, command.candidateSealStorageRef, node.id, node.parentId, authority.epoch,
        authority.dependency_source_id, dependency?.epoch ?? null, JSON.stringify(records), digest(command), expires]);
      const token = await issueWriterGrant(client, sessionId, command, expires);
      await client.query("COMMIT");
      return token;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  const handle = createWriterAdmissionHandler({ pool: writerPool, httpOptions: { ...httpOptions, serviceRoot: SAVE_ROOT },
    createCore(objectStore) {
      const core = createCore(objectStore);
      async function check(input, saved) {
        const id = await actor(issuerPool, input.context.sessionId, input.body.syncedPocketId);
        if (saved) {
          if (saved.actor_id !== id) throw fail();
          const view = saved.public_receipt;
          await currentScope(issuerPool, input.body.syncedPocketId, id, view.nodeId, view.parentId);
        }
        return id;
      }
      async function head(input) {
        const body = { apiVersion: 1, operationId: input.body.operationId, syncedPocketId: input.body.syncedPocketId };
        return (await core.readShadowHead({ context: input.context, body })).body.head;
      }
      return Object.fromEntries(Object.keys(core).map(name => {
        if (name === "putOpaqueObject") return [name, async input => {
          await check(input);
          const result = await core.putOpaqueObject(input);
          await issuerPool.query("INSERT INTO public.pocket_lab_x_staged VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
            [input.body.syncedPocketId, input.context.sessionId, input.body.storageRef]);
          await check(input);
          return result;
        }];
        if (name === "objectPresence") return [name, async input => {
          await check(input);
          const refs = input.body?.storageRefs;
          if (!Array.isArray(refs) || refs.length > MAXIMUM_PRESENCE_REFS || refs.some(ref => !validRef(ref)) ||
              new Set(refs).size !== refs.length) throw fail(400, "service-request-invalid");
          const { rows } = await issuerPool.query(`SELECT unnest(lab_visible_refs) AS ref FROM public.pocket_sync_heads
            WHERE synced_pocket_id=$1 UNION SELECT storage_ref FROM public.pocket_lab_x_staged
            WHERE pocket_id=$1 AND session_id=$2`, [input.body.syncedPocketId, input.context.sessionId]);
          const allowed = new Set(rows.map(row => row.ref));
          const result = await core.objectPresence({ ...input, body: { ...input.body,
            storageRefs: refs.filter(ref => allowed.has(ref)) } });
          const found = new Set(result.body.rows.filter(row => row.present).map(row => row.storageRef));
          await check(input);
          return { ...result, body: { ...result.body,
            rows: refs.map(storageRef => ({ storageRef, present: found.has(storageRef) })) } };
        }];
        if (name === "compareAndSetShadowHead") return [name, async input => {
          validateCommand(input.body);
          await check(input);
          const saved = await receipt(input.context.sessionId, input.body.operationId, input.body.syncedPocketId);
          let result;
          if (saved) {
            await check(input, saved);
            const ok = saved.request_digest === digest(input.body) && sameHead(await head(input), saved.public_receipt.head);
            result = { status: ok ? 200 : 409, session: null, body: { apiVersion: 1, ok,
              operationId: input.body.operationId, syncedPocketId: input.body.syncedPocketId,
              ...(ok ? { head: saved.public_receipt.head } : { reason: "head-conflict" }) } };
          } else result = await core.compareAndSetShadowHead(input);
          await beforeRelease?.(result);
          await check(input, await receipt(input.context.sessionId, input.body.operationId, input.body.syncedPocketId));
          if (result.status === 200 && !sameHead(await head(input), result.body.head)) {
            throw fail(503, "service-publication-ambiguous");
          }
          return result;
        }];
        if (name === "readRevision") return [name, async input => {
          const fields = ["apiVersion", "operationId", "syncedPocketId", "commandId"];
          if (input.body?.apiVersion !== 1 || Object.keys(input.body).length !== fields.length ||
              fields.slice(1).some(field => !validId(input.body[field]))) throw fail(400, "service-request-invalid");
          await check(input);
          const saved = await receipt(input.context.sessionId, input.body.commandId, input.body.syncedPocketId);
          await check(input, saved);
          const accepted = saved?.public_receipt ?? null;
          await beforeRelease?.();
          await check(input, saved);
          const current = await head(input);
          return { status: 200, session: null, body: { schema: STATUS_SCHEMA, apiVersion: 1, ok: true,
            operationId: input.body.operationId, state: accepted
              ? sameHead(current, accepted.head) ? "committed" : "superseded" : "unknown",
            head: current, receipt: accepted } };
        }];
        return [name, async () => { throw fail(404, "service-record-not-found"); }];
      }));
    },
  });
  return Object.freeze({ review, handle });
}

module.exports = { INSTALL_SQL, SAVE_ROOT, RECEIPT_SCHEMA, STATUS_SCHEMA, createPrivateSourceSaveLab };
