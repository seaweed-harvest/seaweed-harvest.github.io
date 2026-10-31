// Owner-only review of stock batch -> processing session evidence links.
// Same-day matches are suggestions only. No link is created automatically.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validDate=x=>typeof x==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x));
const count=x=>Number.isSafeInteger(x)&&x>=0;
const add=(parent,tag,text,cls="")=>{
  const e=document.createElement(tag);
  if(text!==undefined)e.textContent=String(text);
  if(cls)e.className=cls;
  parent.append(e);
  return e;
};
export function validateMawimbiTraceability(data){
 if(!data||data.can_view!==true||!count(data.total_batches)||!count(data.confirmed_links)
   ||!count(data.same_day_candidates)||!count(data.unmatched_batches)
   ||data.total_batches!==data.confirmed_links+data.same_day_candidates+data.unmatched_batches
   ||!Array.isArray(data.rows)||data.rows.length>100
   ||!Number.isFinite(Date.parse(data.queried_at)))return false;
 const unique=new Set();
 for(const r of data.rows){
   if(!UUID.test(r.batch_id)||unique.has(r.batch_id)||!count(r.cartons)||r.cartons===0
     ||!validDate(r.packed_on)||!count(r.date_count)||r.date_count<1)return false;
   unique.add(r.batch_id);
   if(r.link_id!==null){
     if(!UUID.test(r.link_id)||typeof r.evidence_note!=="string"
       ||r.evidence_note.trim().length<10||!Number.isFinite(Date.parse(r.confirmed_at))
       ||r.confirmed_process_number===null)return false;
   } else if(r.suggested_process_id!==null){
     if(!UUID.test(r.suggested_process_id)||r.suggested_process_number===null
       ||r.date_count!==1)return false;
   }
 }
 return true;
}
const shortId=x=>String(x).slice(0,8);
const day=x=>new Date(x+"T12:00:00Z").toLocaleDateString("en-GB",
  {day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});

export function createMawimbiTraceabilityPanel(authClient,target){
 if(!target)throw new Error("Traceability target missing");
 let data=null,errorText="",busy=false;
 function clear(){data=null;errorText="";target.replaceChildren();}
 function isConnected(){return Boolean(data);}
 function render(){
   const keepOpen=target.querySelector(".metrics-traceability-review")?.open||false;
   target.replaceChildren();
   const panel=add(target,"section",undefined,"metrics-current-panel metrics-traceability");
   const heading=add(panel,"div",undefined,"metrics-current-heading");
   add(heading,"h4","Mawimbi · stock-to-processing traceability");
   if(!data){
     add(panel,"p",errorText||"Loading reconciliation status…","metrics-small-note");
     return;
   }
   const summary=add(panel,"div",undefined,"metrics-link-summary");
   for(const [title,value] of [
     ["Stock batches",data.total_batches],
     ["Evidence-confirmed",data.confirmed_links],
     ["Same-day candidates",data.same_day_candidates],
     ["Needs investigation",data.unmatched_batches]
   ]){
     const card=add(summary,"div",undefined,"metrics-link-count");
     add(card,"span",title);
     add(card,"strong",value);
   }
   add(panel,"p","Suggestions are based on matching dates only, not verified provenance. "+
     "Confirm a link only after checking the physical record, batch notes or other supporting evidence.",
     "metrics-small-note");
   const details=add(panel,"details",undefined,"metrics-growth-details metrics-traceability-review");
   details.open=keepOpen;
   add(details,"summary","Review stock batches ("+data.rows.length+" shown)");
   const rows=add(details,"div",undefined,"metrics-link-rows");
   for(const r of data.rows){
     const row=add(rows,"div",undefined,"metrics-link-row");
     const header=add(row,"div",undefined,"metrics-link-row-header");
     add(header,"strong",day(r.packed_on)+" · "+r.cartons+" cartons");
     add(header,"span","Batch "+shortId(r.batch_id),"metrics-current-note");
     const form=add(row,"div",undefined,"metrics-link-controls");
     if(r.link_id){
       add(row,"p","Confirmed → Processing #"+r.confirmed_process_number+
         " · "+new Date(r.confirmed_at).toLocaleDateString("en-GB"),
         "metrics-link-confirmed");
       add(row,"p","Evidence: "+r.evidence_note,"metrics-current-note");
       const label=add(form,"label","Reason to revoke an incorrect link");
       const note=add(label,"input");
       note.type="text";note.maxLength=500;
       note.placeholder="e.g. source log corrected; this belongs to another run";
       const button=add(form,"button","Revoke link");
       button.type="button";button.className="metrics-link-action";
       button.addEventListener("click",async ()=>{
         const reason=note.value.trim();
         if(reason.length<10){note.setCustomValidity("Add a correction reason of at least 10 characters.");note.reportValidity();note.setCustomValidity("");return;}
         await changeLink(button,"cosme_metrics_revoke_mawimbi_stock_process",
           {p_link_id:r.link_id,p_reason:reason},"revoked");
       });
     } else if(r.suggested_process_id){
       add(row,"p","Possible same-day match: Processing #"+r.suggested_process_number,
         "metrics-current-note");
       const label=add(form,"label","Evidence supporting this association");
       const note=add(label,"input");
       note.type="text";note.maxLength=500;
       note.placeholder="Signed logbook, vessel/batch note or other verified reference";
       const button=add(form,"button","Confirm evidence-backed link");
       button.type="button";button.className="metrics-link-action";
       button.addEventListener("click",async ()=>{
         const evidence=note.value.trim();
         if(evidence.length<10){note.setCustomValidity("Record supporting evidence (10+ characters) before confirming.");note.reportValidity();note.setCustomValidity("");return;}
         await changeLink(button,"cosme_metrics_confirm_mawimbi_stock_process",{
           p_stock_batch_submission_id:r.batch_id,
           p_process_submission_id:r.suggested_process_id,
           p_evidence_note:evidence
         },"confirmed");
       });
     } else {
       add(row,"p","No unique same-day processing match. Leave unlinked pending source review.",
         "metrics-current-note");
     }
   }
   add(panel,"p","Linked records remain separate original stock and processing entries. "+
     "A confirmation does not establish collection source, paid purchases, calibrated batch QC or extraction yield.",
     "metrics-small-note");
 }
 async function changeLink(button,fn,params,expected){
   if(busy)return;
   busy=true;button.disabled=true;
   const oldText=button.textContent;
   button.textContent="Saving…";
   try{
     const {data:res,error}=await authClient.rpc(fn,params);
     if(error)throw error;
     if(res?.[expected]!==true)throw Error("Confirmation status was not returned.");
     await refresh(true);
   }catch(e){
     button.disabled=false;
     button.textContent=oldText;
     errorText=e?.message||"Unable to save this link.";
     let status=target.querySelector(".metrics-link-save-error");
     if(!status)status=add(target,"p",undefined,"metrics-link-save-error");
     status.textContent=errorText;
   }finally{busy=false;}
 }
 async function refresh(reopen=false){
   const wasOpen=reopen||target.querySelector(".metrics-traceability-review")?.open;
   data=null;errorText="";
   try{
     const {data:result,error}=await authClient.rpc("cosme_metrics_mawimbi_traceability_review");
     if(error)throw error;
     if(!validateMawimbiTraceability(result))throw Error("Invalid or unauthorised reconciliation data");
     data=result;
   }catch{errorText="Traceability review is unavailable or restricted to the metrics owner.";}
   render();
   if(wasOpen){
     const details=target.querySelector(".metrics-traceability-review");
     if(details)details.open=true;
   }
 }
 return {clear,refresh,render,isConnected};
}
