// Presentation-only finance helpers. Never combine currencies, bases or source packages.
export const BASIS = Object.freeze({
  estimated: "Estimated", quoted: "Quoted", invoiced: "Invoiced", paid: "Paid"
});
export function amountOrNull(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function money(value, currency) {
  const n = amountOrNull(value);
  if (n === null) return "Unpriced";
  const unit = String(currency || "").toUpperCase();
  return (unit ? unit + " " : "") + n.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2
  });
}
export function normalizeFinanceData(payload) {
  const sources = Array.isArray(payload?.sources) ? payload.sources : [];
  const packages = Array.isArray(payload?.packages) ? payload.packages : [];
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  const sourceMap = new Map(sources.filter(s => s && s.id).map(s => [String(s.id), s]));
  const lineMap = new Map();
  for (const line of lines) {
    if (!line || !line.package_id) continue;
    const key = String(line.package_id);
    if (!lineMap.has(key)) lineMap.set(key, []);
    lineMap.get(key).push(line);
  }
  return packages.filter(p => p && p.id && BASIS[p.basis] && /^[A-Z]{3}$/.test(p.currency || ""))
    .map(p => ({
      ...p,
      id: String(p.id),
      source: sourceMap.get(String(p.source_id)) || null,
      lines: lineMap.get(String(p.id)) || []
    }));
}
export function breakdown(pkg) {
  const categories = new Map();
  let total = 0, included = 0, review = 0;
  for (const line of pkg.lines || []) {
    if (line.included_in_total === false) continue;
    const n = amountOrNull(line.amount);
    if (line.reconciliation_status !== "verified" || n === null) { review++; continue; }
    total += n; included++;
    const category = String(line.category || "Other");
    const subcategory = String(line.subcategory || "Other");
    if (!categories.has(category)) categories.set(category, { name:category, amount:0, groups:new Map() });
    const cat = categories.get(category); cat.amount += n;
    if (!cat.groups.has(subcategory)) cat.groups.set(subcategory,{name:subcategory,amount:0,lines:[]});
    const group=cat.groups.get(subcategory); group.amount += n; group.lines.push(line);
  }
  const control = amountOrNull(pkg.control_total);
  return {
    total, included, review, control,
    reconciled: control !== null && review === 0 && Math.abs(control - total) <= 0.01,
    difference: control === null ? null : Math.round((total-control)*100)/100,
    categories: [...categories.values()].map(c => ({
      name:c.name, amount:c.amount,
      groups:[...c.groups.values()].sort((a,b)=>b.amount-a.amount)
    })).sort((a,b)=>b.amount-a.amount)
  };
}
export function activityGroups(packages) {
  const map=new Map();
  for(const p of packages){
    const activity=String(p.activity||"Other");
    if(!map.has(activity)) map.set(activity,[]);
    map.get(activity).push({...p, summary:breakdown(p)});
  }
  return [...map].map(([name,entries])=>({
    name,
    entries: entries.sort((a,b)=>String(b.source?.source_date||"").localeCompare(String(a.source?.source_date||""))||
      String(b.version||"").localeCompare(String(a.version||""),undefined,{numeric:true}))
  })).sort((a,b)=>{
    const rank=name=>({ "Solar Drying Tables":0, "Offshore Nursery":1, "Mawimbi":2 })[name]??3;
    return rank(a.name)-rank(b.name)||a.name.localeCompare(b.name);
  });
}
export function exportFinanceCsv(packages) {
  const quote=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
  const rows=[["Activity","Version","Basis","Currency","Source","Source row","Entry date","Category","Subcategory","Description","Quantity","Unit","Unit rate","Rate currency","Amount","Funder","Status","Included"]];
  for(const pkg of packages) for(const line of pkg.lines){
    rows.push([pkg.activity,pkg.version,pkg.basis,pkg.currency,pkg.source?.display_name||"",line.source_row,line.entry_date,line.category,line.subcategory,line.description,line.quantity,line.unit,line.unit_rate,line.rate_currency,line.amount,line.funding_org,line.reconciliation_status,line.included_in_total!==false]);
  }
  return rows.map(row=>row.map(quote).join(",")).join("\r\n");
}
