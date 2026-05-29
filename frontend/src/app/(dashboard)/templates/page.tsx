import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createAdminClient } from "@/lib/supabase/admin";
import { TemplateEditor } from "@/components/templates/template-editor";
import { NewTemplateModal } from "@/components/templates/new-template-modal";
import { ResumeToggle } from "@/components/templates/resume-toggle";
import { listResumeOptions } from "@/app/actions/resumes";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadTemplates() {
  const sb = createAdminClient();
  // Select resume_id too so each campaign card knows what CV (if any) is wired up.
  const { data: campaigns } = await sb
    .from("campaigns").select("id, name, resume_id").eq("status", "active").order("name");

  if (!campaigns) return { groups: [], campaigns: [], resumeOptions: [] };

  const [groups, resumeOptions] = await Promise.all([
    Promise.all(
      campaigns.map(async (c) => {
        const { data: templates } = await sb
          .from("templates").select("*")
          .eq("campaign_id", c.id)
          .order("is_followup", { ascending: true })
          .order("followup_step", { ascending: true, nullsFirst: true });
        return { campaign: c, templates: templates ?? [] };
      })
    ),
    listResumeOptions(),
  ]);
  return { groups, campaigns, resumeOptions };
}

export default async function TemplatesPage() {
  const { groups, campaigns, resumeOptions } = await loadTemplates();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
          <p className="text-sm text-slate-500 mt-1">
            Edit any template inline. <strong>Saving re-renders every pending draft</strong> using
            that template — your edits show up in Approve queue and each Preview immediately.
            Use <code className="rounded bg-slate-100 px-1 text-xs">{`{{first_name}}`}</code>,
            <code className="rounded bg-slate-100 px-1 text-xs mx-1">{`{{company}}`}</code>, etc., and
            <code className="rounded bg-slate-100 px-1 text-xs ml-1">**bold**</code> for emphasis.
          </p>
        </div>
        <NewTemplateModal campaigns={campaigns} />
      </div>

      {groups.map(({ campaign, templates }) => (
        <Card key={campaign.id}>
          <CardHeader className="border-b border-slate-100">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2">
                  {campaign.name}
                  <Badge variant="info">{templates.length} templates</Badge>
                </CardTitle>
                <CardDescription>
                  4-step sequence: first-touch + 3 follow-ups (Day 0 → 2 → 4 → 6).
                </CardDescription>
              </div>
              <ResumeToggle
                campaignId={campaign.id}
                campaignName={campaign.name}
                currentResumeId={(campaign as any).resume_id ?? null}
                options={resumeOptions}
              />
            </div>
          </CardHeader>
          <CardContent className="divide-y divide-slate-100 p-0">
            {templates.map((t) => (
              <div key={t.id} className="flex items-start justify-between gap-4 p-4 hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-slate-900">
                      {t.is_followup ? `Follow-up #${t.followup_step}` : "First touch"}
                    </span>
                    <Badge variant="default">{t.variant_label}</Badge>
                    <Badge variant={t.personalization_level === "medium" ? "success" : "default"}>
                      {t.personalization_level}
                    </Badge>
                  </div>
                  <div className="text-xs text-slate-600 mt-1 line-clamp-1 font-medium">
                    {t.subject_tmpl}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 line-clamp-2 whitespace-pre-wrap">
                    {t.body_tmpl.slice(0, 200)}…
                  </div>
                </div>
                <TemplateEditor template={t} campaignName={campaign.name} />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
