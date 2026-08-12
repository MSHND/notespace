CREATE TABLE IF NOT EXISTS pocket_sync_records (
  collection TEXT NOT NULL,
  record_key TEXT NOT NULL CHECK (length(record_key) > 0),
  store_version BIGINT NOT NULL CHECK (store_version > 0 AND store_version <= 9007199254740991),
  record JSONB NOT NULL,
  CONSTRAINT pocket_sync_records_pkey PRIMARY KEY (collection, record_key),
  CONSTRAINT pocket_sync_records_collection_check CHECK (
    collection IN (
      'accounts', 'credentials', 'sessions', 'ceremonies', 'pockets', 'operations',
      'keySets', 'envelopes', 'recoveryLocators', 'recoveryCeremonies', 'keyOperations'
    )
  ),
  CONSTRAINT pocket_sync_records_record_object_check CHECK (jsonb_typeof(record) = 'object'),
  CONSTRAINT pocket_sync_records_record_version_check CHECK (
    CASE
      WHEN jsonb_typeof(record -> 'storeVersion') = 'number'
        AND (record ->> 'storeVersion') ~ '^[1-9][0-9]*$'
      THEN (record ->> 'storeVersion')::NUMERIC = store_version
      ELSE FALSE
    END
  )
);

CREATE TABLE IF NOT EXISTS pocket_sync_schema (
  schema_name TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1)
);

INSERT INTO pocket_sync_schema (schema_name, schema_version)
VALUES ('pocket-sync-store', 1)
ON CONFLICT (schema_name) DO NOTHING;
