import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApprovalList } from "@/components/approve/approval-list";
import { DispatchBar } from "@/components/approve/dispatch-bar";

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

  const [{ data, count }, { data: campaigns }] = await Promise.all([
    sb.from("sends").select(`
      id, rendered_subject, rendered_body,
      campaigns(name),
      contacts(email, first_name, last_name, companies(name))
    `, { count: "exact" })
      .eq("status", "pending_approval")
      .order("created_at", { ascending: false })
      .limit(500),
    sb.from("campaigns").select("id, name, status").eq("status", "active"),
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

  // Per-campaign eligibility counts (tagged contacts not yet drafted)
  const campaignOptions = await Promise.all(
    (campaigns ?? []).map(async (c: any) => {
      const { data: tagged } = await sb.from("contacts")
        .select("id")
        .contains("custom_fields", { campaign_tag: c.name })
        .is("unsubscribed_at", null).is("skip_reason", null);
      const taggedIds = (tagged ?? []).map((t: any) => t.id);

      let eligible = 0;
      if (taggedIds.length > 0) {
        const { data: touched } = await sb.from("sends").select("contact_id")
          .eq("campaign_id", c.id)
          .in("status", ["pending_approval", "approved", "sending", "sent"]);
        const touchedSet = new Set((touched ?? []).map((t: any) => t.contact_id));
        eligible = taggedIds.filter(id => !touchedSet.has(id)).length;
      }
      return { name: c.name as string, eligible };
    })
  );

  return { drafts, total: count ?? 0, campaignOptions };
}

export default async function ApprovePage() {
  const { drafts, total, campaignOptions } = await loadData();
  const noActiveCampaigns = campaignOptions.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approval queue</h1>
        <p className="text-sm text-slate-500 mt-1">
          <Badge variant={drafts.length > 0 ? "info" : "default"} className="mr-2">{total} pending</Badge>
          Use the buttons below to generate, send, or schedule the whole batch.
          Per-row controls let you fine-tune individual sends.
        </p>
      </div>

      {noActiveCampaigns ? (
        <Card>
          <CardHeader>
            <CardTitle>No active campaigns</CardTitle>
            <CardDescription>
              You need at least one campaign with status <strong>active</strong> before drafts can be generated.
              Go to <a href="/campaigns" className="text-blue-600 underline">Campaigns</a> and flip one to <em>active</em>.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <DispatchBar pendingCount={total} campaignOptions={campaignOptions} />
      )}

      {drafts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Queue empty</CardTitle>
            <CardDescription>
              {noActiveCampaigns
                ? "Activate a campaign first."
                : "Click Generate drafts above to build the queue."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ApprovalList drafts={drafts} />
      )}
    </div>
  );
}
