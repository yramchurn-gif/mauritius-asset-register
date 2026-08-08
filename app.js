"use strict";
/* ============================================================================
   Mauritius Asset Register — application logic.

   App shell with two navigable views: Register (assigned equipment + quarterly
   equipment check) and Spares (unassigned stock). One `store` object backs both:
   Supabase (Postgres) when signed in, local sample data when not.

   Audit follows IT's "Quarterly Equipment Checks": condition
   (present/damaged/missing/replace) + a per-laptop accessory checklist
   (charger, USB-C hub, headset, mouse).
   ========================================================================== */

const CFG = window.MUR_CONFIG || {};
let sb = null;
const configured = !!(CFG.SUPABASE_URL && CFG.SUPABASE_KEY);
if (configured && window.supabase) {
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, { auth:{ persistSession:true, autoRefreshToken:true } });
}

const PERIPH = [["charger","Charger"],["hub","USB-C Hub"],["headset","Headset"],["mouse","Mouse"]];
function blankPeriph(){ return {charger:false,hub:false,headset:false,mouse:false}; }

/* Device types the register tracks (beyond the original laptop/infra).
   `infra` items are shared office equipment; everything else is assigned to a
   person. Accessories are only tracked for laptops. */
const TYPES = {
  laptop:     {label:"Laptop",         group:"Laptops"},
  phone:      {label:"Phone",          group:"Phones"},
  tablet:     {label:"Tablet",         group:"Tablets"},
  monitor:    {label:"Monitor",        group:"Monitors"},
  peripheral: {label:"Peripheral",     group:"Peripherals"},
  infra:      {label:"Infrastructure", group:"Office infrastructure"},
  other:      {label:"Other device",   group:"Other devices"}
};
// Monitors are intentionally omitted — they live in the Spares Monitors panel, not the Register.
const TYPE_ORDER = ["laptop","phone","tablet","peripheral","infra","other"];
const KINDS = {apple:"Apple",windows:"Windows",android:"Android",ups:"UPS",net:"Network",other:"Other"};

/* ------- anonymized SAMPLE data (safe for public repo / logged-out) -------- */
const SAMPLE = [
  ["MUR0001","Aisha K.","","laptop","apple","MacBook Air","15\" · M2 · 2023","8GB / 256GB","M2","SN-SAMPLE-01"],
  ["MUR0002","Devan R.","","laptop","apple","MacBook Air","15\" · M2 · 2023","8GB / 256GB","M2","SN-SAMPLE-02"],
  ["MUR0003","Priya S.","Former holder","laptop","apple","MacBook Air","15\" · M3 · 2024","8GB / 256GB","M3","SN-SAMPLE-03"],
  ["MUR0004","Kevin M.","","laptop","apple","MacBook Air","15\" · M3 · 2024","8GB / 256GB","M3","SN-SAMPLE-04"],
  ["MUR0005","Nisha B.","","laptop","apple","MacBook Air","13\" · M4 · 2024","16GB / 256GB","M4","SN-SAMPLE-05"],
  ["MUR0006","Ryan T.","","laptop","apple","MacBook Air","13\" · M4 · 2024","16GB / 256GB","M4","SN-SAMPLE-06"],
  ["MUR0007","Sara L.","","laptop","apple","MacBook Air","13\" · M4 · 2024","16GB / 256GB","M4","SN-SAMPLE-07"],
  ["MUR0008","Ops Lead","","laptop","windows","Asus ROG Strix","G8-series · dGPU","32GB / 2TB","PC","SN-SAMPLE-08"],
  ["MUR0040","Aisha K.","","phone","apple","iPhone 15","128GB · 2023","128GB","iPhone 15","SN-SAMPLE-IP15"],
  ["MUR0041","Devan R.","","phone","android","Samsung S24 Ultra","256GB · 2024","256GB","Galaxy S24U","SN-SAMPLE-S24"],
  ["MUR0042","Support","","phone","apple","iPhone 14","On-call handset","128GB","iPhone 14","SN-SAMPLE-IP14"],
  ["MUR0050","Nisha B.","","tablet","apple","iPad Air","Field sign-off","64GB","iPad Air","SN-SAMPLE-IPAD"],
  ["MUR0060","Meeting Room","","monitor","other","Dell 27\" Monitor","Conference display","Office · 27\" 4K","—","SN-SAMPLE-MON"],
  ["MUR0061","Ryan T.","","monitor","other","Dell 24\" Monitor","Home setup","Home · 24\"","—","SN-SAMPLE-MON2"],
  ["MUR0062","Sara L.","","monitor","other","LG 27\" Monitor","Home setup","Home · 27\"","—","SN-SAMPLE-MON3"],
  ["MUR0070","Support","","peripheral","other","Jabra Headset","Support-desk headset","Wired","—","SN-SAMPLE-JAB"],
  ["MUR0090","Office","","infra","ups","APC UPS","Rack UPS","Backup power","—","SN-SAMPLE-UPS"],
  ["MUR0091","Office","","infra","net","Access Point","Wireless AP","Network","—","SN-SAMPLE-AP"],
  ["MUR0092","Office","","infra","net","Fibre ONT","Fibre terminal","Network","—","SN-SAMPLE-ONT"],
  ["MUR0093","Office","","infra","net","Firewall","Edge firewall","Network","—","SN-SAMPLE-FW"]
];
const SAMPLE_SPARES = [
  {item:'MacBook Air 13" M4 (spare)',category:'laptop',qty:1,min_qty:1,note:'Deploy on hardware failure / new hire'},
  {item:'External monitor',category:'monitor',qty:2,min_qty:1,note:''},
  {item:'USB-C charger (adapter + cable)',category:'charger',qty:3,min_qty:2,note:''},
  {item:'USB-C hub',category:'hub',qty:3,min_qty:2,note:''},
  {item:'Headset',category:'headset',qty:4,min_qty:2,note:''},
  {item:'Mouse',category:'mouse',qty:5,min_qty:2,note:''},
  {item:'Keyboard',category:'other',qty:2,min_qty:1,note:''},
  {item:'HP W1360A Black Toner (LaserJet MFP M232-M237)',category:'toner',qty:2,min_qty:1,note:'Log the date on each cartridge change'}
];
/* Anonymized sample purchases, shaped like the Invoice Master Tracker. */
const SAMPLE_INVOICES = [
  {invoice_no:'INV00001',purchase_date:'2026-05-26',vendor:'Icell Mauritius',buyer:'iWynn Solutions LTD',representative:'R. Soodarchand',item_description:'iPhone 15 128GB',category:'phone',quantity:1,unit_price:22500,total_amount:22500,currency:'Rs',payment_method:'JUICE',transaction_ref:'FT26XXXXYJTD',receipt_url:'',note:'New-hire handset'},
  {invoice_no:'INV00002',purchase_date:'2026-05-26',vendor:'Icell Mauritius',buyer:'iWynn Solutions LTD',representative:'R. Soodarchand',item_description:'Samsung S24 Ultra',category:'phone',quantity:1,unit_price:28000,total_amount:28000,currency:'Rs',payment_method:'JUICE',transaction_ref:'FT26XXXXR1VX',receipt_url:'',note:''},
  {invoice_no:'INV00003',purchase_date:'2026-05-26',vendor:'Brand House',buyer:'iWynn Solutions LTD',representative:'S. Pomosawmy',item_description:'Jabra Headset',category:'peripheral',quantity:1,unit_price:15000,total_amount:15000,currency:'Rs',payment_method:'Bank transfer',transaction_ref:'',receipt_url:'',note:''},
  {invoice_no:'INV00005',purchase_date:'2026-05-26',vendor:'Veeramootoo Trading',buyer:'iWynn Solutions LTD',representative:'R. Soodarchand',item_description:'iPhone 14 Pro',category:'phone',quantity:1,unit_price:23500,total_amount:23500,currency:'Rs',payment_method:'JUICE',transaction_ref:'FT26XXXXVW82',receipt_url:'',note:''}
];
/* Sample planned purchases (procurement). */
const SAMPLE_PROCUREMENT=[
  {item:'Laptop (MacBook Air 13" M4)',category:'laptop',for_who:'New hire — CRM',qty:1,unit_cost:45000,currency:'Rs',needed_by:'2026-08-15',status:'planned',note:''},
  {item:'Work phone (iPhone)',category:'phone',for_who:'New hire — CRM',qty:1,unit_cost:22500,currency:'Rs',needed_by:'2026-08-15',status:'ordered',note:''},
  {item:'Monitor',category:'monitor',for_who:'Office spare',qty:2,unit_cost:8000,currency:'Rs',needed_by:'',status:'planned',note:''}
];
function rowToObj(r){ return { tag:r[0], assignee:r[1], reassignedFrom:r[2], type:r[3], kind:r[4], model:r[5], variant:r[6], spec:r[7], chip:r[8], serial:r[9], retired:false, accessories:[] }; }

/* ------------------------------ db <-> app mapping ------------------------- */
function normAccessories(v){ if(Array.isArray(v)) return v.filter(x=>typeof x==="string"); if(typeof v==="string"){ try{ const p=JSON.parse(v); return Array.isArray(p)?p.filter(x=>typeof x==="string"):[]; }catch(e){ return []; } } return []; }
function normExtra(v){ if(v&&typeof v==="object"&&!Array.isArray(v)) return v; if(typeof v==="string"){ try{ const p=JSON.parse(v); return (p&&typeof p==="object"&&!Array.isArray(p))?p:{}; }catch(e){ return {}; } } return {}; }
function fromDb(r){ return { tag:r.tag, assignee:r.assignee||"", reassignedFrom:r.reassigned_from||"", type:r.type, kind:r.kind, model:r.model||"", variant:r.variant||"", spec:r.spec||"", chip:r.chip||"—", serial:r.serial||"", retired:!!r.retired, accessories:normAccessories(r.accessories) }; }
function toDb(a){ return { tag:a.tag, assignee:a.assignee, reassigned_from:a.reassignedFrom, type:a.type, kind:a.kind, model:a.model, variant:a.variant, spec:a.spec, chip:a.chip, serial:a.serial, retired:!!a.retired, accessories:normAccessories(a.accessories), updated_at:new Date().toISOString() }; }
function entryFromDb(r){ return {status:r.status||"pending", note:r.note||"", at:r.checked_at, by:r.checked_by||"", periph:{charger:!!r.charger,hub:!!r.hub,headset:!!r.headset,mouse:!!r.mouse}, extra:normExtra(r.extra)}; }
function spareFromDb(r){ return {id:r.id, item:r.item, category:r.category, qty:r.qty, min_qty:r.min_qty, note:r.note||"", low_alert_sent:!!r.low_alert_sent}; }
function invoiceFromDb(r){ return {id:r.id, invoice_no:r.invoice_no||"", purchase_date:r.purchase_date||"", vendor:r.vendor||"", buyer:r.buyer||"", representative:r.representative||"", item_description:r.item_description||"", category:r.category||"other", quantity:Number(r.quantity||0), unit_price:Number(r.unit_price||0), total_amount:Number(r.total_amount||0), currency:r.currency||"Rs", payment_method:r.payment_method||"", transaction_ref:r.transaction_ref||"", receipt_path:r.receipt_path||"", receipt_url:r.receipt_url||"", note:r.note||"", uploaded_by:r.uploaded_by||""}; }
function invoiceToDb(v){ return {invoice_no:v.invoice_no, purchase_date:v.purchase_date||null, vendor:v.vendor, buyer:v.buyer, representative:v.representative, item_description:v.item_description, category:v.category, quantity:v.quantity, unit_price:v.unit_price, total_amount:v.total_amount, currency:v.currency, payment_method:v.payment_method, transaction_ref:v.transaction_ref, receipt_path:v.receipt_path, receipt_url:v.receipt_url, note:v.note, uploaded_by:v.uploaded_by}; }
function procFromDb(r){ return {id:r.id, item:r.item||"", category:r.category||"other", for_who:r.for_who||"", qty:Number(r.qty||0), unit_cost:Number(r.unit_cost||0), currency:r.currency||"Rs", needed_by:r.needed_by||"", status:r.status||"planned", note:r.note||""}; }
function procToDb(p){ return {item:p.item, category:p.category, for_who:p.for_who, qty:p.qty, unit_cost:p.unit_cost, currency:p.currency, needed_by:p.needed_by||null, status:p.status, note:p.note}; }

/* --------------------------------- stores ---------------------------------- */
const LS_KEY="mur_sample_store";
function lsRead(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||"null"); }catch(e){ return null; } }
function lsWrite(o){ try{ localStorage.setItem(LS_KEY,JSON.stringify(o)); }catch(e){} }
function lsInit(){ let o=lsRead(); if(!o){ o={ assets:SAMPLE.map(rowToObj), entries:{}, spares:SAMPLE_SPARES.map((s,i)=>Object.assign({id:i+1},s)), invoices:SAMPLE_INVOICES.map((v,i)=>Object.assign({id:i+1},v)) }; lsWrite(o); } if(!o.spares){ o.spares=SAMPLE_SPARES.map((s,i)=>Object.assign({id:i+1},s)); lsWrite(o); } if(!o.invoices){ o.invoices=SAMPLE_INVOICES.map((v,i)=>Object.assign({id:i+1},v)); lsWrite(o); } if(!o.procurement){ o.procurement=SAMPLE_PROCUREMENT.map((p,i)=>Object.assign({id:i+1},p)); lsWrite(o); } return o; }

const localStore = {
  live:false,
  async allAssets(){ return lsInit().assets.slice(); },
  async putAsset(a){ const o=lsInit(); const i=o.assets.findIndex(x=>x.tag===a.tag); if(i>=0)o.assets[i]=a; else o.assets.push(a); lsWrite(o); },
  async delAsset(tag){ const o=lsInit(); o.assets=o.assets.filter(x=>x.tag!==tag); lsWrite(o); },
  async getHistory(){ return []; },
  async getEntries(q){ const o=lsInit(); const src=o.entries[q]||{}; const m={}; for(const t in src){ const e=src[t]; m[t]={status:e.status,note:e.note,at:e.at,by:e.by,periph:Object.assign(blankPeriph(),e.periph),extra:normExtra(e.extra)}; } return m; },
  async putEntry(q,tag,e){ const o=lsInit(); o.entries[q]=o.entries[q]||{}; o.entries[q][tag]=e; lsWrite(o); },
  async allEntries(){ const o=lsInit(); const out=[]; for(const q in o.entries) for(const tag in o.entries[q]){ const e=o.entries[q][tag]; out.push({quarter:q,tag,status:e.status,note:e.note,checked_at:e.at,checked_by:e.by,charger:e.periph.charger,hub:e.periph.hub,headset:e.periph.headset,mouse:e.periph.mouse,extra:normExtra(e.extra)}); } return out; },
  async allSpares(){ return lsInit().spares.slice(); },
  async addSpare(s){ const o=lsInit(); const id=(o.spares.reduce((m,x)=>Math.max(m,x.id),0)||0)+1; o.spares.push(Object.assign({id},s)); lsWrite(o); return id; },
  async updateSpare(id,patch){ const o=lsInit(); const i=o.spares.findIndex(x=>x.id===id); if(i>=0){ o.spares[i]=Object.assign(o.spares[i],patch); lsWrite(o); } },
  async delSpare(id){ const o=lsInit(); o.spares=o.spares.filter(x=>x.id!==id); lsWrite(o); },
  async allInvoices(){ return lsInit().invoices.slice(); },
  async addInvoice(v){ const o=lsInit(); const id=(o.invoices.reduce((m,x)=>Math.max(m,x.id),0)||0)+1; o.invoices.push(Object.assign({id},v)); lsWrite(o); return id; },
  async updateInvoice(id,patch){ const o=lsInit(); const i=o.invoices.findIndex(x=>x.id===id); if(i>=0){ o.invoices[i]=Object.assign(o.invoices[i],patch); lsWrite(o); } },
  async delInvoice(id){ const o=lsInit(); o.invoices=o.invoices.filter(x=>x.id!==id); lsWrite(o); },
  async uploadReceipt(){ throw new Error("Sign in to upload receipts"); },
  async receiptUrl(){ return ""; },
  async allProcurement(){ return lsInit().procurement.slice(); },
  async addPurchase(p){ const o=lsInit(); const id=(o.procurement.reduce((m,x)=>Math.max(m,x.id),0)||0)+1; o.procurement.push(Object.assign({id},p)); lsWrite(o); return id; },
  async updatePurchase(id,patch){ const o=lsInit(); const i=o.procurement.findIndex(x=>x.id===id); if(i>=0){ o.procurement[i]=Object.assign(o.procurement[i],patch); lsWrite(o); } },
  async delPurchase(id){ const o=lsInit(); o.procurement=o.procurement.filter(x=>x.id!==id); lsWrite(o); },
  async getSetting(k){ try{ return JSON.parse(localStorage.getItem("mur_settings")||"{}")[k]; }catch(e){ return undefined; } },
  async setSetting(k,v){ let m={}; try{ m=JSON.parse(localStorage.getItem("mur_settings")||"{}"); }catch(e){} m[k]=v; try{ localStorage.setItem("mur_settings",JSON.stringify(m)); }catch(e){} },
  async getAdmins(){ return []; }, async addAdmin(){}, async removeAdmin(){}
};

const supaStore = {
  live:true,
  async allAssets(){ const {data,error}=await sb.from("assets").select("*").order("tag"); if(error)throw error; return (data||[]).map(fromDb); },
  async putAsset(a){ const payload=toDb(a); let {error}=await sb.from("assets").upsert(payload,{onConflict:"tag"});
    if(error && /accessories/.test(error.message||"")){ delete payload.accessories; ({error}=await sb.from("assets").upsert(payload,{onConflict:"tag"})); }
    if(error)throw error; },
  async delAsset(tag){ const {error}=await sb.from("assets").delete().eq("tag",tag); if(error)throw error; },
  async getHistory(tag){ const {data,error}=await sb.from("asset_history").select("*").eq("tag",tag).order("changed_at",{ascending:false}).limit(20); if(error)throw error; return data||[]; },
  async getEntries(q){ const {data,error}=await sb.from("audit_entries").select("*").eq("quarter",q); if(error)throw error; const m={}; (data||[]).forEach(r=>{ m[r.tag]=entryFromDb(r); }); return m; },
  async putEntry(q,tag,e){ const base={quarter:q,tag,status:e.status,note:e.note,checked_at:e.at,checked_by:e.by,charger:e.periph.charger,hub:e.periph.hub,headset:e.periph.headset,mouse:e.periph.mouse}; let {error}=await sb.from("audit_entries").upsert(Object.assign({extra:normExtra(e.extra)},base),{onConflict:"quarter,tag"});
    if(error && /extra/.test(error.message||"")){ ({error}=await sb.from("audit_entries").upsert(base,{onConflict:"quarter,tag"})); }
    if(error)throw error; },
  async allEntries(){ const {data,error}=await sb.from("audit_entries").select("*"); if(error)throw error; return data||[]; },
  async allSpares(){ const {data,error}=await sb.from("spares").select("*").order("category").order("item"); if(error)throw error; return (data||[]).map(spareFromDb); },
  async addSpare(s){ const {data,error}=await sb.from("spares").insert({item:s.item,category:s.category,qty:s.qty,min_qty:s.min_qty,note:s.note}).select("id").single(); if(error)throw error; return data&&data.id; },
  async updateSpare(id,patch){ patch=Object.assign({},patch,{updated_at:new Date().toISOString()}); const {error}=await sb.from("spares").update(patch).eq("id",id); if(error)throw error; },
  async delSpare(id){ const {error}=await sb.from("spares").delete().eq("id",id); if(error)throw error; },
  async allInvoices(){ const {data,error}=await sb.from("invoices").select("*").order("purchase_date",{ascending:false,nullsFirst:false}).order("id",{ascending:false}); if(error)throw error; return (data||[]).map(invoiceFromDb); },
  async addInvoice(v){ const {data,error}=await sb.from("invoices").insert(invoiceToDb(v)).select("id").single(); if(error)throw error; return data&&data.id; },
  async updateInvoice(id,patch){ const {error}=await sb.from("invoices").update(invoiceToDb(Object.assign({},patch))).eq("id",id); if(error)throw error; },
  async delInvoice(id){ const {error}=await sb.from("invoices").delete().eq("id",id); if(error)throw error; },
  async uploadReceipt(file){ const safe=file.name.replace(/[^\w.\-]+/g,"_"); const path=Date.now()+"_"+safe; const {error}=await sb.storage.from("receipts").upload(path,file,{upsert:false,contentType:file.type||"application/octet-stream"}); if(error)throw error; return path; },
  async receiptUrl(path){ if(!path)return ""; const {data,error}=await sb.storage.from("receipts").createSignedUrl(path,3600); if(error)throw error; return data.signedUrl; },
  async allProcurement(){ const {data,error}=await sb.from("procurement").select("*").order("status").order("needed_by",{ascending:true,nullsFirst:false}).order("id"); if(error)throw error; return (data||[]).map(procFromDb); },
  async addPurchase(p){ const {data,error}=await sb.from("procurement").insert(procToDb(p)).select("id").single(); if(error)throw error; return data&&data.id; },
  async updatePurchase(id,patch){ const db=Object.assign({},patch); if("needed_by" in db) db.needed_by=db.needed_by||null; delete db.id; const {error}=await sb.from("procurement").update(db).eq("id",id); if(error)throw error; },
  async delPurchase(id){ const {error}=await sb.from("procurement").delete().eq("id",id); if(error)throw error; },
  async getSetting(k){ const {data,error}=await sb.from("app_settings").select("value").eq("key",k).maybeSingle(); if(error)throw error; return data?data.value:undefined; },
  async setSetting(k,v){ const {error}=await sb.from("app_settings").upsert({key:k,value:v,updated_at:new Date().toISOString()},{onConflict:"key"}); if(error)throw error; },
  async getAdmins(){ const {data,error}=await sb.from("admins").select("email,name").order("email"); if(error)throw error; return data||[]; },
  async addAdmin(email,name){ const {error}=await sb.from("admins").upsert({email:email.toLowerCase(),name:name||"",added_by:(state.user&&state.user.email)||""},{onConflict:"email"}); if(error)throw error; },
  async removeAdmin(email){ const {error}=await sb.from("admins").delete().eq("email",email.toLowerCase()); if(error)throw error; }
};

