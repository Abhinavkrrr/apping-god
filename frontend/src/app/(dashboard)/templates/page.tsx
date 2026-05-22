import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function TemplatesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
        <p className="text-sm text-slate-500 mt-1">
          Author the email body and subject. Insert {"{{first_name}}"}, {"{{company}}"}, {"{{company_brief_one_line}}"}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Default template (locked for v1)</CardTitle>
          <CardDescription>
            Subject: <em>Exploring Internship Roles in Product Management / Founder&apos;s Office / Strategy at {"{{company}}"}</em>
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-slate-600 space-y-2">
          <p>One template + three threaded follow-ups (day 2, 4, 6).</p>
          <p>Editing UI ships in Phase 3.</p>
        </CardContent>
      </Card>
    </div>
  );
}
