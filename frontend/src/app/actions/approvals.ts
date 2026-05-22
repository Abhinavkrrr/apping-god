"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

const FUNCTION_URL = `https://${process.env.NEXT_PUBLIC_SUPABASE_URL!.split("//")[1].split(".")[0]}.functions.supabase.co/send-worker`;

/** Approve a send → updates status to 'approved' and sets scheduled_at to now (or next send window). */
export async function approveSend(sendId: string, editedSubject?: string, editedBody?: string) {
  const sb = createAdminClient();
  if (editedSubject || editedBody) {
    await sb.from("sends").update({
      ...(editedSubject ? { rendered_subject: editedSubject } : {}),
      ...(editedBody ? { rendered_body: editedBody } : {}),
    }).eq("id", sendId);
  }
  await sb.from("sends").update({
    status: "approved",
    scheduled_at: new Date().toISOString(),
  }).eq("id", sendId);
  await sb.from("approvals").update({
    status: "approved",
    edited_subject: editedSubject ?? null,
    edited_body: editedBody ?? null,
    reviewed_at: new Date().toISOString(),
  }).eq("send_id", sendId);
  revalidatePath("/approve");
  return { ok: true };
}

export async function rejectSend(sendId: string) {
  const sb = createAdminClient();
  await sb.from("sends").update({ status: "skipped" }).eq("id", sendId);
  await sb.from("approvals").update({
    status: "rejected", reviewed_at: new Date().toISOString(),
  }).eq("send_id", sendId);
  revalidatePath("/approve");
  return { ok: true };
}

export async function bulkApprove(sendIds: string[]) {
  const sb = createAdminClient();
  await sb.from("sends").update({
    status: "approved",
    scheduled_at: new Date().toISOString(),
  }).in("id", sendIds);
  await sb.from("approvals").update({
    status: "approved", reviewed_at: new Date().toISOString(),
  }).in("send_id", sendIds);
  revalidatePath("/approve");
  return { ok: true, count: sendIds.length };
}

/** Send a single approved draft via Edge Function (manual immediate dispatch). */
export async function dispatchNow(sendId: string) {
  const sb = createAdminClient();
  const { data: send } = await sb.from("sends").select(`
    id, contact_id, resume_id, rendered_subject, rendered_body,
    contacts(email)
  `).eq("id", sendId).single();

  if (!send || !(send as any).contacts) return { ok: false, error: "send or contact missing" };

  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: (send as any).contacts.email,
      subject: send.rendered_subject,
      text_body: send.rendered_body,
      html_body: send.rendered_body, // worker will inject tracking; for simplicity we pass plain
      resume_id: send.resume_id,
      log_send_id: send.id,
    }),
  });
  const out = await res.json();
  revalidatePath("/approve");
  revalidatePath("/");
  return { ok: res.ok && out.ok, result: out };
}
