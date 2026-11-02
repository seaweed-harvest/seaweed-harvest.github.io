// Pure helpers for displaying MCP metric draft proposals and linked project photos.
// Never treats a proposed value as a published or verified live metric.
export const isMetricId = id => typeof id==="string" &&
  /^(?:LIVE-)?[A-Z]{2,8}-[A-Z0-9-]{2,32}$/.test(id);
export const isUuid = id => typeof id==="string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export function linkedProjectPhotos(metricId,links,photos){
  if(!isMetricId(metricId) || !Array.isArray(links)||!Array.isArray(photos))return [];
  const photoById=new Map(photos.filter(p=>p?.kind==="photos" &&
    p.status==="ready" && isUuid(p.id) && typeof p.object_path==="string"
  ).map(p=>[p.id,p]));
  const seen=new Set();
  return links.filter(l=>l?.metric_id===metricId && isUuid(l.photo_id))
    .map(l=>photoById.get(l.photo_id)).filter(p=>{
      if(!p || seen.has(p.id))return false;
      seen.add(p.id);return true;
    });
}
export function draftProjectPhotos(draftId,links,photos){
  if(!isUuid(draftId) || !Array.isArray(links)||!Array.isArray(photos))return [];
  const byId=new Map(photos.filter(p=>p?.kind==="photos" &&
    p.status==="ready" && isUuid(p.id) && typeof p.object_path==="string"
  ).map(p=>[p.id,p]));
  const seen=new Set();
  return links.filter(l=>l?.draft_id===draftId && isUuid(l.photo_id))
    .map(l=>byId.get(l.photo_id)).filter(p=>{
      if(!p||seen.has(p.id))return false;
      seen.add(p.id);return true;
    });
}
export function visibleMetricDrafts(items){
  if(!Array.isArray(items))return [];
  return items.filter(d=>d && isUuid(d.id) &&
    typeof d.title==="string" && typeof d.activity==="string" &&
    Number.isInteger(d.revision) && d.revision>=1)
    .sort((a,b)=>String(b.updated_at||b.created_at||"").localeCompare(
      String(a.updated_at||a.created_at||""))||a.title.localeCompare(b.title));
}
