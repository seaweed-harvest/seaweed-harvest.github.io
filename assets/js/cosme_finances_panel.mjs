import {BASIS,money,amountOrNull,normalizeFinanceData,activityGroups,exportFinanceCsv,effectiveFinanceBasis} from "./cosme_finances_core.mjs?v=3";
import {expenseOverview,projectOverview,referenceFor,itemDescription,reportMetadata,itemisationFor} from "./cosme_finances_view.mjs?v=3";

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
  if(p.activity==="Solar Drying Shed & Store")
    return "Existing drying shed & store · Mwazaro";
  if(p.activity==="Offshore Nursery"){
    if(v.includes("Rough")||v.includes("Design"))return "V1.2 · Rough design (materials)";
    if(v.includes("LM-C"))return "V1.3 · Living Machines (Cascadia)";
    if(v.includes("LM-P"))return "V1.3 · Living Machines (PLAN)";
  }
  return v;
}
function dateOf(p){
  const report=reportMetadata(p);
  if(report.date)return report.date;
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
  if(Number.isFinite(reportMetadata(p).display_total))return reportMetadata(p).display_total;
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
  if(reportMetadata(p).status)return reportMetadata(p).status;
  if(p.package_key==="v13-plan-10")return "Owner confirmed";
  if(p.package_key==="v12-design")return "Estimate";
  if(p.package_key==="legacy-mwazaro-shed-store" || p.package_key==="existing-shed-store-reference")
    return "BoQ reference";
  if(p.basis==="estimated")return "Estimate";
  if(p.basis==="paid")return "Paid";
  return "Source checked";
}
function basisLabel(p){
  if(p.activity.startsWith("COSME Procurement"))return "Expense";
  if(effectiveFinanceBasis(p)==="actual")return "Actual";
  return BASIS[p.basis];
}
function sourceLineTable(lines,p,showDates=false){
  const wrap=make("div","finance-line-scroll");
  const table=make("table","finance-line-table");
  const head=add(table,"thead");
  const tr=add(head,"tr");
  for(const name of ["Part / item",...(showDates?["Date"]:[]),"Qty","Rate","Amount","Source"])add(tr,"th","",name);
  const body=add(table,"tbody");
  for(const line of lines){
    const row=add(body,"tr");
    add(row,"td","finance-description",line.item_detail||itemDescription(line)||"Unspecified item");
    if(showDates)add(row,"td","finance-date",line.entry_date||"—");
    add(row,"td","finance-qty",line.quantity===null||line.quantity===undefined?"—":line.quantity+" "+(line.unit||""));
    add(row,"td","finance-money",line.unit_rate===null||line.unit_rate===undefined?"—":money(line.unit_rate,line.rate_currency||p.currency));
    add(row,"td","finance-money",line.amount===null||line.amount===undefined?"—":money(line.amount,p.currency));
    const src=add(row,"td","finance-source-row",line.source_row||"—");
    if(line.source_url&&/^https:\/\//.test(line.source_url)){
      const link=add(src,"a","","Open");link.href=line.source_url;link.target="_blank";link.rel="noopener noreferrer";
    }
    if(line.funding_org)add(src,"small","",line.funding_org);
    if(line.note)src.title=String(line.note);
  }
  wrap.append(table);
  // Phone-width drilldown keeps a readable two-column price breakdown; the
  // full evidence table remains available on desktop and in source export.
  const compact=add(wrap,"div","finance-mobile-lines");
  for(const line of lines){
    const item=add(compact,"div","finance-mobile-line");
    const details=add(item,"div","finance-mobile-item");
    add(details,"span","finance-mobile-item-name",line.item_detail||itemDescription(line)||"Unspecified item");
    const info=[showDates?line.entry_date:null,
      line.quantity==null?null:String(line.quantity)+" "+(line.unit||""),
      line.source_row||null].filter(Boolean).join(" · ");
    if(info)add(details,"small","finance-mobile-item-meta",info);
    add(item,"strong","finance-mobile-item-cost",
      amountOrNull(line.amount)===null?"—":money(line.amount,p.currency));
    if(line.source_url&&/^https:\/\//.test(line.source_url)){
      const link=add(details,"a","finance-mobile-source","Source");
      link.href=line.source_url;link.target="_blank";link.rel="noopener noreferrer";
    }
  }
  return wrap;
}
function costSections(p){
  const box=make("div","finance-detail-body");
  const unitCount=Number(p.units_covered||1);
  const status=add(box,"p","finance-detail-context");
  status.textContent=(p.source?.display_name||"Source")+
    (unitCount>1?" · "+unitCount+" "+(p.unit_label||"units"):"");
  if(p.basis==="paid"){
    const funders=new Map();
    for(const l of p.lines||[])if(l.included_in_total!==false&&amountOrNull(l.amount)!==null)
      funders.set(l.funding_org||"Project",(funders.get(l.funding_org||"Project")||0)+Number(l.amount));
    add(box,"p","finance-detail-context",[...funders].map(([name,n])=>name+" "+money(n,p.currency)).join(" · "));
  }
  const itemisation=itemisationFor(p);
  let categoryRoot=box;
  if(itemisation){
    if(itemisation.note)add(box,"p","finance-detail-context",itemisation.note);
    box.append(sourceLineTable(itemisation.items,p));
    categoryRoot=add(box,"details","finance-category");
    categoryRoot.dataset.financeKey="payments:"+p.id;
    add(categoryRoot,"summary","finance-category-line","Payments");
  }
  const categoryOrder=p.activity==="Aggregation Hub"?["Site Works","Power / Electrical","Administration","Intake / Weighing / Grading","Baling and Packing","Storage","Warehouse Organisation / Management","Safety / Site Basics","Consultancy / Supervision"]:[];
  const categories=[...p.summary.categories].sort((a,b)=>categoryOrder.length?(categoryOrder.indexOf(a.name)<0?99:categoryOrder.indexOf(a.name))-(categoryOrder.indexOf(b.name)<0?99:categoryOrder.indexOf(b.name)):0);
  for(const cat of categories){
    const detail=add(categoryRoot,"details","finance-category");
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
  // Priced reviewed lines belong in their source categories. Never repeat them as unpriced.
  const missing=(p.lines||[]).filter(l=>l.included_in_total!==false&&amountOrNull(l.amount)===null);
  if(missing.length){
    const d=add(box,"details","finance-category");
    d.dataset.financeKey="options:"+p.id;
    add(d,"summary","finance-category-line","Additional scope");
    d.append(sourceLineTable(missing,p));
  }
  if(!p.summary.categories.length&&!missing.length)add(box,"p","finance-detail-context","No itemised price details.");
  if(typeof p.source?.source_url==="string"&&/^https:\/\//.test(p.source.source_url)){
    const link=add(box,"a","finance-source-link","Open source");link.href=p.source.source_url;link.target="_blank";link.rel="noopener noreferrer";
  }
  return box;
}
function expenseSections(p){
  const box=make("div","finance-detail-body");

  for(const cat of p.summary.categories){
    const d=add(box,"details","finance-category");
    d.dataset.financeKey="expense-cat:"+p.id+":"+cat.name;
    const summary=add(d,"summary","finance-category-line");
    add(summary,"span","",cat.name);
    add(summary,"strong","finance-money",money(cat.amount,p.currency));
    const lines=cat.groups.flatMap(g=>g.lines);
    d.append(sourceLineTable(lines,p,true));
  }
  return box;
}
const columns=["Version / stage","Date","Basis","Per unit","Package total","Status"];
function projectMobileReference(group){
  const {name,entries}=group;
  const key=name==="Solar Drying Tables"?"v13-plan-10":
    name==="Offshore Nursery"?"nursery-future-4-rafts":
    name==="Aggregation Hub"?"august-2026-consultant-proposal":null;
  const p=key?entries.find(x=>x.package_key===key):null;
  if(p){
    const total=totalOf(p);
    const quantity=Number(p.units_covered||0);
    const validTotal=Number.isFinite(total);
    const perUnit=validTotal&&quantity>0&&(name==="Solar Drying Tables"||name==="Offshore Nursery")?
      money(total/quantity,p.currency)+" / "+(name==="Solar Drying Tables"?"table":"raft"):null;
    return {
      total:validTotal?money(total,p.currency):"—",perUnit,
      quantity:quantity>0?quantity+" "+(name==="Solar Drying Tables"?"tables":name==="Offshore Nursery"?"rafts":"units"):null,
      status:name==="Solar Drying Tables"?"Actual (owner-confirmed)":
        name==="Offshore Nursery"?"Partial estimate":"Proposal"
    };
  }
  const r=referenceFor(group);
  return {total:r.amount,perUnit:null,quantity:null,
    status:name==="Mawimbi"?"Budget":"Reference"};
}
function tableHeader(root){
  const h=add(root,"div","finance-table-header");
  for(const col of columns)add(h,"span","",col);
}
function line(root,p,expenses){
  const d=add(root,"details","finance-register-item"+(p.activity==="Solar Drying Shed & Store"?" finance-reference":""));
  d.dataset.financeKey="pkg:"+p.id;
  const s=add(d,"summary","finance-row");
  const title=add(s,"span","finance-stage",expenses?p.activity.replace(/^COSME Procurement — /,""):stage(p));
  title.title=(p.source?.display_name||"");
  const date=add(s,"span","finance-date",dateOf(p));
  date.title=dateOf(p)+" · "+(reportMetadata(p).date_kind||"Source date");
  add(s,"span","finance-basis",basisLabel(p));
  const unit=String(p.unit_label||"").replace(/s$/,"");
  const hasComparableUnit=/^(table|raft)$/.test(unit);
  add(s,"strong","finance-money",expenses||!hasComparableUnit?"—":costOf(p)+" / "+unit);
  add(s,"strong","finance-money",money(totalOf(p),p.currency));
  add(s,"span","finance-row-status",reportStatus(p));
  d.append(expenses?expenseSections(p):costSections(p));
}
export function createCosmeFinancesPanel(authClient,root){
  let entries=[],epoch=0,mode="costs",activity="all",basis="all",search="",fingerprint=null,hasLoaded=false;
  let refreshPromise=null, lastError="";
  let mobileFiltersOpen=false,mobileActionsOpen=false;
  root.className=(root.className+" metrics-panel finance-panel").trim();
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
    mobileFiltersOpen=false;mobileActionsOpen=false;
  }
  function redraw(){
    snapshot();
    root.replaceChildren();
    const toolbar=add(root,"div","metrics-toolbar finance-toolbar");
    const nav=add(toolbar,"div","finance-view-tabs");
    for(const [value,label] of [["costs","Project costs & estimates"],["expenses","Expense register"]]){
      const button=add(nav,"button","metrics-button"+(value===mode?" selected":""),label);
      button.type="button";button.setAttribute("aria-pressed",String(mode===value));
      button.addEventListener("click",()=>{mode=value;activity="all";basis="all";redraw()});
    }
    const isExpense=mode==="expenses";
    const pool=isExpense?expenseOverview(entries):costPackages(entries);
    const searchLabel=add(toolbar,"label","metrics-search","Search");
    const searchInput=add(searchLabel,"input","");searchInput.type="search";searchInput.placeholder="Project, part or source";searchInput.value=search;
    searchInput.addEventListener("change",()=>{search=searchInput.value;redraw()});
    const filtersToggle=add(toolbar,"button","metrics-button finance-mobile-toggle finance-filters-toggle","Filters");
    filtersToggle.type="button";filtersToggle.setAttribute("aria-controls","cosmeFinanceFilters");
    filtersToggle.setAttribute("aria-expanded",String(mobileFiltersOpen));
    const controls=add(toolbar,"div","finance-filters"+(mobileFiltersOpen?" is-open":""));
    controls.id="cosmeFinanceFilters";
    filtersToggle.addEventListener("click",()=>{
      mobileFiltersOpen=!mobileFiltersOpen;
      controls.classList.toggle("is-open",mobileFiltersOpen);
      filtersToggle.setAttribute("aria-expanded",String(mobileFiltersOpen));
    });
    const activityLabel=add(controls,"label","","Activity");
    const selector=add(activityLabel,"select","finance-select");
    selector.setAttribute("aria-label","Filter finance activity");
    let options=[["all","All activities"],...[...new Set(pool.map(p=>p.activity==="Solar Drying Shed & Store"?"Solar Drying Tables":p.activity))].sort().map(x=>[x,x.replace(/^COSME Procurement — /,"")])];
    for(const [key,label] of options){const o=add(selector,"option","",label);o.value=key}
    if(!options.some(o=>o[0]===activity))activity="all";
    selector.value=activity;selector.addEventListener("change",()=>{activity=selector.value;redraw()});
    if(!isExpense){
      const basisLabel=add(controls,"label","","Cost basis");
      const filter=add(basisLabel,"select","finance-select");
      filter.setAttribute("aria-label","Filter cost basis");
      for(const [key,label] of [["all","All cost bases"],...Object.entries(BASIS)]){
        const opt=add(filter,"option","",label);opt.value=key;
      }
      filter.value=basis;filter.addEventListener("change",()=>{basis=filter.value;redraw()});
    }
    const actionsToggle=add(toolbar,"button","metrics-button finance-mobile-toggle finance-actions-toggle","Actions");
    actionsToggle.type="button";actionsToggle.setAttribute("aria-controls","cosmeFinanceActions");
    actionsToggle.setAttribute("aria-expanded",String(mobileActionsOpen));
    const actions=add(toolbar,"div","finance-actions"+(mobileActionsOpen?" is-open":""));
    actions.id="cosmeFinanceActions";
    actionsToggle.addEventListener("click",()=>{
      mobileActionsOpen=!mobileActionsOpen;
      actions.classList.toggle("is-open",mobileActionsOpen);
      actionsToggle.setAttribute("aria-expanded",String(mobileActionsOpen));
    });
    const refresh=add(actions,"button","metrics-button","Refresh");
    refresh.type="button";refresh.addEventListener("click",()=>load({force:true}));
    if(lastError)add(root,"p","finance-detail-flag","Update unavailable; showing last loaded costs. "+lastError);
    const selected=pool.filter(p=>(activity==="all"||p.activity===activity||(activity==="Solar Drying Tables"&&p.activity==="Solar Drying Shed & Store"))&&(isExpense||basis==="all"||effectiveFinanceBasis(p)===basis)&&
      (!search||[p.activity,p.version,p.source?.display_name,...(p.lines||[]).map(l=>itemDescription(l))].join(" ").toLowerCase().includes(search.toLowerCase())));
    if(!selected.length){add(root,"p","finance-empty",hasLoaded?"No matching cost records.":"Loading finance records…");return}
    const list=add(root,"div","finance-register");
    tableHeader(list);

    const groups=isExpense?activityGroups(selected):projectOverview(selected);
    for(const group of groups){
      if(isExpense){
        for(const p of group.entries)line(list,p,true);
        continue;
      }
      const container=add(list,"details","finance-project-group");
      container.dataset.financeKey="group:"+group.name;
      const summary=add(container,"summary","finance-group-summary");
      add(summary,"strong","finance-group-name",group.name);
      const ref=referenceFor(group);
      const date=add(summary,"span","finance-group-date",dateOf(group.entries[0]));
      date.title=dateOf(group.entries[0])+" · "+(reportMetadata(group.entries[0]).date_kind||"Source date");
      add(summary,"strong","finance-group-cost",ref.amount);
      add(summary,"span","finance-group-note",ref.note);
      const mobile=projectMobileReference(group);
      const mobileInfo=add(summary,"span","finance-group-mobile");
      const first=add(mobileInfo,"span","finance-group-mobile-main");
      add(first,"span","finance-mobile-total-label","Total");
      add(first,"strong","finance-group-mobile-total",mobile.total);
      add(first,"span","finance-group-mobile-status",mobile.status);
      const supporting=[mobile.quantity,mobile.perUnit].filter(Boolean).join(" · ");
      if(supporting)add(mobileInfo,"span","finance-group-mobile-unit",supporting);
      add(mobileInfo,"span","finance-group-mobile-context",ref.note);
      for(const p of group.entries)line(container,p,false);
    }

    const exportBtn=add(actions,"button","metrics-button finance-export","Export source lines CSV");
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
