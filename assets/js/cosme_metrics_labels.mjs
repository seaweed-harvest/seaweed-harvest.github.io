// Presentation-only COSME metric naming. Never edit immutable release titles or IDs.
// The explicit labels below were checked against the 1 November 2026 release.
const NAMED_VARIANTS = Object.freeze({
  // These four designs have different documented frames and should never be combined.
  "ON-0016":"Raft dimensions — Original concept (2025)",
  "ON-0034":"Raft dimensions — Living Machines (2026 as-built)",
  "ON-0064":"Raft dimensions — September 2025 prototype",
  "ON-0070":"Raft dimensions — KMFRI trial (2025–26)",
  "ON-0056":"Initial sample biomass — Mkwiro · Raft C (MK-R1)",
  "ON-0057":"Initial sample biomass — Mkwiro · Raft A (MK-R2)",
  "ON-0058":"Initial sample biomass — Mkwiro · Raft B (MK-R3)",
  "ON-0059":"Initial sample biomass — Mkwiro · Shore A (MK-SF2/R2)",
  "ON-0060":"Initial sample biomass — Mkwiro · Shore B (MK-SF3/R3)",
  "SDT-0006":"Table dimensions — Length",
  "SDT-0011":"Table dimensions — Width",
  "SDT-0042":"Table dimensions — Ground footprint",
  "SDT-0008":"Table dimensions — Drying area",
  "AGH-0014":"Bale dimensions — Compressed",
  "AGH-0054":"Bale dimensions — After release",
  "AGH-0053":"Bale mass — Specified",
  "AGH-0061":"Bale mass — Factory achieved",
  "MAW-0012":"Press productivity — Manual baseline (June)",
  "MAW-0027":"Press productivity — Powered target",
  "MAW-0065":"Press productivity — Post-upgrade measured",
  "MAW-0092":"Press productivity — Verified change",
  "MAW-0029":"RO water treatment — Rated capacity",
  "MAW-0064":"RO water treatment — Actual treated volume"
});

// Apply a site only when the validated indicator is explicitly sourced to MK-
// sites; never infer that an unlabelled raft belongs to Mkwiro or Tumbe.
export function metricDisplayName(metric) {
  const original=String(metric?.title??"").trim();
  if (!original) return "Untitled metric";
  if (Object.hasOwn(NAMED_VARIANTS,metric?.id)) return NAMED_VARIANTS[metric.id];
  if (metric?.operationalLive === true &&
      /^Daily growth comparison\s*[·—-]\s*Raft [ABC] vs Shore [ABC]$/i.test(original) &&
      /\bMK-R[123]\s*\/\s*MK-SF[123]\/R[123]\b/.test(String(metric.note||""))) {
    return original.replace(/^Daily growth comparison\s*[·—-]\s*/i,
      "Daily growth comparison — Mkwiro · ");
  }
  return original;
}

