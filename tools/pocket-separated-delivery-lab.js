"use strict";

// Disposable research only. The existing PostgreSQL Head CAS also publishes
// its X-only reachability set and private custody binding.
const { AsyncLocalStorage } = require("node:async_hooks");
const { createHttpAdapter } = require("../sync-service/pocket-sync-http-adapter.js");
const { HEAD_SCHEMA, REFERENCE_PREFIX, MAXIMUM_PRESENCE_REFS } =
  require("../sync-service/pocket-sync-object-head-postgres-store.js");

const VIEW_ROOT = "/pocket-sync/research/separated/v1";
const privateBucket = pocket => pocket + "/protected-original";
const INSTALL_SQL = `ALTER TABLE public.pocket_sync_heads
  ADD COLUMN lab_visible_refs text[],
  ADD COLUMN lab_source_ref text;
CREATE TABLE public.pocket_lab_scoped_candidates (
  pocket_id text NOT NULL, expected_revision bigint NOT NULL, expected_seal text NOT NULL,
  candidate_seal text NOT NULL, visible_objects jsonb NOT NULL, existing_epoch integer,
  new_source jsonb, source_digest bytea,
  PRIMARY KEY (pocket_id, candidate_seal)
);
CREATE FUNCTION public.pocket_lab_publish_scoped() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $scoped$
DECLARE
  candidate public.pocket_lab_scoped_candidates;
  source_ref text;
BEGIN
  DELETE FROM public.pocket_lab_scoped_candidates
    WHERE pocket_id = OLD.synced_pocket_id AND expected_revision = OLD.revision
      AND expected_seal = OLD.seal_storage_ref AND candidate_seal = NEW.seal_storage_ref
    RETURNING * INTO candidate;
  IF NOT FOUND THEN
    IF OLD.lab_visible_refs IS NULL THEN RETURN NEW; END IF;
    RAISE EXCEPTION USING ERRCODE = 'PW001', MESSAGE = 'Scoped writer admission refused';
  END IF;
  IF NEW.required_writer_format <> 2 OR NOT (candidate.visible_objects ? NEW.seal_storage_ref)
      OR EXISTS (SELECT 1 FROM jsonb_each_text(candidate.visible_objects) reviewed WHERE NOT EXISTS (
        SELECT 1 FROM public.pocket_sync_objects o
        WHERE o.synced_pocket_id = OLD.synced_pocket_id AND o.storage_ref = reviewed.key
          AND encode(sha256(convert_to(o.record::text, 'UTF8')), 'hex') = reviewed.value
        FOR SHARE OF o
      )) THEN
    RAISE EXCEPTION USING ERRCODE = 'PW001', MESSAGE = 'Scoped publication refused';
  END IF;
  source_ref := COALESCE(OLD.lab_source_ref, candidate.new_source->>'ref');
  IF source_ref IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.pocket_sync_objects o
    WHERE o.synced_pocket_id = OLD.synced_pocket_id || '/protected-original'
      AND o.storage_ref = source_ref AND sha256(convert_to(o.record::text, 'UTF8')) = candidate.source_digest
    FOR SHARE OF o
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PW001', MESSAGE = 'Scoped publication refused';
  END IF;
  IF candidate.new_source IS NOT NULL THEN
    IF OLD.lab_visible_refs IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PW001', MESSAGE = 'Scoped publication refused';
    END IF;
    INSERT INTO public.pocket_lab_source_custody
      (pocket_id, source_id, owner_id, node_id, parent_id, version, export_digest, capsule_ref, envelope)
      SELECT OLD.synced_pocket_id, s->>'sourceId', s->>'ownerId', s->>'nodeId', s->>'parentId',
        s->>'version', s->>'exportDigest', source_ref, s->'envelope'
      FROM (SELECT candidate.new_source AS s) AS original;
  ELSIF source_ref IS NOT NULL THEN
    UPDATE public.pocket_lab_source_custody SET epoch = epoch + 1
      WHERE pocket_id = OLD.synced_pocket_id AND capsule_ref = source_ref AND epoch = candidate.existing_epoch;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'PW001', MESSAGE = 'Scoped publication refused';
    END IF;
  END IF;
  NEW.lab_visible_refs := ARRAY(SELECT jsonb_object_keys(candidate.visible_objects));
  NEW.lab_source_ref := source_ref;
  RETURN NEW;
END;
$scoped$;
-- PostgreSQL fires both BEFORE UPDATE triggers in name order. The existing
-- writer-format trigger must validate and consume its grant first.
CREATE TRIGGER pocket_lab_z_publish_scoped BEFORE UPDATE ON public.pocket_sync_heads
  FOR EACH ROW EXECUTE FUNCTION public.pocket_lab_publish_scoped();
REVOKE ALL ON FUNCTION public.pocket_lab_publish_scoped() FROM PUBLIC;`;

