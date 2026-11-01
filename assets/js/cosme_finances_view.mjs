// Presentation-only transformations. The source ledger and financial amounts remain unchanged.
import {activityGroups,breakdown} from "./cosme_finances_core.mjs?v=3";

const lower=value=>String(value||"").trim().toLowerCase();
const clean=value=>String(value||"").trim();
export function expenseActivity(pkg,line){
  const desc=lower(line.description);
  const source=lower(pkg.activity);
  const category=lower(line.category);
  if(category==="travel"||/travel\s*\/\s*m-pesa|travel expense|travel -|transit|flight|accommodation/.test(desc))return "Travel";
  if(/controller\s*-\s*electronics|solar fan.*wind sensing|data logger/.test(desc))return "Data Loggers";
  if(/aggregation|sorting table|baler|bailer|power installation assessment/.test(desc))return "Aggregation Hub";
  if(/weld equipment|greenhouse material installation|dry(er)? table.*data collection/.test(desc))return "Solar Drying Tables";
  if(source.includes("offshore nursery"))return "Offshore Nursery";
  if(source.includes("solar drying tables"))return "Solar Drying Tables";
  if(source.includes("aggregation hub"))return "Aggregation Hub";
  return "Project / Other";
}
export function expenseCategory(line,activity){
  const desc=lower(line.description),raw=clean(line.category);
  if(activity==="Travel")return "Travel";
  if(activity==="Data Loggers")return /sim credit|sim card|data credit/.test(desc)?"Connectivity":"Electronics & sensing";
  if(/storage/.test(desc))return "Storage & supplies";
  if(/greenhouse material installation|labour|visit to site|assessment/.test(desc))return "Labour & services";
  return raw==="Labour / Service"?"Labour & services":raw||"Other";
}
export function itemDescription(line){
  const detailed=clean(line.display_item||line.item_detail);
  if(detailed)return detailed;
  const name=clean(line.description)||"Unspecified expense";
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
      if(!groups.has(activity))groups.set(activity,[]);
      groups.get(activity).push({...line,category:expenseCategory(line,activity),
        subcategory:activity,item_detail:itemDescription(line)});
    }
  }
  const order=["Travel","Data Loggers","Solar Drying Tables","Aggregation Hub","Offshore Nursery","Project / Other"];
  return [...groups].map(([activity,lines])=>({
    id:"expense:"+activity,package_key:"expense:"+activity,
    activity:"COSME Procurement — "+activity,version:"Expense register",
    basis:"paid",currency:"CAD",unit_label:null,units_covered:1,
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
