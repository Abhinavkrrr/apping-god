import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Send, MailCheck, AlertTriangle, Clock, Inbox as InboxIcon,
  TrendingUp, MailX,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { AnalyticsCharts, type AnalyticsData } from "@/components/analytics/analytics-charts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const REPLY_COLORS: Record<string, string> = {
  positive: "#10b981",
  question: "#3b82f6",
  negative: "#ef4444",
  out_of_office: "#f59e0b",
  auto_reply: "#a78bfa",
  other: "#94a3b8",
};

const BOUNCE_COLORS: Record<string, string> = {
  hard: "#dc2626",
  soft: "#f59e0b",
  unknown: "#94a3b8",
};

async function loadAnalytics(): Promise<{
  data: AnalyticsData;
  recentEvents: any[];
}> {
  const sb = createAdminClient();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();

  // ── Status counts ─────────────────────────────────────────────
  const [
    { data: sendsStatusRaw },
    { data: campaigns },
    { data: bounceTypeRaw },
    { data: replyClassRaw },
    { data: sendsTimeline },
    { data: bouncesTimeline },
    { data: repliesTimeline },
    { data: recentEvents },
    { data: bouncedSendIds },
  ] = await Promise.all([
    sb.from("sends").select("status, contact_id, sent_at, campaign_id"),
    sb.from("campaigns").select("id, name, status"),
    sb.from("bounces").select("bounce_type, send_id"),
    sb.from("replies").select("classification, send_id"),
    sb.from("sends").select("sent_at").eq("status", "sent")
      .gte("sent_at", thirtyDaysAgo.toISOString()),
    sb.from("bounces").select("received_at").gte("received_at", thirtyDaysAgo.toISOString()),
    sb.from("replies").select("received_at").gte("received_at", thirtyDaysAgo.toISOString()),
    sb.from("events").select(`
      type, timestamp, send_id,
      sends!inner(rendered_subject, contacts(first_name, last_name, email, companies(name)))
    `).gte("timestamp", sevenDaysAgo).order("timestamp", { ascending: false }).limit(100),
    sb.from("bounces").select("send_id"),
  ]);

  const sendsByStatus: Record<string, number> = {};
  for (const s of (sendsStatusRaw ?? []) as any[]) {
    sendsByStatus[s.status] = (sendsByStatus[s.status] ?? 0) + 1;
  }
  const sentCount     = sendsByStatus["sent"] ?? 0;
  const failedCount   = sendsByStatus["failed"] ?? 0;
  const pendingCount  = sendsByStatus["pending_approval"] ?? 0;
  const approvedCount = sendsByStatus["approved"] ?? 0;

  // ── Reply / bounce side-tables (joined by send_id) ────────────
  const repliedSendIds = new Set(((replyClassRaw ?? []) as any[]).map(r => r.send_id).filter(Boolean));
  const bouncedSendIdSet = new Set(((bouncedSendIds ?? []) as any[]).map(b => b.send_id).filter(Boolean));
  const repliedCount = repliedSendIds.size;
  const bouncedCount = bouncedSendIdSet.size;
  const awaitingReply = Math.max(0, sentCount - repliedCount - bouncedCount);

  // ── Reply classification breakdown ────────────────────────────
  const classCounts: Record<string, number> = {
    positive: 0, question: 0, negative: 0,
    out_of_office: 0, auto_reply: 0, other: 0,
  };
  for (const r of (replyClassRaw ?? []) as any[]) {
    const k = r.classification ?? "other";
    classCounts[k] = (classCounts[k] ?? 0) + 1;
  }
  const replyClassification = Object.entries(classCounts).map(([category, count]) => ({
    category: category.replace(/_/g, " "),
    count,
    color: REPLY_COLORS[category] ?? "#94a3b8",
  }));

  // ── Bounce types ──────────────────────────────────────────────
  const bounceTypeCounts: Record<string, number> = { hard: 0, soft: 0, unknown: 0 };
  for (const b of (bounceTypeRaw ?? []) as any[]) {
    bounceTypeCounts[b.bounce_type] = (bounceTypeCounts[b.bounce_type] ?? 0) + 1;
  }
  const bounceTypes = Object.entries(bounceTypeCounts).map(([type, count]) => ({
    type, count, color: BOUNCE_COLORS[type] ?? "#94a3b8",
  }));

  // ── Outcome donut: for every SENT email, where did it land? ───
  // Categories: Positive / Question / Negative / OOO / Auto-reply / Bounced / No reply yet
  const positiveSendIds = new Set(
    ((replyClassRaw ?? []) as any[]).filter(r => r.classification === "positive").map(r => r.send_id)
  );
  const questionSendIds = new Set(
    ((replyClassRaw ?? []) as any[]).filter(r => r.classification === "question").map(r => r.send_id)
  );
  const negativeSendIds = new Set(
    ((replyClassRaw ?? []) as any[]).filter(r => r.classification === "negative").map(r => r.send_id)
  );
  const oooSendIds = new Set(
    ((replyClassRaw ?? []) as any[]).filter(r => r.classification === "out_of_office").map(r => r.send_id)
  );
  const autoReplySendIds = new Set(
    ((replyClassRaw ?? []) as any[]).filter(r => r.classification === "auto_reply").map(r => r.send_id)
  );
  const outcomeDonut = [
    { name: "Positive",     value: positiveSendIds.size,  color: "#10b981" },
    { name: "Question",     value: questionSendIds.size,  color: "#3b82f6" },
    { name: "Negative",     value: negativeSendIds.size,  color: "#ef4444" },
    { name: "Out of office",value: oooSendIds.size,       color: "#f59e0b" },
    { name: "Auto-reply",   value: autoReplySendIds.size, color: "#a78bfa" },
    { name: "Bounced",      value: bouncedCount,          color: "#dc2626" },
    { name: "No reply yet", value: awaitingReply,         color: "#cbd5e1" },
  ];

  // ── Timeline: bucket sends/bounces/replies by day (last 30 days) ──
  const dayBuckets: Record<string, { sent: number; bounced: number; replied: number }> = {};
  const dayLabel = (d: Date) => d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    dayBuckets[dayLabel(d)] = { sent: 0, bounced: 0, replied: 0 };
  }
  for (const s of (sendsTimeline ?? []) as any[]) {
    if (!s.sent_at) continue;
    const key = dayLabel(new Date(s.sent_at));
    if (dayBuckets[key]) dayBuckets[key].sent++;
  }
  for (const b of (bouncesTimeline ?? []) as any[]) {
    const key = dayLabel(new Date(b.received_at));
    if (dayBuckets[key]) dayBuckets[key].bounced++;
  }
  for (const r of (repliesTimeline ?? []) as any[]) {
    const key = dayLabel(new Date(r.received_at));
    if (dayBuckets[key]) dayBuckets[key].replied++;
  }
  const timeline = Object.entries(dayBuckets).map(([date, v]) => ({ date, ...v }));

  // ── Per-campaign ──────────────────────────────────────────────
  const perCampaign = (campaigns ?? []).map(c => {
    const campaignSends = ((sendsStatusRaw ?? []) as any[]).filter(s => s.campaign_id === c.id);
    const sentForCampaign = campaignSends.filter(s => s.status === "sent").length;
    // For replies/bounces in this campaign, we'd need send_id join — approximate:
    // since we have replied/bounced sets, count overlap by walking sent sends
    const sentIdsForCampaign = new Set(campaignSends.filter(s => s.status === "sent").map((s: any) => s.id ?? null));
    // sendsStatusRaw doesn't include id by default — re-select if we need precision.
    // For now, approximate per-campaign with overall % applied. Keep table accurate via /campaigns page.
    return {
      name: c.name,
      status: c.status,
      sent: sentForCampaign,
      replied: 0, // intentionally rough — accurate per-campaign needs a separate query, see below
      bounced: 0,
      reply_rate: 0,
      bounce_rate: 0,
    };
  });

  // Run per-campaign reply/bounce counts as separate queries (precise)
  for (const c of perCampaign) {
    if (c.sent === 0) continue;
    const camp = (campaigns ?? []).find(x => x.name === c.name)!;
    const { data: ids } = await sb.from("sends").select("id")
      .eq("campaign_id", camp.id).eq("status", "sent");
    const idArr = (ids ?? []).map((r: any) => r.id);
    if (idArr.length === 0) continue;
    const [{ count: rc }, { count: bc }] = await Promise.all([
      sb.from("replies").select("id", { count: "exact", head: true }).in("send_id", idArr),
      sb.from("bounces").select("id", { count: "exact", head: true }).in("send_id", idArr),
    ]);
    c.replied = rc ?? 0;
    c.bounced = bc ?? 0;
    c.reply_rate  = c.sent > 0 ? (c.replied / c.sent) * 100 : 0;
    c.bounce_rate = c.sent > 0 ? (c.bounced / c.sent) * 100 : 0;
  }

  const data: AnalyticsData = {
    totals: {
      sent: sentCount,
      replied: repliedCount,
      bounced: bouncedCount,
      awaiting_reply: awaitingReply,
      failed: failedCount,
      pending: pendingCount,
      approved: approvedCount,
    },
    rates: {
      reply_rate:   sentCount > 0 ? (repliedCount / sentCount) * 100 : 0,
      bounce_rate:  sentCount > 0 ? (bouncedCount / sentCount) * 100 : 0,
      positive_rate:sentCount > 0 ? (positiveSendIds.size / sentCount) * 100 : 0,
    },
    timeline,
    replyClassification,
    bounceTypes,
    outcomeDonut,
    perCampaign,
  };

  return { data, recentEvents: (recentEvents ?? []) as any[] };
}

