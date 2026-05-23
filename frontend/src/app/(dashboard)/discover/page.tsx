import { DiscoverForm } from "@/components/discover/discover-form";

export const dynamic = "force-dynamic";

export default function DiscoverPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Discover contacts</h1>
        <p className="text-sm text-slate-500 mt-1">
          Find decision-makers at your target companies via Apollo + Hunter.
          Selected results go straight to your contacts with a batch label, then click{" "}
          <strong>Generate Drafts</strong> in Approve & Send to queue them up.
        </p>
      </div>
      <DiscoverForm />
    </div>
  );
}
