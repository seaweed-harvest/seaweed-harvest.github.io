import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {linkedProjectPhotos,draftProjectPhotos,visibleMetricDrafts} from
  "../assets/js/cosme_metric_evidence_review_core.mjs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const photoId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const draftId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const photos=[
  {id:photoId,kind:"photos",status:"ready",object_path:"photos/alpha.jpg",title:"Mawimbi frame"},
  {id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",kind:"photos",status:"pending",
    object_path:"photos/pending.jpg"},
  {id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",kind:"reports",status:"ready",
    object_path:"reports/x.pdf"}
];
const links=[
  {metric_id:"MAW-0003",photo_id:photoId},
  {metric_id:"MAW-0003",photo_id:photoId},
  {draft_id:draftId,photo_id:photoId},
  {metric_id:"MAW-0003",photo_id:photos[1].id},
  {metric_id:"MAW-0003",photo_id:photos[2].id},
  {metric_id:"MAW-0004",photo_id:photoId}
];
test("published metrics only show ready, linked project photos without duplicates",()=>{
  const linked=linkedProjectPhotos("MAW-0003",links,photos);
  assert.deepEqual(linked.map(x=>x.title),["Mawimbi frame"]);
  assert.equal(linkedProjectPhotos("MAW-0004",links,photos).length,1);
  assert.deepEqual(linkedProjectPhotos("COSME\'); DROP TABLE",links,photos),[]);
});
test("draft references never spill across unrelated drafts or metric IDs",()=>{
  assert.deepEqual(draftProjectPhotos(draftId,links,photos).map(x=>x.id),[photoId]);
  assert.deepEqual(draftProjectPhotos("ffffffff-ffff-4fff-8fff-ffffffffffff",links,photos),[]);
});
test("draft review sorts revisions while excluding malformed and missing records",()=>{
  const rows=visibleMetricDrafts([
    {id:draftId,title:"First",activity:"Mawimbi",revision:2,updated_at:"2026-11-01"},
    {id:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",title:"Second",activity:"Mawimbi",revision:1,updated_at:"2026-11-02"},
    {id:"bad",title:"Bad",activity:"Mawimbi",revision:3}
  ]);
  assert.deepEqual(rows.map(x=>x.title),["Second","First"]);
});
test("view remains behind existing Metrics session/role grant and never edits immutable releases",()=>{
  const html=read("../cosme_metrics.html"),page=read("../assets/js/cosme_metrics_page.js");
  const review=read("../assets/js/cosme_metric_evidence_review.mjs");
  assert.match(html,/data-tab="proposals" aria-selected="false" hidden/);
  assert.match(html,/id="metricLinkedPhotos"[^>]* hidden/);
  assert.match(page,/proposalsTab\.hidden=!\["owner","editor"\]\.includes\(grant\.role\)/);
  assert.match(page,/metricEvidenceReview\.clear\(\)/);
  assert.match(page,/metricEvidenceReview\.closeMetric\(\)/);
  assert.match(page,/metricEvidenceReview\.openMetric\(metric\.id\)/);
  assert.match(review,/cosme_mcp_metric_draft_list/);
  assert.match(review,/cosme_mcp_metric_photo_links/);
  assert.match(review,/cosme_library_list/);
  assert.match(review,/\.createSignedUrl\(item\.object_path,60\)/);
  assert.match(review,/Unpublished drafts/);
  assert.doesNotMatch(review,/\.insert\(|\.update\(|\.delete\(|\.upsert\(|getPublicUrl|innerHTML|localStorage|service_role/i);
});
