create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  role text not null check (role in ('admin', 'user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references users(id) on delete cascade,
  status text not null check (status in ('queued','running','completed','failed','cancelled')),
  filename text,
  total_items int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists usage_records (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references users(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  step text not null,
  provider text not null,
  model_id text not null,
  input_tokens int,
  output_tokens int,
  cost_cny numeric(18,6),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

