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
  assert.equal(selectMetrics(list,{sort:"title"})[0].id,"ON-0041");
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
