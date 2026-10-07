CREATE TABLE IF NOT EXISTS public.pocket_project_documents (
  name TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  revision BIGINT NOT NULL CHECK (revision >= 1 AND revision <= 9007199254740991),
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT pocket_project_documents_name_check CHECK (
    char_length(name) BETWEEN 1 AND 120
    AND name ~ '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$'
  ),
  CONSTRAINT pocket_project_documents_content_bytes_check CHECK (
    octet_length(content) <= 2097152
  )
);

INSERT INTO public.pocket_sync_schema (schema_name, schema_version)
VALUES ('pocket-project-documents', 1)
ON CONFLICT (schema_name) DO NOTHING;
