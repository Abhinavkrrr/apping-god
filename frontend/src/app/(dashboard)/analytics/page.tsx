import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const sections = [
  { title: "Funnel", desc: "Sent → Delivered → Opened → Clicked → Replied → Positive" },
  { title: "Campaign performance", desc: "Per-campaign reply rate, conversion to interview" },
  { title: "Account health", desc: "Per-Gmail sends today, bounce rate, warmup phase" },
  { title: "Deliverability", desc: "Valid / risky / invalid breakdown, top bouncing domains" },
  { title: "Reply trends", desc: "Replies over time, classification mix" },
  { title: "Activity log", desc: "Every event today: sent, opened, clicked, replied" },
];

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-slate-500 mt-1">
          Six sections — full breakdown of how your outreach is performing.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => (
          <Card key={s.title}>
            <CardHeader>
              <CardTitle className="text-base">{s.title}</CardTitle>
              <CardDescription>{s.desc}</CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-slate-500">
              Charts wire up in Phase 6.
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
