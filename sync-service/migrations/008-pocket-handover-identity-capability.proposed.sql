-- P349 TEST-ONLY 008: verified synthetic identity -> DB-scoped capabilities.
-- DORMANT. Not in production migrator. Depends on proposed 005,006,007.
-- Administrator alone provisions binding rows after independent approved policy.
-- Issuer service login can issue matching capabilities, NOT alter bindings,
-- receipts, pointers or release entries. Executor can verify, NOT issue.
-- JWT signature verification happens outside PostgreSQL in the trusted broker.
-- This is NOT live owner authentication or human approval.

BEGIN;
-- Existing 007 synthetic receipts bind a database login, but a new scoped
-- approval must also match the exact verified principal before SPENT.
-- Nullable only to preserve pre-008 historical fixture rows; the new scoped
-- admission ALWAYS rejects NULL.
ALTER TABLE public.pocket_handover_approval_receipts
  ADD COLUMN principal_id TEXT;
CREATE ROLE pocket_handover_capability_issuer NOLOGIN;
CREATE ROLE pocket_handover_capability_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;

CREATE TABLE public.pocket_handover_principal_bindings (
  principal_id TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  owner_id TEXT NOT NULL CHECK (owner_id ~ '^[a-z][a-z0-9._:-]{0,127}$'),
  resource_id TEXT NOT NULL CHECK (resource_id ~ '^[a-z][a-z0-9._:-]{0,127}$'),
  db_login NAME NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('read','stage','publish')),
  approved BOOLEAN NOT NULL CHECK (approved),
  revoked BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (issuer,subject,operation)
);
CREATE TABLE public.pocket_handover_scoped_capabilities (
  capability_id TEXT PRIMARY KEY CHECK (capability_id ~ '^cap[a-f0-9]{32}$'),
  secret_sha256 TEXT NOT NULL CHECK (secret_sha256 ~ '^[a-f0-9]{64}$'),
  -- Immutable originating identity. An unrelated policy row with the same
  -- principal/owner/resource may NEVER rescue this capability.
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  db_login NAME NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('read','stage','publish')),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.pocket_handover_principal_bindings FROM PUBLIC;
REVOKE ALL ON public.pocket_handover_scoped_capabilities FROM PUBLIC;
GRANT SELECT ON public.pocket_handover_principal_bindings
  TO pocket_handover_capability_owner;
GRANT SELECT,INSERT ON public.pocket_handover_scoped_capabilities
  TO pocket_handover_capability_owner;

-- Protected issuance. Supplied claims are not authenticated BY SQL: only
-- the separate broker may call this function after cryptographic JWT proof.
-- The table independently limits issuer to preapproved exact scope.
CREATE FUNCTION public.pocket_handover_issue_capability(
  p_issuer TEXT,p_subject TEXT,p_principal TEXT,p_owner TEXT,p_resource TEXT,
  p_login NAME,p_operation TEXT,p_id TEXT,p_digest TEXT,p_expiry TIMESTAMPTZ
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $p349_issue$
BEGIN
  IF p_id IS NULL OR p_id !~ '^cap[a-f0-9]{32}$'
     OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$'
     OR p_expiry IS NULL OR p_expiry <= clock_timestamp()
     OR p_expiry > clock_timestamp() + interval '60 seconds'
     OR NOT EXISTS (
       SELECT 1 FROM public.pocket_handover_principal_bindings b
       WHERE b.issuer=p_issuer AND b.subject=p_subject
         AND b.principal_id=p_principal AND b.owner_id=p_owner
         AND b.resource_id=p_resource AND b.db_login=p_login
         AND b.operation=p_operation AND b.approved=true AND b.revoked=false
     )
  THEN RETURN false; END IF;
  INSERT INTO public.pocket_handover_scoped_capabilities
    (capability_id,secret_sha256,issuer,subject,principal_id,owner_id,
     resource_id,db_login,operation,expires_at)
  VALUES(p_id,p_digest,p_issuer,p_subject,p_principal,p_owner,p_resource,
    p_login,p_operation,p_expiry);
  RETURN true;
END;
$p349_issue$;

-- This function independently establishes the database operation scope.
-- SESSION_USER must equal the preapproved executor login; caller-supplied
-- owner/resource/operation do not confer rights.
CREATE FUNCTION public.pocket_handover_check_capability(
  p_id TEXT,p_secret TEXT,p_principal TEXT,p_owner TEXT,p_resource TEXT,
  p_operation TEXT
) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $p349_check$
  SELECT EXISTS(
    SELECT 1
    FROM public.pocket_handover_scoped_capabilities c
    JOIN public.pocket_handover_principal_bindings b
      ON b.issuer=c.issuer AND b.subject=c.subject
      AND b.principal_id=c.principal_id
      AND b.owner_id=c.owner_id AND b.resource_id=c.resource_id
      AND b.db_login=c.db_login AND b.operation=c.operation
    WHERE c.capability_id=p_id
      AND c.secret_sha256=pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(p_secret,'UTF8')),'hex')
      AND c.principal_id=p_principal
      AND c.owner_id=p_owner AND c.resource_id=p_resource
      AND c.operation=p_operation AND c.db_login=SESSION_USER::name
      AND c.revoked=false AND c.expires_at>clock_timestamp()
      AND b.approved=true AND b.revoked=false
  );
