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
  const slackOn = slackConfigured();
  if (!resendKey && !slackOn) return json({ error: "no channel configured (set RESEND_API_KEY and/or SLACK_BOT_TOKEN+SLACK_CHANNEL_ID or SLACK_WEBHOOK_URL)" }, 500);
  const from = Deno.env.get("ALERT_FROM") || "Mauritius Asset Register <onboarding@resend.dev>";

  let p: Record<string, unknown> = {};
  try { p = await req.json(); } catch { /* ignore */ }
  const to = (Array.isArray(p.to) ? p.to : String(p.to || "").split(","))
    .map((s) => String(s).trim()).filter(Boolean);
  const subject = String(p.subject || "Mauritius Quarterly Equipment Check");
  const text = String(p.text || "");
  // slack_only: post the digest to the Slack channel (MUR Log) without emailing.
  // Used by the app's "Finish check" auto-post so a paused/finished check logs to
  // Slack without sending an email every time.
  const slackOnly = p.slack_only === true || p.slackOnly === true;
  // announcement: a plain team notice posted to Slack (title + body), not a report.
  const isAnnounce = p.kind === "announcement";
  if (isAnnounce) {
    if (!slackOn) return json({ error: "slack not configured" }, 400);
    const title = String(p.title || "Announcement");
    const blocks: unknown[] = [
      { type: "header", text: { type: "plain_text", text: "📣 " + title, emoji: true } },
    ];
    if (text) blocks.push({ type: "section", text: { type: "mrkdwn", text: text.slice(0, 2900) } });
    blocks.push({ type: "actions", elements: [
      { type: "button", text: { type: "plain_text", text: "Open app", emoji: true }, url: SITE_URL, style: "primary" },
    ] });
    const slackRes = await postSlack(title, blocks);
    return json({ ok: true, sent: { slack: slackRes } });
  }
  if (!to.length && !slackOnly) return json({ error: "no recipient" }, 400);
  if (slackOnly && !slackOn) return json({ error: "slack not configured" }, 400);

  const html = `<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;white-space:pre-wrap;color:#1c1d17">${
    text.replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]!))
  }</pre>`;

  const payload: Record<string, unknown> = { from, to, subject, text, html };
  if (typeof p.csv_base64 === "string" && p.csv_base64) {
    payload.attachments = [{ filename: String(p.csv_name || "register.csv"), content: p.csv_base64 }];
  }

  const sent: Record<string, unknown> = {};

  // Slack — interactive Block Kit card.
  if (slackOn) {
    const blocks = [
      { type: "header", text: { type: "plain_text", text: "📊 Equipment-check report", emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: `*${subject}*` } },
      { type: "section", text: { type: "mrkdwn", text: "```" + text.slice(0, 2800) + "```" } },
      { type: "context", elements: [{ type: "mrkdwn", text: "Full line-by-line register (CSV) is attached to the emailed copy." }] },
      { type: "actions", elements: [
        { type: "button", text: { type: "plain_text", text: "Open register", emoji: true }, url: SITE_URL, style: "primary" },
      ] },
    ];
    sent.slack = await postSlack(`${subject}`, blocks);
  }

  // Email (Resend) with the CSV attached.
  if (resendKey && !slackOnly && to.length) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    sent.email = res.ok ? to : `failed:${await res.text()}`;
  }

  return json({ ok: true, sent });
});

// Slack via bot token + channel id (chat.postMessage) or an incoming webhook URL.
function slackConfigured(): boolean {
  return !!(Deno.env.get("SLACK_BOT_TOKEN") && Deno.env.get("SLACK_CHANNEL_ID")) || !!Deno.env.get("SLACK_WEBHOOK_URL");
}
// deno-lint-ignore no-explicit-any
async function postSlack(text: string, blocks?: any[]): Promise<string> {
  const token = Deno.env.get("SLACK_BOT_TOKEN"), channel = Deno.env.get("SLACK_CHANNEL_ID");
  if (token && channel) {
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel, text, blocks }),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok && j.ok ? "ok" : `failed:${j.error || r.status}`;
  }
  const url = Deno.env.get("SLACK_WEBHOOK_URL");
  if (url) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, blocks }) });
    return r.ok ? "ok" : `failed:${r.status}`;
  }
  return "skipped";
}
const SITE_URL = "https://yramchurn-gif.github.io/mauritius-asset-register";
