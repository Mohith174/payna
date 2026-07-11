// Constraints + indexes for the Payna graph (docs/SPEC.md §2).
// Idempotent: IF NOT EXISTS makes this safe to re-run.

CREATE CONSTRAINT state_code_unique IF NOT EXISTS FOR (s:State) REQUIRE s.code IS UNIQUE;
CREATE CONSTRAINT license_type_id_unique IF NOT EXISTS FOR (l:LicenseType) REQUIRE l.id IS UNIQUE;
CREATE CONSTRAINT requirement_id_unique IF NOT EXISTS FOR (r:Requirement) REQUIRE r.id IS UNIQUE;
CREATE CONSTRAINT entity_id_unique IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE;
CREATE CONSTRAINT cadence_id_unique IF NOT EXISTS FOR (c:Cadence) REQUIRE c.id IS UNIQUE;

CREATE INDEX requirement_name_index IF NOT EXISTS FOR (r:Requirement) ON (r.name);