let store = localStore;

/* --------------------------------- app state ------------------------------- */
const state = {
  view:"register", assets:[], entries:{}, spares:[], invoices:[], procurement:[], quarter:currentQuarter(),
  filter:"all", group:"type", q:"", spareSort:"qty", auditMode:false, loading:true,
  user:null, auditor:"", kit:null, gerardEmail:CFG.REPORT_TO||"gcateau@bspot.com",
  stockAlertTo:(CFG.STOCK_ALERT_TO&&CFG.STOCK_ALERT_TO.length)?CFG.STOCK_ALERT_TO:["yramchurn@bspot.com","rsoodarchand@bspot.com"],
  settings:{}, admins:[], isAdmin:false, onboarding:[], documents:[], announcements:[]
};
/* Seeded from CorpIT → "KB: IT First Day of Onboarding" (gpn-dev Confluence). */
const DEFAULT_ONBOARD=[
  "Contact the new employee (confirm onboarding date & time)",
  "Provide laptop credentials — no Apple ID / FindMy on the machine",
  "Initial laptop setup",
  "Sign into Google Chrome (work email, Sync on, Google Password Manager off — use LastPass)",
  "Send Zoom link & connect for remote access",
  "Initiate remote access (follow the New Hire & Separation sheet)",
  "LastPass + authenticator app (Sophos Intercept X)",
  "Slack — accept invite, desktop app, set title / phone / photo",
  "VPN profile (Viscosity) if requested",
  "Assign & tag the laptop in the register",
  "Assign work phone",
  "Hand off to the department manager via Slack"
];
const DEFAULT_ONBOARD_DOCS=[
  {label:"KB: IT First Day of Onboarding",url:"https://gpn-dev.atlassian.net/wiki/spaces/CorpIT/pages/4162322433"},
  {label:"Onboarding & Offboarding Structure",url:"https://gpn-dev.atlassian.net/wiki/spaces/CorpIT/pages/4084006939"},
  {label:"User Management (On/Offboarding)",url:"https://gpn-dev.atlassian.net/wiki/spaces/CorpIT/pages/2809397269"}
];
function currentQuarter(d){ d=d||new Date(); return d.getFullYear()+"-Q"+(Math.floor(d.getMonth()/3)+1); }
function qPretty(q){ const [y,qq]=q.split("-Q"); return "Q"+qq+" "+y; }
function recentQuarters(n){ const out=[]; const d=new Date(); for(let i=0;i<n;i++){ out.push(currentQuarter(d)); d.setMonth(d.getMonth()-3); } return out; }

/* --------------------------------- helpers --------------------------------- */
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }
function toast(msg,isErr){
  const host=$("#toastHost"); const el=document.createElement("div");
  el.className="toast"+(isErr?" err":"");
  el.innerHTML=(isErr?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 6"/></svg>')+"<span>"+esc(msg)+"</span>";
  host.appendChild(el);
  setTimeout(()=>{ el.style.opacity="0"; el.style.transform="translateY(8px)"; setTimeout(()=>el.remove(),250); }, 2600);
}
function setSaved(txt){ $("#savedText").textContent=txt; }
function setNum(el,val){ if(el) el.textContent=val; }

/* --------------------------- audit entry access ---------------------------- */
function entry(tag){ const e=state.entries[tag]; if(!e) return {status:"pending",note:"",at:null,by:"",periph:blankPeriph(),extra:{}}; if(!e.periph) e.periph=blankPeriph(); if(!e.extra) e.extra={}; return e; }
async function loadEntries(){ try{ state.entries=await store.getEntries(state.quarter); }catch(e){ state.entries={}; toast("Couldn't load check: "+e.message,true); } }
async function saveEntry(tag,patch){
  const cur=state.entries[tag]||{status:"pending",note:"",at:null,by:"",periph:blankPeriph(),extra:{}};
  const e=Object.assign({},cur,patch,{at:new Date().toISOString(),by:state.auditor});
  if(!e.periph) e.periph=blankPeriph();
  if(!e.extra) e.extra={};
  state.entries[tag]=e;
  try{ await store.putEntry(state.quarter,tag,e); setSaved("Saved "+new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})); }
  catch(err){ toast("Save failed: "+err.message,true); }
}

/* --------------------------------- icons ----------------------------------- */
const IC={
  apple:'<svg class="dicon" viewBox="0 0 24 24" fill="currentColor"><path d="M16.4 12.6c0-2.2 1.8-3.2 1.9-3.3-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.5 0-2.8.8-3.6 2.2-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.6 2.2 2.7 2.2 1 0 1.4-.7 2.7-.7 1.2 0 1.6.7 2.7.6 1.1 0 1.8-1 2.5-2 .8-1.2 1.1-2.3 1.1-2.4-.1 0-2.5-.9-2.5-3.6zM14.3 6c.6-.7 1-1.7.9-2.7-.8 0-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.6.9.1 1.8-.5 2.5-1.2z"/></svg>',
  windows:'<svg class="dicon" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5.7l7.5-1v7.1H3zM11.5 4.6L21 3.3v9.5h-9.5zM3 12.9h7.5v7L3 18.9zM11.5 12.9H21v9.5l-9.5-1.3z"/></svg>',
  ups:'<svg class="dicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M13 7l-3 5h4l-3 5"/></svg>',
  net:'<svg class="dicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13a10 10 0 0 1 14 0"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 9.5a15 15 0 0 1 20 0"/><circle cx="12" cy="20" r="1"/></svg>',
  android:'<svg class="dicon" viewBox="0 0 24 24" fill="currentColor"><path d="M6 9h12v8a1 1 0 0 1-1 1h-1v3h-2v-3h-2v3H8v-3H7a1 1 0 0 1-1-1V9zm-3 .5a1.3 1.3 0 0 1 2.6 0V15A1.3 1.3 0 0 1 3 15V9.5zm15.4 0a1.3 1.3 0 0 1 2.6 0V15a1.3 1.3 0 0 1-2.6 0V9.5zM7.5 8a4.6 4.6 0 0 1 9 0h-9zm1.8-2.6l-.8-1.3.7-.4.9 1.4a5.6 5.6 0 0 1 4.2 0l.9-1.4.7.4-.8 1.3M10 6.2h.01M14 6.2h.01"/></svg>',
  other:'<svg class="dicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6v6H9z"/></svg>'
};
/* type-level icons for non-computer devices */
const TIC={
  phone:'<svg class="dicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>',
  tablet:'<svg class="dicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M11 18h2"/></svg>',
  monitor:'<svg class="dicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  peripheral:'<svg class="dicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2" y="14" width="4" height="6" rx="1.5"/><rect x="18" y="14" width="4" height="6" rx="1.5"/></svg>',
  other:'<svg class="dicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/></svg>'
};
/* Laptops & phones are shown by brand (kind); other types by their type icon. */
function deviceIcon(a){
  if(a.type==="laptop"||a.type==="phone") return IC[a.kind]||TIC[a.type]||IC.other;
  if(a.type==="infra") return IC[a.kind]||IC.net;
  return TIC[a.type]||IC.other;
}
const SPIC={
  laptop:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M2 20h20"/></svg>',
  monitor:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  charger:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3l-3 8h5l-3 10"/></svg>',
  hub:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9" width="18" height="6" rx="2"/><path d="M7 9V7M12 9V7M17 9V7"/></svg>',
  headset:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2" y="14" width="4" height="6" rx="1.5"/><rect x="18" y="14" width="4" height="6" rx="1.5"/></svg>',
  mouse:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/></svg>',
  toner:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="8" rx="1.5"/><path d="M7 8V6.5h9V8"/><path d="M16.5 12H19"/></svg>',
  printer:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M8 17h8v4H8z"/><path d="M17.5 12.5h.01"/></svg>',
  other:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/></svg>'
};
const CHECK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 6"/></svg>';
const WRENCH='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5a4 4 0 0 0-5 5.2l-6.3 6.3 2.8 2.8 6.3-6.3a4 4 0 0 0 5.2-5l-2.6 2.6-2.1-.5-.5-2.1z"/></svg>';
const XMARK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const REPL='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11a9 9 0 0 1 15-6.4L21 8"/><path d="M21 3v5h-5"/><path d="M21 13a9 9 0 0 1-15 6.4L3 16"/><path d="M3 21v-5h5"/></svg>';
const NOTE='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v11l-4 4H4z"/><path d="M16 19v-4h4"/></svg>';
const REASSIGN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 12V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 12v3a3 3 0 0 1-3 3H3"/></svg>';
const EDIT='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const PLUS='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

const ST={
  present:{l:"Present",c:"st-present",i:CHECK,attn:false},
  damaged:{l:"Damaged",c:"st-damaged",i:WRENCH,attn:true},
  missing:{l:"Missing",c:"st-missing",i:XMARK,attn:true},
  replace:{l:"Replace",c:"st-replace",i:REPL,attn:true},
  pending:{l:"Not checked",c:"st-pending",i:"",attn:false}
};
const EDGE={present:"is-present",damaged:"is-damaged",missing:"is-missing",replace:"is-replace",pending:"is-pending"};
function statusChip(st){ const m=ST[st]||ST.pending; return '<span class="status-chip '+m.c+'">'+(m.i||"")+m.l+'</span>'; }

/* --------------------------------- stats ----------------------------------- */
function activeAssets(){ return state.assets.filter(a=>!a.retired); }
// The Register excludes monitors — they are tracked in the Spares Monitors panel.
function registerAssets(){ return activeAssets().filter(a=>a.type!=="monitor"); }
function computeStats(){
  const act=registerAssets();
  const byType={}; TYPE_ORDER.forEach(t=>byType[t]=0);
  act.forEach(a=>{ byType[a.type]=(byType[a.type]||0)+1; });
  const laptops=act.filter(a=>a.type==="laptop"), infra=act.filter(a=>a.type==="infra");
  const chips={M2:0,M3:0,M4:0,PC:0}; laptops.forEach(a=>{ chips[a.chip]=(chips[a.chip]||0)+1; });
  let present=0,issues=0,periphGaps=0;
  act.forEach(a=>{ const e=entry(a.tag);
    if(e.status==="present")present++; else if(ST[e.status]&&ST[e.status].attn)issues++;
    if(a.type==="laptop"&&e.status!=="pending"&&PERIPH.some(p=>!e.periph[p[0]]))periphGaps++; });
  return {total:act.length,laptops:laptops.length,infra:infra.length,byType,chips,present,issues,checked:present+issues,pending:act.length-present-issues,periphGaps};
}
function typeMix(byType){
  return TYPE_ORDER.filter(t=>byType[t]).map(t=>byType[t]+" "+(byType[t]===1?TYPES[t].label.toLowerCase():TYPES[t].group.toLowerCase())).join(" · ")||"—";
}
function renderStats(){
  const s=computeStats();
  setNum($("#sTotal"),s.total);
  $("#sTotalU").textContent=typeMix(s.byType);
  // Second KPI card tracks the active type filter (defaults to Laptops).
  const focus = TYPE_ORDER.includes(state.filter) ? state.filter : "laptop";
  $("#sLaptopsK").textContent = TYPES[focus].group;
  setNum($("#sLaptops"), s.byType[focus]||0);
  const spark=$("#sparkChips"); spark.innerHTML="";
  if(focus==="laptop"){
    $("#sLaptopsU").textContent="M2 · "+s.chips.M2+"   M3 · "+s.chips.M3+"   M4 · "+s.chips.M4+(s.chips.PC?"   PC · "+s.chips.PC:"");
    const cc={M2:"var(--accent)",M3:"var(--ok)",M4:"var(--info)",PC:"var(--warn)"}; const tot=s.laptops||1;
    ["M2","M3","M4","PC"].forEach(c=>{ if(s.chips[c]){ const i=document.createElement("i"); i.style.background=cc[c]; i.style.width=Math.max(6,(s.chips[c]/tot)*100)+"px"; i.title=c+": "+s.chips[c]; spark.appendChild(i); } });
  } else {
    const kinds={}; registerAssets().filter(a=>a.type===focus).forEach(a=>{ kinds[a.kind]=(kinds[a.kind]||0)+1; });
    const ks=Object.keys(kinds);
    $("#sLaptopsU").textContent = ks.map(k=>(KINDS[k]||k)+" · "+kinds[k]).join("   ")||"in service";
    const cc={apple:"var(--ink-2)",android:"var(--ok)",windows:"var(--info)",ups:"var(--warn)",net:"var(--info)",other:"var(--pend)"};
    const tot=(s.byType[focus]||1);
    ks.forEach(k=>{ const i=document.createElement("i"); i.style.background=cc[k]||"var(--pend)"; i.style.width=Math.max(6,(kinds[k]/tot)*100)+"px"; i.title=(KINDS[k]||k)+": "+kinds[k]; spark.appendChild(i); });
  }
  $("#pQuarter").textContent=qPretty(state.quarter);
  setNum($("#pDone"),s.present); $("#pTotal").textContent=s.total; setNum($("#pFlags"),s.issues);
  $("#lgOk").textContent=s.present; $("#lgBad").textContent=s.issues; $("#lgPend").textContent=s.pending;
  const t=s.total||1; $("#mOk").style.width=(s.present/t*100)+"%"; $("#mBad").style.width=(s.issues/t*100)+"%";
  { const pct=Math.round(s.checked/t*100); const fill=$("#apFill"), txt=$("#apText"); if(fill) fill.style.width=pct+"%"; if(txt) txt.textContent=s.checked+" / "+s.total+" checked · "+pct+"%"; }
  $("#navRegisterCount").textContent=s.total;
  $("#navSparesCount").textContent=state.spares.length||"";
  $("#navInvoicesCount").textContent=state.invoices.length||"";
  { const openp=state.procurement.filter(p=>p.status!=="received").length; $("#navProcurementCount").textContent=openp||""; }
  { const c=$("#navOnboardingCount"); if(c){ const open=(state.onboarding||[]).filter(o=>{const p=onboardProgress(o);return !(p.total&&p.done===p.total);}).length; c.textContent=open||""; } }
  { const c=$("#navStaffCount"); if(c) c.textContent=staffPeople().length||""; }
  { const c=$("#navDocumentsCount"); if(c) c.textContent=(state.documents||[]).length||""; }
  { const c=$("#navAnnouncementsCount"); if(c) c.textContent=(state.announcements||[]).length||""; }
  renderNudge();
}

/* --------------------------------- register -------------------------------- */
function rowHTML(a){
  const e=entry(a.tag); const isLap=a.type==="laptop"; const icon=deviceIcon(a);
  const who=a.type==="infra"
    ? '<div class="name">'+esc(a.assignee||"Office")+'</div><div class="role">Shared office equipment</div>'
    : '<div class="name">'+esc(a.assignee)+'</div><div class="role">'+esc(a.model)+' user</div>'+
      (a.reassignedFrom?'<div class="reassigned">'+REASSIGN+'Reassigned from '+esc(a.reassignedFrom)+'</div>':'');
  const spec=a.type==="infra"?esc(a.variant):esc(a.spec)+" · "+esc(a.chip);
  const cond=["present","damaged","missing","replace"].map(c=>'<button class="cond-btn c-'+c+'" data-cond="'+c+'" aria-pressed="'+(e.status===c)+'" title="'+ST[c].l+'" aria-label="'+ST[c].l+' — '+esc(a.tag)+'">'+ST[c].i+'</button>').join("");
  const accs = Array.isArray(a.accessories)?a.accessories:[];
  const defChips = isLap ? PERIPH.map(p=>'<button class="pchip" data-p="'+p[0]+'" aria-pressed="'+(!!e.periph[p[0]])+'"><span class="pcheck">'+CHECK+'</span>'+esc(p[1])+'</button>').join("") : "";
  const custChips = accs.map(name=>'<button class="pchip pchip-cust" data-acc="'+esc(name)+'" aria-pressed="'+(!!e.extra[name])+'"><span class="pcheck">'+CHECK+'</span>'+esc(name)+'<span class="pacc-del" data-del-acc="'+esc(name)+'" role="button" tabindex="0" aria-label="Remove '+esc(name)+'" title="Remove accessory">×</span></button>').join("");
  const addChip = '<button class="pchip pchip-add" data-act="add-acc" title="Add an accessory for this person">'+PLUS+'Accessory</button>';
  const naHint = (!isLap && !accs.length) ? '<span class="periph-na">No standard accessories for this item.</span>' : "";
  const pchips = defChips + custChips + naHint + addChip;
  const sumItems = (isLap?PERIPH.map(p=>[p[1],!!e.periph[p[0]]]):[]).concat(accs.map(name=>[name,!!e.extra[name]]));
  const psum = (!state.auditMode && sumItems.length && e.status!=="pending") ? '<div class="periph-sum">'+sumItems.map(it=>'<span class="'+(it[1]?"yes":"no")+'">'+(it[1]?CHECK:XMARK)+esc(it[0])+'</span>').join("")+'</div>' : "";
  const noteBadge=(!state.auditMode && e.note)?'<div class="note-badge">'+NOTE+'<span>'+esc(e.note)+'</span></div>':"";
  return '<div class="row '+EDGE[e.status]+'" data-tag="'+esc(a.tag)+'">'+
    '<div class="tag" title="Asset tag"><span class="sheen"></span><span class="tag-t">'+esc(a.tag)+'</span></div>'+
    '<div class="who">'+who+'</div>'+
    '<div class="device"><div class="d-main">'+icon+'<span>'+esc(a.model)+'</span></div><div class="d-spec">'+spec+'</div></div>'+
    '<div class="serial"><span class="s-k">Serial / ID</span>'+esc(a.serial)+'</div>'+
    '<div class="row-status">'+statusChip(e.status)+'<div class="audit-actions">'+cond+'<span class="aa-sep"></span><button class="aud-btn set-edit" data-act="edit" title="Edit asset" aria-label="Edit '+esc(a.tag)+'">'+EDIT+'</button></div></div>'+
    '<div class="check-line"><div class="periph" aria-label="Accessory checklist">'+(isLap?'<span class="periph-k">Accessories</span>':'')+pchips+'</div><textarea class="note-ta" placeholder="Note — condition detail, location, or reason…">'+esc(e.note)+'</textarea></div>'+
    psum + noteBadge +
  '</div>';
}
const GROUPS={
  type:{ order:TYPE_ORDER, label:Object.fromEntries(TYPE_ORDER.map(t=>[t,TYPES[t].group])), of:a=>a.type },
  chip:{ order:["M2","M3","M4","PC","—"], label:{M2:"Apple M2",M3:"Apple M3",M4:"Apple M4",PC:"Windows PC","—":"No chip / other"}, of:a=>(a.type==="laptop"?a.chip:"—") },
  status:{ order:["missing","replace","damaged","pending","present"], label:{missing:"Missing — needs attention",replace:"Needs replacement",damaged:"Damaged — needs repair",pending:"Not yet checked",present:"Present & accounted for"}, of:a=>entry(a.tag).status }
};
function passFilter(a){
  if(state.filter==="flag"){ const st=entry(a.tag).status; if(!(ST[st]&&ST[st].attn)) return false; }
  else if(state.filter!=="all" && a.type!==state.filter) return false;
  if(state.q){ const hay=(a.tag+" "+a.assignee+" "+a.reassignedFrom+" "+a.model+" "+a.variant+" "+a.spec+" "+a.chip+" "+a.serial).toLowerCase(); if(!hay.includes(state.q.toLowerCase())) return false; }
  return true;
}
function renderRegister(){
  const host=$("#register");
  if(state.loading){ host.innerHTML='<div class="rows">'+Array(6).fill('<div class="skeleton"></div>').join("")+'</div>'; return; }
  const list=registerAssets().filter(passFilter);
  if(!list.length){ host.innerHTML='<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><div>No assets match this view.</div></div>'; return; }
  const g=GROUPS[state.group]; const buckets={};
  list.forEach(a=>{ const k=g.of(a); (buckets[k]=buckets[k]||[]).push(a); });
  const keys=g.order.filter(k=>buckets[k]).concat(Object.keys(buckets).filter(k=>!g.order.includes(k)));
  let html="";
  keys.forEach(k=>{ const items=buckets[k]; if(!items)return; items.sort((a,b)=>a.tag.localeCompare(b.tag));
    html+='<div class="group-head"><span>'+esc(g.label[k]||k)+'</span><span class="count">'+items.length+'</span><span class="rule"></span></div>';
    html+='<div class="rows">'+items.map(rowHTML).join("")+'</div>'; });
  host.innerHTML=html;
}
function refreshRow(tag){ const a=state.assets.find(x=>x.tag===tag); if(!a)return; const old=$('.row[data-tag="'+CSS.escape(tag)+'"]'); if(!old)return; const tmp=document.createElement("div"); tmp.innerHTML=rowHTML(a); old.replaceWith(tmp.firstElementChild); }

/* --------------------------------- spares ---------------------------------- */
// For monitor stock a min of 0 means "no threshold" (never low); other categories keep qty<=min.
function isLow(s){ return (s.category==="monitor") ? (s.min_qty>0 && s.qty<=s.min_qty) : (s.qty<=s.min_qty); }
function sparePass(s){ if(!state.q) return true; return (s.item+" "+s.category+" "+s.note).toLowerCase().includes(state.q.toLowerCase()); }
function spareHTML(s){
  const low=isLow(s);
  return '<div class="spare-row'+(low?" is-low":"")+'" data-id="'+s.id+'">'+
    '<div class="spare-ic">'+(SPIC[s.category]||SPIC.other)+'</div>'+
    '<div class="spare-main"><div class="spare-name">'+esc(s.item)+'</div>'+
      '<div class="spare-cat">'+esc(s.category)+(low?'<span class="low-badge">· Low (min '+s.min_qty+')</span>':'')+'</div>'+
      (s.note?'<div class="spare-note">'+esc(s.note)+'</div>':'')+'</div>'+
    '<div style="display:flex;align-items:center">'+
      '<div class="qty"><button class="qbtn" data-act="dec" aria-label="Decrease" '+(s.qty<=0?"disabled":"")+'>−</button><span class="qval">'+s.qty+'</span><button class="qbtn" data-act="inc" aria-label="Increase">+</button></div>'+
      '<button class="btn btn-ghost icon-btn spare-edit" data-act="edit" aria-label="Edit '+esc(s.item)+'">'+EDIT+'</button>'+
    '</div>'+
  '</div>';
}
/* ---- monitors overview: deployed monitors broken down by condition/location ---
   Reads monitor assets from the register (type="monitor"). Location comes from
   the asset's Spec field ("Office"/"Home"/room) or a home-like assignee; broken
   = a current-quarter audit status of damaged/missing/replace. Spare (available)
   monitors come from the Spares stock lines in the "monitor" category. */
