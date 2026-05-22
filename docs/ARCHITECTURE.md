# Apping God — System Architecture

**Project:** Automated, personalized cold-outreach system for jobs & internships
**Owner:** Abhinav Kumar (IIT Bombay, Chemical Engineering, Class of 2027)
**Repo:** https://github.com/Abhinavkrrr/apping-god
**Last updated:** 2026-05

---

## 1. Goals

Build a fully autonomous, free-to-operate system that:

1. **Ingests** target-recipient contacts from CSV uploads, Apollo, Hunter, Snov, and LinkedIn scraping.
2. **Verifies** email deliverability before sending (SMTP handshake) to protect sender reputation.
3. **Personalizes** every email — light variable substitution + LLM rewrite of one opener sentence using per-company context.
4. **Sends** through a rotatable pool of Gmail accounts at 10:30 AM recipient-local time (Mon–Fri, soft rule).
5. **Tracks** opens, clicks, bounces, and replies in real time.
6. **Follows up** automatically: 3 touches, 2 days apart, threaded in the same Gmail conversation, stops on any reply, pauses 7 days on out-of-office.
7. **Surfaces** a human-in-the-loop approval gate before any first-touch email is sent.
8. **Reports** funnel and per-account health in a web dashboard.
9. **Runs while the laptop is off** — hosted on free serverless infra.
10. **Stays $0/month** (excluding optional ~$10/year custom domain).

---

## 2. Hard requirements (locked)

| Requirement | Decision |
|---|---|
| Hosting | Fully serverless. No VM. No credit card. |
| Volume target | 100–200 cold sends/day across rotated Gmail accounts |
| Personalization | Light (variable substitution) + Medium (LLM rewrite per company) |
| Email variants | A/B/C templates per campaign |
| Follow-up cadence | 3 touches, 2 days apart |
| Stop conditions | Any reply → STOP; OOO → PAUSE 7 days; auto-reply → IGNORE |
| Send window | 10:30 AM recipient-local, Mon–Fri |
| Approval gate | Required for first-touch; follow-ups send automatically |
| Resume management | User can upload & swap multiple resumes via dashboard |
| Custom templates | User can add/edit templates from dashboard (with `{{variables}}`) |
| Localhost runner | `run.bat` starts frontend + backend in one click on Windows |
| Account-ban tolerance | High — design for rotation and replacement |

---

## 3. High-level architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       FRONTEND  (Next.js 14 + shadcn/ui)                 │
│  ┌──────────┬──────────┬───────────┬─────────┬─────────┬───────────────┐│
│  │Campaigns │ Contacts │ Templates │ Approve │  Inbox  │  Analytics    ││
│  └──────────┴──────────┴───────────┴─────────┴─────────┴───────────────┘│
│              Hosted: Vercel free tier (HTTPS, auth, CDN)                 │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  │ Supabase JS SDK (REST + Realtime)
                                  ↓
┌──────────────────────────────────────────────────────────────────────────┐
│                  SUPABASE  (Postgres 15 + Auth + Storage + Edge Fn)      │
│                                                                          │
│  Tables:                                                                 │
│    contacts │ companies │ campaigns │ templates │ sequences │ sends      │
│    events │ replies │ accounts │ approvals │ unsubscribes │ resumes      │
│                                                                          │
│  Storage buckets: resumes/, attachments/                                 │
│  Auth: email + magic link (single user, RLS locked to owner)             │
│  pg_cron: schedules edge functions every 1 / 5 / 15 minutes              │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  ↑
                                  │
       ┌──────────────────────────┼──────────────────────────┐
       │                          │                          │
