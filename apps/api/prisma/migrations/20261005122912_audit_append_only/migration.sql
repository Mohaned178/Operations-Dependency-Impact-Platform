CREATE FUNCTION audit_entries_block_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_entries is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_entries_no_update_delete BEFORE UPDATE OR DELETE ON audit_entries
  FOR EACH ROW EXECUTE FUNCTION audit_entries_block_mutation();
CREATE TRIGGER audit_entries_no_truncate BEFORE TRUNCATE ON audit_entries
  FOR EACH STATEMENT EXECUTE FUNCTION audit_entries_block_mutation();
