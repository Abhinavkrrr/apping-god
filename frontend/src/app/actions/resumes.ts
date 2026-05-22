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