┌──────┴──────────┐   ┌───────────┴────────────┐   ┌────────┴───────────┐
│ SUPABASE EDGE   │   │  CLOUDFLARE WORKERS    │   │  GITHUB ACTIONS    │
│ FUNCTIONS       │   │  + Cron Triggers       │   │  (scheduled cron)  │
│ (Deno)          │   │  (free, 100k/day)      │   │                    │
│                 │   │                        │   │                    │
│ • scheduler     │   │ • /t/open/:id.gif      │   │ • LinkedIn scrape  │
│ • send-worker   │   │   open tracking pixel  │   │   (Playwright,     │
│ • followup-     │   │ • /t/click/:id?u=...   │   │    headless,       │
│   daemon        │   │   click + redirect     │   │    daily run)      │
│ • reply-poller  │   │ • /t/unsub/:id         │   │ • Apollo bulk      │
│   (IMAP every   │   │   unsubscribe handler  │   │   enrichment       │
│   2 min)        │   │ • /api/gmail-webhook   │   │ • Heavy LLM        │
│ • personalize   │   │   (Gmail push reply    │   │   personalization  │
│   (Gemini call) │   │    notifications)      │   │   batch (Gemini)   │
└─────────────────┘   └────────────────────────┘   └────────────────────┘
                                  │
                                  ↓
       ┌─────────────────────────────────────────────────┐
       │   EXTERNAL SERVICES                              │
       │                                                  │
       │   • Gmail SMTP (multi-account rotation)         │
       │   • Gmail IMAP (reply detection per inbox)      │
       │   • Gemini 2.0 Flash API (personalization)      │
       │   • Groq Llama 3.3 70B (reply classification)   │
       │   • Apollo.io API (contact enrichment)          │
       │   • Hunter.io API (email finding backup)        │
       │   • Snov.io API (email verifier fallback)       │
       └─────────────────────────────────────────────────┘
