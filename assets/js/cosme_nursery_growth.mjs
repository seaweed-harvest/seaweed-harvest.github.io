// COSME Metrics: current sample-rope growth, shown separately from frozen V0.1.
// Only consumes the dedicated owner-granted, aggregate-only Supabase RPC.
const number = (value, digits = 2) => new Intl.NumberFormat("en-KE", {
  maximumFractionDigits: digits, minimumFractionDigits: digits
}).format(value);
function positiveInteger(v) { return Number.isSafeInteger(v) && v >= 0; }
function numericOrNull(v) { return v === null || (typeof v === "number" && Number.isFinite(v)); }
function validDate(v) { return typeof v === "string" && Number.isFinite(Date.parse(v)); }
export function validateNurseryGrowth(data) {
  if(!data || data.can_view !== true || data.status !== "current"
     || !positiveInteger(data.active_initial_ropes)
     || !positiveInteger(data.week2_matched_ropes)
     || !positiveInteger(data.week4_matched_ropes)
     || !positiveInteger(data.site_count)
     || data.week2_matched_ropes > data.active_initial_ropes
     || data.week4_matched_ropes > data.active_initial_ropes
     || !Array.isArray(data.sites) || data.sites.length > 25
     || !Array.isArray(data.structures) || data.structures.length > 5
     || data.sites.length !== data.site_count
     || !validDate(data.queried_at)
     || (data.source_updated_at !== null && !validDate(data.source_updated_at))) return false;
  const seen = new Set();
  for (const row of data.sites) {
    if(typeof row.site_code !== "string" || row.site_code.length > 60 || !row.site_code
      || seen.has(row.site_code)
      || !["raft","shore","other"].includes(row.structure)
      || !["Mkwiro","Tumbe","Other"].includes(row.area)
      || !positiveInteger(row.initial_n) || !positiveInteger(row.week2_n) || !positiveInteger(row.week4_n)
      || row.week2_n > row.initial_n || row.week4_n > row.initial_n
      || !numericOrNull(row.week2_factor) || !numericOrNull(row.week4_factor)
      || !numericOrNull(row.week4_net_kg) || !numericOrNull(row.week4_initial_kg)
      || !numericOrNull(row.week4_mean_sgr_pct_per_day)
      || !numericOrNull(row.week4_mean_gain_kg_per_rope_day)
      || (row.week4_n && (!(row.week4_factor > 0) || !(row.week4_initial_kg > 0)
        || !(row.week4_net_kg > 0)))) return false;
    seen.add(row.site_code);
  }
  if(data.sites.reduce((sum,row)=>sum+row.initial_n,0) !== data.active_initial_ropes
     || data.sites.reduce((sum,row)=>sum+row.week2_n,0) !== data.week2_matched_ropes
     || data.sites.reduce((sum,row)=>sum+row.week4_n,0) !== data.week4_matched_ropes) return false;
  for (const row of data.structures) {
    if(!["raft","shore"].includes(row.structure) || !positiveInteger(row.week4_n)
      || !numericOrNull(row.week4_factor) || !numericOrNull(row.mean_sgr_pct_per_day)
      || (row.week4_n > 0 && !(row.week4_factor > 0))) return false;
  }
  return true;
}

/** Second aggregate validates against the same growth cohort, never raw ropes. */
export function validateNurseryQuality(quality, growth) {
  if(!growth || !quality || quality.can_view !== true || quality.status !== "current"
    || !Array.isArray(quality.sites) || quality.sites.length !== growth.sites.length
    || quality.sites.length > 25 || !validDate(quality.queried_at)
    || (quality.source_updated_at !== null && !validDate(quality.source_updated_at))) return false;
  const basis = new Map(growth.sites.map(row=>[row.site_code,row]));
  const seen = new Set();
  for(const row of quality.sites) {
    const original = basis.get(row.site_code);
    if(!original || seen.has(row.site_code)
      || !positiveInteger(row.initial_n) || !positiveInteger(row.week4_n)
      || !positiveInteger(row.due_missing_week4) || !positiveInteger(row.pending_week4)
      || !positiveInteger(row.tare_review_n)
      || row.initial_n !== original.initial_n || row.week4_n !== original.week4_n
      || row.initial_n !== row.week4_n + row.due_missing_week4 + row.pending_week4
      || row.tare_review_n > row.initial_n) return false;
    seen.add(row.site_code);
    const ordered=[row.min_factor,row.p25_factor,row.median_factor,row.p75_factor,row.max_factor];
    if(row.week4_n > 0) {
      if(ordered.some(x=>typeof x!=="number" || !Number.isFinite(x) || x<=0))return false;
      for(let i=1;i<ordered.length;i++)if(ordered[i] < ordered[i-1])return false;
    } else if(ordered.some(x=>x!==null))return false;
    if(!numericOrNull(row.sgr_stddev_pct_per_day))return false;
  }
  return seen.size === growth.sites.length;
}

