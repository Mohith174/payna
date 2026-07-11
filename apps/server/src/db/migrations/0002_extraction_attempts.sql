CREATE TABLE extraction_attempts (
  id bigserial PRIMARY KEY,
  document_name text,
  document_sha256 text,
  model text,
  status text CHECK (status IN ('pending', 'succeeded', 'failed', 'rejected')),
  raw_response jsonb,
  validated jsonb,
  error text,
  attempt_no int,
  created_at timestamptz DEFAULT now()
);