```

---

## 4. Component breakdown

### 4.1 Frontend — Next.js dashboard

**Tech:** Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Recharts, TanStack Table

**Pages:**

| Route | Purpose |
|---|---|
| `/login` | Supabase magic-link auth |
| `/dashboard` | Overview: tiles for sent/opened/replied today + this week, account health, active campaigns |
| `/campaigns` | List, create, pause, archive campaigns |
| `/campaigns/[id]` | Campaign detail — funnel, variant A/B/C performance, segment |
| `/contacts` | Searchable/filterable contacts table with bulk actions, CSV upload |
| `/contacts/import` | Upload CSV with column mapping wizard |
| `/templates` | CRUD templates with rich-text editor and `{{variable}}` autocomplete |
| `/resumes` | Upload/swap/preview multiple resume PDFs; tag each per campaign |
| `/approve` | Approval queue — review tomorrow's drafts, bulk approve/edit/reject |
| `/inbox` | Unified reply inbox with classification labels and quick-reply |
| `/analytics` | 6 sections: overview, campaigns, accounts, deliverability, replies, activity log |
| `/settings` | Manage Gmail accounts, daily caps, send windows, signature |

**State management:** Server components for data; Zustand for ephemeral UI state.

**Hosting:** Vercel free (hobby) tier. Auto-deploys on `git push` to `main`.

---

### 4.2 Backend — Supabase Edge Functions

Written in TypeScript / Deno. Triggered by `pg_cron` schedules inside Postgres.

| Function | Trigger | Job |
|---|---|---|
| `scheduler` | every 1 min | Find sends with `status='approved'` and `scheduled_at <= now()`. Respect per-account daily cap (default 35). Push to `send-worker`. |
| `send-worker` | invoked by scheduler | Pick next Gmail account from rotation pool. Render template + LLM rewrite. Inject tracking pixel + rewrite links. Attach resume PDF (from storage). SMTP send. Log event. |
| `followup-daemon` | every 15 min | Find sends where `next_followup_at <= now()`, no reply, step < 3. Render next template. Schedule for 10:30 AM next valid weekday in recipient TZ. |
| `reply-poller` | every 2 min | IMAP fetch new messages per account. Match to original via In-Reply-To header. Classify via Groq. Update sequence (STOP/PAUSE/IGNORE). |
| `personalize` | invoked pre-send | Call Gemini 2.0 Flash with template + `company_brief` + recipient context. Cache by (company_id, template_id) to dedupe LLM calls. |
| `csv-importer` | invoked by UI upload | Parse + validate + dedupe + insert contacts. Trigger enrichment for missing emails. |

**Why Edge Functions?** Free tier = 500k invocations/month. At 200 sends/day with all crons running, we use ~50k/month. 10× headroom.

---

### 4.3 Tracking — Cloudflare Workers

**Why separate from Supabase?** Public endpoints (open pixel, click redirect) need to be (a) instant, (b) tolerant of huge traffic spikes from email opens, (c) not exposed via Supabase's public API. Cloudflare's edge network gives us global sub-50ms latency for free.

**Routes:**

| Route | Behavior |
|---|---|
| `GET /t/open/:send_id.gif` | Log event(`open`, send_id), return 1×1 transparent GIF |
| `GET /t/click/:send_id?u=<encoded_url>` | Log event(`click`, send_id, url), 302 redirect to decoded URL |
| `GET /t/unsub/:send_id` | Log unsubscribe, insert into `unsubscribes`, return confirmation page |
| `POST /api/gmail-webhook` | Receive Gmail push notification → trigger reply-poller for that account |

All writes go to Supabase via service-role key stored in Worker secrets.

**Free tier:** 100k requests/day. At 200 sends/day × ~5 events each = 1,000 req/day. Massive headroom.

---

### 4.4 Heavy jobs — GitHub Actions

Used for things that don't fit in serverless (long-running, browser automation, large batches).

| Workflow | Schedule | Purpose |
|---|---|---|
| `.github/workflows/linkedin-scrape.yml` | 0 3 * * * (daily 3 AM IST) | Run Playwright with stealth, scrape new LinkedIn search results, push to contacts |
| `.github/workflows/apollo-bulk.yml` | 0 4 * * * | Refresh Apollo enrichment for stale contacts |
| `.github/workflows/personalize-batch.yml` | 0 9 * * 1-5 | Pre-generate tomorrow's drafts at 9 AM IST so approval queue is ready when user wakes up |
| `.github/workflows/health-check.yml` | every 6 hrs | Ping all Gmail accounts via SMTP, mark dead ones |

**Free tier:** 2000 minutes/month. Daily LinkedIn scrape = ~10 min/day = 300 min/month. Plenty of room.

---

### 4.5 LLM layer

Two providers, swappable via adapter interface:

| Provider | Use | Free quota |
|---|---|---|
| **Gemini 2.0 Flash** | Email personalization (better tone, nuance) | 1500 req/day, 1M tokens/min |
| **Groq (Llama 3.3 70B)** | Reply classification (high volume, needs speed) | 14,400 req/day |

Adapter pattern in `lib/llm/`:
```ts
interface LLMProvider {
  personalize(template: string, context: PersonalizationContext): Promise<string>
  classify(reply: string): Promise<ReplyClassification>
}
```

Switching providers = changing one env var.

---

### 4.6 Email infrastructure

**Sending (SMTP):**
- Gmail accounts authenticated via App Password
- `nodemailer` library
- Multi-account rotation: round-robin with per-account daily cap (default 35, configurable)
- Random 30–90s jitter between sends per account
- Auto-pause account if SMTP errors > 3 in 1 hour

**Receiving (IMAP):**
- Polled every 2 min by `reply-poller` edge function
- Fetches messages since last cursor
- Matches replies via `In-Reply-To` and `References` headers → maps to `sends.message_id`
- Threads correctly in Gmail by re-using `Message-ID` + `References` in follow-ups

**Deliverability tactics:**
- Plain-text + HTML multipart (don't be image-only)
- No tracking pixel on the first email of a brand-new account (warmup)
- Send rate ramps: new account starts at 5/day, +5 every 3 days until cap
- Personalization variance: never send identical body (always at least one LLM-rewritten line)
- All links rewritten through Cloudflare Worker for tracking (uniform domain across all sends from same account)

---

## 5. Data model

```sql
-- Companies
CREATE TABLE companies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  domain          TEXT UNIQUE,
  industry        TEXT,
  size_bucket     TEXT,
  recent_news     JSONB,  -- cached from scraping
  brief_one_line  TEXT,   -- the personalization snippet
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Contacts
CREATE TABLE contacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID REFERENCES companies(id),
  first_name        TEXT NOT NULL,
  last_name         TEXT,
  email             TEXT UNIQUE NOT NULL,
  email_status      TEXT CHECK (email_status IN ('unverified','valid','invalid','risky','bounced')),
  title             TEXT,
  role_type         TEXT CHECK (role_type IN ('HR','HM','employee','founder','partner','other')),
  linkedin_url      TEXT,
  source            TEXT,           -- 'apollo' | 'hunter' | 'csv' | 'linkedin' | 'manual'
  custom_fields     JSONB,
  unsubscribed_at   TIMESTAMPTZ,
  skip_reason       TEXT,           -- 'already_interned' | 'duplicate' | 'manual_skip'
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Campaigns
CREATE TABLE campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,             -- 'VC', 'Product', 'Growth'
  target_role     TEXT,
  resume_id       UUID REFERENCES resumes(id),
  send_window_local_hour INT DEFAULT 10,
  send_window_local_minute INT DEFAULT 30,
  send_days       INT[] DEFAULT '{1,2,3,4,5}',  -- ISO weekday: Mon=1..Sun=7
  status          TEXT CHECK (status IN ('draft','active','paused','archived')),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Templates (one campaign has multiple variants)
