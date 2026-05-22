import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Sending accounts, daily caps, send windows, signature.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sender identity</CardTitle>
          <CardDescription>From .env on first load — editable in Phase 2.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-slate-700 space-y-1">
          <div><strong>Name:</strong> Abhinav Kumar</div>
          <div><strong>Email:</strong> abhinavkrrr@gmail.com</div>
          <div><strong>Phone:</strong> +91 6201395251</div>
          <div><strong>LinkedIn:</strong> abhinav-kumar-499004280</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Send window</CardTitle>
          <CardDescription>Recipient-local time, weekdays only (soft rule).</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-slate-700 space-y-1">
          <div><strong>Time:</strong> 10:30 AM</div>
          <div><strong>Days:</strong> Mon, Tue, Wed, Thu, Fri</div>
          <div><strong>Daily cap per account:</strong> 35</div>
          <div><strong>Follow-up cadence:</strong> Day 2, Day 4, Day 6</div>
        </CardContent>
      </Card>
    </div>
  );
}
