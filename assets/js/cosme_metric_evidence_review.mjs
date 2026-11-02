import {linkedProjectPhotos,draftProjectPhotos,visibleMetricDrafts,isMetricId} from "./cosme_metric_evidence_review_core.mjs?v=1";

const make=(tag,text="",className="")=>{
  const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;
};
const append=(parent,tag,text="",className="")=>{
  const el=make(tag,text,className);parent.append(el);return el;
};
const check=reply=>{
  if(reply.error)throw reply.error;
  return reply.data;
};
const PRIVATE_BUCKET="cosme-project-library";

export function createMetricEvidenceReview(client,photoRoot,draftsRoot){
  let epoch=0,metricEpoch=0,cache=null,cachePromise=null,loadedDrafts=false;
  let activeMetric=null;
  function clear(){
    epoch++;metricEpoch++;cache=null;cachePromise=null;loadedDrafts=false;activeMetric=null;
    photoRoot.replaceChildren();photoRoot.hidden=true;
    draftsRoot.replaceChildren();
  }
  async function references(){
    if(cache)return cache;
    if(cachePromise)return cachePromise;
    const ticket=epoch;
    cachePromise=(async()=>{
      const [links,library]=await Promise.all([
        client.rpc("cosme_mcp_metric_photo_links"),
        client.rpc("cosme_library_list",{p_kind:"photos"})
      ]);
      const data={
        links:check(links),photos:check(library)?.items||[]
      };
      if(!Array.isArray(data.links)||!Array.isArray(data.photos))
        throw Error("Invalid metric photo references");
      if(ticket===epoch)cache=data;
      return data;
    })();
    try{return await cachePromise}
    finally{if(ticket===epoch)cachePromise=null}
  }
  async function photoLink(parent,item,ticket,detailTicket=null){
    const article=append(parent,"article","","metric-reference-photo");
    append(article,"p",item.title||"Project photo","metric-reference-photo-title");
    const img=append(article,"img");
    img.loading="lazy";img.alt=item.title||"Linked project photo";
    if(item.caption)append(article,"p",item.caption,"metrics-small-note");
    const open=append(article,"a","Open photo","metrics-button");
    open.target="_blank";open.rel="noopener noreferrer";open.hidden=true;
    try{
      const response=await client.storage.from(PRIVATE_BUCKET)
        .createSignedUrl(item.object_path,60);
      if(response.error)throw response.error;
      if(ticket!==epoch || (detailTicket!==null && detailTicket!==metricEpoch)
        || !article.isConnected)return;
      const url=response.data?.signedUrl;
      if(typeof url!=="string"||!url.startsWith("https://"))
        throw Error("Invalid photo link");
      img.src=url;open.href=url;open.hidden=false;
    }catch{
      if(ticket===epoch && (detailTicket===null||detailTicket===metricEpoch)
        &&article.isConnected){
        img.remove();open.remove();
        append(article,"p","Preview unavailable. Open the Photos tab to try again.","metrics-small-note");
      }
    }
  }
  async function openMetric(metricId){
    activeMetric=metricId;
    const detailTicket=++metricEpoch,ticket=epoch;
    photoRoot.replaceChildren();photoRoot.hidden=true;
    if(!isMetricId(metricId))return;
    try{
      const {links,photos}=await references();
      if(ticket!==epoch||detailTicket!==metricEpoch||activeMetric!==metricId)return;
      const matches=linkedProjectPhotos(metricId,links,photos);
      if(!matches.length)return;
      photoRoot.hidden=false;
      append(photoRoot,"h3","Linked project photos");
      append(photoRoot,"p","Current references · separate from frozen release evidence.","metrics-small-note");
      const gallery=append(photoRoot,"div","","metric-reference-gallery");
      for(const photo of matches.slice(0,20))
        void photoLink(gallery,photo,ticket,detailTicket);
      if(matches.length>20)
        append(photoRoot,"p","Additional linked photos are available in Project Photos.","metrics-small-note");
    }catch{
      if(ticket===epoch&&detailTicket===metricEpoch){
        photoRoot.hidden=false;
        append(photoRoot,"p","Linked photo references are not available on this server yet.","metrics-small-note");
      }
    }
  }
  function closeMetric(){
    activeMetric=null;metricEpoch++;photoRoot.replaceChildren();photoRoot.hidden=true;
  }
  async function loadDrafts(){
    const ticket=epoch;
    draftsRoot.replaceChildren();
    append(draftsRoot,"p","Loading proposals…","metrics-small-note");
    try{
      const [result,{links,photos}]=await Promise.all([
        client.rpc("cosme_mcp_metric_draft_list"),references()
      ]);
      if(ticket!==epoch)return;
      const rows=visibleMetricDrafts(check(result));
      draftsRoot.replaceChildren();
      const head=append(draftsRoot,"div","","metric-proposals-heading");
      append(head,"h3","MCP metric proposals");
      append(head,"p","Unpublished drafts. Published releases remain unchanged.","metrics-small-note");
      if(!rows.length) {
        append(draftsRoot,"p","No metric proposals have been saved.","metrics-small-note");
        loadedDrafts=true;return;
      }
      append(draftsRoot,"p",rows.length+" proposals · review only","metrics-small-note");
      const list=append(draftsRoot,"div","","metric-proposals-list");
      for(const row of rows.slice(0,150)){
        const item=append(list,"article","","metric-proposal-card");
        const heading=append(item,"div","","metric-proposal-title");
        append(heading,"strong",row.title);
        const status=({
          draft:"Draft",ready_for_review:"Ready for review",
          approved:"Approved · not published"
        })[row.review_status]||"Review state unavailable";
        append(heading,"span",status+" · revision "+row.revision,"metrics-small-note");
        const label=row.target_metric_id?"Proposed update · "+row.target_metric_id:"Proposed new metric";
        append(item,"p",row.activity+" · "+label,"metrics-small-note");
        if(row.metric_value){
          append(item,"p",row.metric_value+(row.unit?" "+row.unit:""),"metric-proposal-value");
        }
        if(row.notes)append(item,"p",row.notes,"metric-proposal-notes");
        if(row.review_notes)append(item,"p","Review: "+row.review_notes,"metrics-small-note");
        const source=row.live_source;
        if(source&&source.organisation_code==="MAWIMBI"&&source.dataset==="processing"){
          append(item,"p","Linked source: Mawimbi processing · "+
            source.measure+" · "+source.from_date+" to "+source.to_date+
            " (not recalculated on this screen)","metrics-small-note");
        }
        const matches=draftProjectPhotos(row.id,links,photos);
        if(matches.length){
          const details=append(item,"details","","metric-proposal-evidence");
          append(details,"summary",matches.length+" attached "+
            (matches.length===1?"photo":"photos"));
          const gallery=append(details,"div","","metric-reference-gallery");
          // URLs are requested only when the user opens an evidence section.
          details.addEventListener("toggle",()=>{
            if(details.open&&!details.dataset.loaded){
              details.dataset.loaded="true";
              for(const photo of matches.slice(0,20))void photoLink(gallery,photo,ticket);
            }
          });
        }
      }
      if(rows.length>150)append(draftsRoot,"p","Showing the first 150 recent proposals.","metrics-small-note");
      loadedDrafts=true;
    }catch{
      if(ticket===epoch){
        draftsRoot.replaceChildren();
        append(draftsRoot,"p","Metric proposals are not available on this server yet.","metrics-small-note");
      }
    }
  }
  return {clear,openMetric,closeMetric,loadDrafts,
    refreshDrafts:()=>{loadedDrafts=false;cache=null;return loadDrafts()},
    draftsLoaded:()=>loadedDrafts};
}
