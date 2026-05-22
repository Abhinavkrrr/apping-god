# Apping God

> Automated, personalized cold-outreach system for jobs & internships.
> Built for Abhinav Kumar (IIT Bombay, Chemical Engineering, Class of 2027).

[![Stack](https://img.shields.io/badge/Stack-Next.js%20%7C%20Supabase%20%7C%20Cloudflare%20Workers-blue)](#stack)
[![Cost](https://img.shields.io/badge/Cost-%240%2Fmonth-success)](#cost)

---

## Status

- ✅ **Phase 1** — foundations, schema, 519 contacts seeded
- ✅ **Phase 2** — send pipeline (Edge Function + Cloudflare tracking) — **first real email sent**
- ✅ **Phase 3** — editable dashboard, approval queue, generate-drafts pipeline
- ✅ **Phase 4** — reply detection + follow-up daemon Edge Functions
- 🟡 **Phase 4.3** — `pg_cron` schedules (functions ready, cron wiring TBD via SQL)
- ✅ **Phase 5 partial** — SMTP verifier + Apollo enricher (Hunter/Snov optional)
- ✅ **Phase 6** — analytics dashboard (funnel + per-campaign + activity log)

---

## Daily workflow

### 1. Tag contacts to a campaign
The seed CSV has `campaign_tag` already set (VC / Product / Growth). Add new contacts with the same tag.

### 2. Activate the campaign you want to run
Dashboard → **Campaigns** → click Edit → set status **Active**.

### 3. Generate drafts (CLI for now; UI in next phase)
```cmd
node scripts/generate_drafts.js --llm --limit 25
```
Creates 25 `pending_approval` rows tailored to each recipient.

### 4. Approve in dashboard
**Approve** tab → review → click **Approve** (or bulk) → click **Send now** for immediate dispatch.

### 5. Dispatcher drains the approved queue
```cmd
node scripts/dispatch_approved.js --limit 35
```
Or run from cron / Edge Function for full automation.

### 6. Replies + opens flow back automatically
- Open pixel fires when recipient opens email (logged via Cloudflare Worker)
- Reply-poller (Supabase Edge Function) checks Gmail IMAP every 2 min, classifies via Groq
- Follow-up daemon generates next step at Day 2/4/6 if no reply

---

## Repository layout

```
apping-god/
├─ frontend/                       Next.js 14 dashboard
│  └─ src/
│     ├─ app/                      Routes + server actions
│     │  ├─ (dashboard)/           Dashboard pages
│     │  ├─ actions/               Server actions (templates, campaigns, …)
│     │  └─ login/
│     ├─ components/               UI primitives + page components
│     └─ lib/                      Supabase clients, mustache renderer
├─ backend/
│  ├─ supabase/
│  │  ├─ migrations/               20260523000001_initial_schema.sql
│  │  └─ functions/
│  │     ├─ send-worker/           SMTP send via denomailer
│  │     ├─ reply-poller/          IMAP poll + Groq classify
│  │     ├─ followup-daemon/       Generate next follow-up draft
│  │     ├─ scheduler/             (Phase 4.3 cron-driven dispatcher)
│  │     └─ csv-importer/          (Phase 5+ via UI)
│  └─ workers/                     Cloudflare Worker (tracking pixel + click + unsub)
├─ scripts/                        CLI tooling
│  ├─ apply_migration.js           Apply schema to Supabase (auto-detects region)
│  ├─ seed_csv.js                  Load 525-contact seed CSV
│  ├─ seed_templates.js            Insert default templates (1 + 3 followups × 3 campaigns)
│  ├─ upload_resume.js             Upload PDF to Supabase Storage
│  ├─ deploy_function.js           Deploy any Edge Function via Management API
│  ├─ generate_drafts.js           Build the approval queue (with optional Gemini)
│  ├─ dispatch_approved.js         Drain approved queue via Edge Function
│  ├─ send_one.js                  Single-shot test send
│  ├─ check_events.js              Tail events for most-recent send
│  ├─ verify_emails.js             SMTP-based deliverability check
│  ├─ enrich_apollo.js             Fill missing titles / LinkedIn from Apollo
│  └─ lib/                         Shared: supabase, render, llm, tracking, sender
├─ docs/                           ARCHITECTURE.md, SOW.docx
├─ .env.example                    Shape of required env vars
└─ run.bat                         Windows launcher
```

---

## Stack

| Layer | Tech | Status |
|---|---|---|
| Frontend | Next.js 14, Tailwind, shadcn-style UI | ✅ |
| Database | Supabase Postgres + RLS | ✅ |
| Cron / async | Supabase Edge Functions (Deno) | ✅ |
| Tracking | Cloudflare Workers | ✅ |
| Email send | Gmail SMTP (port 465) via `denomailer` in Edge Function | ✅ |
| Email receive | Gmail IMAP via `imapflow` in Edge Function | ✅ |
| Personalization LLM | Gemini 2.0 Flash | ✅ |
| Reply classification LLM | Groq Llama 3.3 70B | ✅ |
| Enrichment | Apollo, Hunter, Snov + SMTP verify | ✅ |
| File storage | Supabase Storage (resumes/) | ✅ |
| Auth | Supabase magic link | ✅ (gate disabled in v1) |
| Heavy jobs | GitHub Actions (LinkedIn scrape) | 🟡 Phase 5+ |

---

## Cost

| Service | Free quota | Used | Headroom |
|---|---|---|---|
| Supabase Postgres | 500 MB | ~50 MB/yr | 10× |
| Supabase Edge Fn | 500k/mo | ~50k/mo | 10× |
| Cloudflare Workers | 100k/day | ~1k/day | 100× |
| GitHub Actions | 2000 min/mo | ~400 min/mo | 5× |
| Gemini 2.0 Flash | 1500/day | ~250/day | 6× |
| Groq | 14,400/day | ~50/day | 280× |
| Vercel | 100 GB | tiny | huge |
| **Total** | | | **$0/month** |

---

## Author

Abhinav Kumar · IIT Bombay · Class of 2027
[abhinavkrrr@gmail.com](mailto:abhinavkrrr@gmail.com) · [LinkedIn](https://www.linkedin.com/in/abhinav-kumar-499004280/)
