# Apping God — Project Handoff

> **Purpose**: hand off a new AI session, or a new human dev, everything needed to be productive in this codebase in 10 minutes instead of 3 hours of exploration.
>
> **Last updated**: 2026-05-29 by Claude Opus 4.7 at HEAD = `2f5808b`
> **Repo**: github.com/Abhinavkrrr/apping-god
> **Project root on disk**: `F:\god\apping-god`
> **Dashboard runs on**: `http://localhost:3939` (moved off port 3000 to avoid stale Service Worker collisions from older Next.js projects)

---

## 1. What this project does (one paragraph)

A fully-autonomous cold-email outreach system for **Abhinav Kumar** (IIT Bombay, Chemical Engineering, Class of 2027). **Three** parallel campaigns live in production:

1. **Outreach** — pitching Abhinav for remote internships in Product / Founder's Office / Strategy roles. Standard CV-pitch angle.
2. **SaaS Sales** — pitching AI Sales Agent + AI Support Agent products to B2B teams (Heads of Sales, Heads of Support, founders). No CV attachment.
3. **AI Builder Internship** — same internship target as Outreach but leads with AI-tooling fluency (Claude Code, Cursor, Lovable, v0) and lists the user's two real professional experiences (Turtlemint PM Intern + Vijya Fintech AI PM Intern with concrete metrics).

The system imports contacts (CSV, multi-provider discovery, or one-at-a-time Quick Add), renders mustache templates against company/contact context, queues drafts in an approval UI, sends through Gmail SMTP via a GitHub Actions cron dispatcher (laptop-safe — closing your laptop never drops a batch), tracks opens/clicks via a Cloudflare Worker pixel, polls Gmail IMAP for replies, classifies them with Groq, **auto-routes bounce notifications away from the inbox and deletes the bounced contacts entirely** to protect Gmail sender reputation, and triggers multi-step follow-up sequences (Day 2/4/6). Everything runs on free tiers — $0/month total.

---

## 2. Stack at a glance

| Layer | Choice | Why |
|---|---|---|
| Frontend dashboard | Next.js 16 App Router · Tailwind · shadcn-style UI · Recharts | Vercel free tier, server actions reduce client JS |
| Auth | Service-role admin client only (no end-user login) | Single-tenant — Abhinav is the only user |
| DB | Supabase Postgres (free tier, ap-southeast-1) | Pooler at `aws-1-ap-southeast-1.pooler.supabase.com:6543`. PostgREST front-ends it for REST queries from the dashboard. |
| Edge functions | Supabase Deno runtime | `send-worker`, `followup-daemon` |
| Email send | Gmail SMTP via denomailer (Edge fn) → invoked by GitHub Actions cron dispatcher | Local home network blocks ports 25/465/587 + dashboard sends would die on laptop close, so all sending lives behind HTTPS and runs from GH infra |
| Email receive | Gmail IMAP via imapflow (Node script) | imapflow too heavy for Edge runtime → runs on GitHub Actions |
| Tracking | Cloudflare Workers free tier | Pixel + click redirect + unsubscribe |
| Cron | GitHub Actions (4 workflows, every 15 min + daily) | Free, no need for Supabase pg_cron upgrades |
| LLM (primary) | Groq Llama-3.3-70B | 14,400 req/day free (vs 200/day on Gemini) |
| LLM (fallback) | Gemini 2.0 Flash | Opener rewrite when Groq fails |
| Discovery | Hunter.io (25/mo free) + Snov.io (~50/mo free) + BYO-key SalesQL/ContactOut/Skrapp/RocketReach | Plugin architecture in `frontend/src/lib/discover/providers.ts` |
| Charts | Recharts ^3.8.1 | Used on `/analytics` for time-series + donut + bar charts |
| Excel export | exceljs (npm) | `scripts/csv_to_xlsx.js`, `scripts/fintech_csv_to_xlsx.js` — formatted output with filters/colors/hyperlinks |

**Total monthly cost**: $0. Verified.

---

## 3. Repository layout

