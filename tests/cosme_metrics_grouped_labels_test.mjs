import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {metricDisplayName,metricType,withMetricPresentation} from "../assets/js/cosme_metrics_labels.mjs";
import {selectMetrics} from "../assets/js/cosme_metrics_core.mjs";
import {exportMetricViewCsv} from "../assets/js/cosme_metrics_live_values.mjs";

const nursery=(id,title,extra={})=>({id,activity:"Offshore Nursery",theme:"Design",
  title,unit:"metres",value:"4 × 5",...extra});
const raftDimensions=[
  nursery("ON-0016","Raft dimensions — original 2025 concept"),
  nursery("ON-0034","Raft overall frame dimensions — as built"),
  nursery("ON-0064","Raft dimensions — September 2025 prototype"),
  nursery("ON-0070","Raft dimensions — KMFRI 2025–26 trial")
];

test("four distinct raft designs have the same type prefix without changing the frozen title",()=>{
  const named=raftDimensions.map(withMetricPresentation);
  assert.equal(new Set(named.map(x=>x.displayTitle)).size,4);
  for(const x of named){
    assert.match(x.displayTitle,/^Raft dimensions — /);
    assert.equal(x.metricType,"Raft dimensions");
  }
  assert.match(named[0].displayTitle,/Original concept/);
  assert.match(named[1].displayTitle,/Living Machines/);
  assert.match(named[2].displayTitle,/September 2025 prototype/);
  assert.match(named[3].displayTitle,/KMFRI trial/);
  assert.equal(raftDimensions[1].title,"Raft overall frame dimensions — as built");
  assert.equal(raftDimensions[1].displayTitle,undefined);
});

test("Mkwiro rope samples use mapped Raft A/B/C sites, not just the ambiguous raft letter",()=>{
  const expected={
    "ON-0056":"Raft C (MK-R1)","ON-0057":"Raft A (MK-R2)","ON-0058":"Raft B (MK-R3)",
    "ON-0059":"Shore A (MK-SF2/R2)","ON-0060":"Shore B (MK-SF3/R3)"
  };
  for(const [id,site] of Object.entries(expected)){
    const name=metricDisplayName(nursery(id,"original"));
    assert.ok(name.startsWith("Initial sample biomass — Mkwiro · "),name);
    assert.ok(name.includes(site),name);
  }
});

test("only explicitly Mkwiro-sourced live comparison receives a Mkwiro site label",()=>{
  const comparison="Daily growth comparison · Raft C vs Shore C";
  const valid=nursery("LIVE-ON-101",comparison,{
    operationalLive:true,note:"5 matched rope pairs · MK-R1 / MK-SF1/R1 · Week 2–4"
  });
  assert.equal(metricDisplayName(valid),"Daily growth comparison — Mkwiro · Raft C vs Shore C");
  assert.equal(metricType(valid),"Daily growth comparison");
  assert.equal(metricDisplayName({...valid,note:"Tumbe · raft C and shore C"}),comparison);
  assert.equal(metricDisplayName({...valid,operationalLive:false}),comparison);
});

test("similar metric types sort together across source IDs, and search finds new and original names",()=>{
  const list=[
    nursery("ON-0064","Raft dimensions — September 2025 prototype"),
    nursery("ON-0010","Mkwiro site suitability survey"),
    nursery("ON-0016","Raft dimensions — original 2025 concept"),
    nursery("ON-0034","Raft overall frame dimensions — as built"),
    nursery("ON-0070","Raft dimensions — KMFRI 2025–26 trial"),
    nursery("ON-0041","Early prototype deployment — 22 Sep 2025")
  ].map(withMetricPresentation);
  const sorted=selectMetrics(list,{sort:"metricType"}).map(x=>x.id);
  const dims=raftDimensions.map(x=>x.id);
  const positions=dims.map(id=>sorted.indexOf(id)).sort((a,b)=>a-b);
  assert.equal(positions[3]-positions[0],3);
  assert.deepEqual(selectMetrics(list,{query:"Living Machines"}).map(x=>x.id),["ON-0034"]);
  assert.deepEqual(selectMetrics(list,{query:"overall frame dimensions"}).map(x=>x.id),["ON-0034"]);
  assert.equal(selectMetrics(list,{sort:"id"})[0].id,"ON-0010");
  assert.equal(selectMetrics(list,{sort:"title"})[0].id,"ON-0010");
});

test("other activities receive useful type groups and safe specific labels",()=>{
  const cases=[
    ["SDT-0006","Solar Drying Tables","Table length","Table dimensions"],
    ["SDT-0011","Solar Drying Tables","Table width","Table dimensions"],
    ["MAW-0012","Mawimbi","June baseline manual pressing","Press productivity"],
    ["MAW-0027","Mawimbi","Target powered press productivity","Press productivity"],
    ["AGH-0014","Aggregation Hub","Bale dimensions — compressed","Bale dimensions"],
    ["AGH-0054","Aggregation Hub","Bale dimensions — after release","Bale dimensions"],
    ["OFB-0002","Off-bottom Farming","Model plot dimensions","Plot dimensions and layout"]
  ];
  for(const [id,activity,title,family] of cases)
    assert.equal(metricType({id,activity,title}),family);
});

