import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {photoPosition,photosWithPositions,clusterPhotoPositions} from "../assets/js/cosme_photo_map_core.mjs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");

test("camera GPS is exact and overrides the Mkwiro site fallback",()=>{
  const location=photoPosition({
    location:"Mkwiro, Kenya",
    photo_metadata:{gps:{latitude:-4.675681,longitude:39.396539}}
  });
  assert.deepEqual({lat:location.lat,lng:location.lng,source:location.source},
    {lat:-4.675681,lng:39.396539,source:"gps"});
});
test("site anchors come from existing tide site records",()=>{
  const mkwiro=photoPosition({location:"Mkwiro, Kwale County, Kenya"});
  const tumbe=photoPosition({location:"Tumbe, Kenya"});
  assert.equal(mkwiro.siteKey,"mkwiro");
  assert.equal(tumbe.siteKey,"tumbe");
  assert.equal(mkwiro.source,"site");
  assert.ok(mkwiro.lat!==tumbe.lat);
});
test("missing or ambiguous site and invalid GPS are not guessed",()=>{
  assert.equal(photoPosition({location:"Shimoni, Kenya"}),null);
  assert.equal(photoPosition({location:"Mkwiro and Tumbe"}),null);
  assert.equal(photoPosition({location:"Unknown",photo_metadata:{gps:{latitude:200,longitude:500}}}),null);
  const result=photosWithPositions([{location:"Mkwiro"},{location:"Unknown"}]);
  assert.equal(result.located.length,1);
  assert.equal(result.unmapped.length,1);
});
test("zoom clusters split without shifting photo coordinates",()=>{
  const points=[
    {item:{id:"a"},source:"gps",lat:-4.6756,lng:39.3965},
    {item:{id:"b"},source:"gps",lat:-4.6758,lng:39.3963},
    {item:{id:"c"},source:"site",lat:-4.463,lng:39.502}
  ];
  const broad=clusterPhotoPositions(points,p=>({x:p.lng*100,y:p.lat*100}),90);
  const close=clusterPhotoPositions(points,p=>({x:p.lng*50000,y:p.lat*50000}),90);
  assert.equal(broad.length,1);
  assert.equal(close.length,2);
  assert.equal(close.reduce((sum,g)=>sum+g.photos.length,0),3);
  assert.equal(close.find(g=>g.photos.some(p=>p.item.id==="c")).source,"site");
});
test("map uses existing Leaflet assets, protected links and the shared gallery filters",()=>{
  const map=read("../assets/js/cosme_photo_map.mjs");
  const gallery=read("../assets/js/cosme_project_library.mjs");
  const css=read("../assets/css/cosme_photo_map.css");
  assert.match(map,/leaflet\.js/);
  assert.match(map,/createSignedUrl\(item\.object_path/);
  assert.match(map,/clusterPhotoPositions/);
  assert.match(map,/map\.flyTo/);
  assert.match(map,/onOpen\(representative\)/);
  assert.doesNotMatch(map,/innerHTML|getPublicUrl|navigator\.geolocation/);
  assert.match(gallery,/\["map","Map"\]/);
  assert.match(gallery,/photos:visible/);
  assert.match(gallery,/!mapMode&&visible\.length>pageSize/);
  assert.match(css,/library-map-pin-count/);
  assert.match(css,/library-map-sheet/);
});
