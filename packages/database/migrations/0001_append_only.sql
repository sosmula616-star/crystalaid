-- audit_log and token_ledger are append-only: corrections are new rows.
CREATE FUNCTION reject_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
--> statement-breakpoint
CREATE TRIGGER token_ledger_append_only
  BEFORE UPDATE OR DELETE ON token_ledger
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
