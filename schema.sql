-- ============================================================================
-- Mauritius Asset Register — Supabase (Postgres) schema
-- Run this once in your Supabase project: SQL Editor → paste → Run.
-- Safe to re-run (idempotent).
-- ============================================================================

-- ---- tables ---------------------------------------------------------------
create table if not exists public.assets (
  tag             text primary key,
  assignee        text not null default '',
  reassigned_from text not null default '',
  type            text not null default 'laptop',   -- 'laptop' | 'infra'
  kind            text not null default 'apple',     -- 'apple' | 'windows' | 'ups' | 'net'
  model           text not null default '',
  variant         text not null default '',
  spec            text not null default '',
  chip            text not null default '—',
  serial          text not null default '',
  retired         boolean not null default false,
  updated_at      timestamptz not null default now()
);

create table if not exists public.audit_entries (
  quarter     text not null,                          -- e.g. '2026-Q3'
  tag         text not null references public.assets(tag) on delete cascade,
  status      text not null default 'pending',        -- 'pending' | 'verified' | 'flag'
  note        text not null default '',
  checked_at  timestamptz,
  checked_by  text not null default '',
  primary key (quarter, tag)
);

-- ---- row-level security ---------------------------------------------------
-- Real data is gated behind login: only authenticated users can read or write.
alter table public.assets        enable row level security;
alter table public.audit_entries enable row level security;

drop policy if exists "auth full access - assets"  on public.assets;
drop policy if exists "auth full access - audits"  on public.audit_entries;

create policy "auth full access - assets"
  on public.assets for all to authenticated using (true) with check (true);

create policy "auth full access - audits"
  on public.audit_entries for all to authenticated using (true) with check (true);

-- ---- realtime (live multi-user updates) -----------------------------------
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.assets'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.audit_entries'; exception when duplicate_object then null; end;
end $$;
