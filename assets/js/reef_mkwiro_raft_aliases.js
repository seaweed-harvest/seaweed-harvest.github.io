// Display-only community raft names. The site codes and stored site names
// remain unchanged so existing nursery measurements and history stay linked.
const MKWIRO_RAFT_ALIASES = Object.freeze({
  "MK-R1": "Raft C",
  "MK-R2": "Raft A",
  "MK-R3": "Raft C"
});

export function withMkwiroRaftAlias(siteCode, originalLabel) {
  const suffix = MKWIRO_RAFT_ALIASES[String(siteCode || "").trim().toUpperCase()];
  return suffix ? `${originalLabel} | ${suffix}` : originalLabel;
}
