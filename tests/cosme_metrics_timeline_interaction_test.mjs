import test from "node:test";
import assert from "node:assert/strict";
import {createMetricsTimeline} from "../assets/js/cosme_metrics_timeline.mjs";

class Element {
  constructor(tag){this.tag=tag;this.className="";this.children=[];this.handlers={};this.attributes={};this.parent=null;this.value="";this._text="";}
  set textContent(s){this._text=String(s);this.children=[];}
  get textContent(){return this._text+this.children.map(x=>x.textContent).join(" ");}
  get firstChild(){return this.children[0];}
  append(...nodes){nodes.forEach(x=>{x.parent=this;this.children.push(x);});}
  replaceChildren(...nodes){this.children=[];this._text="";this.append(...nodes);}
  addEventListener(type,fn){this.handlers[type]=fn;}
  setAttribute(key,value){this.attributes[key]=value;}
  focus(){this.focused=true;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);this.parent=null;}
  fire(type){assert.ok(this.handlers[type],"Missing "+type+" listener on "+this.tag);this.handlers[type]();}
}
const descend=node=>[node,...node.children.flatMap(descend)];
const find=(root,predicate)=>descend(root).filter(predicate);
const sample=[
  {start_date:"2025-05-19",end_date:null,type:"Planning",activity:"Programme",title:"COSME engineering work commenced",summary:"First logged entry",source_label:"Cascadia work log",source_url:"http://insecure.invalid",metrics:[]},
  {start_date:"2025-10-15",end_date:null,type:"Pilot",activity:"Solar Drying Tables",title:"Shangani drying-table pilot launched",summary:"Piloted",source_label:"Cascadia invoice",source_url:null,metrics:[{id:"SDT-0044",title:"Shangani prototype"}]},
  {start_date:"2026-10-19",end_date:"2026-10-21",type:"Training",activity:"Offshore Nursery",title:"Tumbe nursery practical sessions documented",summary:"Not commissioned",source_label:"Field report",source_url:null,metrics:[{id:"ON-0039",title:"Tumbe status"}]},
  {start_date:"2026-10-20",end_date:null,type:"Travel",activity:"Programme",title:"October Kenya visit commenced",summary:"In-country work",source_label:"Time log",source_url:null,metrics:[]}
];
test("compact rows open a right-hand detail drawer, metric links are release-gated",async()=>{
  const old=globalThis.document;
  const handlers={};
  globalThis.document={createElement:tag=>new Element(tag),addEventListener:(k,fn)=>handlers[k]=fn,removeEventListener:k=>delete handlers[k]};
  try{
    const root=new Element("main"),opened=[];
    const timeline=createMetricsTimeline({rpc:async name=>{assert.equal(name,"cosme_metrics_timeline");return {data:{can_view:true,milestones:sample}}}},root,id=>opened.push(id));
    timeline.setRelease([{id:"SDT-0044"}]);
    await timeline.load();
    const rows=find(root,n=>n.className==="metrics-timeline-row");
    assert.equal(rows.length,4);
    assert.ok(rows.every(n=>n.children.length===3));
    assert.match(rows[0].textContent,/May 2025/);
    rows.find(n=>n.textContent.includes("Shangani dryer pilot"))?.fire("click");
    const drawer=find(root,n=>n.attributes.role==="dialog")[0];
    assert.ok(drawer,"click should open detail drawer");
    assert.match(drawer.textContent,/Piloted/);
    const links=find(drawer,n=>n.className==="metrics-timeline-metric-link");
    assert.equal(links.length,1);
    links[0].fire("click");
    assert.deepEqual(opened,["SDT-0044"]);
    assert.equal(find(root,n=>n.attributes.role==="dialog").length,0,"metric opening closes the drawer");
    const programme=rows[0];
    programme.fire("click");
    assert.equal(find(root,n=>n.tag==="a").length,0,"HTTP source should not become a link");
    handlers.keydown?.({key:"Escape"});
    assert.equal(find(root,n=>n.attributes.role==="dialog").length,0);
    timeline.clear();
    assert.equal(root.children.length,0);
  }finally{globalThis.document=old;}
});
test("calendar defaults to three months and can show one or twelve with activity markers",async()=>{
  const old=globalThis.document;globalThis.document={createElement:tag=>new Element(tag),addEventListener(){},removeEventListener(){}};
  try{
    const root=new Element("main");
    const timeline=createMetricsTimeline({rpc:async()=>({data:{can_view:true,milestones:sample}})},root,()=>{});
    timeline.setRelease([{id:"SDT-0044"},{id:"ON-0039"}]);
    await timeline.load();
    find(root,n=>n.tag==="button"&&n.textContent==="Calendar")[0].fire("click");
    assert.equal(find(root,n=>n.className==="metrics-timeline-month").length,3);
    assert.match(root.textContent,/Oct 2026/);
    assert.match(root.textContent,/🌊/);
    assert.match(root.textContent,/✈️/);
    assert.equal(find(root,n=>n.className.includes("metrics-timeline-day has-events")).length,3);
    find(root,n=>n.tag==="button"&&n.textContent==="1 month")[0].fire("click");
    assert.equal(find(root,n=>n.className==="metrics-timeline-month").length,1);
    find(root,n=>n.tag==="button"&&n.textContent==="12 months")[0].fire("click");
    assert.equal(find(root,n=>n.className==="metrics-timeline-month").length,12);
    assert.match(root.textContent,/January 2026/);
    const yearControl=find(root,n=>n.tag==="label"&&n.textContent.includes("Year"))[0];
    const choice=find(yearControl,n=>n.tag==="select")[0];
    choice.value="2025";choice.fire("change");
    assert.match(root.textContent,/January 2025/);
  }finally{globalThis.document=old;}
});
