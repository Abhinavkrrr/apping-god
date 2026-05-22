-- ============================================================
-- pg_cron schedules for autonomous reply detection + follow-ups
-- ============================================================
-- After this migration runs:
--   • reply-poller fires every 5 min       → detect + classify replies
--   • followup-daemon fires every 15 min   → generate next follow-up step
--
-- No more manual triggers needed. The system runs 24/7.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Helper: store the service-role JWT as a Vault secret so we don't
-- hardcode it inside cron job bodies.
DO $$
DECLARE
  existing_id UUID;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'apping_service_role_jwt';
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91emZyZWZuaGx4aHBleXVmbGx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTQ2NDY5MiwiZXhwIjoyMDk1MDQwNjkyfQ.rkw2PUhv0cTGO3XGlHhYrZooW-TUZwKMKCVJsn8TGS8',
      'apping_service_role_jwt',
      'Service-role JWT for Edge Function invocations from pg_cron'
    );
  END IF;
END $$;

-- ----- Reply poller (every 5 min) -----
SELECT cron.unschedule('apping-reply-poller')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apping-reply-poller');

SELECT cron.schedule(
  'apping-reply-poller',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ouzfrefnhlxhpeyufllt.functions.supabase.co/reply-poller',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'apping_service_role_jwt' LIMIT 1),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- ----- Follow-up daemon (every 15 min) -----
SELECT cron.unschedule('apping-followup-daemon')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apping-followup-daemon');

SELECT cron.schedule(
  'apping-followup-daemon',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ouzfrefnhlxhpeyufllt.functions.supabase.co/followup-daemon',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'apping_service_role_jwt' LIMIT 1),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- ----- Optional: dispatch-approved (every 5 min — drains approved queue) -----
-- This way "scheduled for tomorrow" sends fire as soon as scheduled_at hits,
-- without needing the GitHub Action.
-- We still keep the GitHub Action as a backup.
-- (Commented out by default; uncomment if you want continuous dispatch.)
-- SELECT cron.schedule(
--   'apping-dispatch-approved',
--   '*/5 * * * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://ouzfrefnhlxhpeyufllt.functions.supabase.co/dispatch-approved',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'apping_service_role_jwt' LIMIT 1),
--       'Content-Type', 'application/json'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