```
F:\god\apping-god\
├── backend/
│   └── supabase/
│       ├── functions/
│       │   ├── send-worker/       Deno Edge: SMTP send via denomailer. Includes recipient-validation safeguard
│       │   ├── followup-daemon/   Deno Edge: generate next sequence step (skips bounced contacts)
│       │   └── reply-poller/      DEFUNCT — moved to GitHub Action (scripts/poll_replies.js)
│       └── migrations/
│           ├── 20260523000001_initial_schema.sql        12-table base schema + RLS
│           ├── 20260524000001_pg_cron_schedules.sql      pg_cron (followup-daemon every 15 min)
│           ├── 20260525000001_security_constraints.sql   unique indexes
│           ├── 20260525000002_import_batches.sql         per-import batch tracking
│           ├── 20260527000001_bounces.sql                bounces table + indexes
│           └── 20260527000002_bounce_contact_set_null.sql  FK so bounce records survive contact deletion
├── frontend/                       Next.js 16 dashboard (runs on port 3939)
│   └── src/
│       ├── app/
│       │   ├── (dashboard)/        /overview /contacts /discover /templates /resumes /approve /scheduled /sends /followups /inbox /bounces /analytics /settings
│       │   └── actions/            All server actions live here
│       │       ├── contacts.ts     addContact (now blocks unsubscribed re-imports), bulkImportContacts, listBatches, deleteBatch
│       │       ├── send.ts         generateDrafts, sendAllPendingNow (queue-only, laptop-safe), scheduleByIds, cancelScheduled (THE HOT FILE)
│       │       ├── quick-add.ts    Quick add a single contact + queue a draft
│       │       ├── discover.ts     Multi-provider contact discovery (blocks unsubscribed re-imports)
│       │       ├── templates.ts    Create/update templates + re-render pending drafts
│       │       ├── followups.ts    Follow-up management
│       │       ├── bounces.ts      NEW: bouncesTableStatus, listPotentialBounces, migratePotentialBounces, restoreContact
│       │       └── resumes.ts      Upload/setDefault/delete + NEW: listResumeOptions + setCampaignResume (auto-backfills pending drafts)
│       ├── components/             React components organized by route
│       │   ├── approve/            approval-list, approval-row, bulk-bar, dispatch-bar (new queue-only confirm text), generate-modal, quick-add-modal, schedule-dialog
│       │   ├── bounces/            NEW: bounce-row-actions, migrate-banner (handles missing-table + cache-stale states inline)
│       │   ├── contacts/           add-contact-modal, csv-upload-modal, contact-actions, batch-chips (with delete + impact preview)
│       │   ├── analytics/          NEW: analytics-charts (Recharts time-series + donut + bars)
│       │   ├── templates/          template-editor, new-template-modal, resume-toggle (NEW: per-campaign CV toggle)
│       │   └── layout/sidebar.tsx  Now includes /bounces, /sends entries
│       └── lib/
│           ├── supabase/admin.ts   createAdminClient — service-role bypass of RLS
│           ├── send/render.ts      mustache render + plainToTrackedHtml (injects tracking pixel + click wrapper)
│           ├── send/llm.ts         rewriteCompanyBrief via Groq
│           └── discover/providers.ts  Hunter / Snov / SalesQL / ContactOut / Skrapp / RocketReach plugins
├── workers/                        Cloudflare Workers
│   └── src/index.ts                Tracking pixel + click redirect + unsubscribe page (open-redirect hardened)
├── scripts/                        One-off ops + diagnostic + GitHub Action entrypoints
│   ├── poll_replies.js             IMAP poller (runs on GH Actions every 15 min) — NOW detects bounces (Gmail/Postfix/Trend Micro DSNs) and deletes bounced contacts + adds to unsubscribes
│   ├── dispatch_approved.js        Sends due 'approved' drafts (GH Actions every 15 min) — NOW re-checks contact bounce/skip/unsubscribe status before firing
│   ├── debug_pending_count.js      "Why does my Approve queue show X?" diagnostic
│   ├── debug_yesterday_schedule.js "Why did X scheduled mails not send?" diagnostic
│   ├── reset_analytics.js          NEW: wipe events/replies/bounces + null sent_at on sent rows for fresh dashboard (keeps dedup)
│   ├── batch_discover.js           Wealth-mgmt list — Hunter+Snov for 10 hardcoded domains
│   ├── batch_discover_fintech.js   NEW: Fintech list — 50 companies, Hunter with company-name resolution, sorts by CXO/HR/PM/AI role priority
│   ├── csv_to_xlsx.js              Convert wealth-mgmt CSV → polished Excel
│   ├── fintech_csv_to_xlsx.js      NEW: Convert fintech CSV → Excel with role-bucket color coding + per-company summary sheet
│   ├── seed_saas_campaign.js       Idempotent SaaS Sales campaign seed (no CV attachment by design)
│   ├── seed_ai_builder_campaign.js NEW: Idempotent AI Builder Internship seed (default resume auto-attached)
│   ├── update_saas_first_touch.js  In-place template edit + draft re-render (SaaS)
│   ├── update_ai_builder_first_touch.js  NEW: Replace ⚠️ EDIT ME placeholders with real Turtlemint+Vijya experiences
│   ├── check_ai_builder_resume.js  NEW: Diagnose + auto-fix missing resume_id on a campaign
│   ├── purge_saas_pending.js       Delete all SaaS Sales pending drafts
│   ├── apply_batch_migration.js    Apply import_batches migration via pooler
│   ├── apply_bounces_migration.js  Apply bounces migration via pooler (use Supabase SQL Editor as alternative)
│   ├── backfill_bounces.js         Sweep replies for bounce patterns (covers Trend Micro / Postfix relays) → migrate to bounces table
│   ├── test_bounce_detection.js    Offline regex sanity-check for bounce detection
│   └── export_transcript.js        Re-generate CONVERSATION_FULL.md from the JSONL transcript
├── .github/workflows/
│   ├── poll-replies.yml            cron(*/15 * * * *) — Gmail IMAP poll
│   ├── dispatch-scheduled.yml      cron(*/15 * * * *) — drain due 'approved' sends
│   ├── morning-dispatch.yml        cron(0 5 * * *) — 10:30 AM IST kickoff
│   └── linkedin-scrape.yml         (optional, manual trigger, gated on LINKEDIN_SCRAPE_ENABLED var)
├── data/                           Generated CSVs / XLSX (gitignored)
├── CONVERSATION_FULL.md            Verbatim transcript of every prompt + response (435 KB+, regenerated via export_transcript.js)
├── CONVERSATION_SUMMARY.md         Phase-by-phase Q&A summary
└── HANDOFF.md                      This file
```