// Broad type groupings work across the whole register without inventing design
// provenance or rewriting the source wording when the evidence is ambiguous.
const TYPES = Object.freeze({
  "Offshore Nursery": [
    ["Raft dimensions", /\braft\b.*\bdimensions?\b|\bdimensions?\b.*\braft\b/i],
    ["Daily growth comparison", /daily growth comparison/i],
    ["Sample biomass", /initial net sample biomass|initial sample biomass|matched.*sample (?:mass|multiplication)|monitored offshore sample mass/i],
    ["Sample monitoring", /sample|weighing|rope.*measurement|growth weight|rope coverage|trial growth/i],
    ["Raft deployment and inspection", /deploy|commission|install|assembled|inspection|recovery|repair|mooring anchors/i],
    ["Raft design and configuration", /raft|mooring|cultivation|grow lines|grow-out|culture.line|rope.to.rope|flotation/i],
    ["Seedstock and planting", /seed|planting|harvest biomass|stocking/i],
    ["Nursery procurement", /invoice|cost|quote|supplier/i],
    ["Community and training", /group|farmer|diver|committee|training|community|survey/i],
    ["Nursery verification", /KMFRI|verification|trial|prototype/i]
  ],
  "Solar Drying Tables": [
    ["Table dimensions", /table dimensions|drying area|table length|table width|ground footprint|rack dimensions/i],
    ["Drying duration", /drying (?:time|duration|cycle)|dryer shed median|median.*duration|mean duration|fastest|within 5 days|within five days/i],
    ["Wet loading and mass reduction", /load|mass reduction|wet.weight reduction|initial recorded weight|final recorded weight|wet seaweed per sack/i],
    ["Temperature and drying conditions", /temperatur|VPD|humidity|weather|daytime uplift|night/i],
    ["Drying-table deployment", /deploy|install|assembl|prototype|construction|production tables|table count|tables accounted/i],
    ["Drying-table design", /frame|component|protection|life requirement|design|objective|drying levels/i],
    ["Drying-table costs", /cost|quote|material|financial/i],
    ["Farmer needs and outcomes", /groups|survey|farmer|challenges|transport/i],
    ["Drying quality and verification", /dry|quality|trial|acceptance|ingress/i]
  ],
  "Mawimbi": [
    ["Press productivity", /press productivity|pressing|manual press|labour productivity|productivity factor|extraction recovery/i],
    ["Press equipment and commissioning", /press|hydraulic|frame repair|frames repaired/i],
    ["Water quality", /borehole|water quality|water TDS|coliform|E\. coli|water series|water pH|water conductivity/i],
    ["RO water treatment", /RO |reverse osmosis|treatment water|treated.water|water cost|purchased.water|water spend|water purchase/i],
    ["QC instrumentation and records", /QC|quality.control|meter|Brix|product pH|retest/i],
    ["Seaweed collection", /collection|purchases|purchasing|incoming wet biomass|seller|supplying/i],
    ["Processing and extraction", /processing|pressed.liquid|liquid output|feedstock|batch|production input|traceab/i],
    ["Equipment and funding", /invoice|quote|funding|co.financing|allocation|agreement|package/i],
    ["Farmers and community", /farmer|groups|outreach|engagement/i],
    ["Delivery and operations", /installation|commission|training|service|repair|deadline|facility|software/i]
  ],
  "Aggregation Hub": [
    ["Bale dimensions", /bale dimensions/i],
    ["Bale mass", /bale mass|finished bale mass/i],
    ["Baling capacity and throughput", /baling|baler|bale production|bale completion|processing capacity|throughput|press.force/i],
    ["Storage and handling", /storage|warehouse|humidity|holding|handling|floor.plan|stack|intake/i],
    ["Hub deployment and readiness", /implement|delivery|install|test|handover|readiness|site selected|fit.out/i],
    ["Hub costs and funding", /cost|budget|BoQ|quotation|price|PO |purchase order/i],
    ["Commercial supply and impact", /buyer|commercial|market|sale|farmer|groups|shipment|stakeholder|supply/i],
    ["Hub design and equipment", /equipment|table|power|technical|design|chamber|product.life/i]
  ],
  "Off-bottom Farming": [
    ["Plot dimensions and layout", /plot dimensions|plot area|farm block size/i],
    ["Culture lines and rope", /culture line|culture rope|rope per plot|line spacing|line clearance/i],
    ["Seed and planting", /seed|tie|attachments/i],
    ["Harvest and output", /harvest/i],
    ["Farming method and equipment", /cultivation method|equipment|working process/i]
  ]
});
export function metricType(metric) {
  const activity=String(metric?.activity||"");
  const label=metricDisplayName(metric);
  for (const [type,pattern] of TYPES[activity]||[]) {
    if (pattern.test(label)) return type;
  }
  if (/cost|quote|invoice|budget|funding|price|financial/i.test(label))return "Costs and funding";
  if (/group|farmer|community|survey|training/i.test(label))return "Community and training";
  return "Other metrics";
}

export function withMetricPresentation(metric) {
  return {...metric,displayTitle:metricDisplayName(metric),metricType:metricType(metric)};
}
