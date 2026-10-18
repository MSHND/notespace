-- P349 SECURITY CANDIDATE ONLY. DORMANT; do not register or deploy.
-- Depends on proposed 005 (digest/immutability) and 006 (LOGIN/RLS).
-- Receipts here are SYNTHETIC: an issuer-login may insert them without proving
-- a human ceremony. Verified identity-to-DB-LOGIN brokering is also NOT live.
-- ONE-USE CONTRACT: one durable CLAIM per receipt; a claim must COMMIT in its
-- own transaction before the publication transaction begins.
-- GAP: after an unexpected ROLLBACK of the separate publication transaction,
-- a CLAIMED receipt can be submitted again. Strict at-most-one EXECUTION attempt
-- therefore requires a separately proven trusted executor/terminal claim gate.
-- Fail closed: never present this as a deployable human-authorised system.
BEGIN;

CREATE ROLE pocket_handover_approval_issuer NOLOGIN;
CREATE ROLE pocket_handover_authority_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;

CREATE TABLE public.pocket_handover_approval_receipts (
  receipt_id TEXT PRIMARY KEY CHECK (receipt_id ~ '^ap[a-z0-9]{12,48}$'),
  owner_id TEXT NOT NULL CHECK (owner_id ~ '^[a-z][a-z0-9._:-]{0,127}$'),
  resource_id TEXT NOT NULL CHECK (resource_id ~ '^[a-z][a-z0-9._:-]{0,127}$'),
  principal_login NAME NOT NULL,
  release_id TEXT NOT NULL CHECK (release_id ~ '^r[0-9]{1,18}$'),
  expected_revision BIGINT NOT NULL CHECK (expected_revision >= 0 AND expected_revision < 9007199254740991),
  manifest_sha256 TEXT NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  secret_sha256 TEXT NOT NULL CHECK (secret_sha256 ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','claimed','settled','revoked')),
  claimed_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  CHECK (status <> 'claimed' OR claimed_at IS NOT NULL)
);
REVOKE ALL ON public.pocket_handover_approval_receipts FROM PUBLIC;
GRANT INSERT ON public.pocket_handover_approval_receipts
  TO pocket_handover_approval_issuer;
GRANT SELECT, UPDATE ON public.pocket_handover_approval_receipts
  TO pocket_handover_authority_owner;
GRANT SELECT ON public.pocket_handover_role_bindings
  TO pocket_handover_authority_owner;
GRANT SELECT ON public.pocket_handover_release_entries
  TO pocket_handover_authority_owner;
GRANT UPDATE (revision) ON public.pocket_handover_release_entries
  TO pocket_handover_authority_owner;
GRANT SELECT, INSERT, UPDATE ON public.pocket_handover_release_pointers
  TO pocket_handover_authority_owner;
GRANT EXECUTE ON FUNCTION public.pocket_handover_db_can_access(TEXT,TEXT,TEXT)
  TO pocket_handover_authority_owner;

-- Explicitly eliminate the historically demonstrated bypass.
REVOKE INSERT, UPDATE ON public.pocket_handover_release_pointers
  FROM pocket_handover_publisher, pocket_handover_stager, pocket_handover_reader, PUBLIC;

-- These two functions are the only runtime authority entrypoints.
-- The caller controls neither their definer nor their trusted login binding.
CREATE FUNCTION public.pocket_handover_claim_receipt(
  p_receipt TEXT, p_secret TEXT, p_manifest TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $p349_claim$
DECLARE r public.pocket_handover_approval_receipts%ROWTYPE;
BEGIN
  IF p_receipt IS NULL OR p_secret IS NULL OR p_manifest IS NULL
      OR octet_length(p_manifest) > 2097152 THEN
    RETURN 'denied';
  END IF;
  SELECT * INTO r FROM public.pocket_handover_approval_receipts
    WHERE receipt_id=p_receipt FOR UPDATE;
  IF NOT FOUND OR r.status <> 'approved' OR r.expires_at <= clock_timestamp()
      OR r.principal_login <> SESSION_USER::name
      OR NOT public.pocket_handover_db_can_access(r.owner_id,r.resource_id,'publish')
      OR r.secret_sha256 <> encode(sha256(convert_to(p_secret,'UTF8')),'hex')
      OR r.manifest_sha256 <> encode(sha256(convert_to(p_manifest,'UTF8')),'hex')
  THEN RETURN 'denied'; END IF;
  UPDATE public.pocket_handover_approval_receipts
    SET status='claimed',claimed_at=clock_timestamp()
    WHERE receipt_id=p_receipt AND status='approved';
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  RETURN 'claimed';
END;
$p349_claim$;

CREATE FUNCTION public.pocket_handover_publish_claimed(
  p_receipt TEXT, p_secret TEXT, p_manifest TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $p349_publish$
DECLARE
  r public.pocket_handover_approval_receipts%ROWTYPE;
  names TEXT[] := ARRAY[
    'pocket.architecture-grammar','pocket.continuity','pocket.current-state',
    'pocket.current-task','pocket.how-we-build','pocket.interaction-change-model',
    'pocket.last-report','pocket.start-here','pocket.task-ledger'];
  doc JSONB;
  m JSONB;
  entry RECORD;
  i INTEGER;
  new_revision BIGINT;
BEGIN
  IF p_receipt IS NULL OR p_secret IS NULL OR p_manifest IS NULL
      OR octet_length(p_manifest) > 2097152 THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid-arguments');
  END IF;

  SELECT * INTO r FROM public.pocket_handover_approval_receipts
    WHERE receipt_id=p_receipt FOR UPDATE;
  IF NOT FOUND OR r.status <> 'claimed'
      OR r.principal_login <> SESSION_USER::name
      OR NOT public.pocket_handover_db_can_access(r.owner_id,r.resource_id,'publish')
      OR r.secret_sha256 <> encode(sha256(convert_to(p_secret,'UTF8')),'hex')
  THEN
    RETURN jsonb_build_object('ok',false,'reason','approval-not-claimed');
  END IF;

  -- Terminalise known denials inside a COMMITTABLE transaction: no exception
  -- should restore a claimed receipt after a normal business denial.
  IF r.expires_at <= clock_timestamp()
      OR r.claimed_at < clock_timestamp() - interval '60 seconds'
      OR r.manifest_sha256 <> encode(sha256(convert_to(p_manifest,'UTF8')),'hex')
  THEN
    UPDATE public.pocket_handover_approval_receipts SET status='settled',
      settled_at=clock_timestamp() WHERE receipt_id=p_receipt;
    RETURN jsonb_build_object('ok',false,'reason','expired-or-mismatched');
  END IF;
  BEGIN
    m := p_manifest::jsonb;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.pocket_handover_approval_receipts SET status='settled',
      settled_at=clock_timestamp() WHERE receipt_id=p_receipt;
    RETURN jsonb_build_object('ok',false,'reason','invalid-manifest');
  END;
  IF jsonb_typeof(m) <> 'object' OR m->>'releaseId' IS DISTINCT FROM r.release_id
      OR m->>'authorityEpoch' IS DISTINCT FROM 'GOOGLE_ONLY'
      OR jsonb_typeof(m->'documents') <> 'array'
      OR jsonb_array_length(m->'documents') <> 9
  THEN
    UPDATE public.pocket_handover_approval_receipts SET status='settled',
      settled_at=clock_timestamp() WHERE receipt_id=p_receipt;
    RETURN jsonb_build_object('ok',false,'reason','invalid-manifest');
  END IF;

  FOR i IN 1..9 LOOP
    doc := m->'documents'->(i-1);
    IF jsonb_typeof(doc) <> 'object'
        OR doc->>'name' IS DISTINCT FROM names[i]
        OR doc->>'releaseId' IS DISTINCT FROM r.release_id
        OR doc->>'digest' !~ '^[a-f0-9]{64}$'
    THEN
      UPDATE public.pocket_handover_approval_receipts SET status='settled',
        settled_at=clock_timestamp() WHERE receipt_id=p_receipt;
      RETURN jsonb_build_object('ok',false,'reason','invalid-manifest');
    END IF;
    SELECT name,kind,content,sha256,revision INTO entry
      FROM public.pocket_handover_release_entries
      WHERE owner_id=r.owner_id AND resource_id=r.resource_id
        AND release_id=r.release_id AND name=names[i] FOR SHARE;
    IF NOT FOUND OR entry.kind <> 'document' OR entry.revision <> 1
        OR entry.sha256 IS DISTINCT FROM doc->>'digest'
        OR entry.sha256 <> encode(sha256(convert_to(entry.content,'UTF8')),'hex')
    THEN
      UPDATE public.pocket_handover_approval_receipts SET status='settled',
        settled_at=clock_timestamp() WHERE receipt_id=p_receipt;
      RETURN jsonb_build_object('ok',false,'reason','incomplete-release');
    END IF;
  END LOOP;
  IF r.expected_revision=0 THEN
    INSERT INTO public.pocket_handover_release_pointers
      (owner_id,resource_id,release_id,content,revision,updated_at)
      VALUES (r.owner_id,r.resource_id,r.release_id,p_manifest,1,clock_timestamp())
      ON CONFLICT DO NOTHING RETURNING revision INTO new_revision;
  ELSE
    UPDATE public.pocket_handover_release_pointers
      SET release_id=r.release_id,content=p_manifest,
          revision=revision+1,updated_at=clock_timestamp()
      WHERE owner_id=r.owner_id AND resource_id=r.resource_id
        AND revision=r.expected_revision
        AND revision < 9007199254740991
      RETURNING revision INTO new_revision;
  END IF;
  UPDATE public.pocket_handover_approval_receipts
    SET status='settled',settled_at=clock_timestamp()
    WHERE receipt_id=p_receipt;
  IF new_revision IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','revision-conflict');
  END IF;
  RETURN jsonb_build_object('ok',true,'releaseId',r.release_id,
    'revision',new_revision);
END;
$p349_publish$;

ALTER FUNCTION public.pocket_handover_claim_receipt(TEXT,TEXT,TEXT)
  OWNER TO pocket_handover_authority_owner;
ALTER FUNCTION public.pocket_handover_publish_claimed(TEXT,TEXT,TEXT)
  OWNER TO pocket_handover_authority_owner;
REVOKE ALL ON FUNCTION public.pocket_handover_claim_receipt(TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pocket_handover_publish_claimed(TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pocket_handover_claim_receipt(TEXT,TEXT,TEXT)
  TO pocket_handover_publisher;
GRANT EXECUTE ON FUNCTION public.pocket_handover_publish_claimed(TEXT,TEXT,TEXT)
  TO pocket_handover_publisher;
COMMIT;
