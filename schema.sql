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
  type            text not null default 'laptop',   -- 'laptop' | 'phone' | 'tablet' | 'monitor' | 'peripheral' | 'infra' | 'other'
  kind            text not null default 'apple',     -- 'apple' | 'windows' | 'android' | 'ups' | 'net' | 'other'
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

-- ---- spares / stock (added for the Spares view) ---------------------------
create table if not exists public.spares (
  id       bigint generated always as identity primary key,
  item     text not null,
  category text not null default 'other',
  qty      int  not null default 0,
  min_qty  int  not null default 0,
  note     text not null default '',
  updated_at timestamptz not null default now()
);
-- Flag so the low-stock alert fires once when an item crosses below its
-- threshold, and rearms only after it is restocked (no repeated emails).
alter table public.spares add column if not exists low_alert_sent boolean not null default false;
alter table public.spares enable row level security;
drop policy if exists "auth full access - spares" on public.spares;
create policy "auth full access - spares" on public.spares for all to authenticated using (true) with check (true);
do $$ begin begin execute 'alter publication supabase_realtime add table public.spares'; exception when duplicate_object then null; end; end $$;

-- ---- invoices / purchases (added for the Invoicing view) ------------------
-- Mirrors the "Invoice Master Tracker": one row per purchase, with an optional
-- stored receipt (Supabase Storage) and/or an external link (e.g. Google Drive).
create table if not exists public.invoices (
  id               bigint generated always as identity primary key,
  invoice_no       text not null default '',
  purchase_date    date,
  vendor           text not null default '',   -- Vendor / Seller
  buyer            text not null default '',   -- Buyer company
  representative   text not null default '',   -- Company representative
  item_description text not null default '',
  category         text not null default 'other',
  quantity         numeric not null default 1,
  unit_price       numeric not null default 0,
  total_amount     numeric not null default 0,
  currency         text not null default 'Rs',
  payment_method   text not null default '',   -- JUICE | Bank transfer | Cash | Other
  transaction_ref  text not null default '',
  receipt_path     text not null default '',   -- object path inside the 'receipts' storage bucket
  receipt_url      text not null default '',   -- external link (Google Drive, etc.)
  note             text not null default '',
  uploaded_by      text not null default '',
  created_at       timestamptz not null default now()
);
alter table public.invoices enable row level security;
drop policy if exists "auth full access - invoices" on public.invoices;
create policy "auth full access - invoices" on public.invoices for all to authenticated using (true) with check (true);
do $$ begin begin execute 'alter publication supabase_realtime add table public.invoices'; exception when duplicate_object then null; end; end $$;

-- ---- receipt storage bucket ----------------------------------------------
-- Private bucket that holds the uploaded receipt files. Only authenticated
-- users can read/write; the app serves them through short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists "auth read receipts"   on storage.objects;
drop policy if exists "auth write receipts"  on storage.objects;
drop policy if exists "auth update receipts" on storage.objects;
drop policy if exists "auth delete receipts" on storage.objects;
create policy "auth read receipts"   on storage.objects for select to authenticated using (bucket_id = 'receipts');
create policy "auth write receipts"  on storage.objects for insert to authenticated with check (bucket_id = 'receipts');
create policy "auth update receipts" on storage.objects for update to authenticated using (bucket_id = 'receipts');
create policy "auth delete receipts" on storage.objects for delete to authenticated using (bucket_id = 'receipts');
