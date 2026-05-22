import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { AddContactModal } from "@/components/contacts/add-contact-modal";
import { CsvUploadModal } from "@/components/contacts/csv-upload-modal";
import { ContactActions } from "@/components/contacts/contact-actions";
import { listBatches } from "@/app/actions/contacts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ContactRow {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  email_status: string;
  title: string | null;
  source: string | null;
  unsubscribed_at: string | null;
  custom_fields: Record<string, unknown> | null;
  companies: { name: string } | null;
}

async function loadContacts(batchFilter?: string) {
  const sb = createAdminClient();
  let q = sb.from("contacts").select(
    "id, first_name, last_name, email, email_status, title, source, unsubscribed_at, custom_fields, companies(name)",
    { count: "exact" }
  ).order("created_at", { ascending: false }).limit(300);

  if (batchFilter && batchFilter !== "__all__") {
    if (batchFilter === "__none__") {
      // contacts with no batch label
      q = q.or("custom_fields.is.null,custom_fields->>batch_label.is.null");
    } else {
      q = q.eq("custom_fields->>batch_label", batchFilter);
    }
  }

  const [{ data, count }, { count: companyCount }, batches] = await Promise.all([
    q,
    sb.from("companies").select("id", { count: "exact", head: true }),
    listBatches(),
  ]);
  return {
    contacts: (data as unknown as ContactRow[]) || [],
    total: count ?? 0,
    companyCount: companyCount ?? 0,
    batches,
  };
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

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  const params = await searchParams;
  const batchFilter = params.batch ?? "__all__";
  const { contacts, total, companyCount, batches } = await loadContacts(batchFilter);

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
        <div className="flex gap-2">
          <AddContactModal />
          <CsvUploadModal />
        </div>
      </div>

      {batches.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Filter by batch</CardTitle>
            <CardDescription className="text-xs">
              Each CSV import is tagged with a batch name so you can manage them separately.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-2">
              <Link href="/contacts?batch=__all__">
                <Badge variant={batchFilter === "__all__" ? "info" : "default"} className="cursor-pointer">
                  All ({total})
                </Badge>
              </Link>
              {batches.map(b => (
                <Link key={b.label} href={`/contacts?batch=${encodeURIComponent(b.label)}`}>
                  <Badge variant={batchFilter === b.label ? "info" : "default"} className="cursor-pointer">
                    {b.label} ({b.count})
                  </Badge>
                </Link>
              ))}
              <Link href="/contacts?batch=__none__">
                <Badge variant={batchFilter === "__none__" ? "info" : "default"} className="cursor-pointer">
                  No batch ({contacts.length})
                </Badge>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-slate-400" />
            <CardTitle className="text-base">
              {batchFilter === "__all__"
                ? `Recent contacts (first 300)`
                : `Batch "${batchFilter === "__none__" ? "no batch" : batchFilter}" (first 300)`}
            </CardTitle>
          </div>
          <CardDescription>
            Sorted newest first. Click the trash icon to delete (also removes existing sends).
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
                  <th className="px-4 py-3 text-left font-medium">Batch</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {contacts.map((c) => {
                  const batchLabel = (c.custom_fields?.batch_label as string | undefined) ?? null;
                  return (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        {c.first_name} {c.last_name ?? ""}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">{c.email}</td>
                      <td className="px-4 py-2.5 text-slate-700">
                        {c.companies?.name ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">
                        {batchLabel ? <Badge variant="default">{batchLabel}</Badge> : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-2.5"><StatusBadge status={c.email_status} /></td>
                      <td className="px-4 py-2.5 text-right">
                        <ContactActions contactId={c.id} email={c.email} />
                      </td>
                    </tr>
                  );
                })}
                {contacts.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    {batchFilter === "__all__"
                      ? "No contacts yet. Add one or import a CSV above."
                      : `No contacts in batch "${batchFilter}".`}
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
