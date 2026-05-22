import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function InboxPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reply inbox</h1>
        <p className="text-sm text-slate-500 mt-1">
          Unified view of every reply across all sending accounts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>No replies yet</CardTitle>
          <CardDescription>
            IMAP-based reply detection comes online in Phase 4.
            Replies are auto-classified into positive / negative / out-of-office / auto-reply.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