const READS = new Set(["readShadowHead", "getOpaqueObject", "objectPresence"]);
const LEGACY = new Set([...READS, "downloadEncryptedRecord", "readRevision",
  "putOpaqueObject", "initialiseShadowHead", "compareAndSetShadowHead"]);
const unavailable = () => Object.assign(new Error("View unavailable"), { status: 404, code: "service-record-not-found" });

function validateRefs(refs) {
  if (!Array.isArray(refs) || refs.length > MAXIMUM_PRESENCE_REFS || new Set(refs).size !== refs.length ||
      refs.some(ref => typeof ref !== "string" || !ref.startsWith(REFERENCE_PREFIX) ||
        !/^[A-Za-z0-9_-]{43}$/.test(ref.slice(REFERENCE_PREFIX.length)))) {
    throw Object.assign(new Error("Invalid object reference"), { code: "object-head-store-presence-invalid" });
  }
}

function createScopedHttp({ pool, stock, createCore, httpOptions, canView }) {
  const scope = new AsyncLocalStorage();
  async function current({ context, body }) {
    const { rows: [row] } = await pool.query(`SELECT a.record->>'syncedPocketId' AS pocket,
        k.record_key AS actor, h.revision, h.seal_storage_ref, h.lab_visible_refs
      FROM public.pocket_sync_records s
      JOIN public.pocket_sync_records a ON a.collection = 'accounts' AND a.record_key = s.record->>'accountId'
      JOIN public.pocket_sync_records k ON k.collection = 'credentials' AND k.record_key = s.record->>'credentialId'
        AND k.record->>'accountId' = a.record_key AND a.record->'credentialIds' ? k.record_key
        AND k.record->>'status' = 'active'
      LEFT JOIN public.pocket_sync_heads h ON h.synced_pocket_id = a.record->>'syncedPocketId'
      WHERE s.collection = 'sessions' AND s.record_key = $1 AND s.record->>'status' = 'active'
        AND (s.record->>'expiresAt')::timestamptz > clock_timestamp()`, [context.sessionId]);
    if (!row) throw Object.assign(new Error("Session unavailable"), { status: 401, code: "service-session-invalid" });
    if (row.pocket !== body.syncedPocketId) {
      throw Object.assign(new Error("Pocket unavailable"), { status: 403, code: "service-authorisation-failed" });
    }
    return row;
  }
  const scoped = createCore({
    ...stock,
    async readHead() {
      const row = scope.getStore();
      return { schema: HEAD_SCHEMA, revision: Number(row.revision), sealRef: row.seal_storage_ref };
    },
    async getObject(pocket, ref) {
      validateRefs([ref]);
      return scope.getStore().lab_visible_refs.includes(ref) ? stock.getObject(pocket, ref) : null;
    },
    async presence(pocket, refs) {
      validateRefs(refs);
      const allowed = scope.getStore().lab_visible_refs;
      const visible = await stock.presence(pocket, refs.filter(ref => allowed.includes(ref)));
      const present = new Set(visible.filter(row => row.present).map(row => row.storageRef));
      return refs.map(storageRef => ({ storageRef, present: present.has(storageRef) }));
    },
  });
  const ordinary = createCore(stock);
  function build(core, root, routes, protectedView) {
    return createHttpAdapter({ ...httpOptions, serviceRoot: root, core: Object.fromEntries(
      Object.keys(core).map(name => [name, async input => {
        if (!routes.has(name)) throw unavailable();
        const before = await current(input);
        const allowed = row => protectedView
          ? Array.isArray(row.lab_visible_refs) && canView(row.actor)
          : row.lab_visible_refs === null;
        if (!allowed(before)) throw unavailable();
        const result = await scope.run(before, () => core[name](input));
        const after = await current(input);
        if (!allowed(after) || before.actor !== after.actor || (protectedView &&
            (before.revision !== after.revision || before.seal_storage_ref !== after.seal_storage_ref))) throw unavailable();
        return result;
      }]),
    ) }).handle;
  }
  const legacy = build(ordinary, httpOptions.serviceRoot, LEGACY, false);
  const view = build(scoped, VIEW_ROOT, READS, true);
  return request => new URL(request.url).pathname.startsWith(VIEW_ROOT + "/") ? view(request) : legacy(request);
}

module.exports = { INSTALL_SQL, VIEW_ROOT, createScopedHttp, privateBucket };
