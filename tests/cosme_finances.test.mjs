import test from "node:test";
import assert from "node:assert/strict";
import {amountOrNull,money,normalizeFinanceData,breakdown,activityGroups,exportFinanceCsv} from "../assets/js/cosme_finances_core.mjs";

test("null/blank/unpriced values are never treated as zero",()=>{
  assert.equal(amountOrNull(""),null);
  assert.equal(amountOrNull(null),null);
  assert.equal(amountOrNull(false),null);
  assert.equal(money(null,"KES"),"Unpriced");
  assert.equal(money(0,"KES"),"KES 0");
  assert.equal(money(-19.5,"CAD"),"CAD -19.50");
});
const input={
  sources:[{id:"s1",display_name:"PLAN quote",source_date:"2026-04-01"}],
  packages:[
    {id:"p1",source_id:"s1",activity:"Solar Drying Tables",version:"V1.3",basis:"quoted",currency:"KES",control_total:240,units_covered:10},
    {id:"p2",source_id:"s1",activity:"Solar Drying Tables",version:"V1.2",basis:"paid",currency:"CAD",control_total:20}
  ],
  lines:[
    {package_id:"p1",source_row:"A1",category:"Materials",subcategory:"Steel",description:"Pipe",amount:150,unit_rate:15,quantity:10,reconciliation_status:"verified",included_in_total:true},
    {package_id:"p1",source_row:"A2",category:"Labour",subcategory:"Fabrication",description:"Welding",amount:90,reconciliation_status:"verified",included_in_total:true},
    {package_id:"p1",source_row:"A3",category:"Materials",description:"Disputed",amount:50,reconciliation_status:"review",included_in_total:true},
    {package_id:"p1",source_row:"A4",category:"Materials",description:"Duplicated quote",amount:240,reconciliation_status:"verified",included_in_total:false},
    {package_id:"p2",source_row:"B1",category:"Other",description:"Credit",amount:-20,reconciliation_status:"verified",included_in_total:true}
  ]
};
test("isolates source packages, basis and currency; excludes duplicate/review amounts",()=>{
  const packages=normalizeFinanceData(input);
  assert.equal(packages.length,2);
  const b=breakdown(packages[0]);
  assert.equal(b.total,240);
  assert.equal(b.review,1);
  assert.equal(b.categories.length,2);
  assert.equal(b.reconciled,false);
  assert.equal(b.difference,0);
  assert.equal(breakdown(packages[1]).total,-20);
  const groups=activityGroups(packages);
  assert.equal(groups.length,1);
  assert.equal(groups[0].entries.length,2);
  assert.equal(groups[0].entries[0].summary.total,240);
});
test("reconciliation only succeeds with all verified included lines",()=>{
  const p=normalizeFinanceData(input)[0];
  p.lines=p.lines.filter(l=>l.reconciliation_status==="verified");
  assert.equal(breakdown(p).reconciled,true);
  p.control_total=239;
  assert.equal(breakdown(p).difference,1);
  assert.equal(breakdown(p).reconciled,false);
});
test("CSV escapes quotes and retains source positions without deduplicating packages",()=>{
  const p=normalizeFinanceData(input);
  p[0].lines[0].description='Pipe "long"';
  const csv=exportFinanceCsv(p);
  assert.ok(csv.includes('"Pipe ""long"""'));
  assert.ok(csv.includes('"A1"'));
  assert.ok(csv.includes('"Entry date"'));
  assert.ok(csv.includes('"quoted"'));
  assert.ok(csv.includes('"CAD"'));
});
test("invalid cost basis/currency packages cannot display as reviewed cost totals",()=>{
  const data=normalizeFinanceData({packages:[
    {id:"x",basis:"mystery",currency:"KES"},
    {id:"y",basis:"paid",currency:""},
    {id:"z",basis:"paid",currency:"KES"}
  ]});
  assert.deepEqual(data.map(x=>x.id),["z"]);
});

test("cost overview sorts primary project activities before procurement",()=>{
  const sample=normalizeFinanceData({packages:[
    {id:"p",activity:"COSME Procurement",basis:"invoiced",currency:"CAD",version:"2025"},
    {id:"d",activity:"Solar Drying Tables",basis:"quoted",currency:"KES",version:"V1.3"},
    {id:"n",activity:"Offshore Nursery",basis:"invoiced",currency:"KES",version:"LM"},
    {id:"m",activity:"Mawimbi",basis:"paid",currency:"KES",version:"RO"}
  ]});
  assert.deepEqual(activityGroups(sample).map(x=>x.name),
    ["Solar Drying Tables","Offshore Nursery","Mawimbi","COSME Procurement"]);
});

test("unknown source or missing amounts remain visible as review, never included",()=>{
  const p=normalizeFinanceData({packages:[{id:"p",basis:"paid",currency:"KES",control_total:null}],
    lines:[{package_id:"p",source_row:"A1",category:"Materials",amount:null,reconciliation_status:"review"}]})[0];
  const b=breakdown(p);
  assert.equal(b.total,0);
  assert.equal(b.review,1);
  assert.equal(b.reconciled,false);
  assert.equal(p.lines.length,1);
});
test("prototype numeric version sorting places latest first on equal source dates",()=>{
  const p=normalizeFinanceData({packages:[
    {id:"old",activity:"Dryer",version:"V1.2",basis:"estimated",currency:"KES"},
    {id:"new",activity:"Dryer",version:"V1.10",basis:"estimated",currency:"KES"}
  ]});
  const g=activityGroups(p);
  assert.deepEqual(g[0].entries.map(x=>x.version),["V1.10","V1.2"]);
});

test("original payment currency remains separate from converted reporting currency",()=>{
  const packages=normalizeFinanceData({packages:[{id:"conversion",activity:"Project",basis:"paid",currency:"CAD"}],
    lines:[{package_id:"conversion",source_row:"Example!A1",category:"Other",
      description:"Synthetic purchase",unit_rate:110,rate_currency:"AUD",amount:95,reconciliation_status:"verified"}]});
  assert.equal(packages[0].currency,"CAD");
  assert.equal(packages[0].lines[0].rate_currency,"AUD");
  const csv=exportFinanceCsv(packages);
  assert.ok(csv.includes('"CAD"'));
  assert.ok(csv.includes('"AUD"'));
  assert.ok(csv.includes('"Rate currency"'));
});
