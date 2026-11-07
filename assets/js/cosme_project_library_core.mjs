export const LIBRARY_BUCKET="cosme-project-library";
export const PROJECTS=["Whole project","Solar Drying Tables","Offshore Nursery","Aggregation Hub","Mawimbi","Data Loggers","Software","Off-bottom Farming"];
export const MAX_FILE_SIZE=20*1024*1024;
export const EXAMPLES=Object.freeze([
  {id:"example-table",kind:"photos",title:"Solar table V1.2 prototype",project:"Solar Drying Tables",prototype:"V1.2",activity:"Prototype verification",caption:"Example metadata. Add a photo and its actual capture date and location.",example:true},
  {id:"example-hub",kind:"photos",title:"Aggregation hub site overview",project:"Aggregation Hub",activity:"Site commissioning",caption:"Example metadata for a project photo.",example:true},
  {id:"example-meter",kind:"photos",title:"Brix meter deployed for Mawimbi",project:"Mawimbi",asset:"Brix meter",activity:"Asset deployment",caption:"Example metadata. Select the actual instrument identifier when known.",example:true}
]);
const text=v=>String(v??"").trim();
// Prefer the actual photo date. EXIF has no timezone, so parse its local wall
// time consistently; WhatsApp's filename date is an estimate, not proof of capture.
export function photoChronologyTime(item){
  if(item.kind==="reports")return null;
  if(item.captured_at){
    const value=Date.parse(item.captured_at);
    if(Number.isFinite(value))return value;
  }
  const exif=text(item.photo_metadata?.datetime_original);
  const exifDate=exif.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if(exifDate){
    const [,year,month,day,hour,minute,second]=exifDate.map((v,i)=>i?Number(v):v);
    const value=Date.UTC(year,month-1,day,hour,minute,second);
    const checked=new Date(value);
    if(checked.getUTCFullYear()===year&&checked.getUTCMonth()===month-1&&
       checked.getUTCDate()===day&&checked.getUTCHours()===hour)
      return value;
  }
  // The export/received timestamp in a WhatsApp filename is approximate.
  // Still preferable to placing an old photo at the top because it was uploaded today.
  const file=text(item.filename);
  const match=file.match(/^WhatsApp Image (\d{4})-(\d{2})-(\d{2})(?: at (\d{1,2})\.(\d{2})\.(\d{2})\s*(AM|PM))?/i);
  if(match){
    const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
    let hour=12,minute=0,second=0;
    if(match[4]&&match[7]){
      hour=Number(match[4])%12+(match[7].toUpperCase()==="PM"?12:0);
      minute=Number(match[5]);second=Number(match[6]);
    }
    const value=Date.UTC(year,month-1,day,hour,minute,second);
    const checked=new Date(value);
    if(checked.getUTCFullYear()===year&&checked.getUTCMonth()===month-1&&
       checked.getUTCDate()===day&&checked.getUTCHours()===hour)return value;
  }
  return null;
}
export function filterLibrary(items,filters={}){
  const query=text(filters.search).toLowerCase();
  const start=filters.from?new Date(filters.from+"T00:00:00").getTime():null;
  const end=filters.to?new Date(filters.to+"T23:59:59.999").getTime():null;
  const dated=i=>i.kind==="reports"?(i.submitted_on?i.submitted_on+"T12:00:00":null):photoChronologyTime(i);
  const stamp=i=>i.kind==="reports"?Date.parse(dated(i)||""):(dated(i)??null);
  const added=i=>Date.parse(i.created_at||"")||0;
  return items.filter(i=>
    (!filters.folder||i.folder_id===filters.folder)&&
    ["project","prototype","location","activity","asset","report_type"].every(k=>!filters[k]||text(i[k])===filters[k])&&
    (!query||[i.title,i.project,i.report_type,i.prototype,i.location,i.activity,i.asset,i.caption,i.filename].some(v=>text(v).toLowerCase().includes(query)))&&
    (start===null||(stamp(i)!==null&&Number.isFinite(stamp(i))&&stamp(i)>=start))&&
    (end===null||(stamp(i)!==null&&Number.isFinite(stamp(i))&&stamp(i)<=end))
  ).sort((a,b)=>{
    const addedOrder=added(b)-added(a);
    if(filters.sort==="added_desc")return addedOrder||text(a.title).localeCompare(text(b.title));
    const aDate=stamp(a),bDate=stamp(b);
    if(Number.isFinite(aDate)&&Number.isFinite(bDate)&&aDate!==bDate)return bDate-aDate;
    if(Number.isFinite(aDate)!==Number.isFinite(bDate))return Number.isFinite(aDate)?-1:1;
    return addedOrder||text(a.title).localeCompare(text(b.title));
  });
}
export function localDateTime(iso){
  if(!iso)return "";
  const d=new Date(iso);if(!Number.isFinite(d.getTime()))return "";
  const pad=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function libraryMetadata(values,kind){
  const out={};
  for(const k of ["title","project","prototype","location","activity","asset","caption"])out[k]=text(values[k]);
  out.folder_id=values.folder_id||null;
  out.report_type=text(values.report_type)||"Report";
  out.submitted_on=text(values.submitted_on)||null;
  if(out.report_type.length>100)throw new Error("Report type is too long.");
  if(out.submitted_on&&(!/^\d{4}-\d{2}-\d{2}$/.test(out.submitted_on)||!Number.isFinite(Date.parse(out.submitted_on))))throw new Error("Enter a valid submission date.");
  if(kind==="reports"&&!out.submitted_on)throw new Error("Enter the date submitted to the report register.");
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
