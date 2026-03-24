create extension if not exists pgcrypto;

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  email text,
  name text,
  avatar_url text,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists app_settings (
  id integer primary key default 1,
  gateway_token text not null default '',
  setup_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_settings_single_row check (id = 1)
);

insert into app_settings (id, gateway_token, setup_completed)
values (1, '', false)
on conflict (id) do nothing;

create table if not exists boards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  title text not null,
  color_key text not null default 'slate',
  is_default boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  board_id uuid not null references boards(id) on delete cascade,
  column_id uuid not null references columns(id) on delete cascade,
  title text not null,
  description text,
  priority text not null default 'low',
  due_date date,
  tags text[] not null default '{}'::text[],
  assignee_ids text[] not null default '{}'::text[],
  assigned_agent_id text not null default '',
  auto_approve boolean not null default false,
  scheduled_for timestamptz,
  execution_state text not null default 'pending',
  execution_mode text not null default 'auto',
  lifecycle_status text not null default 'open',
  plan_text text,
  plan_approved boolean not null default false,
  checklist_done integer not null default 0,
  checklist_total integer not null default 0,
  comments_count integer not null default 0,
  attachments_count integer not null default 0,
  position integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table tickets alter column assignee_ids type text[] using assignee_ids::text[];
alter table tickets add column if not exists assigned_agent_id text not null default '';
alter table tickets add column if not exists auto_approve boolean not null default false;
alter table tickets add column if not exists scheduled_for timestamptz;
alter table tickets add column if not exists execution_state text not null default 'pending';
alter table tickets add column if not exists execution_mode text not null default 'auto';
alter table tickets add column if not exists lifecycle_status text not null default 'open';
alter table tickets add column if not exists plan_text text;
alter table tickets add column if not exists plan_approved boolean not null default false;
alter table tickets add column if not exists approved_at timestamptz;
alter table tickets add column if not exists created_by text;
alter table tickets add column if not exists telegram_chat_id text;
alter table tickets add column if not exists queue_name text not null default 'default';
alter table tickets add column if not exists approval_state text not null default 'none';
alter table tickets add column if not exists plan_generated_at timestamptz;
alter table tickets add column if not exists approved_by text;
update tickets set queue_name = 'default' where queue_name is null;

create table if not exists ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  name text not null,
  url text not null,
  mime_type text not null default 'application/octet-stream',
  size integer not null default 0,
  path text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists ticket_subtasks (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  title text not null,
  completed boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  author_id text,
  author_name text not null default 'Operator',
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists ticket_activity (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  source text not null default 'Tasks',
  event text not null,
  details text not null default '',
  level text not null default 'info',
  occurred_at timestamptz not null default now()
);

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  openclaw_agent_id text,
  status text not null default 'idle',
  model text,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, openclaw_agent_id)
);

create table if not exists agent_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  telegram_chat_id text not null,
  openclaw_session_key text not null,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, agent_id, telegram_chat_id)
);

create table if not exists agent_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  runtime_agent_id text,
  occurred_at timestamptz not null default now(),
  level text not null default 'info',
  type text not null default 'system',
  run_id text,
  message text,
  event_id text,
  event_type text,
  direction text,
  channel_type text,
  session_key text,
  source_message_id text,
  correlation_id text,
  status text,
  retry_count integer,
  message_preview text,
  is_json boolean,
  contains_pii boolean,
  memory_source text,
  memory_key text,
  collection text,
  query_text text,
  result_count integer,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  source text not null default 'System',
  event text not null,
  details text not null default '',
  level text not null default 'info',
  created_at timestamptz not null default now()
);

create table if not exists notification_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null,
  provider text not null,
  target text not null,
  enabled boolean not null default false,
  events text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, provider, target)
);

create table if not exists worker_settings (
  id integer primary key default 1,
  enabled boolean not null default true,
  poll_interval_seconds integer not null default 20,
  max_concurrency integer not null default 3,
  last_tick_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_settings_single_row check (id = 1),
  constraint worker_settings_poll_range check (poll_interval_seconds between 5 and 300),
  constraint worker_settings_concurrency_range check (max_concurrency between 1 and 20)
);

insert into worker_settings (id, enabled, poll_interval_seconds, max_concurrency)
values (1, true, 20, 3)
on conflict (id) do nothing;

alter table worker_settings add column if not exists last_tick_at timestamptz;
