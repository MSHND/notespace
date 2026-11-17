"use strict";

// Disposable research installation. Load the SQL only in the isolated fixture.
// The ordinary Head row owns the format floor, and its existing CAS owns Save.
const { AsyncLocalStorage } = require("node:async_hooks");
const { createHash, randomBytes } = require("node:crypto");
const { createHttpAdapter } = require("../sync-service/pocket-sync-http-adapter.js");
const { createObjectHeadPostgresStore } = require("../sync-service/pocket-sync-object-head-postgres-store.js");

const GRANT_HEADER = "Pocket-Writer-Grant";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const hash = token => createHash("sha256").update(token).digest("hex");
const INSTALL_SQL = `ALTER TABLE public.pocket_sync_heads
  ADD COLUMN required_writer_format integer NOT NULL DEFAULT 1
    CHECK (required_writer_format IN (1, 2));

CREATE TABLE public.pocket_lab_writer_grants (
  token_hash text PRIMARY KEY,
  session_id text NOT NULL,
  operation_id text NOT NULL,
  synced_pocket_id text NOT NULL,
  authority_revision bigint NOT NULL,
  expected_revision bigint NOT NULL,
  expected_seal text,
  candidate_seal text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE FUNCTION public.pocket_lab_admit_writer() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $admit$
DECLARE
  proof jsonb := NULLIF(current_setting('pocket_lab.writer_proof', true), '')::jsonb;
BEGIN
  IF NEW.synced_pocket_id = OLD.synced_pocket_id
    AND NEW.revision = OLD.revision + 1
    AND NEW.required_writer_format = OLD.required_writer_format THEN
    IF proof IS NULL AND OLD.required_writer_format = 1 THEN
      RETURN NEW;
    END IF;
    IF proof IS NOT NULL THEN
      PERFORM 1 FROM public.pocket_sync_records AS s
        JOIN public.pocket_sync_records AS a
          ON a.collection = 'accounts' AND a.record_key = s.record->>'accountId'
        JOIN public.pocket_sync_records AS c
          ON c.collection = 'credentials' AND c.record_key = s.record->>'credentialId'
        JOIN public.pocket_sync_records AS p
          ON p.collection = 'persistenceAuthorities' AND p.record_key = OLD.synced_pocket_id
        WHERE s.collection = 'sessions' AND s.record_key = proof->>'sessionId'
          AND s.record->>'status' = 'active' AND (s.record->>'expiresAt')::timestamptz > clock_timestamp()
          AND a.record->>'syncedPocketId' = OLD.synced_pocket_id
          AND a.record->'credentialIds' ? c.record_key
          AND c.record->>'accountId' = a.record_key AND c.record->>'status' = 'active'
          AND p.record->>'accountId' = a.record_key AND p.record->>'currentMode' = 'starling'
          AND p.record->>'transition' IS NULL
          AND p.record->>'authorityRevision' = proof->>'authorityRevision'
        FOR SHARE OF s, a, c, p;
      IF FOUND THEN
        DELETE FROM public.pocket_lab_writer_grants
          WHERE token_hash = proof->>'tokenHash' AND session_id = proof->>'sessionId'
            AND operation_id = proof->>'operationId' AND synced_pocket_id = OLD.synced_pocket_id
            AND authority_revision::text = proof->>'authorityRevision'
            AND expected_revision = OLD.revision AND expected_seal IS NOT DISTINCT FROM OLD.seal_storage_ref
            AND candidate_seal = NEW.seal_storage_ref AND expires_at > clock_timestamp();
        IF FOUND THEN
          NEW.required_writer_format := 2;
          RETURN NEW;
        END IF;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE = 'PW001', MESSAGE = 'Writer admission refused';
END;
$admit$;

CREATE TRIGGER pocket_lab_writer_admission BEFORE UPDATE ON public.pocket_sync_heads
  FOR EACH ROW EXECUTE FUNCTION public.pocket_lab_admit_writer();
REVOKE ALL ON FUNCTION public.pocket_lab_admit_writer() FROM PUBLIC;
`;

// Called by the trusted test issuer for an already reviewed, exact command.
async function issueWriterGrant(issuerPool, sessionId, request, expiresAt) {
  const token = randomBytes(32).toString("base64url");
  await issuerPool.query(
    "INSERT INTO public.pocket_lab_writer_grants VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [hash(token), sessionId, request.operationId, request.syncedPocketId,
      request.expectedAuthorityRevision, request.expectedHead.revision,
      request.expectedHead.sealRef, request.candidateSealStorageRef, expiresAt],
  );
  return token;
}

function createWriterAdmissionHandler({ pool, createCore, httpOptions }) {
  const scope = new AsyncLocalStorage();
  const stock = createObjectHeadPostgresStore({
    pool: {
      async connect() {
        const client = await pool.connect(), proof = scope.getStore()?.proof;
        let discard = false;
        return {
          async query(sql, values) {
            try {
              const result = await client.query(sql, values);
              if (sql === "BEGIN" && proof) {
                try {
                  await client.query("SELECT set_config('pocket_lab.writer_proof', $1, true)", [JSON.stringify(proof)]);
                } catch (error) {
                  try { await client.query("ROLLBACK"); } catch { discard = true; }
                  throw error;
                }
              }
              return result;
            } catch (error) {
              if (error?.code === "PW001") {
                throw Object.assign(new Error("Head write refused"), { code: "object-head-store-writer-admission" });
              }
              throw error;
            }
          },
          release() { client.release(discard); },
        };
      },
    },
  });
  const core = createCore(Object.freeze({
    ...stock,
    async compareAndSetHead(...args) {
      try { return await stock.compareAndSetHead(...args); }
      catch (error) {
        if (error.code === "object-head-store-writer-admission") {
          // This is a defined, non-disclosing refusal the existing client understands.
          return Object.freeze({ ok: false, reason: "head-conflict" });
        }
        throw error;
      }
    },
  }));
  const adapter = createHttpAdapter({ ...httpOptions, core: {
    ...core,
    compareAndSetShadowHead(input) {
      const token = scope.getStore()?.token;
      if (token === null || token === undefined) return core.compareAndSetShadowHead(input);
      const proof = Object.freeze({
        tokenHash: TOKEN.test(token) ? hash(token) : null,
        sessionId: input.context.sessionId,
        operationId: input.body?.operationId,
        authorityRevision: input.body?.expectedAuthorityRevision,
      });
      return scope.run({ proof }, () => core.compareAndSetShadowHead(input));
    },
  } });
  return request => scope.run({ token: request?.headers?.get?.(GRANT_HEADER) }, () => adapter.handle(request));
}

module.exports = { GRANT_HEADER, INSTALL_SQL, issueWriterGrant, createWriterAdmissionHandler };
