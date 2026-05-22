"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export async function addAccount(input: {
  email: string;
  app_password: string;
  daily_cap?: number;
}) {
  const sb = createAdminClient();
  // For v1: store app password as-is in smtp_password_enc.
  // Phase-N: switch to libsodium encryption via Supabase Vault.
  const { error } = await sb.from("accounts").insert({
    email: input.email.toLowerCase().trim(),
    smtp_password_enc: input.app_password,
    imap_password_enc: input.app_password,
    daily_cap: input.daily_cap ?? 35,
    warmup_phase: "warmup",
    warmup_start_date: new Date().toISOString().slice(0, 10),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

export async function updateAccount(
  id: string,
  patch: { daily_cap?: number; warmup_phase?: "warmup" | "active" | "paused" | "dead"; paused_until?: string | null }
) {
  const sb = createAdminClient();
  const { error } = await sb.from("accounts").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

export async function deleteAccount(id: string) {
  const sb = createAdminClient();
  const { error } = await sb.from("accounts").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

export async function pauseAccount(id: string, hours: number) {
  const sb = createAdminClient();
  const until = new Date(Date.now() + hours * 3600_000).toISOString();
  return updateAccount(id, { warmup_phase: "paused", paused_until: until });
}

export async function resumeAccount(id: string) {
  const sb = createAdminClient();
  return updateAccount(id, { warmup_phase: "active", paused_until: null });
}
