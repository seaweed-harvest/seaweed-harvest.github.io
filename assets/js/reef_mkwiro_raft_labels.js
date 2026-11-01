// Human-facing raft and corresponding shore-farm aliases only. The stable MK-R1/MK-R2/MK-R3 site codes
// and historical Reef Nursery records remain unchanged.
const MKWIRO_RAFT_LABELS = Object.freeze({
  "MK-R1": Object.freeze({ siteName: "Rectangular Raft", raftName: "Raft C" }),
  "MK-R2": Object.freeze({ siteName: "Cascadia Prototype", raftName: "Raft A" }),
  "MK-R3": Object.freeze({ siteName: "LM / PIK Raft", raftName: "Raft B" }),
  "MK-SF1/R1": Object.freeze({ siteName: "Shore Farm 1", raftName: "Shore C" }),
  "MK-SF2/R2": Object.freeze({ siteName: "Shore Farm 2", raftName: "Shore A" }),
  "MK-SF3/R3": Object.freeze({ siteName: "Shore Farm 3", raftName: "Shore B" })
});

export function mkwiroRaftDisplayLabel(siteCode, siteName = "") {
  const code = String(siteCode || "").trim().toUpperCase();
  const item = MKWIRO_RAFT_LABELS[code];
  if (!item) return null;
  // Stable source code and original site name remain available on the record.
  // Show the concise operational name in all current records and analysis UIs.
  return item.raftName;
}

const MKWIRO_MONITORING_PAIRS = Object.freeze({
  "A": Object.freeze({ raftCode: "MK-R2", farmCode: "MK-SF2/R2" }),
  "B": Object.freeze({ raftCode: "MK-R3", farmCode: "MK-SF3/R3" }),
  "C": Object.freeze({ raftCode: "MK-R1", farmCode: "MK-SF1/R1" })
});

// Returns both related sites from either site code; no database keys change.
export function pairedMkwiroSites(siteCode) {
  const code = String(siteCode || "").trim().toUpperCase();
  for (const [group, sites] of Object.entries(MKWIRO_MONITORING_PAIRS)) {
    if (code === sites.raftCode || code === sites.farmCode) {
      return { group, raftCode: sites.raftCode, farmCode: sites.farmCode };
    }
  }
  return null;
}

/** Human-facing operational names for both nursery locations; source site codes remain unchanged. */
export function nurserySiteDisplayLabel(siteCode,siteName=""){
  const code=String(siteCode||"").trim().toUpperCase();
  if(code==="TB-R1")return "Tumbe · Raft A";
  if(code==="TB-SF1/R1")return "Tumbe · Shore A";
  return mkwiroRaftDisplayLabel(code,siteName);
}
