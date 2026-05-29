-- Currently bounces.contact_id is ON DELETE CASCADE — if we delete a
-- bounced contact (which the user explicitly wants — "remove it from the
-- application as well") the bounce audit record gets wiped too. That's
-- bad: we lose the diagnostic and the failed-recipient history.
--
-- Switch to ON DELETE SET NULL so bounces survive contact deletion. The
-- bounce row keeps failed_recipient + diagnostic + smtp_status, just with
-- contact_id=NULL once the contact is removed.

ALTER TABLE bounces DROP CONSTRAINT IF EXISTS bounces_contact_id_fkey;

ALTER TABLE bounces
  ADD CONSTRAINT bounces_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;

-- Reload PostgREST schema cache so this constraint change is reflected
-- in any cached lookups.
NOTIFY pgrst, 'reload schema';
