create table if not exists task_runs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references users(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  filename text,
  status text not null check (status in ('queued','running','completed','failed','cancelled')),
  total_items int not null default 0,
  completed_items int not null default 0,
  failed_items int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_task_runs_owner_created on task_runs(owner_user_id, created_at desc);

