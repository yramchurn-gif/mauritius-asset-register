# Mauritius Asset Register

A hosted web app for tracking the physical IT assets in the **Ebène (Mauritius) office** of Game Play Network — laptops and office infrastructure — and running the **quarterly audit**, with a one-click **report to Gerard**.

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
- `app.js` — UI, audit workflow, report builder, and the `store` data layer
- `config.js` — **public** Supabase URL + publishable key (safe to commit; protected by RLS)
- `schema.sql` — Postgres tables, RLS policies, realtime — run once in Supabase
- `private/seed-real.sql` — the **real** asset data (**git-ignored**, never published)

## Setup

1. **Database schema** — Supabase → SQL Editor → paste `schema.sql` → Run.
2. **Load real data** — SQL Editor → paste `private/seed-real.sql` → Run. (Kept out of git.)
3. **Create a login** — Supabase → Authentication → Users → *Add user* (email + password, auto-confirm). Share credentials with whoever audits.
4. **Point the app** — `config.js` already holds this project's URL + publishable key. Change them to move projects.
5. **Deploy** — push to GitHub; Pages serves the repo root.

## Security notes

- The publishable key in `config.js` is designed to be public. All access is enforced by **row-level security**: only authenticated users read or write.
- Real staff names and device serials live only in Supabase (behind login) and in the git-ignored `private/` seed — never in the public repo or the deployed sample data.

## Roadmap (the pitch)

- Dedicated hosted server + managed Postgres (replaces Apps Script entirely)
- SSO against the company directory
- Asset history / chain-of-custody and automatic quarter roll-over
- Scheduled email of the quarterly report
