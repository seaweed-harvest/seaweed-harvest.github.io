// COSME Metrics Timeline — compact, read-only projection of the existing metrics RPC.
// No standalone milestone store; permissions are enforced by the server-side RPC.
export const TIMELINE_ACTIVITIES = Object.freeze({
  "Solar Drying Tables": {icon:"☀️", label:"Solar drying", css:"drying"},
  "Offshore Nursery": {icon:"🌊", label:"Offshore nursery", css:"nursery"},
  "Aggregation Hub": {icon:"🏭", label:"Aggregation", css:"aggregation"},
  "Mawimbi": {icon:"🧪", label:"Mawimbi", css:"mawimbi"},
  "Programme": {icon:"✈️", label:"Programme / travel", css:"programme"}
});

export const TIMELINE_TYPES = Object.freeze({
  "Planning & decisions":["Assessment","Consultation","Site selection","Decision","Agreement","Planning","Kickoff","Meeting"],
  "Design & fabrication":["Design","Procurement","Proposal","Fabrication","Prototype"],
  "Installation & deployment":["Installation","Deployment","Repair","Construction"],
  "Trials & monitoring":["Inspection","Pilot","Testing","Monitoring","Trial"],
  "Reports & training":["Report","Training","Handover"],
  "Travel & fieldwork":["Travel","Fieldwork","Field visit","Contract"]
});

export const timelineType = value =>
  Object.entries(TIMELINE_TYPES).find(([,names])=>names.includes(value))?.[0] || "Planning & decisions";

const MONTHS = [1,3,12];
const shortTitle = Object.freeze({
  "COSME innovation report documented the baseline assessment":"Baseline assessment report published",
  "Early offshore nursery raft deployed at Mkwiro":"Early nursery raft deployed — Mkwiro",
  "Early offshore raft inspected":"Early nursery raft inspection",
  "Shangani V1.1 dryer prototype installed":"Shangani V1.1 prototype installed",
  "Shangani drying-table pilot launched":"Shangani dryer pilot launched",
  "Funzi Island V1.2 dryer prototype installed":"Funzi Island V1.2 prototype installed",
  "V1.3 dryer drawing reference dated":"V1.3 dryer drawing issued",
  "Mawimbi processing baseline assessed":"Mawimbi processing baseline completed",
  "V1.3 dryer production sites allocated":"Production dryer sites selected",
  "Earlier offshore raft inspected":"Early raft inspection",
  "Bati drying-table temperature monitoring recorded":"Bati temperature monitoring",
  "Aggregation commercial stakeholder consultation":"Aggregation commercial consultation",
  "Baler purchase order buyer-acceptance dated":"Baler PO accepted by buyer",
  "Factory bale mass reported near 100 kg":"100 kg factory bale reported",
  "Cascadia–Mawimbi MOU effective":"Mawimbi MOU effective",
  "Mawimbi RO installation recorded":"Mawimbi RO installation",
  "Tumbe nursery practical sessions documented":"Tumbe nursery practical training"
});

