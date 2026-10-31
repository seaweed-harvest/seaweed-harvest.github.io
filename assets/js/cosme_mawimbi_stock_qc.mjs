// COSME Metrics · Mawimbi stock QC field-presence diagnostic.
// Counts do NOT establish calibrated batch QC completeness or verified production links.
const integer = x => Number.isSafeInteger(x) && x >= 0;
const date = x => typeof x === "string" && Number.isFinite(Date.parse(x));
const number = x => new Intl.NumberFormat("en-KE",{maximumFractionDigits:1}).format(x);
const monthName = x => new Date(x+"T12:00:00Z").toLocaleDateString("en-GB",
  {month:"short",year:"numeric",timeZone:"UTC"});

export function validateMawimbiStockQc(data) {
  if(!data || data.can_view!==true || data.status!=="current"
    || data.metric_id!=="MAW-0087"
    || data.batch_qc_completeness_verified!==false
    || data.process_stock_linkage_verified!==false
    || !integer(data.initial_records) || !integer(data.cartons)
    || !integer(data.retest_records) || !integer(data.referenced_batch_ids)
    || data.cartons > data.initial_records
    || !integer(data.ph_recorded) || !integer(data.brix_recorded)
    || !integer(data.ec_recorded) || !integer(data.sg_recorded)
    || [data.ph_recorded,data.brix_recorded,data.ec_recorded,data.sg_recorded]
      .some(x=>x>data.initial_records)
    || !integer(data.month_count) || !Array.isArray(data.months)
    || data.month_count!==data.months.length || data.month_count>72
    || !date(data.queried_at) || (data.source_updated_at!==null && !date(data.source_updated_at))
  )return false;
  let prior=null;
  let totalInitial=0,totalRetest=0,ph=0,brix=0,ec=0,sg=0;
  for(const row of data.months){
    if(typeof row.month!=="string" || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(row.month)
      || (prior!==null && row.month>=prior)
      || !integer(row.initial_records) || !integer(row.retest_records)
      || !integer(row.ph_recorded) || !integer(row.brix_recorded)
      || !integer(row.ec_recorded) || !integer(row.sg_recorded)
      || [row.ph_recorded,row.brix_recorded,row.ec_recorded,row.sg_recorded]
        .some(x=>x>row.initial_records))return false;
    prior=row.month;
    totalInitial+=row.initial_records;totalRetest+=row.retest_records;
    ph+=row.ph_recorded;brix+=row.brix_recorded;ec+=row.ec_recorded;sg+=row.sg_recorded;
  }
  return totalInitial===data.initial_records && totalRetest===data.retest_records
    && ph===data.ph_recorded && brix===data.brix_recorded
    && ec===data.ec_recorded && sg===data.sg_recorded;
}
function add(parent,tag,value,cls=""){
 const node=document.createElement(tag);
 if(value!==undefined)node.textContent=String(value);
 if(cls)node.className=cls;
 parent.append(node);
 return node;
}

export function createMawimbiStockQcPanel(authClient,target){
 if(!target)throw new Error("Stock QC panel target missing");
 let data=null, errorText="";
 function clear(){data=null;errorText="";target.replaceChildren()}
 function isConnected(){return !!data}
 function metricContext(id){
   if(id!=="MAW-0087"||!data)return null;
   return {
     label:"Current Mawimbi stock record counts",
     value:number(data.initial_records)+" initial cartons · "+number(data.retest_records)+" retests",
     description:"Record counts only; batch QC completeness and processing links are not verified"
   };
 }
 function render(){
   target.replaceChildren();
   const panel=add(target,"section",undefined,"metrics-current-panel metrics-stock-qc");
   const heading=add(panel,"div",undefined,"metrics-current-heading");
   add(heading,"h4","Mawimbi · stock and QC record coverage");
   if(!data){
     add(panel,"p",errorText||"Loading stock records…","metrics-small-note");return;
   }
   const summary=add(panel,"div",undefined,"metrics-mawimbi-summary");
   const initial=add(summary,"div",undefined,"metrics-growth-summary-card");
   add(initial,"span","Initial stock records","metrics-current-label");
   add(initial,"strong",number(data.initial_records),"metrics-growth-key");
   add(initial,"span",number(data.cartons)+" distinct carton instances","metrics-current-note");
   const repeat=add(summary,"div",undefined,"metrics-growth-summary-card");
   add(repeat,"span","QC retest records","metrics-current-label");
   add(repeat,"strong",number(data.retest_records),"metrics-growth-key");
   add(repeat,"span","Retests are not counted as new cartons","metrics-current-note");
   add(panel,"p","QC field coverage on "+number(data.initial_records)+" initial stock records (field presence only):",
     "metrics-small-note");
   const coverage=add(panel,"div",undefined,"metrics-stock-qc-coverage");
   for(const [title,n] of [["pH",data.ph_recorded],["Brix",data.brix_recorded],
     ["Conductivity",data.ec_recorded],["Hydrometer SG",data.sg_recorded]]){
     const cell=add(coverage,"div",undefined,"metrics-stock-qc-field");
     add(cell,"span",title,"metrics-current-label");
     add(cell,"strong",number(n)+" / "+number(data.initial_records));
     add(cell,"span",data.initial_records?number(n/data.initial_records*100)+"%":"—","metrics-current-note");
   }
   const details=add(panel,"details",undefined,"metrics-growth-details");
   add(details,"summary","Monthly QC record history ("+data.month_count+" months)");
   const wrap=add(details,"div",undefined,"metrics-dryer-comparison-wrap");
   const table=add(wrap,"table",undefined,"metrics-dryer-comparison metrics-stock-qc-table");
   const head=add(add(table,"thead"),"tr");
   for(const label of ["Month","Initial","Retests","pH entered","Brix entered","EC entered","SG entered"]){
     add(head,"th",label).scope="col";
   }
   const body=add(table,"tbody");
   for(const row of data.months){
     const tr=add(body,"tr");
     add(tr,"th",monthName(row.month)).scope="row";
     for(const key of ["initial_records","retest_records","ph_recorded","brix_recorded","ec_recorded","sg_recorded"]){
       add(tr,"td",number(row[key]));
     }
   }
   add(panel,"p","The "+number(data.referenced_batch_ids)+" referenced stock batch IDs have not been matched to processing submissions. "+
     "Missing SG and other QC entries are gaps in recorded measurements—not evidence of failed product QC. "+
     "Calibrations and batch-level QC completeness remain unverified (MAW-0077).","metrics-small-note");
   add(panel,"p","Source updated: "+(data.source_updated_at?new Date(data.source_updated_at).toLocaleString():"unknown")
     +" · Queried: "+new Date(data.queried_at).toLocaleString(),"metrics-small-note");
 }
 async function refresh(){
   data=null;errorText="";
   try{
     const res=await authClient.rpc("cosme_metrics_live_mawimbi_stock_qc");
     if(res.error)throw res.error;
     if(!validateMawimbiStockQc(res.data))throw Error("Invalid or unauthorized QC aggregate");
     data=res.data;
   }catch{
     errorText="Current Mawimbi stock QC records are unavailable or restricted.";
   }
   render();
 }
 return {clear,refresh,render,isConnected,metricContext};
}
