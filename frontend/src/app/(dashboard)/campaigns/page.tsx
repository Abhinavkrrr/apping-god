import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createAdminClient } from "@/lib/supabase/admin";
import { CampaignEditor } from "@/components/campaigns/campaign-editor";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function loadData() {
  const sb = createAdminClient();
  const [{ data: campaigns }, { data: resumes }] = await Promise.all([
    sb.from("campaigns").select("*").order("name"),
    sb.from("resumes").select("id, label, is_default"),
  ]);
  // Stats per campaign
  const stats = await Promise.all(
    (campaigns ?? []).map(async (c) => {
      const [{ count: contactCount }, { count: sendCount }] = await Promise.all([
        sb.from("contacts").select("id", { count: "exact", head: true }).contains("custom_fields", { campaign_tag: c.name }),
        sb.from("sends").select("id", { count: "exact", head: true }).eq("campaign_id", c.id),
      ]);
      return { id: c.id, contactCount: contactCount ?? 0, sendCount: sendCount ?? 0 };
    })
  );
  return { campaigns: campaigns ?? [], resumes: resumes ?? [], stats };
}

const statusVariant = {
  draft: "default", active: "success", paused: "warning", archived: "destructive",
} as const;

export default async function CampaignsPage() {
  const { campaigns, resumes, stats } = await loadData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <p className="text-sm text-slate-500 mt-1">
          A campaign groups a set of templates + a resume + a send window. Set status to <strong>active</strong> to allow drafts to be generated for it.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {campaigns.map(c => {
          const s = stats.find(x => x.id === c.id);
          const resume = resumes.find(r => r.id === c.resume_id);
          return (
            <Card key={c.id}>
              <CardHeader className="border-b border-slate-100">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {c.name}
                      <Badge variant={statusVariant[c.status as keyof typeof statusVariant]}>{c.status}</Badge>
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {c.target_role || <em className="text-slate-400">No target role set</em>}
                    </CardDescription>
                  </div>
                  <CampaignEditor campaign={c} resumes={resumes} />
                </div>
              </CardHeader>
              <CardContent className="text-sm space-y-2 pt-4">
                <div className="flex justify-between">
                  <span className="text-slate-500">Resume</span>
                  <span className="font-medium">{resume?.label ?? <em className="text-slate-400">none / default</em>}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Send window</span>
                  <span className="font-medium">
                    {String(c.send_window_local_hour).padStart(2, "0")}:{String(c.send_window_local_minute).padStart(2, "0")} local
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Send days</span>
                  <span className="font-medium">{c.send_days.map((d: number) => DAY_NAMES[d-1]).join(" ")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Contacts tagged</span>
                  <span className="font-medium">{s?.contactCount ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Sends so far</span>
                  <span className="font-medium">{s?.sendCount ?? 0}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
