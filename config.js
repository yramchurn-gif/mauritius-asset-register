/* ============================================================================
   Supabase connection config.
   These are PUBLIC client credentials (publishable key). They are safe to commit
   to a public repo — your data is protected by Postgres row-level security and
   the login requirement, not by hiding this key.

   To point the app at a different Supabase project, change the two values below.
   Leave them blank ("") to run the app in local "sample data" mode with no backend.
   ========================================================================== */
window.MUR_CONFIG = {
  SUPABASE_URL: "https://tbtwpeuoglafjklsgklz.supabase.co",
  SUPABASE_KEY: "sb_publishable_p0C8hgqwMplm1EiL6yeiTQ_4IuDIcvC",
  OFFICE: "Ebène · Regus",
  // Report recipient. Temporarily set to Yuvan for testing the email formatting.
  // Switch to "gcateau@bspot.com" once the format is signed off.
  REPORT_TO: "yramchurn@bspot.com",

  // Who gets the automated low-stock alert email. Sent by the `low-stock-alert`
  // Edge Function (see README) the moment a spare item drops to/below its
  // threshold, and as a daily digest if alerts.sql is installed.
  STOCK_ALERT_TO: ["yramchurn@bspot.com", "rsoodarchand@bspot.com"],

  // Let the signed-in app send the low-stock alert directly (recommended).
  // Set to false only if you drive alerts from the database (alerts.sql), so
  // the same drop doesn't email twice.
  CLIENT_STOCK_ALERTS: true,

  // Default buyer prefilled on new invoices (from the Invoice Master Tracker).
  BUYER_DEFAULT: "iWynn Solutions LTD",

  // Invoice receipts upload straight to Google Drive (keeps them with the rest
  // of the invoices, so Supabase storage stays lean). Paste the OAuth 2.0
  // Client ID from Google Cloud Console (APIs & Services → Credentials), with
  // this site added as an Authorised JavaScript origin. Leave blank to fall
  // back to uploading receipts into Supabase storage instead.
  GOOGLE_CLIENT_ID: "",
  // Drive folder receipts are uploaded into (defaults to the "Company Invoices"
  // folder). Blank = the user's Drive root.
  DRIVE_RECEIPTS_FOLDER_ID: "1U0qIjBs8osm5En0YYobRU0GyDTxrwAFl"
};
