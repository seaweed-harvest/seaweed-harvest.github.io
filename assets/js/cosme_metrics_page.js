import { authClient, currentSession } from "./auth_client.js?v=25";
import { normalizeReleaseItems, selectMetrics, exportSelectedCsv, parseReleaseVersion } from "./cosme_metrics_core.mjs";

// All protected values arrive through the dedicated server-side COSME grant gate.
// No original workbook content, release payload or user grant is cached in browser storage.
const el = (id) => document.getElementById(id);
const ACTIVITY_ORDER = ["Solar Drying Tables", "Offshore Nursery", "Aggregation Hub", "Mawimbi"];
let all = [], current = null, visible = [], lastFocus = null, access = null;

function setStatus(message, error=false, show=true) {
  const node=el("status");node.textContent=message;node.classList.toggle("error",error);node.hidden=!show;
}
function clearPrivateState() {
  all=[];visible=[];current=null;access=null;
  el("rows").replaceChildren();el("activityCards").replaceChildren();
  el("app").hidden=true;el("accessRole").textContent="Access unavailable";
  el("releaseCaption").textContent="";el("veil").classList.remove("open");
}
async function requireMetrics() {
  if(!navigator.onLine) throw new Error("An internet connection is required to access private project metrics.");
  const session=await currentSession();
  if(!session) {
    window.location.replace("./login.html?return=cosme_metrics.html");
    return null;
  }
  const {data,error}=await authClient.rpc("cosme_metrics_my_access");
  if(error) throw error;
  if(!data?.can_view) throw new Error("This account has not been granted COSME Project Metrics access.");
  return data;
}
async function loadReleases() {
  const {data,error}=await authClient.rpc("cosme_metrics_list_releases");
  if(error) throw error;
  const versions=Array.isArray(data)?data:[];const select=el("version");select.replaceChildren();
  versions.forEach(x=>{const option=document.createElement("option");option.value=x.major+"."+x.minor;option.textContent=x.version+" — "+(x.purpose||"Published");select.append(option);});
}
async function loadRelease(version=null) {
  const params=version?{p_major:version[0],p_minor:version[1]}:{};
  const {data,error}=await authClient.rpc("cosme_metrics_get_release",params);
  if(error) throw error;
  current=data;
  if(data?.status!=="published") {
    all=[];setStatus("No COSME register has been published for this account yet.",false,true);
    el("releaseCaption").textContent="Not yet published";
    render();return;
  }
  all=normalizeReleaseItems(data.items);
  el("releaseCaption").textContent=data.version+" · published "+(data.published_at?new Date(data.published_at).toLocaleDateString():"");
  el("historyInfo").textContent="Purpose: "+(data.purpose||"Unspecified")+" · Reporting cut-off: "+(data.reporting_cutoff||"not specified")+". Frozen metrics: "+all.length+".";
  el("version").value=data.major+"."+data.minor;
  setStatus("",false,false);
  render();
}
function tab(name) {
  document.querySelectorAll(".tab").forEach(button=>button.setAttribute("aria-selected",String(button.dataset.tab===name)));
  for(const view of ["overview","register","history"]) el(view).hidden=view!==name;
  if(name==="register")renderRows();
}
function add(parent,tag,value,css="") {
  const n=document.createElement(tag);n.textContent=String(value??"");if(css)n.className=css;parent.append(n);return n;
}
function render() {
  const previous=el("activity").value;
  const activity=el("activity");activity.replaceChildren();const any=document.createElement("option");any.value="";any.textContent="All activities";activity.append(any);
  const activities=[...ACTIVITY_ORDER,...new Set(all.map(x=>x.activity).filter(a=>!ACTIVITY_ORDER.includes(a)))];
  activities.forEach(a=>{const o=document.createElement("option");o.value=a;o.textContent=a;activity.append(o);});
  activity.value=activities.includes(previous)?previous:"";
  const verification=el("verification");const prevVerification=verification.value;
  verification.replaceChildren();const opt=document.createElement("option");opt.value="";opt.textContent="All states";verification.append(opt);
  [...new Set(all.map(x=>x.verification))].sort().forEach(x=>{const o=document.createElement("option");o.value=x;o.textContent=x;verification.append(o);});verification.value=prevVerification;
  const cards=el("activityCards");cards.replaceChildren();
  activities.forEach(a=>{const rows=all.filter(x=>x.activity===a);const button=document.createElement("button");button.className="card activity-card";
    add(button,"strong",a);add(button,"span",rows.length+" metrics","big");
    add(button,"span",rows.filter(x=>x.featured).length+" featured","muted");
    button.addEventListener("click",()=>{activity.value=a;tab("register");renderRows();});cards.append(button);
  });
  renderRows();
}
function renderRows() {
  const query=el("search").value.toLocaleLowerCase().trim(), activity=el("activity").value, verification=el("verification").value, featured=el("featured").checked;
  visible=selectMetrics(all,{query,activity,verification,featured,sort:el("sort").value});
  const tbody=el("rows");tbody.replaceChildren();
  for(const m of visible) {
    const tr=document.createElement("tr"),td=document.createElement("td"),button=document.createElement("button");
    button.className="metric-open";button.textContent=m.title;button.addEventListener("click",()=>openMetric(m,button));td.append(button);add(td,"div",m.id,"muted");tr.append(td);
    [m.activity,m.theme,m.value,m.unit,m.verification].forEach((item,index)=>{const cell=document.createElement("td");add(cell,"span",item,index===4?"state":"");tr.append(cell);});
    tbody.append(tr);
  }
  el("count").textContent=visible.length+" of "+all.length+" published metrics · "+(current?.version||"No release");
  el("empty").hidden=visible.length>0;
}
function openMetric(m,button) {
  lastFocus=button;el("metricTitle").textContent=m.title;const body=el("detail");body.replaceChildren();
  const fields=[["ID",m.id],["Activity",m.activity],["Theme",m.theme],["Value",m.value],["Unit / basis",m.unit],["Claim basis",m.basis],["Evidence state",m.verification],["Original workbook evidence",m.originalEvidence],["Value availability",m.valueState],["Source mode",m.sourceMode],["Source worksheet",m.sourceSheet],["Source row",m.sourceRow],["As-of",m.asOf],["Source",m.source],["Notes",m.note],["Publication",current?.version||"Not published"]];
  fields.forEach(([label,value])=>{add(body,"dt",label);add(body,"dd",value);});
  el("veil").classList.add("open");el("close").focus();
}
function closeMetric() {el("veil").classList.remove("open");lastFocus?.focus();}
function exportCsv() {
  const text=exportSelectedCsv(visible,current?.version||"");
  const blob=new Blob([text],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download="COSME_Metrics_"+(current?.version||"unpublished")+"_selected.csv";link.click();URL.revokeObjectURL(url);
}
async function reloadAndRecheck() {
  const next=await requireMetrics();if(!next)return;
  access=next;el("accessRole").textContent="Metrics "+next.role;
  await loadReleases();await loadRelease();el("app").hidden=false;el("signOut").hidden=false;
}
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>tab(b.dataset.tab)));
for(const id of ["search","activity","verification","sort","featured"])el(id).addEventListener("input",renderRows);
el("openRegister").addEventListener("click",()=>tab("register"));
el("reset").addEventListener("click",()=>{el("search").value="";el("activity").value="";el("verification").value="";el("featured").checked=false;el("sort").value="id";renderRows();});
el("exportCsv").addEventListener("click",exportCsv);
el("selectVersion").addEventListener("click",async()=>{const version=parseReleaseVersion(el("version").value);if(!version){setStatus("No published release is available to select.",true);return;}try{await loadRelease(version);}catch(e){setStatus(e.message,true);}});
el("close").addEventListener("click",closeMetric);el("veil").addEventListener("click",e=>{if(e.target===el("veil"))closeMetric();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&el("veil").classList.contains("open"))closeMetric();});
el("signOut").addEventListener("click",async()=>{clearPrivateState();await authClient.auth.signOut({scope:"local"});window.location.replace("./login.html");});
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&access){reloadAndRecheck().catch(e=>{clearPrivateState();setStatus(e.message,true);});}});
authClient.auth.onAuthStateChange(event=>{if(event==="SIGNED_OUT"){clearPrivateState();setStatus("Signed out.",true);}});
reloadAndRecheck().catch(e=>{clearPrivateState();setStatus(e.message||"Metrics could not be loaded.",true);});
