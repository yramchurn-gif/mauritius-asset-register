-- ============================================================================
-- Low-stock email alerts — OPTIONAL server-side automation
-- ============================================================================
-- The app already sends a low-stock email the moment stock crosses a threshold
-- (the signed-in browser calls the `low-stock-alert` Edge Function directly).
--
-- Run THIS file as well if you also want the database itself to fire alerts —
-- independent of anyone having the app open — plus a once-a-day digest of every
-- item currently low. It uses pg_net (outbound HTTP from Postgres) and pg_cron
-- (scheduler), both bundled with Supabase.
--
-- Before running: set the shared secret below to the SAME value you set as the
-- `ALERT_SECRET` secret on the Edge Function (see README). Everything else is
-- already wired to this project.
--   Supabase → SQL Editor → paste → Run.  Safe to re-run.
-- ============================================================================

create extension if not exists pg_net  with schema extensions;
create extension if not exists pg_cron with schema extensions;

-- ---- where the alert settings live (kept out of the app) ------------------
create table if not exists public.alert_settings (
  id           int primary key default 1,
  function_url text not null,
  alert_secret text not null,
  check (id = 1)
);

-- Function URL is pre-filled for this project. Replace ONLY the secret.
insert into public.alert_settings (id, function_url, alert_secret)
values (
  1,
  'https://tbtwpeuoglafjklsgklz.functions.supabase.co/low-stock-alert',
  'CHANGE-ME-to-match-the-ALERT_SECRET-function-secret'
)
on conflict (id) do update
  set function_url = excluded.function_url;   -- keeps your existing secret on re-run

alter table public.alert_settings enable row level security;  -- no policy → not readable by the app

-- ---- POST helper ----------------------------------------------------------
create or replace function public.fire_low_stock_alert(payload jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare s public.alert_settings;
begin
  select * into s from public.alert_settings where id = 1;
  if s.function_url is null then return; end if;
  perform net.http_post(
    url     := s.function_url,
    headers := jsonb_build_object('Content-Type','application/json','x-alert-secret', s.alert_secret),
    body    := payload
  );
end $$;

-- ---- trigger: fire once when an item crosses below its threshold ----------
create or replace function public.spares_low_stock_trigger()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare crossed boolean;
begin
  -- Rearm once the item is restocked above its threshold.
  if NEW.qty > NEW.min_qty then
    NEW.low_alert_sent := false;
    return NEW;
  end if;
  -- Newly low: an insert that starts low, or an update that dropped it there.
  crossed := (TG_OP = 'INSERT') or (OLD.qty > OLD.min_qty) or (OLD.min_qty < NEW.min_qty);
  if crossed and not coalesce(NEW.low_alert_sent, false) then
    perform public.fire_low_stock_alert(jsonb_build_object(
      'item', NEW.item, 'category', NEW.category, 'qty', NEW.qty, 'min_qty', NEW.min_qty,
      'reason', 'threshold'
    ));
    NEW.low_alert_sent := true;
  end if;
  return NEW;
end $$;

drop trigger if exists spares_low_stock on public.spares;
create trigger spares_low_stock
  before insert or update of qty, min_qty on public.spares
  for each row execute function public.spares_low_stock_trigger();

-- ---- daily digest: everything currently low, 08:00 Mauritius (UTC+4) ------
-- Sends the digest (the Edge Function queries the low items itself).
select cron.unschedule('low-stock-daily-digest')
  where exists (select 1 from cron.job where jobname = 'low-stock-daily-digest');
select cron.schedule(
  'low-stock-daily-digest',
  '0 4 * * *',   -- 04:00 UTC = 08:00 in Mauritius (UTC+4)
  $$ select public.fire_low_stock_alert(jsonb_build_object('reason','digest')); $$
);
