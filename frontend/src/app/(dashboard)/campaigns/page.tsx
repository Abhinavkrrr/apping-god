import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function CampaignsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <p className="text-sm text-slate-500 mt-1">
          Create, pause, and archive your outreach campaigns.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>No campaigns yet</CardTitle>
          <CardDescription>
            Campaigns will appear here once Phase 2 wires up the send pipeline.
            Three seed campaigns (VC, Product, Growth) will be created automatically
            from your existing CSV taxonomy.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-slate-600">
          <p>Coming in Phase 2.</p>
        </CardContent>
      </Card>
    </div>
  );
}
