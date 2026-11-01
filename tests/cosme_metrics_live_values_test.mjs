import test from "node:test";
import assert from "node:assert/strict";
import { verifiedLiveValue, liveStatus, displayValue, exportMetricViewCsv } from "../assets/js/cosme_metrics_live_values.mjs";
import { selectMetrics } from "../assets/js/cosme_metrics_core.mjs";

const dryer = {
  can_view:true,status:"current",
  metric_ids:["SDT-0063","SDT-0064","SDT-0065","SDT-0066"],
  completed_cycles:21,completed_bays:116,wet_kg:1397.2,final_kg:462.45,
  wet_weight_reduction_pct:66.9,
  queried_at:"2026-11-01T04:00:00Z",source_updated_at:"2026-10-31T18:00:00Z"
};
const coverage = {
  can_view:true,metric_id:"ON-0054",rope_count:30,site_count:5,
  queried_at:"2026-11-01T04:00:00Z",source_updated_at:"2026-10-31T15:00:00Z"
};

test("only five precise drying calculation IDs have numeric overlays", () => {
  const fields = {"SDT-0022":["66.9","%"],"SDT-0063":["21","cycles"],
    "SDT-0064":["116","bay records"],"SDT-0065":["1397.2","kg"],
    "SDT-0066":["462.45","kg"]};
  for(const [id,[value,unit]] of Object.entries(fields)){
    const overlay = verifiedLiveValue(id,{dryer});
    assert.equal(overlay.value,value);
    assert.equal(overlay.unit,unit);
    assert.equal(overlay.sourceUpdatedAt,dryer.source_updated_at);
  }
  assert.equal(verifiedLiveValue("SDT-0050",{dryer}),null);
});

test("nursery rope coverage displays current rope/site counts with no unit suffix", () => {
  assert.deepEqual(verifiedLiveValue("ON-0054",{coverage}),{
    value:"30 ropes / 5 sites",unit:"",
    source:"COSME nursery sample-rope register",
    queriedAt:coverage.queried_at,sourceUpdatedAt:coverage.source_updated_at
  });
});

test("authorisation, response status and timestamp failures suppress overlays", () => {
  assert.equal(verifiedLiveValue("SDT-0063",{dryer:{...dryer,can_view:false}}),null);
  assert.equal(verifiedLiveValue("SDT-0063",{dryer:{...dryer,status:"stale"}}),null);
  assert.equal(verifiedLiveValue("SDT-0063",{dryer:{...dryer,queried_at:"bad"}}),null);
  assert.equal(verifiedLiveValue("SDT-0063",{dryer:{...dryer,completed_cycles:-1}}),null);
  assert.equal(verifiedLiveValue("SDT-0063",{dryer:{...dryer,metric_ids:[]}}),null);
  assert.equal(verifiedLiveValue("ON-0054",{coverage:{...coverage,site_count:NaN}}),null);
});

test("linked Mawimbi context is not mistaken for the same live metric value", () => {
  const feeds={mawimbiContext:id => id==="MAW-0086" ? {value:"9"} : null};
  assert.deepEqual(liveStatus("MAW-0086",feeds),{
    kind:"linked",source:"Mawimbi operational aggregate",currentValue:null
  });
  assert.equal(verifiedLiveValue("MAW-0086",feeds),null);
});

test("published value always survives and historical version stays frozen", () => {
  const metric={value:"20",unit:"cycles"};
  const status=liveStatus("SDT-0063",{dryer});
  assert.deepEqual(displayValue(metric,status,true,true),{
    value:"21",unit:"cycles",state:"Live",
    checkedAt:dryer.queried_at,sourceUpdatedAt:dryer.source_updated_at,
    publishedValue:"20",publishedUnit:"cycles"
  });
  assert.equal(displayValue(metric,status,false,true).value,"20");
  assert.equal(displayValue(metric,status,true,false).value,"20");
  assert.equal(metric.value,"20");
  assert.equal(displayValue(metric,liveStatus("MAW-0086",{mawimbiContext:()=>({})}),true,true).state,"Linked");
});

test("export includes both live displayed and frozen published values with provenance", () => {
  const metric={id:"SDT-0063",activity:"Solar Drying Tables",theme:"Delivery",
    title:"Completed COSME drying cycles",value:"20",unit:"cycles",
    source:"Read-only COSME",note:"",featured:false};
  const csv=exportMetricViewCsv([metric],"V0.3",m=>liveStatus(m.id,{dryer}),true,true);
  assert.match(csv,/Displayed value/);
  assert.match(csv,/Published value/);
  assert.match(csv,/"21","cycles","Live","20","cycles"/);
  assert.match(csv,/2026-11-01T04:00:00Z/);
  assert.equal(metric.value,"20");
  const historic=exportMetricViewCsv([metric],"V0.1",m=>liveStatus(m.id,{dryer}),true,false);
  assert.match(historic,/"20","cycles","Published","20","cycles"/);
});

test("value sorting and text search use the displayed overlay, not hidden source values",()=>{
  const rows=[
    {id:"a",value:"500",liveDisplayValue:"10",title:"Metric A",unit:"kg",activity:"Dryer",theme:"Deployment"},
    {id:"b",value:"10",liveDisplayValue:"200",title:"Metric B",unit:"kg",activity:"Dryer",theme:"Deployment"}
  ];
  assert.deepEqual(selectMetrics(rows,{sort:"value"}).map(r=>r.id),["a","b"]);
  assert.deepEqual(selectMetrics(rows,{query:"200"}).map(r=>r.id),["b"]);
  assert.equal(rows[0].value,"500");
});
