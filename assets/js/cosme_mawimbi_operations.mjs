// MAWIMBI cross-organisation figures: approved monthly aggregates only.
// Historical COSME V0.1 metrics remain immutable and distinct from current values.
const formatter = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 2 });
const nf = (n) => formatter.format(n);
const safeCount = (n) => Number.isSafeInteger(n) && n >= 0;
const safeAmount = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const goodDate = (s) => typeof s === "string" && Number.isFinite(Date.parse(s));
const monthLabel = (s) => new Date(s + "T12:00:00Z").toLocaleDateString("en-GB", {
  month: "short", year: "numeric", timeZone: "UTC"
});
const amountKg = (n) => nf(n) + " kg";
const amountL = (n) => nf(n) + " L";

export function validateMawimbiOperations(data) {
  if (!data || data.can_view !== true || data.status !== "current"
    || data.payment_verified !== false || data.batch_linkage_verified !== false
    || !safeCount(data.month_count) || !Array.isArray(data.months)
    || data.month_count !== data.months.length || data.month_count > 60
    || !safeCount(data.excluded_unfinalized_collections)
    || !safeCount(data.excluded_late_unfinalized_collections)
    || data.excluded_late_unfinalized_collections > data.excluded_unfinalized_collections
    || !goodDate(data.queried_at)
    || (data.source_updated_at !== null && !goodDate(data.source_updated_at))) return false;
  const seen = new Set();
  let previous = null;
  for(const row of data.months) {
    if (typeof row.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(row.month)
      || seen.has(row.month) || (previous !== null && row.month >= previous)
      || !safeCount(row.collection_records) || !safeCount(row.processing_sessions)
      || !safeAmount(row.collection_wet_kg) || !safeAmount(row.processing_received_kg)
      || !safeAmount(row.pressed_l)
      || (row.collection_records === 0 && row.collection_wet_kg > 0)
      || (row.collection_records > 0 && row.collection_wet_kg <= 0)
      || (row.processing_sessions === 0 && (row.processing_received_kg > 0 || row.pressed_l > 0))
      || (row.processing_sessions > 0 && row.processing_received_kg <= 0)) return false;
    previous = row.month;
    seen.add(row.month);
  }
  return true;
}
function add(parent, tag, content, cls="") {
  const node=document.createElement(tag);
  if (content !== undefined) node.textContent=String(content);
  if (cls) node.className=cls;
  parent.append(node);
  return node;
}

export function createMawimbiOperationsPanel(authClient, target) {
  if(!target) throw new Error("Mawimbi target missing");
  let current = null;
  let errorText = "";
  function clear() {
    current = null; errorText = "";
    target.replaceChildren();
  }
  function isConnected() { return !!current; }
  function latest() { return current?.months?.[0] || null; }
  function metricContext(id) {
    if(!current || !latest())return null;
    const period=latest();
    if(id==="MAW-0082")return {
      label:"Current finalised wet collections",
      value:amountKg(period.collection_wet_kg),
      description:period.collection_records+" receipt-backed collection records in "+monthLabel(period.month)
    };
    if(id==="MAW-0086")return {
      label:"Current processing sessions",
      value:String(period.processing_sessions),
      description:amountKg(period.processing_received_kg)+" received for processing in "+monthLabel(period.month)
    };
    return null;
  }
  function render() {
    target.replaceChildren();
    const panel=add(target,"section",undefined,"metrics-current-panel metrics-mawimbi-operations");
    const header=add(panel,"div",undefined,"metrics-current-heading");
    add(header,"h4","Mawimbi · current collections & processing");
    if(!current) {
      add(panel,"p",errorText || "Loading Mawimbi figures…","metrics-small-note");
      return;
    }
    if(!latest()) {
      add(panel,"p","No validated Mawimbi operational periods yet.","metrics-small-note");
      return;
    }
    const month=latest();
    add(panel,"p",monthLabel(month.month)+" · Owner-only cross-organisation aggregate · MAW-0082 and MAW-0086",
      "metrics-small-note metrics-mawimbi-intro");
    const summary=add(panel,"div",undefined,"metrics-mawimbi-summary");
    const coll=add(summary,"div",undefined,"metrics-growth-summary-card");
    add(coll,"span","Finalised wet collections · "+nf(month.collection_records)+" records","metrics-current-label");
    add(coll,"strong",amountKg(month.collection_wet_kg),"metrics-growth-key");
    add(coll,"span","Collection dates and recorded weights; matching receipt required","metrics-current-note");
    const process=add(summary,"div",undefined,"metrics-growth-summary-card");
    add(process,"span","Processing · "+nf(month.processing_sessions)+" sessions","metrics-current-label");
    add(process,"strong",amountKg(month.processing_received_kg),"metrics-growth-key");
    add(process,"span",amountL(month.pressed_l)+" pressed liquid recorded","metrics-current-note");
    const details=add(panel,"details",undefined,"metrics-growth-details metrics-mawimbi-details");
    add(details,"summary","Monthly history ("+current.month_count+" months)");
    const wrap=add(details,"div",undefined,"metrics-dryer-comparison-wrap");
    const table=add(wrap,"table",undefined,"metrics-dryer-comparison metrics-mawimbi-table");
    const head=add(add(table,"thead"),"tr");
    for(const label of ["Month","Finalised collections","Collection wet kg","Processing sessions","Processing received kg","Pressed liquid L"]) {
      add(head,"th",label).scope="col";
    }
    const tbody=add(table,"tbody");
    for(const row of current.months) {
      const tr=add(tbody,"tr");
      add(tr,"th",monthLabel(row.month)).scope="row";
      add(tr,"td",nf(row.collection_records));
      add(tr,"td",nf(row.collection_wet_kg));
      add(tr,"td",nf(row.processing_sessions));
      add(tr,"td",nf(row.processing_received_kg));
      add(tr,"td",nf(row.pressed_l));
    }
    add(panel,"p",current.excluded_unfinalized_collections+" unfinalised collection records are excluded; "+
      current.excluded_late_unfinalized_collections+" of them were entered over 48 hours after the recorded collection event.",
      "metrics-small-note");
    add(panel,"p","Collection and processing are independent ledgers. These totals do not establish paid farmer purchases, "+
      "a batch-level collection-to-stock link or a validated extraction yield.","metrics-small-note");
    add(panel,"p","Source updated: "+(current.source_updated_at ? new Date(current.source_updated_at).toLocaleString() : "unknown")
      +" · Calculated: "+new Date(current.queried_at).toLocaleString(),"metrics-small-note");
  }
  async function refresh() {
    current=null;errorText="";
    try {
      const {data,error}=await authClient.rpc("cosme_metrics_live_mawimbi_operations");
      if(error)throw error;
      if(!validateMawimbiOperations(data))throw new Error("Invalid Mawimbi aggregate or denied permission");
      current=data;
    } catch {
      errorText="Current Mawimbi aggregate unavailable or restricted to the metrics owner.";
    }
    render();
  }
  return {clear,refresh,render,isConnected,metricContext};
}
