import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const classBadgeVariant: Record<string, "success" | "warning" | "destructive" | "info" | "default"> = {
  positive: "success", question: "info", out_of_office: "warning",
  auto_reply: "default", negative: "destructive", other: "default",
};

async function loadReplies() {
  const sb = createAdminClient();
  const { data, count } = await sb.from("replies").select(`
    id, received_at, from_email, raw_body, classification, requires_action,
    sends(rendered_subject, contacts(first_name, email, companies(name)))
  `, { count: "exact" }).order("received_at", { ascending: false }).limit(100);
  return { replies: data ?? [], total: count ?? 0 };
}

export default async function InboxPage() {
  const { replies, total } = await loadReplies();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reply inbox</h1>
        <p className="text-sm text-slate-500 mt-1">
          <Badge variant="info" className="mr-2">{total} replies</Badge>
          Unified across all sending accounts. Classified automatically by Groq Llama 3.3.
        </p>
      </div>

      {replies.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No replies yet</CardTitle>
            <CardDescription>
              The reply-poller runs <strong>every 5 minutes</strong> in the background (Supabase pg_cron + IMAP fetch).
              When recipients reply, they appear here automatically — classified into{" "}
              <em>positive / negative / out-of-office / auto-reply / question</em> by Groq Llama 3.3.
              <br /><br />
              Threads with detected replies are also removed from the Follow-ups queue automatically.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {replies.map((r: any) => (
            <Card key={r.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{r.from_email}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      To: {r.sends?.contacts?.email}{" "}
                      <span className="text-slate-400">·</span>{" "}
                      {r.sends?.contacts?.companies?.name}{" "}
                      <span className="text-slate-400">·</span>{" "}
                      {new Date(r.received_at).toLocaleString()}
                    </div>
                    <div className="text-xs text-slate-700 mt-1 font-medium line-clamp-1">
                      Re: {r.sends?.rendered_subject}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={classBadgeVariant[r.classification ?? "other"]}>
                      {r.classification}
                    </Badge>
                    {r.requires_action && <Badge variant="warning">action</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="text-xs text-slate-600 whitespace-pre-wrap line-clamp-6 bg-slate-50 rounded p-3">
                  {r.raw_body?.slice(0, 600) || <em className="text-slate-400">No body extracted</em>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