CREATE TABLE templates (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id              UUID REFERENCES campaigns(id),
  variant_label            TEXT,            -- 'A', 'B', 'C'
  subject_tmpl             TEXT NOT NULL,
  body_tmpl                TEXT NOT NULL,   -- with {{variables}}
  personalization_level    TEXT CHECK (personalization_level IN ('light','medium')),
  weight                   INT DEFAULT 1,   -- for weighted A/B selection
  is_followup              BOOLEAN DEFAULT false,
  followup_step            INT,             -- 1, 2, or 3
  created_at               TIMESTAMPTZ DEFAULT now()
);

-- Sequences (campaign → template ordering with delays)
CREATE TABLE sequences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID REFERENCES campaigns(id),
  step_number     INT NOT NULL,            -- 0=first, 1=followup1, 2=followup2, 3=followup3
  template_id     UUID REFERENCES templates(id),
  delay_days      INT NOT NULL DEFAULT 0,
  UNIQUE (campaign_id, step_number)
);

-- Resumes (multiple per user)
CREATE TABLE resumes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label           TEXT NOT NULL,           -- 'AI/PM resume', 'Generalist resume'
  storage_path    TEXT NOT NULL,           -- Supabase Storage path
  uploaded_at     TIMESTAMPTZ DEFAULT now(),
  is_default      BOOLEAN DEFAULT false
);

-- Sends (every individual outbound email)
CREATE TABLE sends (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id          UUID REFERENCES contacts(id),
  campaign_id         UUID REFERENCES campaigns(id),
  sequence_step       INT NOT NULL,
  template_id         UUID REFERENCES templates(id),
  account_id          UUID REFERENCES accounts(id),
  resume_id           UUID REFERENCES resumes(id),
  rendered_subject    TEXT,
  rendered_body       TEXT,
  scheduled_at        TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  message_id          TEXT,                -- Gmail Message-ID header
  thread_id           TEXT,                -- Gmail thread for in-thread followups
  status              TEXT CHECK (status IN ('draft','pending_approval','approved','sending','sent','failed','skipped')),
  failure_reason      TEXT,
  next_followup_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- Events (open, click, bounce, reply)
CREATE TABLE events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id         UUID REFERENCES sends(id),
  type            TEXT CHECK (type IN ('sent','open','click','bounce','reply','unsubscribe')),
  timestamp       TIMESTAMPTZ DEFAULT now(),
  metadata        JSONB              -- {user_agent, ip, url_clicked, ...}
);

-- Replies (parsed)
CREATE TABLE replies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id             UUID REFERENCES sends(id),
  received_at         TIMESTAMPTZ,
  from_email          TEXT,
  raw_body            TEXT,
  classification      TEXT CHECK (classification IN ('positive','negative','out_of_office','auto_reply','question','other')),
  sentiment_score     REAL,
  requires_action     BOOLEAN DEFAULT false,
  responded_at        TIMESTAMPTZ
);

-- Gmail account pool
CREATE TABLE accounts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                TEXT UNIQUE NOT NULL,
  smtp_password_enc    TEXT NOT NULL,           -- encrypted with libsodium
  imap_password_enc    TEXT NOT NULL,
  daily_cap            INT DEFAULT 35,
  sent_today           INT DEFAULT 0,
  sent_today_resets_at TIMESTAMPTZ,
  paused_until         TIMESTAMPTZ,
  health_score         INT DEFAULT 100,        -- 0-100
  warmup_phase         TEXT CHECK (warmup_phase IN ('warmup','active','paused','dead')),
  warmup_start_date    DATE,
  created_at           TIMESTAMPTZ DEFAULT now()
);

-- Approval queue (human-in-the-loop)
CREATE TABLE approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id         UUID REFERENCES sends(id) UNIQUE,
  status          TEXT CHECK (status IN ('pending','approved','rejected','edited')),
  edited_subject  TEXT,
  edited_body     TEXT,
  reviewed_at     TIMESTAMPTZ
);

-- Unsubscribes
CREATE TABLE unsubscribes (
  email            TEXT PRIMARY KEY,
  unsubscribed_at  TIMESTAMPTZ DEFAULT now(),
  reason           TEXT
);
```

**Row-level security:** All tables RLS-locked to the authenticated user (single-tenant for now; future-proofed for multi-user).

---

## 6. Core flows

### 6.1 Cold-start ingestion (existing 525-row CSV)

```
User uploads "Apping Database - recipients.csv" via /contacts/import
  ↓
csv-importer Edge Function:
  • Parse with PapaParse
  • For each row: upsert company (by name), upsert contact (by email)
  • Pre-fill company.brief_one_line from CSV's company_brief column
  • Set contact.email_status = 'unverified'
  ↓
