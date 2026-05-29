import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Ban, Clock, ShieldCheck } from "lucide-react";
import { listBounces } from "@/app/actions/bounces";
import { BounceRowActions } from "@/components/bounces/bounce-row-actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BouncesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: "all" | "hard" | "soft" }>;
}) {
  const params = await searchParams;
  const filter = params.filter ?? "all";
  const { bounces, stats } = await listBounces({ filter });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-amber-600" />
          Bounces
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Mail-delivery failures. Bounced contacts are auto-blocked from future sends to
          protect your Gmail sender reputation. Use Restore only if you're sure the
          address is valid (e.g. the recipient server was temporarily down).
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
          label="Total bounces" value={stats.total}
        />
        <StatCard
          icon={<Ban className="h-4 w-4 text-red-600" />}
          label="Hard bounces" value={stats.hard}
          desc="address dead — won't recover"
        />
        <StatCard
          icon={<Clock className="h-4 w-4 text-amber-600" />}
          label="Soft bounces" value={stats.soft}
          desc="temporary — may recover"
        />
        <StatCard
          icon={<ShieldCheck className="h-4 w-4 text-emerald-600" />}
          label="Contacts blocked" value={stats.contacts_blocked}
          desc="will not be re-pitched"
        />
      </div>

      {/* Filter chips */}
      <div className="flex gap-2">
        {(["all", "hard", "soft"] as const).map(f => (
          <Link key={f} href={`/bounces${f === "all" ? "" : `?filter=${f}`}`}>
            <Badge
              variant={filter === f ? "info" : "default"}
              className="cursor-pointer capitalize"
            >
              {f === "all" ? `All (${stats.total})` :
               f === "hard" ? `Hard only (${stats.hard})` :
               `Soft only (${stats.soft})`}
            </Badge>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="text-base">Recent bounces (latest 500)</CardTitle>
          <CardDescription className="text-xs">
            Sender shows the mail-delivery daemon, not the original recipient.
            The "Recipient" column is the address that actually failed (parsed from the DSN).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Received</th>
                  <th className="px-4 py-3 text-left font-medium">Type</th>
                  <th className="px-4 py-3 text-left font-medium">Contact</th>
                  <th className="px-4 py-3 text-left font-medium">Recipient</th>
                  <th className="px-4 py-3 text-left font-medium">Diagnostic</th>
                  <th className="px-4 py-3 text-left font-medium">Campaign</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bounces.map(b => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">
                      <div>{new Date(b.received_at).toLocaleDateString("en-IN")}</div>
                      <div className="text-xs text-slate-400">
                        {new Date(b.received_at).toLocaleTimeString("en-IN", {
                          hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
                        })} IST
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <BounceTypeBadge type={b.bounce_type} status={b.smtp_status} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900">{b.contact_name}</div>
                      <div className="text-xs text-slate-500">{b.company_name}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700 font-mono text-xs">
                      {b.failed_recipient || b.contact_email}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600 max-w-md">
                      <div className="truncate" title={b.diagnostic ?? ""}>
                        {b.diagnostic ?? <span className="text-slate-400">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">{b.campaign_name}</td>
                    <td className="px-4 py-2.5 text-right">
                      <BounceRowActions
                        bounceId={b.id}
                        contactId={b.contact_id}
                        contactName={b.contact_name}
                        isBlocked={!!b.contact_skip_reason}
                      />
                    </td>
                  </tr>
                ))}
                {bounces.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    {filter === "all"
                      ? "No bounces recorded. Your Gmail sender reputation is healthy."
                      : `No ${filter} bounces.`}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, desc }: {
  icon: React.ReactNode; label: string; value: number; desc?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-slate-500 uppercase tracking-wide">
          {icon} {label}
        </div>
        <div className="text-2xl font-semibold text-slate-900 mt-1">{value.toLocaleString()}</div>
        {desc && <div className="text-[10px] text-slate-400 mt-0.5">{desc}</div>}
      </CardContent>
    </Card>
  );
}

function BounceTypeBadge({ type, status }: { type: string; status: string | null }) {
  const map: Record<string, string> = {
    hard: "bg-red-100 text-red-800 border-red-300",
    soft: "bg-amber-100 text-amber-800 border-amber-300",
    unknown: "bg-slate-100 text-slate-700 border-slate-300",
  };
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${map[type] ?? map.unknown}`}>
      {type}{status && <span className="ml-1 font-mono opacity-70">{status}</span>}
    </span>
  );
}
