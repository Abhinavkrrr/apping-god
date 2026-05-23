import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createAdminClient } from "@/lib/supabase/admin";
import { ScheduledList } from "@/components/scheduled/scheduled-list";
import { Clock } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface SendRow {
  id: string;
  scheduled_at: string;
  rendered_subject: string | null;
  contacts: { first_name: string; last_name: string | null; email: string; companies: { name: string } | null } | null;
}

async function load() {
  const sb = createAdminClient();
  const { data, count } = await sb.from("sends").select(`
    id, scheduled_at, rendered_subject,
    contacts(first_name, last_name, email, companies(name))
  `, { count: "exact" })
    .eq("status", "approved")
    .is("sent_at", null)
    .order("scheduled_at", { ascending: true })
    .limit(1000);

  const rows = ((data ?? []) as unknown as SendRow[]).map(d => ({
    id: d.id,
    contact_email: d.contacts?.email ?? "",
    contact_name: [d.contacts?.first_name, d.contacts?.last_name].filter(Boolean).join(" ") || "—",
    company_name: d.contacts?.companies?.name ?? "—",
    rendered_subject: d.rendered_subject ?? "",
    scheduled_at: d.scheduled_at ?? new Date().toISOString(),
  }));
  return { rows, total: count ?? 0 };
}

export default async function ScheduledPage() {
  const { rows, total } = await load();

  // Group by date for the summary header
  const byDate = new Map<string, number>();
  for (const r of rows) {
    const d = new Date(r.scheduled_at).toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata", day: "numeric", month: "short",
    });
    byDate.set(d, (byDate.get(d) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Scheduled sends</h1>
        <p className="text-sm text-slate-500 mt-1">
          <Badge variant={total > 0 ? "info" : "default"} className="mr-2">{total} scheduled</Badge>
          Emails queued for autonomous dispatch by the GitHub Actions cron.
          Cancel any send before it fires to move it back to the Approve queue.
        </p>
      </div>

      {byDate.size > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Breakdown by day (IST)</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-2">
              {Array.from(byDate.entries()).map(([day, count]) => (
                <Badge key={day} variant="default" className="text-xs">
                  {day}: <strong className="ml-1">{count}</strong>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-slate-400" />
            <CardTitle className="text-base">All scheduled</CardTitle>
          </div>
          <CardDescription>
            Sorted by scheduled time (soonest first). The morning-dispatch GitHub Action
            runs daily at 10:30 AM IST and drains up to 50 due sends.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500">
              No scheduled sends. Schedule some from <strong>Approve &amp; Send</strong>.
            </div>
          ) : (
            <ScheduledList rows={rows} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
