import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Send, MailOpen, MessageSquare, Users, ArrowRight, CheckCircle2,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadOverview() {
  const sb = createAdminClient();
  // "Today" = today in IST (UTC+5:30), not UTC midnight.
  const nowUtc = new Date();
  const istNow = new Date(nowUtc.getTime() + (5 * 60 + 30) * 60 * 1000);
  const istMidnight = new Date(Date.UTC(
    istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 0, 0, 0
  ));
  const todayStart = new Date(istMidnight.getTime() - (5 * 60 + 30) * 60 * 1000);

  const [
    { count: contactCount },
    { count: companyCount },
    { count: sentToday },
    { count: openedToday },
    { count: repliesTotal },
    { count: pendingApproval },
    { count: scheduledCount },
  ] = await Promise.all([
    sb.from("contacts").select("id", { count: "exact", head: true }),
    sb.from("companies").select("id", { count: "exact", head: true }),
    sb.from("events").select("id", { count: "exact", head: true }).eq("type", "sent").gte("timestamp", todayStart.toISOString()),
    sb.from("events").select("id", { count: "exact", head: true }).eq("type", "open").gte("timestamp", todayStart.toISOString()),
    sb.from("replies").select("id", { count: "exact", head: true }),
    sb.from("sends").select("id", { count: "exact", head: true }).eq("status", "pending_approval"),
    sb.from("sends").select("id", { count: "exact", head: true }).eq("status", "approved").is("sent_at", null),
  ]);

  return {
    contacts: contactCount ?? 0,
    companies: companyCount ?? 0,
    sentToday: sentToday ?? 0,
    openedToday: openedToday ?? 0,
    repliesTotal: repliesTotal ?? 0,
    pendingApproval: pendingApproval ?? 0,
    scheduledCount: scheduledCount ?? 0,
  };
}

export default async function OverviewPage() {
  const data = await loadOverview();

  const tiles = [
    { label: "Contacts loaded", value: data.contacts.toLocaleString(), icon: Users, hint: `${data.companies} companies` },
    { label: "Sent today", value: data.sentToday.toLocaleString(), icon: Send, hint: "Across all accounts" },
    { label: "Opens today", value: data.openedToday.toLocaleString(), icon: MailOpen, hint: "Tracked via Cloudflare pixel" },
    { label: "Replies (total)", value: data.repliesTotal.toLocaleString(), icon: MessageSquare, hint: "Auto-classified via Groq" },
  ];

  const systemRows = [
    { label: "Send pipeline", detail: "Supabase Edge Function (SMTP from cloud)", status: "Live" },
    { label: "Tracking pixel + click redirect", detail: "Cloudflare Workers (global edge)", status: "Live" },
    { label: "Reply detection", detail: "GitHub Actions cron, every 15 min (IMAP + Groq classify)", status: "Live" },
    { label: "Scheduled-send dispatcher", detail: "GitHub Actions cron, every 15 min", status: "Live" },
    { label: "Follow-up generation", detail: "Supabase pg_cron, every 15 min", status: "Live" },
    { label: "AI per-row personalization", detail: "Groq Llama 3.3 70B (Gemini fallback)", status: "Live" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-slate-500 mt-1">Live status of your outreach pipeline.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Card key={t.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">{t.label}</CardTitle>
                <Icon className="h-4 w-4 text-slate-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{t.value}</div>
                <p className="text-xs text-slate-500 mt-1">{t.hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/approve" className="block">
          <Card className="hover:bg-slate-50 cursor-pointer h-full">
            <CardContent className="py-4">
              <div className="text-xs text-slate-500 uppercase tracking-wide">Approve & Send</div>
              <div className="text-2xl font-bold mt-1">{data.pendingApproval}</div>
              <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                pending review <ArrowRight className="h-3 w-3" />
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/scheduled" className="block">
          <Card className="hover:bg-slate-50 cursor-pointer h-full">
            <CardContent className="py-4">
              <div className="text-xs text-slate-500 uppercase tracking-wide">Scheduled</div>
              <div className="text-2xl font-bold mt-1">{data.scheduledCount}</div>
              <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                queued for autonomous send <ArrowRight className="h-3 w-3" />
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/inbox" className="block">
          <Card className="hover:bg-slate-50 cursor-pointer h-full">
            <CardContent className="py-4">
              <div className="text-xs text-slate-500 uppercase tracking-wide">Reply inbox</div>
              <div className="text-2xl font-bold mt-1">{data.repliesTotal}</div>
              <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                classified replies <ArrowRight className="h-3 w-3" />
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            System status
            <Badge variant="success">All systems live</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {systemRows.map((r) => (
              <div key={r.label} className="flex items-start gap-3 py-1.5 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-900">{r.label}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{r.detail}</div>
                </div>
                <Badge variant="success" className="text-[10px]">{r.status}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
