-- ============================================================
-- APPING GOD — Initial schema migration
-- Creates all 12 tables, indexes, RLS policies, and seed campaigns.
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. COMPANIES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.companies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  domain          TEXT UNIQUE,
  industry        TEXT,
  size_bucket     TEXT,
  recent_news     JSONB,
  brief_one_line  TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS companies_name_unique ON public.companies (lower(name));
CREATE INDEX IF NOT EXISTS companies_industry_idx ON public.companies (industry);

-- ============================================================
-- 2. CONTACTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.contacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  first_name        TEXT NOT NULL,
  last_name         TEXT,
  email             TEXT UNIQUE NOT NULL,
  email_status      TEXT NOT NULL DEFAULT 'unverified'
                      CHECK (email_status IN ('unverified','valid','invalid','risky','bounced')),
  title             TEXT,
  role_type         TEXT CHECK (role_type IN ('HR','HM','employee','founder','partner','other')),
  linkedin_url      TEXT,
  source            TEXT,
  custom_fields     JSONB,
  unsubscribed_at   TIMESTAMPTZ,
  skip_reason       TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contacts_company_id_idx ON public.contacts (company_id);
CREATE INDEX IF NOT EXISTS contacts_email_status_idx ON public.contacts (email_status);
CREATE INDEX IF NOT EXISTS contacts_role_type_idx ON public.contacts (role_type);

-- ============================================================
-- 3. RESUMES (referenced by campaigns)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.resumes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label           TEXT NOT NULL,
  storage_path    TEXT NOT NULL,
  uploaded_at     TIMESTAMPTZ DEFAULT now(),
  is_default      BOOLEAN DEFAULT false
);

