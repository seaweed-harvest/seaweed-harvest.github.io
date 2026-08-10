begin;

create table if not exists public.ag_site_feedback (
  id uuid primary key default gen_random_uuid(),
  client_submission_id uuid not null unique,
  created_at timestamptz not null default now(),
  source_app text not null check (source_app in ('aggregation', 'tide')),
  source_page text not null,
  page_url text,
  feedback_type text not null check (feedback_type in ('improvement', 'change', 'problem')),
  message text not null check (char_length(message) between 3 and 2000),
  submitter_user_id uuid references auth.users(id) on delete set null,
  submitter_name text,
  submitter_email text,
  locale text not null default 'en',
  client_fingerprint_hash text not null,
  user_agent text,
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'planned', 'closed')),
  slack_status text not null default 'pending'
    check (slack_status in ('pending', 'sent', 'failed', 'not_configured')),
  slack_error text
);

create index if not exists ag_site_feedback_created_at_idx
  on public.ag_site_feedback (created_at desc);

create index if not exists ag_site_feedback_status_created_at_idx
  on public.ag_site_feedback (status, created_at desc);

create index if not exists ag_site_feedback_client_rate_idx
  on public.ag_site_feedback (client_fingerprint_hash, created_at desc);

alter table public.ag_site_feedback enable row level security;

revoke all on table public.ag_site_feedback from anon, authenticated;
grant all on table public.ag_site_feedback to service_role;

comment on table public.ag_site_feedback is
  'Improvement, change and problem reports submitted from Seaweed Harvest and Seaweed Tide Planner.';
comment on column public.ag_site_feedback.client_submission_id is
  'Client-generated idempotency key retained across offline retries.';

commit;