Background: SMTP verifier worker scans unverified emails (Sn0v API fallback)
  ↓
Contacts ready: status = 'valid' / 'risky' / 'invalid'
```

### 6.2 Daily campaign run (the happy path)

```
T-1 day, 9 AM IST (personalize-batch GitHub Action):
  • Fetch active campaigns × contacts not yet sent for that campaign
  • For each: render template, call Gemini for opener rewrite
  • Insert into sends with status='pending_approval'
  • Insert into approvals with status='pending'

User wakes up, opens dashboard → /approve
  • Sees 50 pending drafts (table view, one row per send)
  • Bulk-approve / edit-individual / reject
  • Sends move to status='approved', scheduled_at = next 10:30 AM in recipient TZ

T+0, every 1 min (scheduler Edge Function):
  • Find approved sends with scheduled_at <= now()
  • Group by recipient TZ → respect 10:30 AM local window
  • Check per-account caps
  • Push to send-worker queue

send-worker:
  • Pick account (round-robin, healthy, under cap)
  • Render final HTML (with tracking pixel + rewritten links)
  • Attach campaign.resume_id PDF from Storage
  • SMTP send via nodemailer
  • Update sends: status='sent', sent_at, message_id, thread_id
  • Insert event(sent)
  • Set next_followup_at = sent_at + 2 days
```

### 6.3 Reply detection + follow-up

```
Every 2 min (reply-poller):
  • IMAP fetch since last cursor per account
  • For each new message:
      - Parse In-Reply-To header → find sends.message_id
      - If matched: insert reply, call Groq to classify
      - If classification IN ('positive','negative','question'):
          → STOP sequence (clear next_followup_at)
          → Push notification to dashboard
      - If classification = 'out_of_office':
          → PAUSE 7 days (next_followup_at += 7d)
      - If 'auto_reply': IGNORE, don't change schedule

Every 15 min (followup-daemon):
  • Find sends where next_followup_at <= now() AND sequence_step < 3
  • Get next template from sequences table
  • Render with same {{variables}} (reuse cached personalization)
  • Insert new send row, threaded (re-use thread_id, set In-Reply-To)
  • Auto-approve follow-ups (skip approval gate)
  • Schedule for next 10:30 AM in recipient TZ
```

### 6.4 Account warmup (new Gmail added)

```
User adds new Gmail in /settings
  ↓
accounts.warmup_phase = 'warmup', warmup_start_date = today
  ↓
Scheduler enforces:
  Day 1-3:  5 sends/day max
  Day 4-7:  10 sends/day
  Day 8-14: 20 sends/day
  Day 15+:  warmup_phase = 'active', cap = 35
  ↓
Health check (every 6 hrs):
  • Bounce rate > 5% in 24 hrs → pause 24 hrs, alert user
  • SMTP auth fail → mark 'dead', notify user
```

---

## 7. Security model

| Concern | Mitigation |
|---|---|
| API keys | All in `.env` on developer machine + Vercel/Supabase env vars + GitHub Secrets. Never in repo. `.env.example` shows shape only. |
| Gmail app passwords | Encrypted at rest in `accounts.smtp_password_enc` using libsodium (key in Supabase Vault) |
| Supabase service_role | Only used server-side (Edge Functions, Cloudflare Worker, GitHub Actions). Never exposed to browser. |
| Frontend → DB | Always via anon key + Row-Level Security policies |
| Authentication | Supabase magic-link to `abhinavkrrr@gmail.com` only (allowlist) |
| Tracking pixel | Send_id is UUID v4 (not enumerable). Worker validates format before logging. |
| Webhook auth | Cloudflare Worker validates HMAC on Gmail push notifications |
| GDPR/CAN-SPAM | One-click unsubscribe link in every email footer + physical address line |

---

## 8. Deployment topology

```
Developer machine (Windows)
  └─ run.bat → starts:
       • npm run dev (Next.js on localhost:3000)
       • supabase functions serve (Edge Functions local emulator)
       • opens http://localhost:3000 in default browser

Production:
  GitHub repo (apping-god)
    ├─ Push to main → triggers:
    │    ├─ Vercel deploy (frontend)
    │    ├─ Supabase CLI deploy (Edge Functions + migrations)
    │    └─ Wrangler deploy (Cloudflare Workers)
    └─ Scheduled workflows run on cron (LinkedIn scrape, etc.)

