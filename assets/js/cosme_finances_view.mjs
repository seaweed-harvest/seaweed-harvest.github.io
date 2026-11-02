// Presentation-only transformations. The source ledger and financial amounts remain unchanged.
import {activityGroups,breakdown} from "./cosme_finances_core.mjs?v=3";

const lower=value=>String(value||"").trim().toLowerCase();
const clean=value=>String(value||"").trim();
export function expenseActivity(pkg,line){
  const desc=lower([line.description,line.item_detail].filter(Boolean).join(" "));
  const product=lower(line.original_product);
  const source=lower(pkg.activity);
  const category=lower(line.category);
  // Software is a reporting project of its own, even when bought for a logger.
  if(category==="software"||/fusion 360|github|git hub|codex|tide app.*database/.test(desc))return "Software";
  if(/t\s*\/\s*h sensing|data logger/.test(product)||/sim credit|sim card|cell data logging/.test(desc))return "Data Loggers";
  if(/controller\s*-\s*electronics|solar fan.*wind sensing|data logger/.test(desc))return "Data Loggers";
  if(/mawimbi/.test(product+" "+desc)||source.includes("mawimbi"))return "Mawimbi";
  if(/offshore nursery/.test(product))return "Offshore Nursery";
  if(/aggregation hub/.test(product))return "Aggregation Hub";
  if(/dryer table/.test(product))return "Solar Drying Tables";
  if(/aggregation|sorting table|baler|bailer|power installation assessment/.test(desc))return "Aggregation Hub";
  if(/weld equipment|greenhouse material installation|dry(er)? table.*data collection/.test(desc))return "Solar Drying Tables";
  if(source.includes("offshore nursery"))return "Offshore Nursery";
  if(source.includes("solar drying tables"))return "Solar Drying Tables";
  if(source.includes("aggregation hub"))return "Aggregation Hub";
  if(category==="travel"||/travel\s*\/\s*m-pesa|travel expense|travel -|transit|flight|accommodation/.test(desc))return "Travel";
  return "Project / Other";
}
export function expenseCategory(line,activity){
  const desc=lower([line.description,line.item_detail].filter(Boolean).join(" ")),raw=clean(line.category);
  if(activity==="Travel"||lower(raw)==="travel")return "Travel";
  if(activity==="Software")return "Software & hosting";
  if(activity==="Data Loggers")return /sim credit|sim card|data credit/.test(desc)?"Connectivity":"Electronics & sensing";
  if(/storage/.test(desc))return "Storage & supplies";
  if(/greenhouse material installation|labour|visit to site|assessment/.test(desc))return "Labour & services";
  return raw==="Labour / Service"?"Labour & services":raw||"Other";
}
export function itemDescription(line){
  const detailed=clean(line.display_item||line.item_detail);
  if(detailed)return detailed;
  if(Number(line.amount)<0&&/^(expense|unspecified expense)?$/i.test(clean(line.description)))return "Credit / adjustment";
  const name=clean(line.description)||(Number(line.amount)<0?"Credit / adjustment":"Unspecified expense");
  // Receipt/supplier reference is useful, but never invent a list of components.
  if(/controller\s*-\s*electronics/i.test(name)){
    const supplier=String(line.note||"").match(/Supplier:\s*([^;]+)/i)?.[1]?.trim();
    return supplier?"Electronics purchase · "+supplier:"Controller electronics (item detail not recorded)";
  }
  return name;
}
export function expenseOverview(packages){
  const groups=new Map();
  for(const pkg of packages.filter(p=>p.activity.startsWith("COSME Procurement"))){
    for(const line of pkg.lines||[]){
      const activity=expenseActivity(pkg,line);
      const key=JSON.stringify([activity,pkg.currency,pkg.basis]);
      if(!groups.has(key))groups.set(key,{activity,currency:pkg.currency,basis:pkg.basis,lines:[]});
      groups.get(key).lines.push({...line,source_package_id:pkg.id,
        source_name:pkg.source?.display_name||"",category:expenseCategory(line,activity),
        subcategory:activity,item_detail:itemDescription(line)});
    }
  }
  const order=["Travel","Data Loggers","Software","Solar Drying Tables","Aggregation Hub","Offshore Nursery","Mawimbi","Project / Other"];
  return [...groups].map(([key,{activity,currency,basis,lines}])=>({
    id:"expense:"+key,package_key:"expense:"+key,
    activity:"COSME Procurement — "+activity,version:"Expense register",
    basis,currency,unit_label:null,units_covered:1,
    reconciliation_status:"review",control_total:null,source:{display_name:"COSME procurement claims"},
    lines,summary:breakdown({lines,control_total:null})
  })).sort((a,b)=>order.indexOf(a.activity.replace("COSME Procurement — ",""))-
                 order.indexOf(b.activity.replace("COSME Procurement — ","")));
}
export function projectOverview(packages){
  // The external historic shed BoQ is a reference within drying, not another prototype cost.
  const visible=packages.filter(p=>!p.activity.startsWith("COSME Procurement"))
    .map(p=>({...p,display_activity:p.activity==="Solar Drying Shed & Store"?
      "Solar Drying Tables":p.activity}));
  const map=new Map();
  for(const p of visible){
    const key=p.display_activity;
    if(!map.has(key))map.set(key,[]);
    map.get(key).push({...p,summary:breakdown(p)});
  }
  const order=["Solar Drying Tables","Offshore Nursery","Aggregation Hub","Mawimbi"];
  return [...map].map(([name,entries])=>{
    const priority=p=>name==="Solar Drying Tables"?
      (p.package_key==="v13-plan-10"?0:p.activity==="Solar Drying Shed & Store"?99:20):
      name==="Offshore Nursery"?(p.package_key==="nursery-future-4-rafts"?0:20):
      name==="Aggregation Hub"?(p.package_key==="august-2026-consultant-proposal"?0:20):20;
    entries.sort((a,b)=>priority(a)-priority(b)||String(a.version).localeCompare(String(b.version)));
    return {name,entries};
  }).sort((a,b)=>(order.indexOf(a.name)<0?99:order.indexOf(a.name))-
                  (order.indexOf(b.name)<0?99:order.indexOf(b.name)));
}
export function reportMetadata(pkg){
  try { return pkg?.report || JSON.parse(pkg?.note || "{}").report || {}; } catch { return {}; }
}
export function referenceFor(group){
  const {name,entries}=group;
  if(name==="Solar Drying Tables"){
    const p=entries.find(x=>x.package_key==="v13-plan-10");
    return {amount:p?"KES "+Math.round(Number(p.control_total)/Number(p.units_covered||1)).toLocaleString("en-US")+" / table":"—",
      note:"V1.3 PLAN · actual project cost"};
  }
  if(name==="Offshore Nursery"){
    const p=entries.find(x=>x.package_key==="nursery-future-4-rafts");
    return {amount:p?"KES "+Math.round(Number(p.control_total)/Number(p.units_covered||1)).toLocaleString("en-US")+" / raft":"KES 270,467 / raft",
      note:"Future four-raft budget · partial estimate"};
  }
  if(name==="Aggregation Hub"){
    const p=entries.find(x=>x.package_key==="august-2026-consultant-proposal");
    return {amount:p?"KES "+Number(p.control_total).toLocaleString("en-US"):"—",note:"Eng. Tom · August proposal"};
  }
  if(name==="Mawimbi"){
    const budget=entries.map(reportMetadata).find(r=>Number.isFinite(r.budget_kes));
    return budget?{amount:"KES "+budget.budget_kes.toLocaleString("en-US"),
      note:"Budget · CAD "+budget.budget_cad.toLocaleString("en-US")}:{amount:"—",note:"Budget"};
  }
  return {amount:"",note:""};
}

// Component detail is an alternate view of paid costs, never an extra ledger.
export function itemisationFor(pkg){
 const detail=reportMetadata(pkg).itemisation;
 if(!detail||!Array.isArray(detail.items)||!detail.items.length)return null;
 const items=detail.items;
 if(items.some(l=>typeof l.description!=="string"||!l.description.trim()||
   typeof l.amount!=="number"||!Number.isFinite(l.amount)||l.amount<0))return null;
 const cents=n=>Math.round(n*100);
 const total=items.reduce((n,l)=>n+cents(l.amount),0);
 if(!pkg.summary||total!==cents(pkg.summary.total))return null;
 return detail;
}
