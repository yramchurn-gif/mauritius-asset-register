// ============================================================================
// low-stock-alert — Supabase Edge Function
// ----------------------------------------------------------------------------
// Emails the stock owners when spare items are at or below their threshold.
//
// Two ways in:
//   • The signed-in app calls it the moment an item crosses its threshold,
//     passing that one item in the body ({ reason:"threshold", item, qty, ... }).
//   • The optional database trigger / daily cron (alerts.sql) calls it with
//     { reason:"digest" } (or "threshold"), and it looks up the low items itself.
//
// Deploy:
//   supabase functions deploy low-stock-alert --no-verify-jwt
// Secrets (Supabase → Edge Functions → low-stock-alert → Secrets):
//   RESEND_API_KEY   – required, from https://resend.com
//   ALERT_FROM       – e.g. "Mauritius Asset Register <alerts@yourdomain>"
//   ALERT_RECIPIENTS – optional, comma-separated (defaults below)
//   ALERT_SECRET     – optional shared secret; if set, callers must send it as
//                      the `x-alert-secret` header (the app and alerts.sql do).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_RECIPIENTS = ["yramchurn@bspot.com", "rsoodarchand@bspot.com"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-alert-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  // Deployed with --no-verify-jwt, so guard here. Accept a caller that is EITHER
  //   • a signed-in app user (valid Supabase access token), OR
  //   • the database trigger / cron, carrying the shared ALERT_SECRET header.
  // This keeps the secret server-side only (never shipped to the browser).
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const wantSecret = Deno.env.get("ALERT_SECRET");
  const hasSecret = !!wantSecret && req.headers.get("x-alert-secret") === wantSecret;
  let authed = hasSecret;
  if (!authed) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    if (token && token !== anonKey) {
      const { data } = await createClient(supabaseUrl, serviceKey).auth.getUser(token);
      authed = !!data?.user;
    }
  }
  if (!authed) return json({ error: "unauthorized" }, 401);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return json({ error: "RESEND_API_KEY is not set" }, 500);

  const from = Deno.env.get("ALERT_FROM") || "Mauritius Asset Register <onboarding@resend.dev>";
  const recipients = (Deno.env.get("ALERT_RECIPIENTS") || DEFAULT_RECIPIENTS.join(","))
    .split(",").map((s) => s.trim()).filter(Boolean);

  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { /* empty body = digest */ }

  // Build the list of low items.
  type Low = { item: string; category?: string; qty: number; min_qty: number };
  let low: Low[] = [];

  if (payload.reason === "threshold" && typeof payload.item === "string") {
    // Single item passed straight from the app / trigger.
    low = [{
      item: String(payload.item),
      category: payload.category ? String(payload.category) : undefined,
      qty: Number(payload.qty ?? 0),
      min_qty: Number(payload.min_qty ?? 0),
    }];
  } else {
    // Digest: query everything currently at/below threshold.
    const sb = createClient(supabaseUrl, serviceKey);
    const { data, error } = await sb.from("spares").select("item,category,qty,min_qty");
    if (error) return json({ error: error.message }, 500);
    low = (data || []).filter((s) => Number(s.qty) <= Number(s.min_qty));
  }

  if (!low.length) return json({ ok: true, sent: false, reason: "nothing low" });

  const rows = low.map((s) =>
    `<tr>
       <td style="padding:8px 12px;border-bottom:1px solid #eee">${escapeHtml(s.item)}</td>
       <td style="padding:8px 12px;border-bottom:1px solid #eee;text-transform:capitalize;color:#666">${escapeHtml(s.category || "—")}</td>
       <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;font-weight:700;color:#b45309">${s.qty}</td>
       <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;color:#666">${s.min_qty}</td>
     </tr>`).join("");

  const single = low.length === 1;
  const subject = single
    ? `⚠ Spare stock low: ${low[0].item} (${low[0].qty} left)`
    : `⚠ Spare stock low: ${low.length} items need restocking`;

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1d17;max-width:560px">
      <h2 style="margin:0 0 4px">Spare stock is running low</h2>
      <p style="margin:0 0 16px;color:#585a4e">Mauritius (Ebène) office · ${new Date().toLocaleString("en-GB", { timeZone: "Indian/Mauritius" })}</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <thead><tr style="text-align:left;color:#8c8d7f;font-size:12px;text-transform:uppercase">
          <th style="padding:8px 12px">Item</th><th style="padding:8px 12px">Category</th>
          <th style="padding:8px 12px;text-align:center">In stock</th><th style="padding:8px 12px;text-align:center">Min</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin:18px 0 0;color:#8c8d7f;font-size:12px">Automated alert from the Mauritius Asset Register. Restock these items and the alert clears itself.</p>
    </div>`;

  const text = "Spare stock low:\n" + low.map((s) => `  ${s.item} — ${s.qty} in stock (min ${s.min_qty})`).join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: recipients, subject, html, text }),
  });

  if (!res.ok) return json({ error: "resend failed", detail: await res.text() }, 502);
  return json({ ok: true, sent: true, count: low.length, to: recipients });
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));
}
