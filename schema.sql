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
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 26214400,
        array['application/pdf','image/png','image/jpeg','image/jpg','image/webp','image/heic'])
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "auth read receipts"   on storage.objects;
drop policy if exists "auth write receipts"  on storage.objects;
drop policy if exists "auth update receipts" on storage.objects;
drop policy if exists "auth delete receipts" on storage.objects;
create policy "auth read receipts"   on storage.objects for select to authenticated using (bucket_id = 'receipts');
create policy "auth write receipts"  on storage.objects for insert to authenticated with check (bucket_id = 'receipts');
create policy "auth update receipts" on storage.objects for update to authenticated using (bucket_id = 'receipts');
create policy "auth delete receipts" on storage.objects for delete to authenticated using (bucket_id = 'receipts');

-- ---- data integrity constraints -------------------------------------------
alter table public.assets drop constraint if exists assets_type_chk;
alter table public.assets add constraint assets_type_chk check (type in ('laptop','phone','tablet','monitor','peripheral','infra','other'));
alter table public.assets drop constraint if exists assets_kind_chk;
alter table public.assets add constraint assets_kind_chk check (kind in ('apple','windows','android','ups','net','other'));
alter table public.audit_entries drop constraint if exists audit_status_chk;
alter table public.audit_entries add constraint audit_status_chk check (status in ('pending','present','damaged','missing','replace'));

-- ---- per-person custom accessories ----------------------------------------
-- `assets.accessories`  : the extra accessories a specific person has, beyond
--                         the standard charger/hub/headset/mouse — e.g.
--                         ["Keyboard","Docking station"]. Permanent per person,
--                         so it appears in every quarterly check.
-- `audit_entries.extra` : that quarter's present/absent tick for each custom
--                         accessory, keyed by name — e.g. {"Keyboard":true}.
alter table public.assets        add column if not exists accessories jsonb not null default '[]'::jsonb;
alter table public.audit_entries add column if not exists extra       jsonb not null default '{}'::jsonb;

-- one invoice number can't be reused (blank allowed for un-numbered rows)
create unique index if not exists invoices_no_uniq on public.invoices (invoice_no) where invoice_no <> '';

-- ---- asset history (chain of custody) -------------------------------------
create table if not exists public.asset_history (
  id         bigint generated always as identity primary key,
  tag        text not null,
  action     text not null,            -- added | reassigned | retired | restored | updated | removed
  summary    text not null default '',
  changed_by text not null default '',
  changed_at timestamptz not null default now()
);
alter table public.asset_history enable row level security;
drop policy if exists "auth read history" on public.asset_history;
create policy "auth read history" on public.asset_history for select to authenticated using (true);

create or replace function public.log_asset_change() returns trigger language plpgsql security definer set search_path=public,auth as $$
declare who text := coalesce(nullif(auth.email(),''),'system');
begin
  if tg_op='INSERT' then
    insert into public.asset_history(tag,action,summary,changed_by) values (NEW.tag,'added',NEW.type||' '||coalesce(NEW.model,'')||' -> '||coalesce(nullif(NEW.assignee,''),'unassigned'),who); return NEW;
  elsif tg_op='DELETE' then
    insert into public.asset_history(tag,action,summary,changed_by) values (OLD.tag,'removed',OLD.type||' '||coalesce(OLD.model,''),who); return OLD;
  else
    if coalesce(OLD.assignee,'')<>coalesce(NEW.assignee,'') then
      insert into public.asset_history(tag,action,summary,changed_by) values (NEW.tag,'reassigned','from '||coalesce(nullif(OLD.assignee,''),'unassigned')||' to '||coalesce(nullif(NEW.assignee,''),'unassigned'),who);
    end if;
    if coalesce(OLD.retired,false)<>coalesce(NEW.retired,false) then
      insert into public.asset_history(tag,action,summary,changed_by) values (NEW.tag, case when NEW.retired then 'retired' else 'restored' end,'',who);
    end if;
    if OLD.assignee is not distinct from NEW.assignee and OLD.retired is not distinct from NEW.retired
       and (OLD.model,OLD.spec,OLD.serial,OLD.variant,OLD.chip,OLD.kind,OLD.type) is distinct from (NEW.model,NEW.spec,NEW.serial,NEW.variant,NEW.chip,NEW.kind,NEW.type) then
      insert into public.asset_history(tag,action,summary,changed_by) values (NEW.tag,'updated','details edited',who);
    end if;
    return NEW;
  end if;
end $$;
drop trigger if exists assets_history_log on public.assets;
create trigger assets_history_log after insert or update or delete on public.assets
  for each row execute function public.log_asset_change();

-- ---- procurement (planned purchases) --------------------------------------
-- Planning list for upcoming buys (e.g. new-hire kit). Items move
-- planned -> ordered -> received; the app tots up estimated spend.
create table if not exists public.procurement (
  id         bigint generated always as identity primary key,
  item       text not null default '',
  category   text not null default 'other',
  for_who    text not null default '',       -- new hire / reason
  qty        numeric not null default 1,
  unit_cost  numeric not null default 0,
  currency   text not null default 'Rs',
  needed_by  date,
  status     text not null default 'planned', -- planned | ordered | received
  note       text not null default '',
  created_at timestamptz not null default now()
);
alter table public.procurement enable row level security;
drop policy if exists "auth full access - procurement" on public.procurement;
create policy "auth full access - procurement" on public.procurement for all to authenticated using (true) with check (true);
alter table public.procurement drop constraint if exists procurement_status_chk;
alter table public.procurement add constraint procurement_status_chk check (status in ('planned','ordered','received'));
do $$ begin begin execute 'alter publication supabase_realtime add table public.procurement'; exception when duplicate_object then null; end; end $$;

-- ---- app settings (editable templates, e.g. the new-hire kit) --------------
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "auth full access - settings" on public.app_settings;
create policy "auth full access - settings" on public.app_settings for all to authenticated using (true) with check (true);
do $$ begin begin execute 'alter publication supabase_realtime add table public.app_settings'; exception when duplicate_object then null; end; end $$;
