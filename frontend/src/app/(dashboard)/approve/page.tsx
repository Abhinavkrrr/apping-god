import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApprovalList } from "@/components/approve/approval-list";
import { DispatchBar } from "@/components/approve/dispatch-bar";
import { PipelineStats } from "@/components/approve/pipeline-stats";
import { listActiveCampaignTemplates } from "@/app/actions/send";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface DraftRow {
  id: string;
  rendered_subject: string | null;
  campaigns: { name: string } | null;
  contacts: { email: string; first_name: string; last_name: string | null; companies: { name: string } | null } | null;
}

async function loadData() {
  const sb = createAdminClient();

  const [{ data, count }, campaigns, totalContactsRes, sendsByStatus] = await Promise.all([
    sb.from("sends").select(`
      id, rendered_subject,
      campaigns(name),
      contacts(email, first_name, last_name, companies(name))
    `, { count: "exact" })
      .eq("status", "pending_approval")
      .order("created_at", { ascending: false })
      .limit(1000),
    listActiveCampaignTemplates(),
    sb.from("contacts").select("id", { count: "exact", head: true })
      .is("unsubscribed_at", null).is("skip_reason", null),
    sb.from("sends").select("status, contact_id"),
  ]);

  const drafts = ((data ?? []) as unknown as DraftRow[]).map(d => ({
    id: d.id,
    rendered_subject: d.rendered_subject ?? "",
    rendered_body: "",
    contact_email: d.contacts?.email ?? "",
    contact_name: [d.contacts?.first_name, d.contacts?.last_name].filter(Boolean).join(" ") || "—",
    company_name: d.contacts?.companies?.name ?? "—",
    campaign_name: d.campaigns?.name ?? "—",
  }));

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

  return { drafts, total: count ?? 0, campaigns, stats };
}

export default async function ApprovePage() {
  const { drafts, total, campaigns, stats } = await loadData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approval queue</h1>
        <p className="text-sm text-slate-500 mt-1">
          <Badge variant={drafts.length > 0 ? "info" : "default"} className="mr-2">{total} pending review</Badge>
          {campaigns.length > 1 && (
            <Badge variant="success" className="mr-2">{campaigns.length} campaigns</Badge>
          )}
          Pipeline at a glance below. Click <strong>Generate drafts</strong> and pick a campaign.
        </p>
      </div>

      <PipelineStats stats={stats} />

      <DispatchBar pendingCount={total} campaigns={campaigns} />

      {drafts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Queue empty</CardTitle>
            <CardDescription>
              {campaigns.length === 0
                ? "No active campaigns. Add templates first."
                : campaigns
                    .map(c => `${c.eligible_contacts} eligible for ${c.campaign_name}`)
                    .join(" · ") + ". Click Generate above."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ApprovalList drafts={drafts} />
      )}
    </div>
  );
}
