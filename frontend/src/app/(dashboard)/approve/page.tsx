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

async function loadDrafts() {
  const sb = createAdminClient();
  const { data, count } = await sb.from("sends").select(`
    id, rendered_subject, rendered_body,
    campaigns(name),
    contacts(email, first_name, last_name, companies(name))
  `, { count: "exact" })
    .eq("status", "pending_approval")
    .order("created_at", { ascending: false })
    .limit(200);

  const drafts = ((data ?? []) as unknown as DraftRow[]).map(d => ({
    id: d.id,
    rendered_subject: d.rendered_subject ?? "",
    rendered_body: d.rendered_body ?? "",
    contact_email: d.contacts?.email ?? "",
    contact_name: [d.contacts?.first_name, d.contacts?.last_name].filter(Boolean).join(" ") || "—",
    company_name: d.contacts?.companies?.name ?? "—",
    campaign_name: d.campaigns?.name ?? "—",
  }));
  return { drafts, total: count ?? 0 };
}

export default async function ApprovePage() {
  const { drafts, total } = await loadDrafts();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approval queue</h1>
        <p className="text-sm text-slate-500 mt-1">
          <Badge variant={drafts.length > 0 ? "info" : "default"} className="mr-2">{total} pending</Badge>
          Use the buttons below to generate, send, or schedule the whole batch. Per-row controls let you fine-tune individual sends.
        </p>
      </div>

      <DispatchBar pendingCount={total} />

      {drafts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Queue empty</CardTitle>
            <CardDescription>
              No drafts pending. Generate some with:<br/>
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs mt-1 inline-block">
                node scripts/generate_drafts.js --llm --limit 25
              </code>
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ApprovalList drafts={drafts} />
      )}
    </div>
  );
}
