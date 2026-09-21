create extension if not exists pgcrypto;

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_name text not null,
  content text not null,
  reactions jsonb not null default '{"👍":0,"❤️":0,"😂":0,"👀":0,"🚀":0}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.comments
  add column if not exists author_name text;

alter table public.comments
  add column if not exists content text;

alter table public.comments
  add column if not exists reactions jsonb;

alter table public.comments
  add column if not exists created_at timestamptz;

alter table public.comments
  add column if not exists updated_at timestamptz;

update public.comments
set
  author_name = coalesce(author_name, 'Олександр'),
  content = coalesce(content, ''),
  reactions = coalesce(reactions, '{"👍":0,"❤️":0,"😂":0,"👀":0,"🚀":0}'::jsonb),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where author_name is null
   or content is null
   or reactions is null
   or created_at is null
   or updated_at is null;

alter table public.comments alter column author_name set not null;
alter table public.comments alter column content set not null;
alter table public.comments alter column reactions set not null;
alter table public.comments alter column created_at set not null;
alter table public.comments alter column updated_at set not null;

alter table public.comments alter column author_name set default 'Олександр';
alter table public.comments alter column reactions set default '{"👍":0,"❤️":0,"😂":0,"👀":0,"🚀":0}'::jsonb;
alter table public.comments alter column created_at set default now();
alter table public.comments alter column updated_at set default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'comments'
      and column_name = 'user_id'
  ) then
    alter table public.comments drop column user_id;
  end if;
end $$;

alter table public.comments enable row level security;

drop policy if exists comments_select on public.comments;
drop policy if exists comments_insert on public.comments;
drop policy if exists comments_update on public.comments;
drop policy if exists comments_delete on public.comments;

create policy comments_select
  on public.comments
  for select
  using (true);

create policy comments_insert
  on public.comments
  for insert
  with check (true);

create policy comments_update
  on public.comments
  for update
  using (true)
  with check (true);

create policy comments_delete
  on public.comments
  for delete
  using (true);

grant select, insert, update, delete on table public.comments to anon, authenticated;

create index if not exists comments_task_id_created_at_idx
  on public.comments (task_id, created_at desc);

create or replace function public.set_comments_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_comments_updated_at on public.comments;

create trigger set_comments_updated_at
before update on public.comments
for each row
execute function public.set_comments_updated_at();