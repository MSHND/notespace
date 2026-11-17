"use strict";

// Research-only custody metadata. Starling stores the original ciphertext.
const { createHash, randomBytes } = require("node:crypto");
const { openSourceCapsule } = require("./pocket-legacy-intake-bridge.js");

const CAPSULE = "peMigrationLegacySourcePreserved";
const OPERATIONS = new Set(["read", "copy", "export"]);
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SOURCE_UNAVAILABLE = Object.freeze({ ok: false, reason: "source-unavailable" });
const THOUGHT_UNAVAILABLE = Object.freeze({ ok: false, reason: "thought-unavailable" });
const digest = value => createHash("sha256").update(value, "utf8").digest("hex");
const sameHead = (a, b) => a && b && a.revision === b.revision && a.sealRef === b.sealRef;

const INSTALL_SQL = `CREATE TABLE public.pocket_lab_source_custody (
  pocket_id text NOT NULL, source_id text NOT NULL, owner_id text NOT NULL,
  node_id text NOT NULL, parent_id text NOT NULL, version text NOT NULL,
  export_digest text NOT NULL, capsule_ref text NOT NULL, envelope jsonb NOT NULL,
  epoch integer NOT NULL DEFAULT 1,
  PRIMARY KEY (pocket_id, source_id), UNIQUE (pocket_id, node_id)
);
CREATE TABLE public.pocket_lab_source_grants (
  token_hash text PRIMARY KEY, pocket_id text NOT NULL, source_id text NOT NULL,
  reader_session text NOT NULL, reader_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('read', 'copy', 'export')),
  epoch integer NOT NULL, version text NOT NULL, expires_at timestamptz NOT NULL,
  FOREIGN KEY (pocket_id, source_id) REFERENCES public.pocket_lab_source_custody
);`;

const ACTOR_JOIN = `FROM public.pocket_sync_records AS s
  JOIN public.pocket_sync_records AS a
    ON a.collection = 'accounts' AND a.record_key = s.record->>'accountId'
  JOIN public.pocket_sync_records AS k
    ON k.collection = 'credentials' AND k.record_key = s.record->>'credentialId'
    AND k.record->>'accountId' = a.record_key AND k.record->>'status' = 'active'
    AND a.record->'credentialIds' ? k.record_key`;
const ACTIVE = `s.collection = 'sessions' AND s.record->>'status' = 'active'
  AND (s.record->>'expiresAt')::timestamptz > clock_timestamp()`;

const liveActor = (session, pocket, id) => `EXISTS (SELECT 1 ${ACTOR_JOIN}
  WHERE ${ACTIVE} AND s.record_key = ${session} AND a.record->>'syncedPocketId' = ${pocket}
    AND k.record_key = ${id} FOR SHARE OF s, a, k)`;

const PERMIT = `SELECT c.*, g.reader_id AS authorised_reader_id ${ACTOR_JOIN}
  JOIN public.pocket_lab_source_grants AS g
    ON g.reader_session = s.record_key AND g.reader_id = k.record_key
  JOIN public.pocket_lab_source_custody AS c
    ON c.pocket_id = g.pocket_id AND c.source_id = g.source_id
    AND c.epoch = g.epoch AND c.version = g.version
  JOIN public.pocket_sync_heads AS h ON h.synced_pocket_id = c.pocket_id
  WHERE ${ACTIVE} AND g.token_hash = $1 AND s.record_key = $2
    AND c.pocket_id = $3 AND a.record->>'syncedPocketId' = $3 AND c.source_id = $4
    AND c.node_id = $5 AND c.parent_id = $6 AND c.version = $7 AND g.operation = $8
    AND g.expires_at > clock_timestamp() AND h.revision = $9 AND h.seal_storage_ref = $10`;

function custodyEnvelopeContext(syncedPocketId, ownerId, exportDigest) {
  return {
    syncedPocketId, envelopeId: "source-custody-" + digest(JSON.stringify([ownerId, exportDigest])),
    envelopeKind: "device", envelopeVersion: 1,
  };
}

