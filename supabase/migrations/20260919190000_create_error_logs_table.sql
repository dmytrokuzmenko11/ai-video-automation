create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  stage text not null,
  type text not null,
  message text not null,
  stack_trace text null,
  user_id uuid null,
  task_id uuid null references public.tasks(id) on delete set null
);

alter table public.error_logs enable row level security;

revoke all on table public.error_logs from anon, authenticated;