// Pure transformations only. No authentication, storage, network or database access.
export function normalizeReleaseItems(items) {
  return (Array.isArray(items) ? items : []).map(record => {
    const raw=record.frozen||{}, original=raw.original||{};
    return {
      id:String(record.metric_id||""),
      activity:String(raw.activity||original.sheet||"Unassigned"),
      theme:String(raw.theme||original.theme||""),
      title:String(raw.title||original.metric||"Untitled metric"),
      value:raw.value===null||raw.value===undefined?String(original.value??""):String(raw.value),
      unit:String(raw.unit??original.unit??""),
      verification:String(raw.verification||raw.original_evidence||original.evidence||"Unreviewed"),
      featured:Boolean(raw.featured??(original.pick==="Top Pick")),
      source:String(raw.source||original.source||""),
      note:String(raw.note||original.note||""),
      basis:String(raw.claim_basis||"Reference"),
      sourceMode:String(raw.source_mode||"Reference"),
      originalEvidence:String(raw.original_evidence??original.evidence??""),
      sourceRow:original.row==null?"":String(original.row),
      sourceSheet:String(original.sheet||raw.activity||""),
      valueState:String(raw.value_state||"Unspecified"),
      asOf:String(raw.as_of||"Unspecified")
    };
  });
}
/** Filtering operates only on the previously authorised frozen register. */
export function selectMetrics(metrics,{
  query="",activity="",verification="",featured=false,categories=[],sort="id",direction="asc"
}={}) {
  const q=String(query).toLocaleLowerCase().trim();
  const selected=new Set(Array.isArray(categories)?categories:[]);
  const filtered=metrics.filter(m=>
    (!activity||m.activity===activity)
    &&(!verification||m.verification===verification)
    &&(!featured||m.featured)
    &&(!selected.size||selected.has(m.theme))
    &&(!q||[m.id,m.title,m.note,m.source,m.value,m.unit,m.theme].join(" ").toLocaleLowerCase().includes(q))
  );
  const allowed=["id","title","activity","theme","value","unit","source","note","verification","asOf","dataKind"];
  const sortKey=allowed.includes(sort)?sort:"id";
  const sign=direction==="desc"?-1:1;
  return filtered.sort((a,b)=>{
    if(sortKey==="value"){
      const aEmpty=!String(a.value??"").trim();
      const bEmpty=!String(b.value??"").trim();
      if(aEmpty!==bEmpty)return aEmpty?1:-1; // Missing values always last.
      const aNumber=sortableMetricNumber(a.value),bNumber=sortableMetricNumber(b.value);
      if(aNumber!==null&&bNumber!==null&&aNumber!==bNumber)return sign*(aNumber-bNumber);
      if((aNumber===null)!==(bNumber===null))return aNumber===null?1:-1;
    }
    const cmp=String(a[sortKey]??"").localeCompare(String(b[sortKey]??""),undefined,{numeric:sortKey!=="value",sensitivity:"base"});
    return sign*cmp||String(a.id).localeCompare(String(b.id),undefined,{numeric:true});
  });
}

function formattedNumber(number){
  const original=String(number);
  const match=/^([+-]?)(\d+)(\.\d+)?$/.exec(original.replace(/,/g,""));
  if(!match)return original;
  return match[1]+match[2].replace(/\B(?=(\d{3})+(?!\d))/g,",")+(match[3]||"");
}

/** Format only clearly numeric expressions. Preserve original precision and text. */
function numericExpression(raw){
  const text=String(raw??"").trim();
  if(/^[+-]?\d[\d,]*(?:\.\d+)?$/.test(text))return formattedNumber(text);
  const range=/^([+-]?\d[\d,]*(?:\.\d+)?)\s*[-–—]\s*([+-]?\d[\d,]*(?:\.\d+)?)$/.exec(text);
  if(range)return formattedNumber(range[1])+"–"+formattedNumber(range[2]);
  const parts=text.split(/\s*[×]\s*/);
  if(parts.length>1&&parts.length<=4&&parts.every(p=>/^[+-]?\d[\d,]*(?:\.\d+)?$/.test(p))){
    return parts.map(formattedNumber).join(" × ");
  }
  return null;
}
function sortableMetricNumber(value){
  const raw=String(value??"").trim();
  if(/^[+-]?\d[\d,]*(?:\.\d+)?$/.test(raw))return Number(raw.replace(/,/g,""));
  const range=/^([+-]?\d[\d,]*(?:\.\d+)?)\s*[-–—]\s*[+-]?\d[\d,]*(?:\.\d+)?$/.exec(raw);
  if(range)return Number(range[1].replace(/,/g,""));
  return null;
}

