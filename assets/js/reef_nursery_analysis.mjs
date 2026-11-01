import { mkwiroRaftDisplayLabel } from "./reef_mkwiro_raft_labels.js?v=4";
// Nursery Records -> Analysis. Shared server-side calculation with COSME live metrics.
// No raw measurements, farmer details, or write access are exposed by this view.
const nf=(n,d=1)=>n==null?"—":new Intl.NumberFormat("en-KE",{maximumFractionDigits:d}).format(n);
const validTime=s=>typeof s==="string"&&Number.isFinite(Date.parse(s));
export function createNurseryRecordsAnalysis(authClient,target){
 let loaded=false,loading=false,data=null;
 const node=(parent,tag,text,cls)=>{
   const el=document.createElement(tag);
   if(text!==undefined)el.textContent=String(text);
   if(cls)el.className=cls;
   parent.append(el);return el;
 };
 const valid=raw=>raw?.can_view===true&&raw.status==="current"&&validTime(raw.queried_at)
   &&Number.isSafeInteger(raw.initial_ropes)&&Number.isSafeInteger(raw.week2_ropes)
   &&Number.isSafeInteger(raw.week4_ropes)&&Array.isArray(raw.sites)&&raw.sites.length<=25
   &&Array.isArray(raw.pairs)&&raw.pairs.length<=10
   &&raw.initial_ropes>=raw.week2_ropes&&raw.initial_ropes>=raw.week4_ropes;
 const legend=(label,value,unit)=>{const card=node(target,"div",undefined,"reef-growth-kpi");node(card,"span",label);
   node(card,"strong",nf(value,0)+(unit?" "+unit:""));return card;};
 const cell=(row,value,head=false)=>node(row,head?"th":"td",value);
 const table=(headings)=>{const wrap=node(target,"div",undefined,"reef-growth-table-wrap");
   const t=node(wrap,"table",undefined,"management-table admin-data-table reef-growth-table");
   const hr=node(node(t,"thead"),"tr");for(const title of headings)cell(hr,title,true);
   return node(t,"tbody");};
 function render(){
  target.replaceChildren();
  if(!data)return;
  const intro=node(target,"p","Live, matched-rope measurements · 2–4 week growth","reef-growth-note");
  intro.style.marginBottom="12px";
  const summary=node(target,"div",undefined,"reef-growth-kpis");
  for(const [label,value,unit] of [["Initial",data.initial_ropes,"ropes"],["Week 2",data.week2_ropes,"ropes"],["Week 4",data.week4_ropes,"ropes"],["Sites",data.site_count,""]]){
    const card=node(summary,"div",undefined,"reef-growth-kpi");
    node(card,"span",label);node(card,"strong",nf(value,0)+(unit?" "+unit:""));
  }
  const toolbar=node(target,"div",undefined,"reef-growth-toolbar");
  const label=node(toolbar,"label","Site area ");
  const select=node(label,"select");for(const [v,t] of [["all","All locations"],["mkwiro","Mkwiro"],["tumbe","Tumbe"]]){
    const opt=node(select,"option",t);opt.value=v;
  }
  const refreshButton=node(toolbar,"button","Refresh analysis");refreshButton.type="button";
  refreshButton.addEventListener("click",()=>refresh(true));
  const section=node(target,"div");
  function renderArea(){
    section.replaceChildren();
    const area=select.value;
    const sites=data.sites.filter(s=>area==="all"||s.area===area);
    const heading=node(section,"h3","Site growth and measurement coverage");
    heading.style.margin="12px 0";
    const wrap=node(section,"div",undefined,"reef-growth-table-wrap");
    const t=node(wrap,"table",undefined,"management-table admin-data-table reef-growth-table");
    const th=node(node(t,"thead"),"tr");
    for(const h of ["Site","Structure","Initial","Week 2","Week 4","Gain W2–W4","Mean SGR W2–W4"])cell(th,h,true);
    const body=node(t,"tbody");
    for(const s of sites){
      const r=node(body,"tr");
      for(const v of [mkwiroRaftDisplayLabel(s.site_code,s.site_name)||s.site_code,s.structure_type==="raft"?"Floating raft":"Shore / off-bottom",
        s.initial_ropes,s.week2_ropes,s.week4_ropes,
        s.mean_gain_g_day==null?"—":nf(s.mean_gain_g_day)+" g/day",
        s.mean_sgr_pct_day==null?"—":nf(s.mean_sgr_pct_day,2)+" %/day"])cell(r,v);
    }
    if(area==="tumbe"){
      node(section,"p","Tumbe has initial measurements but no validated Week 2 or Week 4 weights yet. Missing follow-ups are not zero.","reef-growth-note");
    }
    if(area!=="tumbe"&&data.pairs.length){
      node(section,"h3","Matched floating raft versus shore/off-bottom ropes");
      node(section,"p","Mean wet-weight gain (g/rope/day), Week 2–4","reef-growth-note");
      for(const pair of data.pairs){
        const card=node(section,"div",undefined,"reef-growth-pair");
        const raft=mkwiroRaftDisplayLabel(pair.raft_site)||pair.raft_site;
        const shore=mkwiroRaftDisplayLabel(pair.shore_site)||pair.shore_site;
        const pairHeading=node(card,"strong",raft+" vs "+shore+" · "+pair.pair_count+" matched pairs");
        pairHeading.title=pair.raft_site+" / "+pair.shore_site;
        const max=Math.max(pair.raft_gain_g_day,pair.shore_gain_g_day,1);
        for(const [label,value,kind] of [["Floating",pair.raft_gain_g_day,"raft"],["Shore",pair.shore_gain_g_day,"shore"]]){
          const row=node(card,"div",undefined,"reef-growth-bar-row");
          node(row,"span",label);
          const track=node(row,"div",undefined,"reef-growth-bar-track");
          const bar=node(track,"span",undefined,"reef-growth-bar "+kind);
          bar.style.width=Math.max(0,Math.min(100,100*value/max))+"%";
          node(row,"b",nf(value)+" g/day");
        }
        node(card,"small",nf(pair.relative_gain,2)+"× observed raft gain · Raft SGR "+nf(pair.raft_sgr_pct_day,2)+" %/day · Shore SGR "+nf(pair.shore_sgr_pct_day,2)+" %/day");
      }
    }
  }
  select.addEventListener("change",renderArea);
  renderArea();
  node(target,"p","Monitored rope samples only—not full-farm yield, survival, harvest forecast or a causal experiment. Missing or unrecorded observations are excluded rather than treated as zero. Tare is taken from each saved rope cycle.","reef-growth-note");
  node(target,"p","Source updated: "+(data.source_updated_at?new Date(data.source_updated_at).toLocaleString():"unknown")+
    " · Recalculated: "+new Date(data.queried_at).toLocaleString(),"reef-growth-note");
 }
 async function refresh(force=false){
  if(loading||loaded&&!force)return;
  loading=true;target.textContent="Loading live nursery growth analysis…";
  try{
    const {data:raw,error}=await authClient.rpc("ag_reef_nursery_live_analysis");
    if(error)throw error;
    if(!valid(raw))throw new Error("Analysis is available only to signed-in users with COSME Reef access, or its source is unavailable.");
    data=raw;loaded=true;render();
  }catch(error){
    loaded=false;data=null;target.textContent=error.message||"Nursery growth analysis unavailable.";
  }finally{loading=false;}
 }
 return {refresh,isLoaded:()=>loaded};
}
