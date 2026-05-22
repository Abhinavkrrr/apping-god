import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Send, MailOpen, MessageSquare, Activity, Users, Building2 } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadOverview() {
  const sb = createAdminClient();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const [
    { count: contactCount },
    { count: companyCount },
    { count: sentToday },
    { count: openedToday },
    { count: repliesTotal },
  ] = await Promise.all([
    sb.from("contacts").select("id", { count: "exact", head: true }),
    sb.from("companies").select("id", { count: "exact", head: true }),
    sb.from("events").select("id", { count: "exact", head: true }).eq("type", "sent").gte("timestamp", todayStart.toISOString()),
    sb.from("events").select("id", { count: "exact", head: true }).eq("type", "open").gte("timestamp", todayStart.toISOString()),
    sb.from("replies").select("id", { count: "exact", head: true }),
  ]);

  return {
    contacts: contactCount ?? 0,
    companies: companyCount ?? 0,
    sentToday: sentToday ?? 0,
    openedToday: openedToday ?? 0,
    repliesTotal: repliesTotal ?? 0,
  };
}

export default async function OverviewPage() {
  const data = await loadOverview();

  const tiles = [
    { label: "Contacts loaded", value: data.contacts.toLocaleString(), icon: Users, hint: `${data.companies} companies` },
    { label: "Sent today", value: data.sentToday.toLocaleString(), icon: Send, hint: "Across all accounts" },
    { label: "Opens today", value: data.openedToday.toLocaleString(), icon: MailOpen, hint: "Tracked via Cloudflare pixel" },
    { label: "Replies (total)", value: data.repliesTotal.toLocaleString(), icon: MessageSquare, hint: "Detected via IMAP (Phase 4)" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-slate-500 mt-1">
          Live status of your outreach pipeline.
        </p>
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

      <Card>
        <CardHeader>
          <CardTitle>Phase 2 complete ✓</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600 space-y-2">
          <p>
            The send-worker Edge Function is live at{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
              ouzfrefnhlxhpeyufllt.functions.supabase.co/send-worker
            </code>
            . Tracking pixel runs on Cloudflare Workers.
          </p>
          <p>
            <strong>Next:</strong> approval queue and full LLM personalization land in Phase 3.
            Until then, send test emails via{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">node scripts/send_one.js</code>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
