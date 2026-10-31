// Shared selections use the existing authenticated client, never browser storage.
// The backend independently authorises reads and owner/editor writes.
export function validatePickState(data, ids) {
  if (!data || typeof data.can_edit !== "boolean" || !Array.isArray(data.picks)
      || data.picks.length !== ids.size) return false;
  const seen=new Set();
  return data.picks.every(p=>{
    if (!ids.has(p.metric_id)||seen.has(p.metric_id)||typeof p.featured!=="boolean"
        ||!Number.isSafeInteger(p.revision)||p.revision<0) return false;
    seen.add(p.metric_id);
    return true;
  });
}

export function createSharedPicks(client, changed) {
  let generation=0, version=null, records=new Map(), canEdit=false, ready=false;
  const pending=new Set();
  let message="Loading shared Top Picks…";
  function notify(){ changed(); }
  function clear(){
    generation++; version=null; records.clear(); pending.clear(); canEdit=false;
    ready=false; message="Loading shared Top Picks…";
  }
  async function load(release,metrics){
    clear();
    const token=generation;
    version=[release.major,release.minor];
    const ids=new Set(metrics.map(m=>m.id));
    notify();
    try {
      const {data,error}=await client.rpc("cosme_metrics_get_picks",{
        p_major:version[0],p_minor:version[1]
      });
      if(token!==generation) return;
      if(error||!validatePickState(data,ids)) throw new Error("Invalid shared selection");
      records=new Map(data.picks.map(p=>[p.metric_id,p]));
      canEdit=data.can_edit; ready=true;
      message=canEdit?"Shared project Top Picks · select a star to update them for every reader.":
        "Shared project Top Picks · changes require current-release owner or editor access.";
    } catch {
      if(token!==generation) return;
      message="Shared Top Picks are unavailable. Showing published picks; editing is disabled.";
    }
    notify();
  }
  async function toggle(id){
    if(!ready||!canEdit||pending.size||!records.has(id)) return false;
    const previous=records.get(id), token=generation, selectedVersion=[...version];
    pending.add(id); message="Saving shared Top Picks…"; notify();
    try {
      const {data,error}=await client.rpc("cosme_metrics_set_pick",{
        p_major:selectedVersion[0],p_minor:selectedVersion[1],p_metric_id:id,
        p_featured:!previous.featured,p_expected_revision:previous.revision
      });
      if(token!==generation) return false;
      if(error) throw error;
      if(data?.metric_id!==id||data.featured!==!previous.featured||
          data.revision!==previous.revision+1) throw new Error("Invalid save acknowledgement");
      records.set(id,data);
      message="Top Picks saved for every reader.";
      // Read back all selections, including changes made by another editor.
      try {
        const result=await client.rpc("cosme_metrics_get_picks",{
          p_major:selectedVersion[0],p_minor:selectedVersion[1]
        });
        if(token!==generation) return false;
        if(result.error||!validatePickState(result.data,new Set(records.keys()))) throw new Error("Refresh failed");
        records=new Map(result.data.picks.map(p=>[p.metric_id,p]));
        canEdit=result.data.can_edit;
      } catch {
        if(token!==generation) return false;
        message="Your Top Pick was saved. Refresh to check other editors’ changes.";
      }
      return true;
    } catch {
      if(token!==generation) return false;
      // A transport failure may occur after a committed write. Re-read before
      // offering another edit, rather than retrying an uncertain mutation.
      ready=false; canEdit=false;
      message="The shared change could not be confirmed. Reload the selection before editing again.";
      return false;
    } finally {
      if(token===generation){pending.delete(id);notify();}
    }
  }
  return {
    load,clear,toggle,
    apply:metrics=>metrics.map(m=>({...m,featured:records.get(m.id)?.featured??m.publishedFeatured??m.featured})),
    editable:()=>ready&&canEdit&&!pending.size,
    busy:id=>pending.has(id),
    message:()=>message
  };
}
