import test from "node:test";
import assert from "node:assert/strict";
import {createMetricsTimeline} from "../assets/js/cosme_metrics_timeline.mjs";

// Minimal accessible DOM harness: verifies behavior without launching a browser.
class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.handlers = {};
    this.className = "";
    this.value = "";
    this.attributes = {};
    this._text = "";
  }
  get textContent() {return this._text + this.children.map(child => child.textContent).join(" ");}
  set textContent(value) {this._text = String(value); this.children = [];}
  get firstChild() {return this.children[0];}
  append(...children) {this.children.push(...children);}
  replaceChildren(...children) {this.children = children; this._text = "";}
  addEventListener(event, callback) {this.handlers[event] = callback;}
  setAttribute(key, value) {this.attributes[key] = value;}
  fire(event) {
    assert.ok(this.handlers[event], this.tag + " should handle " + event);
    this.handlers[event]();
  }
}
const walk = node => [node, ...node.children.flatMap(walk)];
const query = (node, selector) => walk(node).filter(selector);
const fixture = [
  {start_date:"2025-10-15",end_date:null,type:"Pilot",activity:"Solar Drying Tables",
    title:"Shangani pilot launch",summary:"Source-verified launch",source_label:"Cascadia Invoice #9",
    source_url:"http://insecure.example",metrics:[{id:"SDT-0044",title:"Shangani prototype"}]},
  {start_date:"2026-10-19",end_date:"2026-10-21",type:"Training",activity:"Offshore Nursery",
    title:"Tumbe nursery sessions",summary:"Not commissioning",source_label:"Verification report",
    source_url:null,metrics:[{id:"ON-0039",title:"Tumbe nursery status"}]}
];

test("Timeline filters, calendar navigation and metric links work without a parallel data source", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {createElement: tag => new FakeElement(tag)};
  try {
    const root = new FakeElement("root");
    const opened = [];
    const timeline = createMetricsTimeline({
      rpc: async name => {
        assert.equal(name,"cosme_metrics_timeline");
        return {data:{can_view:true,milestones:fixture}};
      }
    },root,(id)=>opened.push(id));
    timeline.setRelease([{id:"SDT-0044"}]);
    await timeline.load();
    assert.equal(query(root,node=>node.className==="metrics-timeline-event").length,2);
    const links = query(root,node=>node.className==="metrics-timeline-metric-link");
    assert.equal(links.length,1); // Unavailable release metric never links.
    links[0].fire("click");
    assert.deepEqual(opened,["SDT-0044"]);
    assert.equal(query(root,node=>node.tag==="a").length,0); // Reject insecure source URL.

    query(root,node=>node.tag==="button" && node.textContent==="Calendar")[0].fire("click");
    assert.match(root.textContent,/October 2026/);
    const yearControl = query(root,node=>node.tag==="label" && node.textContent.includes("Year"))[0];
    const yearSelect = query(yearControl,node=>node.tag==="select")[0];
    yearSelect.value = "2025";
    yearSelect.fire("change");
    assert.match(root.textContent,/October 2025/); // Filter jumps to a matching month.
    assert.equal(query(root,node=>node.className==="metrics-timeline-day has-events").length,1);

    timeline.clear();
    assert.equal(root.children.length,0);
  } finally {
    globalThis.document=previousDocument;
  }
});