---

## 4. Database schema (12 base tables + 3 added)

Located in `backend/supabase/migrations/`. Read `20260523000001_initial_schema.sql` for the canonical definition.

| Table | Holds | Key FKs |
|---|---|---|
| `companies` | dedupe by name, holds domain + brief_one_line | — |
| `contacts` | the people we mail (gets DELETED on bounce) | company_id, import_batch_id |
| `campaigns` | named outreach funnel (Outreach, SaaS Sales, AI Builder Internship) | resume_id (toggleable from /templates UI) |
| `templates` | subject + body mustache, per (campaign, step) | campaign_id |
| `sequences` | wires step_number → template_id with delay_days | campaign_id, template_id |
| `resumes` | PDFs in Supabase Storage. `label`, `storage_path`, `is_default` | — |
| `sends` | one row per (contact, campaign, step). Status: pending_approval → approved → sent/failed/skipped. `resume_id` per row (set at generation, overridable via /templates toggle). | contact_id, campaign_id, template_id, resume_id |
| `events` | open/click/sent/reply/bounce audit log | send_id |
| `replies` | parsed IMAP replies + classification (bounces NEVER land here now) | send_id |
| `accounts` | Gmail account credentials + warmup state + sent_today counter | — |
| `approvals` | pending/approved per send (legacy, mirrors sends.status) | send_id |
| `unsubscribes` | append-only blocklist by email. **All bounced emails are added here permanently** so re-imports are blocked. | — (unique on email) |
| `import_batches` | (NEW) one row per CSV/Discover/Quick-Add import operation | — |
| `bounces` | (NEW) parsed DSN data: send_id, contact_id (SET NULL on contact delete), bounce_type, smtp_status, failed_recipient, diagnostic, from_daemon | send_id, contact_id (SET NULL — bounce record survives contact deletion) |

**Critical FKs that cascade on delete** (good to know before bulk operations):
- `sends.contact_id` → ON DELETE CASCADE (deleting a contact removes its sends)
- `approvals.send_id`, `events.send_id`, `replies.send_id` → ON DELETE CASCADE
- `bounces.contact_id` → **ON DELETE SET NULL** (was CASCADE — changed in migration `20260527000002` so we can delete bounced contacts without losing audit)

---

## 5. Current live state (snapshot at 2026-05-29)

