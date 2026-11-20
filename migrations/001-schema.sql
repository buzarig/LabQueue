-- 001: схема LabQueue з data.md, розділ «Схема БД» (лаба 2). Схема на модуль,
-- зовнішні ключі лише всередині модуля (ADR-0028); teacher_id у
-- queue.entries — копія для I4 (ADR-0029). Застосовує scripts/migrate.js
-- (ADR-0026) в одній транзакції.

create schema identity;
create schema catalog;
create schema sessions;
create schema queue;
create schema platform;

-- identity
create table identity.users (
  id text primary key,
  name text not null,
  role text not null check (role in ('student', 'teacher')),
  group_id text,
  check ((role = 'student') = (group_id is not null))
);

-- catalog
create table catalog.groups   (id text primary key, name text not null);
create table catalog.subjects (id text primary key, name text not null);
create table catalog.labs (
  id text primary key,
  subject_id text not null references catalog.subjects,
  number int not null check (number > 0),
  title text not null,
  unique (subject_id, number)
);

-- sessions
create table sessions.sessions (
  id uuid primary key,
  subject_id text not null,
  group_id text not null,
  teacher_id text not null,
  starts_at timestamptz not null,
  room text not null,
  queue_limit int not null check (queue_limit > 0),
  state text not null default 'planned'
    check (state in ('planned', 'open', 'closed', 'finished'))
);
create index on sessions.sessions (group_id, starts_at);
create table sessions.session_labs (
  session_id uuid references sessions.sessions,
  lab_id text not null,
  primary key (session_id, lab_id)
);

-- queue
create table queue.entries (
  id uuid primary key,
  session_id uuid not null,
  teacher_id text not null,
  student_id text not null,
  lab_id text not null,
  status text not null check (status in ('waiting', 'called', 'submitting',
    'passed', 'rework', 'left', 'dropped', 'missed')),
  seq int not null,
  enqueued_at timestamptz not null,
  called_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  score int check (score between 0 and 100),
  check ((score is not null) = (status = 'passed')),
  unique (session_id, seq)
);
create unique index entries_one_active
  on queue.entries (session_id, student_id)
  where status in ('waiting', 'called', 'submitting');
create unique index entries_one_call_per_teacher
  on queue.entries (teacher_id)
  where status in ('called', 'submitting');
create index on queue.entries (session_id, status, seq);
create index on queue.entries (student_id, finished_at desc)
  where status in ('passed', 'rework');
create table queue.no_shows (
  session_id uuid not null,
  student_id text not null,
  count int not null check (count between 1 and 2),
  primary key (session_id, student_id)
);

-- platform
create table platform.idempotency_keys (
  user_id text not null,
  key text not null,
  request_hash text not null,
  result_status int,
  result_body jsonb,
  created_at timestamptz not null,
  primary key (user_id, key)
);
