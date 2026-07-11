CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  actor text,
  action text,
  subject_type text,
  subject_id text,
  detail jsonb,
  created_at timestamptz DEFAULT now()
);
