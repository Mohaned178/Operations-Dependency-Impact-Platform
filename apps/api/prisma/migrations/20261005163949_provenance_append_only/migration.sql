-- Provenance tables are append-only (research R16)

CREATE FUNCTION forbid_provenance_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER source_records_append_only
BEFORE UPDATE OR DELETE ON source_records
FOR EACH ROW EXECUTE FUNCTION forbid_provenance_mutation();

CREATE TRIGGER source_records_append_only_truncate
BEFORE TRUNCATE ON source_records
FOR EACH STATEMENT EXECUTE FUNCTION forbid_provenance_mutation();

CREATE TRIGGER state_observations_append_only
BEFORE UPDATE OR DELETE ON state_observations
FOR EACH ROW EXECUTE FUNCTION forbid_provenance_mutation();

CREATE TRIGGER state_observations_append_only_truncate
BEFORE TRUNCATE ON state_observations
FOR EACH STATEMENT EXECUTE FUNCTION forbid_provenance_mutation();
