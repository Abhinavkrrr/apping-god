# Apping God

> Automated, personalized cold-outreach system for jobs & internships.
> Built for Abhinav Kumar (IIT Bombay, Chemical Engineering, Class of 2027).

[![Built with](https://img.shields.io/badge/Built%20with-Next.js%20%7C%20Supabase%20%7C%20Cloudflare%20Workers-blue)](#stack)
[![Cost](https://img.shields.io/badge/Cost-%240%2Fmonth-success)](#cost)

---

## What it does

Send 100–200 highly-personalized cold emails per day to recruiters, hiring managers, founders, and decision-makers — with:

- Human-in-the-loop approval queue (10 min/day review)
- LLM-rewritten opener per company (Gemini)
- 3-step automatic follow-up sequence (Day 2 / Day 4 / Day 6)
- Reply detection + classification (positive / negative / OOO / auto-reply)
- Multi-Gmail-account rotation with daily caps + warmup ramping
- Open / click / reply tracking
- 6-section analytics dashboard

All on **free-tier infrastructure** — no credit card required.

---

## Status

**Phase 1 — Foundations: ✅ complete**

- [x] Monorepo scaffolded
- [x] `.gitignore` + `.env.example` (secrets safe)
- [x] Next.js 14 + Tailwind + shadcn-style UI
- [x] Supabase Postgres schema applied (12 tables + RLS + seed campaigns)
- [x] Edge Function skeletons (scheduler, send-worker, followup-daemon, reply-poller, csv-importer)
- [x] Cloudflare Worker for tracking pixel + click redirect + unsubscribe
- [x] Windows `run.bat` launcher
- [ ] Phase 2 — full SMTP send pipeline
- [ ] Phase 3 — approval queue + LLM personalization
- [ ] Phase 4 — reply detection + follow-up daemon
- [ ] Phase 5 — Apollo / Hunter / Snov enrichment
- [ ] Phase 6 — analytics dashboard

---

## Quick start (Windows)

```cmd
git clone https://github.com/Abhinavkrrr/apping-god.git
cd apping-god
copy .env.example .env
REM ... fill in .env (see Credentials Inventory below)
run.bat
```

Dashboard opens at **http://localhost:3000**.

---

## Repository layout

```
apping-god/
├─ frontend/               Next.js 14 dashboard (App Router + Tailwind)
│  ├─ src/app/             Routes: /, /campaigns, /contacts, /templates, ...
│  ├─ src/lib/supabase/    Supabase clients (browser, server, admin)
│  ├─ src/components/      UI + layout
│  └─ src/types/           Database types
├─ backend/
│  ├─ supabase/
│  │  ├─ migrations/       SQL schema migrations
│  │  └─ functions/        Edge Functions (Deno)
│  └─ workers/             Cloudflare Worker (tracking pixel)
├─ scripts/                Migration runner, CSV import, utilities
├─ docs/                   ARCHITECTURE.md, SOW.docx, RUNBOOK.md
├─ .env.example            Required env vars
├─ run.bat                 Windows one-click launcher
└─ README.md
```

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14, TypeScript, Tailwind, shadcn/ui patterns, Recharts, TanStack Table |
| Database | Supabase Postgres 15 + RLS |
| Auth | Supabase magic-link |
| Backend cron | Supabase Edge Functions (Deno) + pg_cron |
| Tracking | Cloudflare Workers |
| Heavy jobs | GitHub Actions |
| LLM | Gemini 2.0 Flash (personalization), Groq Llama 3.3 70B (classification) |
| Email send | Gmail SMTP via App Password + nodemailer (multi-account rotation) |
| Email receive | Gmail IMAP polling every 2 min |
| Enrichment | Apollo, Hunter, Snov free tiers |

---

## Cost

| Service | Free quota | Forecast |
|---|---|---|
| Supabase | 500 MB Postgres, 500k Edge fn / mo | ~50 MB/yr, ~50k/mo |
| Vercel | 100 GB bandwidth | Trivial |
| Cloudflare Workers | 100k req/day | ~1k/day |
| GitHub Actions | 2000 min/mo | ~400 min/mo |
| Gemini 2.0 Flash | 1500 req/day | ~250/day |
| Groq | 14,400 req/day | ~50/day |
| **Total** | | **$0/month** |

---

## Credentials inventory

All stored in `.env` (gitignored). See `.env.example` for shape.

| Var | How to obtain |
|---|---|
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | https://myaccount.google.com/apppasswords |
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` / `SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API |
| `SUPABASE_DB_PASSWORD` | Supabase Dashboard → Settings → Database |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| `GROQ_API_KEY` | https://console.groq.com/keys |
| `APOLLO_API_KEY` | Apollo → Settings → Integrations → API |
| `HUNTER_API_KEY` | Hunter → API tab |
| `SNOV_USER_ID` / `SNOV_API_SECRET` | Snov → Settings → API |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → Profile → API Tokens → Edit Workers |
| `GITHUB_PAT` | GitHub → Settings → Developer Settings → PAT (fine-grained) |

---

## Documentation

- **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** — full system architecture, data model, flows
- **`docs/SOW.docx`** — formal Statement of Work
- **`docs/RUNBOOK.md`** — operational procedures (ships in Phase 6)

---

## Migration / re-apply schema

```bash
cd scripts
npm install     # first time
node apply_migration.js
```

The script auto-discovers your Supabase pooler region.

---

## Author

Abhinav Kumar · IIT Bombay · Class of 2027
[abhinavkrrr@gmail.com](mailto:abhinavkrrr@gmail.com) · [LinkedIn](https://www.linkedin.com/in/abhinav-kumar-499004280/)
