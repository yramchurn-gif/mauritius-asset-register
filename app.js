"use strict";
/* ============================================================================
   Mauritius Asset Register — application logic.

   Architecture (the point of the pitch):
   The whole UI talks to ONE data layer — `store`. Today `store` resolves to
   either a Supabase (hosted Postgres) backend when you're signed in, or a
   local sample dataset when you're not. Swapping the backend never touches the
   UI. Fund a dedicated server and only this file's `supaStore` changes.
   ========================================================================== */

const CFG = window.MUR_CONFIG || {};
let sb = null;               // supabase client (null until configured)
const configured = !!(CFG.SUPABASE_URL && CFG.SUPABASE_KEY);
if (configured && window.supabase) {
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
}

/* ------- anonymized SAMPLE data (safe for the public repo / logged-out) ----- */
/* Fictional names + fake serials. The real register lives in Supabase, gated
   behind login, and is never committed to this public repository.            */
const SAMPLE = [
  ["MUR0001","Aisha K.","","laptop","apple","MacBook Air","15\" · M2 · 2023","8GB / 256GB","M2","SN-SAMPLE-01"],
  ["MUR0002","Devan R.","","laptop","apple","MacBook Air","15\" · M2 · 2023","8GB / 256GB","M2","SN-SAMPLE-02"],
  ["MUR0003","Priya S.","Former holder","laptop","apple","MacBook Air","15\" · M3 · 2024","8GB / 256GB","M3","SN-SAMPLE-03"],
  ["MUR0004","Kevin M.","","laptop","apple","MacBook Air","15\" · M3 · 2024","8GB / 256GB","M3","SN-SAMPLE-04"],
  ["MUR0005","Nisha B.","","laptop","apple","MacBook Air","13\" · M4 · 2024","16GB / 256GB","M4","SN-SAMPLE-05"],
  ["MUR0006","Ryan T.","","laptop","apple","MacBook Air","13\" · M4 · 2024","16GB / 256GB","M4","SN-SAMPLE-06"],
  ["MUR0007","Sara L.","","laptop","apple","MacBook Air","13\" · M4 · 2024","16GB / 256GB","M4","SN-SAMPLE-07"],
  ["MUR0008","Ops Lead","","laptop","windows","Asus ROG Strix","G8-series · dGPU","32GB / 2TB","PC","SN-SAMPLE-08"],
  ["MUR0090","Office","","infra","ups","APC UPS","Rack UPS","Backup power","—","SN-SAMPLE-UPS"],
  ["MUR0091","Office","","infra","net","Access Point","Wireless AP","Network","—","SN-SAMPLE-AP"],
  ["MUR0092","Office","","infra","net","Fibre ONT","Fibre terminal","Network","—","SN-SAMPLE-ONT"],
  ["MUR0093","Office","","infra","net","Firewall","Edge firewall","Network","—","SN-SAMPLE-FW"]
];
function rowToObj(r){
  return { tag:r[0], assignee:r[1], reassignedFrom:r[2], type:r[3], kind:r[4],
    model:r[5], variant:r[6], spec:r[7], chip:r[8], serial:r[9], retired:false };
}

/* ------------------------------ db <-> app mapping ------------------------- */
function fromDb(r){
  return { tag:r.tag, assignee:r.assignee||"", reassignedFrom:r.reassigned_from||"",
    type:r.type, kind:r.kind, model:r.model||"", variant:r.variant||"", spec:r.spec||"",
    chip:r.chip||"—", serial:r.serial||"", retired:!!r.retired };
}
function toDb(a){
  return { tag:a.tag, assignee:a.assignee, reassigned_from:a.reassignedFrom, type:a.type,
    kind:a.kind, model:a.model, variant:a.variant, spec:a.spec, chip:a.chip,
    serial:a.serial, retired:!!a.retired, updated_at:new Date().toISOString() };
}

/* --------------------------------- stores ---------------------------------- */
const LS_KEY="mur_sample_store";
function lsRead(){ try { return JSON.parse(localStorage.getItem(LS_KEY)||"null"); } catch(e){ return null; } }
function lsWrite(o){ try { localStorage.setItem(LS_KEY,JSON.stringify(o)); } catch(e){} }
function lsInit(){ let o=lsRead(); if(!o){ o={ assets:SAMPLE.map(rowToObj), entries:{} }; lsWrite(o); } return o; }

