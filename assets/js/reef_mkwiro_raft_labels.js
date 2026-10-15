// Human-facing aliases only. The stable MK-R1/MK-R2/MK-R3 site codes
// and historical Reef Nursery records remain unchanged.
const MKWIRO_RAFT_LABELS = Object.freeze({
  "MK-R1": Object.freeze({ siteName: "Rectangular Raft", raftName: "Raft C" }),
  "MK-R2": Object.freeze({ siteName: "Cascadia Prototype", raftName: "Raft A" }),
  "MK-R3": Object.freeze({ siteName: "LM / PIK Raft", raftName: "Raft B" })
});

export function mkwiroRaftDisplayLabel(siteCode, siteName = "") {
  const code = String(siteCode || "").trim().toUpperCase();
  const item = MKWIRO_RAFT_LABELS[code];
  if (!item) return null;
  const name = String(siteName || "").trim() || item.siteName;
  return `${code} (${name}) | ${item.raftName}`;
}
