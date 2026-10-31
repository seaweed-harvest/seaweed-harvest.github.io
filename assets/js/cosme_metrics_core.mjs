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
export function selectMetrics(metrics,{query="",activity="",verification="",featured=false,sort="id"}={}) {
  const q=String(query).toLocaleLowerCase().trim();
  const filtered=metrics.filter(m=>(!activity||m.activity===activity)&&(!verification||m.verification===verification)&&(!featured||m.featured)&&
    (!q||[m.id,m.title,m.note,m.source,m.value,m.theme].join(" ").toLocaleLowerCase().includes(q)));
  const sortKey=["id","title","activity"].includes(sort)?sort:"id";
  return filtered.sort((a,b)=>String(a[sortKey]).localeCompare(String(b[sortKey]),undefined,{numeric:true}));
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
