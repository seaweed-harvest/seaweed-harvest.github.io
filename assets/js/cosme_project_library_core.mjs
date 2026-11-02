export const LIBRARY_BUCKET="cosme-project-library";
export const PROJECTS=["Whole project","Solar Drying Tables","Offshore Nursery","Aggregation Hub","Mawimbi","Data Loggers","Software","Off-bottom Farming"];
export const MAX_FILE_SIZE=20*1024*1024;
export const EXAMPLES=Object.freeze([
  {id:"example-report",kind:"reports",title:"Solar table V1.2 closeout report",project:"Solar Drying Tables",prototype:"V1.2",activity:"Prototype verification",caption:"Example reference. Attach your final PDF in a Closeout reports folder.",example:true},
  {id:"example-table",kind:"photos",title:"Solar table V1.2 prototype",project:"Solar Drying Tables",prototype:"V1.2",activity:"Prototype verification",caption:"Example metadata. Add a photo and its actual capture date and location.",example:true},
  {id:"example-hub",kind:"photos",title:"Aggregation hub site overview",project:"Aggregation Hub",activity:"Site commissioning",caption:"Example metadata for a project photo.",example:true},
  {id:"example-meter",kind:"photos",title:"Brix meter deployed for Mawimbi",project:"Mawimbi",asset:"Brix meter",activity:"Asset deployment",caption:"Example metadata. Select the actual instrument identifier when known.",example:true}
]);
const text=v=>String(v??"").trim();
export function filterLibrary(items,filters={}){
  const query=text(filters.search).toLowerCase();
  const start=filters.from?new Date(filters.from+"T00:00:00").getTime():null;
  const end=filters.to?new Date(filters.to+"T23:59:59.999").getTime():null;
  return items.filter(i=>
    (!filters.folder||i.folder_id===filters.folder)&&
    ["project","prototype","location","activity","asset"].every(k=>!filters[k]||text(i[k])===filters[k])&&
    (!query||[i.title,i.project,i.prototype,i.location,i.activity,i.asset,i.caption,i.filename].some(v=>text(v).toLowerCase().includes(query)))&&
    (start===null||(i.captured_at&&new Date(i.captured_at).getTime()>=start))&&
    (end===null||(i.captured_at&&new Date(i.captured_at).getTime()<=end))
  ).sort((a,b)=>String(b.captured_at||b.created_at||"").localeCompare(String(a.captured_at||a.created_at||""))||text(a.title).localeCompare(text(b.title)));
}
export function localDateTime(iso){
  if(!iso)return "";
  const d=new Date(iso);if(!Number.isFinite(d.getTime()))return "";
  const pad=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function libraryMetadata(values){
  const out={};
  for(const k of ["title","project","prototype","location","activity","asset","caption"])out[k]=text(values[k]);
  out.folder_id=values.folder_id||null;
  if(!out.title||out.title.length>180)throw new Error("Enter a title of up to 180 characters.");
  if(!out.project||out.project.length>120)throw new Error("Choose a project.");
  if(out.prototype.length>100||[out.location,out.activity,out.asset].some(v=>v.length>180)||out.caption.length>1000)throw new Error("One of the reference fields is too long.");
  const d=values.captured_at?new Date(values.captured_at):null;
  if(d&&!Number.isFinite(d.getTime()))throw new Error("Enter a valid date and time.");
  out.captured_at=d?d.toISOString():null;
  return out;
}
export async function validateLibraryFile(kind,file){
  if(!file||file.size<1)throw new Error("Choose a non-empty file.");
  if(file.size>MAX_FILE_SIZE)throw new Error("Choose a file smaller than 20 MB.");
  const b=new Uint8Array(await file.slice(0,12).arrayBuffer());
  const starts=seq=>seq.every((n,i)=>b[i]===n);
  let type="";
  if(starts([37,80,68,70,45]))type="application/pdf";
  else if(starts([255,216,255]))type="image/jpeg";
  else if(starts([137,80,78,71,13,10,26,10]))type="image/png";
  else if(starts([82,73,70,70])&&[87,69,66,80].every((n,i)=>b[i+8]===n))type="image/webp";
  if(kind==="reports"?type!=="application/pdf":!["image/jpeg","image/png","image/webp"].includes(type))
    throw new Error(kind==="reports"?"Reports must be PDF files.":"Photos must be JPG, PNG or WebP files.");
  return {filename:file.name,mime_type:type,byte_size:file.size};
}
