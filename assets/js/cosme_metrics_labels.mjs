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
// Reviewed against all 347 metrics in the current COSME published register.
// Exceptions are keyed by immutable metric ID, not title substrings: e.g. a
// quote containing "raft" should remain a procurement metric, not raft design.
const TYPE_EXCEPTIONS = Object.freeze({
  "ON-0005":"Community and training",
  "ON-0010":"Site baseline and suitability",
  "ON-0013":"Site baseline and suitability",
  "ON-0014":"Site baseline and suitability",
  "ON-0019":"Raft design and configuration",
  "ON-0025":"Raft design and configuration",
  "ON-0044":"Raft deployment and inspection",
  "ON-0052":"Nursery procurement",
  "ON-0053":"Nursery procurement",
  "ON-0066":"Raft deployment and inspection",
  "ON-0072":"Raft design and configuration",
  "ON-R007":"Raft deployment and inspection",
  "SDT-0010":"Drying-table design",
  "SDT-0013":"Drying-table deployment",
  "SDT-0030":"Farmer needs and outcomes",
  "SDT-0031":"Farmer needs and outcomes",
  "SDT-0035":"Wet loading and mass reduction",
  "SDT-0036":"Wet loading and mass reduction",
  "SDT-0063":"Drying operations and cycle counts",
  "SDT-0064":"Drying operations and cycle counts",
  "SDT-R001":"Wet loading and mass reduction",
  "SDT-R003":"Temperature and drying conditions",
  "SDT-R005":"Drying-table costs",
  "SDT-R007":"Drying quality and verification",
  "MAW-0003":"Project context and objectives",
  "MAW-0005":"Processing and extraction",
  "MAW-0016":"RO water treatment",
  "MAW-0018":"RO water treatment",
  "MAW-0021":"RO water treatment",
  "MAW-0026":"Press equipment and commissioning",
  "MAW-0034":"Traceability and data management",
  "MAW-0041":"Delivery and operations",
  "MAW-0047":"Delivery and operations",
  "MAW-0048":"Delivery and operations",
  "MAW-0056":"Equipment and funding",
  "MAW-0083":"Seaweed collection",
  "MAW-0086":"Traceability and data management",
  "MAW-0088":"Traceability and data management",
  "MAW-0090":"Seaweed collection",
  "MAW-R005":"Processing and extraction",
  "AGH-0005":"Baling capacity and throughput",
  "AGH-0009":"Site baseline and constraints",
  "AGH-0013":"Hub operations and readiness",
  "AGH-0019":"Storage and handling",
  "AGH-0021":"Community and stakeholder engagement",
  "AGH-0025":"Hub procurement and delivery",
  "AGH-0026":"Hub procurement and delivery",
  "AGH-0027":"Hub procurement and delivery",
  "AGH-0032":"Hub costs and funding",
  "AGH-0039":"Hub operations and readiness",
  "AGH-0041":"Quality and acceptance",
  "AGH-0043":"Baler equipment and maintenance",
  "AGH-0044":"Baler equipment and maintenance",
  "AGH-0045":"Baler equipment and maintenance",
  "AGH-0048":"Commercial supply and impact",
  "AGH-0050":"Site baseline and constraints",
  "AGH-0051":"Quality and acceptance",
  "AGH-0055":"Baler equipment and maintenance",
  "AGH-0060":"Hub costs and funding"
});
const TYPES = Object.freeze({
  "Offshore Nursery": [
    ["Raft dimensions", /\braft\b.*\bdimensions?\b|\bdimensions?\b.*\braft\b/i],
    ["Daily growth comparison", /daily growth comparison/i],
    ["Sample biomass", /initial net sample biomass|initial sample biomass|matched.*sample (?:mass|multiplication)|monitored offshore sample mass/i],
    ["Sample monitoring", /sample|weighing|rope.*measurement|growth weight|rope coverage|trial growth/i],
    ["Nursery procurement", /invoice|cost|quote|supplier/i],
    ["Raft deployment and inspection", /deploy|commission|install|assembled|inspection|recovery|repair|mooring anchors/i],
    ["Raft design and configuration", /raft|mooring|cultivation|grow lines|grow-out|culture.line|rope.to.rope|flotation/i],
    ["Seedstock and planting", /seed|planting|harvest biomass|stocking/i],
    ["Site baseline and suitability", /deep.water|site suitab|site depths|water depth/i],
    ["Community and training", /group|farmer|diver|committee|training|community|survey/i],
    ["Nursery verification", /KMFRI|verification|trial|prototype/i]
  ],
  "Solar Drying Tables": [
    ["Drying-table costs", /cost|quote|financial|quoted materials/i],
    ["Table dimensions", /table dimensions|drying area|table length|table width|ground footprint|rack dimensions/i],
    ["Drying duration", /drying (?:time|duration)|dryer shed median|median.*duration|mean duration|fastest|within 5 days|within five days/i],
    ["Drying operations and cycle counts", /completed.*(?:drying cycles|bay records)|drying cycles completed/i],
    ["Wet loading and mass reduction", /load|mass reduction|wet.weight reduction|initial recorded weight|final recorded weight|wet seaweed per sack/i],
    ["Drying-table design", /frame|component|protection|life requirement|design|objective|drying levels/i],
    ["Temperature and drying conditions", /temperatur|VPD|humidity|weather.model|daytime uplift|night/i],
    ["Drying-table deployment", /deploy|install|assembl|prototype|construction|production tables|table count|tables accounted/i],
    ["Farmer needs and outcomes", /groups|survey|farmer|challenges|transport/i],
    ["Drying quality and verification", /dry|quality|trial|acceptance|ingress/i]
  ],
  "Mawimbi": [
    ["Water quality", /borehole|water quality|water TDS|coliform|E\. coli|water series|water pH|water conductivity/i],
    ["RO water treatment", /(?:^|\W)RO(?:\W|$)|reverse osmosis|treatment water|treated.water|water cost|purchased.water|water spend|water purchase/i],
    ["Equipment and funding", /invoice|quote|funding|co.financing|allocation|agreement|package/i],
    ["Press productivity", /press productivity|manual press(?:ing)?\b|labour productivity|productivity factor|extraction recovery/i],
    ["Press equipment and commissioning", /\bpress(?:es|ing)?\b|hydraulic|frame repair|frames repaired/i],
    ["QC instrumentation and records", /QC|quality.control|meter|Brix|product pH|retest/i],
    ["Seaweed collection", /collection|purchases|purchasing|incoming wet biomass|seller|supplying/i],
    ["Processing and extraction", /processing|pressed.liquid|liquid output|feedstock|batch|production input|traceab/i],
    ["Farmers and community", /farmer|groups|outreach|engagement/i],
    ["Traceability and data management", /software|data|traceability|historical stock/i],
    ["Delivery and operations", /installation|commission|training|service|repair|deadline|facility|proposal/i]
  ],
  "Aggregation Hub": [
    ["Bale dimensions", /bale dimensions/i],
    ["Bale mass", /bale mass|finished bale mass/i],
    ["Hub costs and funding", /cost|budget|BoQ|quotation|price|PO |purchase order/i],
    ["Baling capacity and throughput", /baling throughput|bale production|bale completion|processing capacity|throughput|equivalent mass rate|bale.*cycle time/i],
    ["Baler equipment and maintenance", /\bbaler\b|baling equipment|press.force|hydraulic/i],
    ["Storage and handling", /storage|warehouse|humidity|holding|handling|floor.plan|stack|intake/i],
    ["Hub procurement and delivery", /delivery|install|planned fabrication/i],
    ["Hub deployment and readiness", /implement|test|handover|readiness|site selected|fit.out/i],
    ["Commercial supply and impact", /buyer|commercial|market|sale|farmer|groups|shipment|stakeholder|supply/i],
    ["Hub design and equipment", /equipment|table|power|technical|design|chamber|product.life/i],
    ["Hub operations and readiness", /operating|operation|pilot/i],
    ["Site baseline and constraints", /constraint|site before|quality threats/i],
    ["Quality and acceptance", /moisture|quality|acceptance/i],
    ["Community and stakeholder engagement", /assessment|engagement|consultation/i]
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
  if (Object.hasOwn(TYPE_EXCEPTIONS,metric?.id)) return TYPE_EXCEPTIONS[metric.id];
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
