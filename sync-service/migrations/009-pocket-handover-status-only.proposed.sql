-- P349 DORMANT 009 — STATUS-ONLY OUTCOME ACCESS AFTER PUBLISH REVOCATION.
-- Depends on proposed 005 -> 006 -> 007 -> 008. Never register on Render.
-- Status reader owns no release history tables, pointer DML, approval issuance,
-- SPENT admission, or publication function EXECUTE. Separate LOGIN provisioning
-- and approved exact read bindings remain independently controlled.
BEGIN;
CREATE ROLE pocket_handover_outcome_reader NOLOGIN NOSUPERUSER NOBYPASSRLS;

-- Inherited from 008: the protected SECURITY DEFINER function owner already
-- has SELECT on receipts, capabilities and approved principal bindings.
-- It holds narrow UPDATE(revoked) solely so FOR SHARE can serialize a
-- read-authority check against concurrent revocation. Ordinary LOGINs do not
-- inherit the function owner role.
CREATE FUNCTION public.pocket_handover_read_publication_outcome(
  p_receipt_id TEXT, p_capability_id TEXT, p_capability_secret TEXT
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $p349_outcome$
DECLARE
  c public.pocket_handover_scoped_capabilities%ROWTYPE;
  b public.pocket_handover_principal_bindings%ROWTYPE;
  r public.pocket_handover_approval_receipts%ROWTYPE;
BEGIN
  -- No caller-provided principal, owner, resource, or publish secret is trusted.
  -- Invalid/unknown receipt IDs and cross-owner requests share one response.
  IF p_receipt_id IS NULL OR length(p_receipt_id)>128
     OR p_capability_id IS NULL OR p_capability_secret IS NULL
     OR length(p_capability_secret)>1024
  THEN RETURN jsonb_build_object('status','ACCESS_DENIED'); END IF;

  SELECT * INTO c FROM public.pocket_handover_scoped_capabilities
    WHERE capability_id=p_capability_id FOR SHARE;
  IF NOT FOUND OR c.operation <> 'read'
      OR c.db_login <> SESSION_USER::name
      OR c.revoked OR c.expires_at <= clock_timestamp()
      OR c.secret_sha256 IS DISTINCT FROM pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(p_capability_secret,'UTF8')),'hex')
  THEN RETURN jsonb_build_object('status','ACCESS_DENIED'); END IF;

  -- EXACT issuing identity: no other issuer/subject can rescue a revoked
  -- or missing binding sharing the same principal/owner/resource/login.
  SELECT * INTO b FROM public.pocket_handover_principal_bindings
    WHERE issuer=c.issuer AND subject=c.subject
      AND principal_id=c.principal_id
      AND owner_id=c.owner_id AND resource_id=c.resource_id
      AND db_login=c.db_login AND operation='read' FOR SHARE;
  IF NOT FOUND OR b.revoked OR NOT b.approved
  THEN RETURN jsonb_build_object('status','ACCESS_DENIED'); END IF;

  -- Receipt ID selects an existing attempt, NOT authority. Match the
  -- independently authenticated principal, exact owner and resource.
  -- The receipt's original publisher DB login may differ from this reader.
  SELECT * INTO r FROM public.pocket_handover_approval_receipts
    WHERE receipt_id=p_receipt_id;
  IF NOT FOUND OR r.principal_id IS DISTINCT FROM c.principal_id
      OR r.owner_id IS DISTINCT FROM c.owner_id
      OR r.resource_id IS DISTINCT FROM c.resource_id
  THEN RETURN jsonb_build_object('status','ACCESS_DENIED'); END IF;

  -- Successful outcome is recorded atomically with the original pointer CAS.
  -- NEVER consult the current pointer to infer an earlier release outcome.
  IF r.status='settled' AND r.publication_outcome='published'
      AND r.published_revision IS NOT NULL AND r.published_revision>0
  THEN
    RETURN jsonb_build_object('status','PUBLISHED','releaseId',r.release_id,
      'publishedRevision',r.published_revision);
  ELSIF r.status='settled' AND r.publication_outcome='denied'
      AND r.published_revision IS NULL
  THEN
    RETURN jsonb_build_object('status','DENIED','releaseId',r.release_id);
  ELSIF r.status='spent' AND r.publication_outcome IS NULL
      AND r.published_revision IS NULL
  THEN
    RETURN jsonb_build_object('status','UNRESOLVED','releaseId',r.release_id);
  END IF;
  -- Malformed/legacy/ambiguous combinations are never interpreted as success.
  RETURN jsonb_build_object('status','UNKNOWN');
END;
$p349_outcome$;

ALTER FUNCTION public.pocket_handover_read_publication_outcome(TEXT,TEXT,TEXT)
  OWNER TO pocket_handover_authority_owner;
REVOKE ALL ON FUNCTION public.pocket_handover_read_publication_outcome(TEXT,TEXT,TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pocket_handover_read_publication_outcome(TEXT,TEXT,TEXT)
  TO pocket_handover_outcome_reader;
COMMIT;
