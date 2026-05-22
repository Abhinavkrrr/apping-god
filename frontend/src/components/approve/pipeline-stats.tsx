import { Users, Send, Clock, CheckCircle2, XCircle } from "lucide-react";

interface Stats {
  total_contacts: number;
  pending: number;
  approved: number;
  sent: number;
  skipped: number;
  not_yet_drafted: number;
}

export function PipelineStats({ stats }: { stats: Stats }) {
  const items = [
    { label: "Total contacts", value: stats.total_contacts, icon: Users, color: "text-slate-700", bg: "bg-slate-100" },
    { label: "Pending review", value: stats.pending, icon: Clock, color: "text-amber-700", bg: "bg-amber-50" },
    { label: "Sent", value: stats.sent, icon: CheckCircle2, color: "text-emerald-700", bg: "bg-emerald-50" },
    { label: "Not yet drafted", value: stats.not_yet_drafted, icon: Send, color: "text-blue-700", bg: "bg-blue-50" },
    { label: "Rejected", value: stats.skipped, icon: XCircle, color: "text-red-700", bg: "bg-red-50" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
      {items.map(item => {
        const Icon = item.icon;
        return (
          <div key={item.label} className={`rounded-md border border-slate-200 p-3 ${item.bg}`}>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500 font-medium">
              <Icon className={`h-3 w-3 ${item.color}`} />
              {item.label}
            </div>
            <div className={`text-xl font-bold mt-1 ${item.color}`}>{item.value.toLocaleString()}</div>
          </div>
        );
      })}
    </div>
  );
}