/** Display-only value formatting; does not alter frozen values or CSV exports. */
export function displayMetricValue(value,unit=""){
  const raw=String(value??"").trim();
  const originalUnit=String(unit??"").trim();
  if(!raw)return {value:"—",unit:"",full:"Not recorded",missing:true,numeric:false};
  const numeric=numericExpression(raw);
  if(numeric===null)return {value:raw,unit:"",full:raw,missing:false,numeric:false};
  const currency=/^(KES|CAD|AUD|USD|GBP|EUR)(?:\s*\/\s*(.+))?$/i.exec(originalUnit);
  if(currency){
    const code=currency[1].toUpperCase();
    const suffix=currency[2]?" / "+currency[2].trim():"";
    return {value:code+" "+numeric,unit:suffix,full:code+" "+numeric+suffix,missing:false,numeric:true};
  }
  if(originalUnit==="%")return {value:numeric+"%",unit:"",full:numeric+"%",missing:false,numeric:true};
  // Keep dimensional labels in Details while preserving a tidy inline unit.
  const unitCompact=originalUnit.replace(/^(mm|cm|m)\s*\(L\s*[×x]\s*W\s*[×x]\s*H\)$/i,"$1");
  return {value:numeric,unit:unitCompact,full:numeric+(unitCompact?" "+unitCompact:""),missing:false,numeric:true};
}

/** A workbook citation to Harvest data is historical, never proof of a live link. */
export function sourceLabel(metric) {
  if(metric?.liveValidated===true) return "Live";
  const src=String(metric?.source||"").toLowerCase();
  if (src.includes("snapshot") || (src.includes("seaweed harvest") && src.includes("reviewed"))) return "Snapshot";
  return "Reference";
}
export function safeCsvCell(value) {
  let s=String(value??"");
  // Excel/Sheets can evaluate formulas even after leading whitespace. Do not
  // trust workbook text, notes or other imported expressions as CSV formulae.
  const first=s.trimStart().charAt(0);
  if(first && "=+-@".includes(first)) s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
export function exportSelectedCsv(metrics,version) {
  const header=["Metric ID","Activity","Theme","Metric","Value","Unit","Verification","Source","Note","Published Version"];
  const rows=metrics.map(m=>[m.id,m.activity,m.theme,m.title,m.value,m.unit,m.verification,m.source,m.note,version||""]);
  return "\uFEFF"+[header,...rows].map(row=>row.map(safeCsvCell).join(",")).join("\r\n");
}

/**
 * Parse a published release selected by a user. Fail closed on malformed or
 * out-of-range values; never send unvalidated version parameters to RPCs.
 */
export function parseReleaseVersion(value) {
  const match=/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(value??""));
  if(!match) return null;
  const version=[Number(match[1]),Number(match[2])];
  return version.every(Number.isSafeInteger)?version:null;
}

/** Presentation-only metadata: do not overwrite the immutable original release. */
const CURATED = Object.freeze({
  "SDT-0022":"Measured","SDT-0023":"Measured","SDT-0063":"Measured",
  "SDT-0064":"Measured","SDT-0065":"Measured","SDT-0066":"Measured",
  "ON-0054":"Snapshot","ON-0056":"Measured","ON-0057":"Measured","ON-0058":"Measured",
  "AGH-0029":"Estimate","AGH-0031":"Historical budget","AGH-0060":"Purchase order",
  "MAW-0049":"Funding cap","MAW-0050":"Quotation","MAW-0053":"Quotation"
});