function monLocation(a){ const s=((a.spec||"")+" "+(a.assignee||"")).toLowerCase(); return /home|remote|wfh/.test(s)?"home":"office"; }
function monIsBroken(a){ const st=entry(a.tag).status; return st==="damaged"||st==="missing"||st==="replace"; }
function monIsPerson(a){ const w=(a.assignee||"").trim().toLowerCase(); return !!w && !/office|meeting|room|store|spare|stock|unassigned|reception|boardroom/.test(w); }
function computeMonitors(){
  const mons=activeAssets().filter(a=>a.type==="monitor");
  const broken=mons.filter(monIsBroken);
  const working=mons.filter(a=>!monIsBroken(a));
  const home=working.filter(a=>monLocation(a)==="home");
  const office=working.filter(a=>monLocation(a)==="office");
  const homeList=home.map(a=>({who:monIsPerson(a)?a.assignee:(a.assignee||"—"),tag:a.tag}));
  const spareQty=state.spares.filter(s=>s.category==="monitor").reduce((m,s)=>m+(s.qty||0),0);
  return {total:mons.length, inUse:working.length, broken:broken.length, office:office.length, home:home.length, homeList, spareQty};
}
function renderMonitors(){
  const el=$("#monSummary"); if(!el) return;
  el.hidden=false;
  const m=computeMonitors();
  const homeNames = m.homeList.length
    ? '<div class="mon-home"><span class="mon-home-k">At home with</span> '+m.homeList.map(h=>'<span class="mon-chip">'+esc(h.who)+'</span>').join("")+'</div>'
    : "";
  const btn='<button class="btn btn-sm" id="monManage" title="Add or update monitors">'+EDIT+'Update monitors</button>';
  const tile=(k,v,bucket,cls)=>{
    const canDec = bucket==="spare" ? m.spareQty>0 : monBucketAll(bucket).length>0;
    return '<div class="mon-tile mon-tile-adj'+(cls?" "+cls:"")+'"><span class="mon-v">'+v+'</span><span class="mon-k">'+k+'</span>'+
      '<div class="mon-qty"><button class="qbtn" type="button" data-act="mon-dec" data-bucket="'+bucket+'"'+(canDec?"":" disabled")+'>−</button>'+
      '<button class="qbtn" type="button" data-act="mon-inc" data-bucket="'+bucket+'">+</button></div></div>';
  };
  el.innerHTML='<div class="mon-title">Monitors <span class="mon-count">'+m.total+' deployed'+(m.spareQty?' · '+m.spareQty+' spare':'')+'</span>'+btn+'</div>'+
    '<div class="mon-tiles">'+
      tile("In use",m.inUse,"inuse")+
      tile("At office",m.office,"office")+
      tile("At home",m.home,"home")+
      tile("Broken",m.broken,"broken",m.broken?"is-bad":"")+
      tile("Spare in stock",m.spareQty,"spare")+
    '</div>'+
    (m.total?homeNames:'<div class="mon-empty">No monitors tracked yet — use <b>Update monitors</b> to add who has one and where.</div>');
}
function nextMonTag(){
  let max=0; state.assets.forEach(a=>{ const mm=/^MON(\d+)$/.exec(a.tag); if(mm) max=Math.max(max,parseInt(mm[1])); });
  return "MON"+String(max+1).padStart(4,"0");
}
function homeNameRow(name){
  return '<div class="mon-home-row"><input class="mh-name" value="'+esc(name||"")+'" placeholder="Name — who has it at home"><button class="btn btn-ghost icon-btn mh-del" type="button" title="Remove">'+XMARK+'</button></div>';
}
// Unnamed, shared monitors (no person, no serial) — safe to add/remove by count.
// Named or serial-tagged monitors are only touched via the Update monitors editor.
function monGeneric(){
  return activeAssets().filter(a=>a.type==="monitor" && !(a.serial||"").trim() && ["office","home","","store","stock","spare"].includes((a.assignee||"").trim().toLowerCase()));
}
function monBucketFilter(list,bucket){
  if(bucket==="office") return list.filter(a=>!monIsBroken(a) && monLocation(a)==="office");
  if(bucket==="home")   return list.filter(a=>!monIsBroken(a) && monLocation(a)==="home");
  if(bucket==="broken") return list.filter(a=> monIsBroken(a));
  if(bucket==="inuse")  return list.filter(a=>!monIsBroken(a));
  return [];
}
// unnamed/shared units in a bucket (removed first)
function monBucketCands(bucket){ return monBucketFilter(monGeneric(),bucket); }
// every monitor in a bucket, named ones included (so a tile can be taken down to 0)
function monBucketAll(bucket){ return monBucketFilter(activeAssets().filter(a=>a.type==="monitor"),bucket); }
// pick which unit a "-" should act on: unnamed first, then named, newest tag first
function monPickForRemoval(bucket){
  const gen=monBucketCands(bucket).sort((a,b)=>b.tag.localeCompare(a.tag));
  if(gen.length) return gen[0];
  const all=monBucketAll(bucket).sort((a,b)=>b.tag.localeCompare(a.tag));
  return all[0]||null;
}
function newMon(loc){ return {tag:nextMonTag(),assignee:(loc==="home"?"Home":"Office"),reassignedFrom:"",type:"monitor",kind:"other",model:"Monitor",variant:(loc==="home"?"Home monitor":"Office monitor"),spec:(loc==="home"?"Home":"Office"),chip:"—",serial:"",retired:false}; }
async function monAdjust(bucket,delta){
  if(!store.live){ toast("Sign in to update monitors",true); openAuthModal(); return; }
  try{
    // Spare stock = a Spares line in the "monitor" category.
    if(bucket==="spare"){
      let sp=state.spares.find(s=>s.category==="monitor");
      if(!sp){ if(delta<0) return; await store.addSpare({item:"Spare monitor",category:"monitor",qty:1,min_qty:0,note:""}); }
      else { const nq=Math.max(0,sp.qty+delta); await store.updateSpare(sp.id,{qty:nq}); }
      state.spares=await store.allSpares(); renderAll(); setSaved("Monitor stock updated"); return;
    }
    // Broken toggles a unit's condition rather than adding/removing hardware.
    if(bucket==="broken"){
      if(delta>0){
        const w=monGeneric().filter(a=>!monIsBroken(a)).sort((a,b)=>(monLocation(a)==="office"?-1:1));
        if(w.length){ await saveEntry(w[0].tag,{status:"damaged"}); renderAll(); setSaved("Flagged broken ("+w[0].tag+")"); return; }
        const obj=newMon("office"); await store.putAsset(obj); state.assets.push(obj); await saveEntry(obj.tag,{status:"damaged"}); renderAll(); setSaved("Broken monitor added ("+obj.tag+")"); return;
      }
      const brk=monPickForRemoval("broken");
      if(!brk){ toast("No broken monitor to clear",true); return; }
      await saveEntry(brk.tag,{status:"present"}); renderAll(); setSaved("Marked working ("+brk.tag+")"); return;
    }
    // office / home / inuse: add or remove a unit (unnamed first, then named — so it can reach 0).
    if(delta>0){
      const obj=newMon(bucket==="home"?"home":"office");
      await store.putAsset(obj); state.assets.push(obj); renderAll(); setSaved("Monitor added ("+obj.tag+")");
    } else {
      const a=monPickForRemoval(bucket);
      if(!a){ toast("Nothing to remove here",true); return; }
      await store.delAsset(a.tag); state.assets=state.assets.filter(x=>x.tag!==a.tag); renderAll(); setSaved("Monitor removed ("+a.tag+")");
    }
  }catch(e){ toast(e.message,true); }
}
function openMonitorsModal(){
  if(!store.live){ toast("Sign in to update monitors",true); openAuthModal(); return; }
  const m=computeMonitors();
  const homeNames=m.homeList.map(h=>h.who);
  openModal("Monitors",
    '<p class="hint">Set how many monitors are in each state. <b>Home</b> ones are listed by who has them.</p>'+
    '<div class="mon-set">'+
      '<div class="mon-set-row"><label>Office</label><input id="ms_office" type="number" min="0" value="'+m.office+'"></div>'+
      '<div class="mon-set-row"><label>Broken</label><input id="ms_broken" type="number" min="0" value="'+m.broken+'"></div>'+
      '<div class="mon-set-row"><label>Spare in stock</label><input id="ms_spare" type="number" min="0" value="'+m.spareQty+'"></div>'+
    '</div>'+
    '<div class="field" style="margin-top:14px"><label>At home — one line per person</label>'+
      '<div id="ms_home">'+(homeNames.length?homeNames.map(homeNameRow).join(""):"")+'</div>'+
      '<button class="btn btn-sm" id="ms_homeAdd" type="button" style="margin-top:8px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>Add person</button></div>',
    '<button class="btn" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">Save monitors</button>');
  const homeList=$("#ms_home");
  $("#ms_homeAdd").onclick=()=>homeList.insertAdjacentHTML("beforeend",homeNameRow(""));
  homeList.addEventListener("click",e=>{ const d=e.target.closest(".mh-del"); if(d) d.closest(".mon-home-row").remove(); });
  $("#mCancel").onclick=closeModal;
  $("#mSave").onclick=async()=>{
    const officeT=Math.max(0,parseInt($("#ms_office").value)||0);
    const brokenT=Math.max(0,parseInt($("#ms_broken").value)||0);
    const spareT=Math.max(0,parseInt($("#ms_spare").value)||0);
    const names=$$("#ms_home .mh-name").map(i=>i.value.trim()).filter(Boolean);
    $("#mSave").disabled=true;
    try{
      // Broken: match the count (add new damaged units, or remove extras)
      const broken=monBucketAll("broken");
      if(brokenT>broken.length){ for(let i=0;i<brokenT-broken.length;i++){ const o=newMon("office"); await store.putAsset(o); await saveEntry(o.tag,{status:"damaged"}); } }
      else if(brokenT<broken.length){ for(const a of broken.slice().sort((x,y)=>y.tag.localeCompare(x.tag)).slice(0,broken.length-brokenT)) await store.delAsset(a.tag); }
      // Home: reconcile the named list (add missing, remove those no longer listed)
      const curHome=monBucketAll("home"); const curNames=curHome.map(a=>(a.assignee||"").trim());
      for(const nm of names){ if(!curNames.includes(nm)){ const o=newMon("home"); o.assignee=nm; o.variant="Home monitor"; await store.putAsset(o); } }
      for(const a of curHome){ if(!names.includes((a.assignee||"").trim())) await store.delAsset(a.tag); }
      // Office: match the count (unnamed first when removing)
      const curOffice=monBucketAll("office");
      if(officeT>curOffice.length){ for(let i=0;i<officeT-curOffice.length;i++){ const o=newMon("office"); await store.putAsset(o); } }
      else if(officeT<curOffice.length){
        const gen=curOffice.filter(a=>!(a.serial||"").trim()).sort((a,b)=>b.tag.localeCompare(a.tag));
        const named=curOffice.filter(a=>(a.serial||"").trim()).sort((a,b)=>b.tag.localeCompare(a.tag));
        for(const a of gen.concat(named).slice(0,curOffice.length-officeT)) await store.delAsset(a.tag);
      }
      // Spare stock (Spares "monitor" line)
      const sp=state.spares.find(s=>s.category==="monitor");
      if(!sp){ if(spareT>0) await store.addSpare({item:"Spare monitor",category:"monitor",qty:spareT,min_qty:0,note:""}); }
      else await store.updateSpare(sp.id,{qty:spareT});
      state.assets=await store.allAssets(); state.spares=await store.allSpares(); await loadEntries();
      closeModal(); renderAll(); toast("Monitors updated");
    }catch(e){ toast(e.message,true); $("#mSave").disabled=false; }
  };
}
function renderSpares(){
  renderMonitors();
  const host=$("#spares");
  if(state.loading){ host.innerHTML=Array(4).fill('<div class="skeleton"></div>').join(""); return; }
  const list=state.spares.filter(sparePass).sort(
    state.spareSort==="qty"
      ? (a,b)=>(a.qty-b.qty) || (a.category+a.item).localeCompare(b.category+b.item)   // fewest first
      : (a,b)=>(a.category+a.item).localeCompare(b.category+b.item));
  const totalQty=state.spares.reduce((m,s)=>m+(s.qty||0),0);
  const lowCount=state.spares.filter(isLow).length;
  $("#sparesTotal").textContent=totalQty; $("#sparesLow").textContent=lowCount;
  host.innerHTML = list.length ? list.map(spareHTML).join("")
    : '<div class="empty" style="grid-column:1/-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/></svg><div>No spare items yet. Add one to start tracking stock.</div></div>';
}

/* -------------------------------- invoices --------------------------------- */
const PAY_METHODS=["JUICE","Bank transfer","Cash","Card","Cheque","Other"];
const INV_CATS=["phone","laptop","tablet","monitor","peripheral","accessory","service","other"];
const RECEIPT_IC='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l5 5v15l-3-2-3 2-3-2-3 2V2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>';
function fmtMoney(v,cur){ const n=Number(v||0); return (cur||"Rs")+" "+n.toLocaleString("en-GB",{minimumFractionDigits:0,maximumFractionDigits:2}); }
function invoicePass(v){ if(!state.q) return true; return (v.invoice_no+" "+v.vendor+" "+v.buyer+" "+v.representative+" "+v.item_description+" "+v.category+" "+v.payment_method+" "+v.transaction_ref+" "+v.note).toLowerCase().includes(state.q.toLowerCase()); }
function invDate(v){ if(!v.purchase_date) return "—"; const d=new Date(v.purchase_date); return isNaN(d)?esc(v.purchase_date):d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}); }
function hasReceipt(v){ return !!(v.receipt_path||v.receipt_url); }
function invoiceRowHTML(v){
  const receipt = hasReceipt(v)
    ? '<button class="btn btn-ghost btn-sm inv-receipt" data-act="receipt" title="Open receipt">'+RECEIPT_IC+'<span class="lbl">Receipt</span></button>'
    : '<span class="inv-noreceipt">No receipt</span>';
  return '<div class="inv-row" data-id="'+v.id+'">'+
    '<div class="inv-cell inv-date"><span class="inv-ck">Date</span>'+invDate(v)+'</div>'+
    '<div class="inv-cell inv-vendor"><div class="inv-no mono">'+esc(v.invoice_no||"—")+'</div><div class="inv-vname">'+esc(v.vendor||"—")+'</div><div class="inv-rep">'+esc(v.representative||"")+'</div></div>'+
    '<div class="inv-cell inv-item"><div class="inv-desc">'+esc(v.item_description||"—")+'</div><div class="inv-qty">'+(Number(v.quantity)||1)+' × '+fmtMoney(v.unit_price,v.currency)+' · <span class="cap">'+esc(v.category)+'</span></div></div>'+
    '<div class="inv-cell inv-total"><span class="inv-ck">Total</span><span class="inv-amount">'+fmtMoney(v.total_amount,v.currency)+'</span></div>'+
    '<div class="inv-cell inv-pay"><span class="inv-paym">'+esc(v.payment_method||"—")+'</span>'+(v.transaction_ref?'<span class="inv-ref mono">'+esc(v.transaction_ref)+'</span>':'')+'</div>'+
    '<div class="inv-cell inv-actions">'+receipt+'<button class="btn btn-ghost icon-btn inv-edit" data-act="edit" aria-label="Edit invoice '+esc(v.invoice_no)+'">'+EDIT+'</button></div>'+
  '</div>';
}
function renderInvoices(){
  const host=$("#invoices");
  if(state.loading){ host.innerHTML=Array(4).fill('<div class="skeleton"></div>').join(""); return; }
  const list=state.invoices.filter(invoicePass);
  const total=state.invoices.reduce((m,v)=>m+(Number(v.total_amount)||0),0);
  const withReceipt=state.invoices.filter(hasReceipt).length;
  const cur=(state.invoices[0]&&state.invoices[0].currency)||"Rs";
  $("#invCount").textContent=state.invoices.length;
  $("#invTotal").textContent=fmtMoney(total,cur);
  $("#invReceipts").textContent=withReceipt+" / "+state.invoices.length;
  if(!list.length){ host.innerHTML='<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M14 2v6h6"/></svg><div>'+(state.invoices.length?"No invoices match this search.":"No invoices yet. Add one to start logging purchases.")+'</div></div>'; return; }
  host.innerHTML='<div class="inv-list">'+list.map(invoiceRowHTML).join("")+'</div>';
}
async function openReceipt(v){
  if(v.receipt_path){
    try{ const url=await store.receiptUrl(v.receipt_path); if(url){ window.open(url,"_blank","noopener"); return; } }
    catch(e){ toast("Couldn't open receipt: "+e.message,true); return; }
  }
  if(v.receipt_url){ window.open(v.receipt_url,"_blank","noopener"); return; }
  toast("No receipt on file",true);
}
/* ------- Google Drive receipt upload (keeps receipts in Drive, not Supabase) ---
   Uses Google Identity Services for an OAuth token (drive.file scope — the app
   can only touch files it creates) and uploads straight to a Drive folder.
   Configure CFG.GOOGLE_CLIENT_ID (+ optional CFG.DRIVE_RECEIPTS_FOLDER_ID). */
let _driveTok=null,_driveExp=0,_tokenClient=null,_tokenWaiters=null;
function driveConfigured(){ return !!CFG.GOOGLE_CLIENT_ID; }
function getDriveToken(){
  return new Promise((resolve,reject)=>{
    if(_driveTok && Date.now() < _driveExp-60000) return resolve(_driveTok);
    if(!(window.google && google.accounts && google.accounts.oauth2)) return reject(new Error("Google sign-in didn't load — check your connection"));
    if(!_tokenClient){
      _tokenClient=google.accounts.oauth2.initTokenClient({
        client_id:CFG.GOOGLE_CLIENT_ID,
        scope:"https://www.googleapis.com/auth/drive.file",
        callback:(resp)=>{ const w=_tokenWaiters; _tokenWaiters=null;
          if(resp && resp.error){ w&&w.reject(new Error(resp.error)); return; }
          _driveTok=resp.access_token; _driveExp=Date.now()+((resp.expires_in||3600)*1000); w&&w.resolve(_driveTok); }
      });
    }
    _tokenWaiters={resolve,reject};
    _tokenClient.requestAccessToken({prompt: _driveTok?"":"consent"});
  });
}
async function uploadToDrive(file){
  const token=await getDriveToken();
  const meta={name:file.name}; const folder=CFG.DRIVE_RECEIPTS_FOLDER_ID; if(folder) meta.parents=[folder];
  const boundary="mur"+Date.now().toString(16);
  const head="\r\n--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"+JSON.stringify(meta)+
             "\r\n--"+boundary+"\r\nContent-Type: "+(file.type||"application/pdf")+"\r\n\r\n";
  const tail="\r\n--"+boundary+"--";
  const body=new Blob([head,file,tail]);
  const res=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,name",
    {method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"multipart/related; boundary="+boundary},body});
  if(!res.ok) throw new Error("Drive upload failed ("+res.status+"): "+(await res.text()).slice(0,160));
  return await res.json();   // { id, webViewLink, name }
}