$p349_check$;

ALTER FUNCTION public.pocket_handover_issue_capability(
  TEXT,TEXT,TEXT,TEXT,TEXT,NAME,TEXT,TEXT,TEXT,TIMESTAMPTZ)
  OWNER TO pocket_handover_capability_owner;
ALTER FUNCTION public.pocket_handover_check_capability(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
  OWNER TO pocket_handover_capability_owner;
REVOKE ALL ON FUNCTION public.pocket_handover_issue_capability(
  TEXT,TEXT,TEXT,TEXT,TEXT,NAME,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pocket_handover_check_capability(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pocket_handover_issue_capability(
  TEXT,TEXT,TEXT,TEXT,TEXT,NAME,TEXT,TEXT,TEXT,TIMESTAMPTZ)
  TO pocket_handover_capability_issuer;
GRANT EXECUTE ON FUNCTION public.pocket_handover_check_capability(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
  TO pocket_handover_publication_executor,
     pocket_handover_reader,pocket_handover_stager,pocket_handover_publisher;

-- PostgreSQL 007 remains a historical pre-008 definition. Its unscoped
-- admission route must not be executable by a runtime role after 008.
REVOKE EXECUTE ON FUNCTION public.pocket_handover_spend_receipt(
  TEXT,TEXT,TEXT) FROM pocket_handover_publication_executor;

-- Protected definer only: FOR SHARE needs column UPDATE permission, but
-- no ordinary login inherits pocket_handover_authority_owner.
GRANT SELECT ON public.pocket_handover_scoped_capabilities
  TO pocket_handover_authority_owner;
GRANT UPDATE (revoked) ON public.pocket_handover_scoped_capabilities
  TO pocket_handover_authority_owner;
GRANT SELECT ON public.pocket_handover_principal_bindings
  TO pocket_handover_authority_owner;
GRANT UPDATE (revoked) ON public.pocket_handover_principal_bindings
  TO pocket_handover_authority_owner;

-- An approval SPENT before later revocation stays SPENT. That admitted
-- one-shot execution may continue; it is not retroactively cancelled.
-- Revocation committed before this protected admission MUST deny.
CREATE FUNCTION public.pocket_handover_spend_receipt_scoped(
  p_receipt TEXT,p_secret TEXT,p_manifest TEXT,
  p_cap_id TEXT,p_cap_secret TEXT
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $p349_scoped_admission$
DECLARE
  r public.pocket_handover_approval_receipts%ROWTYPE;
  c public.pocket_handover_scoped_capabilities%ROWTYPE;
  b public.pocket_handover_principal_bindings%ROWTYPE;
BEGIN
  IF p_receipt IS NULL OR p_secret IS NULL OR p_manifest IS NULL
     OR p_cap_id IS NULL OR p_cap_secret IS NULL
     OR octet_length(p_manifest)>2097152 THEN RETURN 'denied'; END IF;
  SELECT * INTO r FROM public.pocket_handover_approval_receipts
    WHERE receipt_id=p_receipt FOR UPDATE;
  IF NOT FOUND OR r.status <> 'approved' OR r.expires_at <= clock_timestamp()
      OR r.principal_login <> SESSION_USER::name
      OR r.secret_sha256 <> encode(sha256(convert_to(p_secret,'UTF8')),'hex')
      OR r.manifest_sha256 <> encode(sha256(convert_to(p_manifest,'UTF8')),'hex')
      OR NOT public.pocket_handover_db_can_access(
        r.owner_id,r.resource_id,'publish')
  THEN RETURN 'denied'; END IF;

  SELECT * INTO c FROM public.pocket_handover_scoped_capabilities
    WHERE capability_id=p_cap_id FOR SHARE;
  IF NOT FOUND OR c.revoked OR c.expires_at <= clock_timestamp()
      OR c.operation <> 'publish' OR c.db_login <> SESSION_USER::name
      OR c.owner_id <> r.owner_id OR c.resource_id <> r.resource_id
      OR r.principal_id IS DISTINCT FROM c.principal_id
      OR c.secret_sha256 <> encode(sha256(convert_to(p_cap_secret,'UTF8')),'hex')
  THEN RETURN 'denied'; END IF;

  SELECT * INTO b FROM public.pocket_handover_principal_bindings
    WHERE issuer=c.issuer AND subject=c.subject
      AND principal_id=c.principal_id
      AND owner_id=c.owner_id AND resource_id=c.resource_id
      AND db_login=c.db_login AND operation=c.operation
    FOR SHARE;
  IF NOT FOUND OR b.revoked OR NOT b.approved THEN RETURN 'denied'; END IF;

  UPDATE public.pocket_handover_approval_receipts
    SET status='spent',spent_at=clock_timestamp()
    WHERE receipt_id=p_receipt AND status='approved';
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  RETURN 'spent';
END;
$p349_scoped_admission$;

ALTER FUNCTION public.pocket_handover_spend_receipt_scoped(
  TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO pocket_handover_authority_owner;
REVOKE ALL ON FUNCTION public.pocket_handover_spend_receipt_scoped(
  TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pocket_handover_spend_receipt_scoped(
  TEXT,TEXT,TEXT,TEXT,TEXT) TO pocket_handover_publication_executor;
COMMIT;
