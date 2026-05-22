"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { addContact } from "@/app/actions/contacts";
import { render, buildContext, plainToTrackedHtml } from "@/lib/send/render";

const MASTER_CAMPAIGN_NAME = "Outreach";

/**
 * Adds a contact AND immediately creates a pending_approval draft for them,
 * using the master Outreach template. The draft lands straight in the
 * approval queue ready to send.
 */
export async function addContactAndQueue(input: {
  first_name: string;
  last_name?: string;
  email: string;
  company_name: string;
  company_brief?: string;
  title?: string;
}) {
  const sb = createAdminClient();

  // 1) Add contact (returns id)
  const addResult = await addContact({ ...input, source: "quick-add" });
  if (!addResult.ok) return { ok: false, error: addResult.error };
  const contactId = addResult.contact_id!;

  // 2) Fetch master campaign + first-touch template
  const { data: campaign } = await sb.from("campaigns").select("*")
    .eq("name", MASTER_CAMPAIGN_NAME).single();
  if (!campaign) return { ok: false, error: `Master campaign "${MASTER_CAMPAIGN_NAME}" not found.` };
  const { data: seq } = await sb.from("sequences").select("*, templates(*)")
    .eq("campaign_id", campaign.id).eq("step_number", 0).single();
  if (!seq?.templates) return { ok: false, error: "Master template not found." };
  const template = (seq as any).templates;

  // 3) Get the full contact + company we just inserted
  const { data: contact } = await sb.from("contacts")
    .select("*, companies(*)").eq("id", contactId).single();
  if (!contact) return { ok: false, error: "Contact lookup failed after insert." };

  const company = (contact as any).companies;
  const sendId = randomUUID();
  const ctx = buildContext(contact as any, company, {
    company_brief_one_line: company?.brief_one_line ?? input.company_brief ?? "",
  });
  const subject = render(template.subject_tmpl, ctx);
  const text = render(template.body_tmpl, ctx);
  const html = plainToTrackedHtml(text, sendId);

  // 4) Create draft + approval row
  const { error } = await sb.from("sends").insert({
    id: sendId,
    contact_id: contactId,
    campaign_id: campaign.id,
    sequence_step: 0,
    template_id: template.id,
    resume_id: campaign.resume_id,
    rendered_subject: subject,
    rendered_body: html,
    status: "pending_approval",
  });
  if (error) return { ok: false, error: error.message };
  await sb.from("approvals").insert({ send_id: sendId, status: "pending" });

  revalidatePath("/approve");
  revalidatePath("/contacts");
  revalidatePath("/");
  return { ok: true, send_id: sendId, contact_email: input.email };
}