-- ============================================================
-- 4. CAMPAIGNS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.campaigns (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     TEXT NOT NULL,
  target_role              TEXT,
  resume_id                UUID REFERENCES public.resumes(id) ON DELETE SET NULL,
  send_window_local_hour   INT NOT NULL DEFAULT 10,
  send_window_local_minute INT NOT NULL DEFAULT 30,
  send_days                INT[] NOT NULL DEFAULT '{1,2,3,4,5}',
  status                   TEXT NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft','active','paused','archived')),
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaigns_status_idx ON public.campaigns (status);

-- ============================================================
-- 5. TEMPLATES (one per (campaign, step) for v1)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.templates (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id              UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
  variant_label            TEXT,
  subject_tmpl             TEXT NOT NULL,
  body_tmpl                TEXT NOT NULL,
  personalization_level    TEXT NOT NULL DEFAULT 'medium'
                             CHECK (personalization_level IN ('light','medium')),
  weight                   INT NOT NULL DEFAULT 1,
  is_followup              BOOLEAN NOT NULL DEFAULT false,
  followup_step            INT,
  created_at               TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS templates_campaign_id_idx ON public.templates (campaign_id);

-- ============================================================
-- 6. SEQUENCES (campaign → ordered list of templates)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sequences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  step_number     INT NOT NULL,
  template_id     UUID NOT NULL REFERENCES public.templates(id) ON DELETE CASCADE,
  delay_days      INT NOT NULL DEFAULT 0,
  UNIQUE (campaign_id, step_number)
);

-- ============================================================
-- 7. ACCOUNTS (Gmail sending pool)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.accounts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                TEXT UNIQUE NOT NULL,
  smtp_password_enc    TEXT NOT NULL,
  imap_password_enc    TEXT NOT NULL,
  daily_cap            INT NOT NULL DEFAULT 35,
  sent_today           INT NOT NULL DEFAULT 0,
  sent_today_resets_at TIMESTAMPTZ,
  paused_until         TIMESTAMPTZ,
  health_score         INT NOT NULL DEFAULT 100,
  warmup_phase         TEXT NOT NULL DEFAULT 'warmup'
                         CHECK (warmup_phase IN ('warmup','active','paused','dead')),
  warmup_start_date    DATE,
  imap_last_uid        BIGINT,
  created_at           TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 8. SENDS (every individual outbound email)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sends (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id          UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  campaign_id         UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  sequence_step       INT NOT NULL,
  template_id         UUID REFERENCES public.templates(id) ON DELETE SET NULL,
  account_id          UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  resume_id           UUID REFERENCES public.resumes(id) ON DELETE SET NULL,
  rendered_subject    TEXT,
  rendered_body       TEXT,
  scheduled_at        TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  message_id          TEXT,
  thread_id           TEXT,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','pending_approval','approved','sending','sent','failed','skipped')),
  failure_reason      TEXT,
  next_followup_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sends_status_scheduled_idx ON public.sends (status, scheduled_at);
CREATE INDEX IF NOT EXISTS sends_contact_campaign_idx ON public.sends (contact_id, campaign_id, sequence_step);
CREATE INDEX IF NOT EXISTS sends_next_followup_idx ON public.sends (next_followup_at) WHERE next_followup_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS sends_message_id_idx ON public.sends (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sends_thread_id_idx ON public.sends (thread_id) WHERE thread_id IS NOT NULL;

-- ============================================================
-- 9. EVENTS (sent, open, click, bounce, reply, unsubscribe)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id         UUID REFERENCES public.sends(id) ON DELETE CASCADE,
  type            TEXT NOT NULL
                    CHECK (type IN ('sent','open','click','bounce','reply','unsubscribe')),
  timestamp       TIMESTAMPTZ DEFAULT now(),
  metadata        JSONB
);
CREATE INDEX IF NOT EXISTS events_send_id_idx ON public.events (send_id);
CREATE INDEX IF NOT EXISTS events_type_timestamp_idx ON public.events (type, timestamp DESC);

-- ============================================================
-- 10. REPLIES (parsed, classified)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.replies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id             UUID REFERENCES public.sends(id) ON DELETE CASCADE,
  received_at         TIMESTAMPTZ,
  from_email          TEXT,
  raw_body            TEXT,
  classification      TEXT
                        CHECK (classification IN ('positive','negative','out_of_office','auto_reply','question','other')),
  sentiment_score     REAL,
  requires_action     BOOLEAN DEFAULT false,
  responded_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS replies_send_id_idx ON public.replies (send_id);
CREATE INDEX IF NOT EXISTS replies_classification_idx ON public.replies (classification);

-- ============================================================
-- 11. APPROVALS (human-in-the-loop)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id         UUID NOT NULL UNIQUE REFERENCES public.sends(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','edited')),
  edited_subject  TEXT,
  edited_body     TEXT,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approvals_status_idx ON public.approvals (status);

-- ============================================================
-- 12. UNSUBSCRIBES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.unsubscribes (
  email            TEXT PRIMARY KEY,
  unsubscribed_at  TIMESTAMPTZ DEFAULT now(),
  reason           TEXT
);

-- ============================================================
-- TRIGGERS (auto-update updated_at)
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_companies ON public.companies;
CREATE TRIGGER set_updated_at_companies BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_contacts ON public.contacts;
CREATE TRIGGER set_updated_at_contacts BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_campaigns ON public.campaigns;
CREATE TRIGGER set_updated_at_campaigns BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- ROW-LEVEL SECURITY
-- For v1 (single-user), policies allow any authenticated user.
-- Tighten when multi-user is added.
-- ============================================================
ALTER TABLE public.companies     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequences     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resumes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sends         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.replies       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unsubscribes  ENABLE ROW LEVEL SECURITY;

-- Permissive policies for authenticated users (single-user mode).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'companies','contacts','campaigns','templates','sequences',
    'resumes','sends','events','replies','accounts','approvals','unsubscribes'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS auth_all ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY auth_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

-- ============================================================
-- SEED: default campaigns based on the user's CSV taxonomy
-- ============================================================
INSERT INTO public.campaigns (name, target_role, status, send_window_local_hour, send_window_local_minute)
VALUES
  ('VC',      'Founder''s Office / Investment Internship', 'draft', 10, 30),
  ('Product', 'Product Management Internship',              'draft', 10, 30),
  ('Growth',  'Growth / Strategy Internship',               'draft', 10, 30)
ON CONFLICT DO NOTHING;
