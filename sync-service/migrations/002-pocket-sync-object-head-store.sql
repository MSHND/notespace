CREATE TABLE IF NOT EXISTS public.pocket_sync_objects (
  synced_pocket_id TEXT NOT NULL CHECK (length(synced_pocket_id) > 0),
  storage_ref TEXT NOT NULL CHECK (length(storage_ref) > 0),
  record JSONB NOT NULL,
  CONSTRAINT pocket_sync_objects_pkey PRIMARY KEY (synced_pocket_id, storage_ref),
  CONSTRAINT pocket_sync_objects_record_object_check CHECK (jsonb_typeof(record) = 'object')
);

CREATE TABLE IF NOT EXISTS public.pocket_sync_heads (
  synced_pocket_id TEXT PRIMARY KEY CHECK (length(synced_pocket_id) > 0),
  revision BIGINT NOT NULL CHECK (revision >= 0 AND revision <= 9007199254740991),
  seal_storage_ref TEXT NULL,
  CONSTRAINT pocket_sync_heads_revision_seal_check CHECK (
    (revision = 0 AND seal_storage_ref IS NULL)
    OR (revision > 0 AND seal_storage_ref IS NOT NULL AND length(seal_storage_ref) > 0)
  )
);

INSERT INTO public.pocket_sync_schema (schema_name, schema_version)
VALUES ('pocket-sync-object-head-store', 1)
ON CONFLICT (schema_name) DO NOTHING;
