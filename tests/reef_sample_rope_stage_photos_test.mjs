import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";

const script=fs.readFileSync("assets/js/reef_sample_rope_stage_photos.js","utf8");
const entry=fs.readFileSync("assets/js/reef_nursery_site_capture.js","utf8");
const records=fs.readFileSync("assets/js/reef_seaweed_records_page.js","utf8");
const migrated=fs.readFileSync("supabase/migrations/20261015160000_reef_sample_rope_stage_photos.sql","utf8");
const stageLabels=["initial","week_2","week_4","week_6"];
const panels=Object.fromEntries(stageLabels.map(stage=>[stage,{innerHTML:""}]));
const listeners={};
const root={
 querySelector(selector){
   const match=selector.match(/data-stage-photo-list="([^"]+)"/);
   return panels[match?.[1]] || null;
 },
 addEventListener(type,handler){listeners[type]=handler;}
};
const calls=[];
let failUpload=false;
const authClient={
 rpc:async (name,args)=>{
   calls.push([name,args]);
   if(name==="ag_reef_sample_rope_stage_photo_reserve")
     return {data:{photo_id:randomUUID(),storage_path:`sample-ropes/${randomUUID()}/photo.jpg`},error:null};
   if(name==="ag_reef_sample_rope_stage_photo_finalize")return {data:{status:"ready"},error:null};
   return {data:null,error:Error("Unexpected photo RPC "+name)};
 },
 storage:{from:bucket=>{
   assert.equal(bucket,"reef-seaweed-record-photos");
   return {upload:async(path,blob,opts)=>{
      calls.push(["storage.upload",{path,blob,opts}]);
      return {error:failUpload?Error("Network interrupted"):null};
   }};
 }}
};
const context={crypto:{randomUUID},Number,String,Array,Map,Set,Object};
vm.createContext(context);
vm.runInContext(script.replace(/^export /gm,""),context);
const controller=context.createSampleStagePhotoController({
 authClient,root,
 preparePhoto:async file=>({size:47000,type:"image/jpeg",name:file.name}),
 onChange:(count,error)=>calls.push(["onChange",{count,error}])
});
const image=name=>({name,type:"image/jpeg",size:345000});
controller.queueFiles("initial",[image("initial.jpg")]);
controller.queueFiles("week_2",[image("wk2-a.jpg"),image("wk2-b.jpg")]);
assert.equal(controller.count(),3);
assert.match(panels.initial.innerHTML,/initial.jpg/);
assert.match(panels.week_2.innerHTML,/wk2-a.jpg/);
assert.match(entry,/stagePhotoFooterMarkup\("initial"/, "Form includes initial photo button");
assert.match(entry,/stagePhotoFooterMarkup\("week_2"/);
assert.match(entry,/stagePhotoFooterMarkup\("week_4"/);
assert.match(entry,/stagePhotoFooterMarkup\("week_6"/);
assert.match(entry,/state.stagePhotos.upload\(\{siteCode:targetSite,dates:uploadDates\}\)/);
assert.match(records,/selected.length === 1 && item.kind === "sample_rope_register"/);
assert.match(records,/ag_reef_sample_rope_stage_photos/);
assert.match(records,/createSignedUrl/);
assert.match(records,/Photo/);
assert.match(migrated,/photo_read|photo read|stage photo read/);
assert.match(migrated,/measurement_stage/);
assert.match(migrated,/status = 'ready'/);
assert.match(migrated,/v_photo.status = 'pending'/);

await assert.rejects(controller.upload({siteCode:"MK-R2",dates:{initial:"2026-09-29"}}),/week 2 date/i);
assert.equal(calls.filter(x=>x[0]==="ag_reef_sample_rope_stage_photo_reserve").length,0,"Must validate all dates before first upload");
failUpload=true;
await assert.rejects(controller.upload({siteCode:"MK-R2",dates:{initial:"2026-09-29",week_2:"2026-10-13"}}),/Network interrupted/);
assert.equal(controller.count(),3,"Queued files retained on upload error for retry");
failUpload=false;
const saved=await controller.upload({siteCode:"MK-R2",dates:{initial:"2026-09-29",week_2:"2026-10-13"}});
assert.equal(saved,3);
assert.equal(controller.count(),0,"All successfully uploaded photos cleared from queue");
const reservations=calls.filter(([name])=>name==="ag_reef_sample_rope_stage_photo_reserve");
assert.deepEqual(reservations.map(x=>x[1].p_stage).slice(-3),["initial","week_2","week_2"]);
assert.deepEqual(reservations.map(x=>x[1].p_capture_date).slice(-3),["2026-09-29","2026-10-13","2026-10-13"]);
assert.equal(calls.filter(([name])=>name==="ag_reef_sample_rope_stage_photo_finalize").length,3);
assert.equal(calls.filter(([name])=>name==="storage.upload").length,4);
assert(!panels.week_2.innerHTML.includes("wk2-a.jpg"),"No stale photo queue after upload");

controller.queueFiles("week_4",[image("remove-me.jpg")]);
assert.equal(controller.count(),1);
const stored=controller.pending.get("week_4")[0].id;
listeners.click({target:{
  closest:selector=>selector==="[data-stage-remove]"?{dataset:{stageRemove:"week_4",photoId:stored}}:null
}});
assert.equal(controller.count(),0,"Remove button discards unsaved photo");

console.log("Per-stage photo queue, date validation, private upload and single-record gallery contract passed.");
