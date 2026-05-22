import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { ResumeUploader } from "@/components/resumes/resume-uploader";
import { ResumeActions } from "@/components/resumes/resume-actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadResumes() {
  const sb = createAdminClient();
  const { data } = await sb.from("resumes")
    .select("*").order("is_default", { ascending: false }).order("uploaded_at", { ascending: false });
  return data ?? [];
}

export default async function ResumesPage() {
  const resumes = await loadResumes();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Resumes</h1>
          <p className="text-sm text-slate-500 mt-1">
            Upload multiple resumes (e.g., PM-focused, Strategy-focused) and pick which one each campaign attaches.
            Mark one as <strong>default</strong> — it&apos;s used by any campaign without an explicit assignment.
          </p>
        </div>
        <ResumeUploader />
      </div>

      {resumes.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No resumes yet</CardTitle>
            <CardDescription>Upload your first PDF using the button above.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 divide-y divide-slate-100">
            {resumes.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-4 p-4 hover:bg-slate-50">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="h-10 w-10 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
                    <FileText className="h-5 w-5 text-slate-500" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium flex items-center gap-2">
                      {r.label}
                      {r.is_default && <Badge variant="success">Default</Badge>}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 font-mono break-all">
                      {r.storage_path}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Uploaded {new Date(r.uploaded_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <ResumeActions resumeId={r.id} isDefault={r.is_default} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
