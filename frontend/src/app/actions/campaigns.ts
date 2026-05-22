"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export async function updateCampaign(
  campaignId: string,
  patch: {
    name?: string;
    target_role?: string;
    resume_id?: string | null;
    send_window_local_hour?: number;
    send_window_local_minute?: number;
    send_days?: number[];
    status?: "draft" | "active" | "paused" | "archived";
  }
) {
  const sb = createAdminClient();
  const { error } = await sb.from("campaigns").update(patch).eq("id", campaignId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/campaigns");
  revalidatePath("/templates");
  return { ok: true };
}