export function createMetricsTimeline(authClient,root,openMetric) {
  let milestones=[], availableMetrics=new Set(), loaded=false, errorMessage="", requestId=0;
  let activity="", type="", year="", view="timeline", months=3, month="", lastTrigger=null;
  let drawer=null, escapeHandler=null;
  const make=(tag,cls="",value="")=>{
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    node.textContent=String(value??"");
    return node;
  };
  const title=m=>m.short_title||shortTitle[m.title]||m.title;
  const meta=a=>TIMELINE_ACTIVITIES[a]||TIMELINE_ACTIVITIES.Programme;
  const dateAtNoon=s=>new Date(s+"T12:00:00");
  const dateLabel=s=>dateAtNoon(s).toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"numeric"});
  const dateRange=m=>m.end_date&&m.end_date!==m.start_date
    ?dateLabel(m.start_date)+" – "+dateLabel(m.end_date):dateLabel(m.start_date);
  const activeOn=(m,day)=>m.start_date<=day&&(m.end_date||m.start_date)>=day;
  const filtered=()=>milestones.filter(m=>(!activity||m.activity===activity)
    &&(!type||timelineType(m.type)===type)&&(!year||m.start_date.startsWith(year)));
  const validHref=value=>{
    try{const url=new URL(value);return url.protocol==="https:"?url.href:"";}
    catch{return "";}
  };
  const monthStart=(s,span)=>{
    const [y,m]=s.split("-").map(Number);
    const first=span===12?0:span===3?Math.floor((m-1)/3)*3:m-1;
    return new Date(y,first,1);
  };
  const monthKey=date=>date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0");
  const startForView=()=>monthStart(month,months);
  const isValidDate=s=>typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s)
    &&!isNaN(dateAtNoon(s))&&dateAtNoon(s).getFullYear()===Number(s.slice(0,4))
    &&dateAtNoon(s).getMonth()+1===Number(s.slice(5,7))
    &&dateAtNoon(s).getDate()===Number(s.slice(8,10));

  function activityMark(parent,name) {
    const m=meta(name);
    const tag=make("span","metrics-timeline-activity activity-"+m.css);
    const symbol=make("span","metrics-timeline-symbol",m.icon);
    symbol.setAttribute("aria-hidden","true");
    tag.append(symbol,make("span","",m.label));
    parent.append(tag);
    return tag;
  }
  function addSourceAndMetrics(parent,m) {
    const source=make("div","metrics-timeline-source");
    source.append(make("h4","","Source & linked metrics"));
    const href=validHref(m.source_url);
    if(href){
      const link=make("a","",m.source_label||"Source document");
      link.href=href;link.target="_blank";link.rel="noopener noreferrer";
      source.append(link);
    }else if(m.source_label)source.append(make("p","",m.source_label));
    const linked=Array.isArray(m.metrics)?m.metrics.filter(v=>availableMetrics.has(v.id)):[];
    if(linked.length){
      const group=make("div","metrics-timeline-links");
      linked.forEach(v=>{
        const button=make("button","metrics-timeline-metric-link",v.title);
        button.type="button";
        button.addEventListener("click",()=>openMetric(v.id,button));
        group.append(button);
      });
      source.append(group);
    }
    parent.append(source);
  }
  function dismiss() {
    if(escapeHandler){
      document.removeEventListener?.("keydown",escapeHandler);
      escapeHandler=null;
    }
    if(drawer){drawer.remove?.();drawer=null;}
    lastTrigger?.focus?.();
    lastTrigger=null;
  }
  function showDrawer(trigger,heading,contentBuilder) {
    dismiss();
    lastTrigger=trigger;
    drawer=make("div","metrics-timeline-scrim");
    const backdrop=make("button","metrics-timeline-backdrop");
    backdrop.type="button";backdrop.setAttribute("aria-label","Close timeline details");
    backdrop.addEventListener("click",dismiss);
    const panel=make("aside","metrics-timeline-drawer");
    panel.setAttribute("role","dialog");panel.setAttribute("aria-modal","true");
    panel.setAttribute("aria-label",heading);
    const header=make("div","metrics-timeline-drawer-head");
    const label=make("h3","",heading);
    const close=make("button","metrics-timeline-close","×");
    close.type="button";close.setAttribute("aria-label","Close details");
    close.addEventListener("click",dismiss);
    header.append(label,close);
    const content=make("div","metrics-timeline-drawer-content");
    contentBuilder(content);
    panel.append(header,content);
    drawer.append(backdrop,panel);
    root.append(drawer);
    escapeHandler=e=>{if(e.key==="Escape")dismiss();};
    document.addEventListener?.("keydown",escapeHandler);
    close.focus?.();
  }
  function openEvent(m,trigger){
    showDrawer(trigger,title(m),content=>{
      const lead=make("div","metrics-timeline-drawer-meta");
      lead.append(make("strong","",dateRange(m)));
      activityMark(lead,m.activity);
      lead.append(make("span","metrics-timeline-type",timelineType(m.type)));
      content.append(lead);
      if(m.summary)content.append(make("p","metrics-timeline-drawer-summary",m.summary));
      addSourceAndMetrics(content,m);
    });
  }
  function openDay(day,events,trigger){
    if(events.length===1){openEvent(events[0],trigger);return;}
    showDrawer(trigger,"Events · "+dateLabel(day),content=>{
      for(const m of events){
        const button=make("button","metrics-timeline-day-event");
        activityMark(button,m.activity);
        button.append(make("span","",title(m)));
        button.addEventListener("click",()=>openEvent(m,button));
        content.append(button);
      }
    });
  }
  function select(parent,label,choices,current,onChange) {
    const wrap=make("label","metrics-timeline-filter");
    wrap.append(make("span","",label));
    const node=make("select");
    for(const [key,caption] of choices){
      const opt=make("option","",caption);
      opt.value=key;node.append(opt);
    }
    node.value=current;
    node.addEventListener("change",()=>onChange(node.value));
    wrap.append(node);
    parent.append(wrap);
  }
  function renderRows(parent,entries){
    if(!entries.length){
      parent.append(make("p","metrics-timeline-empty","No timeline entries match these filters."));
      return;
    }
    const header=make("div","metrics-timeline-columns");
    for(const label of ["Date","Activity","Milestone"])header.append(make("span","",label));
    parent.append(header);
    let headingYear="";
    for(const m of entries){
      const nextYear=m.start_date.slice(0,4);
      if(nextYear!==headingYear){
        headingYear=nextYear;
        parent.append(make("h4","metrics-timeline-year",nextYear));
      }
      const button=make("button","metrics-timeline-row");
      button.type="button";
      button.setAttribute("aria-label",dateRange(m)+": "+meta(m.activity).label+": "+title(m)+". View details");
      button.append(make("span","metrics-timeline-row-date",dateRange(m)));
      const activityCell=make("span","metrics-timeline-row-activity");
      activityMark(activityCell,m.activity);
      button.append(activityCell);
      const desc=make("span","metrics-timeline-row-title",title(m));
      button.append(desc);
      button.addEventListener("click",()=>openEvent(m,button));
      parent.append(button);
    }
  }
  function renderMonth(parent,first,entries){
    const key=monthKey(first);
    const wrap=make("section","metrics-timeline-month");
    wrap.append(make("h4","",first.toLocaleDateString("en-AU",{month:"long",year:"numeric"})));
    const grid=make("div","metrics-timeline-calendar-grid");
    ["M","T","W","T","F","S","S"].forEach(day=>grid.append(make("span","metrics-timeline-weekday",day)));
    const count=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
    for(let i=0;i<(first.getDay()+6)%7;i++)grid.append(make("span","metrics-timeline-day blank"));
    for(let d=1;d<=count;d++){
      const day=key+"-"+String(d).padStart(2,"0");
      const hits=entries.filter(m=>activeOn(m,day));
      const button=make("button","metrics-timeline-day"+(hits.length?" has-events":""));
      button.type="button";
      button.setAttribute("aria-label",dateLabel(day)+(hits.length?": "+hits.map(x=>meta(x.activity).label+": "+title(x)).join("; "):": No events"));
      button.append(make("span","metrics-timeline-date-number",String(d)));
      if(hits.length){
        const symbols=make("span","metrics-timeline-date-symbols");
        const distinct=[...new Set(hits.map(m=>m.activity))];
        distinct.slice(0,3).forEach(a=>{
          const marker=make("span","metrics-timeline-date-mark activity-"+meta(a).css,meta(a).icon);
          marker.title=meta(a).label;
          symbols.append(marker);
        });
        if(distinct.length>3)symbols.append(make("small","", "+"+(distinct.length-3)));
        button.append(symbols);
        button.addEventListener("click",()=>openDay(day,hits,button));
      }else button.disabled=true;
      grid.append(button);
    }
    wrap.append(grid);parent.append(wrap);
  }
  function renderCalendar(parent,entries){
    const controls=make("div","metrics-timeline-calendar-header");
    const previous=make("button","metrics-button","‹ Previous");
    const next=make("button","metrics-button","Next ›");
    previous.type=next.type="button";
    previous.addEventListener("click",()=>shift(-months));
    next.addEventListener("click",()=>shift(months));
    const starting=startForView(), ending=new Date(starting.getFullYear(),starting.getMonth()+months-1,1);
    const period=months===1?starting.toLocaleDateString("en-AU",{month:"long",year:"numeric"})
      :starting.toLocaleDateString("en-AU",{month:"short",year:"numeric"})+" – "+
      ending.toLocaleDateString("en-AU",{month:"short",year:"numeric"});
    controls.append(previous,make("h3","",period),next);
    const countSwitch=make("div","metrics-timeline-period-switch");
    for(const span of MONTHS){
      const btn=make("button","metrics-button"+(months===span?" selected":""),span+" "+(span===1?"month":"months"));
      btn.type="button";btn.setAttribute("aria-pressed",String(months===span));
      btn.addEventListener("click",()=>{months=span;render();});
      countSwitch.append(btn);
    }
    parent.append(controls,countSwitch);
    const legend=make("div","metrics-timeline-legend");
    const active=[...new Set(entries.map(x=>x.activity))];
    active.forEach(a=>activityMark(legend,a));
    parent.append(legend);
    const monthsGrid=make("div","metrics-timeline-months"+(months===12?" year-view":""));
    for(let i=0;i<months;i++){
      const date=new Date(starting.getFullYear(),starting.getMonth()+i,1);
      renderMonth(monthsGrid,date,entries);
    }
    parent.append(monthsGrid);
  }
  function shift(amount){
    const start=startForView();
    month=monthKey(new Date(start.getFullYear(),start.getMonth()+amount,1));
    dismiss();render();
  }
  function applyFilter(){
    dismiss();
    const latest=filtered().at(-1);
    if(latest)month=latest.start_date.slice(0,7);
    render();
  }
  function render(){
    dismiss();
    root.replaceChildren();
    if(!loaded){
      root.append(make("p","metrics-timeline-empty",errorMessage||"Loading project timeline…"));
      return;
    }
    const header=make("div","metrics-timeline-heading");
    header.append(make("h3","","Project timeline"));
    const items=filtered();
    header.append(make("span","metrics-count",items.length+" of "+milestones.length+" milestones"));
    root.append(header);
    const toolbar=make("div","metrics-timeline-controls");
    const activityNames=[...new Set(milestones.map(m=>m.activity))];
    const types=[...new Set(milestones.map(m=>timelineType(m.type)))];
    const years=[...new Set(milestones.map(m=>m.start_date.slice(0,4)))].sort().reverse();
    select(toolbar,"Activity",[["","All activities"],...activityNames.map(a=>[a,meta(a).label])],activity,v=>{activity=v;applyFilter();});
    select(toolbar,"Type",[["","All types"],...Object.keys(TIMELINE_TYPES).filter(t=>types.includes(t)).map(t=>[t,t])],type,v=>{type=v;applyFilter();});
    select(toolbar,"Year",[["","All years"],...years.map(y=>[y,y])],year,v=>{year=v;applyFilter();});
    const switcher=make("div","metrics-timeline-switch");
    for(const [key,name] of [["timeline","Timeline"],["calendar","Calendar"]]){
      const button=make("button","metrics-button"+(view===key?" selected":""),name);
      button.type="button";button.setAttribute("aria-pressed",String(view===key));
      button.addEventListener("click",()=>{view=key;render();});
      switcher.append(button);
    }
    toolbar.append(switcher);
    root.append(toolbar);
    const results=make("div","metrics-timeline-results");
    if(view==="calendar")renderCalendar(results,items);
    else renderRows(results,items);
    root.append(results);
  }
  return {
    setRelease(metrics){availableMetrics=new Set((metrics||[]).map(m=>m.id));if(loaded)render();},
    async load(){
      const token=++requestId;
      try{
        const {data,error}=await authClient.rpc("cosme_metrics_timeline");
        if(token!==requestId)return;
        if(error)throw error;
        if(!data?.can_view||!Array.isArray(data.milestones))throw new Error("Timeline access unavailable.");
        milestones=data.milestones.filter(m=>isValidDate(m.start_date)&&m.title&&
          (!m.end_date||(isValidDate(m.end_date)&&m.end_date>=m.start_date)))
          .sort((a,b)=>a.start_date.localeCompare(b.start_date)||a.title.localeCompare(b.title));
        loaded=true;errorMessage="";
        if(!month)month=(milestones.at(-1)?.start_date||new Date().toISOString().slice(0,10)).slice(0,7);
        render();
      }catch(error){
        if(token!==requestId)return;
        milestones=[];loaded=false;errorMessage=error.message||"Timeline could not be loaded.";
        render();
      }
    },
    clear(){
      ++requestId;dismiss();milestones=[];loaded=false;errorMessage="";
      availableMetrics.clear();root.replaceChildren();
    }
  };
}