const localStore = {
  live:false,
  async allAssets(){ return lsInit().assets.slice(); },
  async putAsset(a){ const o=lsInit(); const i=o.assets.findIndex(x=>x.tag===a.tag); if(i>=0)o.assets[i]=a; else o.assets.push(a); lsWrite(o); },
  async delAsset(tag){ const o=lsInit(); o.assets=o.assets.filter(x=>x.tag!==tag); lsWrite(o); },
  async getEntries(q){ const o=lsInit(); return Object.assign({},o.entries[q]||{}); },
  async putEntry(q,tag,e){ const o=lsInit(); o.entries[q]=o.entries[q]||{}; o.entries[q][tag]=e; lsWrite(o); },
  async allEntries(){ const o=lsInit(); const out=[]; for(const q in o.entries) for(const tag in o.entries[q]){ const e=o.entries[q][tag]; out.push({quarter:q,tag,status:e.status,note:e.note,checked_at:e.at,checked_by:e.by}); } return out; }
};

const supaStore = {
  live:true,
  async allAssets(){ const {data,error}=await sb.from("assets").select("*").order("tag"); if(error)throw error; return (data||[]).map(fromDb); },
  async putAsset(a){ const {error}=await sb.from("assets").upsert(toDb(a),{onConflict:"tag"}); if(error)throw error; },
  async delAsset(tag){ const {error}=await sb.from("assets").delete().eq("tag",tag); if(error)throw error; },
  async getEntries(q){ const {data,error}=await sb.from("audit_entries").select("*").eq("quarter",q); if(error)throw error;
    const m={}; (data||[]).forEach(r=>{ m[r.tag]={status:r.status,note:r.note||"",at:r.checked_at,by:r.checked_by||""}; }); return m; },
  async putEntry(q,tag,e){ const {error}=await sb.from("audit_entries").upsert(
      {quarter:q,tag,status:e.status,note:e.note,checked_at:e.at,checked_by:e.by},{onConflict:"quarter,tag"}); if(error)throw error; },
  async allEntries(){ const {data,error}=await sb.from("audit_entries").select("*"); if(error)throw error; return data||[]; }
};

let store = localStore;   // resolved by auth state

/* --------------------------------- app state ------------------------------- */
const state = {
  assets:[], quarter:currentQuarter(), entries:{},
  filter:"all", group:"type", q:"", auditMode:false, loading:true,
  user:null, auditor:"", gerardEmail:CFG.REPORT_TO||"gcateau@bspot.com"
};
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

/* --------------------------- audit entry access ---------------------------- */
function entry(tag){ return state.entries[tag] || {status:"pending",note:"",at:null,by:""}; }
async function loadEntries(){ try { state.entries = await store.getEntries(state.quarter); } catch(e){ state.entries={}; toast("Couldn't load audit: "+e.message,true); } }
async function saveEntry(tag,patch){
  const cur=state.entries[tag]||{status:"pending",note:"",at:null,by:""};
  const e=Object.assign({},cur,patch,{at:new Date().toISOString(),by:state.auditor});
  state.entries[tag]=e;
  try { await store.putEntry(state.quarter,tag,e); setSaved("Saved "+new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})); }
  catch(err){ toast("Save failed: "+err.message,true); }
}

/* --------------------------------- icons ----------------------------------- */
const IC={
  apple:'<svg class="dicon" viewBox="0 0 24 24" fill="currentColor"><path d="M16.4 12.6c0-2.2 1.8-3.2 1.9-3.3-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.5 0-2.8.8-3.6 2.2-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.6 2.2 2.7 2.2 1 0 1.4-.7 2.7-.7 1.2 0 1.6.7 2.7.6 1.1 0 1.8-1 2.5-2 .8-1.2 1.1-2.3 1.1-2.4-.1 0-2.5-.9-2.5-3.6zM14.3 6c.6-.7 1-1.7.9-2.7-.8 0-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.6.9.1 1.8-.5 2.5-1.2z"/></svg>',
  windows:'<svg class="dicon" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5.7l7.5-1v7.1H3zM11.5 4.6L21 3.3v9.5h-9.5zM3 12.9h7.5v7L3 18.9zM11.5 12.9H21v9.5l-9.5-1.3z"/></svg>',
  ups:'<svg class="dicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M13 7l-3 5h4l-3 5"/></svg>',
  net:'<svg class="dicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13a10 10 0 0 1 14 0"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 9.5a15 15 0 0 1 20 0"/><circle cx="12" cy="20" r="1"/></svg>'
};
const CHECK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 6"/></svg>';
const FLAG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4h13l-2 4 2 4H5"/></svg>';
const NOTE='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v11l-4 4H4z"/><path d="M16 19v-4h4"/></svg>';
const REASSIGN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 12V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 12v3a3 3 0 0 1-3 3H3"/></svg>';