function openInvoiceModal(v){
  if(!store.live){ toast("Sign in to record purchases",true); openAuthModal(); return; }
  const isNew=!v;
  v=v||{invoice_no:"",purchase_date:new Date().toISOString().slice(0,10),vendor:"",buyer:CFG.BUYER_DEFAULT||"",representative:state.auditor||"",item_description:"",category:"phone",quantity:1,unit_price:0,total_amount:0,currency:"Rs",payment_method:"JUICE",transaction_ref:"",receipt_path:"",receipt_url:"",note:""};
  const catOpts=INV_CATS.map(c=>'<option value="'+c+'"'+(v.category===c?" selected":"")+'>'+c.charAt(0).toUpperCase()+c.slice(1)+'</option>').join("");
  const payOpts=PAY_METHODS.map(p=>'<option value="'+p+'"'+(v.payment_method===p?" selected":"")+'>'+p+'</option>').join("");
  const receiptState = v.receipt_path?('Stored file attached'):(v.receipt_url?'Receipt attached (Google Drive / link)':'No receipt attached');
  const uploadBtnHTML = driveConfigured()
    ? '<button type="button" class="btn btn-sm" id="i_drive">'+RECEIPT_IC+'Upload to Google Drive</button>'
    : '<button type="button" class="btn btn-sm" id="i_upload">'+RECEIPT_IC+'Upload file</button>';
  openModal(isNew?"Record purchase":"Edit invoice "+esc(v.invoice_no),
    '<div class="field-row"><div class="field"><label>Invoice no.</label><input id="i_no" value="'+esc(v.invoice_no)+'" placeholder="INV00001"></div><div class="field"><label>Purchase date</label><input id="i_date" type="date" value="'+esc(v.purchase_date||"")+'"></div></div>'+
    '<div class="field-row"><div class="field"><label>Vendor / seller</label><input id="i_vendor" value="'+esc(v.vendor)+'" placeholder="e.g. Icell Mauritius"></div><div class="field"><label>Buyer</label><input id="i_buyer" value="'+esc(v.buyer)+'"></div></div>'+
    '<div class="field"><label>Company representative</label><input id="i_rep" value="'+esc(v.representative)+'" placeholder="Who made the purchase"></div>'+
    '<div class="field"><label>Item description</label><input id="i_item" value="'+esc(v.item_description)+'" placeholder="e.g. iPhone 15 128GB"></div>'+
    '<div class="field-row"><div class="field"><label>Category</label><select id="i_cat">'+catOpts+'</select></div><div class="field"><label>Currency</label><input id="i_cur" value="'+esc(v.currency||"Rs")+'"></div></div>'+
    '<div class="field-row"><div class="field"><label>Quantity</label><input id="i_qty" type="number" min="0" step="1" value="'+(v.quantity)+'"></div><div class="field"><label>Unit price</label><input id="i_unit" type="number" min="0" step="0.01" value="'+(v.unit_price)+'"></div></div>'+
    '<div class="field-row"><div class="field"><label>Total amount</label><input id="i_total" type="number" min="0" step="0.01" value="'+(v.total_amount)+'"></div><div class="field"><label>Payment method</label><select id="i_pay">'+payOpts+'</select></div></div>'+
    '<div class="field"><label>Transaction reference</label><input id="i_ref" value="'+esc(v.transaction_ref)+'" placeholder="e.g. FT26XXXX / cheque no."></div>'+
    '<div class="field"><label>Receipt</label><div class="receipt-box"><div class="receipt-state" id="i_rstate">'+receiptState+'</div><div class="receipt-btns">'+uploadBtnHTML+(hasReceipt(v)?'<button type="button" class="btn btn-sm" id="i_view">Open</button>':'')+'</div></div><input id="i_link" value="'+esc(v.receipt_url)+'" placeholder="…or paste a Google Drive / external link" style="margin-top:8px"></div>'+
    '<div class="field"><label>Note (optional)</label><input id="i_note" value="'+esc(v.note)+'"></div>',
    (isNew?"":'<button class="btn" id="mDelete" style="margin-right:auto;color:var(--flag);border-color:var(--flag-line)">Remove</button>')+'<button class="btn" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">'+(isNew?"Save invoice":"Save")+'</button>');
  $("#i_no").focus();
  // auto-total from qty × unit unless the user overrides
  const recalc=()=>{ const q=parseFloat($("#i_qty").value)||0, u=parseFloat($("#i_unit").value)||0; if(q&&u) $("#i_total").value=(q*u).toFixed(2).replace(/\.00$/,""); };
  $("#i_qty").addEventListener("input",recalc); $("#i_unit").addEventListener("input",recalc);
  // pending upload holder
  let pendingReceipt=v.receipt_path||"";
  const fileInput=$("#fileReceipt");
  // Google Drive upload (preferred — keeps receipts with the rest of the invoices in Drive)
  if($("#i_drive")) $("#i_drive").onclick=()=>{ fileInput.value=""; fileInput.onchange=async()=>{ const f=fileInput.files[0]; if(!f)return; if(f.size>50*1024*1024){ toast("Receipt too large (max 50MB)",true); return; }
    $("#i_drive").disabled=true; $("#i_rstate").textContent="Uploading "+f.name+" to Google Drive…";
    try{ const r=await uploadToDrive(f); $("#i_link").value=r.webViewLink||""; pendingReceipt=""; $("#i_rstate").textContent="Uploaded to Drive: "+(r.name||f.name); toast("Receipt saved to Drive"); }
    catch(e){ $("#i_rstate").textContent="Drive upload failed"; toast(e.message,true); } finally{ $("#i_drive").disabled=false; } };
    fileInput.click(); };
  // Supabase Storage upload (fallback when Drive isn't configured)
  if($("#i_upload")) $("#i_upload").onclick=()=>{ fileInput.value=""; fileInput.onchange=async()=>{ const f=fileInput.files[0]; if(!f)return; if(f.size>15*1024*1024){ toast("Receipt too large (max 15MB)",true); return; }
    $("#i_upload").disabled=true; $("#i_rstate").textContent="Uploading "+f.name+"…";
    try{ pendingReceipt=await store.uploadReceipt(f); $("#i_rstate").textContent="Stored: "+f.name; toast("Receipt uploaded"); }
    catch(e){ $("#i_rstate").textContent="Upload failed"; toast(e.message,true); } finally{ $("#i_upload").disabled=false; } };
    fileInput.click(); };
  if($("#i_view")) $("#i_view").onclick=()=>openReceipt(v);
  $("#mCancel").onclick=closeModal;
  if(!isNew) $("#mDelete").onclick=async()=>{ if(confirm("Remove invoice "+(v.invoice_no||"")+"?")){ try{ await store.delInvoice(v.id); state.invoices=state.invoices.filter(x=>x.id!==v.id); closeModal(); renderAll(); toast("Invoice removed"); }catch(e){ toast(e.message,true); } } };
  $("#mSave").onclick=async()=>{
    const obj={ invoice_no:$("#i_no").value.trim(), purchase_date:$("#i_date").value||null, vendor:$("#i_vendor").value.trim(), buyer:$("#i_buyer").value.trim(), representative:$("#i_rep").value.trim(), item_description:$("#i_item").value.trim(), category:$("#i_cat").value, currency:$("#i_cur").value.trim()||"Rs", quantity:parseFloat($("#i_qty").value)||0, unit_price:parseFloat($("#i_unit").value)||0, total_amount:parseFloat($("#i_total").value)||0, payment_method:$("#i_pay").value, transaction_ref:$("#i_ref").value.trim(), receipt_path:pendingReceipt, receipt_url:$("#i_link").value.trim(), note:$("#i_note").value.trim(), uploaded_by:(state.user&&state.user.email)||"" };
    if(!obj.item_description && !obj.vendor){ toast("Add at least a vendor or an item",true); return; }
    try{
      if(isNew){ await store.addInvoice(obj); } else { await store.updateInvoice(v.id,obj); }
      state.invoices=await store.allInvoices(); closeModal(); renderAll(); toast(isNew?"Invoice saved":"Invoice updated");
    }catch(e){ toast(e.message,true); }
  };
}
function onInvoicesClick(ev){
  const btn=ev.target.closest("button[data-act]"); if(!btn)return;
  const id=Number(btn.closest(".inv-row").dataset.id); const v=state.invoices.find(x=>x.id===id); if(!v)return;
  if(btn.dataset.act==="receipt"){ openReceipt(v); return; }
  if(btn.dataset.act==="edit"){ openInvoiceModal(v); }
}

/* ------------------------------- procurement ------------------------------- */
const PROC_STATUS={planned:{l:"Planned",c:"pl"},ordered:{l:"Ordered",c:"or"},received:{l:"Received",c:"rc"}};
function procTotal(p){ return (Number(p.qty)||0)*(Number(p.unit_cost)||0); }
function procDate(d){ if(!d) return ""; const x=new Date(d); return isNaN(x)?esc(d):x.toLocaleDateString("en-GB",{day:"2-digit",month:"short"}); }
function procPass(p){ if(!state.q) return true; return (p.item+" "+p.for_who+" "+p.category+" "+p.status+" "+p.note).toLowerCase().includes(state.q.toLowerCase()); }
function procRowHTML(p){
  const recd=p.status==="received";
  return '<div class="proc-row'+(recd?" is-recd":"")+'" data-id="'+p.id+'">'+
    '<button class="proc-check'+(recd?" on":"")+'" data-act="recv" aria-pressed="'+recd+'" title="'+(recd?"Mark not received":"Mark received")+'">'+CHECK+'</button>'+
    '<div class="proc-main"><div class="proc-item">'+esc(p.item||"—")+'</div><div class="proc-sub">'+(p.for_who?esc(p.for_who)+' · ':'')+'<span class="cap">'+esc(p.category)+'</span>'+(p.needed_by&&!recd?' · <span class="proc-need">need by '+procDate(p.needed_by)+'</span>':'')+'</div></div>'+
    '<div class="proc-qty">'+(Number(p.qty)||1)+' × '+fmtMoney(p.unit_cost,p.currency)+'</div>'+
    '<div class="proc-total">'+fmtMoney(procTotal(p),p.currency)+'</div>'+
    '<div class="proc-status st-'+p.status+'">'+(PROC_STATUS[p.status]||PROC_STATUS.planned).l+'</div>'+
    '<button class="btn btn-ghost icon-btn proc-edit" data-act="edit" aria-label="Edit">'+EDIT+'</button>'+
  '</div>';
}
function renderProcurement(){
  const host=$("#procurement");
  if(state.loading){ host.innerHTML=Array(3).fill('<div class="skeleton"></div>').join(""); return; }
  const list=state.procurement.filter(procPass).slice().sort((a,b)=>{
    const ra=a.status==="received"?1:0, rb=b.status==="received"?1:0; if(ra!==rb) return ra-rb;
    const na=a.needed_by||"9999", nb=b.needed_by||"9999"; if(na!==nb) return na<nb?-1:1;
    return (a.item||"").localeCompare(b.item||"");
  });
  const open=state.procurement.filter(p=>p.status!=="received");
  const outstanding=open.reduce((m,p)=>m+procTotal(p),0);
  const cur=(state.procurement[0]&&state.procurement[0].currency)||"Rs";
  $("#procOpen").textContent=open.length;
  $("#procSpend").textContent=fmtMoney(outstanding,cur);
  $("#procDone").textContent=state.procurement.filter(p=>p.status==="received").length+" / "+state.procurement.length;
  host.innerHTML = list.length ? '<div class="inv-list">'+list.map(procRowHTML).join("")+'</div>'
    : '<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.4 12.2a1.5 1.5 0 0 0 1.5 1.2h8.2a1.5 1.5 0 0 0 1.5-1.2L23 7H6"/></svg><div>'+(state.procurement.length?"No items match this search.":"Nothing planned yet. Add an item or drop in a new-hire kit.")+'</div></div>';
}
function openPurchaseModal(p){
  if(!store.live){ toast("Sign in to plan purchases",true); openAuthModal(); return; }
  const isNew=!p;
  p=p||{item:"",category:"laptop",for_who:"",qty:1,unit_cost:0,currency:"Rs",needed_by:"",status:"planned",note:""};
  const catOpts=INV_CATS.map(c=>'<option value="'+c+'"'+(p.category===c?" selected":"")+'>'+c.charAt(0).toUpperCase()+c.slice(1)+'</option>').join("");
  const stOpts=Object.keys(PROC_STATUS).map(s=>'<option value="'+s+'"'+(p.status===s?" selected":"")+'>'+PROC_STATUS[s].l+'</option>').join("");
  openModal(isNew?"Plan a purchase":"Edit planned purchase",
    '<div class="field"><label>Item</label><input id="p_item" value="'+esc(p.item)+'" placeholder="e.g. Laptop (MacBook Air)"></div>'+
    '<div class="field"><label>For whom / reason</label><input id="p_for" value="'+esc(p.for_who)+'" placeholder="e.g. New hire — CRM"></div>'+
    '<div class="field-row"><div class="field"><label>Category</label><select id="p_cat">'+catOpts+'</select></div><div class="field"><label>Needed by</label><input id="p_need" type="date" value="'+esc(p.needed_by||"")+'"></div></div>'+
    '<div class="field-row"><div class="field"><label>Quantity</label><input id="p_qty" type="number" min="0" step="1" value="'+p.qty+'"></div><div class="field"><label>Est. unit cost</label><input id="p_cost" type="number" min="0" step="0.01" value="'+p.unit_cost+'"></div></div>'+
    '<div class="field-row"><div class="field"><label>Currency</label><input id="p_cur" value="'+esc(p.currency||"Rs")+'"></div><div class="field"><label>Status</label><select id="p_status">'+stOpts+'</select></div></div>'+
    '<div class="field"><label>Note (optional)</label><input id="p_note" value="'+esc(p.note)+'"></div>',
    (isNew?"":'<button class="btn" id="mDelete" style="margin-right:auto;color:var(--flag);border-color:var(--flag-line)">Remove</button>')+'<button class="btn" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">'+(isNew?"Add to plan":"Save")+'</button>');
  $("#p_item").focus(); $("#mCancel").onclick=closeModal;
  if(!isNew) $("#mDelete").onclick=async()=>{ if(confirm("Remove this planned purchase?")){ try{ await store.delPurchase(p.id); state.procurement=state.procurement.filter(x=>x.id!==p.id); closeModal(); renderAll(); toast("Removed"); }catch(e){ toast(e.message,true); } } };
  $("#mSave").onclick=async()=>{
    const obj={ item:$("#p_item").value.trim(), for_who:$("#p_for").value.trim(), category:$("#p_cat").value, needed_by:$("#p_need").value||null, qty:parseFloat($("#p_qty").value)||0, unit_cost:parseFloat($("#p_cost").value)||0, currency:$("#p_cur").value.trim()||"Rs", status:$("#p_status").value, note:$("#p_note").value.trim() };
    if(!obj.item){ toast("Item is required",true); return; }
    try{
      if(isNew){ await store.addPurchase(obj); } else { await store.updatePurchase(p.id,obj); }
      state.procurement=await store.allProcurement(); closeModal(); renderAll(); toast(isNew?"Added to plan":"Saved");
    }catch(e){ toast(e.message,true); }
  };
}
async function onProcurementClick(ev){
  const btn=ev.target.closest("button[data-act]"); if(!btn)return;
  const id=Number(btn.closest(".proc-row").dataset.id); const p=state.procurement.find(x=>x.id===id); if(!p)return;
  if(btn.dataset.act==="edit"){ openPurchaseModal(p); return; }
  if(btn.dataset.act==="recv"){
    if(!store.live){ toast("Sign in to update the plan",true); openAuthModal(); return; }
    const ns=p.status==="received"?"planned":"received"; p.status=ns; renderProcurement(); renderStats();
    try{ await store.updatePurchase(id,{status:ns}); setSaved(ns==="received"?"Marked received":"Reopened"); }catch(e){ toast(e.message,true); }
  }
}
const DEFAULT_KIT=[
  {item:'Laptop (MacBook Air 13" M4)',category:'laptop',qty:1,unit_cost:45000},
  {item:'Work phone (iPhone)',category:'phone',qty:1,unit_cost:22500},
  {item:'Monitor',category:'monitor',qty:1,unit_cost:8000},
  {item:'USB-C charger',category:'accessory',qty:1,unit_cost:1500},
  {item:'USB-C hub',category:'accessory',qty:1,unit_cost:2000},
  {item:'Headset',category:'accessory',qty:1,unit_cost:2500},
  {item:'Mouse',category:'accessory',qty:1,unit_cost:800}
];
function currentKit(){ return (state.kit&&state.kit.length)?state.kit:DEFAULT_KIT; }
function kitRowHTML(k){ k=k||{item:"",category:"other",qty:1,unit_cost:0};
  return '<div class="kit-row">'+
    '<input class="k-item" value="'+esc(k.item)+'" placeholder="Item">'+
    '<input class="k-qty" type="number" min="0" step="1" value="'+(k.qty!=null?k.qty:1)+'" title="Qty">'+
    '<input class="k-cost" type="number" min="0" step="0.01" value="'+(k.unit_cost!=null?k.unit_cost:0)+'" title="Est. unit cost">'+
    '<button class="btn btn-ghost icon-btn k-del" type="button" title="Remove">'+XMARK+'</button>'+
  '</div>';
}
function addNewHireKit(){
  if(!store.live){ toast("Sign in to plan purchases",true); openAuthModal(); return; }
  openModal("New-hire kit",
    '<p class="hint">Edit the standard onboarding bundle below, then add it for a new hire. Use <b>Save as default kit</b> to keep your changes for next time.</p>'+
    '<div class="field"><label>New hire name / reference</label><input id="k_name" placeholder="e.g. New hire — CRM"></div>'+
    '<div class="kit-head"><span>Item</span><span>Qty</span><span>Est. cost</span><span></span></div>'+
    '<div id="kitList">'+currentKit().map(kitRowHTML).join("")+'</div>'+
    '<button class="btn btn-sm" id="kitAdd" type="button" style="margin-top:8px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>Add line</button>',
    '<button class="btn" id="kitSaveDefault" style="margin-right:auto">Save as default kit</button><button class="btn" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">Add to plan</button>');
  const list=$("#kitList");
  $("#kitAdd").onclick=()=>list.insertAdjacentHTML("beforeend",kitRowHTML(null));
  list.addEventListener("click",e=>{ const d=e.target.closest(".k-del"); if(d) d.closest(".kit-row").remove(); });
  $("#mCancel").onclick=closeModal; $("#k_name").focus();
  const readKit=()=>$$("#kitList .kit-row").map(r=>({item:r.querySelector(".k-item").value.trim(), category:"other", qty:parseFloat(r.querySelector(".k-qty").value)||0, unit_cost:parseFloat(r.querySelector(".k-cost").value)||0})).filter(k=>k.item);
  $("#kitSaveDefault").onclick=async()=>{
    const kit=readKit(); if(!kit.length){ toast("Add at least one item",true); return; }
    try{ await store.setSetting("newhire_kit",{items:kit}); state.kit=kit; toast("Default kit saved"); }catch(e){ toast(e.message,true); }
  };
  $("#mSave").onclick=async()=>{
    const kit=readKit(); if(!kit.length){ toast("Add at least one item",true); return; }
    const who=$("#k_name").value.trim()||"New hire"; $("#mSave").disabled=true;
    try{ for(const k of kit){ await store.addPurchase({item:k.item,category:k.category||"other",qty:k.qty,unit_cost:k.unit_cost,for_who:who,currency:"Rs",needed_by:null,status:"planned",note:""}); }
      state.procurement=await store.allProcurement(); closeModal(); renderAll(); toast(kit.length+" items added for "+who); }
    catch(e){ toast(e.message,true); $("#mSave").disabled=false; }
  };
}

