ALTER TABLE public.pocket_sync_records
  DROP CONSTRAINT IF EXISTS pocket_sync_records_collection_check;

ALTER TABLE public.pocket_sync_records
  ADD CONSTRAINT pocket_sync_records_collection_check CHECK (
    collection IN (
      'accounts', 'credentials', 'sessions', 'ceremonies', 'pockets', 'operations',
      'keySets', 'envelopes', 'recoveryLocators', 'recoveryCeremonies', 'keyOperations',
      'persistenceAuthorities'
    )
  );

INSERT INTO public.pocket_sync_records (collection, record_key, store_version, record)
SELECT
  'persistenceAuthorities',
  record_key,
  1,
  jsonb_build_object(
    'kind', 'pocket.sync.persistence-authority',
    'schemaVersion', 1,
    'storeVersion', 1,
    'accountId', record ->> 'accountId',
    'syncedPocketId', record_key,
    'authorityRevision', 1,
    'currentMode', 'whole-record',
    'transition', NULL,
    'rollbackRevision', NULL,
    'adoptionHead', NULL
  )
FROM public.pocket_sync_records
WHERE collection = 'pockets'
ON CONFLICT (collection, record_key) DO NOTHING;

INSERT INTO public.pocket_sync_schema (schema_name, schema_version)
VALUES ('pocket-sync-persistence-authority', 1)
ON CONFLICT (schema_name) DO NOTHING;
