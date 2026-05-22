import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadAnalytics() {
  const sb = createAdminClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();

  const [
    { data: campaigns },
    { count: totalSent },
    { count: totalOpened },
    { count: totalClicked },
    { count: totalReplies },
    { data: recent },
    { data: replyClass },
  ] = await Promise.all([
    sb.from("campaigns").select("id, name, status"),
    sb.from("events").select("id", { count: "exact", head: true }).eq("type", "sent"),
    sb.from("events").select("id", { count: "exact", head: true }).eq("type", "open"),
    sb.from("events").select("id", { count: "exact", head: true }).eq("type", "click"),
    sb.from("events").select("id", { count: "exact", head: true }).eq("type", "reply"),
    sb.from("events").select("type, timestamp, send_id")
      .gte("timestamp", sevenDaysAgo).order("timestamp", { ascending: false }).limit(50),
    sb.from("replies").select("classification"),
  ]);

  // Per-campaign performance
  const perCampaign = await Promise.all(
    (campaigns ?? []).map(async (c) => {
      const { count: sent } = await sb.from("sends").select("id", { count: "exact", head: true })
        .eq("campaign_id", c.id).eq("status", "sent");
      // Open + reply counts for this campaign's sends
      const { data: sendIds } = await sb.from("sends").select("id").eq("campaign_id", c.id).eq("status", "sent");
      const ids = (sendIds ?? []).map(s => s.id);
      let opens = 0, replies = 0;
      if (ids.length > 0) {
        const { count: oc } = await sb.from("events").select("id", { count: "exact", head: true }).eq("type", "open").in("send_id", ids);
        opens = oc ?? 0;
        const { count: rc } = await sb.from("replies").select("id", { count: "exact", head: true }).in("send_id", ids);
        replies = rc ?? 0;
      }
      return { id: c.id, name: c.name, status: c.status, sent: sent ?? 0, opens, replies };
    })
  );

  // Classification breakdown
  const classCounts: Record<string, number> = {};
  for (const r of replyClass ?? []) {
    const k = (r as any).classification ?? "other";
    classCounts[k] = (classCounts[k] ?? 0) + 1;
  }

  return {
    totals: { sent: totalSent ?? 0, opened: totalOpened ?? 0, clicked: totalClicked ?? 0, replies: totalReplies ?? 0 },
    perCampaign,
    recent: recent ?? [],
    classCounts,
  };
}

function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-500">{value.toLocaleString()} ({max > 0 ? (pct).toFixed(1) : 0}%)</span>
      </div>
      <div className="h-2 bg-slate-100 rounded overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${Math.max(pct, 0.5)}%` }} />
      </div>
    </div>
  );
}

const EVENT_SYMBOL: Record<string, string> = { sent: "✉", open: "👁", click: "🔗", reply: "↩", bounce: "⚠", unsubscribe: "✖" };

export default async function AnalyticsPage() {
  const { totals, perCampaign, recent, classCounts } = await loadAnalytics();
  const maxFunnel = totals.sent || 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-slate-500 mt-1">Live performance across the full pipeline.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Funnel (all time)</CardTitle>
            <CardDescription>Sent → Opened → Clicked → Replied</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <FunnelBar label="Sent" value={totals.sent} max={maxFunnel} color="bg-slate-900" />
            <FunnelBar label="Opened" value={totals.opened} max={maxFunnel} color="bg-blue-500" />
            <FunnelBar label="Clicked" value={totals.clicked} max={maxFunnel} color="bg-violet-500" />
            <FunnelBar label="Replied" value={totals.replies} max={maxFunnel} color="bg-emerald-500" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reply classification</CardTitle>
            <CardDescription>How recipients responded</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {Object.keys(classCounts).length === 0 ? (
              <p className="text-sm text-slate-500">No replies classified yet.</p>
            ) : (
              Object.entries(classCounts).map(([k, v]) => (
                <div key={k} className="flex justify-between text-sm">
                  <span className="capitalize">{k.replace("_", " ")}</span>
                  <span className="font-medium">{v}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Per-campaign performance</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Campaign</th>
                  <th className="px-4 py-2 text-right font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Sent</th>
                  <th className="px-4 py-2 text-right font-medium">Opens</th>
                  <th className="px-4 py-2 text-right font-medium">Replies</th>
                  <th className="px-4 py-2 text-right font-medium">Reply %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {perCampaign.map(c => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium">{c.name}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Badge variant={c.status === "active" ? "success" : "default"}>{c.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.sent}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.opens}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.replies}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                      {c.sent > 0 ? ((c.replies / c.sent) * 100).toFixed(1) : "0.0"}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity log (last 50 events, 7 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">No activity in the last 7 days.</p>
          ) : (
            <div className="space-y-1 font-mono text-xs">
              {recent.map((e: any, i: number) => (
                <div key={i} className="flex gap-3 py-0.5">
                  <span className="text-slate-500 w-40 shrink-0">{new Date(e.timestamp).toLocaleString()}</span>
                  <span className="w-8 shrink-0 text-base">{EVENT_SYMBOL[e.type] ?? "•"}</span>
                  <span className="w-20 shrink-0 uppercase tracking-wide text-slate-700">{e.type}</span>
                  <span className="text-slate-500 truncate">{e.send_id}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
