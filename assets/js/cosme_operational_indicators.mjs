// Current operational indicators are NOT additions to any frozen COSME release.
// Always derived from the individually permission-checked, aggregate-only RPC.
const definitions = [
 ["ON","Offshore Nursery","Sample rope cycles with initial measurements","nursery.initial_ropes","ropes"],
 ["ON","Offshore Nursery","Sample ropes with Week 2 measurements","nursery.week2_ropes","ropes"],
 ["ON","Offshore Nursery","Sample ropes with Week 4 measurements","nursery.week4_ropes","ropes"],
 ["ON","Offshore Nursery","Sample sites with active monitored ropes","nursery.site_count","sites"],
 ["ON","Offshore Nursery","Week 4 observations overdue","nursery.week4_due","ropes"],
 ["SDT","Solar Drying Tables","Completed validated drying cycles","drying.completed_cycles","cycles"],
 ["SDT","Solar Drying Tables","Validated completed drying bay records","drying.completed_bays","bays"],
 ["SDT","Solar Drying Tables","Validated fresh seaweed loading weight","drying.wet_kg","kg"],
 ["SDT","Solar Drying Tables","Validated final unloading weight","drying.final_kg","kg"],
 ["SDT","Solar Drying Tables","Intermediate reweigh events on Bati tables","drying.reweigh_events","events"],
 ["SDT","Solar Drying Tables","Intermediate reweighed bay records","drying.reweigh_bays","bays"],
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
// Deliberately small dashboard shortlist. All other calculations remain in their
// operational analysis views; IDs of retained metrics remain stable.
const featuredPaths = new Set([
 "nursery.week2_ropes","nursery.week4_ropes",
 "drying.within_five_days","drying.median_hours",
 "mawimbi.collections_finalised","mawimbi.collected_kg",
 "mawimbi.communities_registered","mawimbi.communities_collected",
 "mawimbi.farmers_registered","mawimbi.processing_sessions",
 "mawimbi.processing_received_kg","mawimbi.pressed_liquid_l",
 "mawimbi.liquid_per_kg","mawimbi.containers_distinct",
 "mawimbi.water_samples","mawimbi.ro_monitoring",
 "mawimbi.historical_disposal_l"
]);
const validTime = value => typeof value==="string" && Number.isFinite(Date.parse(value));
const safeNumeric = v => typeof v==="number" && Number.isFinite(v) && v>=0;
const get = (root,path) => path.split(".").reduce((v,k)=>v?.[k],root);
export function createOperationalIndicators(payload){
 if(!payload || payload.can_view!==true || payload.status!=="current" || !validTime(payload.queried_at)
   || !payload.nursery || payload.nursery.can_view!==true ||
   !Array.isArray(payload.nursery.pairs) || !Array.isArray(payload.nursery.sites) ||
   payload.nursery.pairs.length>10 || payload.nursery.sites.length>25) return [];
 const out=[];
 const add=(prefix,activity,title,value,unit,source,serial,note="")=>{
   if(!safeNumeric(value) && !(typeof value==='number' && Number.isFinite(value) && unit==='g/rope/day'))return;
   const id="LIVE-"+prefix+"-"+String(serial).padStart(3,"0");
   const read={value:String(value),unit,source,queriedAt:payload.queried_at,
     sourceUpdatedAt:prefix==='ON'?payload.nursery.source_updated_at||null:prefix==='SDT'?payload.drying?.source_updated_at||null:null};
   out.push({id,activity,theme:"Current operations",title,
     value:read.value,unit,source,verification:"Live read-only aggregate",
     featured:false,sourceMode:"Live",valueState:"calculated",asOf:payload.queried_at,
     dataKind:"Live",valueType:"Measurement",basis:"Operational aggregate",
     originalEvidence:"",originalTheme:"Current operations",note,
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
   if(!featuredPaths.has(path))continue;
   if(prefix==="MAW" && (payload.mawimbi?.inventory_verified!==false ||
     payload.mawimbi?.batch_linkage_verified!==false))continue;
   const titleShort={
    "mawimbi.containers_distinct":"Numbered containers recorded",
    "mawimbi.collections_finalised":"Finalised collection records",
    "mawimbi.collected_kg":"Seaweed collected (finalised)",
    "mawimbi.processing_received_kg":"Seaweed received for processing",
    "mawimbi.pressed_liquid_l":"Liquid pressed",
    "mawimbi.liquid_per_kg":"Liquid extracted per kg processed",
    "drying.within_five_days":"Drying bays completed within 5 days",
    "drying.median_hours":"Median drying time"
   }[path]||title;
   const note=path==="mawimbi.containers_distinct"
     ? "Unique numbered containers from their first recorded stock entry. Not a verified on-hand inventory count; retests are not new containers."
     : path==="mawimbi.liquid_per_kg"
     ? "Pressed liquid per recorded processing input, not a verified collection-to-batch conversion."
     : "";
   add(prefix,activity,titleShort,get(payload,path),unit,source,serial,note);
 }
 for (const pair of payload.nursery.pairs){
  if(!/^MK-R[123]$/.test(pair.raft_site)||!/^MK-SF[123]\/R[123]$/.test(pair.shore_site)
    || !Number.isSafeInteger(pair.pair_count)||pair.pair_count<1)continue;
  const letter={"MK-R2":"A","MK-R3":"B","MK-R1":"C"}[pair.raft_site];
  const shore={"A":"MK-SF2/R2","B":"MK-SF3/R3","C":"MK-SF1/R1"}[letter];
  if(!letter || shore!==pair.shore_site)continue;
  const label="Raft "+letter+" vs Shore "+letter;
  for(const [title,key,unit] of [
    ["Raft gain · "+label,"raft_gain_g_day","g/rope/day"],
    ["Shore gain · "+label,"shore_gain_g_day","g/rope/day"],
    ["Raft-to-shore daily gain · "+label,"relative_gain","×"],
    ["Matched rope pairs · "+label,"pair_count","pairs"]
  ]){
    serial++;
    if(key!=="relative_gain")continue;
    add("ON","Offshore Nursery","Daily growth comparison · "+label,
      pair[key],unit,sources.ON,serial,
      pair.pair_count+" matched rope pairs · "+pair.raft_site+" / "+pair.shore_site+
      " · Week 2–4 wet-weight gain per day (raft ÷ shore).");
  }
 }
 return out;
}
