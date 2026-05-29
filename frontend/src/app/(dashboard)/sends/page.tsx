import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Send, CheckCircle2, Clock, AlertTriangle, MailX, Inbox, History,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Status = "all" | "pending_approval" | "approved" | "sent" | "failed" | "skipped";

interface SendRow {
  id: string;
  status: string;
  rendered_subject: string | null;
  sent_at: string | null;
  scheduled_at: string | null;
  created_at: string;
  failure_reason: string | null;
  contact_id: string | null;
  campaign_id: string | null;
  contacts: {
    first_name: string | null;
    last_name: string | null;
    email: string;
    companies: { name: string } | null;
  } | null;
  campaigns: { name: string } | null;
}

async function loadSends(status: Status) {
  const sb = createAdminClient();
  let q = sb.from("sends").select(`
    id, status, rendered_subject, sent_at, scheduled_at, created_at, failure_reason,
    contact_id, campaign_id,
    contacts(first_name, last_name, email, companies(name)),
    campaigns(name)
  `).order("created_at", { ascending: false }).limit(500);
  if (status !== "all") q = q.eq("status", status);
  const { data } = await q;

  // Counts per status (for chip badges)
  const { data: statusCounts } = await sb.from("sends").select("status");
  const counts: Record<string, number> = { all: statusCounts?.length ?? 0 };
  for (const s of (statusCounts ?? []) as any[]) {
    counts[s.status] = (counts[s.status] ?? 0) + 1;
  }

  return { rows: (data ?? []) as unknown as SendRow[], counts };
}

export default async function SendsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: Status }>;
}) {
  const params = await searchParams;
  const status = (params.status ?? "all") as Status;
  const { rows, counts } = await loadSends(status);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <History className="h-6 w-6 text-slate-600" />
          Send log
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Every send across every campaign with its current status. ✓ Sent means the
          email left Gmail (delivered, not "opened"). ⏰ Scheduled means it's queued
          for cloud dispatch. ⏳ Pending means waiting in your Approve queue.
        </p>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        <FilterChip current={status} target="all"              counts={counts} label="All" />
        <FilterChip current={status} target="sent"             counts={counts} label="✓ Sent" />
        <FilterChip current={status} target="approved"         counts={counts} label="⏰ Scheduled" />
        <FilterChip current={status} target="pending_approval" counts={counts} label="⏳ Pending" />
        <FilterChip current={status} target="failed"           counts={counts} label="✗ Failed" />
        <FilterChip current={status} target="skipped"          counts={counts} label="⊘ Skipped" />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-3 w-10"></th>
                  <th className="px-3 py-3 text-left font-medium">Contact</th>
                  <th className="px-3 py-3 text-left font-medium">Email</th>
                  <th className="px-3 py-3 text-left font-medium">Subject</th>
                  <th className="px-3 py-3 text-left font-medium">Campaign</th>
                  <th className="px-3 py-3 text-left font-medium">When (IST)</th>
                  <th className="px-3 py-3 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(r => {
                  const c = r.contacts;
                  const name = c
                    ? [c.first_name, c.last_name].filter(Boolean).join(" ") || "—"
                    : "—";
                  const email = c?.email ?? "—";
                  const company = c?.companies?.name ?? "";
                  const whenTs = r.sent_at ?? r.scheduled_at ?? r.created_at;
                  const whenLabel = r.sent_at ? "Sent" : r.scheduled_at ? "Scheduled for" : "Drafted";
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 text-center">
                        <StatusIcon status={r.status} />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-slate-900">{name}</div>
                        {company && <div className="text-xs text-slate-500">{company}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700 font-mono text-xs">{email}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600 max-w-sm">
                        <div className="truncate" title={r.rendered_subject ?? ""}>
                          {r.rendered_subject ?? <span className="text-slate-400">—</span>}
                        </div>
                        {r.status === "failed" && r.failure_reason && (
                          <div className="text-[10px] text-red-600 mt-0.5 truncate" title={r.failure_reason}>
                            ↪ {r.failure_reason}
                          </div>
                        )}
                        {r.status === "skipped" && r.failure_reason && (
                          <div className="text-[10px] text-amber-600 mt-0.5 truncate" title={r.failure_reason}>
                            ↪ {r.failure_reason}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{r.campaigns?.name ?? "—"}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600 whitespace-nowrap">
                        <div>{new Date(whenTs).toLocaleDateString("en-IN", {
                          day: "numeric", month: "short",
                        })}</div>
                        <div className="text-[10px] text-slate-400">
                          {whenLabel} {new Date(whenTs).toLocaleTimeString("en-IN", {
                            hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
                          })}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    {status === "all" ? "No sends yet." : `No sends with status "${status.replace("_", " ")}".`}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {rows.length === 500 && (
        <p className="text-xs text-slate-500 text-center">
          Showing 500 most recent. Use the status filter chips above to narrow down.
        </p>
      )}
    </div>
  );
}

function FilterChip({
  current, target, counts, label,
}: { current: Status; target: Status; counts: Record<string, number>; label: string }) {
  const n = counts[target] ?? 0;
  const href = target === "all" ? "/sends" : `/sends?status=${target}`;
  return (
    <Link href={href}>
      <Badge
        variant={current === target ? "info" : "default"}
        className="cursor-pointer"
      >
        {label} ({n})
      </Badge>
    </Link>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "sent":             return <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-label="sent" />;
    case "approved":         return <Clock className="h-5 w-5 text-blue-600" aria-label="scheduled" />;
    case "pending_approval": return <Inbox className="h-5 w-5 text-amber-600" aria-label="pending approval" />;
    case "failed":           return <AlertTriangle className="h-5 w-5 text-red-600" aria-label="failed" />;
    case "skipped":          return <MailX className="h-5 w-5 text-slate-400" aria-label="skipped" />;
    case "sending":          return <Send className="h-5 w-5 text-blue-500" aria-label="in flight" />;
    default:                 return <span className="text-slate-400">•</span>;
  }
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    sent:             "bg-emerald-100 text-emerald-800 border-emerald-300",
    approved:         "bg-blue-100 text-blue-800 border-blue-300",
    pending_approval: "bg-amber-100 text-amber-800 border-amber-300",
    failed:           "bg-red-100 text-red-800 border-red-300",
    skipped:          "bg-slate-100 text-slate-700 border-slate-300",
    sending:          "bg-blue-50 text-blue-700 border-blue-200",
  };
  const label = status.replace(/_/g, " ");
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${map[status] ?? map.skipped}`}>
      {label}
    </span>
  );
}
