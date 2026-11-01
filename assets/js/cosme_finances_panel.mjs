import {BASIS,money,amountOrNull,normalizeFinanceData,activityGroups,exportFinanceCsv} from "./cosme_finances_core.mjs?v=1";

const node=(tag, className, label)=>{
  const element=document.createElement(tag);
  if(className) element.className=className;
  if(label!==undefined) element.textContent=String(label);
  return element;
};
function sourceInfo(pkg) {
  const src=pkg.source;
  if(!src) return "Source pending";
  return [src.display_name,src.source_date,src.revision ? "Rev "+src.revision : null]
    .filter(Boolean).join(" · ");
}
function lineTable(lines,pkg){
  const scroll=node("div","finance-line-scroll");
  const table=node("table","finance-line-table");
  const head=node("thead");
  const header=node("tr");
  for(const label of ["Item","Date","Qty","Rate / original","Amount","Status","Evidence"]) header.append(node("th","",label));
  head.append(header);table.append(head);
  const body=node("tbody");
  for(const line of lines){
    const row=node("tr");
    row.append(node("td","",line.description||"Unspecified"));
    row.append(node("td","",line.entry_date||"—"));
    row.append(node("td","",line.quantity===null?"—":String(line.quantity)+" "+(line.unit||"")));
    row.append(node("td","",money(line.unit_rate,line.rate_currency||pkg.currency)));
    row.append(node("td","finance-amount",money(line.amount,pkg.currency)));
    row.append(node("td","",line.reconciliation_status||"Review"));
    const evidence=node("td","finance-evidence");
    evidence.append(node("span","",line.source_row||"—"));
    if(line.funding_org) evidence.append(node("small","","Funder: "+line.funding_org));
    if(line.note) evidence.append(node("small","",line.note));
    row.append(evidence);body.append(row);
  }
  table.append(body);scroll.append(table);
  return scroll;
}
function reportedTotal(pkg) {
  return pkg.summary.control !== null && !pkg.summary.reconciled
    ? pkg.summary.control : pkg.summary.total;
}
function singularUnit(label) {
  const unit=String(label || "unit");
  return unit.endsWith("s") ? unit.slice(0,-1) : unit;
}
function displayAmount(pkg) {
  if(!pkg.summary.included && pkg.summary.control === null) return "Awaiting review";
  const count=Number(pkg.units_covered)||1;
  return money(reportedTotal(pkg)/count,pkg.currency)+
    (count>1 ? " / "+singularUnit(pkg.unit_label) : "");
}
function packageDetails(pkg) {
  const details=node("details","finance-package");
  const sum=node("summary","finance-package-summary");
  const info=node("div","finance-package-name");
  info.append(node("strong","",pkg.version||"Unversioned"));
  info.append(node("small","",sourceInfo(pkg)));
  const right=node("div","finance-package-value");
  const reported = pkg.summary.control !== null && !pkg.summary.reconciled;
  right.append(node("strong","",displayAmount(pkg)));
  right.append(node("small","",(reported?"Reported · ":"")+BASIS[pkg.basis]+
    (pkg.units_covered>1?" · "+money(reportedTotal(pkg),pkg.currency)+
      " / "+pkg.units_covered+" "+(pkg.unit_label||"units"):"")));
  sum.append(info,right);details.append(sum);
  const content=node("div","finance-package-content");
  if(pkg.units_covered>1){
    content.append(node("p","finance-note",
      "Package total: "+money(reportedTotal(pkg),pkg.currency)+" across "+
      pkg.units_covered+" "+(pkg.unit_label||"units")+
      ". Unit costs are comparisons using this source quantity."));
  }
  if(pkg.summary.control!==null && !pkg.summary.reconciled)
    content.append(node("p","finance-alert","Source control total "+money(pkg.summary.control,pkg.currency)+
      " · Difference from verified line items "+money(pkg.summary.difference,pkg.currency)+
      (pkg.summary.review?" · "+pkg.summary.review+" lines awaiting review":"")+"."));
  else if(pkg.summary.review)
    content.append(node("p","finance-alert",pkg.summary.review+" item(s) require reconciliation and are excluded from totals."));
  const status=node("p","finance-note","Cost basis: "+BASIS[pkg.basis]+
    " · Funding: "+(pkg.funding_scope||"not allocated")+
    " · "+(pkg.reconciliation_status||"Review pending")+
    " · Not summed with other versions, quotation types or currencies.");
  content.append(status);
  if(pkg.summary.categories.length===0) content.append(node("p","finance-note","No verified cost lines to display."));
  for(const category of pkg.summary.categories){
    const cat=node("details","finance-category");
    const csum=node("summary","finance-category-summary");
    csum.append(node("strong","",category.name),node("span","finance-amount",money(category.amount,pkg.currency)));
    cat.append(csum);
    for(const group of category.groups){
      const sub=node("details","finance-subcategory");
      const ssum=node("summary","finance-subcategory-summary");
      ssum.append(node("span","",group.name),node("strong","finance-amount",money(group.amount,pkg.currency)));
      sub.append(ssum,lineTable(group.lines,pkg));cat.append(sub);
    }
    content.append(cat);
  }
  const awaiting=(pkg.lines||[]).filter(line =>
    line.included_in_total!==false &&
    (line.reconciliation_status!=="verified" || amountOrNull(line.amount)===null));
  if(awaiting.length){
    const pending=node("details","finance-category finance-review");
    const psum=node("summary","finance-category-summary");
    psum.append(node("strong","",awaiting.length+" line(s) needing review"),
      node("span","finance-note","Excluded from subtotal"));
    pending.append(psum,lineTable(awaiting,pkg));
    content.append(pending);
  }
  const excluded=(pkg.lines||[]).filter(line => line.included_in_total===false);
  if(excluded.length){
    const duplicates=node("details","finance-category finance-excluded");
    const dsum=node("summary","finance-category-summary");
    dsum.append(node("strong","",excluded.length+" excluded source line(s)"),
      node("span","finance-note","Not counted"));
    duplicates.append(dsum,lineTable(excluded,pkg));
    content.append(duplicates);
  }
  const link=pkg.source?.source_url;
  if(typeof link==="string" && /^https:\/\//i.test(link)){
    const a=node("a","finance-source-link","Open source document");
    a.href=link;a.target="_blank";a.rel="noopener noreferrer";content.append(a);
  }
  details.append(content);return details;
}
export function createCosmeFinancesPanel(authClient,root){
  let entries=[],epoch=0,basis="all";
  function clear(){
    epoch++;entries=[];basis="all";
    root.replaceChildren();
  }
  function render(message=""){
    root.replaceChildren();
    const header=node("div","finance-heading");
    const heading=node("div");
    heading.append(node("h3","", "COSME finances"));
    heading.append(node("p","finance-note","Each total belongs to its stated source and cost basis. Quotes, estimates, invoices and payments are not added together."));
    const actions=node("div","finance-actions");
    const selector=node("select","finance-select");
    selector.setAttribute("aria-label","Cost basis");
    for(const [value,label] of [["all","All cost bases"],...Object.entries(BASIS)]){
      const option=node("option","",label);option.value=value;selector.append(option);
    }
    selector.value=basis;
    selector.addEventListener("change",()=>{basis=selector.value;render();});
    const refresh=node("button","metrics-button","Refresh");
    refresh.type="button";
    refresh.addEventListener("click",()=>load());
    actions.append(selector,refresh);header.append(heading,actions);root.append(header);
    if(message) root.append(node("p","finance-alert",message));
    const matching=entries.filter(p=>basis==="all"||p.basis===basis);
    const groups=activityGroups(matching);
    if(!groups.length){
      root.append(node("p","finance-empty",entries.length ?
        "No cost packages match this filter." :
        "No reviewed cost packages are published yet. Estimates and expense data will appear here after the source reconciliation step."));
      return;
    }
    const grid=node("div","finance-activity-list");
    groups.forEach((group,index)=>{
      const outer=node("details","finance-activity");
      // Open the first group to show the prototype/version hierarchy without an overwhelming initial list.
      outer.open=index===0;
      const summary=node("summary","finance-activity-summary");
      const title=node("div");
      title.append(node("strong","",group.name));
      title.append(node("small","",group.entries.length+" source-backed cost package(s)"));
      const latest=group.entries[0];
      const preview=node("div","finance-activity-preview");
      preview.append(node("strong","",displayAmount(latest)));
      preview.append(node("small","","Most recent "+BASIS[latest.basis].toLowerCase()+" · "+(latest.version||"Unversioned")));
      summary.append(title,preview);outer.append(summary);
      const body=node("div","finance-packages");
      group.entries.forEach(pkg=>body.append(packageDetails(pkg)));
      outer.append(body);grid.append(outer);
    });
    root.append(grid);
    const button=node("button","metrics-button finance-export","Export source lines CSV");
    button.type="button";
    button.addEventListener("click",()=>{
      const blob=new Blob(["\ufeff",exportFinanceCsv(matching)],{type:"text/csv;charset=utf-8"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");a.href=url;a.download="cosme-finances-source-lines.csv";
      document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);
    });
    root.append(button);
  }
  async function load(){
    const request=++epoch;
    root.replaceChildren(node("p","finance-note","Loading source-backed finance data…"));
    try{
      const {data,error}=await authClient.rpc("cosme_finance_read");
      if(request!==epoch) return;
      if(error) throw error;
      entries=normalizeFinanceData(data);
      render();
    }catch(error){
      if(request!==epoch)return;
      entries=[];
      render("Finance data is not available yet: "+(error?.message||"Unable to load the source register."));
    }
  }
  return {load,clear};
}