// The custodian is an owner-side trust boundary in this experiment. It receives
// the accepted view and holder's wrapping key. Readers receive scoped results.
function createSourceCustody({ pool, syncedPocketId, authenticate, openAccepted, ownerWrappingKey,
  placementScope, publishDetails }) {
  async function identify(sessionId) {
    const head = await authenticate(sessionId);
    if (!head?.sealRef) return null;
    const result = await pool.query(`SELECT k.record_key AS id ${ACTOR_JOIN}
      WHERE ${ACTIVE} AND s.record_key = $1 AND a.record->>'syncedPocketId' = $2`,
    [sessionId, syncedPocketId]);
    return result.rowCount === 1 ? { id: result.rows[0].id, head } : null;
  }

  async function issue({ ownerSession, readerSession, sourceId, version, operation, expiresAt }) {
    try {
      if (!OPERATIONS.has(operation)) return SOURCE_UNAVAILABLE;
      const owner = await identify(ownerSession), reader = await identify(readerSession);
      if (!owner || !reader) return SOURCE_UNAVAILABLE;
      const token = randomBytes(32).toString("base64url");
      const result = await pool.query(`INSERT INTO public.pocket_lab_source_grants
        SELECT $1, c.pocket_id, c.source_id, $2, $3, $4, c.epoch, c.version, $5
        FROM public.pocket_lab_source_custody c
        WHERE c.pocket_id = $6 AND c.source_id = $7 AND c.owner_id = $8 AND c.version = $9
          AND $5::timestamptz > clock_timestamp()
          AND ${liveActor("$10", "$6", "$8")} AND ${liveActor("$2", "$6", "$3")}
        FOR SHARE OF c RETURNING token_hash`,
      [digest(token), readerSession, reader.id, operation, expiresAt, syncedPocketId, sourceId,
        owner.id, version, ownerSession]);
      return result.rowCount === 1 ? Object.freeze({ ok: true, token }) : SOURCE_UNAVAILABLE;
    } catch { return SOURCE_UNAVAILABLE; }
  }

  async function revoke({ ownerSession, token }) {
    try {
      const owner = await identify(ownerSession);
      if (!owner || !TOKEN.test(token)) return false;
      const result = await pool.query(`DELETE FROM public.pocket_lab_source_grants g
        USING public.pocket_lab_source_custody c
        WHERE g.pocket_id = c.pocket_id AND g.source_id = c.source_id
          AND g.token_hash = $1 AND c.pocket_id = $2 AND c.owner_id = $3 AND ${liveActor("$4", "$2", "$3")}`,
      [digest(token), syncedPocketId, owner.id, ownerSession]);
      return result.rowCount === 1;
    } catch { return false; }
  }

  async function changeScope({ ownerSession, sourceId }) {
    try {
      const owner = await identify(ownerSession);
      if (!owner) return false;
      const result = await pool.query(`UPDATE public.pocket_lab_source_custody SET epoch = epoch + 1
        WHERE pocket_id = $1 AND source_id = $2 AND owner_id = $3 AND ${liveActor("$4", "$1", "$3")}`,
      [syncedPocketId, sourceId, owner.id, ownerSession]);
      return result.rowCount === 1;
    } catch { return false; }
  }

  async function consume(values, permit) {
    const connection = await pool.connect();
    let discard = false;
    try {
      await connection.query("BEGIN");
      const { rows } = await connection.query(PERMIT + " FOR UPDATE OF g FOR SHARE OF c, h, s, a, k", values);
      const live = rows[0];
      if (!live || live.epoch !== permit.epoch || live.capsule_ref !== permit.capsule_ref
          || live.owner_id !== permit.owner_id || live.export_digest !== permit.export_digest) {
        await connection.query("ROLLBACK");
        return false;
      }
      const result = await connection.query(`DELETE FROM public.pocket_lab_source_grants
        WHERE token_hash = $1 AND expires_at > clock_timestamp() AND ${liveActor("$2", "$3", "$4")}`,
      [values[0], values[1], syncedPocketId, permit.authorised_reader_id]);
      await connection.query("COMMIT");
      return result.rowCount === 1;
    } catch (error) {
      try { await connection.query("ROLLBACK"); } catch { discard = true; }
      throw error;
    } finally { connection.release(discard); }
  }

  async function open({ sessionId, token, sourceId, nodeId, parentId, version, operation }) {
    try {
      if (!OPERATIONS.has(operation) || typeof token !== "string" || !TOKEN.test(token)) return SOURCE_UNAVAILABLE;
      const actor = await identify(sessionId);
      if (!actor) return SOURCE_UNAVAILABLE;
      const values = [digest(token), sessionId, syncedPocketId, sourceId, nodeId, parentId, version, operation,
        actor.head.revision, actor.head.sealRef];
      const permit = (await pool.query(PERMIT, values)).rows[0];
      if (!permit) return SOURCE_UNAVAILABLE;
      const current = await openAccepted();
      if (!sameHead(current.head, actor.head)) return SOURCE_UNAVAILABLE;
      const node = current.document.nodes.find(item => item.id === nodeId && item.parentId === parentId);
      const capsule = node?.[CAPSULE];
      if (capsule?.ref !== permit.capsule_ref) return SOURCE_UNAVAILABLE;
      const key = await ownerWrappingKey(permit.owner_id);
      const bundle = await current.runtime.PocketSyncCrypto.openMasterKeyBundle(permit.envelope, key,
        custodyEnvelopeContext(syncedPocketId, permit.owner_id, permit.export_digest));
      const result = await openSourceCapsule(current.runtime, {
        capsule, capsuleKey: bundle.masterKey, syncedPocketId, sourceSha256: permit.export_digest, nodeId,
      });
      if (!result.ok || digest(result.json) !== permit.version || !await consume(values, permit)) return SOURCE_UNAVAILABLE;
      return Object.freeze({ ok: true, json: result.json });
    } catch { return SOURCE_UNAVAILABLE; }
  }

  async function scopedPlacement({ sessionId, nodeId, parentId }) {
    const actor = await identify(sessionId);
    const scope = actor && placementScope(actor.id, nodeId, parentId);
    if (!scope?.view) return null;
    const current = await openAccepted();
    if (!sameHead(current.head, actor.head)) return null;
    const node = current.document.nodes.find(item => item.id === nodeId && item.parentId === parentId);
    const latest = node && await identify(sessionId);
    if (!latest || latest.id !== actor.id || !sameHead(latest.head, actor.head)) return null;
    return { current, node, edit: scope.edit === true };
  }

  async function view(input) {
    try {
      const placement = await scopedPlacement(input);
      if (!placement) return THOUGHT_UNAVAILABLE;
      const { id, parentId, label, details } = placement.node;
      return Object.freeze({ ok: true, thought: Object.freeze({ id, parentId, label, details: details ?? "" }) });
    } catch { return THOUGHT_UNAVAILABLE; }
  }

  async function editDetails(input) {
    try {
      const placement = await scopedPlacement(input);
      if (!placement?.edit || typeof input.details !== "string") return { outcome: "unavailable" };
      const { id, parentId, order, ...payload } = placement.node;
      const result = await publishDetails(placement.current, input.sessionId, id, { ...payload, details: input.details });
      return { outcome: result.outcome };
    } catch { return { outcome: "unavailable" }; }
  }

  return Object.freeze({ issue, revoke, changeScope, open, view, editDetails });
}

module.exports = { INSTALL_SQL, custodyEnvelopeContext, createSourceCustody };
