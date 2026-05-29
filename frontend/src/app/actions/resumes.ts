"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export async function uploadResume(formData: FormData) {
  const sb = createAdminClient();
  const file = formData.get("file") as File | null;
  const label = (formData.get("label") as string) || "Untitled resume";
  if (!file) return { ok: false, error: "no file" };

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = `user-${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  const { error: upErr } = await sb.storage
    .from("resumes")
    .upload(fileName, buffer, { contentType: file.type || "application/pdf" });
  if (upErr) return { ok: false, error: upErr.message };

  const { data: row, error } = await sb.from("resumes").insert({
    label, storage_path: fileName, is_default: false,
  }).select().single();
  if (error) return { ok: false, error: error.message };

  revalidatePath("/resumes");
  return { ok: true, id: row.id };
}

export async function setDefaultResume(resumeId: string) {
  const sb = createAdminClient();
  await sb.from("resumes").update({ is_default: false }).eq("is_default", true);
  await sb.from("resumes").update({ is_default: true }).eq("id", resumeId);
  revalidatePath("/resumes");
  return { ok: true };
}

export async function deleteResume(resumeId: string) {
  const sb = createAdminClient();
  const { data: row } = await sb.from("resumes").select("storage_path").eq("id", resumeId).single();
  if (row?.storage_path) await sb.storage.from("resumes").remove([row.storage_path]);
  await sb.from("resumes").delete().eq("id", resumeId);
  revalidatePath("/resumes");
  return { ok: true };
}

export interface ResumeOption {
  id: string;
  label: string;
  is_default: boolean;
}

/** List every resume available for attachment. Used by the Templates page
 * dropdown so the user picks which PDF goes on each campaign's first-touch. */
export async function listResumeOptions(): Promise<ResumeOption[]> {
  const sb = createAdminClient();
  const { data } = await sb.from("resumes")
    .select("id, label, is_default")
    .order("is_default", { ascending: false })
    .order("uploaded_at", { ascending: false });
  return (data ?? []) as ResumeOption[];
}

/** Set (or clear) the resume attached to a campaign's outgoing first-touch
 * emails. Pass resumeId=null to detach (no CV). The dispatcher reads
 * sends.resume_id per row, so we also BACKFILL every pending_approval
 * draft in this campaign so the toggle takes effect immediately — without
 * this, only NEWLY generated drafts would pick up the change.
 *
 * Returns counts so the UI toast can say e.g.
 *   "Attached 'Abhinav Kumar IITB' to AI Builder Internship + 538 pending drafts"
 *
 * Note: follow-up sends always have resume_id=NULL by design (followup-daemon
 * explicitly sets it that way — you don't re-attach the CV on every nudge),
 * so this only affects first-touch drafts in practice.
 */
export async function setCampaignResume(
  campaignId: string,
  resumeId: string | null,
): Promise<{
  ok: boolean;
  drafts_updated?: number;
  resume_label?: string | null;
  error?: string;
}> {
  const sb = createAdminClient();

  const { error: cErr } = await sb.from("campaigns")
    .update({ resume_id: resumeId })
    .eq("id", campaignId);
  if (cErr) return { ok: false, error: `campaign update: ${cErr.message}` };

  // Backfill pending drafts so the toggle takes effect for drafts already
  // in /approve. Only touch pending_approval — sends already 'approved'
  // (scheduled for cloud dispatch) shouldn't be retroactively modified.
  const { data: updated } = await sb.from("sends")
    .update({ resume_id: resumeId })
    .eq("campaign_id", campaignId)
    .eq("status", "pending_approval")
    .select("id");

  let resume_label: string | null = null;
  if (resumeId) {
    const { data: r } = await sb.from("resumes").select("label").eq("id", resumeId).maybeSingle();
    resume_label = r?.label ?? null;
  }

  revalidatePath("/templates");
  revalidatePath("/approve");
  revalidatePath("/");
  return {
    ok: true,
    drafts_updated: updated?.length ?? 0,
    resume_label,
  };
}
