import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ResumesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Resumes</h1>
        <p className="text-sm text-slate-500 mt-1">
          Upload and swap multiple resume PDFs. Each campaign attaches its assigned resume.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>No resumes uploaded</CardTitle>
          <CardDescription>
            Upload UI ships in Phase 3. The seed resume
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs mx-1">Resume_AbhinavKumar_IITB.pdf</code>
            will be uploaded to Supabase Storage by the seed script.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