const EVENT_SYMBOL: Record<string, string> = {
  sent: "✉", open: "◉", click: "→", reply: "↩", bounce: "⚠", unsubscribe: "✖",
};

export default async function AnalyticsPage() {
  const { data, recentEvents } = await loadAnalytics();
  const t = data.totals;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-slate-500 mt-1">
          Live performance across the full pipeline. Reply / bounce / awaiting splits update in real time.
        </p>
      </div>

      {/* ── KPI tiles ──────────────────────────────────────────── */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
        <Kpi label="Sent"          value={t.sent}           icon={<Send className="h-4 w-4 text-emerald-600" />} />
        <Kpi label="Replied"       value={t.replied}        icon={<MailCheck className="h-4 w-4 text-blue-600" />}
             sub={`${data.rates.reply_rate.toFixed(1)}% reply rate`} />
        <Kpi label="Bounced"       value={t.bounced}        icon={<AlertTriangle className="h-4 w-4 text-red-600" />}
             sub={`${data.rates.bounce_rate.toFixed(1)}% bounce rate`} />
        <Kpi label="No reply yet"  value={t.awaiting_reply} icon={<Clock className="h-4 w-4 text-slate-500" />}
             sub="silent so far" />
        <Kpi label="Pending"       value={t.pending}        icon={<InboxIcon className="h-4 w-4 text-amber-600" />}
             sub="awaiting approval" />
        <Kpi label="Approved"      value={t.approved}       icon={<TrendingUp className="h-4 w-4 text-violet-600" />}
             sub="scheduled to go" />
        <Kpi label="Failed"        value={t.failed}         icon={<MailX className="h-4 w-4 text-red-600" />}
             sub="SMTP rejected" />
      </div>

      {/* ── Charts ────────────────────────────────────────────── */}
      <AnalyticsCharts data={data} />

      {/* ── Per-campaign table ────────────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">Per-campaign breakdown</h3>
            <p className="text-xs text-slate-500 mt-0.5">Exact counts per campaign.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Campaign</th>
                  <th className="px-4 py-2 text-right font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Sent</th>
                  <th className="px-4 py-2 text-right font-medium">Replied</th>
                  <th className="px-4 py-2 text-right font-medium">Bounced</th>
                  <th className="px-4 py-2 text-right font-medium">Reply %</th>
                  <th className="px-4 py-2 text-right font-medium">Bounce %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.perCampaign.map((c, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-900">{c.name}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Badge variant={c.status === "active" ? "success" : "default"}>{c.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.sent}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.replied}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.bounced}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-blue-700">
                      {c.reply_rate.toFixed(1)}%
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${
                      c.bounce_rate > 5 ? "text-red-700" : "text-slate-600"
                    }`}>
                      {c.bounce_rate.toFixed(1)}%
                    </td>
                  </tr>
                ))}
                {data.perCampaign.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No campaigns yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Recent activity log ──────────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">Recent activity (last 7 days)</h3>
            <p className="text-xs text-slate-500 mt-0.5">Events stream: sends, opens, clicks, replies, bounces.</p>
          </div>
          <div className="p-4">
            {recentEvents.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">No activity in the last 7 days.</p>
            ) : (
              <div className="space-y-1 text-xs max-h-[420px] overflow-y-auto">
                {recentEvents.map((e: any, i: number) => {
                  const c = e.sends?.contacts;
                  const name = c
                    ? [c.first_name, c.last_name].filter(Boolean).join(" ")
                    : "—";
                  const email = c?.email ?? "";
                  const company = c?.companies?.name ?? "—";
                  return (
                    <div key={i} className="flex items-center gap-3 py-1.5 border-b border-slate-50 last:border-0">
                      <span className="text-slate-500 w-36 shrink-0">
                        {new Date(e.timestamp).toLocaleString("en-IN", {
                          day: "numeric", month: "short",
                          hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
                        })} IST
                      </span>
                      <span className="w-6 shrink-0 text-base text-center">{EVENT_SYMBOL[e.type] ?? "•"}</span>
                      <span className={`w-16 shrink-0 uppercase tracking-wide text-[10px] font-semibold ${
                        e.type === "bounce" ? "text-red-600"
                        : e.type === "reply" ? "text-blue-600"
                        : "text-slate-600"
                      }`}>{e.type}</span>
                      <span className="font-medium text-slate-900 shrink-0">{name}</span>
                      <span className="text-slate-500 shrink-0">&lt;{email}&gt;</span>
                      <span className="text-slate-400">at</span>
                      <span className="text-slate-700">{company}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  label, value, icon, sub,
}: { label: string; value: number; icon: React.ReactNode; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500 font-medium">
          {icon} <span>{label}</span>
        </div>
        <div className="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
          {value.toLocaleString()}
        </div>
        {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
