import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createAdminClient } from "@/lib/supabase/admin";
import { AddAccountModal } from "@/components/settings/add-account-modal";
import { AccountRow } from "@/components/settings/account-row";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadData() {
  const sb = createAdminClient();
  const { data: accounts } = await sb.from("accounts").select("*")
    .order("created_at", { ascending: true });
  return { accounts: accounts ?? [] };
}

export default async function SettingsPage() {
  const { accounts } = await loadData();
  const active = accounts.filter(a => a.warmup_phase === "active" || a.warmup_phase === "warmup").length;
  const totalCap = accounts.reduce((s, a) => s + (a.warmup_phase !== "dead" ? a.daily_cap : 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Sender identity and Gmail sending accounts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sender identity</CardTitle>
          <CardDescription>From .env (env-var editable, dashboard edit lands in Phase 7).</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-slate-700 space-y-1.5">
          <div className="flex justify-between"><span className="text-slate-500">Name</span><span className="font-medium">Abhinav Kumar</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Phone</span><span className="font-medium">+91 6201395251</span></div>
          <div className="flex justify-between"><span className="text-slate-500">LinkedIn</span><span className="font-medium">abhinav-kumar-499004280</span></div>
          <div className="flex justify-between"><span className="text-slate-500">College logo</span><span className="font-medium text-emerald-600">✓ uploaded</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              Gmail sending accounts
              <Badge variant={active > 0 ? "success" : "warning"}>{active} active</Badge>
              <Badge variant="default">{totalCap} sends/day capacity</Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              Add more accounts to scale daily volume. Each new account auto-enters 14-day warmup
              (5 sends/day for 3 days → 10 → 20 → {accounts[0]?.daily_cap ?? 35}).
            </CardDescription>
          </div>
          <AddAccountModal />
        </CardHeader>
        <CardContent className="p-0">
          {accounts.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-slate-500">
              No accounts added yet. The system is falling back to the .env GMAIL_USER for sends.
              Add Gmail accounts above to enable rotation.
            </div>
          ) : (
            <div>{accounts.map(a => <AccountRow key={a.id} account={a} />)}</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Send window</CardTitle>
          <CardDescription>Recipient-local time, weekdays only (soft rule).</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-slate-700 space-y-1.5">
          <div className="flex justify-between"><span className="text-slate-500">Default time</span><span className="font-medium">10:30 AM</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Days</span><span className="font-medium">Mon, Tue, Wed, Thu, Fri</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Default daily cap (per account)</span><span className="font-medium">35</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Follow-up cadence</span><span className="font-medium">Day 2, Day 4, Day 6</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Reply check frequency</span><span className="font-medium text-emerald-600">every 5 min (pg_cron)</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Follow-up generation</span><span className="font-medium text-emerald-600">every 15 min (pg_cron)</span></div>
        </CardContent>
      </Card>
    </div>
  );
}
