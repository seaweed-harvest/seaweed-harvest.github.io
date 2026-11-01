import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {TIMELINE_ACTIVITIES,TIMELINE_TYPES,timelineType} from "../assets/js/cosme_metrics_timeline.mjs";
const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const page=read("../assets/js/cosme_metrics_page.js");
const html=read("../cosme_metrics.html");
const module=read("../assets/js/cosme_metrics_timeline.mjs");
const css=read("../assets/css/cosme_metrics_timeline.css");
const sql=read("../supabase/migrations/20261101123000_cosme_metrics_timeline_extended.sql");

test("Timeline remains in the existing, authenticated COSME Metrics page",()=>{
  assert.match(html,/data-tab="timeline"[^>]*>Timeline<\/button>/);
  assert.match(html,/id="metricsTimeline"/);
  assert.match(page,/cosme_metrics_my_access/);
  assert.match(page,/timelinePanel\.load\(\)/);
  assert.match(page,/timelinePanel\.setRelease\(all\)/);
  assert.match(page,/timelinePanel\.clear\(\)/);
  assert.match(page,/cosme_metrics_live_values\.mjs/);
  assert.match(page,/app_navigation\.js\?v=17/);
});
test("Timeline has five activity families and six consolidated event types",()=>{
  assert.equal(Object.keys(TIMELINE_ACTIVITIES).length,5);
  assert.equal(Object.keys(TIMELINE_TYPES).length,6);
  for(const name of ["Solar Drying Tables","Offshore Nursery","Aggregation Hub","Mawimbi","Programme"]){
    assert.ok(TIMELINE_ACTIVITIES[name].icon);
  }
  assert.equal(timelineType("Meeting"),"Planning & decisions");
  assert.equal(timelineType("Fabrication"),"Design & fabrication");
  assert.equal(timelineType("Installation"),"Installation & deployment");
  assert.equal(timelineType("Monitoring"),"Trials & monitoring");
  assert.equal(timelineType("Report"),"Reports & training");
  assert.equal(timelineType("Travel"),"Travel & fieldwork");
});
test("Compact list, detail drawer, activity calendar, and 1/3/12 month modes",()=>{
  assert.match(module,/metrics-timeline-columns/);
  assert.match(module,/metrics-timeline-row-date/);
  assert.match(module,/metrics-timeline-row-activity/);
  assert.match(module,/metrics-timeline-row-title/);
  assert.match(module,/role","dialog"/);
  assert.match(module,/aria-modal","true"/);
  assert.match(module,/months=3/);
  assert.match(module,/\[1,3,12\]/);
  assert.match(module,/metrics-timeline-date-mark/);
});
test("SQL keeps COSME grant checks, old metric anchors and source-separated travel milestones",()=>{
  assert.match(sql,/create or replace function public\.cosme_metrics_timeline\(\)/i);
  assert.match(sql,/cosme_metrics\.caller_role\(\)/);
  assert.match(sql,/auth\.uid\(\)/);
  assert.match(sql,/from public, anon, authenticated;/);
  assert.match(sql,/grant execute on function public\.cosme_metrics_timeline\(\)\s+to authenticated;/);
  assert.match(sql,/cosme_metrics\.release_items/);
  assert.match(sql,/project\.current_release_id/);
  assert.match(sql,/coalesce\(e\.event_activity,anchor\.frozen_payload/);
  assert.match(sql,/cardinality\(e\.metric_ids\)=0 or anchor\.metric_id is not null/);
  assert.doesNotMatch(sql,/\bcreate table\b|\bdelete from\b|\binsert into\b/i);
  assert.match(sql,/Kenya field deployment — 2025 travel window/);
  assert.match(sql,/not independently verified Kenya border entry and exit dates/);
  assert.match(sql,/2025-05-19/);
  assert.match(sql,/2025-08-13/);
  assert.match(sql,/2026-02-04/);
});
test("Mobile drawer and calendar keep keyboard and responsive safeguards",()=>{
  assert.match(module,/document\.removeEventListener\?\./);
  assert.match(module,/e\.key==="Escape"/);
  assert.match(module,/url\.protocol==="https:"/);
  assert.match(module,/availableMetrics\.has\(v\.id\)/);
  assert.match(css,/\.metrics-timeline-scrim/);
  assert.match(css,/\.metrics-timeline-drawer/);
  assert.match(css,/@media\(max-width:660px\)/);
  assert.match(css,/grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
});