// Explicit classifications transcribed from frozen source notes. They describe
// the document/value basis, NEVER confirmation that money was actually paid.
// This is presentation metadata; original release JSON remains unchanged.
export const FINANCIAL_REVIEW = Object.freeze({
  "AGH-0029":{type:"Working estimate",caveat:"Working BoQ; differs from the PDF amount and is not reconciled expenditure."},
  "AGH-0030":{type:"Quotation",caveat:"Carpenter quotation; delivery and payment are not confirmed."},
  "AGH-0031":{type:"Historical budget",caveat:"Previously listed allocation; current approval and expenditure are not verified."},
  "AGH-0032":{type:"Actuals unavailable",caveat:"No reconciled final cost ledger; do not sum quotes, BoQ and purchase orders."},
  "AGH-0033":{type:"Not calculated",caveat:"Requires actual operating costs and verified processed tonnes."},
  "AGH-0060":{type:"Purchase order",caveat:"PO amount; delivery, acceptance and settlement not established."},
  "MAW-0049":{type:"Funding cap",caveat:"Maximum agreement amount, not confirmed eligible expenditure."},
  "MAW-0050":{type:"Supplier quotations",caveat:"Combined quotations; not confirmed expenditure or final amount paid."},
  "MAW-0051":{type:"Planned allocation",caveat:"Agreement annex allocation; press cost-sharing wording still requires reconciliation."},
  "MAW-0052":{type:"Planned co-financing",caveat:"Planned RO co-financing, not verified cash payment."},
  "MAW-0053":{type:"Quotation",caveat:"Powered-press quotation; cost-share and payment not confirmed."},
  "MAW-0054":{type:"Quotation",caveat:"Frame repair quotation for six frames."},
  "MAW-0055":{type:"Quotation",caveat:"Powered conversion quotation; not confirmed as paid."},
  "MAW-0056":{type:"Invoice",caveat:"Invoice amount; invoice alone does not prove payment."},
  "MAW-0057":{type:"Invoice",caveat:"RO instalment invoices; bank settlement not independently confirmed."},
  "MAW-0058":{type:"Quotation",caveat:"Separate facilitation quotation; check overlap and budget eligibility."},
  "MAW-0059":{type:"Historical unit cost",caveat:"Derived from a prior purchased-water invoice, not current RO operating cost."},
  "ON-0051":{type:"Invoice",caveat:"Prototype supplier invoice; includes materials and logistics, not confirmed payment."},
  "ON-0052":{type:"Invoice",caveat:"Three-raft supplier invoice; mooring/logistics included, concrete blocks excluded."},
  "ON-0053":{type:"Invoice-derived average",caveat:"Rounded invoice total divided by three; not a standalone per-raft fabrication cost."}
});
export function financialContext(metric){
  return FINANCIAL_REVIEW[metric?.id] || null;
}

export const HEADLINE_IDS = Object.freeze([
  "SDT-0063","SDT-0022","SDT-0065",
  "ON-0054","ON-0056","ON-0057",
  "AGH-0029","AGH-0060","AGH-0031",
  "MAW-0049","MAW-0050","MAW-0053"
]);
export function metricValueType(metric) {
  if (Object.hasOwn(FINANCIAL_REVIEW,metric?.id)) return FINANCIAL_REVIEW[metric.id].type;
  if (Object.hasOwn(CURATED,metric?.id)) return CURATED[metric.id];
  // Avoid inferring actual expenditure from a financial category alone.
  return "Not classified";
}
export function headlineMetrics(metrics) {
  const lookup=new Map(metrics.map(m=>[m.id,m]));
  return HEADLINE_IDS.map(id=>lookup.get(id)).filter(Boolean);
}

/**
 * Current wet-weight reduction derived from one validated wet/final run cohort.
 * This is loss of recorded wet mass, NOT independently measured moisture content.
 */
export function currentDryerWeightReduction(summary) {
  const wet=summary?.wet_kg, final=summary?.final_kg;
  if(!Number.isFinite(wet)||!Number.isFinite(final)||wet<=0||final<0||final>wet) return null;
  return Math.round(((wet-final)/wet)*10000)/100;
}
