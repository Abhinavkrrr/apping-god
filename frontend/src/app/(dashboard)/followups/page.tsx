import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createAdminClient } from "@/lib/supabase/admin";
import { FollowupRow } from "@/components/followups/followup-row";
import { Clock } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ThreadCard {
  last_send_id: string;
  contact_id: string;
  contact_name: string;
  contact_email: string;
  company_name: string;
  sent_at: string;
  days_since: number;
  highest_step: number;
  has_reply: boolean;
}

async function loadThreads() {
  const sb = createAdminClient();

  // Get every SENT send, with contact + reply count.
  // We then group client-side by contact_id and take the highest step.
  const { data: sent } = await sb.from("sends").select(`
    id, contact_id, campaign_id, sequence_step, sent_at,
    contacts(first_name, last_name, email, companies(name))
  `)
    .eq("status", "sent")
    .order("sent_at", { ascending: false })
    .limit(1000);

  if (!sent) return [];

  // Get reply counts for all these sends in one shot
  const sendIds = sent.map((s: any) => s.id);
  const { data: repliesData } = await sb.from("replies").select("send_id")
    .in("send_id", sendIds);
  const repliedSendIds = new Set((repliesData ?? []).map((r: any) => r.send_id));

  // Group by contact, take highest step and most recent send_id
  const byContact = new Map<string, ThreadCard>();
  for (const s of sent as any[]) {
    const c = s.contacts;
    if (!c) continue;
    const key = s.contact_id;
    const existing = byContact.get(key);
    if (!existing || s.sequence_step > existing.highest_step) {
      const days = s.sent_at
        ? Math.floor((Date.now() - new Date(s.sent_at).getTime()) / 86400_000)
        : 0;
      byContact.set(key, {
        last_send_id: s.id,
        contact_id: s.contact_id,
        contact_name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "—",
        contact_email: c.email,
        company_name: c.companies?.name ?? "—",
        sent_at: s.sent_at,
        days_since: days,
        highest_step: s.sequence_step,
        has_reply: repliedSendIds.has(s.id) ||
          // also check any earlier step in this contact's chain
          (existing?.has_reply ?? false),
      });
    } else if (repliedSendIds.has(s.id)) {
      existing.has_reply = true;
    }
  }

  // Sort: awaiting follow-up first (no reply, step < 3, oldest first), then done
  return Array.from(byContact.values()).sort((a, b) => {
    const aWaiting = !a.has_reply && a.highest_step < 3;
    const bWaiting = !b.has_reply && b.highest_step < 3;
    if (aWaiting !== bWaiting) return aWaiting ? -1 : 1;
    return b.days_since - a.days_since;
  });
}

export default async function FollowupsPage() {
  const threads = await loadThreads();
  const awaiting = threads.filter(t => !t.has_reply && t.highest_step < 3).length;
  const replied = threads.filter(t => t.has_reply).length;
  const done = threads.filter(t => t.highest_step >= 3 && !t.has_reply).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Follow-ups</h1>
        <p className="text-sm text-slate-500 mt-1">
          Every contact you&apos;ve sent to lives here. Track which follow-up step they&apos;re at and
          manually send the next one. When a reply comes in, the thread auto-moves out of this
          queue (still shown here as <em>Replied</em>).
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide">Awaiting follow-up</div>
            <div className="text-2xl font-bold mt-1">{awaiting}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide">Replied (in Inbox)</div>
            <div className="text-2xl font-bold mt-1 text-emerald-600">{replied}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide">All 3 follow-ups done</div>
            <div className="text-2xl font-bold mt-1 text-slate-400">{done}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-slate-400" />
            <CardTitle className="text-base">
              All threads <Badge variant="default" className="ml-2">{threads.length}</Badge>
            </CardTitle>
          </div>
          <CardDescription>
            Awaiting follow-ups appear first, sorted oldest first. The autonomous{" "}
            <code className="rounded bg-slate-100 px-1 text-[10px]">followup-daemon</code>{" "}
            (every 15 min) also generates these automatically; use the buttons here to override
            and send immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {threads.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500">
              No threads yet. Send some first-touch emails from <strong>Approve & Send</strong>.
            </div>
          ) : (
            <div>{threads.map(t => <FollowupRow key={t.contact_id} thread={t} />)}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
