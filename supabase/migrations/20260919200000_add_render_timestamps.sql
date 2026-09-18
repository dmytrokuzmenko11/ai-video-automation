alter table public.video_versions
  add column if not exists render_started_at timestamptz null;

alter table public.video_versions
  add column if not exists render_completed_at timestamptz null;

create index if not exists video_versions_render_completed_at_idx
  on public.video_versions (render_completed_at desc);