test("CSV keeps grouped labels and source originals alongside unchanged published value",()=>{
  const metric=withMetricPresentation(nursery("ON-0034","Raft overall frame dimensions — as built",{
    value:"~6.5 × 3",unit:"metres",theme:"2026 Design & Operating Basis",note:"as-built envelope"
  }));
  const csv=exportMetricViewCsv([metric],"V0.6",()=>({kind:"published",source:""}),false,true);
  assert.match(csv,/"Original metric name"/);
  assert.match(csv,/"Raft dimensions — Living Machines \(2026 as-built\)","Raft overall frame dimensions — as built"/);
  assert.match(csv,/"~6.5 × 3","metres","Published","~6.5 × 3","metres"/);
  assert.equal(metric.value,"~6.5 × 3");
});

test("desktop/mobile headings and detail panel render presentation labels only",()=>{
  const page=readFileSync(new URL("../assets/js/cosme_metrics_page.js",import.meta.url),"utf8");
  const html=readFileSync(new URL("../cosme_metrics.html",import.meta.url),"utf8");
  assert.match(page,/sortKey = "metricType"/);
  assert.match(page,/sort:"metricType"|sort: sortKey/);
  assert.match(page,/withMetricPresentation\(metric\)/);
  assert.match(page,/metrics-type-row/);
  assert.match(page,/metrics-group-label/);
  assert.match(page,/metricDisplayName\(metric\)/);
  assert.match(page,/Original metric name/);
  assert.match(html,/id="sortChoice"/);
});

test("second-pass audit keeps costs, equipment and verification in the right families",()=>{
  const cases=[
    ["AGH-0032","Aggregation Hub","Site fit-out and equipment actual cost","Hub costs and funding"],
    ["AGH-0060","Aggregation Hub","Hydraulic baler PO price","Hub costs and funding"],
    ["AGH-0043","Aggregation Hub","Baler maintenance approach","Baler equipment and maintenance"],
    ["MAW-0026","Mawimbi","Existing frames allocated to dual pressing","Press equipment and commissioning"],
    ["MAW-0056","Mawimbi","QC package invoice amount","Equipment and funding"],
    ["MAW-0072","Mawimbi","October pre-RO borehole E. coli screen","Water quality"],
    ["SDT-0010","Solar Drying Tables","Weather protection","Drying-table design"],
    ["SDT-R007","Solar Drying Tables","Weather protection acceptance","Drying quality and verification"],
    ["SDT-R005","Solar Drying Tables","Indicative initial cost saving per drying area","Drying-table costs"],
    ["SDT-0063","Solar Drying Tables","Completed COSME drying cycles","Drying operations and cycle counts"],
    ["ON-0052","Offshore Nursery","PLAN three-raft supplier invoice","Nursery procurement"],
    ["ON-0072","Offshore Nursery","KMFRI prototype construction sinkers","Raft design and configuration"],
    ["ON-R007","Offshore Nursery","Open flotation defect","Raft deployment and inspection"]
  ];
  for(const [id,activity,title,expected] of cases)
    assert.equal(metricType({id,activity,title}),expected,id);
});

test("core metric leads the source-checked variants across all five activities",()=>{
  const cases=[
    ["AGH-0010","Aggregation Hub","Before-upgrade dry seaweed storage capacity","Storage capacity — Before upgrade (unmeasured)"],
    ["AGH-0061","Aggregation Hub","Factory bale mass achieved","Bale mass — Factory reported"],
    ["AGH-0063","Aggregation Hub","Conditional baler-only equivalent mass rate","Baler-only mass rate — Conditional equivalent"],
    ["MAW-0013","Mawimbi","June baseline daily processing","Daily processing — Manual baseline (June)"],
    ["MAW-0053","Mawimbi","Press upgrade total quote","Press upgrade cost — Total quote"],
    ["MAW-0067","Mawimbi","August borehole total coliforms","Total coliforms — August borehole sample"],
    ["ON-0014","Offshore Nursery","Mkwiro candidate-site depths — March 2025 survey","Site depth — Mkwiro candidate positions (March 2025)"],
    ["ON-0031","Offshore Nursery","Modelled harvest biomass — four-week scenario","Harvest biomass — Modelled four-week scenario"],
    ["ON-0039","Offshore Nursery","Tumbe deployment and commissioning status","Raft deployment — Tumbe commissioning status"],
    ["SDT-0025","Solar Drying Tables","Median duration — selected COSME vs existing","Drying duration — Selected COSME vs existing median"],
    ["SDT-0066","Solar Drying Tables","Total final recorded weight","Final recorded mass — Drying loads"],
    ["SDT-R005","Solar Drying Tables","Indicative initial cost saving per drying area","Cost saving per drying area — Indicative initial"],
    ["OFB-0002","Off-bottom Farming","Model plot dimensions","Plot dimensions — Model"],
    ["OFB-0020","Off-bottom Farming","Verified actual dry harvest per plot","Dry harvest per plot — Actual unverified"]
  ];
  for(const [id,activity,title,expected] of cases){
    const metric={id,activity,title};
    assert.equal(metricDisplayName(metric),expected,id);
    assert.equal(metric.title,title,"source title must remain intact");
    assert.notEqual(metricType(metric),"Other metrics",id);
  }
});

