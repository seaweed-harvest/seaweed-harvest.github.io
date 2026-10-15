// Human-facing raft and corresponding shore-farm aliases only. The stable MK-R1/MK-R2/MK-R3 site codes
// and historical Reef Nursery records remain unchanged.
const MKWIRO_RAFT_LABELS = Object.freeze({
  "MK-R1": Object.freeze({ siteName: "Rectangular Raft", raftName: "Raft C" }),
  "MK-R2": Object.freeze({ siteName: "Cascadia Prototype", raftName: "Raft A" }),
  "MK-R3": Object.freeze({ siteName: "LM / PIK Raft", raftName: "Raft B" }),
  "MK-SF1/R1": Object.freeze({ siteName: "Shore Farm 1", raftName: "Farm C" }),
  "MK-SF2/R2": Object.freeze({ siteName: "Shore Farm 2", raftName: "Farm A" }),
  "MK-SF3/R3": Object.freeze({ siteName: "Shore Farm 3", raftName: "Farm B" })
});

export function mkwiroRaftDisplayLabel(siteCode, siteName = "") {
  const code = String(siteCode || "").trim().toUpperCase();
  const item = MKWIRO_RAFT_LABELS[code];
  if (!item) return null;
  const name = String(siteName || "").trim() || item.siteName;
  return `${code} (${name}) | ${item.raftName}`;
}
