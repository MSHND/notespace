-- P349 candidate-only ownership and privilege proposal.
-- DORMANT: never registered by pocket-sync-db-migrate.js; NOT applied on Render.
-- Database trust boundary: authenticated session_user is a separate LOGIN
-- provisioned and bound by DB administration AFTER independently verified JWT
-- ownership. No caller text, SET ROLE or custom GUC is tenant authority.
--
-- STOP/GATE: production currently uses shared service connections. This
-- model requires independently verified per-principal DB authentication/
-- dedicated pools OR a separately designed trusted broker. It is NOT safe
-- to enable with a pooled shared owner-capable PostgreSQL login.
--
-- STOP/GATE: publisher role has direct pointer INSERT/UPDATE capability,
-- which could bypass the application's separate human approval and 9-row
-- verification if those database credentials are misused. This is not
-- production-ready publication authorisation; a future approved, restricted
-- DB-side publish entrypoint/receipt boundary is necessary before cutover.
--
-- This proposal changes only the new dormant P349 release tables.
CREATE ROLE pocket_handover_reader NOLOGIN;
CREATE ROLE pocket_handover_stager NOLOGIN;
CREATE ROLE pocket_handover_publisher NOLOGIN;

CREATE TABLE public.pocket_handover_role_bindings (
  db_login NAME PRIMARY KEY,
  owner_id TEXT NOT NULL CHECK (owner_id ~ '^[a-z][a-z0-9._:-]{0,127}$'),
  resource_id TEXT NOT NULL CHECK (resource_id ~ '^[a-z][a-z0-9._:-]{0,127}$'),
  capability TEXT NOT NULL CHECK (capability IN ('reader', 'stager', 'publisher'))
);

REVOKE ALL ON public.pocket_handover_release_entries FROM PUBLIC;
REVOKE ALL ON public.pocket_handover_release_pointers FROM PUBLIC;
REVOKE ALL ON public.pocket_handover_role_bindings FROM PUBLIC;

-- Locked-down definer exists only to query administrator-owned DB bindings.
-- No mutable session GUC or SET ROLE-derived current_user is trusted.
-- Owner/superuser retains control of binding rows (explicit unproved admin
-- threat); no read/write grant to a runtime principal on this table.
CREATE FUNCTION public.pocket_handover_db_can_access(
  desired_owner TEXT, desired_resource TEXT, required_capability TEXT
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $p349$
  SELECT EXISTS (
    SELECT 1
    FROM public.pocket_handover_role_bindings AS binding
    WHERE binding.db_login = SESSION_USER::name
      AND binding.owner_id = desired_owner
      AND binding.resource_id = desired_resource
      AND (
        (required_capability = 'read' AND
          binding.capability IN ('reader','stager','publisher'))
        OR (required_capability = 'stage' AND binding.capability = 'stager')
        OR (required_capability = 'publish' AND binding.capability = 'publisher')
      )
  );
$p349$;
REVOKE ALL ON FUNCTION public.pocket_handover_db_can_access(TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pocket_handover_db_can_access(TEXT,TEXT,TEXT)
  TO pocket_handover_reader, pocket_handover_stager, pocket_handover_publisher;

ALTER TABLE public.pocket_handover_release_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pocket_handover_release_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pocket_handover_release_pointers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pocket_handover_release_pointers FORCE ROW LEVEL SECURITY;

CREATE POLICY p349_entries_read ON public.pocket_handover_release_entries
  FOR SELECT USING (
    public.pocket_handover_db_can_access(owner_id,resource_id,'read'));
CREATE POLICY p349_entries_stage ON public.pocket_handover_release_entries
  FOR INSERT WITH CHECK (
    public.pocket_handover_db_can_access(owner_id,resource_id,'stage'));
-- No UPDATE or DELETE policy, grant or API for immutable snapshots.

CREATE POLICY p349_pointers_read ON public.pocket_handover_release_pointers
  FOR SELECT USING (
    public.pocket_handover_db_can_access(owner_id,resource_id,'read'));
CREATE POLICY p349_pointers_publish_insert ON public.pocket_handover_release_pointers
  FOR INSERT WITH CHECK (
    public.pocket_handover_db_can_access(owner_id,resource_id,'publish'));
CREATE POLICY p349_pointers_publish_update ON public.pocket_handover_release_pointers
  FOR UPDATE USING (
    public.pocket_handover_db_can_access(owner_id,resource_id,'publish'))
  WITH CHECK (
    public.pocket_handover_db_can_access(owner_id,resource_id,'publish'));

-- Stage and publish are intentionally distinct database roles.
-- Reading staged entries during atomic publication is required.
GRANT SELECT ON public.pocket_handover_release_entries
  TO pocket_handover_reader, pocket_handover_stager, pocket_handover_publisher;
GRANT INSERT ON public.pocket_handover_release_entries
  TO pocket_handover_stager;
GRANT SELECT ON public.pocket_handover_release_pointers
  TO pocket_handover_reader, pocket_handover_stager, pocket_handover_publisher;
GRANT INSERT, UPDATE ON public.pocket_handover_release_pointers
  TO pocket_handover_publisher;

-- No runtime role may change role_bindings. Dedicated LOGIN role provisioning,
-- explicit memberships, service credential scoping, and binding admission
-- require separately authorised migration/deployment design.