Supabase project (ouzfrefnhlxhpeyufllt.supabase.co)
  ├─ Postgres (data)
  ├─ Edge Functions (cron jobs)
  └─ Storage (resumes/, logos/)

Cloudflare account (Abhinav's)
  └─ Worker: track-apping.<workers.dev>

Vercel project
  └─ apping-god.vercel.app (or custom domain when Student Pack approves)
```

---

## 9. Free-tier consumption forecast

| Service | Free quota | Forecast at 200 sends/day | Headroom |
|---|---|---|---|
| Supabase Postgres | 500 MB | ~50 MB / year (20k sends + events) | 10× |
| Supabase Edge Functions | 500k invocations/mo | ~50k/mo | 10× |
| Cloudflare Workers | 100k req/day | ~1k/day | 100× |
| GitHub Actions | 2000 min/mo | ~400 min/mo | 5× |
| Gemini 2.0 Flash | 1500 req/day | ~250/day (cached per company) | 6× |
| Groq Llama 3.3 70B | 14,400 req/day | ~50/day (replies only) | 280× |
| Apollo free | ~50 credits/mo | depends on use | tight — backup w/ SMTP guess |
| Hunter free | 25/mo | only fallback | OK |
| Vercel hobby | 100 GB bandwidth | tiny | unlimited for our use |

**Net cost: $0.** Domain optional ($10/yr) when GitHub Student Pack approves.

---

## 10. Windows one-click runner

**File:** `run.bat` in repo root.

```bat
@echo off
echo Starting Apping God...
start "Supabase Functions" cmd /k "cd backend && supabase functions serve"
start "Next.js Dev" cmd /k "cd frontend && npm run dev"
timeout /t 8 /nobreak
start http://localhost:3000
echo Both servers started. Browser opening...
```

User double-clicks → both windows open → browser launches → ready to use.

---

## 11. Out of scope (v1)

- Multi-user / team accounts
- Custom domain email (uses Gmail only in v1)
- AI-generated reply drafting (manual replies in inbox v1; v2 adds "draft response" button)
- Salesforce / HubSpot CRM sync
- WhatsApp / SMS follow-ups
- Calendly integration for booking
- Resume A/B testing (one resume per campaign in v1)
- Mobile app (responsive web only)

---

## 12. Roadmap (phased build)

| Phase | Scope | Est. effort |
|---|---|---|
| **Phase 1** | Repo scaffold, Supabase schema, Vercel + Cloudflare deploy, manual single-email send test, `run.bat` | 1 weekend |
| **Phase 2** | Template engine, scheduler, send-worker, tracking pixel, 1 account, basic dashboard | 1 weekend |
| **Phase 3** | Approval queue, LLM personalization, A/B variants, multi-resume, contacts CSV import (525 rows live) | 1 weekend |
| **Phase 4** | IMAP reply detection, classification, follow-up daemon (3 steps), account rotation pool, warmup logic | 1 weekend |
| **Phase 5** | Apollo + Hunter + Snov enrichment, LinkedIn scraper (GitHub Actions), SMTP verifier | 1 weekend |
| **Phase 6** | Full analytics dashboard (6 sections), reply inbox, export, polish | 1 weekend |

**Total: ~6 weekends to production-ready system.**

---

## 13. Open decisions (need user input before each phase)

- [ ] **Phase 1:** confirm `serverless` hosting direction (vs waiting for Student Pack DigitalOcean)
- [ ] **Phase 3:** approve initial 3 template variants (A=VC, B=Product, C=Growth — drafted)
- [ ] **Phase 4:** confirm follow-up cadence (currently 0d, 2d, 4d, 6d for sends 1–4) — or change to 0d, 3d, 7d, 14d?
- [ ] **Phase 5:** willing to use secondary LinkedIn account for scraping (ToS risk)?
- [ ] **Phase 6:** integrate Calendly link in signature?

---

## 14. Appendix — credentials inventory

All stored in `.env` (gitignored) + Vercel/Supabase/Cloudflare/GitHub secrets. Never committed.

```
GMAIL_USER
GMAIL_APP_PASSWORD
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_PASSWORD
GEMINI_API_KEY
GROQ_API_KEY
APOLLO_API_KEY
HUNTER_API_KEY
SNOV_USER_ID
SNOV_API_SECRET
CLOUDFLARE_API_TOKEN
GITHUB_PAT
SENDER_NAME
SENDER_PHONE
SENDER_LINKEDIN
SENDER_COLLEGE_LOGO_URL
```

---

*End of architecture document. See `SOW.docx` for the complete Statement of Work.*
