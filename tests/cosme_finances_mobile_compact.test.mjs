import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createCosmeFinancesPanel} from "../assets/js/cosme_finances_panel.mjs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const html=read("../cosme_metrics.html");
const app=read("../assets/js/cosme_metrics_page.js");
const panel=read("../assets/js/cosme_finances_panel.mjs");
const css=read("../assets/css/cosme_finances.css");

class Node{
  constructor(tag){
    this.tag=tag;this.children=[];this.dataset={};this.attributes={};
    this.listeners={};this.open=false;this.value="";this.textContent="";
    this.className="";this.id="";this.title="";
    this.classList={toggle:(name,on)=>{
      const classes=new Set(this.className.split(/\s+/).filter(Boolean));
      if(on)classes.add(name);else classes.delete(name);
      this.className=[...classes].join(" ");
    }};
  }
  append(...children){this.children.push(...children)}
  replaceChildren(...children){this.children=[...children]}
  setAttribute(k,v){this.attributes[k]=v}
  addEventListener(k,fn){this.listeners[k]=fn}
  querySelectorAll(selector){
    const found=[];
    const traverse=node=>{
      if(selector==='details[data-finance-key]'&&node.tag==="details"&&node.dataset.financeKey)found.push(node);
      for(const child of node.children)traverse(child);
    };
    traverse(this);return found;
  }
}
const walk=(n)=>[n,...n.children.flatMap(walk)];
function fakeDom(){globalThis.document={createElement:tag=>new Node(tag)}}
const quote=(id,activity,key,total,units,basis="estimated")=>({
  id,source_id:"source",activity,package_key:key,version:key,
  basis,currency:"KES",units_covered:units,unit_label:activity==="Offshore Nursery"?"rafts":"tables",
  control_total:total,reconciliation_status:"verified"
});
function payload(){
  return {
    sources:[{id:"source",display_name:"Sample source reference",source_date:"2026-10-25"}],
    packages:[
      quote("solar","Solar Drying Tables","v13-plan-10",2471500,10,"quoted"),
      quote("nursery","Offshore Nursery","nursery-future-4-rafts",1081868.80,4),
      quote("hub","Aggregation Hub","august-2026-consultant-proposal",3831250,1,"quoted")
    ],
    lines:[
      {package_id:"solar",category:"Delivery",subcategory:"Project",description:"Prototype manufacturing",
        amount:2471500,quantity:10,reconciliation_status:"verified",included_in_total:true,source_row:"Sheet A"},
      {package_id:"nursery",category:"Mooring",subcategory:"Materials",description:"Mooring materials",
        amount:312736,quantity:4,reconciliation_status:"verified",included_in_total:true,source_row:"Sheet B"}
    ]
  };
}
test("Finance asset versions and controls are isolated to Finance",()=>{
  assert.match(html,/cosme_finances\.css\?v=5/);
  assert.match(app,/cosme_finances_panel\.mjs\?v=7/);
  assert.match(panel,/aria-controls","cosmeFinanceFilters"/);
  assert.match(panel,/aria-controls","cosmeFinanceActions"/);
  assert.match(panel,/mobileFiltersOpen/);
  assert.match(panel,/mobileActionsOpen/);
  assert.match(css,/@media \(max-width:700px\)/);
  assert.match(css,/\.finance-toolbar \.finance-filters\.is-open \{display:grid\}/);
  assert.match(css,/\.finance-toolbar \.finance-actions\.is-open \{display:grid\}/);
  assert.match(css,/\.finance-mobile-line/);
});
test("Mobile summaries show sourced total, per-unit cost and correct financial status",async()=>{
  fakeDom();const root=new Node("div");const data=payload();
  await createCosmeFinancesPanel({rpc:async()=>({data,error:null})},root).load();
  const nodes=walk(root);
  const show=activity=>{
    const group=nodes.find(n=>n.dataset.financeKey==="group:"+activity);
    assert.ok(group,"Missing "+activity);
    return group.children[0].children.find(n=>n.className==="finance-group-mobile");
  };
  const solar=walk(show("Solar Drying Tables")).map(n=>n.textContent).join(" ");
  const nursery=walk(show("Offshore Nursery")).map(n=>n.textContent).join(" ");
  const hub=walk(show("Aggregation Hub")).map(n=>n.textContent).join(" ");
  assert.match(solar,/KES 2,471,500/);
  assert.match(solar,/KES 247,150 \/ table/);
  assert.match(solar,/Actual \(owner-confirmed\)/);
  assert.doesNotMatch(solar,/\bPaid\b/);
  assert.match(nursery,/KES 1,081,868\.80/);
  assert.match(nursery,/KES 270,467\.20 \/ raft/);
  assert.match(nursery,/Partial estimate/);
  assert.match(hub,/KES 3,831,250/);
  assert.match(hub,/Proposal/);
});
test("Filter and action toggles expose their controls with ARIA state",async()=>{
  fakeDom();const root=new Node("div");const data=payload();
  await createCosmeFinancesPanel({rpc:async()=>({data,error:null})},root).load();
  let nodes=walk(root);
  const toggle=type=>nodes.find(n=>n.className.includes("finance-"+type+"-toggle"));
  for(const type of ["filters","actions"]){
    const b=toggle(type);
    assert.ok(b,type+" button");
    assert.equal(b.attributes["aria-expanded"],"false");
    b.listeners.click();
    assert.equal(b.attributes["aria-expanded"],"true");
    const panelNode=nodes.find(n=>n.id==="cosmeFinance"+(type==="filters"?"Filters":"Actions"));
    assert.ok(panelNode.className.includes("is-open"));
  }
  const expenseButton=nodes.find(n=>n.tag==="button"&&n.textContent==="Expense register");
  expenseButton.listeners.click();
  nodes=walk(root);
  assert.equal(nodes.find(n=>n.className.includes("finance-filters-toggle")).attributes["aria-expanded"],"true");
});
test("Mobile item list preserves evidence and desktop table without duplicating finance amounts",async()=>{
  fakeDom();const root=new Node("div"),data=payload();
  await createCosmeFinancesPanel({rpc:async()=>({data,error:null})},root).load();
  const nodes=walk(root);
  assert.ok(nodes.some(n=>n.className==="finance-line-table"));
  assert.ok(nodes.some(n=>n.className==="finance-mobile-lines"));
  assert.ok(nodes.some(n=>n.className==="finance-mobile-item-name"&&n.textContent==="Mooring materials"));
  assert.ok(nodes.some(n=>n.className==="finance-mobile-item-cost"&&n.textContent==="KES 312,736"));
  assert.ok(!nodes.some(n=>n.className==="finance-mobile-item-cost"&&n.textContent==="KES 0"));
  assert.doesNotMatch(panel,/authClient\.rpc\("cosme_finance_write"\)|\.update\(|\.delete\(/);
});
