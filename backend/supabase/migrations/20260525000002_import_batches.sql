-- Import batches: tag every contact with the import operation that brought
-- them in. Lets the Approve queue filter by batch (e.g. "only show me the
-- 100 wealth-mgmt contacts I imported on 2026-05-25") without losing the
-- ability to see everything at once.

CREATE TABLE IF NOT EXISTS import_batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,                       -- human label: "wealth_mgmt_2026-05-25.csv" or "Discover · LIQID"
  source       text NOT NULL,                       -- 'csv' | 'discover' | 'quick_add' | 'legacy'
  file_name    text,                                -- original upload filename, if any
  notes        text,
  contact_count int NOT NULL DEFAULT 0,             -- materialized count, kept fresh by triggers below
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_batches_created_at ON import_batches (created_at DESC);

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES import_batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_import_batch ON contacts (import_batch_id);

-- Backfill: any contact created before this migration goes into a single
-- "Legacy / Pre-batch import" placeholder so the UI can still group them.
DO $$
DECLARE legacy_id uuid;
BEGIN
  -- Only create the legacy bucket if we actually have orphaned contacts
  IF EXISTS (SELECT 1 FROM contacts WHERE import_batch_id IS NULL LIMIT 1) THEN
    INSERT INTO import_batches (name, source, notes)
    VALUES ('Legacy (pre-batch)', 'legacy', 'Contacts imported before import_batches table existed.')
    RETURNING id INTO legacy_id;
    UPDATE contacts SET import_batch_id = legacy_id WHERE import_batch_id IS NULL;
  END IF;
END $$;

-- Trigger: keep contact_count materialized so the Approve filter UI never
-- has to do COUNT(*) GROUP BY on every render.
CREATE OR REPLACE FUNCTION trg_import_batch_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.import_batch_id IS NOT NULL THEN
    UPDATE import_batches SET contact_count = contact_count + 1 WHERE id = NEW.import_batch_id;
  ELSIF TG_OP = 'DELETE' AND OLD.import_batch_id IS NOT NULL THEN
    UPDATE import_batches SET contact_count = contact_count - 1 WHERE id = OLD.import_batch_id;
  ELSIF TG_OP = 'UPDATE' AND COALESCE(OLD.import_batch_id::text, '') <> COALESCE(NEW.import_batch_id::text, '') THEN
    IF OLD.import_batch_id IS NOT NULL THEN
      UPDATE import_batches SET contact_count = contact_count - 1 WHERE id = OLD.import_batch_id;
    END IF;
    IF NEW.import_batch_id IS NOT NULL THEN
      UPDATE import_batches SET contact_count = contact_count + 1 WHERE id = NEW.import_batch_id;
    END IF;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contacts_batch_count_trg ON contacts;
CREATE TRIGGER contacts_batch_count_trg
AFTER INSERT OR UPDATE OF import_batch_id OR DELETE ON contacts
FOR EACH ROW EXECUTE FUNCTION trg_import_batch_count();

-- Initial backfill of contact_count
UPDATE import_batches b
SET contact_count = (SELECT count(*) FROM contacts c WHERE c.import_batch_id = b.id);
