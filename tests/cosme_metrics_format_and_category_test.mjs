import test from "node:test";
import assert from "node:assert/strict";
import {displayMetricValue, selectMetrics, exportSelectedCsv} from "../assets/js/cosme_metrics_core.mjs";

test("formats monetary values without rewriting the source",()=>{
  assert.equal(displayMetricValue("2065520","KES").full,"KES 2,065,520");
  assert.equal(displayMetricValue("10000","CAD").full,"CAD 10,000");
  assert.equal(displayMetricValue("1234567.90","KES").full,"KES 1,234,567.90");
  assert.equal(displayMetricValue("450 × 450 × 700","mm (L × W × H)").full,"450 × 450 × 700 mm");
  assert.equal(displayMetricValue("100-105","kg").full,"100–105 kg");
  assert.equal(displayMetricValue("66.9","%").full,"66.9%");
  assert.equal(displayMetricValue("~500","kg/hour").full,"~500 kg/hour");
  assert.equal(displayMetricValue("≥10","years").full,"≥10 years");
  assert.equal(displayMetricValue(null,"KES").full,"Not recorded");
  assert.equal(displayMetricValue("Pallets; 1 manual stacker","handling equipment").full,"Pallets; 1 manual stacker");
});
test("category multi-select composes with activity, search, and Top Picks",()=>{
  const data=[
    {id:"A",activity:"Hub",theme:"Financial",title:"Budget",value:"2065520",featured:true},
    {id:"B",activity:"Hub",theme:"Performance",title:"Load",value:"10",featured:true},
    {id:"C",activity:"Hub",theme:"Financial",title:"Cost",value:"",featured:false},
    {id:"D",activity:"Nursery",theme:"Financial",title:"Budget",value:"100",featured:true}
  ];
  assert.deepEqual(selectMetrics(data,{activity:"Hub",categories:["Financial"]}).map(x=>x.id),["A","C"]);
  assert.deepEqual(selectMetrics(data,{activity:"Hub",categories:["Financial","Performance"],featured:true}).map(x=>x.id),["A","B"]);
  assert.deepEqual(selectMetrics(data,{activity:"Hub",categories:["Financial"],query:"budget"}).map(x=>x.id),["A"]);
});
test("sort value numerically and keep missing numbers last in both directions",()=>{
  const data=[
    {id:"A",value:"2,065,520"},
    {id:"B",value:"79,360"},
    {id:"C",value:""},
    {id:"D",value:"645000"}
  ];
  assert.deepEqual(selectMetrics(data,{sort:"value"}).map(x=>x.id),["B","D","A","C"]);
  assert.deepEqual(selectMetrics(data,{sort:"value",direction:"desc"}).map(x=>x.id),["A","D","B","C"]);
});
test("exports still use original values and separate units",()=>{
  const rows=[{id:"AGH-0029",activity:"Aggregation Hub",theme:"Financial",title:"BoQ",value:"2065520",unit:"KES"}];
  assert.match(exportSelectedCsv(rows,"V0.1"),/"2065520","KES"/);
});
