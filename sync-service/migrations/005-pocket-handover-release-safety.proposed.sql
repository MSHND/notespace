-- P349xf candidate-only schema proposal. Intentionally NOT registered in production
-- pocket-sync-db-migrate.js or connected to the existing project-document MCP.
-- A later separately approved migration must verify DB roles/grants and tenant binding.
CREATE TABLE IF NOT EXISTS public.pocket_handover_release_entries (
  owner_id TEXT NOT NULL CHECK (owner_id ~ '^[a-z][a-z0-9._:-]{0,127}$'),
  resource_id TEXT NOT NULL CHECK (resource_id ~ '^[a-z][a-z0-9._:-]{0,127}$'),
  release_id TEXT NOT NULL CHECK (release_id ~ '^r[0-9]{1,18}$'),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120
    AND name ~ '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$'),
  kind TEXT NOT NULL CHECK (kind IN ('document','evidence')),
  content TEXT NOT NULL CHECK (octet_length(content) <= 2097152),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision = 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, resource_id, release_id, name)
);

-- Protect committed AND orphaned generations/evidence against UPDATE and DELETE,
-- including attempts using a generic project-document writer.
CREATE OR REPLACE FUNCTION public.pocket_handover_entry_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Pocket handover generation/evidence is immutable';
END;
$$;
DROP TRIGGER IF EXISTS pocket_handover_entries_immutable
  ON public.pocket_handover_release_entries;
CREATE TRIGGER pocket_handover_entries_immutable
  BEFORE UPDATE OR DELETE ON public.pocket_handover_release_entries
  FOR EACH ROW EXECUTE FUNCTION public.pocket_handover_entry_immutable();

CREATE TABLE IF NOT EXISTS public.pocket_handover_release_pointers (
  owner_id TEXT NOT NULL CHECK (owner_id ~ '^[a-z][a-z0-9._:-]{0,127}$'),
  resource_id TEXT NOT NULL CHECK (resource_id ~ '^[a-z][a-z0-9._:-]{0,127}$'),
  release_id TEXT NOT NULL CHECK (release_id ~ '^r[0-9]{1,18}$'),
  content TEXT NOT NULL CHECK (octet_length(content) <= 2097152),
  revision BIGINT NOT NULL CHECK (revision >= 1 AND revision <= 9007199254740991),
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_id, resource_id)
);

-- No grant or new API is created here. DB role-level pointer privileges,
-- approver identity/replay protection, and real migration are later gates.