/* --------------------------------- views ----------------------------------- */
/* ------------------------------- onboarding -------------------------------- */
const OB_DOC_IC='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
const OB_TRASH_IC='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';
function onboardProgress(o){ const t=o.tasks||[]; const done=t.filter(x=>x.done).length; return {done,total:t.length,pct:t.length?Math.round(done/t.length*100):0}; }
function onboardPass(o){ if(!state.q) return true; return ((o.name||"")+" "+(o.role||"")).toLowerCase().includes(state.q.toLowerCase()); }
function onboardCardHTML(o){
  const p=onboardProgress(o);
  const tasks=(o.tasks||[]).map((t,i)=>'<li class="ob-task"><label><input type="checkbox" data-task="'+i+'"'+(t.done?" checked":"")+'><span'+(t.done?' class="ob-done"':'')+'>'+esc(t.t)+'</span></label></li>').join("");
  const docs=(o.docs||[]).map((d,i)=>'<a class="ob-doc" href="'+esc(d.url)+'" target="_blank" rel="noopener">'+OB_DOC_IC+'<span>'+esc(d.label||d.url)+'</span><button class="ob-doc-x" data-deldoc="'+i+'" title="Remove" aria-label="Remove link">×</button></a>').join("");
  return '<div class="ob-card" data-id="'+esc(o.id)+'">'+
    '<div class="ob-top"><div><div class="ob-name">'+esc(o.name||"New hire")+'</div><div class="ob-role">'+esc([o.role,o.start?("started "+o.start):""].filter(Boolean).join("  ·  "))+'</div></div>'+
      '<div class="ob-topr"><span class="ob-prog">'+p.done+'/'+p.total+'</span><button class="btn btn-ghost icon-btn ob-del" data-obdel="1" title="Remove hire" aria-label="Remove hire">'+OB_TRASH_IC+'</button></div></div>'+
    '<div class="ob-bar"><i style="width:'+p.pct+'%"></i></div>'+
    '<ul class="ob-tasks">'+tasks+'</ul>'+
    '<div class="ob-docs">'+docs+'<button class="btn btn-sm ob-adddoc" data-adddoc="1">+ Document</button></div>'+
  '</div>';
}
function renderOnboarding(){
  const host=$("#onboarding"); if(!host) return;
  if(state.loading){ host.innerHTML=Array(2).fill('<div class="skeleton"></div>').join(""); return; }
  const all=state.onboarding||[]; const list=all.filter(onboardPass);
  const done=all.filter(o=>{const p=onboardProgress(o);return p.total&&p.done===p.total;}).length;
  if($("#obOpen")) $("#obOpen").textContent=all.length-done;
  if($("#obDone")) $("#obDone").textContent=done;
  host.innerHTML = list.length ? '<div class="ob-list">'+list.map(onboardCardHTML).join("")+'</div>'
    : '<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg><div>'+(all.length?"No hires match this search.":"No onboarding in progress. Add a new hire to start a checklist.")+'</div></div>';
}
async function saveOnboarding(){ try{ await store.setSetting("onboarding_runs",state.onboarding); }catch(e){ toast("Save failed: "+e.message,true); } }
function openOnboardModal(){
  if(!store.live){ toast("Sign in to manage onboarding",true); openAuthModal(); return; }
  openModal("Add a new hire",
    '<div class="field"><label>Name</label><input id="ob_name" placeholder="e.g. Nathalia Robert"></div>'+
    '<div class="field-row"><div class="field"><label>Role / department</label><input id="ob_role" placeholder="e.g. CRM"></div><div class="field"><label>Start date</label><input id="ob_start" type="date" value="'+new Date().toISOString().slice(0,10)+'"></div></div>'+
    '<p class="hint">Creates a checklist from the IT first-day template (from the CorpIT runbook), with the reference docs attached.</p>',
    '<button class="btn" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">Create checklist</button>',true);
  $("#ob_name").focus();
  $("#mSave").onclick=async()=>{ const name=$("#ob_name").value.trim(); if(!name){ toast("Enter a name",true); return; }
    const tmpl=(state.settings&&Array.isArray(state.settings.onboarding_template)&&state.settings.onboarding_template.length)?state.settings.onboarding_template:DEFAULT_ONBOARD;
    const run={id:"ob"+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36), name:name, role:$("#ob_role").value.trim(), start:$("#ob_start").value, tasks:tmpl.map(t=>({t:t,done:false})), docs:DEFAULT_ONBOARD_DOCS.map(d=>Object.assign({},d)), note:""};
    state.onboarding.unshift(run); await saveOnboarding(); closeModal(); renderOnboarding(); renderStats(); toast("Checklist created for "+name); };
  $("#mCancel").onclick=closeModal;
}
function addOnboardDoc(o){
  openModal("Add a document link",
    '<div class="field"><label>Label</label><input id="od_label" placeholder="e.g. Offer letter, LastPass guide"></div><div class="field"><label>URL</label><input id="od_url" placeholder="https://  (Confluence, Drive, …)"></div>',
    '<button class="btn" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">Add link</button>',true);
  $("#od_url").focus();
  $("#mSave").onclick=()=>{ const url=($("#od_url").value||"").trim(); if(!/^https?:\/\//i.test(url)){ toast("Enter a full URL (https://…)",true); return; } o.docs=o.docs||[]; o.docs.push({label:($("#od_label").value||"").trim()||url,url:url}); saveOnboarding(); closeModal(); renderOnboarding(); };
  $("#mCancel").onclick=closeModal;
}
function onOnboardingClick(ev){
  const card=ev.target.closest(".ob-card"); if(!card) return; const o=(state.onboarding||[]).filter(x=>x.id===card.dataset.id)[0]; if(!o) return;
  if(ev.target.closest("[data-obdel]")){ if(!confirm("Remove "+(o.name||"this hire")+" and their checklist?"))return; state.onboarding=state.onboarding.filter(x=>x.id!==o.id); saveOnboarding(); renderOnboarding(); renderStats(); return; }
  const dd=ev.target.closest("[data-deldoc]"); if(dd){ ev.preventDefault(); (o.docs||[]).splice(Number(dd.dataset.deldoc),1); saveOnboarding(); renderOnboarding(); return; }
  if(ev.target.closest("[data-adddoc]")){ addOnboardDoc(o); return; }
}
function onOnboardingChange(ev){
  const cb=ev.target.closest('input[data-task]'); if(!cb) return; const card=cb.closest(".ob-card"); if(!card) return;
  const o=(state.onboarding||[]).filter(x=>x.id===card.dataset.id)[0]; if(!o||!o.tasks[Number(cb.dataset.task)]) return;
  o.tasks[Number(cb.dataset.task)].done=cb.checked; saveOnboarding(); renderOnboarding(); renderStats();
}
/* ---------------------------- staff directory ----------------------------- */
function staffPeople(){
  const map={};
  activeAssets().filter(a=>a.type!=="infra").forEach(a=>{ const who=(a.assignee||"").trim(); if(!who) return; (map[who]=map[who]||[]).push(a); });
  return Object.keys(map).sort((a,b)=>a.localeCompare(b)).map(name=>({name:name,assets:map[name]}));
}
function staffPass(p){ if(!state.q) return true; return (p.name+" "+p.assets.map(a=>a.tag+" "+a.model).join(" ")).toLowerCase().includes(state.q.toLowerCase()); }
function staffCardHTML(p){
  const onb=(state.onboarding||[]).filter(o=>(o.name||"").toLowerCase()===p.name.toLowerCase())[0];
  let ob=""; if(onb){ const pr=onboardProgress(onb); ob=' · <span class="staff-onb">'+(pr.total&&pr.done===pr.total?"onboarded":("onboarding "+pr.done+"/"+pr.total))+'</span>'; }
  const items=p.assets.map(a=>'<button class="staff-item" data-tag="'+esc(a.tag)+'" title="Open '+esc(a.tag)+'">'+deviceIcon(a)+'<span class="si-model">'+esc(a.model)+'</span><span class="si-tag">'+esc(a.tag)+'</span>'+(a.reassignedFrom?'<span class="si-re" title="Reassigned from '+esc(a.reassignedFrom)+'">↺</span>':'')+'</button>').join("");
  return '<div class="staff-card"><div class="staff-chead"><div class="staff-name">'+esc(p.name)+'</div><div class="staff-meta">'+p.assets.length+' item'+(p.assets.length!==1?"s":"")+ob+'</div></div><div class="staff-items">'+items+'</div></div>';
}
function renderStaff(){
  const host=$("#staff"); if(!host) return;
  if(state.loading){ host.innerHTML=Array(3).fill('<div class="skeleton"></div>').join(""); return; }
  const all=staffPeople(); const people=all.filter(staffPass);
  if($("#stPeople")) $("#stPeople").textContent=all.length;
  if($("#stAssigned")) $("#stAssigned").textContent=activeAssets().filter(a=>a.type!=="infra"&&(a.assignee||"").trim()).length;
  host.innerHTML=people.length?'<div class="staff-list">'+people.map(staffCardHTML).join("")+'</div>'
    :'<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><div>'+(all.length?"No people match this search.":"No assigned equipment yet.")+'</div></div>';
}
function onStaffClick(ev){ const b=ev.target.closest(".staff-item"); if(!b) return; const a=state.assets.find(x=>x.tag===b.dataset.tag); if(a) openAssetModal(a); }

/* ------------------------------- documents -------------------------------- */
function docPass(d){ if(!state.q) return true; return ((d.label||"")+" "+(d.category||"")+" "+(d.url||"")).toLowerCase().includes(state.q.toLowerCase()); }
function docHost(u){ try{ return new URL(u).hostname.replace(/^www\./,""); }catch(e){ return ""; } }
function docCardHTML(d,i){
  return '<div class="doc-card"><a class="doc-open" href="'+esc(d.url)+'" target="_blank" rel="noopener">'+
    '<span class="doc-ic">'+OB_DOC_IC+'</span><span class="doc-main"><span class="doc-label">'+esc(d.label||d.url)+'</span><span class="doc-sub">'+esc(d.category||docHost(d.url)||"link")+'</span></span></a>'+
    '<button class="doc-x" data-deldoc="'+i+'" title="Remove" aria-label="Remove">×</button></div>';
}
function renderDocuments(){
  const host=$("#documents"); if(!host) return;
  if(state.loading){ host.innerHTML=Array(3).fill('<div class="skeleton"></div>').join(""); return; }
  const list=(state.documents||[]).map((d,i)=>({d:d,i:i})).filter(x=>docPass(x.d));
  host.innerHTML=list.length?'<div class="doc-list">'+list.map(x=>docCardHTML(x.d,x.i)).join("")+'</div>'
    :'<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><div>'+((state.documents||[]).length?"No documents match this search.":"No documents yet. Add a link to Confluence, Drive, anything.")+'</div></div>';
}
async function saveDocuments(){ try{ await store.setSetting("documents",state.documents); }catch(e){ toast("Save failed: "+e.message,true); } }
function openDocModal(){
  if(!store.live){ toast("Sign in to add documents",true); openAuthModal(); return; }
  openModal("Add a document link",
    '<div class="field"><label>Label</label><input id="dc_label" placeholder="e.g. IT Onboarding runbook"></div>'+
    '<div class="field-row"><div class="field"><label>Category</label><input id="dc_cat" placeholder="e.g. HR, IT, Policy"></div><div class="field"><label>URL</label><input id="dc_url" placeholder="https://"></div></div>',
    '<button class="btn" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">Add</button>',true);
  $("#dc_label").focus();
  $("#mSave").onclick=async()=>{ const url=($("#dc_url").value||"").trim(); if(!/^https?:\/\//i.test(url)){ toast("Enter a full URL (https://…)",true); return; } state.documents.unshift({label:($("#dc_label").value||"").trim()||url,category:($("#dc_cat").value||"").trim(),url:url}); await saveDocuments(); closeModal(); renderDocuments(); toast("Document added"); };
  $("#mCancel").onclick=closeModal;
}
function onDocumentsClick(ev){ const del=ev.target.closest("[data-deldoc]"); if(!del) return; ev.preventDefault(); const i=Number(del.dataset.deldoc); if(!confirm("Remove this link?"))return; state.documents.splice(i,1); saveDocuments(); renderDocuments(); }

/* ------------------------------ announcements ------------------------------ */
function annPass(a){ if(!state.q) return true; return ((a.title||"")+" "+(a.body||"")+" "+(a.author||"")).toLowerCase().includes(state.q.toLowerCase()); }
function annCardHTML(a,i){
  return '<div class="ann-card"><div class="ann-top"><div class="ann-title">'+esc(a.title||"(untitled)")+'</div><button class="ann-x" data-delann="'+i+'" title="Remove" aria-label="Remove">×</button></div>'+
    (a.body?'<div class="ann-body">'+esc(a.body)+'</div>':'')+
    '<div class="ann-meta">'+esc(a.author||"")+(a.at?' · '+new Date(a.at).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"")+(a.slack?' · <span class="ann-slack">MUR Log</span>':'')+'</div></div>';
}
function renderAnnouncements(){
  const host=$("#announcements"); if(!host) return;
  if(state.loading){ host.innerHTML=Array(2).fill('<div class="skeleton"></div>').join(""); return; }
  const list=(state.announcements||[]).map((a,i)=>({a:a,i:i})).filter(x=>annPass(x.a));
  host.innerHTML=list.length?'<div class="ann-list">'+list.map(x=>annCardHTML(x.a,x.i)).join("")+'</div>'
    :'<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg><div>'+((state.announcements||[]).length?"No announcements match this search.":"No announcements yet.")+'</div></div>';
}
async function saveAnnouncements(){ try{ await store.setSetting("announcements",state.announcements); }catch(e){ toast("Save failed: "+e.message,true); } }
function openAnnModal(){
  if(!store.live){ toast("Sign in to post",true); openAuthModal(); return; }
  openModal("New announcement",
    '<div class="field"><label>Title</label><input id="an_title" placeholder="e.g. Office closed Friday"></div>'+
    '<div class="field"><label>Message</label><textarea id="an_body" placeholder="Write your notice…"></textarea></div>'+
    '<label class="adm-check"><input type="checkbox" id="an_slack" checked> Also post to MUR Log on Slack</label>',
    '<button class="btn" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">Post</button>',true);
  $("#an_title").focus();
  $("#mSave").onclick=async()=>{ const title=($("#an_title").value||"").trim(), body=($("#an_body").value||"").trim(); if(!title&&!body){ toast("Write something first",true); return; }
    const slack=$("#an_slack").checked; const rec={id:"an"+Date.now().toString(36),title:title,body:body,author:state.auditor||(state.user&&state.user.email)||"",at:new Date().toISOString(),slack:false};
    const btn=$("#mSave"); btn.disabled=true;
    if(slack && store.live && sb){ try{ const r=await sb.functions.invoke("send-report",{body:{kind:"announcement",slack_only:true,title:title||"Announcement",text:body}}); if(!r.error && r.data && r.data.sent && r.data.sent.slack) rec.slack=true; }catch(e){} }
    state.announcements.unshift(rec); await saveAnnouncements(); btn.disabled=false; closeModal(); renderAnnouncements(); toast(rec.slack?"Posted — and to MUR Log":"Posted"); };
  $("#mCancel").onclick=closeModal;
}
function onAnnouncementsClick(ev){ const del=ev.target.closest("[data-delann]"); if(!del) return; const i=Number(del.dataset.delann); if(!confirm("Remove this announcement?"))return; state.announcements.splice(i,1); saveAnnouncements(); renderAnnouncements(); }

function renderView(){ if(state.view==="spares") renderSpares(); else if(state.view==="invoices") renderInvoices(); else if(state.view==="procurement") renderProcurement(); else if(state.view==="onboarding") renderOnboarding(); else if(state.view==="staff") renderStaff(); else if(state.view==="documents") renderDocuments(); else if(state.view==="announcements") renderAnnouncements(); else renderRegister(); }
function renderAll(){ renderStats(); renderView(); }
/* True while the user is typing in a field (note box, search, a modal input). */
function isEditingField(){ const el=document.activeElement; return !!el && (el.tagName==="TEXTAREA" || el.tagName==="INPUT"); }
/* Realtime broadcasts our own writes back to us. Rebuilding the list on that
   echo while someone is mid-note destroys the textarea they're typing in (cursor
   jump / lag), so refresh only the lightweight stats while a field is focused —
   state is already current, and the next real render picks up the rest. */
function renderLive(){ if(isEditingField()){ renderStats(); return; } renderAll(); }
/* Coalesce a burst of realtime echoes (e.g. a bulk update fires dozens of them)
   into a single render, and never rebuild the list while a field is focused —
   keep re-checking every 500ms and do the full render once editing stops. */
var _liveT=null, _liveDirty=false;
function scheduleLiveRender(){ _liveDirty=true; clearTimeout(_liveT); _liveT=setTimeout(flushLiveRender,150); }
function flushLiveRender(){ if(!_liveDirty) return; if(isEditingField()){ renderStats(); clearTimeout(_liveT); _liveT=setTimeout(flushLiveRender,500); return; } _liveDirty=false; renderAll(); }
const VIEW_META={
  register:{title:"Register",sub:"Assigned equipment",search:"Search tag, person, device…"},
  spares:{title:"Spares & stock",sub:"Unassigned inventory",search:"Search spares…"},
  invoices:{title:"Invoicing",sub:"Purchases & receipts",search:"Search vendor, item, reference…"},
  procurement:{title:"Procurement",sub:"Planned purchases",search:"Search planned items…"},
  onboarding:{title:"Onboarding",sub:"New-hire checklists",search:"Search new hires…"},
  staff:{title:"Staff",sub:"People & their equipment",search:"Search people…"},
  documents:{title:"Documents",sub:"Links & references",search:"Search documents…"},
  announcements:{title:"Announcements",sub:"Team notices",search:"Search announcements…"}
};
function updateRegisterSub(){
  if(state.view!=="register") return;
  const f=state.filter;
  let suffix="";
  if(f==="flag") suffix=" · Needs attention";
  else if(TYPE_ORDER.includes(f)) suffix=" · "+TYPES[f].group;
  $("#viewSub").textContent="Assigned equipment"+suffix;
}
function setView(v){
  state.view=v; const m=VIEW_META[v]||VIEW_META.register;
  $$(".nav-item").forEach(b=>b.setAttribute("aria-current", String(b.dataset.view===v)));
  $("#viewRegister").hidden = v!=="register";
  $("#viewSpares").hidden = v!=="spares";
  $("#viewInvoices").hidden = v!=="invoices";
  $("#viewProcurement").hidden = v!=="procurement";
  [["viewOnboarding","onboarding"],["viewStaff","staff"],["viewDocuments","documents"],["viewAnnouncements","announcements"]].forEach(function(p){ const el=document.getElementById(p[0]); if(el) el.hidden = v!==p[1]; });
  $("#viewTitle").textContent = m.title;
  $("#viewSub").textContent = m.sub;
  $$(".ctx-register").forEach(e=>e.hidden = v!=="register");
  $$(".ctx-spares").forEach(e=>e.hidden = v!=="spares");
  $$(".ctx-invoices").forEach(e=>e.hidden = v!=="invoices");
  $$(".ctx-procurement").forEach(e=>e.hidden = v!=="procurement");
  $$(".ctx-onboarding").forEach(e=>e.hidden = v!=="onboarding");
  $$(".ctx-documents").forEach(e=>e.hidden = v!=="documents");
  $$(".ctx-announcements").forEach(e=>e.hidden = v!=="announcements");
  $("#search").placeholder = m.search;
  document.body.classList.remove("nav-open");
  renderView();
  updateRegisterSub();
}

/* ------------------------------- audit mode -------------------------------- */
/* ------------------------------ admin console ------------------------------ */
/* Config overrides live in app_settings["app_config"] and are merged over the
   committed CFG at load, so admins can change them live without a code deploy. */
function applyConfigOverrides(){
  Object.assign(CFG, state.settings||{});
  state.gerardEmail = CFG.REPORT_TO || state.gerardEmail;
  if(CFG.APP_TITLE){ try{ document.title=CFG.APP_TITLE; }catch(e){} }
  applyModules(); updateAdminUI();
}
function applyModules(){
  const m=Object.assign({spares:true,invoices:true,procurement:true,onboarding:true,staff:true,documents:true,announcements:true}, CFG.MODULES||{});
  [["spares","navSpares"],["invoices","navInvoices"],["procurement","navProcurement"],["onboarding","navOnboarding"],["staff","navStaff"],["documents","navDocuments"],["announcements","navAnnouncements"]].forEach(function(p){ const el=document.getElementById(p[1]); if(el) el.style.display=(m[p[0]]===false)?"none":""; });
  if(m[state.view]===false) setView("register");
}
function updateAdminUI(){ const b=document.getElementById("btnAdmin"); if(b) b.style.display=state.isAdmin?"":"none"; }
function admField(label,id,v,type){ return '<div class="field"><label>'+esc(label)+'</label><input id="'+id+'" type="'+(type||"text")+'" value="'+esc(v==null?"":v)+'"></div>'; }
function openAdminConsole(){
  if(!store.live){ toast("Sign in to manage settings",true); openAuthModal(); return; }
  if(!state.isAdmin){ toast("Admins only",true); return; }
  const g=state.settings||{};
  const val=(k,d)=>{ const v=(g[k]!==undefined?g[k]:CFG[k]); return v==null?(d==null?"":d):v; };
  const mod=Object.assign({spares:true,invoices:true,procurement:true,onboarding:true,staff:true,documents:true,announcements:true}, CFG.MODULES||{}, g.MODULES||{});
  const chk=b=>b?"checked":"";
  const body=''
   +'<div class="adm"><nav class="adm-nav">'
     +'<button class="adm-tab on" data-sec="general">General</button>'
     +'<button class="adm-tab" data-sec="reports">Reports</button>'
     +'<button class="adm-tab" data-sec="stock">Stock alerts</button>'
     +'<button class="adm-tab" data-sec="invoicing">Invoicing &amp; Drive</button>'
     +'<button class="adm-tab" data-sec="modules">Modules</button>'
     +'<button class="adm-tab" data-sec="admins">Admins</button>'
   +'</nav><div class="adm-body">'
   +'<section class="adm-sec on" data-sec="general">'+admField("Organisation / office","c_office",val("OFFICE"))+admField("App title (browser tab)","c_title",val("APP_TITLE","Mauritius Asset Register"))+'</section>'
   +'<section class="adm-sec" data-sec="reports">'+admField("Report recipient email","c_reportto",val("REPORT_TO"))+'<p class="adm-hint">Where the quarterly report is emailed. Slack still posts to MUR Log.</p></section>'
   +'<section class="adm-sec" data-sec="stock"><label class="adm-check"><input type="checkbox" id="c_clientalerts" '+chk(val("CLIENT_STOCK_ALERTS")!==false)+'> Send low-stock alerts from the app</label>'+admField("Alert settle delay (seconds)","c_delay",val("STOCK_ALERT_DELAY_SEC",20),"number")+'<p class="adm-hint">Delay before a stock change triggers an alert, so quick edits don’t over-send.</p></section>'
   +'<section class="adm-sec" data-sec="invoicing">'+admField("Default buyer (new invoices)","c_buyer",val("BUYER_DEFAULT"))+admField("Google Drive receipts folder ID","c_drive",val("DRIVE_RECEIPTS_FOLDER_ID"))+admField("Google OAuth client ID","c_gclient",val("GOOGLE_CLIENT_ID"))+'</section>'
   +'<section class="adm-sec" data-sec="modules"><p class="adm-hint">Turn whole sections of the app on or off for everyone.</p><label class="adm-check"><input type="checkbox" id="m_spares" '+chk(mod.spares!==false)+'> Spares &amp; stock</label><label class="adm-check"><input type="checkbox" id="m_invoices" '+chk(mod.invoices!==false)+'> Invoicing</label><label class="adm-check"><input type="checkbox" id="m_procurement" '+chk(mod.procurement!==false)+'> Procurement</label><label class="adm-check"><input type="checkbox" id="m_onboarding" '+chk(mod.onboarding!==false)+'> Onboarding</label><label class="adm-check"><input type="checkbox" id="m_staff" '+chk(mod.staff!==false)+'> Staff directory</label><label class="adm-check"><input type="checkbox" id="m_documents" '+chk(mod.documents!==false)+'> Documents</label><label class="adm-check"><input type="checkbox" id="m_announcements" '+chk(mod.announcements!==false)+'> Announcements</label></section>'
   +'<section class="adm-sec" data-sec="admins"><p class="adm-hint">Admins can open this console and manage settings.</p><div id="adm-list"></div><div class="adm-addrow"><input id="adm-email" type="email" placeholder="email@bspot.com"><input id="adm-name" type="text" placeholder="Name (optional)"><button class="btn btn-sm btn-primary" id="adm-add">Add admin</button></div></section>'
   +'</div></div>';
  openModal("Admin console",body,'<button class="btn" id="mCancel">Close</button><button class="btn btn-primary" id="mSaveCfg">Save settings</button>');
  $$(".adm-tab").forEach(t=>t.onclick=()=>{ $$(".adm-tab").forEach(x=>x.classList.toggle("on",x===t)); $$(".adm-sec").forEach(x=>x.classList.toggle("on",x.dataset.sec===t.dataset.sec)); });
  renderAdminList();
  $("#adm-add").onclick=addAdminFromForm;
  $("#mCancel").onclick=closeModal;
  $("#mSaveCfg").onclick=saveAdminConfig;
}
function renderAdminList(){
  const el=$("#adm-list"); if(!el) return;
  el.innerHTML=(state.admins||[]).map(a=>'<div class="adm-arow"><span><b>'+esc(a.name||a.email)+'</b>'+(a.name?'<span class="adm-em"> · '+esc(a.email)+'</span>':'')+'</span><button class="btn btn-sm adm-rm" data-em="'+esc(a.email)+'">Remove</button></div>').join("")||'<p class="adm-hint">No admins listed yet.</p>';
  $$(".adm-rm",el).forEach(b=>b.onclick=async()=>{ const em=b.dataset.em; if((state.admins||[]).length<=1){ toast("Keep at least one admin",true); return; } if(!confirm("Remove admin "+em+"?"))return;
    try{ await store.removeAdmin(em); state.admins=await store.getAdmins(); const me=((state.user&&state.user.email)||"").toLowerCase(); state.isAdmin=state.admins.some(a=>((a.email||"").toLowerCase())===me); renderAdminList(); updateAdminUI(); toast("Removed "+em); }catch(e){ toast(e.message,true); } });
}
async function addAdminFromForm(){
  const em=(($("#adm-email").value)||"").trim().toLowerCase(); const nm=(($("#adm-name").value)||"").trim();
  if(!/.+@.+\..+/.test(em)){ toast("Enter a valid email",true); return; }
  try{ await store.addAdmin(em,nm); state.admins=await store.getAdmins(); renderAdminList(); $("#adm-email").value=""; $("#adm-name").value=""; toast("Added "+em); }
  catch(e){ toast("Couldn't add admin: "+e.message,true); }
}
async function saveAdminConfig(){
  const cfg=Object.assign({},state.settings||{});
  cfg.OFFICE=$("#c_office").value.trim();
  cfg.APP_TITLE=$("#c_title").value.trim();
  cfg.REPORT_TO=$("#c_reportto").value.trim();
  cfg.CLIENT_STOCK_ALERTS=$("#c_clientalerts").checked;
  cfg.STOCK_ALERT_DELAY_SEC=Math.max(0,Number($("#c_delay").value)||0);
  cfg.BUYER_DEFAULT=$("#c_buyer").value.trim();
  cfg.DRIVE_RECEIPTS_FOLDER_ID=$("#c_drive").value.trim();
  cfg.GOOGLE_CLIENT_ID=$("#c_gclient").value.trim();
  cfg.MODULES={spares:$("#m_spares").checked,invoices:$("#m_invoices").checked,procurement:$("#m_procurement").checked,onboarding:$("#m_onboarding").checked,staff:$("#m_staff").checked,documents:$("#m_documents").checked,announcements:$("#m_announcements").checked};
  const btn=$("#mSaveCfg"); if(btn) btn.disabled=true;
  try{ await store.setSetting("app_config",cfg); state.settings=cfg; applyConfigOverrides(); renderAll(); closeModal(); toast("Settings saved — applied for everyone"); }
  catch(e){ if(btn) btn.disabled=false; toast("Save failed: "+e.message,true); }
}
async function finishCheck(){
  setAuditMode(false);
  if(!store.live){ toast("Check paused — progress saved (sign in to log to Slack)"); return; }
  const btn=$("#btnAuditDone");
  try{
    const {data,error}=await sb.functions.invoke("send-report",{body:{
      to:[state.gerardEmail], slack_only:true,
      subject:"MUR Equipment Check — "+qPretty(state.quarter),
      text:buildCheckSummary()
    }});
    if(error) throw error;
    if(data&&data.sent&&data.sent.slack) toast("Check finished — summary posted to MUR Log");
    else toast("Check finished — progress saved (Slack not configured server-side)");
  }catch(e){ toast("Check finished — Slack post failed: "+(e.message||e),true); }
}
/* Gentle reminder if the live quarter's check is still unfinished past its
   halfway point. Dismissible per quarter; only shows on the register view. */
function renderNudge(){
  const el=$("#checkNudge"); if(!el) return;
  let show=false, pending=0, pct=100;
  if(store.live && !state.auditMode && state.view==="register" && state.quarter===currentQuarter()
     && localStorage.getItem("mur_nudge_dismissed")!==state.quarter){
    const now=new Date(); const qStart=new Date(now.getFullYear(),Math.floor(now.getMonth()/3)*3,1);
    const daysIn=(now-qStart)/86400000;
    const s=computeStats(); pct=s.total?Math.round(s.checked/s.total*100):100; pending=s.total-s.checked;
    if(daysIn>=45 && pct<100 && pending>0) show=true;
  }
  if(!show){ el.style.display="none"; return; }
  $("#nudgeText").innerHTML="<b>"+qPretty(state.quarter)+" check is "+pct+"% done.</b> "+pending+" item"+(pending>1?"s":"")+" still unchecked — the quarter is more than half over. A good time to wrap it up.";
  el.style.display="flex";
}
async function bulkMarkPresent(){
  if(!state.auditMode){ toast("Start a check first",true); return; }
  const shown=registerAssets().filter(passFilter);
  const targets=shown.filter(a=>entry(a.tag).status==="pending");
  if(!targets.length){ toast("Nothing left to check in the current view"); return; }
  if(!confirm("Mark "+targets.length+" not-yet-checked item"+(targets.length>1?"s":"")+" shown here as PRESENT?\n\nItems already flagged (damaged / missing / needs-replacement) are left untouched. Use the filters/search first to narrow the list.")) return;
  if(!state.auditor){ askAuditor(); }
  const btn=$("#btnMarkPresent"); if(btn) btn.disabled=true;
  const res=await Promise.allSettled(targets.map(a=>saveEntry(a.tag,{status:"present"})));
  if(btn) btn.disabled=false;
  const ok=res.filter(r=>r.status==="fulfilled").length;
  renderRegister(); renderStats();
  toast("Marked "+ok+" of "+targets.length+" as present");
}
function setAuditMode(on){
  state.auditMode=on; document.body.classList.toggle("audit-on",on);
  $("#auditBtnLabel").textContent=on?"Checking "+qPretty(state.quarter)+"…":"Start "+qPretty(state.quarter)+" check";
  $("#btnAudit").classList.toggle("btn-primary",on);
  renderRegister();
  if(on && !state.auditor) askAuditor();
}

/* --------------------------------- events ---------------------------------- */
function onRegisterClick(ev){
  const cb=ev.target.closest(".cond-btn");
  if(cb){ const tag=cb.closest(".row").dataset.tag; const c=cb.dataset.cond; const e=entry(tag); const ns=e.status===c?"pending":c;
    saveEntry(tag,{status:ns}).then(()=>{ refreshRow(tag); renderStats(); }); return; }
  const del=ev.target.closest(".pacc-del");
  if(del){ ev.stopPropagation(); removeAccessory(del.closest(".row").dataset.tag,del.dataset.delAcc); return; }
  const add=ev.target.closest(".pchip-add");
  if(add){ promptAddAccessory(add.closest(".row").dataset.tag); return; }
  const pc=ev.target.closest(".pchip");
  if(pc){ const tag=pc.closest(".row").dataset.tag; const e=entry(tag);
    if(pc.dataset.p){ const np=Object.assign(blankPeriph(),e.periph); np[pc.dataset.p]=!np[pc.dataset.p]; pc.setAttribute("aria-pressed",np[pc.dataset.p]); saveEntry(tag,{periph:np}); return; }
    if(pc.dataset.acc){ const name=pc.dataset.acc; const ex=Object.assign({},e.extra); ex[name]=!ex[name]; pc.setAttribute("aria-pressed",ex[name]); saveEntry(tag,{extra:ex}); return; }
  }
  const ab=ev.target.closest(".aud-btn");
  if(ab && ab.dataset.act==="edit"){ openAssetModal(state.assets.find(a=>a.tag===ab.closest(".row").dataset.tag)); }
}
function onRegisterInput(ev){ const ta=ev.target.closest(".note-ta"); if(!ta)return; const tag=ta.closest(".row").dataset.tag; clearTimeout(ta._t); ta._t=setTimeout(()=>{ saveEntry(tag,{note:ta.value.trim()}); },450); }
/* ----------------------------- low-stock alerts ---------------------------- */
// The signed-in app emails the owners the moment an item crosses its threshold,
// by invoking the `low-stock-alert` Edge Function. Dedup is via each spare's
// `low_alert_sent` flag: it arms once when low and clears when restocked, so an
// item that is already low doesn't re-email on every issue. Set
// CFG.CLIENT_STOCK_ALERTS = false if you drive alerts from the database instead
// (alerts.sql), to avoid duplicate emails.
function stockAlertsEnabled(){ return store.live && !!sb && CFG.CLIENT_STOCK_ALERTS!==false; }
async function invokeStockAlert(payload){
  if(!sb) throw new Error("No backend");
  const {data,error}=await sb.functions.invoke("low-stock-alert",{body:payload});
  if(error) throw error;
  return data;
}
async function reconcileStockAlert(s){
  if(!s || !stockAlertsEnabled()) return;
  const low = isLow(s);
  if(low && !s.low_alert_sent){
    s.low_alert_sent=true;                 // arm immediately so a second call can't re-send
    try{
      await invokeStockAlert({reason:"threshold",item:s.item,category:s.category,qty:s.qty,min_qty:s.min_qty});
      await store.updateSpare(s.id,{low_alert_sent:true});
      toast(s.item+" is low — alert sent");
    }catch(e){ s.low_alert_sent=false; console.warn("Low-stock alert not sent:",e.message); }  // roll back so it can retry
  } else if(!low && s.low_alert_sent){
    s.low_alert_sent=false;
    try{ await store.updateSpare(s.id,{low_alert_sent:false}); }catch(e){ console.warn("Stock flag not cleared:",e.message); }
  }
}
// Debounce the low-stock check: rapidly stepping a quantity (e.g. 3→0) settles
// into ONE evaluation of the final quantity instead of firing on every click.
// Delay is CFG.STOCK_ALERT_DELAY_SEC (default 20s). The quantity itself still
// saves instantly on each click — only the alert waits for the dust to settle.
const _stockReconcileTimers={};
function stockAlertDelayMs(){ const v=CFG.STOCK_ALERT_DELAY_SEC; return (v==null?20:Number(v)||0)*1000; }
function scheduleStockReconcile(id){
  clearTimeout(_stockReconcileTimers[id]);
  _stockReconcileTimers[id]=setTimeout(()=>{ delete _stockReconcileTimers[id]; const s=state.spares.find(x=>x.id===id); if(s) reconcileStockAlert(s); }, stockAlertDelayMs());
}
async function sendStockDigestNow(){
  if(!store.live){ toast("Sign in to send stock alerts",true); openAuthModal(); return; }
  const low=state.spares.filter(isLow);
  if(!low.length){ toast("Nothing is low right now"); return; }
  const btn=$("#btnStockAlert"); if(btn) btn.disabled=true;
  try{ const r=await invokeStockAlert({reason:"digest"}); const ch=r&&r.sent&&typeof r.sent==="object"?Object.keys(r.sent).join(" + "):null; toast(ch?("Low-stock alert sent ("+ch+")"):"Alert function reached, nothing to send"); }
  catch(e){ toast("Couldn't send alert: "+e.message+" — is the Edge Function deployed?",true); }
  finally{ if(btn) btn.disabled=false; }
}

async function onSparesClick(ev){
  const btn=ev.target.closest("button[data-act]"); if(!btn)return;
  const id=Number(btn.closest(".spare-row").dataset.id); const s=state.spares.find(x=>x.id===id); if(!s)return;
  if(btn.dataset.act==="edit"){ openSpareModal(s); return; }
  if(!store.live){ toast("Sign in to update stock",true); openAuthModal(); return; }
  const nq=Math.max(0, s.qty + (btn.dataset.act==="inc"?1:-1));
  s.qty=nq; renderSpares(); renderStats();
  try{ await store.updateSpare(id,{qty:nq}); setSaved("Stock updated"); scheduleStockReconcile(id); }
  catch(e){ toast(e.message,true); }
}

/* --------------------------------- modals ---------------------------------- */
function openModal(title,bodyHTML,footHTML,narrow){ $("#modalTitle").textContent=title; $("#modalBody").innerHTML=bodyHTML; $("#modalFoot").innerHTML=footHTML||""; $(".modal").classList.toggle("narrow",!!narrow); $(".modal").classList.remove("wide"); $("#scrim").classList.add("show"); }
function closeModal(){ $("#scrim").classList.remove("show"); }

function openAuthModal(){
  if(!configured){ openModal("Backend not configured",'<p class="hint">This build has no Supabase project set. It’s running on local sample data.</p>','<button class="btn btn-primary" id="mCancel">Got it</button>',true); $("#mCancel").onclick=closeModal; return; }
  openModal("Sign in",
    '<p class="hint">Sign in to load and edit the live Mauritius register and stock.</p>'+
    '<div class="field"><label>Email</label><input id="au_email" type="email" autocomplete="username" placeholder="you@bspot.com"></div>'+
    '<div class="field"><label>Password</label><input id="au_pass" type="password" autocomplete="current-password" placeholder="••••••••"></div>'+
    '<p class="hint" style="margin-top:2px"><a href="#" id="au_forgot" style="color:var(--accent)">Forgot your password?</a></p>',
    '<button class="btn" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSignin">Sign in</button>',true);
  $("#au_email").focus();
  const submit=async()=>{ const email=$("#au_email").value.trim(), password=$("#au_pass").value; if(!email||!password){ toast("Enter your email and password",true); return; }
    $("#mSignin").disabled=true; const {error}=await sb.auth.signInWithPassword({email,password}); $("#mSignin").disabled=false;
    if(error){ toast(error.message,true); return; } closeModal(); };
  $("#mSignin").onclick=submit; $("#au_pass").addEventListener("keydown",e=>{ if(e.key==="Enter") submit(); }); $("#mCancel").onclick=closeModal;
  $("#au_forgot").onclick=async(e)=>{ e.preventDefault(); const email=$("#au_email").value.trim(); if(!email){ toast("Enter your email first, then tap “Forgot your password?”",true); $("#au_email").focus(); return; }
    const { error }=await sb.auth.resetPasswordForEmail(email,{ redirectTo: location.origin+location.pathname }); if(error){ toast(error.message,true); return; }
    toast("Reset link sent to "+email+" — open it to set a new password."); };
}

// Shown when the user arrives via a password-reset link (Supabase fires a
// PASSWORD_RECOVERY event). They pick a new password; updateUser applies it to
// the recovery session, after which they're signed in normally.
function openResetModal(){
  openModal("Set a new password",
    '<p class="hint">You followed a password-reset link. Choose a new password to finish.</p>'+
    '<div class="field"><label>New password</label><input id="rp_pass" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div>'+
    '<div class="field"><label>Confirm new password</label><input id="rp_pass2" type="password" autocomplete="new-password" placeholder="Re-type it"></div>',
    '<button class="btn btn-primary" id="mReset" style="margin-left:auto">Update password</button>',true);
  $("#rp_pass").focus();
  const submit=async()=>{ const p1=$("#rp_pass").value, p2=$("#rp_pass2").value;
    if(p1.length<8){ toast("Use at least 8 characters",true); return; }
    if(p1!==p2){ toast("The two passwords don’t match",true); return; }
    $("#mReset").disabled=true; const { error }=await sb.auth.updateUser({ password:p1 }); $("#mReset").disabled=false;
    if(error){ toast(error.message,true); return; }
    // strip the recovery token from the URL so a refresh doesn't re-trigger it
    history.replaceState(null,"",location.origin+location.pathname); closeModal(); toast("Password updated — you’re signed in."); };
  $("#mReset").onclick=submit; $("#rp_pass2").addEventListener("keydown",e=>{ if(e.key==="Enter") submit(); });
}
function promptAddAccessory(tag){
  const a=state.assets.find(x=>x.tag===tag); if(!a) return;
  const who=a.assignee||a.tag;
  openModal("Add accessory for "+who,
    '<div class="field"><label>Accessory</label><input id="inAcc" placeholder="e.g. Keyboard, Docking station, Monitor, Pen"></div><p class="hint">Added to <strong>'+esc(who)+'</strong> only, and tracked as a tick in every quarterly check from now on.</p>',
    '<button class="btn" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">Add</button>',true);
  const inp=$("#inAcc"); inp.focus();
  const save=async()=>{ const name=inp.value.trim(); if(!name){ toast("Enter an accessory name",true); return; }
    const accs=(Array.isArray(a.accessories)?a.accessories:[]).slice();
    if(accs.some(x=>x.toLowerCase()===name.toLowerCase())){ toast("Already tracked for "+who,true); return; }
    accs.push(name); const prev=a.accessories; a.accessories=accs;
    $("#mSave").disabled=true;
    try{ await store.putAsset(a); }catch(err){ a.accessories=prev; $("#mSave").disabled=false; toast("Save failed: "+err.message,true); return; }
    closeModal(); refreshRow(tag); renderStats(); setSaved("Added "+name+" for "+who); };
  $("#mSave").onclick=save; $("#mCancel").onclick=closeModal;
  inp.addEventListener("keydown",e=>{ if(e.key==="Enter") save(); });
}
async function removeAccessory(tag,name){
  const a=state.assets.find(x=>x.tag===tag); if(!a) return;
  const prev=(Array.isArray(a.accessories)?a.accessories:[]).slice();
  a.accessories=prev.filter(x=>x!==name);
  try{ await store.putAsset(a); }catch(err){ a.accessories=prev; toast("Remove failed: "+err.message,true); return; }
  const e=entry(tag); if(e.extra && (name in e.extra)){ const ex=Object.assign({},e.extra); delete ex[name]; saveEntry(tag,{extra:ex}); }
  refreshRow(tag); renderStats(); setSaved("Removed "+name);
}
function askAuditor(){
  openModal("Who's running this check?",'<div class="field"><label>Checked by</label><input id="inAuditor" placeholder="e.g. Yuvan Ramchurn" value="'+esc(state.auditor)+'"></div><p class="hint">Recorded against each item you check, and shown on the report.</p>',
    '<button class="btn" id="mCancel">Skip</button><button class="btn btn-primary" id="mSave">Save</button>',true);
  $("#inAuditor").focus(); $("#mSave").onclick=()=>{ state.auditor=$("#inAuditor").value.trim(); localStorage.setItem("mur_auditor",state.auditor); closeModal(); }; $("#mCancel").onclick=closeModal;
}
function openAssetModal(a){
  if(!store.live){ toast("Sign in to edit the live register",true); openAuthModal(); return; }
  const isNew=!a;
  a=a||{tag:"",assignee:"",reassignedFrom:"",type:"laptop",kind:"apple",model:"",variant:"",spec:"",chip:"M4",serial:"",retired:false,accessories:[]};
  const typeOpts=TYPE_ORDER.map(t=>'<option value="'+t+'"'+(a.type===t?" selected":"")+'>'+TYPES[t].label+'</option>').join("");
  const kindOpts=Object.keys(KINDS).map(k=>'<option value="'+k+'"'+(a.kind===k?" selected":"")+'>'+KINDS[k]+'</option>').join("");
  openModal(isNew?"Add asset":"Edit "+a.tag,
    '<div class="field-row"><div class="field"><label>Asset tag</label><input id="f_tag" value="'+esc(a.tag)+'" '+(isNew?"":"readonly")+' placeholder="MUR00XX"></div><div class="field"><label>Serial / ID</label><input id="f_serial" value="'+esc(a.serial)+'"></div></div>'+
    '<div class="field-row"><div class="field"><label>Type</label><select id="f_type">'+typeOpts+'</select></div><div class="field"><label>Make</label><select id="f_kind">'+kindOpts+'</select></div></div>'+
    '<div class="field"><label>Assignee / location</label><input id="f_assignee" value="'+esc(a.assignee)+'"></div>'+
    '<div class="field"><label>Reassigned from (optional)</label><input id="f_reassigned" value="'+esc(a.reassignedFrom)+'"></div>'+
    '<div class="field-row"><div class="field"><label>Model</label><input id="f_model" value="'+esc(a.model)+'"></div><div class="field"><label>Variant</label><input id="f_variant" value="'+esc(a.variant)+'"></div></div>'+
    '<div class="field-row"><div class="field"><label>Spec</label><input id="f_spec" value="'+esc(a.spec)+'"></div><div class="field"><label>Chip</label><input id="f_chip" value="'+esc(a.chip)+'"></div></div>'+
    (isNew?"":'<div class="field"><label>History</label><div class="report-preview" id="f_history">Loading…</div></div>'),
    (isNew?"":'<button class="btn" id="mDelete" style="margin-right:auto;color:var(--flag);border-color:var(--flag-line)">Remove</button><button class="btn" id="mOffboard" title="Collect the device (mark returned to IT)">Offboard</button>')+'<button class="btn" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">'+(isNew?"Add asset":"Save")+'</button>');
  $("#mCancel").onclick=closeModal;
  if(!isNew){
    // recent history (chain of custody)
    store.getHistory(a.tag).then(rows=>{ const el=$("#f_history"); if(!el)return;
      el.textContent = rows.length ? rows.map(r=>{ const d=r.changed_at?new Date(r.changed_at).toLocaleString("en-GB",{day:"2-digit",month:"short",year:"2-digit",hour:"2-digit",minute:"2-digit"}):""; return d+"  "+r.action.toUpperCase()+(r.summary?" · "+r.summary:"")+(r.changed_by&&r.changed_by!=="system"?"  ("+r.changed_by+")":""); }).join("\n") : "No history recorded yet."; })
      .catch(()=>{ const el=$("#f_history"); if(el) el.textContent="History unavailable."; });
    // offboard = collect on exit (reassign to IT store, logged automatically)
    $("#mOffboard").onclick=async()=>{ if(!confirm("Offboard "+a.tag+"? It will be marked returned to IT (was "+(a.assignee||"unassigned")+")."))return;
      const obj=Object.assign({},a,{reassignedFrom:a.assignee||"",assignee:"Returned to IT"});
      try{ await store.putAsset(obj); const i=state.assets.findIndex(x=>x.tag===a.tag); if(i>=0)state.assets[i]=obj; closeModal(); renderAll(); toast(a.tag+" offboarded — returned to IT"); }catch(e){ toast(e.message,true); } };
    $("#mDelete").onclick=async()=>{ if(confirm("Remove "+a.tag+" from the register?")){ try{ await store.delAsset(a.tag); state.assets=state.assets.filter(x=>x.tag!==a.tag); closeModal(); renderAll(); toast(a.tag+" removed"); }catch(e){ toast(e.message,true); } } };
  }
  $("#mSave").onclick=async()=>{
    const tag=$("#f_tag").value.trim().toUpperCase(); if(!tag){ toast("An asset tag is required",true); return; }
    if(isNew && state.assets.some(x=>x.tag===tag)){ toast("Tag "+tag+" already exists",true); return; }
    const obj={ tag, serial:$("#f_serial").value.trim(), type:$("#f_type").value, kind:$("#f_kind").value, assignee:$("#f_assignee").value.trim(), reassignedFrom:$("#f_reassigned").value.trim(), model:$("#f_model").value.trim(), variant:$("#f_variant").value.trim(), spec:$("#f_spec").value.trim(), chip:$("#f_chip").value.trim()||"—", retired:false, accessories:(Array.isArray(a.accessories)?a.accessories:[]) };
    try{ await store.putAsset(obj); const i=state.assets.findIndex(x=>x.tag===tag); if(i>=0)state.assets[i]=obj; else state.assets.push(obj); closeModal(); renderAll(); toast(isNew?tag+" added":tag+" updated"); }catch(e){ toast(e.message,true); }
  };
  $("#f_tag").focus();
}
function openSpareModal(s){
  if(!store.live){ toast("Sign in to edit stock",true); openAuthModal(); return; }
  const isNew=!s; s=s||{item:"",category:"other",qty:0,min_qty:0,note:""};
  const cats=["laptop","monitor","charger","hub","headset","mouse","toner","printer","cable","other"];
  openModal(isNew?"Add spare item":"Edit spare",
    '<div class="field"><label>Item</label><input id="s_item" value="'+esc(s.item)+'" placeholder="e.g. USB-C hub"></div>'+
    '<div class="field-row"><div class="field"><label>Category</label><select id="s_cat">'+cats.map(c=>'<option value="'+c+'"'+(s.category===c?" selected":"")+'>'+c.charAt(0).toUpperCase()+c.slice(1)+'</option>').join("")+'</select></div><div class="field"><label>In stock</label><input id="s_qty" type="number" min="0" value="'+s.qty+'"></div></div>'+
    '<div class="field-row"><div class="field"><label>Low-stock threshold</label><input id="s_min" type="number" min="0" value="'+s.min_qty+'"></div><div class="field"><label>Note (optional)</label><input id="s_note" value="'+esc(s.note)+'"></div></div>',
    (isNew?"":'<button class="btn" id="mDelete" style="margin-right:auto;color:var(--flag);border-color:var(--flag-line)">Remove</button>')+'<button class="btn" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">'+(isNew?"Add item":"Save")+'</button>');
  $("#mCancel").onclick=closeModal; $("#s_item").focus();
  if(!isNew) $("#mDelete").onclick=async()=>{ if(confirm("Remove "+s.item+" from stock?")){ try{ await store.delSpare(s.id); state.spares=state.spares.filter(x=>x.id!==s.id); closeModal(); renderAll(); toast("Removed"); }catch(e){ toast(e.message,true); } } };
  $("#mSave").onclick=async()=>{
    const item=$("#s_item").value.trim(); if(!item){ toast("Item name is required",true); return; }
    const patch={ item, category:$("#s_cat").value, qty:Math.max(0,parseInt($("#s_qty").value)||0), min_qty:Math.max(0,parseInt($("#s_min").value)||0), note:$("#s_note").value.trim() };
    try{
      let savedId = isNew ? await store.addSpare(patch) : (await store.updateSpare(s.id,patch), s.id);
      state.spares=await store.allSpares(); closeModal(); renderAll(); toast(isNew?"Spare added":"Saved");
      await reconcileStockAlert(state.spares.find(x=>x.id===savedId));
    }catch(e){ toast(e.message,true); }
  };
}

/* --------------------------------- report ---------------------------------- */
function periphMissing(a){ const e=entry(a.tag); const def=(a.type==="laptop"?PERIPH.filter(p=>!e.periph[p[0]]).map(p=>p[1]):[]); const cust=(Array.isArray(a.accessories)?a.accessories:[]).filter(name=>!e.extra[name]); return def.concat(cust); }
function buildReport(){
  const s=computeStats(); const act=registerAssets(); const by=st=>act.filter(a=>entry(a.tag).status===st);
  const damaged=by("damaged"), missing=by("missing"), replace=by("replace"), pending=by("pending");
  const reassigned=act.filter(a=>a.reassignedFrom);
  const gaps=act.filter(a=>(a.type==="laptop"||(Array.isArray(a.accessories)&&a.accessories.length))&&entry(a.tag).status!=="pending"&&periphMissing(a).length);
  const L=[];
  L.push("MAURITIUS ASSET REGISTER — QUARTERLY EQUIPMENT CHECK");
  L.push(qPretty(state.quarter)+"  ·  "+(CFG.OFFICE||"Ebène office"));
  L.push("Compiled "+new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"})+(state.auditor?"  ·  Checked by: "+state.auditor:""));
  L.push(store.live?"Source: live register (Supabase)":"Source: SAMPLE data (not signed in)"); L.push("");
  L.push("SUMMARY");
  L.push("  Assets in service ........... "+s.total+"  ("+typeMix(s.byType)+")");
  L.push("  Present & accounted for ..... "+s.present+" / "+s.total);
  L.push("  Damaged / needs repair ...... "+damaged.length);
  L.push("  Missing / lost .............. "+missing.length);
  L.push("  Needs replacement ........... "+replace.length);
  L.push("  Not yet checked ............. "+pending.length);
  L.push("  Missing accessories ......... "+gaps.length); L.push("");
  const block=(t,arr)=>{ if(!arr.length)return; L.push(t+" ("+arr.length+")"); arr.forEach(a=>{ const e=entry(a.tag); L.push("  "+a.tag+"  "+a.assignee+"  ·  "+a.model+(e.note?"\n      Note: "+e.note:"")); }); L.push(""); };
  block("MISSING / LOST",missing); block("DAMAGED / NEEDS REPAIR",damaged); block("NEEDS REPLACEMENT",replace);
  if(gaps.length){ L.push("MISSING ACCESSORIES ("+gaps.length+")"); gaps.forEach(a=>L.push("  "+a.tag+"  "+a.assignee+"  — missing: "+periphMissing(a).join(", "))); L.push(""); }
  if(reassigned.length){ L.push("REASSIGNMENTS TO CONFIRM ("+reassigned.length+")"); reassigned.forEach(a=>L.push("  "+a.tag+"  now "+a.assignee+"  (from "+a.reassignedFrom+")")); L.push(""); }
  const bySerial={}; act.forEach(a=>{ const k=(a.serial||"").trim().toLowerCase(); if(k) (bySerial[k]=bySerial[k]||[]).push(a); });
  const dupSerials=Object.values(bySerial).filter(g=>g.length>1);
  if(dupSerials.length){ L.push("! DATA CHECK — DUPLICATE SERIALS ("+dupSerials.length+")"); dupSerials.forEach(g=>L.push("  "+g[0].serial+"  → "+g.map(a=>a.tag+" ("+(a.assignee||"—")+")").join(", "))); L.push(""); }
  if(pending.length){ L.push("NOT YET CHECKED ("+pending.length+")"); L.push("  "+pending.map(a=>a.tag).join(", ")); L.push(""); }
  const mon=computeMonitors();
  if(mon.total || mon.spareQty){
    L.push("MONITORS ("+mon.total+" deployed"+(mon.spareQty?", "+mon.spareQty+" spare in stock":"")+")");
    L.push("  In use .............. "+mon.inUse);
    L.push("  At office ........... "+mon.office);
    L.push("  At home ............. "+mon.home+(mon.homeList.length?"   ("+mon.homeList.map(h=>h.who).join(", ")+")":""));
    L.push("  Broken / attention .. "+mon.broken);
    L.push(""); }
  if(state.spares.length){ const low=state.spares.filter(isLow);
    L.push("SPARES & STOCK ("+state.spares.length+" lines"+(low.length?", "+low.length+" low":"")+")");
    state.spares.slice().sort((a,b)=>(a.category+a.item).localeCompare(b.category+b.item)).forEach(sp=>L.push("  "+String(sp.qty).padStart(2)+" ×  "+sp.item+(isLow(sp)?"   [LOW — min "+sp.min_qty+"]":""))); L.push(""); }
  L.push("Full line-by-line register attached as CSV.");
  return L.join("\n");
}
/* Short digest for the Slack (MUR Log) auto-post on "Finish check". */
function buildCheckSummary(){
  const s=computeStats(); const act=registerAssets(); const by=st=>act.filter(a=>entry(a.tag).status===st);
  const damaged=by("damaged"), missing=by("missing"), replace=by("replace");
  const pct=Math.round(s.checked/(s.total||1)*100);
  const L=[];
  L.push(qPretty(state.quarter)+" equipment check · "+(CFG.OFFICE||"Ebène office"));
  L.push("Progress: "+s.checked+"/"+s.total+" checked ("+pct+"%)   ·   by "+(state.auditor||"—")+"   ·   "+new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}));
  L.push("Present "+s.present+"  |  Damaged "+damaged.length+"  |  Missing "+missing.length+"  |  Replace "+replace.length+"  |  Pending "+s.pending);
  const flag=damaged.concat(missing,replace);
  if(flag.length){ L.push(""); L.push("Needs attention ("+flag.length+"):"); flag.forEach(a=>{ const e=entry(a.tag); L.push("• "+a.tag+"  "+a.assignee+" — "+((ST[e.status]||{}).l||e.status)+(e.note?"  ("+e.note+")":"")); }); }
  else L.push("No flagged items 🎉");
  return L.join("\n");
}
function buildCSV(){
  const head=["Asset Tag","Type","Assignee","Reassigned From","Make/Model","Variant","Spec","Chip","Serial/ID","Condition","Charger","USB-C Hub","Headset","Mouse","Custom Accessories","Note","Checked At","Checked By"];
  const yn=b=>b?"Yes":"No";
  const rows=activeAssets().map(a=>{ const e=entry(a.tag); const lap=a.type==="laptop";
    const custom=(Array.isArray(a.accessories)?a.accessories:[]).map(name=>name+": "+yn(!!e.extra[name])).join("; ");
    return [a.tag,a.type,a.assignee,a.reassignedFrom,a.model,a.variant,a.spec,a.chip,a.serial,(ST[e.status]||ST.pending).l,lap?yn(e.periph.charger):"—",lap?yn(e.periph.hub):"—",lap?yn(e.periph.headset):"—",lap?yn(e.periph.mouse):"—",custom,e.note||"",e.at?new Date(e.at).toLocaleString("en-GB"):"",e.by||""]; });
  return [head].concat(rows).map(r=>r.map(c=>{ c=String(c==null?"":c); return /[",\n]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c; }).join(",")).join("\n");
}
function download(filename,data,mime){
  try{ const blob=new Blob([data],{type:mime||"text/plain;charset=utf-8"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast("Downloaded "+filename); }catch(e){ toast("Download failed",true); }
}
/* ---- report builder: a modular, reorderable report with live sheet preview,
   ported from the recruitment-master-dashboard report schematic. Sections toggle
   on/off, reorder (drag or arrows), and you can add free-text sections. Preview /
   HTML / plain-text modes, print, copy, CSV, and email (via send-report). ---- */
const ST_L=st=>(ST[st]||ST.pending).l;
const ASSET_COLS=[
  {key:"tag",label:"Tag",on:true,val:a=>a.tag},
  {key:"assignee",label:"Assignee",on:true,val:a=>a.assignee||"—"},
  {key:"type",label:"Type",on:false,val:a=>a.type},
  {key:"model",label:"Model",on:true,val:a=>a.model},
  {key:"variant",label:"Variant",on:false,val:a=>a.variant},
  {key:"spec",label:"Spec",on:false,val:a=>a.spec},
  {key:"chip",label:"Chip",on:false,val:a=>a.chip},
  {key:"serial",label:"Serial",on:true,val:a=>a.serial},
  {key:"status",label:"Condition",on:true,val:a=>ST_L(entry(a.tag).status)},
  {key:"note",label:"Note",on:false,val:a=>entry(a.tag).note||""},
  {key:"checkedBy",label:"Checked by",on:false,val:a=>entry(a.tag).by||""}
];
const REPORT_SECTIONS=[
  {key:"summary",label:"Summary",on:true,render:d=>{
    const t=[["Assets in service",d.s.total],["Present",d.s.present],["Damaged",d.damaged.length],["Missing",d.missing.length],["Needs replacement",d.replace.length],["Not yet checked",d.pending.length],["Missing accessories",d.gaps.length]];
    return '<section class="sheet-sec"><h3>Summary</h3><div class="sheet-kpis">'+t.map(x=>'<div class="skpi"><div class="v">'+x[1]+'</div><div class="l">'+esc(x[0])+'</div></div>').join("")+'</div></section>';
  }},
  {key:"attention",label:"Needs attention",on:true,render:d=>{
    const rows=d.missing.concat(d.damaged,d.replace); if(!rows.length) return "";
    return '<section class="sheet-sec"><h3>Needs attention ('+rows.length+')</h3><table class="sheet-tbl"><thead><tr><th>Tag</th><th>Assignee</th><th>Model</th><th>Status</th><th>Note</th></tr></thead><tbody>'+
      rows.map(a=>{const e=entry(a.tag);return '<tr><td>'+esc(a.tag)+'</td><td>'+esc(a.assignee||"—")+'</td><td>'+esc(a.model)+'</td><td>'+esc(ST_L(e.status))+'</td><td>'+esc(e.note||"")+'</td></tr>';}).join("")+'</tbody></table></section>';
  }},
  {key:"accessories",label:"Missing accessories",on:true,render:d=>{
    if(!d.gaps.length) return "";
    return '<section class="sheet-sec"><h3>Missing accessories ('+d.gaps.length+')</h3><ul class="sheet-ul">'+d.gaps.map(a=>'<li><b>'+esc(a.tag)+'</b> '+esc(a.assignee||"")+' — '+esc(periphMissing(a).join(", "))+'</li>').join("")+'</ul></section>';
  }},
  {key:"reassignments",label:"Reassignments to confirm",on:false,render:d=>{
    if(!d.reassigned.length) return "";
    return '<section class="sheet-sec"><h3>Reassignments to confirm ('+d.reassigned.length+')</h3><ul class="sheet-ul">'+d.reassigned.map(a=>'<li><b>'+esc(a.tag)+'</b> now '+esc(a.assignee)+' (from '+esc(a.reassignedFrom)+')</li>').join("")+'</ul></section>';
  }},
  {key:"pending",label:"Not yet checked",on:false,render:d=>{
    if(!d.pending.length) return "";
    return '<section class="sheet-sec"><h3>Not yet checked ('+d.pending.length+')</h3><p class="sheet-tags">'+d.pending.map(a=>esc(a.tag)).join(", ")+'</p></section>';
  }},
  {key:"monitors",label:"Monitors",on:false,render:d=>{
    const m=d.mon; if(!(m.total||m.spareQty)) return "";
    const t=[["Deployed",m.total],["In use",m.inUse],["Office",m.office],["Home",m.home],["Broken",m.broken],["Spare in stock",m.spareQty]];
    return '<section class="sheet-sec"><h3>Monitors</h3><div class="sheet-kpis">'+t.map(x=>'<div class="skpi"><div class="v">'+x[1]+'</div><div class="l">'+esc(x[0])+'</div></div>').join("")+'</div></section>';
  }},
  {key:"spares",label:"Spares & stock",on:false,render:d=>{
    if(!state.spares.length) return "";
    const rows=state.spares.slice().sort((a,b)=>(a.category+a.item).localeCompare(b.category+b.item));
    return '<section class="sheet-sec"><h3>Spares & stock ('+rows.length+')</h3><table class="sheet-tbl"><thead><tr><th>Qty</th><th>Item</th><th>Category</th><th>Status</th></tr></thead><tbody>'+
      rows.map(sp=>'<tr><td>'+sp.qty+'</td><td>'+esc(sp.item)+'</td><td>'+esc(sp.category)+'</td><td>'+(isLow(sp)?('LOW (min '+sp.min_qty+')'):'OK')+'</td></tr>').join("")+'</tbody></table></section>';
  }},
  {key:"dupserials",label:"Duplicate serials (data check)",on:false,render:d=>{
    const bySerial={}; d.act.forEach(a=>{const k=(a.serial||"").trim().toLowerCase(); if(k)(bySerial[k]=bySerial[k]||[]).push(a);});
    const dups=Object.keys(bySerial).map(k=>bySerial[k]).filter(g=>g.length>1);
    if(!dups.length) return "";
    return '<section class="sheet-sec"><h3>Duplicate serials ('+dups.length+')</h3><ul class="sheet-ul">'+dups.map(g=>'<li><b>'+esc(g[0].serial)+'</b> → '+esc(g.map(a=>a.tag).join(", "))+'</li>').join("")+'</ul></section>';
  }},
  {key:"assets",label:"Full asset table",on:false,cols:true,render:d=>{
    const cols=ASSET_COLS.filter(c=>rptState.fields.indexOf(c.key)!==-1); const use=cols.length?cols:ASSET_COLS.filter(c=>c.on);
    return '<section class="sheet-sec"><h3>Full register ('+d.act.length+')</h3><table class="sheet-tbl"><thead><tr>'+use.map(c=>'<th>'+esc(c.label)+'</th>').join("")+'</tr></thead><tbody>'+
      d.act.map(a=>'<tr>'+use.map(c=>{const v=c.val(a);return '<td>'+esc(v==null?"":String(v))+'</td>';}).join("")+'</tr>').join("")+'</tbody></table></section>';
  }}
];
var rptState={items:null,fields:null,open:"",drag:null,mode:"preview",cseq:0};
function rptInit(){ if(rptState.items) return; rptState.items=REPORT_SECTIONS.map(s=>({kind:"std",key:s.key,label:s.label,on:!!s.on})); rptState.fields=ASSET_COLS.filter(c=>c.on).map(c=>c.key); }
function rptData(){
  const s=computeStats(); const act=registerAssets(); const by=st=>act.filter(a=>entry(a.tag).status===st);
  return {s,act,damaged:by("damaged"),missing:by("missing"),replace:by("replace"),pending:by("pending"),
    reassigned:act.filter(a=>a.reassignedFrom),
    gaps:act.filter(a=>(a.type==="laptop"||(Array.isArray(a.accessories)&&a.accessories.length))&&entry(a.tag).status!=="pending"&&periphMissing(a).length),
    mon:computeMonitors()};
}
function rptOpts(){ return { title:($("#rb-title")||{}).value||("Equipment-check report — "+qPretty(state.quarter)), intro:($("#rb-intro")||{}).value||"", signoff:($("#rb-signoff")||{}).value||"" }; }
function rptBuildSheet(o){
  o=o||rptOpts(); const d=rptData();
  const head='<div class="sheet-head"><div class="sheet-h1">'+esc(o.title)+'</div><div class="sheet-meta">'+esc(qPretty(state.quarter))+' · '+esc(CFG.OFFICE||"Ebène office")+' · '+new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"})+(o.signoff?(' · Checked by '+esc(o.signoff)):"")+'</div></div>';
  const intro=o.intro?'<p class="sheet-intro">'+esc(o.intro)+'</p>':"";
  const body=(rptState.items||[]).map(it=>{
    if(!it.on) return "";
    if(it.kind==="custom"){ if(!it.title&&!it.body) return ""; return '<section class="sheet-sec"><h3>'+esc(it.title||"Section")+'</h3><p style="white-space:pre-wrap">'+esc(it.body||"")+'</p></section>'; }
    const sec=REPORT_SECTIONS.filter(x=>x.key===it.key)[0]; return sec?sec.render(d,o):"";
  }).join("");
  const so=o.signoff?'<div class="sheet-signoff">Report compiled by '+esc(o.signoff)+'.</div>':"";
  return head+intro+body+so;
}
function rptRefresh(){
  const d=rptData(); const c=$("#rb-count"); if(c) c.textContent=d.act.length+" assets · "+d.s.checked+"/"+d.s.total+" checked";
  const html=rptBuildSheet(); const prev=$("#rb-prev"), src=$("#rb-src"); if(!prev) return;
  if(rptState.mode==="preview"){ prev.style.display=""; src.style.display="none"; prev.innerHTML='<div class="sheet">'+html+'</div>'; }
  else { prev.style.display="none"; src.style.display=""; src.value = rptState.mode==="html" ? ('<div class="sheet">'+html+'</div>') : buildReport(); }
}
function rptDebounce(){ clearTimeout(rptState._t); rptState._t=setTimeout(rptRefresh,300); }
function rptMove(i,dir){ const to=i+dir, a=rptState.items; if(to<0||to>=a.length) return; const m=a.splice(i,1)[0]; a.splice(to,0,m); rptPaint(); rptRefresh(); }
function rptPaint(){
  const box=$("#rb-secs"); if(!box) return; const items=rptState.items;
  box.innerHTML=items.map((it,i)=>{
    const id=it.kind==="custom"?it.cid:it.key;
    const sec=it.kind==="std"?REPORT_SECTIONS.filter(x=>x.key===it.key)[0]:null;
    const expandable=(sec&&sec.cols)||it.kind==="custom";
    let sub="";
    if(expandable && rptState.open===id){
      if(sec&&sec.cols){
        sub='<div class="rb-sub"><div class="rb-hint">Columns in the table.</div><div class="rb-fgrid">'+ASSET_COLS.map(f=>'<label><input type="checkbox" data-fld="'+esc(f.key)+'"'+(rptState.fields.indexOf(f.key)!==-1?" checked":"")+'><span>'+esc(f.label)+'</span></label>').join("")+'</div></div>';
      } else {
        sub='<div class="rb-sub"><input type="text" data-ctitle="'+esc(it.cid)+'" placeholder="Section heading" value="'+esc(it.title||"")+'"><textarea data-cbody="'+esc(it.cid)+'" placeholder="Write anything — appears exactly as typed.">'+esc(it.body||"")+'</textarea><button class="rb-mini" data-cdel="'+esc(it.cid)+'">Remove section</button></div>';
      }
    }
    return '<div><div class="rb-row" draggable="true" data-idx="'+i+'" data-id="'+esc(id)+'">'+
      '<span class="grip" title="Drag to reorder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg></span>'+
      '<label><input type="checkbox" data-sec="'+esc(id)+'"'+(it.on?" checked":"")+'><span>'+esc(it.kind==="custom"?(it.title||"My section"):it.label)+'</span></label>'+
      (expandable?'<button class="rb-mini" data-open="'+esc(id)+'">'+(rptState.open===id?"Done":(sec&&sec.cols?"Columns":"Edit"))+'</button>':'')+
      '<button class="rb-mini" data-mv="up" data-idx="'+i+'"'+(i===0?" disabled":"")+' title="Up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg></button>'+
      '<button class="rb-mini" data-mv="down" data-idx="'+i+'"'+(i===items.length-1?" disabled":"")+' title="Down"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>'+
      '</div>'+sub+'</div>';
  }).join("");
  rptWire();
}
function rptWire(){
  const box=$("#rb-secs"); if(!box) return;
  $$('input[data-sec]',box).forEach(cb=>cb.onchange=()=>{ const it=rptState.items.filter(x=>(x.kind==="custom"?x.cid:x.key)===cb.dataset.sec)[0]; if(it){ it.on=cb.checked; rptRefresh(); } });
  $$('[data-open]',box).forEach(b=>b.onclick=()=>{ rptState.open=(rptState.open===b.dataset.open)?"":b.dataset.open; rptPaint(); });
  $$('[data-mv]',box).forEach(b=>b.onclick=()=>rptMove(Number(b.dataset.idx), b.dataset.mv==="up"?-1:1));
  $$('input[data-fld]',box).forEach(cb=>cb.onchange=()=>{ const k=cb.dataset.fld, at=rptState.fields.indexOf(k); if(cb.checked&&at===-1)rptState.fields.push(k); if(!cb.checked&&at!==-1)rptState.fields.splice(at,1); rptRefresh(); });
  $$('[data-ctitle]',box).forEach(inp=>inp.oninput=()=>{ const it=rptState.items.filter(x=>x.cid===inp.dataset.ctitle)[0]; if(it){ it.title=inp.value; const sp=box.querySelector('.rb-row[data-id="'+(window.CSS&&CSS.escape?CSS.escape(it.cid):it.cid)+'"] label span'); if(sp)sp.textContent=it.title||"My section"; rptDebounce(); } });
  $$('[data-cbody]',box).forEach(ta=>ta.oninput=()=>{ const it=rptState.items.filter(x=>x.cid===ta.dataset.cbody)[0]; if(it){ it.body=ta.value; rptDebounce(); } });
  $$('[data-cdel]',box).forEach(b=>b.onclick=()=>{ const id=b.dataset.cdel; rptState.items=rptState.items.filter(x=>x.cid!==id); if(rptState.open===id)rptState.open=""; rptPaint(); rptRefresh(); });
  $$('.rb-row',box).forEach(row=>{
    row.ondragstart=e=>{ rptState.drag=Number(row.dataset.idx); row.classList.add("drag"); try{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",row.dataset.id);}catch(err){} };
    row.ondragend=()=>{ row.classList.remove("drag"); $$('.rb-row',box).forEach(r=>r.classList.remove("before","after")); rptState.drag=null; };
    row.ondragover=e=>{ if(rptState.drag==null)return; e.preventDefault(); $$('.rb-row',box).forEach(r=>r.classList.remove("before","after")); const i=Number(row.dataset.idx); if(i!==rptState.drag) row.classList.add(i<rptState.drag?"before":"after"); };
    row.ondrop=e=>{ e.preventDefault(); $$('.rb-row',box).forEach(r=>r.classList.remove("before","after")); const to=Number(row.dataset.idx); if(rptState.drag==null||to===rptState.drag)return; const m=rptState.items.splice(rptState.drag,1)[0]; rptState.items.splice(to,0,m); rptState.drag=null; rptPaint(); rptRefresh(); };
  });
  box.ondragover=e=>{ if(rptState.drag!=null) e.preventDefault(); };
}
function rptAddCustom(){ rptState.cseq++; const cid="c"+rptState.cseq; rptState.items.push({kind:"custom",cid:cid,title:"",body:"",on:true}); rptState.open=cid; rptPaint(); rptRefresh(); }
function rptPrint(){
  const html='<div class="sheet">'+rptBuildSheet()+'</div>';
  const css=(function(){ try{ const el=document.querySelector('link[rel="stylesheet"]'); return el?"":""; }catch(e){ return ""; } })();
  const w=window.open("","_blank"); if(!w){ toast("Allow pop-ups to print",true); return; }
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>'+esc(rptOpts().title)+'</title>'+
    '<link rel="stylesheet" href="'+location.origin+location.pathname.replace(/[^/]*$/,"")+'styles.css">'+
    '<style>body{margin:0;padding:22px;background:#fff}.sheet{box-shadow:none;max-width:none}@media print{body{padding:0}}</style>'+
    '</head><body>'+html+'</body></html>');
  w.document.close(); w.focus(); setTimeout(()=>{ try{w.print();}catch(e){} },400);
}
function openReportModal(){
  rptInit();
  const qslug=state.quarter.replace("-","_");
  if(!$("#rb-title")) { /* first open sets defaults below */ }
  const body='<div class="rb"><div class="rb-side">'+
    (store.live?"":'<p class="rb-hint">Sample data — sign in to report the live register.</p>')+
    '<div class="rb-group"><h4>Sections &amp; order</h4><p class="rb-hint">Drag the handle to reorder, or use the arrows. Tick what goes in.</p><div class="rb-secs" id="rb-secs"></div><button class="btn btn-sm" id="rb-addsec">+ Add my own section</button></div>'+
    '<div class="rb-group"><h4>Details</h4><div class="field"><label>Report title</label><input id="rb-title" value="'+esc("Equipment-check report — "+qPretty(state.quarter))+'"></div><div class="field"><label>Intro (optional)</label><textarea id="rb-intro" placeholder="Anything to say before the numbers…"></textarea></div><div class="field"><label>Checked by</label><input id="rb-signoff" value="'+esc(state.auditor||"")+'"></div></div>'+
    '<div class="rb-group"><h4>Email</h4><div class="field"><label>Send to</label><input id="rb-to" value="'+esc(state.gerardEmail)+'"></div></div>'+
    '</div><div class="rb-main"><div class="rb-prevhead"><span id="rb-count"></span><div class="rb-modes" id="rb-modes"><button data-m="preview" aria-pressed="true">Preview</button><button data-m="html">HTML</button><button data-m="text">Plain text</button></div></div><div class="rb-prev" id="rb-prev"></div><textarea class="rb-src" id="rb-src" readonly style="display:none"></textarea></div></div>';
  const foot='<button class="btn" id="rb-print">Print</button><button class="btn" id="rb-copy">Copy HTML</button><button class="btn" id="rb-csv">CSV</button><button class="btn" id="rb-txt">Report .txt</button><button class="btn btn-primary" id="rb-mail">Email</button>';
  openModal("Report — "+qPretty(state.quarter),body,foot);
  $(".modal").classList.add("wide");
  rptState.mode="preview";
  rptPaint();
  $("#rb-addsec").onclick=rptAddCustom;
  ["rb-title","rb-intro","rb-signoff"].forEach(id=>{ const el=$("#"+id); if(el) el.oninput=rptDebounce; });
  $$("#rb-modes button").forEach(b=>b.onclick=()=>{ rptState.mode=b.dataset.m; $$("#rb-modes button").forEach(x=>x.setAttribute("aria-pressed",String(x===b))); rptRefresh(); });
  $("#rb-print").onclick=rptPrint;
  $("#rb-copy").onclick=async()=>{ try{ await navigator.clipboard.writeText('<div class="sheet">'+rptBuildSheet()+'</div>'); toast("HTML copied"); }catch(e){ toast("Copy failed",true); } };
  $("#rb-csv").onclick=()=>download("MUR_equipment_check_"+qslug+".csv",buildCSV(),"text/csv;charset=utf-8");
  $("#rb-txt").onclick=()=>download("MUR_equipment_check_"+qslug+".txt",buildReport());
  $("#rb-mail").onclick=async()=>{ const to=($("#rb-to").value||"").trim()||state.gerardEmail; state.gerardEmail=to; try{localStorage.setItem("mur_gerard",to);}catch(e){}
    const subj="Mauritius Quarterly Equipment Check — "+qPretty(state.quarter); const bodyTxt=buildReport(); const btn=$("#rb-mail");
    if(store.live && sb){ btn.disabled=true; const old=btn.textContent; btn.textContent="Sending…";
      try{ const {data,error}=await sb.functions.invoke("send-report",{body:{to,subject:subj,text:bodyTxt,csv_base64:b64(buildCSV()),csv_name:"MUR_equipment_check_"+qslug+".csv"}});
        if(error) throw error; if(data&&data.error) throw new Error(data.error);
        toast("Report emailed to "+to); closeModal(); return;
      }catch(e){ toast("Couldn't send: "+e.message+" — opening your mail app",true); mailtoReport(to,subj,bodyTxt); }
      finally{ btn.disabled=false; btn.textContent=old; }
    } else mailtoReport(to,subj,bodyTxt);
  };
  rptRefresh();
}
function mailtoReport(to,subj,body){
  const full=body+"\n\n(The full line-by-line register is attached separately as a CSV — use the Download CSV button.)";
  window.location.href="mailto:"+encodeURIComponent(to)+"?subject="+encodeURIComponent(subj)+"&body="+encodeURIComponent(full);
}
// UTF-8 safe base64 (for CSV attachment)
function b64(str){ return btoa(unescape(encodeURIComponent(str))); }

/* --------------------------------- backup ---------------------------------- */
function openBackupModal(){
  openModal("Backup & restore",
    '<p class="hint">Export a JSON snapshot of the register, checks and spares, or restore one.</p><div class="field"><label>Currently loaded</label><div class="report-preview" id="b_info">Reading…</div></div>',
    '<button class="btn" id="b_import"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V9M7 14l5-5 5 5"/><path d="M5 3h14"/></svg>Import</button><button class="btn btn-primary" id="b_export"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>Export</button>');
  store.allEntries().then(en=>{ $("#b_info").textContent="Mode: "+(store.live?"Live (Supabase)":"Sample (local)")+"\nAssets: "+activeAssets().length+"\nCheck records: "+en.length+"\nSpare lines: "+state.spares.length+"\nInvoices: "+state.invoices.length; }).catch(()=>{ $("#b_info").textContent="Assets: "+activeAssets().length; });
  $("#b_export").onclick=async()=>{ const entries=await store.allEntries();
    download("MUR_register_backup_"+currentQuarter().replace("-","_")+".json",JSON.stringify({app:"mur-asset-register",version:6,exportedAt:new Date().toISOString(),live:store.live,assets:state.assets,entries,spares:state.spares,invoices:state.invoices,procurement:state.procurement},null,2),"application/json"); };
  $("#b_import").onclick=()=>$("#fileImport").click();
}
async function onImportFile(ev){
  const file=ev.target.files[0]; ev.target.value=""; if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(data.app!=="mur-asset-register"||!Array.isArray(data.assets)) throw new Error("Not a register backup");
    for(const a of data.assets) await store.putAsset(a);
    if(Array.isArray(data.entries)) for(const r of data.entries) await store.putEntry(r.quarter,r.tag,{status:r.status,note:r.note,at:r.checked_at,by:r.checked_by,periph:{charger:!!r.charger,hub:!!r.hub,headset:!!r.headset,mouse:!!r.mouse},extra:normExtra(r.extra)});
    if(Array.isArray(data.spares)) for(const sp of data.spares){ try{ await store.addSpare(sp); }catch(e){} }
    if(Array.isArray(data.invoices)) for(const iv of data.invoices){ try{ const c=Object.assign({},iv); delete c.id; await store.addInvoice(c); }catch(e){} }
    if(Array.isArray(data.procurement)) for(const pp of data.procurement){ try{ const c=Object.assign({},pp); delete c.id; await store.addPurchase(c); }catch(e){} }
    state.assets=await store.allAssets(); state.spares=await store.allSpares(); state.invoices=await store.allInvoices(); state.procurement=await store.allProcurement(); await loadEntries(); closeModal(); renderAll(); toast("Restored "+data.assets.length+" assets");
  }catch(e){ toast("Import failed: "+e.message,true); }
}

/* ------------------------------- theme / auth ------------------------------ */
function applyTheme(t){ document.documentElement.setAttribute("data-theme",t);
  $("#iconTheme").innerHTML = t==="dark" ? '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>' : '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'; }
function renderAuth(){
  const live=store.live; const pill=$("#conn");
  pill.className="conn "+(live?"is-live":"is-sample");
  pill.querySelector(".ctext").textContent = live ? "Live · Supabase" : (configured?"Sample data":"Local demo");
  $("#authBtn").innerHTML = live
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/></svg><span class="lbl">Sign out</span>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg><span class="lbl">Sign in</span>';
  $("#authBtn").title = live ? "Signed in as "+(state.user&&state.user.email||"")+" — sign out" : "Sign in to load the live register";
  const banner=$("#modeBanner");
  if(!live && configured){ banner.style.display="flex"; } else { banner.style.display="none"; }
}
async function useStore(next){
  store=next; state.loading=true; renderView();
  try{ state.assets=await store.allAssets(); }catch(e){ state.assets=[]; toast("Load failed: "+e.message,true); }
  try{ state.spares=await store.allSpares(); }catch(e){ state.spares=[]; }
  try{ state.invoices=await store.allInvoices(); }catch(e){ state.invoices=[]; }
  try{ state.procurement=await store.allProcurement(); }catch(e){ state.procurement=[]; }
  try{ const k=await store.getSetting("newhire_kit"); state.kit=(k&&Array.isArray(k.items)&&k.items.length)?k.items:DEFAULT_KIT.map(x=>Object.assign({},x)); }catch(e){ state.kit=DEFAULT_KIT.map(x=>Object.assign({},x)); }
  try{ const ob=await store.getSetting("onboarding_runs"); state.onboarding=Array.isArray(ob)?ob:[]; }catch(e){ state.onboarding=[]; }
  try{ const dc=await store.getSetting("documents"); state.documents=Array.isArray(dc)?dc:[]; }catch(e){ state.documents=[]; }
  try{ const an=await store.getSetting("announcements"); state.announcements=Array.isArray(an)?an:[]; }catch(e){ state.announcements=[]; }
  state.admins=[]; state.isAdmin=false;
  if(store.live){
    try{ const ov=await store.getSetting("app_config"); if(ov&&typeof ov==="object") state.settings=ov; }catch(e){}
    try{ state.admins=await store.getAdmins(); }catch(e){ state.admins=[]; }
    const me=((state.user&&state.user.email)||"").toLowerCase();
    state.isAdmin=state.admins.some(a=>((a.email||"").toLowerCase())===me);
  }
  applyConfigOverrides();
  await loadEntries(); state.loading=false; renderAuth(); renderAll();
}
async function onSignedIn(session){ state.user=session.user; if(!state.auditor){ state.auditor=(session.user.user_metadata&&session.user.user_metadata.name)||session.user.email||""; } await useStore(supaStore); toast("Signed in — live data loaded"); subscribeRealtime(); }
async function onSignedOut(){ state.user=null; state.auditMode=false; document.body.classList.remove("audit-on"); await useStore(localStore); }
let rtChannel=null;
function subscribeRealtime(){ if(!sb || rtChannel) return;
  try{ rtChannel=sb.channel("mur-live")
      .on("postgres_changes",{event:"*",schema:"public",table:"assets"},async()=>{ state.assets=await store.allAssets(); scheduleLiveRender(); })
      .on("postgres_changes",{event:"*",schema:"public",table:"audit_entries"},async()=>{ await loadEntries(); scheduleLiveRender(); })
      .on("postgres_changes",{event:"*",schema:"public",table:"spares"},async()=>{ state.spares=await store.allSpares(); scheduleLiveRender(); })
      .on("postgres_changes",{event:"*",schema:"public",table:"invoices"},async()=>{ state.invoices=await store.allInvoices(); scheduleLiveRender(); })
      .on("postgres_changes",{event:"*",schema:"public",table:"procurement"},async()=>{ state.procurement=await store.allProcurement(); scheduleLiveRender(); })
      .subscribe(); }catch(e){}
}

/* --------------------------------- init ------------------------------------ */
async function init(){
  applyTheme(localStorage.getItem("mur_theme") || (matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"));
  state.auditor=localStorage.getItem("mur_auditor")||"";
  state.gerardEmail=localStorage.getItem("mur_gerard")||state.gerardEmail;
  $("#office").textContent=CFG.OFFICE||"Ebène · Regus";

  const qs=$("#qSelect"); const ql=recentQuarters(8); if(!ql.includes(state.quarter)) ql.unshift(state.quarter);
  qs.innerHTML=ql.map(q=>'<option value="'+q+'"'+(q===state.quarter?" selected":"")+'>'+qPretty(q)+'</option>').join("");
  $("#pQuarter").textContent=qPretty(state.quarter);
  $("#auditBtnLabel").textContent="Start "+qPretty(state.quarter)+" check";

  $("#register").addEventListener("click",onRegisterClick);
  $("#register").addEventListener("input",onRegisterInput);
  $("#spares").addEventListener("click",onSparesClick);
  $("#spareSort").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b)return; state.spareSort=b.dataset.s; $$("#spareSort button").forEach(x=>x.setAttribute("aria-pressed",x===b)); renderSpares(); });
  $("#monSummary").addEventListener("click",e=>{
    if(e.target.closest("#monManage")) return openMonitorsModal();
    const b=e.target.closest("button[data-act]"); if(!b) return;
    if(b.dataset.act==="mon-inc") monAdjust(b.dataset.bucket,1);
    else if(b.dataset.act==="mon-dec") monAdjust(b.dataset.bucket,-1);
  });
  $("#invoices").addEventListener("click",onInvoicesClick);
  $("#procurement").addEventListener("click",onProcurementClick);
  $("#navRegister").addEventListener("click",()=>setView("register"));
  $("#navSpares").addEventListener("click",()=>setView("spares"));
  $("#navInvoices").addEventListener("click",()=>setView("invoices"));
  $("#navProcurement").addEventListener("click",()=>setView("procurement"));
  { const n=$("#navOnboarding"); if(n) n.addEventListener("click",()=>setView("onboarding")); }
  { const b=$("#btnAddHire"); if(b) b.addEventListener("click",openOnboardModal); }
  { const o=$("#onboarding"); if(o){ o.addEventListener("click",onOnboardingClick); o.addEventListener("change",onOnboardingChange); } }
  { const n=$("#navStaff"); if(n) n.addEventListener("click",()=>setView("staff")); }
  { const n=$("#navDocuments"); if(n) n.addEventListener("click",()=>setView("documents")); }
  { const n=$("#navAnnouncements"); if(n) n.addEventListener("click",()=>setView("announcements")); }
  { const s=$("#staff"); if(s) s.addEventListener("click",onStaffClick); }
  { const d=$("#documents"); if(d) d.addEventListener("click",onDocumentsClick); }
  { const a=$("#announcements"); if(a) a.addEventListener("click",onAnnouncementsClick); }
  { const b=$("#btnAddDoc"); if(b) b.addEventListener("click",openDocModal); }
  { const b=$("#btnAddAnn"); if(b) b.addEventListener("click",openAnnModal); }
  $("#navToggle").addEventListener("click",()=>document.body.classList.toggle("nav-open"));
  $("#search").addEventListener("input",e=>{ state.q=e.target.value; clearTimeout(window._searchT); window._searchT=setTimeout(renderView,160); });
  $("#filterType").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b)return; state.filter=b.dataset.f; $$("#filterType button").forEach(x=>x.setAttribute("aria-pressed",x===b)); renderStats(); renderRegister(); updateRegisterSub(); });
  $("#groupBy").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b)return; state.group=b.dataset.g; $$("#groupBy button").forEach(x=>x.setAttribute("aria-pressed",x===b)); renderRegister(); });
  $("#btnAudit").addEventListener("click",()=>setAuditMode(!state.auditMode));
  $("#btnAuditDone").addEventListener("click",finishCheck);
  $("#btnMarkPresent").addEventListener("click",bulkMarkPresent);
  $("#btnAdmin").addEventListener("click",openAdminConsole);
  $("#nudgeStart").addEventListener("click",()=>setAuditMode(true));
  $("#nudgeDismiss").addEventListener("click",()=>{ localStorage.setItem("mur_nudge_dismissed",state.quarter); $("#checkNudge").style.display="none"; });
  $("#btnReport").addEventListener("click",openReportModal);
  $("#btnAdd").addEventListener("click",()=>openAssetModal(null));
  $("#btnAddSpare").addEventListener("click",()=>openSpareModal(null));
  $("#btnStockAlert").addEventListener("click",sendStockDigestNow);
  $("#btnAddInvoice").addEventListener("click",()=>openInvoiceModal(null));
  $("#btnAddPurchase").addEventListener("click",()=>openPurchaseModal(null));
  $("#btnKit").addEventListener("click",addNewHireKit);
  $("#btnBackup").addEventListener("click",openBackupModal);
  $("#fileImport").addEventListener("change",onImportFile);
  $("#authBtn").addEventListener("click",async()=>{ if(store.live){ await sb.auth.signOut(); } else { openAuthModal(); } });
  $("#btnTheme").addEventListener("click",()=>{ const t=document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark"; applyTheme(t); localStorage.setItem("mur_theme",t); });
  qs.addEventListener("change",async e=>{ state.quarter=e.target.value; $("#auditBtnLabel").textContent=(state.auditMode?"Checking ":"Start ")+qPretty(state.quarter)+(state.auditMode?"…":" check"); await loadEntries(); renderAll(); });
  $("#modalClose").addEventListener("click",closeModal);
  $("#scrim").addEventListener("click",e=>{ if(e.target===$("#scrim")) closeModal(); });
  document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeModal(); });

  setView("register");
  if(configured && sb){
    sb.auth.onAuthStateChange((event,session)=>{ if(event==="PASSWORD_RECOVERY"){ openResetModal(); return; } if(session&&session.user){ onSignedIn(session); } else { onSignedOut(); } });
    const {data}=await sb.auth.getSession();
    if(data && data.session){ await onSignedIn(data.session); } else { await useStore(localStore); }
  } else { await useStore(localStore); }
  setSaved(store.live?"Connected to live data":"Sample data — changes stay on this device");
}
init();
