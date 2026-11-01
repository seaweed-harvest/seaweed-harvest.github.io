import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createCosmeFinancesPanel} from "../assets/js/cosme_finances_panel.mjs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const page=read("../cosme_metrics.html");
const main=read("../assets/js/cosme_metrics_page.js");
const css=read("../assets/css/cosme_finances.css");
const panelSource=read("../assets/js/cosme_finances_panel.mjs");

test("Finance uses matching Metrics/Timeline shell with two compact internal views",()=>{
  assert.match(page,/data-tab="finances"/);
  assert.match(page,/cosme_finances\.css\?v=4/);
  assert.match(main,/cosme_finances_panel\.mjs\?v=5/);
  assert.match(panelSource,/Project costs & estimates/);
  assert.match(panelSource,/Expense register/);
  assert.match(panelSource,/Filter finance activity/);
  assert.match(panelSource,/Filter cost basis/);
  assert.match(css,/\.finance-table-header/);
  assert.match(css,/\.finance-row\{/);
  assert.match(css,/grid-template-columns/);
  assert.match(css,/max-width:580px/);
});
test("Accurate project version stages and source labels",()=>{
  assert.match(panelSource,/V1\.1 · Shangani as-built BOM/);
  assert.match(panelSource,/V1\.2 · Pre-build estimate/);
  assert.match(panelSource,/V1\.2 · Funzi as-built BOM/);
  assert.match(panelSource,/V1\.3 · Pre-build estimate/);
  assert.match(panelSource,/V1\.3 · PLAN production \(actual\)/);
  assert.match(panelSource,/V1\.2 · Rough design \(materials\)/);
  assert.match(panelSource,/V1\.3 · Living Machines \(Cascadia\)/);
  assert.match(panelSource,/V1\.3 · Living Machines \(PLAN\)/);
  assert.match(panelSource,/hasComparableUnit/);
  assert.doesNotMatch(panelSource,/PLAN as-built/);
  assert.doesNotMatch(panelSource,/unpriced or unchecked source item/);
  assert.match(panelSource,/LM-C"\|\|p\.package_key==="LM-P"/);
  assert.match(panelSource,/return "2026-07-28"/);
});
class FakeNode{
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.listeners={};this.open=false;this.value="";this.textContent="";this.className="";this.title="";this.style={}}
  append(...elems){this.children.push(...elems)}
  replaceChildren(...elems){this.children=[...elems]}
  setAttribute(k,v){this.attributes[k]=v}
  addEventListener(k,f){this.listeners[k]=f}
  querySelectorAll(sel){
    const out=[];
    const walk=el=>{
      for(const c of el.children){
        if(sel==='details[data-finance-key]'&&c.tag==='details'&&c.dataset.financeKey)out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}
function fakeDom(){globalThis.document={createElement:tag=>new FakeNode(tag)}}
function payload(){
  return {
    sources:[{id:"s1",display_name:"V1.3 PLAN quote",source_date:"2026-04-01"}],
    packages:[{id:"p1",source_id:"s1",version:"V1.3",package_key:"v13-plan-10",activity:"Solar Drying Tables",basis:"quoted",currency:"KES",control_total:2471500,units_covered:10,unit_label:"tables",reconciliation_status:"verified"}],
    lines:[{package_id:"p1",source_row:"A1",category:"Materials",subcategory:"Metal",description:"Steel pipes",quantity:1,unit_rate:2471500,amount:2471500,reconciliation_status:"verified",included_in_total:true}]
  };
}
test("Refresh with identical data retains open item and DOM identity; changed data restores open state",async()=>{
  fakeDom();
  const root=new FakeNode("div");
  let data=payload();
  const auth={rpc:async()=>({data,error:null})};
  const finance=createCosmeFinancesPanel(auth,root);
  await finance.load();
  const getDetail=()=>root.querySelectorAll("details[data-finance-key]").find(x=>x.dataset.financeKey==="pkg:p1");
  const first=getDetail();assert.ok(first);first.open=true;
  await finance.load();
  assert.strictEqual(getDetail(),first,"Unchanged session refresh must not recreate/close open rows");
  data={...data,packages:[{...data.packages[0],version:"V1.3 revised label"}]};
  await finance.load();
  const second=getDetail();
  assert.notStrictEqual(second,first,"Changed data should render");
  assert.equal(second.open,true,"Open row state must survive data refresh");
});
test("Expense register separates procurement from project versions",async()=>{
  fakeDom();
  const root=new FakeNode("div");
  const data=payload();
  data.packages.push({id:"exp",source_id:"s1",activity:"COSME Procurement — Offshore Nursery",version:"Expense register",basis:"paid",currency:"CAD",units_covered:1,reconciliation_status:"review"});
  data.lines.push({package_id:"exp",category:"Travel",subcategory:"Field",source_row:"3",description:"Transfer",amount:10,reconciliation_status:"verified",included_in_total:true});
  const finance=createCosmeFinancesPanel({rpc:async()=>({data,error:null})},root);
  await finance.load();
  const buttons=root.children.flatMap(c=>c.children).flatMap(c=>[c,...c.children]).filter(c=>c.tag==="button");
  const expenses=buttons.find(c=>c.textContent==="Expense register");
  assert.ok(expenses,"Expense sub-view tab exists");
  expenses.listeners.click();
  assert.ok(root.querySelectorAll("details[data-finance-key]").some(x=>x.dataset.financeKey==="pkg:expense:Travel"));
  assert.ok(!root.querySelectorAll("details[data-finance-key]").some(x=>x.dataset.financeKey==="pkg:p1"));
});


test("Owner-confirmed PLAN actual and V1.2 chosen itemised estimate appear as clear package rows",async()=>{
  fakeDom();
  const root=new FakeNode("div");
  const data=payload();
  data.sources.push({id:"s2",display_name:"V1.2 Funzi design BOM",source_date:null});
  data.packages.push({
    id:"p2",source_id:"s2",package_key:"v12-design",version:"V1.2 · Pre-build",
    activity:"Solar Drying Tables",basis:"estimated",currency:"KES",
    units_covered:1,unit_label:"table",control_total:162970,reconciliation_status:"review"
  });
  data.lines.push({package_id:"p2",source_row:"V1.2!F30",category:"Materials",
    subcategory:"Steel",description:"Materials subtotal",amount:178670,
    reconciliation_status:"verified",included_in_total:true});
  const finance=createCosmeFinancesPanel({rpc:async()=>({data,error:null})},root);
  await finance.load();
  const details=root.querySelectorAll("details[data-finance-key]");
  const getRow=id=>details.find(d=>d.dataset.financeKey==="pkg:"+id).children[0].children.map(c=>c.textContent);
  const plan=getRow("p1");
  const v12=getRow("p2");
  assert.ok(plan.includes("Actual"));
  assert.ok(plan.includes("KES 247,150 / table"));
  assert.ok(plan.includes("KES 2,471,500"));
  assert.ok(v12.includes("KES 178,670 / table"));
  assert.ok(v12.includes("KES 178,670"));
});
test("Legacy shed is its own reference project, not an extra price per drying table",async()=>{
  fakeDom();
  const root=new FakeNode("div");
  const data=payload();
  data.sources.push({id:"shed",display_name:"Existing drying shade and store — priced BQ"});
  data.packages.push({id:"shed1",source_id:"shed",package_key:"legacy-mwazaro-shed-store",
    version:"Existing site · Mwazaro priced BoQ",activity:"Solar Drying Shed & Store",
    basis:"estimated",currency:"KES",units_covered:1,unit_label:"shed project",
    control_total:2641401.2,reconciliation_status:"verified"});
  data.lines.push({package_id:"shed1",source_row:"F692",category:"Building",
    subcategory:"BoQ",description:"Store and shade tender",amount:2641401.2,
    included_in_total:true,reconciliation_status:"verified"});
  const finance=createCosmeFinancesPanel({rpc:async()=>({data,error:null})},root);
  await finance.load();
  const d=root.querySelectorAll("details[data-finance-key]").find(d=>d.dataset.financeKey==="pkg:shed1");
  assert.ok(d);
  const labels=d.children[0].children.map(x=>x.textContent);
  assert.ok(labels.includes("Existing drying shed & store · Mwazaro"));
  assert.ok(labels.includes("KES 2,641,401.20"));
  assert.ok(labels.includes("—"),"Site-level project reference should not be mislabelled per table");
});

test("Source metadata supplies installation dates and project BOM tables omit per-part dates",async()=>{
 fakeDom();const root=new FakeNode("div"),data=payload();
 data.packages[0].report={date:"12 May 2026",date_kind:"Installed",status:"Actual"};
 data.lines[0].reconciliation_status="review";
 await createCosmeFinancesPanel({rpc:async()=>({data})},root).load();
 const nodes=[];const walk=n=>{nodes.push(n);n.children.forEach(walk)};walk(root);
 assert.ok(nodes.some(n=>n.className==="finance-group-date"&&n.textContent==="12 May 2026"));
 assert.ok(nodes.some(n=>n.className==="finance-date"&&n.title==="12 May 2026 · Installed"));
 assert.ok(nodes.some(n=>n.tag==="td"&&n.textContent==="Steel pipes"),"priced reviewed item belongs in its category");
 assert.equal(nodes.filter(n=>n.tag==="td"&&n.textContent==="Steel pipes").length,1);
 assert.equal(nodes.filter(n=>n.tag==="th"&&n.textContent==="Date").length,0);
 assert.ok(root.className.includes("metrics-panel"));
 assert.ok(nodes.some(n=>n.className.includes("metrics-toolbar")));
 assert.doesNotMatch(page,/data-tab="current"/);
});

 test("Component breakdown preserves payments and avoids duplicate ledger costs",async()=>{
  fakeDom();const root=new FakeNode("div"),data=payload();
  data.packages[0].report={itemisation:{items:[{description:"Synthetic component A",quantity:2,unit:"units",amount:1000000,source_row:"Quote 1",source_url:"https://example.com/source"},{description:"Synthetic component B",amount:1471500,source_row:"Quote 2"}]}};
  await createCosmeFinancesPanel({rpc:async()=>({data})},root).load();
  const nodes=[];const walk=n=>{nodes.push(n);n.children.forEach(walk)};walk(root);
  assert.ok(nodes.some(n=>n.tag==="td"&&n.textContent==="Synthetic component A"));
  assert.ok(nodes.some(n=>n.tag==="td"&&n.textContent==="Steel pipes"),"original payment evidence retained");
  assert.ok(nodes.some(n=>n.tag==="details"&&n.dataset.financeKey==="payments:p1"&&!n.open));
  assert.ok(nodes.some(n=>n.tag==="a"&&n.href==="https://example.com/source"));
 });