function element(parent, tag, label, className="") {
  const node = document.createElement(tag);
  if(label !== undefined) node.textContent = String(label);
  if(className) node.className = className;
  parent.append(node);
  return node;
}
function ratio(value) { return value == null ? "—" : number(value,2) + "×"; }
function rate(value) { return value == null ? "—" : number(value,2) + "%/day"; }
function weight(value) { return value == null ? "—" : number(value,2) + " kg"; }
function stageCount(n,total) { return n + "/" + total; }

export function createNurseryGrowthPanel(authClient, target) {
  if (!target) throw new Error("Nursery growth panel target is missing");
  let model = null;
  let quality = null;
  let errorMessage = "";
  let qualityError = "";

  function clear() {
    model = null;
    quality = null;
    errorMessage = "";
    qualityError = "";
    target.replaceChildren();
  }
  function render() {
    target.replaceChildren();
    const panel = element(target,"section",undefined,"metrics-current-panel metrics-nursery-growth");
    const header = element(panel,"div",undefined,"metrics-current-heading");
    element(header,"h4","Nursery sample-rope growth");
    if(!model) {
      element(panel,"p",errorMessage || "Loading current growth measurements…","metrics-small-note");
      return;
    }
    element(panel,"p","Current COSME rope measurements · "
      + model.active_initial_ropes + " initial ropes across " + model.site_count
      + " sites · " + model.week2_matched_ropes + " matched at Week 2 · "
      + model.week4_matched_ropes + " matched at Week 4","metrics-small-note metrics-nursery-growth-intro");

    const comparison = element(panel,"div",undefined,"metrics-growth-summary");
    for(const row of model.structures) {
      const card = element(comparison,"div",undefined,"metrics-growth-summary-card");
      const label = row.structure === "raft" ? "Mkwiro rafts" : "Mkwiro shore farms";
      element(card,"span",label + " · " + row.week4_n + " matched ropes","metrics-current-label");
      element(card,"strong",ratio(row.week4_factor),"metrics-growth-key");
      element(card,"span","Week 4 net biomass ÷ matched initial","metrics-current-note");
      element(card,"span","Mean daily SGR: " + rate(row.mean_sgr_pct_per_day),"metrics-growth-sgr");
    }
    const details = element(panel,"details",undefined,"metrics-growth-details");
    const summary = element(details,"summary","Site-by-site measurements (" + model.site_count + " sites)");
    summary.setAttribute("aria-label","Expand nursery site growth records");
    const wrap = element(details,"div",undefined,"metrics-dryer-comparison-wrap");
    const table = element(wrap,"table",undefined,"metrics-dryer-comparison metrics-growth-table");
    const thead = element(table,"thead");
    const hrow = element(thead,"tr");
    for(const label of ["Site","Setup","Week 2 ropes","Week 2 growth","Week 4 ropes","Week 4 net","Week 4 growth","Daily SGR"]){
      const th = element(hrow,"th",label);
      th.scope="col";
    }
    const tbody = element(table,"tbody");
    for(const row of model.sites) {
      const tr = element(tbody,"tr");
      element(tr,"th",row.site_code).scope="row";
      element(tr,"td",row.structure === "raft" ? "Raft" : row.structure === "shore" ? "Shore" : "Other");
      element(tr,"td",stageCount(row.week2_n,row.initial_n));
      const w2 = element(tr,"td",ratio(row.week2_factor));
      w2.title = row.week2_n ? "Matched initial net: "+weight(row.week2_initial_kg)+"; Week 2 net: "+weight(row.week2_net_kg) : "No matching Week 2 measurements";
      element(tr,"td",stageCount(row.week4_n,row.initial_n));
      element(tr,"td",weight(row.week4_net_kg));
      const w4 = element(tr,"td",ratio(row.week4_factor));
      w4.title = row.week4_n ? "Matched initial net: "+weight(row.week4_initial_kg)+"; Week 4 net: "+weight(row.week4_net_kg) + "; elapsed: "+row.week4_days_min+"–"+row.week4_days_max+" days" : "No matching Week 4 measurements";
      element(tr,"td",rate(row.week4_mean_sgr_pct_per_day));
    }

    if(quality) {
      const due=quality.sites.reduce((sum,x)=>sum+x.due_missing_week4,0);
      const pending=quality.sites.reduce((sum,x)=>sum+x.pending_week4,0);
      const tare=quality.sites.reduce((sum,x)=>sum+x.tare_review_n,0);
      const box=element(panel,"details",undefined,"metrics-growth-details metrics-growth-quality");
      const label="Growth variability & data checks · "+due+" due · "+tare+" tare reviews";
      element(box,"summary",label);
      const wrap=element(box,"div",undefined,"metrics-dryer-comparison-wrap");
      const table=element(wrap,"table",undefined,"metrics-dryer-comparison metrics-quality-table");
      const h=element(element(table,"thead"),"tr");
      for(const name of ["Site","Week 4","Median","Middle 50%","Range","Review flags"]) {
        const th=element(h,"th",name);th.scope="col";
      }
      const body=element(table,"tbody");
      for(const row of quality.sites) {
        const tr=element(body,"tr");
        element(tr,"th",row.site_code).scope="row";
        element(tr,"td",stageCount(row.week4_n,row.initial_n));
        element(tr,"td",ratio(row.median_factor));
        element(tr,"td",row.p25_factor==null?"—":ratio(row.p25_factor)+"–"+ratio(row.p75_factor));
        element(tr,"td",row.min_factor==null?"—":ratio(row.min_factor)+"–"+ratio(row.max_factor));
        const flags=[];
        if(row.due_missing_week4)flags.push(row.due_missing_week4+" follow-up due");
        if(row.pending_week4)flags.push(row.pending_week4+" pending");
        if(row.tare_review_n)flags.push(row.tare_review_n+" tare to check");
        element(tr,"td",flags.join(" · ") || "—");
      }
      element(box,"p",due+" Week 4 follow-up due; "+pending+" not yet due; "+
        tare+" recorded tare values ≥0.5 kg flagged for field review. "
        +"Flags do not change recorded weights or exclude ropes.","metrics-small-note");
      element(box,"p","Median and middle 50% represent individual matched-rope Week 4 biomass multipliers. "
        +"Small site samples (typically 5–6 ropes) and recorded tare values warrant care in interpretation.","metrics-small-note");
    } else if(qualityError) {
      element(panel,"p",qualityError,"metrics-small-note");
    }
    element(panel,"p","Growth factors compare net seaweed weight (gross measurement minus rope tare) for the same matched ropes. "
      +"Week 2 and Week 4 may use different matched cohorts; missing results are not zero. "
      +"The displayed daily SGR is the mean per-rope logarithmic growth rate using actual elapsed days. "
      +"The Tumbe sites have initial measurements only.","metrics-small-note");
    element(panel,"p","Indicative monitored-rope comparison, not whole-farm yield, survival or proof of a causal advantage.","metrics-small-note");
    const modified = model.source_updated_at ? new Date(model.source_updated_at).toLocaleString() : "Unknown";
    element(panel,"p","Source updated: " + modified +
      " · Calculated: " + new Date(model.queried_at).toLocaleString(),"metrics-small-note");
  }
  async function refresh() {
    model = null;
    quality = null;
    errorMessage = "";
    qualityError = "";
    try {
      const {data,error} = await authClient.rpc("cosme_metrics_live_nursery_growth");
      if(error) throw error;
      if(!validateNurseryGrowth(data)) throw new Error("Unexpected aggregate data");
      model=data;
      try {
        const result=await authClient.rpc("cosme_metrics_live_nursery_quality");
        if(result.error)throw result.error;
        if(!validateNurseryQuality(result.data,model))throw new Error("Quality cohort mismatch");
        quality=result.data;
      } catch {
        qualityError="Growth variability checks are temporarily unavailable.";
      }
    } catch {
      errorMessage="Current nursery growth measurements are unavailable.";
    }
    render();
  }
  return {clear,refresh,render,isConnected:()=>Boolean(model),hasQuality:()=>Boolean(quality)};
}
