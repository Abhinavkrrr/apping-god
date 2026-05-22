"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteContact } from "@/app/actions/contacts";

export function ContactActions({ contactId, email }: { contactId: string; email: string }) {
  const [isPending, startTransition] = useTransition();

  function remove() {
    if (!confirm(`Delete ${email}? Their existing sends will also be deleted.`)) return;
    startTransition(async () => {
      const r = await deleteContact(contactId);
      if (r.ok) toast.success("Deleted.");
      else toast.error("Failed.");
    });
  }

  return (
    <Button variant="ghost" size="sm" onClick={remove} disabled={isPending}>
      <Trash2 className="h-3.5 w-3.5 text-red-600" />
    </Button>
  );
}
