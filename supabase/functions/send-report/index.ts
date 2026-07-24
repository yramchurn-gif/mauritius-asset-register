// ============================================================================
// send-report — Supabase Edge Function
// ----------------------------------------------------------------------------
// Emails the quarterly equipment-check report (and attaches the CSV) via Resend,
// so the app's "Email report" button actually sends instead of relying on the
// browser's mailto: handler.
//
// Deploy:  supabase functions deploy send-report --no-verify-jwt
// Secrets (shared with low-stock-alert): RESEND_API_KEY, ALERT_FROM, ALERT_SECRET
// Body: { to, subject, text, csv_base64?, csv_name? }
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-alert-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  // Guard: a signed-in app user (valid access token) OR the shared ALERT_SECRET.
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const wantSecret = Deno.env.get("ALERT_SECRET");
  let authed = !!wantSecret && req.headers.get("x-alert-secret") === wantSecret;
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

  let p: Record<string, unknown> = {};
  try { p = await req.json(); } catch { /* ignore */ }
  const to = (Array.isArray(p.to) ? p.to : String(p.to || "").split(","))
    .map((s) => String(s).trim()).filter(Boolean);
  const subject = String(p.subject || "Mauritius Quarterly Equipment Check");
  const text = String(p.text || "");
  if (!to.length) return json({ error: "no recipient" }, 400);

  const html = `<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;white-space:pre-wrap;color:#1c1d17">${
    text.replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]!))
  }</pre>`;

  const payload: Record<string, unknown> = { from, to, subject, text, html };
  if (typeof p.csv_base64 === "string" && p.csv_base64) {
    payload.attachments = [{ filename: String(p.csv_name || "register.csv"), content: p.csv_base64 }];
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return json({ error: "resend failed", detail: await res.text() }, 502);
  return json({ ok: true, sent: true, to });
});
