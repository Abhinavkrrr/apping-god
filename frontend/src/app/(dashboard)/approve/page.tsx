import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApprovalList } from "@/components/approve/approval-list";
import { DispatchBar } from "@/components/approve/dispatch-bar";
import { PipelineStats } from "@/components/approve/pipeline-stats";
import { getMasterTemplate } from "@/app/actions/send";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface DraftRow {
  id: string;
  rendered_subject: string | null;
  rendered_body: string | null;
  campaigns: { name: string } | null;
  contacts: { email: string; first_name: string; last_name: string | null; companies: { name: string } | null } | null;
}

async function loadData() {
  const sb = createAdminClient();

  const [{ data, count }, master, totalContactsRes, sendsByStatus] = await Promise.all([
    sb.from("sends").select(`
      id, rendered_subject, rendered_body,
      campaigns(name),
      contacts(email, first_name, last_name, companies(name))
    `, { count: "exact" })
      .eq("status", "pending_approval")
      .order("created_at", { ascending: false })
      .limit(1000),
    getMasterTemplate(),
    sb.from("contacts").select("id", { count: "exact", head: true })
      .is("unsubscribed_at", null).is("skip_reason", null),
    sb.from("sends").select("status, contact_id"),
  ]);

  const drafts = ((data ?? []) as unknown as DraftRow[]).map(d => ({
    id: d.id,
    rendered_subject: d.rendered_subject ?? "",
    rendered_body: d.rendered_body ?? "",
    contact_email: d.contacts?.email ?? "",
    contact_name: [d.contacts?.first_name, d.contacts?.last_name].filter(Boolean).join(" ") || "—",
    company_name: d.contacts?.companies?.name ?? "—",
    campaign_name: d.campaigns?.name ?? "—",
  }));

  // Build per-status counts + distinct touched contacts
  const totalContacts = totalContactsRes.count ?? 0;
  const statusCounts: Record<string, number> = {};
  const touchedContactIds = new Set<string>();
  for (const s of (sendsByStatus.data ?? []) as Array<{ status: string; contact_id: string }>) {
    statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1;
    touchedContactIds.add(s.contact_id);
  }
  const stats = {
    total_contacts: totalContacts,
    pending: statusCounts["pending_approval"] ?? 0,
    approved: statusCounts["approved"] ?? 0,
    sent: statusCounts["sent"] ?? 0,
    skipped: statusCounts["skipped"] ?? 0,
    not_yet_drafted: Math.max(0, totalContacts - touchedContactIds.size),
  };

  return { drafts, total: count ?? 0, master, stats };
}

export default async function ApprovePage() {
  const { drafts, total, master, stats } = await loadData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approval queue</h1>
        <p className="text-sm text-slate-500 mt-1">
          <Badge variant={drafts.length > 0 ? "info" : "default"} className="mr-2">{total} pending review</Badge>
          Pipeline at a glance below. Click <strong>Generate drafts</strong> to draft anyone not yet drafted.
        </p>
      </div>

      <PipelineStats stats={stats} />

      <DispatchBar pendingCount={total} master={master} />

      {drafts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Queue empty</CardTitle>
            <CardDescription>
              {master
                ? `${master.eligible_contacts} of ${master.total_contacts} contacts are ready to draft. Click Generate above.`
                : "Add contacts and templates first."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ApprovalList drafts={drafts} />
      )}
    </div>
  );
}
