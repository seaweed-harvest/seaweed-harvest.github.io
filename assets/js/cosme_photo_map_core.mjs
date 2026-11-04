// Project Photos map positioning. True camera GPS always takes precedence over
// existing site/community centroids sourced from Seaweed Harvest tide records.
import {TIDE_LOCATIONS} from "../../tide/assets/data/locations.js";

const KEYS=["mkwiro","tumbe","bati","funzi","shangani","shangani-amani",
  "wasini","kibuyuni","yungi-mwenjeni","chiromo",
  "daima","furaha","jikaze","jimbo","kijiweni","mtimbwani",
  "siwema","tushirikiane","tunusuru","nuru"];
// Only match a named site in the location or asset field, never a casual
// mention in a caption or a generic project label.
const ALIASES={
  "shangani-amani":["shangani amani"],
  "yungi-mwenjeni":["yungi mwenjeni","yungi","mwenjeni"],
  "amka-utsamba":["amka utsamba","utsamba"]
};
const SITE_KEYS=new Set(KEYS.concat(["amka-utsamba"]));
const SITES=TIDE_LOCATIONS.filter(s=>SITE_KEYS.has(s.key)&&s.gps&&
  Number.isFinite(s.gps.lat)&&Number.isFinite(s.gps.lon)).map(s=>({
    name:s.shortName||s.name,key:s.key,lat:s.gps.lat,lng:s.gps.lon,
    aliases:ALIASES[s.key]||[s.key.replaceAll("-"," ")]
  }));
const valid=(lat,lng)=>Number.isFinite(lat)&&Number.isFinite(lng)&&
  lat>=-90&&lat<=90&&lng>=-180&&lng<=180;
const num=n=>n===null||n===undefined||n===""?NaN:Number(n);
const oneSite=(value)=>{
  const text=String(value||"").toLowerCase().normalize("NFKC");
  if(!text)return null;
  const matches=SITES.flatMap(site=>site.aliases.filter(name=>{
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    return new RegExp("(?:^|[^a-z])"+escaped+"(?:$|[^a-z])","i").test(text);
  }).map(name=>({site,length:name.length})));
  if(!matches.length)return null;
  matches.sort((a,b)=>b.length-a.length);
  // Distinct simultaneous site names are ambiguous; a longer named subtype
  // (e.g. Shangani Amani) legitimately wins over its shorter parent label.
  if(matches.some(m=>m.site.key!==matches[0].site.key&&
    !matches[0].site.key.startsWith(m.site.key+"-")&&
    !m.site.key.startsWith(matches[0].site.key+"-")))return null;
  return matches[0].site;
};
export function photoPosition(item){
  const gps=item?.photo_metadata?.gps;
  const lat=num(gps?.latitude??gps?.lat);
  const lng=num(gps?.longitude??gps?.lng??gps?.lon);
  if(valid(lat,lng))return {lat,lng,source:"gps",label:"Photo GPS"};
  const explicit=String(item?.location||"").match(/^\s*GPS:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/i);
  if(explicit){
    const a=Number(explicit[1]),b=Number(explicit[2]);
    if(valid(a,b))return {lat:a,lng:b,source:"gps",label:"Photo GPS"};
  }
  const site=oneSite(item?.location)||oneSite(item?.asset);
  if(site)return {lat:site.lat,lng:site.lng,source:"site",label:site.name+" · site area",siteKey:site.key};
  return null;
}
export function photosWithPositions(items){
  const located=[],unmapped=[];
  for(const item of items){
    const position=photoPosition(item);
    if(position)located.push({item,...position});
    else unmapped.push(item);
  }
  return {located,unmapped};
}
// Screen-space clustering splits naturally with zoom. Uses the projected pixel
// locations supplied by Leaflet, without moving any photo's true coordinates.
export function clusterPhotoPositions(located,project,radius=86){
  const cell=Math.max(24,radius);
  const buckets=new Map(),points=[];
  for(const p of located){
    const pt=project(p);
    if(!Number.isFinite(pt?.x)||!Number.isFinite(pt?.y))continue;
    const i=points.length;
    points.push({...p,x:pt.x,y:pt.y});
    const gx=Math.floor(pt.x/cell),gy=Math.floor(pt.y/cell);
    const key=gx+","+gy;
    if(!buckets.has(key))buckets.set(key,[]);
    buckets.get(key).push(i);
  }
  const parent=points.map((_,i)=>i);
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i};
  const unite=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a};
  for(let i=0;i<points.length;i++){
    const p=points[i],gx=Math.floor(p.x/cell),gy=Math.floor(p.y/cell);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
      for(const j of buckets.get((gx+dx)+","+(gy+dy))||[]){
        if(j>=i)continue;
        const q=points[j];
        if((p.x-q.x)**2+(p.y-q.y)**2<=cell**2)unite(i,j);
      }
    }
  }
  const groups=new Map();
  for(let i=0;i<points.length;i++){
    const id=find(i);
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push(points[i]);
  }
  return [...groups.values()].map(group=>({
    photos:group,
    lat:group.reduce((a,p)=>a+p.lat,0)/group.length,
    lng:group.reduce((a,p)=>a+p.lng,0)/group.length,
    source:group.every(p=>p.source==="gps")?"gps":group.every(p=>p.source==="site")?"site":"mixed",
    label:group.length===1?group[0].label:group[0].source==="site"?
      group[0].label:"Photo group"
  }));
}
