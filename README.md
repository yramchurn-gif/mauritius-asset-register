# Mauritius Asset Register

A hosted web app for tracking the physical IT assets in the **Ebène (Mauritius) office** of Game Play Network — **laptops, phones, tablets, monitors, peripherals and office infrastructure** — running the **quarterly audit** with a one-click **report to Gerard**, tracking **spare stock** (with automatic low-stock email alerts) and logging **purchases and receipts** in the invoicing view.

Built to be the stepping stone off Google Apps Script: a real front-end on **GitHub Pages** talking to a real database (**Supabase / Postgres**) behind a login. The same UI runs on any backend — fund a dedicated server later and only the data layer changes.

## Live site

GitHub Pages: _(URL appears here once Pages finishes building)_

- **Logged out** → anonymized **sample data**, so the page is fully browsable without exposing anyone.
- **Logged in** → the **live register** loads from Supabase, editable and auditable, with realtime updates across devices.

## Architecture

| Layer | Choice | Why |
|------|--------|-----|
| Front-end | Static HTML/CSS/JS on GitHub Pages | No build step, free hosting, versioned in git |
| Data | Supabase (hosted Postgres) | True multi-user shared data + row-level security + realtime |
| Auth | Supabase Auth (email + password) | Real data stays behind a login |
| Data layer | Single `store` object in `app.js` | Swap `supaStore` for any API without touching the UI |

## Files

- `index.html` — page shell, loads Supabase client + `config.js` + `app.js`
- `styles.css` — design system (light/dark)
- `app.js` — UI (Register / Spares / Invoicing), audit workflow, report builder, low-stock alerts, and the `store` data layer
- `config.js` — **public** Supabase URL + publishable key + alert recipients (safe to commit; protected by RLS)
- `schema.sql` — Postgres tables (assets, audits, spares, **invoices**), RLS, realtime, and the **receipts** storage bucket — run once in Supabase
- `alerts.sql` — **optional** database-driven low-stock alerts (pg_net trigger + daily pg_cron digest)
- `supabase/functions/low-stock-alert/` — Edge Function that emails the stock owners (via Resend)
- `private/seed-real.sql` — the **real** asset data (**git-ignored**, never published)

## Setup

1. **Database schema** — Supabase → SQL Editor → paste `schema.sql` → Run.
2. **Load real data** — SQL Editor → paste `private/seed-real.sql` → Run. (Kept out of git.)
3. **Create a login** — Supabase → Authentication → Users → *Add user* (email + password, auto-confirm). Share credentials with whoever audits.
4. **Point the app** — `config.js` already holds this project's URL + publishable key. Change them to move projects.
5. **Low-stock alerts** — deploy the `low-stock-alert` Edge Function and set the Resend key (see *Low-stock email alerts* above). Optional: run `alerts.sql` for database-driven alerts.
6. **Deploy** — push to GitHub; Pages serves the repo root.

## Security notes

- The publishable key in `config.js` is designed to be public. All access is enforced by **row-level security**: only authenticated users read or write.
- Real staff names and device serials live only in Supabase (behind login) and in the git-ignored `private/` seed — never in the public repo or the deployed sample data.

## Invoicing (purchases & receipts)

The **Invoicing** view logs every purchase — vendor, item, quantity, unit price,
total, payment method (JUICE / bank transfer / cash / …) and transaction
reference — modelled on the existing *Invoice Master Tracker*. Each row can carry
a **receipt**. By default receipts upload **straight to Google Drive** (kept with
the rest of the invoices, so Supabase storage stays lean): set `GOOGLE_CLIENT_ID`
in `config.js` to an OAuth 2.0 Client ID (Google Cloud Console → APIs & Services →
Credentials) with this site added as an *Authorised JavaScript origin*, and
`DRIVE_RECEIPTS_FOLDER_ID` to the destination folder. Uploads use the narrow
`drive.file` scope, so the app only ever touches files it creates. You can also
paste an existing Drive/external link. If `GOOGLE_CLIENT_ID` is left blank,
receipts upload into the private Supabase `receipts` bucket instead (served via
short-lived signed URLs). The `invoices` table and `receipts` bucket are created
by `schema.sql`.

## Low-stock email alerts

When a spare item drops **to or below its threshold**, the stock owners
(`STOCK_ALERT_TO` in `config.js` — Yuvan + Rohann by default) get an email. The
`🔔` button on the Spares toolbar also sends the current low-stock list on demand.

Two layers, deploy either or both:

1. **From the app (least setup).** The signed-in browser calls the
   `low-stock-alert` Edge Function the moment stock crosses a threshold. Deploy
   the function and set a Resend key:
   ```bash
   supabase functions deploy low-stock-alert --no-verify-jwt
   supabase secrets set RESEND_API_KEY=re_xxx \
     ALERT_FROM="Mauritius Asset Register <alerts@yourdomain>" \
     ALERT_RECIPIENTS="yramchurn@bspot.com,rsoodarchand@bspot.com"
   ```
   (Get the key from [resend.com](https://resend.com); `ALERT_FROM` must be a
   verified sender — `onboarding@resend.dev` works for testing.)
2. **From the database (fires even when nobody has the app open) — optional.**
   Run `alerts.sql` for a pg_net trigger plus a daily digest via pg_cron. Set an
   `ALERT_SECRET` function secret, put the same value in `alerts.sql`, and set
   `CLIENT_STOCK_ALERTS: false` in `config.js` so alerts aren't sent twice.

Dedup is automatic: an item alerts once when it goes low and rearms only after
it's restocked above the threshold.

## Roadmap (the pitch)

- Dedicated hosted server + managed Postgres (replaces Apps Script entirely)
- SSO against the company directory
- Asset history / chain-of-custody and automatic quarter roll-over
- Scheduled email of the quarterly report
- Auto-import invoices from the Google Drive *Invoice Master Tracker*
