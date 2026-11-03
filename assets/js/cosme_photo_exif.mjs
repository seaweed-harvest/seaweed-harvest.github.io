// Client-side photo capture metadata. Read before JPEG downsampling strips EXIF.
// All offsets and string lengths are bounded; missing fields are left unknown.
export function readPhotoExif(buffer){
  const bytes=new Uint8Array(buffer), view=new DataView(buffer);
  const out={};
  if(bytes.length<16||bytes[0]!==0xff||bytes[1]!==0xd8)return out;
  let pos=2, tiff=-1;
  while(pos+4<bytes.length){
    if(bytes[pos]!==0xff)break;
    const mark=bytes[pos+1], length=(bytes[pos+2]<<8)|bytes[pos+3];
    if(mark===0xe1&&length>8&&pos+length+2<=bytes.length&&
      String.fromCharCode(...bytes.slice(pos+4,pos+10))==="Exif\0\0"){tiff=pos+10;break}
    if(mark===0xda||mark===0xd9||length<2)break;
    pos+=length+2;
  }
  if(tiff<0||tiff+8>bytes.length)return out;
  const le=bytes[tiff]===0x49&&bytes[tiff+1]===0x49;
  if(!le&&!(bytes[tiff]===0x4d&&bytes[tiff+1]===0x4d))return out;
  const u16=p=>p>=0&&p+2<=bytes.length?view.getUint16(p,le):0;
  const u32=p=>p>=0&&p+4<=bytes.length?view.getUint32(p,le):0;
  if(u16(tiff+2)!==42)return out;
  const size={1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8};
  const entries=offset=>{
    const result=new Map(), at=tiff+offset;if(offset<=0||at+2>bytes.length)return result;
    const n=Math.min(u16(at),80);
    for(let i=0;i<n;i++){
      const e=at+2+i*12;if(e+12>bytes.length)break;
      const tag=u16(e), type=u16(e+2),count=u32(e+4),len=(size[type]||0)*count;
      if(!len||len>4096)continue;
      const p=len<=4?e+8:tiff+u32(e+8);
      if(p<0||p+len>bytes.length)continue;
      result.set(tag,{type,count,p,len});
    }
    return result;
  };
  const str=e=>e?new TextDecoder('ascii').decode(bytes.slice(e.p,e.p+e.len)).replace(/\0/g,'').trim():null;
  const uint=e=>e?(e.type===3?u16(e.p):u32(e.p)):null;
  const rational=(e,i)=>{if(!e||!([5,10].includes(e.type))||i>=e.count)return null;
    const p=e.p+8*i, num=e.type===10?view.getInt32(p,le):u32(p),den=e.type===10?view.getInt32(p+4,le):u32(p+4);
    return den?num/den:null;};
  const root=entries(u32(tiff+4)), exif=entries(uint(root.get(0x8769))),gps=entries(uint(root.get(0x8825)));
  out.make=str(root.get(0x010f))||undefined;
  out.model=str(root.get(0x0110))||undefined;
  out.orientation=uint(root.get(0x0112))||undefined;
  out.datetime_original=str(exif.get(0x9003))||str(root.get(0x0132))||undefined;
  out.offset_original=str(exif.get(0x9011))||undefined;
  out.pixel_width=uint(exif.get(0xa002))||undefined;
  out.pixel_height=uint(exif.get(0xa003))||undefined;
  if(gps.size){
    const coords=(tag,ref)=>{
      const e=gps.get(tag), a=[rational(e,0),rational(e,1),rational(e,2)];
      if(a.some(v=>v===null))return null;
      const n=a[0]+a[1]/60+a[2]/3600;
      const negative=['S','W'].includes(str(gps.get(ref))?.toUpperCase());
      return (negative?-n:n);
    };
    const lat=coords(2,1),lon=coords(4,3);
    if(lat!==null&&lon!==null&&Math.abs(lat)<=90&&Math.abs(lon)<=180)out.gps={latitude:lat,longitude:lon};
    const alt=rational(gps.get(6),0);
    if(alt!==null){out.gps??={};out.gps.altitude_m=alt*(uint(gps.get(5))===1?-1:1)}
    const date=str(gps.get(0x001d)), time=gps.get(7);
    if(date&&time){
      const h=rational(time,0),m=rational(time,1),s=rational(time,2);
      if(h!==null&&m!==null&&s!==null){
        const iso=date.replaceAll(':','-')+'T'+String(Math.floor(h)).padStart(2,'0')+':'+String(Math.floor(m)).padStart(2,'0')+':'+String(Math.floor(s)).padStart(2,'0')+'Z';
        if(Number.isFinite(Date.parse(iso)))out.gps_time_utc=iso;
      }
    }
  }
  return out;
}
export function captureTimestamp(metadata){
  if(metadata.gps_time_utc)return {value:metadata.gps_time_utc,source:"gps_utc"};
  if(metadata.datetime_original&&metadata.offset_original&&/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(metadata.datetime_original)&&/^[+-]\d{2}:\d{2}$/.test(metadata.offset_original)){
    const iso=metadata.datetime_original.replace(/^(\d{4}):(\d{2}):(\d{2}) /,'$1-$2-$3T')+metadata.offset_original;
    if(Number.isFinite(Date.parse(iso)))return {value:new Date(iso).toISOString(),source:"camera_exif"};
  }
  return {value:null,source:metadata.datetime_original?"camera_local_no_timezone":"missing"};
}
export async function prepareLibraryImage(file,{maxEdge=1920,quality=0.80}={}){
  // Collect metadata from the supplied camera file before any recompression.
  const metadata=readPhotoExif(await file.slice(0,Math.min(file.size,1024*1024)).arrayBuffer());
  const mime=file.type||"image/jpeg";
  const supported=["image/jpeg","image/png","image/webp"].includes(mime);
  let bitmap;
  try{bitmap=await createImageBitmap(file)}catch{
    if(supported)return {file,metadata:{...metadata,original_filename:file.name,original_bytes:file.size,original_mime:mime},dimensions:null,optimized:false};
    throw Error("This photo format cannot be opened here. Export as JPEG and retry.");
  }
  const w=bitmap.width,h=bitmap.height;
  const factor=Math.min(1,maxEdge/Math.max(w,h));
  const width=Math.max(1,Math.round(w*factor)),height=Math.max(1,Math.round(h*factor));
  const photoMetadata={...metadata,original_filename:file.name,original_bytes:file.size,
    original_mime:mime,original_width:w,original_height:h};
  // Small images already below the target need no expensive decode/re-encode cycle.
  if(supported&&factor===1&&file.size<=400*1024){
    bitmap.close?.();
    return {file,metadata:{...photoMetadata,stored_width:w,stored_height:h},dimensions:{width:w,height:h},optimized:false};
  }
  const canvas=document.createElement("canvas");
  canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext("2d");
  if(!ctx){bitmap.close?.();throw Error("Image processing is not supported on this device.");}
  ctx.drawImage(bitmap,0,0,width,height);
  bitmap.close?.();
  // Preserve transparency in PNG diagrams/screenshots. JPEG is the default for photographs.
  const targetMime=mime==="image/png"?"image/png":"image/jpeg";
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,targetMime,quality));
  if(!blob?.size)throw Error("Could not optimise photo on this device.");
  const candidate=new File([blob],file.name.replace(/\.[^.]+$/,"")+
    (targetMime==="image/png"?".png":".jpg"),{type:targetMime});
  // Never increase storage for an image already within the resolution target.
  const keepOriginal=supported&&factor===1&&file.size<=candidate.size;
  const result=keepOriginal?file:candidate;
  return {file:result,metadata:{...photoMetadata,
    stored_width:keepOriginal?w:width,stored_height:keepOriginal?h:height},
    dimensions:{width:w,height:h},optimized:result!==file};
}
