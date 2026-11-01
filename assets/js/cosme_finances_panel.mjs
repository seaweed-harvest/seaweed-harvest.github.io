import {BASIS,money,amountOrNull,normalizeFinanceData,activityGroups,exportFinanceCsv} from "./cosme_finances_core.mjs?v=1";

// Read-only project reference: separate estimates/quotes/invoices from expense claims.
const make=(tag,cls="",value)=>{
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(value!==undefined)el.textContent=String(value);
  return el;
};
const add=(parent,tag,cls="",value)=>{const el=make(tag,cls,value);parent.append(el);return el;};
const costPackages=entries=>entries.filter(p=>!p.activity.startsWith("COSME Procurement"));
const expensePackages=entries=>entries.filter(p=>p.activity.startsWith("COSME Procurement"));
function stage(p){
  const v=p.version||"Unversioned";
  if(p.activity==="Solar Drying Tables"){
    if(v==="V1.1")return "V1.1 · Shangani as-built BOM";
    if(v.includes("Pre-build"))return "V1.2 · Pre-build estimate";
    if(v.includes("Funzi"))return "V1.2 · Funzi as-built BOM";
    if(v.includes("Design draft"))return "V1.3 · Pre-build estimate";
    if(v==="V1.3")return "V1.3 · PLAN production (actual)";
  }
  if(p.activity==="Offshore Nursery"){
    if(v.includes("Rough")||v.includes("Design"))return "V1.2 · Rough design (materials)";
    if(v.includes("LM-C"))return "V1.3 · Living Machines (Cascadia)";
    if(v.includes("LM-P"))return "V1.3 · Living Machines (PLAN)";
  }
  return v;
}
function dateOf(p){
  // Invoice dates in Offshore Nursery Close Out BoQ / BoQ detail, rows 43–44.
  // Keep source month-only fallback for other records without a dated invoice.
  if(p.activity==="Offshore Nursery" && (p.package_key==="LM-C"||p.package_key==="LM-P"))
    return "2026-07-28";
  if(p.source?.source_date)return p.source.source_date;
  const rows=(p.lines||[]).map(l=>l.entry_date).filter(Boolean);
  if(rows.length){
    rows.sort();
    return rows[0]===rows[rows.length-1]?rows[0]:rows[0]+" – "+rows[rows.length-1];
  }
  if(p.source?.display_name==="Offshore nursery closeout BoQ")return "Oct 2026*";
  if(p.source?.display_name?.includes("Jan 2026"))return "Jan 2026*";
  if(p.source?.display_name?.includes("July 2026"))return "Jul 2026*";
  return "Date not recorded";
}
function totalOf(p){
  // Project owner chose the itemised V1.2 pre-build estimate as the reference.
  // Preserve the original KES 162,970 source control separately as evidence.
  if(p.package_key==="v12-design" && p.summary.included>0)return p.summary.total;
  return p.summary.control!==null && !p.summary.reconciled?p.summary.control:p.summary.total;
}
function costOf(p){
  if(!p.summary.included && p.summary.control===null)return "Unpriced";
  return money(totalOf(p)/Number(p.units_covered||1),p.currency);
}
function reportStatus(p){
  if(p.package_key==="v13-plan-10")return "Owner confirmed";
  if(p.package_key==="v12-design")return "Estimate";
  if(p.package_key==="existing-shed-store-reference")return "BoQ reference";
  if(p.reconciliation_status!=="verified")return "Review";
  return "Source checked";
}
function effectiveBasis(p){
  // Owner confirms the project cost, not a bank payment or invoice date.
  return p.package_key==="v13-plan-10"?"actual":p.basis;
}
function basisLabel(p){
  if(effectiveBasis(p)==="actual")return "Actual (owner)";
  return p.basis==="paid"?"Recorded expense":BASIS[p.basis];
}
function sourceLineTable(lines,p){
  const wrap=make("div","finance-line-scroll");
  const table=make("table","finance-line-table");
  const head=add(table,"thead");
  const tr=add(head,"tr");
  for(const name of ["Part / item","Date","Qty","Rate","Amount","Source"])add(tr,"th","",name);
  const body=add(table,"tbody");
  for(const line of lines){
    const row=add(body,"tr");
    add(row,"td","finance-description",line.description||"Unspecified item");
    add(row,"td","finance-date",line.entry_date||"—");
    add(row,"td","finance-qty",line.quantity===null||line.quantity===undefined?"—":line.quantity+" "+(line.unit||""));
    add(row,"td","finance-money",line.unit_rate===null||line.unit_rate===undefined?"—":money(line.unit_rate,line.rate_currency||p.currency));
    add(row,"td","finance-money",money(line.amount,p.currency));
    const src=add(row,"td","finance-source-row",line.source_row||"—");
    if(line.funding_org)add(src,"small","",line.funding_org);
    if(line.note)src.title=String(line.note);
  }
  wrap.append(table);return wrap;
}
function costSections(p){
  const box=make("div","finance-detail-body");
  const unitCount=Number(p.units_covered||1);
  const status=add(box,"p","finance-detail-context");
  status.textContent="Source: "+(p.source?.display_name||"Unrecorded")+" · "+basisLabel(p)+
    " · "+(p.funding_scope||"Funding not recorded")+
    (unitCount>1?" · "+unitCount+" "+(p.unit_label||"units"):"");
  if(p.package_key==="v12-design"){
    add(box,"p","finance-detail-context","Reference uses the itemised "+money(totalOf(p),p.currency)+
      " estimate; the original worksheet summary says "+money(p.summary.control,p.currency)+".");
  } else if(p.summary.control!==null && !p.summary.reconciled){
    const diff=Math.abs(p.summary.difference||0);
    add(box,"p","finance-detail-flag",
      "Source total "+money(p.summary.control,p.currency)+
      "; itemised total differs by "+money(diff,p.currency)+".");
  }
  if(p.package_key==="v13-plan-10")
    add(box,"p","finance-detail-context","Actual project cost confirmed by the project owner; original supporting document is a PLAN supplier quotation, not a payment receipt.");
  if(p.reconciliation_status!=="verified" && p.package_key!=="v12-design" && (p.summary.control===null || p.summary.reconciled))
    add(box,"p","finance-detail-flag","Some source details need checking; cost is indicative, not confirmed spend.");
  if(unitCount>1)
    add(box,"p","finance-detail-context","Full "+unitCount+"-"+(p.unit_label||"unit")+" order: "+money(totalOf(p),p.currency)+". Per-unit equivalent shown in register.");
  for(const cat of p.summary.categories){
    const detail=add(box,"details","finance-category");
    detail.dataset.financeKey="cat:"+p.id+":"+cat.name;
    const sum=add(detail,"summary","finance-category-line");
    add(sum,"span","",cat.name);
    add(sum,"strong","finance-money",money(cat.amount,p.currency));
    for(const group of cat.groups){
      const sub=add(detail,"details","finance-subcategory");
      sub.dataset.financeKey="sub:"+p.id+":"+cat.name+":"+group.name;
      const subSum=add(sub,"summary","finance-subcategory-line");
      add(subSum,"span","",group.name);
      add(subSum,"strong","finance-money",money(group.amount,p.currency));
      sub.append(sourceLineTable(group.lines,p));
    }
  }
  const review=(p.lines||[]).filter(l=>l.included_in_total!==false&&(l.reconciliation_status!=="verified"||amountOrNull(l.amount)===null));
  if(review.length){
    const d=add(box,"details","finance-category");
    d.dataset.financeKey="review:"+p.id;
    add(d,"summary","finance-category-line",review.length+" unpriced or unchecked source item(s)");
    d.append(sourceLineTable(review,p));
  }
  const excluded=(p.lines||[]).filter(l=>l.included_in_total===false);
  if(excluded.length){
    const d=add(box,"details","finance-category");
    d.dataset.financeKey="excluded:"+p.id;
    add(d,"summary","finance-category-line",excluded.length+" source items excluded from totals");
    d.append(sourceLineTable(excluded,p));
  }
  if(!p.summary.categories.length&&!review.length&&!excluded.length)add(box,"p","finance-detail-context","No itemised price details.");
  if(typeof p.source?.source_url==="string"&&/^https:\/\//.test(p.source.source_url)){
    const link=add(box,"a","finance-source-link","Open source");link.href=p.source.source_url;link.target="_blank";link.rel="noopener noreferrer";
  }
  return box;
}
function expenseSections(p){
  const box=make("div","finance-detail-body");
  add(box,"p","finance-detail-context","Source: "+(p.source?.display_name||"Expense register")+" · Recorded expense claims in "+p.currency+". This is not an audited paid ledger.");
  for(const cat of p.summary.categories){
    const d=add(box,"details","finance-category");
    d.dataset.financeKey="expense-cat:"+p.id+":"+cat.name;
    const summary=add(d,"summary","finance-category-line");
    add(summary,"span","",cat.name);
    add(summary,"strong","finance-money",money(cat.amount,p.currency));
    const lines=cat.groups.flatMap(g=>g.lines);
    d.append(sourceLineTable(lines,p));
  }
  return box;
}
const columns=["Version / stage","Date","Basis","Per unit","Package total","Status"];
function tableHeader(root){
  const h=add(root,"div","finance-table-header");
  for(const col of columns)add(h,"span","",col);
}
function line(root,p,expenses){
  const d=add(root,"details","finance-register-item");
  d.dataset.financeKey="pkg:"+p.id;
  const s=add(d,"summary","finance-row");
  const title=add(s,"span","finance-stage",expenses?p.activity.replace(/^COSME Procurement — /,""):stage(p));
  title.title=(p.source?.display_name||"");
  add(s,"span","finance-date",dateOf(p));
  add(s,"span","finance-basis",basisLabel(p));
  const unit=String(p.unit_label||"").replace(/s$/,"");
  const hasComparableUnit=/^(table|raft)$/.test(unit);
  add(s,"strong","finance-money",expenses||!hasComparableUnit?"—":costOf(p)+" / "+unit);
  add(s,"strong","finance-money",money(totalOf(p),p.currency));
  add(s,"span","finance-row-status"+(p.reconciliation_status==="verified"?"":" finance-needs-review"),reportStatus(p));
  d.append(expenses?expenseSections(p):costSections(p));
}
export function createCosmeFinancesPanel(authClient,root){
  let entries=[],epoch=0,mode="costs",activity="all",basis="all",fingerprint=null,hasLoaded=false;
  let refreshPromise=null, lastError="";
  const expanded=new Map();
  function snapshot(){
    root.querySelectorAll("details[data-finance-key]").forEach(d=>expanded.set(d.dataset.financeKey,d.open));
  }
  function restore(){
    root.querySelectorAll("details[data-finance-key]").forEach(d=>{if(expanded.has(d.dataset.financeKey))d.open=expanded.get(d.dataset.financeKey)});
  }
  function clear(){
    epoch++;entries=[];fingerprint=null;hasLoaded=false;lastError="";refreshPromise=null;expanded.clear();
    root.replaceChildren();
  }
  function redraw(){
    snapshot();
    root.replaceChildren();
    const titleRow=add(root,"div","finance-top");
    add(titleRow,"h3","","COSME finances");
    const refresh=add(titleRow,"button","metrics-button","Refresh");
    refresh.type="button";refresh.addEventListener("click",()=>load({force:true}));
    const nav=add(root,"div","finance-view-tabs");
    for(const [value,label] of [["costs","Project costs & estimates"],["expenses","Expense register"]]){
      const button=add(nav,"button","metrics-button"+(value===mode?" selected":""),label);
      button.type="button";button.setAttribute("aria-pressed",String(mode===value));
      button.addEventListener("click",()=>{mode=value;activity="all";basis="all";redraw()});
    }
    const isExpense=mode==="expenses";
    const pool=isExpense?expensePackages(entries):costPackages(entries);
    const controls=add(root,"div","finance-filters");
    const selector=add(controls,"select","finance-select");
    selector.setAttribute("aria-label","Filter finance activity");
    let options=[["all","All activities"],...[...new Set(pool.map(p=>p.activity))].sort().map(x=>[x,x.replace(/^COSME Procurement — /,"")])];
    for(const [key,label] of options){const o=add(selector,"option","",label);o.value=key}
    if(!options.some(o=>o[0]===activity))activity="all";
    selector.value=activity;selector.addEventListener("change",()=>{activity=selector.value;redraw()});
    if(!isExpense){
      const filter=add(controls,"select","finance-select");
      filter.setAttribute("aria-label","Filter cost basis");
      for(const [key,label] of [["all","All cost bases"],["actual","Actual (owner-confirmed)"],...Object.entries(BASIS)]){
        const opt=add(filter,"option","",label);opt.value=key;
      }
      filter.value=basis;filter.addEventListener("change",()=>{basis=filter.value;redraw()});
    }
    add(root,"p","finance-intro",isExpense?
      "Expense claims grouped by activity and category. CAD amounts are kept separate from KES project budgets.":
      "One row per project version or source; estimates, quotes and invoices are distinct. Open any row for the parts breakdown.");
    if(lastError)add(root,"p","finance-detail-flag","Update unavailable; showing last loaded costs. "+lastError);
    const selected=pool.filter(p=>(activity==="all"||p.activity===activity)&&(isExpense||basis==="all"||effectiveBasis(p)===basis));
    if(!selected.length){add(root,"p","finance-empty",hasLoaded?"No matching cost records.":"Loading finance records…");return}
    const list=add(root,"div","finance-register");
    tableHeader(list);
    const groups=activityGroups(selected);
    const stageOrder={
      "v11-asbuilt":10,"v12-design":20,"v12-funzi-asbuilt":30,
      "v13-design":40,"v13-plan-10":50,
      "nursery-v12-rough-materials":10,"LM-C":20,"LM-P":21
    };
    for(const group of groups){
      if(!isExpense && group.name==="Solar Drying Tables"){
        group.entries.sort((a,b)=>(stageOrder[a.package_key]??99)-(stageOrder[b.package_key]??99));
      } else if(!isExpense && group.name==="Offshore Nursery"){
        group.entries.sort((a,b)=>(stageOrder[a.package_key]??99)-(stageOrder[b.package_key]??99));
      } else if(!isExpense && group.name==="Aggregation Hub"){
        group.entries.sort((a,b)=>String(a.source?.source_date||a.version).localeCompare(String(b.source?.source_date||b.version)));
      }
      if(!isExpense){
        add(list,"div","finance-section-title",group.name);
      }
      for(const p of group.entries)line(list,p,isExpense);
    }
    if(!isExpense) add(root,"p","finance-footnote","* Month taken from source file name; exact transaction date was not recorded. Unit costs use source quantities, not payment verification.");
    const exportBtn=add(root,"button","metrics-button finance-export","Export source lines CSV");
    exportBtn.type="button";exportBtn.addEventListener("click",()=>{
      const csv=exportFinanceCsv(selected);
      const url=URL.createObjectURL(new Blob(["\ufeff",csv],{type:"text/csv;charset=utf-8"}));
      const a=document.createElement("a");a.href=url;a.download=isExpense?"cosme-expenses.csv":"cosme-project-costs.csv";
      document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);
    });
    restore();
  }
  async function load({force=false}={}){
    if(refreshPromise)return refreshPromise;
    const request=++epoch;
    if(!hasLoaded)root.replaceChildren(make("p","finance-intro","Loading finance records…"));
    refreshPromise=(async()=>{
      try {
        const {data,error}=await authClient.rpc("cosme_finance_read");
        if(error)throw error;
        if(request!==epoch)return;
        const next=JSON.stringify(data);
        lastError="";
        if(!hasLoaded||next!==fingerprint||force){
          entries=normalizeFinanceData(data);fingerprint=next;hasLoaded=true;redraw();
        }
      } catch(e){
        if(request!==epoch)return;
        lastError=e?.message||"Finance data could not be refreshed";
        if(hasLoaded)redraw();
        else{root.replaceChildren(make("p","finance-detail-flag",lastError))}
      }
    })();
    try{await refreshPromise}finally{refreshPromise=null}
  }
  return {load,clear};
}
