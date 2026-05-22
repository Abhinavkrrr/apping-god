import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Send, MailOpen, MessageSquare, Activity } from "lucide-react";

const tiles = [
  { label: "Sent today", value: "—", icon: Send, hint: "Across all accounts" },
  { label: "Opens today", value: "—", icon: MailOpen, hint: "Tracked via pixel" },
  { label: "Replies today", value: "—", icon: MessageSquare, hint: "Detected via IMAP" },
  { label: "Active accounts", value: "—", icon: Activity, hint: "Healthy + warm" },
];

export default function OverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-slate-500 mt-1">
          Live status of your outreach pipeline.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Card key={t.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">
                  {t.label}
                </CardTitle>
                <Icon className="h-4 w-4 text-slate-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{t.value}</div>
                <p className="text-xs text-slate-500 mt-1">{t.hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Welcome, Abhinav.</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600 space-y-3">
          <p>
            Foundations are live. As we build out Phases 2–6, real data will start flowing into the tiles above.
          </p>
          <p>
            <strong>Next:</strong> import your 525-contact CSV from{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
              Apping Database - recipients.csv
            </code>{" "}
            via the Contacts page, then approve your first batch on the Approve page.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
