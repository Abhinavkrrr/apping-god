import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ContactRow {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  email_status: string;
  title: string | null;
  role_type: string | null;
  source: string | null;
  unsubscribed_at: string | null;
  companies: { name: string; brief_one_line: string | null } | null;
}

async function loadContacts() {
  const sb = createAdminClient();
  const [{ data, count }, { count: companyCount }] = await Promise.all([
    sb.from("contacts")
      .select("id, first_name, last_name, email, email_status, title, role_type, source, unsubscribed_at, companies(name, brief_one_line)", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(100),
    sb.from("companies").select("id", { count: "exact", head: true }),
  ]);
  return { contacts: (data as unknown as ContactRow[]) || [], total: count ?? 0, companyCount: companyCount ?? 0 };
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    unverified: "bg-slate-100 text-slate-700",
    valid: "bg-emerald-50 text-emerald-700 border-emerald-200",
    invalid: "bg-red-50 text-red-700 border-red-200",
    risky: "bg-amber-50 text-amber-700 border-amber-200",
    bounced: "bg-red-100 text-red-800 border-red-300",
  };
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${map[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}

export default async function ContactsPage() {
  const { contacts, total, companyCount } = await loadContacts();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-slate-500 mt-1">
            <span className="font-semibold text-slate-700">{total.toLocaleString()}</span> contacts across{" "}
            <span className="font-semibold text-slate-700">{companyCount.toLocaleString()}</span> companies.
          </p>
        </div>
        <Link href="/contacts/import">
          <Button>
            <Upload className="mr-2 h-4 w-4" /> Import CSV
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader className="border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-slate-400" />
            <CardTitle className="text-base">Recent contacts (first 100)</CardTitle>
          </div>
          <CardDescription>
            Sorted newest first. Full search + filters land in Phase 3.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Email</th>
                  <th className="px-4 py-3 text-left font-medium">Company</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {contacts.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-900">
                      {c.first_name} {c.last_name ?? ""}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{c.email}</td>
                    <td className="px-4 py-2.5 text-slate-700">
                      {c.companies?.name ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={c.email_status} />
                    </td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs">{c.source ?? "—"}</td>
                  </tr>
                ))}
                {contacts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                      No contacts yet. Run the seed CSV importer or upload a file.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
