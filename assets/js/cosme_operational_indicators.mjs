// Current operational indicators are NOT additions to any frozen COSME release.
// Always derived from the individually permission-checked, aggregate-only RPC.
const definitions = [
 ["ON","Offshore Nursery","Sample rope cycles with initial measurements","nursery.initial_ropes","ropes"],
 ["ON","Offshore Nursery","Sample ropes with Week 2 measurements","nursery.week2_ropes","ropes"],
 ["ON","Offshore Nursery","Sample ropes with Week 4 measurements","nursery.week4_ropes","ropes"],
 ["ON","Offshore Nursery","Sample sites with active monitored ropes","nursery.site_count","sites"],
 ["ON","Offshore Nursery","Week 4 observations overdue","nursery.week4_due","ropes"],
 ["SDT","Solar Drying Tables","Recorded drying bays eligible for analysis","drying.qualified_bays","bays"],
 ["SDT","Solar Drying Tables","Drying bays completed within five days","drying.within_five_days","bays"],
 ["SDT","Solar Drying Tables","Median drying time of qualified bays","drying.median_hours","hours"],
 ["SDT","Solar Drying Tables","Wet-weight reduction of qualified bays","drying.wet_reduction_pct","%"],
 ["MAW","Mawimbi","Collection entries recorded","mawimbi.collections_total","records"],
 ["MAW","Mawimbi","Finalised receipt-backed wet collections","mawimbi.collections_finalised","records"],
 ["MAW","Mawimbi","Finalised receipt-backed wet seaweed collected","mawimbi.collected_kg","kg"],
 ["MAW","Mawimbi","Unfinalised collection records","mawimbi.collections_unfinalised","records"],
 ["MAW","Mawimbi","Registered active communities","mawimbi.communities_registered","communities"],
 ["MAW","Mawimbi","Communities represented by finalised collections","mawimbi.communities_collected","communities"],
 ["MAW","Mawimbi","Registered active farmers","mawimbi.farmers_registered","farmers"],
 ["MAW","Mawimbi","Farmers recorded on finalised collections","mawimbi.farmers_collected","farmers"],
 ["MAW","Mawimbi","Farmers with a recorded farm size","mawimbi.farmers_with_size","farmers"],
 ["MAW","Mawimbi","Processing records","mawimbi.processing_sessions","records"],
 ["MAW","Mawimbi","Seaweed received for processing","mawimbi.processing_received_kg","kg"],
 ["MAW","Mawimbi","Pressed liquid recorded","mawimbi.pressed_liquid_l","L"],
 ["MAW","Mawimbi","Recorded processing liquid per input wet kg","mawimbi.liquid_per_kg","L/kg"],
 ["MAW","Mawimbi","Initial numbered container records","mawimbi.containers_initial","containers"],
 ["MAW","Mawimbi","Distinct initial carton serials","mawimbi.containers_distinct","serials"],
 ["MAW","Mawimbi","Container retest records","mawimbi.stock_retests","records"],
 ["MAW","Mawimbi","Initial containers with pH recorded","mawimbi.stock_ph","records"],
 ["MAW","Mawimbi","Initial containers with EC recorded","mawimbi.stock_ec","records"],
 ["MAW","Mawimbi","Initial containers with Brix recorded","mawimbi.stock_brix","records"],
 ["MAW","Mawimbi","Initial containers with hydrometer reading","mawimbi.stock_hydrometer","records"],
 ["MAW","Mawimbi","Site water samples","mawimbi.water_samples","samples"],
 ["MAW","Mawimbi","Site water samples with pH recorded","mawimbi.water_ph","samples"],
 ["MAW","Mawimbi","RO monitoring records","mawimbi.ro_monitoring","records"],
 ["MAW","Mawimbi","Historical stock refilter groups","mawimbi.historical_refilters","groups"],
 ["MAW","Mawimbi","Historical stock disposal records","mawimbi.historical_disposals","records"],
 ["MAW","Mawimbi","Historical stock disposal volume","mawimbi.historical_disposal_l","L"],
 ["MAW","Mawimbi","Confirmed stock-to-process links","mawimbi.stock_process_links","links"]
];
const validTime = value => typeof value==="string" && Number.isFinite(Date.parse(value));
const safeNumeric = v => typeof v==="number" && Number.isFinite(v) && v>=0;
const get = (root,path) => path.split(".").reduce((v,k)=>v?.[k],root);
export function createOperationalIndicators(payload){
 if(!payload || payload.can_view!==true || payload.status!=="current" || !validTime(payload.queried_at)
   || !payload.nursery || payload.nursery.can_view!==true ||
   !Array.isArray(payload.nursery.pairs) || !Array.isArray(payload.nursery.sites) ||
   payload.nursery.pairs.length>10 || payload.nursery.sites.length>25) return [];
 const out=[];
 const add=(prefix,activity,title,value,unit,source,serial)=>{
   if(!safeNumeric(value))return;
   const id="LIVE-"+prefix+"-"+String(serial).padStart(3,"0");
   const read={value:String(value),unit,source,queriedAt:payload.queried_at,
     sourceUpdatedAt:payload.nursery.source_updated_at||null};
   out.push({id,activity,theme:"Current operations",title,
     value:read.value,unit,source,verification:"Live read-only aggregate",
     featured:false,sourceMode:"Live",valueState:"calculated",asOf:payload.queried_at,
     dataKind:"Live",valueType:"Measurement",basis:"Operational aggregate",
     originalEvidence:"",originalTheme:"Current operations",note:"",
     operationalLive:true,liveCurrent:read});
 };
 const sources={
  ON:"COSME sample rope register; active non-deleted cycles",
  SDT:"COSME Bati drying-table records",
  MAW:"MAWIMBI approved owner-only operational aggregates"
 };
 let serial=0;
 for (const [prefix,activity,title,path,unit] of definitions) {
   serial++;
   const source=path.startsWith("nursery.")?sources.ON:path.startsWith("drying.")?sources.SDT:sources.MAW;
   if(prefix==="MAW" && (payload.mawimbi?.inventory_verified!==false ||
     payload.mawimbi?.batch_linkage_verified!==false))continue;
   add(prefix,activity,title,get(payload,path),unit,source,serial);
 }
 for (const pair of payload.nursery.pairs){
  if(!/^MK-R[123]$/.test(pair.raft_site)||!/^MK-SF[123]\/R[123]$/.test(pair.shore_site)
    || !Number.isSafeInteger(pair.pair_count)||pair.pair_count<1)continue;
  const label=pair.raft_site+" vs "+pair.shore_site;
  for(const [title,key,unit] of [
    ["Raft gain · "+label,"raft_gain_g_day","g/rope/day"],
    ["Shore gain · "+label,"shore_gain_g_day","g/rope/day"],
    ["Raft-to-shore daily gain · "+label,"relative_gain","×"],
    ["Matched rope pairs · "+label,"pair_count","pairs"]
  ]){serial++;add("ON","Offshore Nursery",title,pair[key],unit,sources.ON,serial);}
 }
 return out;
}
