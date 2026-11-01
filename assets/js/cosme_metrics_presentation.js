// Presentation only: never mutate the authorised release or persist metric data.
const EMPTY_VALUE=/^(?:[-—–]|n\/?a|tbd|unknown|unavailable|unconfirmed|unverified|no (?:data|value)|not (?:yet )?(?:available|established|measured|provided|recorded|reported|verified|calculated)|records not verified|completion evidence outstanding|pending(?:\s.*)?)\.?$/i;
export function hasMetricValue(metric){
  if(["not_established","missing","unavailable"].includes(metric?.valueState))return false;
  const value=String(metric?.value??"").trim();
  return Boolean(value)&&!EMPTY_VALUE.test(value);
}
export function populatedMetrics(metrics){
  return metrics.filter(hasMetricValue);
}
export function concisePickStatus(message){
  if(message.startsWith("Shared project Top Picks"))return "";
  if(message.startsWith("Loading"))return "Loading…";
  if(message.startsWith("Saving"))return "Saving…";
  if(message==="Top Picks saved for every reader.")return "Saved";
  if(message.startsWith("Shared Top Picks are unavailable"))return "Selection unavailable";
  return message;
}
/** Optional private evidence comes only from the permission-gated release RPC. */
export function metricEvidence(value){
  if(!value||typeof value!=="object"||!Array.isArray(value.groups)
    ||!value.groups.length||value.groups.length>50)return null;
  const groups=value.groups;
  if(groups.some(g=>typeof g!=="string"||!g.trim()||g.length>180)
    ||new Set(groups).size!==groups.length)return null;
  if(typeof value.source!=="string"||!value.source.trim()
    ||typeof value.locator!=="string"||!value.locator.trim())return null;
  return {groups:[...groups],source:value.source,locator:value.locator,
    method:typeof value.method==="string"?value.method:""};
}
