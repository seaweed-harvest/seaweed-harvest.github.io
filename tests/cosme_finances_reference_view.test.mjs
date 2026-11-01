import test from "node:test";
import assert from "node:assert/strict";
import {expenseActivity,expenseCategory,itemDescription,expenseOverview,projectOverview,referenceFor} from "../assets/js/cosme_finances_view.mjs";

const line=(description,category="Materials",amount=50)=>({id:"row",description,category,amount,
 included_in_total:true,reconciliation_status:"verified",source_row:"Expenses!K147"});
const pkg=(activity,lines)=>({id:activity,activity,version:"Expense register",basis:"paid",currency:"CAD",lines});

test("explicit expense classifications keep project/other lean",()=>{
 const other=pkg("COSME Procurement — Project / Other",[]);
 assert.equal(expenseActivity(other,line("Controller - Electronics")),"Data Loggers");
 assert.equal(expenseActivity(other,line("Solar Fan & Wind Sensing")),"Data Loggers");
 assert.equal(expenseActivity(other,line("Travel / M-PESA","Admin")),"Travel");
 assert.equal(expenseActivity(other,line("Airport transfer","Travel")),"Travel");
 assert.equal(expenseActivity(other,line("Aggregation Centre 2x Table (Deposit)")),"Aggregation Hub");
 assert.equal(expenseActivity(other,line("Labour - Visit to site for Baler Inspection","Labour / Service")),"Aggregation Hub");
 assert.equal(expenseActivity(other,line("Power Installation Assessment (Bati)","Labour / Service")),"Aggregation Hub");
 assert.equal(expenseActivity(other,line("Weld Equipment")),"Solar Drying Tables");
 assert.equal(expenseActivity(other,line("Greenhouse Material Installation","Labour / Service")),"Solar Drying Tables");
 assert.equal(expenseActivity(other,line("Storage Containers")),"Project / Other");
 assert.equal(expenseActivity(other,line("COSME Kenya Contractors","Labour / Service")),"Project / Other");
});
test("retains source-specific items before generic expense category",()=>{
 const r={...line("Controller - Electronics"),item_detail:"SIM, T/H Sensors and I2C Connectors",
 note:"Supplier: Core Electronics; FX rate: 0.9"};
 assert.equal(itemDescription(r),"SIM, T/H Sensors and I2C Connectors");
 assert.equal(itemDescription({...r,item_detail:null}),"Electronics purchase · Core Electronics");
 assert.equal(expenseCategory(r,"Data Loggers"),"Electronics & sensing");
});
test("reallocated expense totals conserve amounts and isolate activity categories",()=>{
 const src=pkg("COSME Procurement — Project / Other",[
  line("Controller - Electronics","Materials",101),line("Storage Containers","Materials",23),
  line("Travel / M-PESA","Admin",10),line("Baler inspection","Labour / Service",20)
 ]);
 const assigned=expenseOverview([src]);
 assert.equal(assigned.length,4);
 assert.equal(assigned.reduce((sum,p)=>sum+p.summary.total,0),154);
 assert.deepEqual(assigned.map(p=>p.activity),[
  "COSME Procurement — Travel","COSME Procurement — Data Loggers",
  "COSME Procurement — Aggregation Hub","COSME Procurement — Project / Other"
 ]);
});
test("solar shed is a reference within the drying activity and not summed with table actual",()=>{
 const plant={id:"shed",activity:"Solar Drying Shed & Store",package_key:"legacy-mwazaro-shed-store",
 version:"Existing site · Mwazaro priced BoQ",basis:"quoted",currency:"KES",
 control_total:2641401.2,lines:[]};
 const plan={id:"plan",activity:"Solar Drying Tables",package_key:"v13-plan-10",version:"V1.3",basis:"actual",currency:"KES",
 control_total:2471500,units_covered:10,lines:[]};
 const groups=projectOverview([plant,plan]);
 assert.equal(groups.length,1);
 assert.equal(groups[0].name,"Solar Drying Tables");
 assert.equal(groups[0].entries[0].id,"plan");
 assert.equal(referenceFor(groups[0]).amount,"KES 247,150 / table");
});
test("nursery headline uses partial repeat-build rate, not historical invoice average",()=>{
 const estimate={id:"future",package_key:"nursery-future-4-rafts",version:"Future repeat-build · partial budget",
 activity:"Offshore Nursery",currency:"KES",basis:"estimated",units_covered:4,control_total:1081868.8,lines:[]};
 const g=projectOverview([estimate])[0];
 assert.equal(referenceFor(g).amount,"KES 270,467 / raft");
 assert.match(referenceFor(g).note,/partial estimate/);
});
test("Mawimbi budget uses source KES and CAD amounts rather than a public hardcoded conversion",()=>{
 const ref=referenceFor({name:"Mawimbi",entries:[{report:{budget_kes:900,budget_cad:10,budget_rate:90}}]});
 assert.equal(ref.amount,"KES 900");
 assert.equal(ref.note,"Budget · CAD 10");
 assert.equal(referenceFor({name:"Mawimbi",entries:[]}).amount,"—");
});

 test("Itemisation is accepted only when it exactly matches payment costs",async()=>{
  const {itemisationFor}=await import("../assets/js/cosme_finances_view.mjs");
  const p={summary:{total:100},report:{itemisation:{items:[{description:"A",amount:60},{description:"B",amount:40}]}}};
  assert.ok(itemisationFor(p));
  p.report.itemisation.items[1].amount=41;assert.equal(itemisationFor(p),null);
  p.report.itemisation.items[1].amount=null;assert.equal(itemisationFor(p),null);
  p.report.itemisation.items[1].amount="40";assert.equal(itemisationFor(p),null);
  assert.equal(p.summary.total,100);
 });