test("associated live indicators use quantity-first names without changing source titles",()=>{
  const cases=[
    ["Sample ropes with Week 2 measurements","Sample-rope coverage — Week 2 measured","Offshore Nursery"],
    ["Sample ropes with Week 4 measurements","Sample-rope coverage — Week 4 measured","Offshore Nursery"],
    ["Drying bays completed within 5 days","Drying bay completion — Within five days","Solar Drying Tables"],
    ["Median drying time","Drying duration — Qualified bays median","Solar Drying Tables"],
    ["Finalised collection records","Collection records — Finalised receipt-backed","Mawimbi"],
    ["Seaweed collected (finalised)","Wet seaweed collected — Finalised receipt-backed","Mawimbi"],
    ["Registered active communities","Communities — Registered active","Mawimbi"],
    ["Communities represented by finalised collections","Communities — Finalised collections","Mawimbi"],
    ["Registered active farmers","Farmers — Registered active","Mawimbi"],
    ["Processing records","Processing records — Recorded","Mawimbi"],
    ["Seaweed received for processing","Wet seaweed received — Processing","Mawimbi"],
    ["Liquid pressed","Pressed-liquid output — Recorded","Mawimbi"],
    ["Liquid extracted per kg processed","Pressed-liquid yield — Per wet kg processed","Mawimbi"],
    ["Numbered containers recorded","Numbered containers — Distinct initial serials","Mawimbi"],
    ["Site water samples","Water samples — Site","Mawimbi"],
    ["RO monitoring records","RO monitoring — Records","Mawimbi"],
    ["Historical stock disposal volume","Historical stock disposal — Recorded volume","Mawimbi"]
  ];
  for(const [title,expected,activity] of cases){
    const metric={id:"LIVE-TEST",title,activity,operationalLive:true};
    assert.equal(metricDisplayName(metric),expected,title);
    assert.equal(metricDisplayName({...metric,operationalLive:false}),title);
    assert.notEqual(metricType(metric),"Other metrics",title);
  }
});

test("complete before/after review matches the published display map",()=>{
  const csv=readFileSync(new URL("../01_Ag_Planning_Documents/2026-11-01_COSME_METRIC_NAMES_BEFORE_AFTER.csv",import.meta.url),"utf8").replace(/^\uFEFF/,"");
  const rows=csv.trim().split(/\r?\n/).map(line=>
    [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match=>match[1].replaceAll('""','"')));
  assert.deepEqual(rows[0],["Metric ID","Activity","Kind","Before (source title)","After (display name)","Metric type","Decision"]);
  const published=rows.slice(1).filter(row=>row[2]==="Published");
  const live=rows.slice(1).filter(row=>row[2]==="Live indicator");
  assert.equal(published.length,347);
  assert.equal(live.length,20);
  assert.equal(new Set(rows.slice(1).map(row=>row[0])).size,367);
  assert.equal(published.filter(row=>row[6]==="Revised").length,271);
  for(const [id,activity,,original,display,type,decision] of published){
    const metric={id,activity,title:original};
    assert.equal(metricDisplayName(metric),display,id);
    assert.equal(metricType(metric),type,id);
    assert.equal(decision,original===display?"Retained":"Revised",id);
  }
});

test("earlier immutable release titles do not inherit later evidence wording",()=>{
  const older=[
    ["SDT-0018","Quoted production-table package cost"],
    ["SDT-0075","Comparative drying effectiveness"],
    ["MAW-0039","Powered dual-press status"],
    ["MAW-0073","October RO E. coli screening"],
    ["MAW-0082","Offtake volume in Seaweed Harvest"],
    ["MAW-0083","Farmer purchase value"],
    ["MAW-0086","Processing record counts"],
    ["MAW-0087","Stock and carton QC record counts"],
    ["ON-0039","Living Machines deployment — Tumbe"]
  ];
  for(const [id,title] of older)
    assert.equal(metricDisplayName({id,title}),title,id);
});
