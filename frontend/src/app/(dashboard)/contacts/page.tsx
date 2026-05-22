import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Users } from "lucide-react";

export default function ContactsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-slate-500 mt-1">
            All recipients across all campaigns. 525 ready to import from your seed CSV.
          </p>
        </div>
        <Link href="/contacts/import">
          <Button>
            <Upload className="mr-2 h-4 w-4" /> Import CSV
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-slate-400" />
            <CardTitle>Empty contacts table</CardTitle>
          </div>
          <CardDescription>
            Run the CSV import to load your 525 seed contacts. Schema is live in Supabase.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-slate-600">
          <p>Contact table view comes online in Phase 1 once schema is applied.</p>
        </CardContent>
      </Card>
    </div>
  );
}