| Metric | Value |
|---|---|
| Total contacts in DB | **538** (legacy bucket + later imports) |
| Active campaigns | **3** — Outreach, SaaS Sales, AI Builder Internship |
| Outreach pipeline | 254 pending · 565 sent · 1 failed · 2 skipped |
| SaaS Sales pipeline | 538 pending · 0 sent (campaign not pushed out yet) |
| AI Builder Internship pipeline | 538 pending · 1 sent (probably a test) |
| Distinct contacts in pending pile | 538 (every contact in all 3 campaigns simultaneously — per-campaign dedup default) |
| Hunter free-tier quota | exhausted (hit 25/mo limit on fintech batch on 29 May) — resets ~June 1 |
| Snov free-tier quota | **0** — exhausted earlier in May |
| GitHub Actions workflows | All 4 green after `a745d73` permissions fix |
| Bounces feature | Live in DB. User has clicked Migrate (79 bounces visible) — verify via /bounces page count. |
| Resume attached | Outreach ✅ (default IITB) · AI Builder Internship ✅ (default IITB, fixed in `635248b`) · SaaS Sales ❌ (intentional) |
| Dashboard port | **localhost:3939** (NOT 3000 — see Gotcha #6) |

Re-snapshot anytime with: `node scripts/debug_pending_count.js`

---

## 6. Recent commit timeline (most relevant, newest first)

| SHA | Title | Why it matters |
|---|---|---|
| `2f5808b` | templates: per-campaign resume attachment toggle on /templates page | New `<ResumeToggle>` component on each campaign card. Flipping it updates campaigns.resume_id + backfills resume_id on all pending_approval drafts in that campaign. |
| `635248b` | fix(campaigns): attach default resume to AI Builder Internship | Bug: seed_ai_builder_campaign.js didn't include resume_id in the INSERT → campaign created with resume_id=NULL → emails would ship without CV. Fixed live (538 drafts backfilled) + patched seed for future installs. |
| `7ffff49` | templates: real experiences in AI Builder Internship (Turtlemint + Vijya) | Replaced the ⚠️ EDIT ME placeholders with the user's real PM intern bullets. |
| `769266f` | campaigns: 3rd campaign — AI Builder Internship (AI-tooling angle) | New first-touch leading with Claude Code + Cursor + 2-experience bullets. |
| `e258676` | bounces: hard-stop the agent — delete bounced contacts + 5-layer block | THE CRITICAL ONE. Bounced contact gets deleted + unsubscribed + every send path checks bounce status before firing. See Section 11 below for the 5-layer defense. |
| `3c7316f` | fix(bounces): IMMUTABLE-cast on unique index + add RLS to inline SQL | Postgres rejected `(received_at::date)` as volatile in an index. Fix: `((received_at AT TIME ZONE 'UTC')::date)`. |
| `f7a7d15` | bounces: handle PostgREST schema-cache-stale state explicitly | New 3-state checker (`ok`/`missing`/`cache_stale`). Inline UI shows the right one-liner SQL (`NOTIFY pgrst, 'reload schema'`) when needed. |
| `7309990` | bounces: in-dashboard migration UX (no terminal commands needed) | `/bounces` page detects un-migrated bounces in `/inbox`, shows orange banner with "Show migration SQL" + amber "Migrate N bounces" button. |
| `c1320dd` | bounces: detect Trend Micro / Postfix relays + corporate filter bounces | 6 detection signals (sender address, display name, subject, body phrases, SMTP code+context, Postfix host-said format). Verified via `test_bounce_detection.js`. |
| `2f1c608` | send-now: laptop-safe cloud dispatch + /sends visibility page | "Send NOW" now QUEUES drafts as approved+scheduled-for-now; the GH Actions cron dispatcher (every 15 min) drains them. Safe to close laptop. New `/sends` page shows per-row status badges across all states. |
| `bc2875a` | ops: reset_analytics.js — fresh dashboard without breaking dedup | Wipe events/replies/bounces + null sent_at on sent rows. Preserves status='sent' so dedup still works. |
| `4f2ddce` | analytics: real charts + bounce/reply/awaiting split with Recharts | `/analytics` rewritten: KPI tiles + 30-day timeline + outcome donut (positive/question/negative/OOO/auto-reply/bounced/no-reply-yet) + bounce-type bars + per-campaign reply%/bounce% comparison. |
| `22729e4` | chore: move dashboard to localhost:3939 to escape stale port-3000 SW | Service Worker from old Turtlemint Next.js project was hijacking localhost:3000. Moved to 3939 to bypass entirely. |
| `e6d64e8` | fix(ci): linkedin-scrape.yml YAML | I broke YAML indentation when adding permissions blocks in a745d73. Inputs got orphaned under permissions. Fixed. |
| `090932f` | bounces: dedicated table + auto-block + /bounces dashboard | Initial bounces feature: schema, poll_replies.js bounce branch, /bounces page with stat cards + filter chips. |

---

## 7. Mental model — the "hot path" of a single email (updated)

```
   /contacts  ──┐
   /discover  ──┼──→ contacts row created with import_batch_id
   /quick-add ──┘     (unsubscribes table checked first — refuses if blocked)
                                                                  │
                                                                  ▼
   Generate Modal (campaign-aware) ───→ sends row (status=pending_approval,
                                        rendered_subject/body, resume_id from
                                        campaign.resume_id at the time of generation)
                                                                  │
   /approve  shows it in queue (with import_batch chip filter)
   /sends    shows ALL sends across all statuses with badges
                                                                  ▼
   User selects → "Send NOW" → sendPendingByIds() now QUEUES (not loops):
     status='approved' + scheduled_at=NOW(). Returns immediately.
                                                                  │
   GH Action cron tick (*/15 min) → scripts/dispatch_approved.js
     • Re-checks each due send: contact email_status / skip_reason /
       unsubscribed_at + unsubscribes table. Marks 'skipped' if any flag.
     • Calls send-worker Edge fn for survivors.
                                                                  │
   send-worker (defense-in-depth): re-checks recipient against unsubscribes
   + contacts.email_status/skip_reason. Refuses with 400 if blocked.
                                                                  │
   SMTP send via denomailer → contact's mail server
                                                                  │
   Cloudflare Worker pixel/click → events table → reply tracking
                                                                  │
   GH Action poll-replies (every 15 min) → scripts/poll_replies.js
     • isBounce() check FIRST: if DSN, go BOUNCE PATH (not reply path)
     • BOUNCE PATH: insert into bounces, cancel pending sends, add email
       to unsubscribes (permanent), DELETE contact entirely.
     • REPLY PATH: insert into replies, classify via Groq, update
       sends.next_followup_at.
                                                                  │
   Supabase pg_cron (every 15 min) → followup-daemon Edge fn
     • Skips sends where contact is bounced/unsubscribed/skip_reason set.
     • Generates next sequence step at +2/+4/+6 days unless reply received.
     • Follow-up sends ALWAYS have resume_id=NULL (intentional — no CV on
       follow-ups).
```

---

## 8. Active campaign templates (cheat sheet)

### Outreach (first-touch) — CV attached
- **Subject**: `Exploring Internship Roles in Product Management / Founder's Office / Strategy at {{company}}`
- **Body**: warm intro of Abhinav (IITB / 2027), pitches his fit, asks for 15-min chat. Attaches IITB resume.

### SaaS Sales (first-touch) — no CV
- **Subject**: `AI agents for {{company}} — 2-min demo?`
- **Body**: pitches AI Sales Agent + AI Support Agent with metrics (60-70% auto-resolve, 8h→4min response). Support-team + sales-rep social proof line (the SDR-jargon was removed in `09d9cab`).

### AI Builder Internship (first-touch) — CV attached
- **Subject**: same as Outreach
- **Body**: standard intro → "I'm a power user of Claude Code, GPT-4o, Cursor, Lovable, v0" → **Turtlemint PM Intern** bullet (32%, 24%, NL-to-SQL tool) → **Vijya Fintech AI PM Intern** bullet (65% auto-resolve, 40+ hrs/week saved, 3x lead throughput) → ask. Attaches IITB resume.

Editable from `/templates` page. Any edit auto-rerenders all pending drafts using that template (via parallel pool of 10 UPDATEs in `saveMasterTemplate`). Resume toggle on each campaign card controls CV attachment + backfills pending drafts on flip.

---

## 9. Operational runbook (most common ops)

### "Approve queue shows N — why?"
```bash
node scripts/debug_pending_count.js
```
Returns per-campaign × per-status breakdown + distinct contacts + cross-campaign overlap count.

### "X mails were scheduled but only Y went out"
```bash
node scripts/debug_yesterday_schedule.js
```
Returns: scheduled bucket by IST hour, sent bucket by IST hour, currently-stuck-approved count, recent failure reasons.

### "Drain stuck approved sends manually"
```bash
node scripts/dispatch_approved.js --limit 100
```
(GH Action runs every 15 min with limit=50.)

### "Migrate bounces sitting in inbox into /bounces page"
Use the in-dashboard UI: `/bounces` → orange/amber banner → click button. No terminal needed.

Behind the scenes if you prefer CLI:
```bash
node scripts/backfill_bounces.js --dry-run
node scripts/backfill_bounces.js
```

### "Toggle CV attachment for a campaign"
`/templates` → on the campaign card header, click the dropdown next to the "CV attached / No CV" pill. Backfills pending drafts automatically.

### "Reset analytics for a fresh start"
```bash
node scripts/reset_analytics.js --dry-run     # preview
node scripts/reset_analytics.js               # execute
```
Wipes events/replies/bounces + nulls sent_at on sent rows. Keeps sends.status='sent' so dedup still skips already-mailed contacts.

### "Import a CSV"
Drop the file in `/contacts` UI. Creates an `import_batches` row labeled `CSV · YYYY-MM-DD HH:MM`. Contacts already in `unsubscribes` (from bounces) are auto-refused.

### "Discover new contacts in a vertical"
For ad-hoc: `/discover` UI (one company at a time).
For batch: write a script like `scripts/batch_discover_fintech.js` with hardcoded list, run, then `scripts/fintech_csv_to_xlsx.js` to convert.

### "Edit a template + push to all pending drafts"
Use `/templates` UI. Or programmatically:
```bash
node scripts/update_saas_first_touch.js   # template for the in-place + re-render pattern
node scripts/update_ai_builder_first_touch.js
```

### "Delete a whole import batch + its sends"
`/contacts` page → click the red trash icon next to a batch chip → confirm dialog shows impact preview → "Yes, delete everything". Cascades via FK.

### "Restore a bounce-blocked contact (false positive)"
`/bounces` → find the contact → click **Restore** in the row. Clears skip_reason + email_status. They become sendable again.

### "Regenerate the conversation transcript"
```bash
node scripts/export_transcript.js
```
Source is `C:\Users\abhin\.claude\projects\F--god\b1166991-9f8d-43df-9126-b45298c434b8.jsonl` (hardcoded default).

### "Apply a new migration"
Two paths:
1. Via pooler if reachable: `node scripts/apply_<name>_migration.js`
2. Via Supabase SQL Editor (always works): https://supabase.com/dashboard/project/ouzfrefnhlxhpeyufllt/sql/new — paste the SQL, click Run. ALWAYS end with `NOTIFY pgrst, 'reload schema';` so the dashboard sees the new tables (see Gotcha #4).

---

## 10. Known gotchas (will save the next session hours)

1. **Per-campaign dedup is the correct default.** `generateDrafts` skips contacts already touched **in the same campaign**, not globally. Same contact CAN appear in Outreach AND SaaS Sales AND AI Builder Internship — they're different products. Don't "fix" this. Opt-in to global dedup via `opts.globalDedup` only when truly intended.

2. **`generateDrafts` must batch its inserts.** N+1 sequential inserts to Supabase are 30-90s for ~50 contacts → Next.js server-action timeout. Pattern: build all rows in memory → one `insert([...])` → one `insert(approvals[])`. See commit `8e337e4`.

3. **"Send NOW" doesn't loop in the dashboard process anymore.** As of `2f1c608`, it just marks selected sends as approved+scheduled-for-now and returns immediately. The GitHub Actions cron dispatcher (every 15 min) does the actual SMTP firing. Safe to close laptop. Up to 15-min latency before first send fires — user can manually trigger via GH Actions UI to bypass.

4. **PostgREST schema cache is sticky.** When you create a new table via Supabase SQL Editor, PostgREST doesn't know about it until you `NOTIFY pgrst, 'reload schema'` from the same Postgres instance (or wait ~10 min). Drizzle Studio's NOTIFY doesn't always reach PostgREST — use Supabase's native SQL Editor for any DDL or NOTIFY commands. All new migration SQL in the repo now ends with the NOTIFY line.

5. **Postgres rejects volatile expressions in index definitions.** `(received_at::date)` is volatile (depends on session timezone). Use `((received_at AT TIME ZONE 'UTC')::date)` to make it IMMUTABLE. See `bounces` migration.

6. **Dashboard runs on port 3939, NOT 3000.** Old Turtlemint Next.js project registered a Service Worker on `localhost:3000` that hijacks the dashboard if you ever revert. `run.bat` and `frontend/package.json` both pin 3939. See commit `22729e4`.

7. **The `accounts` row password column may contain the literal string `"ENV"`.** Reply-poller used to insert that as a placeholder. `send-worker` guards against it but always verify when troubleshooting 535 BadCredentials.

8. **Cloudflare Worker redirect must reject non-http(s) schemes.** Open-redirect was a finding in the security audit. Currently parses URL + checks `protocol in ('http:', 'https:')`.

9. **GH Actions Node version must be 22, not 20.** Supabase realtime websocket polyfill needs it. All 4 workflows pin Node 22.

10. **GitHub silently flipped `GITHUB_TOKEN` to default-deny on 2026-05-26.** All workflows started returning 403 on `actions/checkout`. Fix is explicit `permissions: contents: read` block on every workflow — already in. If GH ever does it again, that's where to look. Watch out for indentation bugs when adding permissions to workflow files (see `e6d64e8` for an example of how I broke it).

11. **`scheduled_at` is in UTC, but user thinks in IST.** IST = UTC+5:30. The `schedulePendingByIds` helper does the conversion via `Date.UTC(y, m, d+1, hour-5, minute-30)`. Always render to IST when surfacing to the user.

12. **Bounce detection has SIX signals.** Don't simplify any one of them — they cover different bounce-relay setups (Gmail mailer-daemon, Postfix `<email>: host X said:`, Trend Micro "Mail Delivery System" display name, Exchange "Undeliverable" subject, body phrases, inline SMTP codes). See `scripts/test_bounce_detection.js` for the regression suite.

13. **Bounced contacts get DELETED, not just marked.** Their email goes into `unsubscribes` (permanent block, prevents re-import) and the contact row is removed. The bounce record survives in `bounces` table because `contact_id` FK is `ON DELETE SET NULL`. Don't change either to CASCADE.

14. **Snov free-tier credits exhausted.** ~50 searches/month free. Hit zero on 2026-05-25. Either top-up or wait for monthly reset (typically the 1st of the month).

15. **Hunter free-tier caps at 10 results per search**, not 100. Free tier = 25 searches/month. Hit on 29 May during fintech batch (got 275 contacts across 42 of 49 companies before quota exhausted).

16. **Quick Add uses a persistent batch named exactly "Quick Add"** (looked up by `eq("name", "Quick Add")`). Don't rename it without updating `quick-add.ts`.

17. **The `Legacy (pre-batch)` and `Quick Add` import batches are protected from bulk-delete in the UI** (trash icon disabled). Per-contact delete still works.

18. **Resume attachment is per-campaign at generation time.** Pending drafts hold their own `resume_id` (copied from `campaign.resume_id` when `generateDrafts` runs). Flipping the toggle on /templates auto-backfills the `resume_id` on pending drafts in that campaign so the toggle takes effect for already-queued sends. Approved/sent drafts are NOT retroactively modified (intentional).

19. **Follow-ups never attach the CV.** The `followup-daemon` Edge function explicitly sets `resume_id: null` on follow-up sends. This is intentional — you attach the CV once, not on every nudge. Standard email etiquette.

---

## 11. The 5-layer bounce defense (architectural)

If you change anything related to sending, KNOW this. A bounced contact is locked out at five independent layers:

| Layer | File | What it does |
|---|---|---|
| **1. Bounce detection + delete** | `scripts/poll_replies.js` (GH Actions, every 15 min) | Detects DSN → inserts bounce → adds email to unsubscribes → **DELETES contact** → cancels pending sends. Bounce record survives via ON DELETE SET NULL FK. |
| **2. Generate skip** | `frontend/src/app/actions/send.ts` (generateDrafts) | Filters `.is("skip_reason", null).is("unsubscribed_at", null)`. Bounced contacts are already deleted by Layer 1, so this is implicitly guarded — but if any slip through this catches them. |
| **3. Dispatcher pre-flight** | `scripts/dispatch_approved.js` (GH Actions, every 15 min) | Before firing any approved send, re-checks contact's email_status / skip_reason / unsubscribed_at + queries unsubscribes table. Marks send as skipped if any flag. Catches the race where a bounce lands between approve and dispatch. |
| **4. Send-worker validator** | `backend/supabase/functions/send-worker/index.ts` | Last line of defense — refuses any send to an email in unsubscribes or to a contact with bounce/skip flags. Returns 400 + auto-marks send as skipped. Catches any non-dispatcher caller (CLI test, manual API hit). |
| **5. Follow-up daemon skip** | `backend/supabase/functions/followup-daemon/index.ts` | Same checks before generating next sequence step. Plus checks unsubscribes table as fallback. Prevents follow-up nudges to addresses that bounced on the first touch. |
| **6. Import gatekeeper** | `frontend/src/app/actions/contacts.ts` (addContact) + `discover.ts` | Refuses to (re-)create a contact whose email is in unsubscribes. Returns a clear error. Prevents the "bounce → delete → re-import same CSV → resend → bounce again" loop. |

If you ever see "the system is still sending to bounced address X", grep for X in these 6 paths. One of them is misconfigured or got reverted.

---

## 12. Environment variables (`.env`)

Locations:
- Repo root `.env` (used by `scripts/*.js`)
- `frontend/.env.local` (used by Next.js)
- GitHub Actions secrets (used by `.github/workflows/*.yml`)

Required keys (without values — keep `.env` out of git):
```
NEXT_PUBLIC_SUPABASE_URL=https://ouzfrefnhlxhpeyufllt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_PROJECT_REF=ouzfrefnhlxhpeyufllt        # used by dispatch_approved.js
SUPABASE_DB_PASSWORD=...                          # for pooler-direct scripts
GMAIL_USER=abhinav.iitb.2027@gmail.com           # example only
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=...                                # fallback only
HUNTER_API_KEY=...
SNOV_USER_ID=...
SNOV_API_SECRET=...
APOLLO_API_KEY=...                                # configured but Apollo went paid-only
TRACKING_BASE_URL=https://your-cf-worker.dev      # Cloudflare Worker URL for pixel/click
IIT_LOGO_URL=https://...                          # optional, for email footer logo
# Optional BYO-key discovery providers:
# SALESQL_API_KEY=...
# CONTACTOUT_API_KEY=...
# SKRAPP_API_KEY=...
# ROCKETREACH_API_KEY=...
```

---

## 13. How to onboard a new AI session

If you're a fresh Claude / new AI picking this up cold, here's the recommended reading order to avoid duplicate exploration:

1. **This file** (you're here).
2. `CONVERSATION_FULL.md` — Ctrl-F any term to find the discussion that introduced it. Don't read top-to-bottom; it's 435 KB+.
3. `frontend/src/app/actions/send.ts` — the hottest file in the project. Every change here has a story; read commit history before editing.
4. `frontend/src/app/actions/bounces.ts` — newer hot file. Owns the bounce migration flow + cache-stale detection.
5. `backend/supabase/migrations/20260523000001_initial_schema.sql` — canonical DB shape.
6. `frontend/src/lib/discover/providers.ts` — plugin architecture; understand before adding a 7th provider.
7. `scripts/dispatch_approved.js` + `scripts/poll_replies.js` — the two long-running ops that aren't in the Next.js app. The poller is where bounce detection lives.

Then run `node scripts/debug_pending_count.js` to see live state. If that prints sensible numbers, your environment is wired correctly and you're ready to work.

---

## 14. What the user (Abhinav) cares about most

In rough priority order, based on observed behavior across the entire conversation:

1. **Speed of iteration.** "Quickly fix it", "do it now", "what should I select" appear repeatedly. Don't over-engineer; ship the smallest correct fix.
2. **$0 cost.** Every "should we use X?" is implicitly "is it free-tier?". Don't suggest paid services unless explicitly flagged.
3. **No fabricated data.** Never invent contacts/emails. Use real APIs or web search; mark inferred vs verified clearly.
4. **Clear diagnostics over silent fixes.** When something's wrong, the user wants to *see* the breakdown (counts, statuses) before the fix lands. Hence the `debug_*` scripts.
5. **UI clarity.** "I can't see X" → the next demand is "make X obvious." Hidden-by-default UX (like the batch chips before `edd91b5`) gets flagged immediately.
6. **Doesn't want a single contact pitched twice on the same day.** Per-campaign funnels are OK; same-day double-pitches are not. The "Skip contacts in other campaigns" opt-in exists for this.
7. **Strict on dead-address sending.** Bounced addresses must be killed at every layer. The user explicitly demanded this (Section 11).
8. **Trusts dashboard UI over CLI.** When given the choice between "run this script" and "click this button", picks the button. Hence the in-dashboard migration UX in `7309990`, the resume toggle in `2f5808b`, the batch-delete impact preview in `deef995`.
9. **Wants to see "where is X?"** Sidebar nav additions (Send log, Bounces) are appreciated. Status badges, color coding, paperclip icons, etc. all valued.

---

## 15. Open / suggested next steps

| Priority | Item | Notes |
|---|---|---|
| Med | Import the 100 wealth-mgmt contacts + 275 fintech contacts | The .xlsx files are in `data/`. Drop into `/contacts` upload UI. Will create new batch chips automatically. SaaS Sales campaign is the right target for the fintech batch. |
| Med | Re-run `batch_discover_fintech.js` on June 1 | Hunter quota resets monthly. 7 fintech companies are still un-discovered. Plus any companies that returned 0 will need a different provider. |
| Med | Top up Snov credits OR Hunter monthly | Free tier exhausted. €34/mo Hunter starter = 500 searches × 10 results = 5000 contacts/month. Pays for itself in one positive reply. |
| Low | Delete the 1 failed contact with `No valid emails provided!` | See SQL in section 9 of CONVERSATION_FULL.md. |
| Low | Add `target_campaign` column to contacts | Currently every Generate is manual per-campaign. A default-routing field would let CSV imports flow into the right pipeline. |
| Low | Verify GH Actions next cron tick after any workflow change | All 4 workflows have `permissions: contents: read` block. If you add a new workflow, don't forget this. |
| Low | Update CONVERSATION_SUMMARY.md to cover bounces/sends/analytics/AI-builder phases | The summary is from earlier; the full transcript is up to date. |

**Cleanup SQL for the 1 failed contact:**
```sql
SELECT s.id, c.first_name, c.last_name, c.email
FROM sends s JOIN contacts c ON c.id = s.contact_id
WHERE s.failure_reason = 'No valid emails provided!';
-- → take the contact id, then either:
DELETE FROM contacts WHERE id = '<the-id>';
-- or UPDATE contacts SET email = '...' WHERE id = '<the-id>';
```

---

## 16. Persona quick-reference (for any new AI)

- **Abhinav Kumar** — 3rd-year IIT Bombay Chemical Engineering, Class of 2027.
- Real prior PM experience: **Turtlemint** (PM Intern — Loan Marketplace + NL-to-SQL tool) and **Vijya Fintech** (AI PM Intern — multi-agent chatbot + AI lead management).
- Phone: +91 6201395251 · LinkedIn: linkedin.com/in/abhinav-kumar-499004280/
- Hands-on, technical, will read your code. Don't dumb things down but be terse.
- Prefers Hindi-style direct phrasing ("do it...make no mistakes"). Treat urgency as real.
- Working from India — IST timezone. Renders times in IST in toasts/UI.
- Indian context: companies like Dezerv, Nuvama, ET Money, Stride Ventures, Turtlemint, Vijya Fintech are recognized. Don't paraphrase Indian VC/fintech names.
- Will catch fabrications instantly. Don't invent. Will catch missing features instantly ("my CV is attached right?"). Don't assume — verify.
- Tends to use Drizzle Studio for SQL exploration but should be steered to Supabase's native SQL Editor for any DDL or NOTIFY commands (PostgREST signal reaches only the latter reliably).

---

**End of handoff. Anything missing? Add it here — this file is the source of truth for new sessions.**
