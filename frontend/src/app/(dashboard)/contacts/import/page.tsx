import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ImportPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import contacts</h1>
        <p className="text-sm text-slate-500 mt-1">
          Upload a CSV. Expected columns: name, email, company, campaign, company_brief.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>CSV upload</CardTitle>
          <CardDescription>
            The full upload + column mapping wizard ships in Phase 3.
            For now, the seed CSV is loaded server-side via the
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs mx-1">scripts/import_seed_csv.ts</code>
            script.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-slate-600">
          <p>Coming in Phase 3.</p>
        </CardContent>
      </Card>
    </div>
  );
}
