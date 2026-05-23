-- ============================================================
-- Hardening migration (post audit)
-- ============================================================
-- - Case-insensitive uniqueness on contacts.email so future direct-SQL
--   inserts can't slip in duplicates like "Foo@x.com" + "foo@x.com".
-- - Composite uniqueness on replies so concurrent reply-poller runs
--   can't double-insert the same reply.
-- ============================================================

-- 1) Contacts: enforce case-insensitive uniqueness at the DB layer.
-- The original UNIQUE on email is already case-sensitive; this adds a
-- functional index for lower(email) and lets us rely on it for
-- application-level upserts.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_ci_unique
  ON public.contacts (lower(email));

-- 2) Replies dedup. Same Gmail message could be polled twice if reply-poller
-- runs concurrently (manual + cron). Composite unique catches it.
DELETE FROM public.replies r
  USING public.replies r2
  WHERE r.id > r2.id
    AND r.send_id IS NOT DISTINCT FROM r2.send_id
    AND r.received_at IS NOT DISTINCT FROM r2.received_at
    AND r.from_email IS NOT DISTINCT FROM r2.from_email;

CREATE UNIQUE INDEX IF NOT EXISTS replies_dedup_unique
  ON public.replies (send_id, received_at, from_email)
  WHERE send_id IS NOT NULL;
