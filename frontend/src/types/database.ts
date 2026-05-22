// Database types — initially hand-written, will be auto-generated via:
//   npx supabase gen types typescript --project-id ouzfrefnhlxhpeyufllt > src/types/database.ts
// (after Supabase CLI is wired up in Phase 2)

export type EmailStatus = "unverified" | "valid" | "invalid" | "risky" | "bounced";
export type RoleType = "HR" | "HM" | "employee" | "founder" | "partner" | "other";
export type CampaignStatus = "draft" | "active" | "paused" | "archived";
export type SendStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "sending"
  | "sent"
  | "failed"
  | "skipped";
export type EventType =
  | "sent"
  | "open"
  | "click"
  | "bounce"
  | "reply"
  | "unsubscribe";
export type ReplyClassification =
  | "positive"
  | "negative"
  | "out_of_office"
  | "auto_reply"
  | "question"
  | "other";
export type WarmupPhase = "warmup" | "active" | "paused" | "dead";

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size_bucket: string | null;
  recent_news: Record<string, unknown> | null;
  brief_one_line: string | null;
  created_at: string;
}

export interface Contact {
  id: string;
  company_id: string | null;
  first_name: string;
  last_name: string | null;
  email: string;
  email_status: EmailStatus;
  title: string | null;
  role_type: RoleType | null;
  linkedin_url: string | null;
  source: string | null;
  custom_fields: Record<string, unknown> | null;
  unsubscribed_at: string | null;
  skip_reason: string | null;
  created_at: string;
}

export interface Campaign {
  id: string;
  name: string;
  target_role: string | null;
  resume_id: string | null;
  send_window_local_hour: number;
  send_window_local_minute: number;
  send_days: number[];
  status: CampaignStatus;
  created_at: string;
}

export interface Template {
  id: string;
  campaign_id: string;
  variant_label: string | null;
  subject_tmpl: string;
  body_tmpl: string;
  personalization_level: "light" | "medium";
  weight: number;
  is_followup: boolean;
  followup_step: number | null;
  created_at: string;
}

export interface Send {
  id: string;
  contact_id: string;
  campaign_id: string;
  sequence_step: number;
  template_id: string;
  account_id: string | null;
  resume_id: string | null;
  rendered_subject: string | null;
  rendered_body: string | null;
  scheduled_at: string | null;
  sent_at: string | null;
  message_id: string | null;
  thread_id: string | null;
  status: SendStatus;
  failure_reason: string | null;
  next_followup_at: string | null;
  created_at: string;
}

export interface Account {
  id: string;
  email: string;
  smtp_password_enc: string;
  imap_password_enc: string;
  daily_cap: number;
  sent_today: number;
  sent_today_resets_at: string | null;
  paused_until: string | null;
  health_score: number;
  warmup_phase: WarmupPhase;
  warmup_start_date: string | null;
  created_at: string;
}

export interface Resume {
  id: string;
  label: string;
  storage_path: string;
  uploaded_at: string;
  is_default: boolean;
}

export interface Reply {
  id: string;
  send_id: string;
  received_at: string;
  from_email: string;
  raw_body: string;
  classification: ReplyClassification;
  sentiment_score: number | null;
  requires_action: boolean;
  responded_at: string | null;
}
