-- Bounces: when a mailer-daemon DSN comes back saying the recipient
-- address is bad (hard bounce) or the recipient server timed out / mailbox
-- full / etc (soft bounce), we record it here instead of polluting the
-- replies table, and we mark the contact so the system stops trying to
-- send to that address.
--
-- Hard bounce  → contacts.email_status='bounced', skip_reason='hard_bounce'
--                + cancel all pending/approved sends for that contact
-- Soft bounce  → same treatment (be aggressive — preserves Gmail rep)
--                user can manually "Restore" from /bounces if needed

CREATE TABLE IF NOT EXISTS bounces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id         uuid REFERENCES public.sends(id) ON DELETE CASCADE,
  contact_id      uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  bounce_type     text NOT NULL CHECK (bounce_type IN ('hard', 'soft', 'unknown')),
  failed_recipient text,                       -- the actual address that bounced (parsed from DSN body)
  smtp_status     text,                        -- e.g. "5.1.1" or "4.4.7"
  diagnostic      text,                        -- short human-readable reason
  from_daemon     text,                        -- e.g. "mailer-daemon@googlemail.com"
  raw_body        text,                        -- first 4KB of bounce body, for debugging
  received_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bounces_contact_id ON bounces (contact_id);
CREATE INDEX IF NOT EXISTS idx_bounces_send_id ON bounces (send_id);
CREATE INDEX IF NOT EXISTS idx_bounces_received_at ON bounces (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_bounces_type ON bounces (bounce_type);

-- Prevent duplicate rows if the same DSN gets re-polled (e.g. --since 0).
-- Unique on (send_id, smtp_status, day-bucketed received_at) so we can
-- re-run without exploding the table, but still let a second-day soft-bounce
-- escalation record a fresh row.
--
-- We MUST use ((received_at AT TIME ZONE 'UTC')::date) instead of the
-- shorter (received_at::date) — the latter depends on the session timezone
-- and Postgres rejects volatile expressions in index definitions with
-- "42P17: functions in index expression must be marked IMMUTABLE".
-- The AT TIME ZONE 'UTC' fixes the timezone so the cast becomes immutable.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bounces_send_status_day
  ON bounces (send_id, smtp_status, ((received_at AT TIME ZONE 'UTC')::date))
  WHERE send_id IS NOT NULL;

-- CRITICAL when applying via Supabase SQL Editor: PostgREST caches the
-- schema on startup and won't expose the new table to the REST API until
-- it gets this signal (or its ~10-min auto-refresh kicks in). Without
-- this you'd hit "Could not find the table 'public.bounces' in the
-- schema cache" on every dashboard call.
NOTIFY pgrst, 'reload schema';