/* --------------------------------- render ---------------------------------- */
function activeAssets(){ return state.assets.filter(a=>!a.retired); }
function computeStats(){
  const act=activeAssets();
  const laptops=act.filter(a=>a.type==="laptop"), infra=act.filter(a=>a.type==="infra");
  const chips={M2:0,M3:0,M4:0,PC:0}; laptops.forEach(a=>{ chips[a.chip]=(chips[a.chip]||0)+1; });
  let ok=0,bad=0; act.forEach(a=>{ const st=entry(a.tag).status; if(st==="verified")ok++; else if(st==="flag")bad++; });
  return {total:act.length,laptops:laptops.length,infra:infra.length,chips,ok,bad,pend:act.length-ok-bad};
}
function renderStats(){
  const s=computeStats();
  $("#sTotal").textContent=s.total;
  $("#sTotalU").textContent=s.laptops+" laptops · "+s.infra+" infrastructure";
  $("#sLaptops").textContent=s.laptops;
  $("#sLaptopsU").textContent="M2 · "+s.chips.M2+"   M3 · "+s.chips.M3+"   M4 · "+s.chips.M4+(s.chips.PC?"   PC · "+s.chips.PC:"");
  const spark=$("#sparkChips"); spark.innerHTML="";
  const cc={M2:"var(--accent)",M3:"var(--accent-2)",M4:"var(--ok)",PC:"var(--warn)"}; const tot=s.laptops||1;
  ["M2","M3","M4","PC"].forEach(c=>{ if(s.chips[c]){ const i=document.createElement("i"); i.style.background=cc[c]; i.style.width=Math.max(6,(s.chips[c]/tot)*100)+"px"; i.title=c+": "+s.chips[c]; spark.appendChild(i); } });
  $("#pQuarter").textContent=qPretty(state.quarter);
  $("#pDone").textContent=s.ok; $("#pTotal").textContent=s.total; $("#pFlags").textContent=s.bad;
  $("#lgOk").textContent=s.ok; $("#lgBad").textContent=s.bad; $("#lgPend").textContent=s.pend;
  const t=s.total||1; $("#mOk").style.width=(s.ok/t*100)+"%"; $("#mBad").style.width=(s.bad/t*100)+"%";
}
function statusChip(st){
  if(st==="verified") return '<span class="status-chip st-verified">'+CHECK+'Verified</span>';
  if(st==="flag") return '<span class="status-chip st-flag">'+FLAG+'Flagged</span>';
  return '<span class="status-chip st-pending">Not audited</span>';
}
function rowHTML(a){
  const e=entry(a.tag);
  const cls=e.status==="verified"?"is-verified":(e.status==="flag"?"is-flag":"is-pending");
  const icon=IC[a.kind]||IC.net;
  const who=a.type==="infra"
    ? '<div class="name">'+esc(a.assignee||"Office")+'</div><div class="role">Shared office equipment</div>'
    : '<div class="name">'+esc(a.assignee)+'</div><div class="role">'+esc(a.model)+' user</div>'+
      (a.reassignedFrom?'<div class="reassigned">'+REASSIGN+'Reassigned from '+esc(a.reassignedFrom)+'</div>':'');
  const spec=a.type==="infra"?esc(a.variant):esc(a.spec)+" · "+esc(a.chip);
  const noteBadge=(!state.auditMode && e.note)?'<div class="note-badge">'+NOTE+'<span>'+esc(e.note)+'</span></div>':"";
  return '<div class="row '+cls+'" data-tag="'+esc(a.tag)+'">'+
    '<div class="tag" title="Asset tag">'+esc(a.tag)+'</div>'+
    '<div class="who">'+who+'</div>'+
    '<div class="device"><div class="d-main">'+icon+'<span>'+esc(a.model)+'</span></div><div class="d-spec">'+spec+'</div></div>'+
    '<div class="serial"><span class="s-k">Serial / ID</span>'+esc(a.serial)+'</div>'+
    '<div class="row-status">'+statusChip(e.status)+
      '<div class="audit-actions">'+
        '<button class="aud-btn set-ok" data-act="ok" aria-pressed="'+(e.status==="verified")+'" title="Mark verified" aria-label="Mark '+esc(a.tag)+' verified">'+CHECK+'</button>'+
        '<button class="aud-btn set-flag" data-act="flag" aria-pressed="'+(e.status==="flag")+'" title="Flag an issue" aria-label="Flag '+esc(a.tag)+'">'+FLAG+'</button>'+
        '<button class="aud-btn set-note '+(e.note?"has-note":"")+'" data-act="note" title="Add a note" aria-label="Note for '+esc(a.tag)+'">'+NOTE+'</button>'+
        '<button class="aud-btn set-edit" data-act="edit" title="Edit asset" aria-label="Edit '+esc(a.tag)+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>'+
      '</div>'+
    '</div>'+
    '<div class="note-line" data-note-for="'+esc(a.tag)+'"><textarea placeholder="Note — condition, location, or reason for flag…">'+esc(e.note)+'</textarea></div>'+
    noteBadge+
  '</div>';
}
const GROUPS={
  type:{ order:["laptop","infra"], label:{laptop:"Laptops",infra:"Office infrastructure"}, of:a=>a.type },
  chip:{ order:["M2","M3","M4","PC","—"], label:{M2:"Apple M2",M3:"Apple M3",M4:"Apple M4",PC:"Windows PC","—":"Infrastructure"}, of:a=>a.type==="infra"?"—":a.chip },
  status:{ order:["flag","pending","verified"], label:{flag:"Flagged — needs attention",pending:"Not yet audited",verified:"Verified"}, of:a=>entry(a.tag).status }
};
function passFilter(a){
  if(state.filter==="laptop" && a.type!=="laptop") return false;
  if(state.filter==="infra" && a.type!=="infra") return false;
  if(state.filter==="flag" && entry(a.tag).status!=="flag") return false;
  if(state.q){ const hay=(a.tag+" "+a.assignee+" "+a.reassignedFrom+" "+a.model+" "+a.variant+" "+a.spec+" "+a.chip+" "+a.serial).toLowerCase(); if(!hay.includes(state.q.toLowerCase())) return false; }
  return true;
}
function renderRegister(){
  const host=$("#register");
  if(state.loading){ host.innerHTML='<div class="rows">'+Array(6).fill('<div class="skeleton"></div>').join("")+'</div>'; return; }
  const list=activeAssets().filter(passFilter);
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
function refreshRow(tag){
  const a=state.assets.find(x=>x.tag===tag); if(!a)return;
  const old=$('.row[data-tag="'+CSS.escape(tag)+'"]'); if(!old)return;
  const tmp=document.createElement("div"); tmp.innerHTML=rowHTML(a); old.replaceWith(tmp.firstElementChild);
}
function renderAll(){ renderStats(); renderRegister(); }

/* ------------------------------- audit mode -------------------------------- */
function setAuditMode(on){
  // Audit works on whatever register is loaded — sample (logged out) or live (signed in).
  // Structural edits (add/remove assets) still require sign-in; see openAssetModal.
  state.auditMode=on; document.body.classList.toggle("audit-on",on);
  $("#auditBtnLabel").textContent=on?"Auditing "+qPretty(state.quarter)+"…":"Start "+qPretty(state.quarter)+" audit";
  $("#btnAudit").classList.toggle("btn-primary",!on);
  renderRegister();
  if(on && !state.auditor) askAuditor();
}

/* --------------------------------- events ---------------------------------- */
function onRegisterClick(ev){
  const btn=ev.target.closest(".aud-btn"); if(!btn)return;
  const row=btn.closest(".row"); const tag=row.dataset.tag; const act=btn.dataset.act;
  if(act==="edit"){ openAssetModal(state.assets.find(a=>a.tag===tag)); return; }
  const e=entry(tag);
  if(act==="ok"){ const ns=e.status==="verified"?"pending":"verified"; saveEntry(tag,{status:ns}).then(()=>{ refreshRow(tag); renderStats(); }); }
  else if(act==="flag"){ const ns=e.status==="flag"?"pending":"flag"; saveEntry(tag,{status:ns}).then(()=>{ refreshRow(tag); renderStats(); if(ns==="flag"){ const nl=row.querySelector(".note-line"); nl.classList.add("show"); nl.querySelector("textarea").focus(); } }); }
  else if(act==="note"){ const nl=row.querySelector(".note-line"); nl.classList.toggle("show"); if(nl.classList.contains("show")) nl.querySelector("textarea").focus(); }
}
function onRegisterInput(ev){
  const ta=ev.target.closest(".note-line textarea"); if(!ta)return;
  const row=ta.closest(".row"); const tag=row.dataset.tag;
  clearTimeout(ta._t); ta._t=setTimeout(()=>{ saveEntry(tag,{note:ta.value.trim()}).then(()=>{ row.querySelector(".set-note").classList.toggle("has-note",!!ta.value.trim()); }); },450);
}

/* --------------------------------- modals ---------------------------------- */
function openModal(title,bodyHTML,footHTML,narrow){
  $("#modalTitle").textContent=title; $("#modalBody").innerHTML=bodyHTML; $("#modalFoot").innerHTML=footHTML||"";
  $(".modal").classList.toggle("narrow",!!narrow); $("#scrim").classList.add("show");
}
function closeModal(){ $("#scrim").classList.remove("show"); }

function openAuthModal(){
  if(!configured){ openModal("Backend not configured",
    '<p class="hint">This build has no Supabase project set. It’s running on local sample data. Add your <span class="mono">SUPABASE_URL</span> and key in <span class="mono">config.js</span> to enable the shared, logged-in register.</p>',
    '<button class="btn btn-primary" id="mCancel">Got it</button>',true);
    $("#mCancel").onclick=closeModal; return; }
  openModal("Sign in",
    '<p class="hint">Sign in to load and audit the live Mauritius register. Accounts are managed by your Supabase project.</p>'+
    '<div class="field"><label>Email</label><input id="au_email" type="email" autocomplete="username" placeholder="you@bspot.com"></div>'+
    '<div class="field"><label>Password</label><input id="au_pass" type="password" autocomplete="current-password" placeholder="••••••••"></div>',
    '<button class="btn" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSignin">Sign in</button>',true);
  $("#au_email").focus();
  const submit=async()=>{
    const email=$("#au_email").value.trim(), password=$("#au_pass").value;
    if(!email||!password){ toast("Enter your email and password",true); return; }
    $("#mSignin").disabled=true;
    const {error}=await sb.auth.signInWithPassword({email,password});
    $("#mSignin").disabled=false;
    if(error){ toast(error.message,true); return; }
    closeModal(); /* onAuthStateChange handles the rest */
  };
  $("#mSignin").onclick=submit;
  $("#au_pass").addEventListener("keydown",e=>{ if(e.key==="Enter") submit(); });
  $("#mCancel").onclick=closeModal;
}

function askAuditor(){
  openModal("Who's running this audit?",
    '<div class="field"><label>Auditor name</label><input id="inAuditor" placeholder="e.g. Yuvan Ramchurn" value="'+esc(state.auditor)+'"></div>'+
    '<p class="hint">Recorded against each item you verify, and shown on Gerard’s report.</p>',
    '<button class="btn" id="mCancel">Skip</button><button class="btn btn-primary" id="mSave">Save</button>',true);
  $("#inAuditor").focus();
  $("#mSave").onclick=()=>{ state.auditor=$("#inAuditor").value.trim(); localStorage.setItem("mur_auditor",state.auditor); closeModal(); };
  $("#mCancel").onclick=closeModal;
}

function openAssetModal(a){
  if(!store.live){ toast("Sign in to edit the live register",true); openAuthModal(); return; }
  const isNew=!a;
  a=a||{tag:"",assignee:"",reassignedFrom:"",type:"laptop",kind:"apple",model:"",variant:"",spec:"",chip:"M4",serial:"",retired:false};
  openModal(isNew?"Add asset":"Edit "+a.tag,
    '<div class="field-row"><div class="field"><label>Asset tag</label><input id="f_tag" value="'+esc(a.tag)+'" '+(isNew?"":"readonly")+' placeholder="MUR00XX"></div>'+
    '<div class="field"><label>Serial / ID</label><input id="f_serial" value="'+esc(a.serial)+'"></div></div>'+
    '<div class="field-row"><div class="field"><label>Type</label><select id="f_type"><option value="laptop"'+(a.type==="laptop"?" selected":"")+'>Laptop</option><option value="infra"'+(a.type==="infra"?" selected":"")+'>Infrastructure</option></select></div>'+
    '<div class="field"><label>Kind</label><select id="f_kind"><option value="apple"'+(a.kind==="apple"?" selected":"")+'>Apple</option><option value="windows"'+(a.kind==="windows"?" selected":"")+'>Windows</option><option value="ups"'+(a.kind==="ups"?" selected":"")+'>UPS</option><option value="net"'+(a.kind==="net"?" selected":"")+'>Network</option></select></div></div>'+
    '<div class="field"><label>Assignee / location</label><input id="f_assignee" value="'+esc(a.assignee)+'"></div>'+
    '<div class="field"><label>Reassigned from (optional)</label><input id="f_reassigned" value="'+esc(a.reassignedFrom)+'"></div>'+
    '<div class="field-row"><div class="field"><label>Model</label><input id="f_model" value="'+esc(a.model)+'"></div>'+
    '<div class="field"><label>Variant</label><input id="f_variant" value="'+esc(a.variant)+'"></div></div>'+
    '<div class="field-row"><div class="field"><label>Spec</label><input id="f_spec" value="'+esc(a.spec)+'"></div>'+
    '<div class="field"><label>Chip</label><input id="f_chip" value="'+esc(a.chip)+'"></div></div>',
    (isNew?"":'<button class="btn" id="mDelete" style="margin-right:auto;color:var(--bad);border-color:var(--bad-line)">Remove</button>')+
    '<button class="btn" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">'+(isNew?"Add asset":"Save")+'</button>');
  $("#mCancel").onclick=closeModal;
  if(!isNew) $("#mDelete").onclick=async()=>{ if(confirm("Remove "+a.tag+" from the register?")){ try{ await store.delAsset(a.tag); state.assets=state.assets.filter(x=>x.tag!==a.tag); closeModal(); renderAll(); toast(a.tag+" removed"); }catch(e){ toast(e.message,true); } } };
  $("#mSave").onclick=async()=>{
    const tag=$("#f_tag").value.trim().toUpperCase();
    if(!tag){ toast("An asset tag is required",true); return; }
    if(isNew && state.assets.some(x=>x.tag===tag)){ toast("Tag "+tag+" already exists",true); return; }
    const obj={ tag, serial:$("#f_serial").value.trim(), type:$("#f_type").value, kind:$("#f_kind").value,
      assignee:$("#f_assignee").value.trim(), reassignedFrom:$("#f_reassigned").value.trim(),
      model:$("#f_model").value.trim(), variant:$("#f_variant").value.trim(), spec:$("#f_spec").value.trim(),
      chip:$("#f_chip").value.trim()||"—", retired:false };
    try{ await store.putAsset(obj); const i=state.assets.findIndex(x=>x.tag===tag); if(i>=0)state.assets[i]=obj; else state.assets.push(obj);
      closeModal(); renderAll(); toast(isNew?tag+" added":tag+" updated"); }
    catch(e){ toast(e.message,true); }
  };
  $("#f_tag").focus();
}

/* --------------------------------- report ---------------------------------- */
function buildReport(){
  const s=computeStats(); const act=activeAssets();
  const flagged=act.filter(a=>entry(a.tag).status==="flag");
  const pending=act.filter(a=>entry(a.tag).status==="pending");
  const reassigned=act.filter(a=>a.reassignedFrom);
  const L=[];
  L.push("MAURITIUS ASSET REGISTER — QUARTERLY AUDIT");
  L.push(qPretty(state.quarter)+"  ·  "+(CFG.OFFICE||"Ebène office"));
  L.push("Compiled "+new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"})+(state.auditor?"  ·  Auditor: "+state.auditor:""));
  L.push(store.live?"Source: live register (Supabase)":"Source: SAMPLE data (not signed in)");
  L.push("");
  L.push("SUMMARY");
  L.push("  Assets in service ....... "+s.total+"  ("+s.laptops+" laptops, "+s.infra+" infrastructure)");
  L.push("  Verified ................ "+s.ok+" / "+s.total);
  L.push("  Flagged for attention ... "+s.bad);
  L.push("  Not yet audited ......... "+s.pend);
  L.push("");
  if(flagged.length){ L.push("FLAGGED — NEEDS ATTENTION ("+flagged.length+")"); flagged.forEach(a=>{ const e=entry(a.tag); L.push("  "+a.tag+"  "+a.assignee+"  ·  "+a.model+(e.note?"\n      Note: "+e.note:"")); }); L.push(""); }
  if(reassigned.length){ L.push("REASSIGNMENTS TO CONFIRM ("+reassigned.length+")"); reassigned.forEach(a=>{ L.push("  "+a.tag+"  now "+a.assignee+"  (from "+a.reassignedFrom+")"); }); L.push(""); }
  if(pending.length){ L.push("NOT YET AUDITED ("+pending.length+")"); L.push("  "+pending.map(a=>a.tag).join(", ")); L.push(""); }
  L.push("Full line-by-line register attached as CSV.");
  return L.join("\n");
}
function buildCSV(){
  const head=["Asset Tag","Type","Assignee","Reassigned From","Make/Model","Variant","Spec","Chip","Serial/ID","Audit Status","Note","Checked At","Checked By"];
  const rows=activeAssets().map(a=>{ const e=entry(a.tag);
    return [a.tag,a.type,a.assignee,a.reassignedFrom,a.model,a.variant,a.spec,a.chip,a.serial,
      e.status==="verified"?"Verified":(e.status==="flag"?"Flagged":"Not audited"),e.note||"",
      e.at?new Date(e.at).toLocaleString("en-GB"):"",e.by||""]; });
  return [head].concat(rows).map(r=>r.map(c=>{ c=String(c==null?"":c); return /[",\n]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c; }).join(",")).join("\n");
}
function download(filename,data,mime){
  try{ const blob=new Blob([data],{type:mime||"text/plain;charset=utf-8"}); const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast("Downloaded "+filename); }
  catch(e){ toast("Download failed",true); }
}
function openReportModal(){
  const report=buildReport(); const qslug=state.quarter.replace("-","_");
  openModal("Quarterly report — "+qPretty(state.quarter),
    (store.live?"":'<p class="hint">You’re on sample data — this report reflects the demo set. Sign in to report the live register.</p>')+
    '<div class="field"><label>Send to</label><input id="r_to" value="'+esc(state.gerardEmail)+'"></div>'+
    '<div class="report-preview">'+esc(report)+'</div>',
    '<button class="btn" id="r_csv"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>Download CSV</button>'+
    '<button class="btn" id="r_txt">Download report</button>'+
    '<button class="btn btn-primary" id="r_mail"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18v12H3z"/><path d="M3 7l9 6 9-6"/></svg>Email Gerard</button>');
  $("#r_csv").onclick=()=>download("MUR_asset_audit_"+qslug+".csv",buildCSV(),"text/csv;charset=utf-8");
  $("#r_txt").onclick=()=>download("MUR_asset_audit_"+qslug+".txt",buildReport());
  $("#r_mail").onclick=()=>{ state.gerardEmail=$("#r_to").value.trim()||state.gerardEmail; localStorage.setItem("mur_gerard",state.gerardEmail);
    const subj="Mauritius Asset Audit — "+qPretty(state.quarter);
    const body=buildReport()+"\n\n(The full line-by-line register is attached separately as a CSV — use the Download CSV button.)";
    window.location.href="mailto:"+encodeURIComponent(state.gerardEmail)+"?subject="+encodeURIComponent(subj)+"&body="+encodeURIComponent(body); };
}

/* --------------------------------- backup ---------------------------------- */
function openBackupModal(){
  openModal("Backup & restore",
    '<p class="hint">Export a JSON snapshot of the register and every quarter’s audit, or restore one. Handy for archiving a quarter or moving between projects.</p>'+
    '<div class="field"><label>Currently loaded</label><div class="report-preview" id="b_info">Reading…</div></div>',
    '<button class="btn" id="b_import"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V9M7 14l5-5 5 5"/><path d="M5 3h14"/></svg>Import</button>'+
    '<button class="btn btn-primary" id="b_export"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>Export</button>');
  store.allEntries().then(en=>{ $("#b_info").textContent="Mode: "+(store.live?"Live (Supabase)":"Sample (local)")+"\nAssets in service: "+activeAssets().length+"\nAudit records: "+en.length; }).catch(()=>{ $("#b_info").textContent="Assets: "+activeAssets().length; });
  $("#b_export").onclick=async()=>{ const entries=await store.allEntries();
    download("MUR_register_backup_"+currentQuarter().replace("-","_")+".json",JSON.stringify({app:"mur-asset-register",version:2,exportedAt:new Date().toISOString(),live:store.live,assets:state.assets,entries},null,2),"application/json"); };
  $("#b_import").onclick=()=>$("#fileImport").click();
}
async function onImportFile(ev){
  const file=ev.target.files[0]; ev.target.value=""; if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(data.app!=="mur-asset-register"||!Array.isArray(data.assets)) throw new Error("Not a register backup");
    for(const a of data.assets) await store.putAsset(a);
    if(Array.isArray(data.entries)) for(const r of data.entries) await store.putEntry(r.quarter,r.tag,{status:r.status,note:r.note,at:r.checked_at,by:r.checked_by});
    state.assets=await store.allAssets(); await loadEntries(); closeModal(); renderAll(); toast("Restored "+data.assets.length+" assets");
  }catch(e){ toast("Import failed: "+e.message,true); }
}

/* ------------------------------- theme ------------------------------------- */
function applyTheme(t){
  document.documentElement.setAttribute("data-theme",t);
  $("#iconTheme").innerHTML = t==="dark"
    ? '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>'
    : '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
}

/* ------------------------------- auth state -------------------------------- */
function renderAuth(){
  const live=store.live;
  const pill=$("#conn");
  pill.className="conn "+(live?"is-live":"is-sample");
  pill.querySelector(".ctext").textContent = live ? "Live · Supabase" : (configured?"Sample data":"Local demo");
  $("#authBtn").innerHTML = live
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/></svg><span class="lbl">Sign out</span>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg><span class="lbl">Sign in</span>';
  $("#authBtn").title = live ? "Signed in as "+(state.user&&state.user.email||"")+" — sign out" : "Sign in to load the live register";
  const banner=$("#modeBanner");
  if(!live && configured){ banner.style.display="flex"; banner.querySelector(".mb-text").innerHTML="<b>Sample data.</b> You’re viewing an anonymized demo set. Sign in to load and audit the live Mauritius register."; }
  else { banner.style.display="none"; }
}
async function useStore(next){
  store=next; state.loading=true; renderRegister();
  try{ state.assets=await store.allAssets(); }catch(e){ state.assets=[]; toast("Load failed: "+e.message,true); }
  await loadEntries(); state.loading=false; renderAuth(); renderAll();
}
async function onSignedIn(session){
  state.user=session.user;
  if(!state.auditor){ state.auditor = (session.user.user_metadata&&session.user.user_metadata.name) || session.user.email || ""; }
  await useStore(supaStore);
  toast("Signed in — live register loaded");
  subscribeRealtime();
}
async function onSignedOut(){
  state.user=null; state.auditMode=false; document.body.classList.remove("audit-on");
  await useStore(localStore);
}

let rtChannel=null;
function subscribeRealtime(){
  if(!sb || rtChannel) return;
  try{
    rtChannel=sb.channel("mur-live")
      .on("postgres_changes",{event:"*",schema:"public",table:"assets"},async()=>{ state.assets=await store.allAssets(); renderAll(); })
      .on("postgres_changes",{event:"*",schema:"public",table:"audit_entries"},async()=>{ await loadEntries(); renderAll(); })
      .subscribe();
  }catch(e){ /* realtime optional */ }
}

/* --------------------------------- init ------------------------------------ */
async function init(){
  applyTheme(localStorage.getItem("mur_theme") || (matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"));
  state.auditor=localStorage.getItem("mur_auditor")||"";
  state.gerardEmail=localStorage.getItem("mur_gerard")||state.gerardEmail;
  $("#office").textContent=CFG.OFFICE||"Ebène · Regus";

  // quarter selector
  const qs=$("#qSelect"); const ql=recentQuarters(8); if(!ql.includes(state.quarter)) ql.unshift(state.quarter);
  qs.innerHTML=ql.map(q=>'<option value="'+q+'"'+(q===state.quarter?" selected":"")+'>'+qPretty(q)+'</option>').join("");
  $("#qLabel").textContent=qPretty(state.quarter);
  $("#auditBtnLabel").textContent="Start "+qPretty(state.quarter)+" audit";

  // wire events
  $("#register").addEventListener("click",onRegisterClick);
  $("#register").addEventListener("input",onRegisterInput);
  $("#search").addEventListener("input",e=>{ state.q=e.target.value; renderRegister(); });
  $("#filterType").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b)return; state.filter=b.dataset.f; $$("#filterType button").forEach(x=>x.setAttribute("aria-pressed",x===b)); renderRegister(); });
  $("#groupBy").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b)return; state.group=b.dataset.g; $$("#groupBy button").forEach(x=>x.setAttribute("aria-pressed",x===b)); renderRegister(); });
  $("#btnAudit").addEventListener("click",()=>setAuditMode(!state.auditMode));
  $("#btnAuditDone").addEventListener("click",()=>{ setAuditMode(false); toast("Audit paused — progress saved"); });
  $("#btnReport").addEventListener("click",openReportModal);
  $("#btnAdd").addEventListener("click",()=>openAssetModal(null));
  $("#btnBackup").addEventListener("click",openBackupModal);
  $("#fileImport").addEventListener("change",onImportFile);
  $("#authBtn").addEventListener("click",async()=>{ if(store.live){ await sb.auth.signOut(); } else { openAuthModal(); } });
  $("#btnTheme").addEventListener("click",()=>{ const t=document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark"; applyTheme(t); localStorage.setItem("mur_theme",t); });
  qs.addEventListener("change",async e=>{ state.quarter=e.target.value; $("#qLabel").textContent=qPretty(state.quarter); $("#auditBtnLabel").textContent=(state.auditMode?"Auditing ":"Start ")+qPretty(state.quarter)+(state.auditMode?"…":" audit"); await loadEntries(); renderAll(); });
  $("#modalClose").addEventListener("click",closeModal);
  $("#scrim").addEventListener("click",e=>{ if(e.target===$("#scrim")) closeModal(); });
  document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeModal(); });

  // resolve auth → store
  if(configured && sb){
    sb.auth.onAuthStateChange((event,session)=>{ if(session&&session.user){ onSignedIn(session); } else { onSignedOut(); } });
    const {data}=await sb.auth.getSession();
    if(data && data.session){ await onSignedIn(data.session); } else { await useStore(localStore); }
  } else {
    await useStore(localStore);
  }
  setSaved(store.live?"Connected to live register":"Sample data — changes stay on this device");
}
init();
