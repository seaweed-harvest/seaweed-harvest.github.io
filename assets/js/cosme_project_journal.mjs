// Project Journal — project-level field notes linked to existing COSME photographs.
import {createPhotoViewer,createPhotoImageCache} from "./cosme_photo_viewer.mjs?v=3";
// All data is loaded and saved through user-authenticated RPCs.
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const BUCKET = "cosme-project-library";
const DRAFT_KEY = "seaweed-ag:journal-entry-draft-v1";
const make = (tag,cls="",value="") => {
  const e=document.createElement(tag);
  if(cls)e.className=cls;
  if(value!==undefined)e.textContent=String(value??"");
  return e;
};
const add=(parent,tag,cls="",value="")=>{const e=make(tag,cls,value);parent.append(e);return e;};
const localToday=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");};
const dateText=value=>{const s=String(value||"");return /^\d{4}-\d{2}-\d{2}$/.test(s)?
 new Date(s+"T12:00:00").toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"numeric"}):s;};
const check=reply=>{if(reply.error)throw reply.error;return reply.data;};

export function createProjectJournal(client,root,{onSaved=()=>{},onPhotos=()=>{}}={}){
 let entries=[],total=0,ready=false,query="",activeId=null,detail=null,editing=false;
 let busy=false,error="",message="",photoLookup=null,photoLoad=null,photoBatch="",selected=new Set(),lastUser=null;
 let savedDraft=null,seq=0,activePhotoViewer=null;
 const photoCache=createPhotoImageCache(client,BUCKET);
 function status(value="",problem=false){message=problem?"":value;error=problem?value:"";renderStatus();}
 function renderStatus(){
   const target=root.querySelector(".journal-status");
   if(target){target.textContent=error||message;target.hidden=!(error||message);target.setAttribute("role",error?"alert":"status");}
 }
 function draftKey(){return lastUser?DRAFT_KEY+":"+lastUser:null;}
 function draftData(){
   if(!draftKey())return null;
   try{const d=JSON.parse(localStorage.getItem(draftKey())||"null");
     return d&&typeof d==="object"?d:null;}
   catch{return null;}
 }
 function setDraft(data){
   savedDraft=data;
   if(!draftKey())return;
   try{if(data)localStorage.setItem(draftKey(),JSON.stringify(data));
     else localStorage.removeItem(draftKey());}catch{}
 }
 const button=(parent,title,action,cls="")=>{
   const e=add(parent,"button",cls,title);e.type="button";e.addEventListener("click",action);return e;
 };
 async function photos(){
   if(photoLookup)return photoLookup;
   if(photoLoad)return photoLoad;
   photoLoad=(async()=>{
     const data=check(await client.rpc("cosme_library_list",{p_kind:"photos"}));
     photoLookup=new Map((data.items||[]).filter(x=>x.kind==="photos"&&x.status==="ready").map(x=>[x.id,x]));
     return photoLookup;
   })();
   try{return await photoLoad;}finally{photoLoad=null;}
 }
 function notifySaved(){try{onSaved();}catch{}}
 async function downloadPhoto(item){
   try{
     const {data,error}=await client.storage.from(BUCKET).createSignedUrl(
       item.object_path,60,{download:true});
     if(error||!data?.signedUrl)throw error||Error("Photo unavailable");
     const a=document.createElement("a");
     a.href=data.signedUrl;a.download=item.filename||item.title||"photo";
     document.body.append(a);a.click();a.remove();
   }catch(err){status("Photo download failed: "+(err.message||""),true);}
 }
 function openLinkedPhoto(item,sequence){
   if(activePhotoViewer?.viewer?.open)return;
   const host=document.createElement("div");
   // Uses the existing library dialog styles without switching page or tab.
   host.className="project-library journal-photo-modal-host";
   document.body.append(host);
   try{
     const instance=createPhotoViewer({
       client,root:host,bucket:BUCKET,photo:item,photos:sequence,
       canEdit:false,imageCache:photoCache,onDownload:downloadPhoto
     });
     activePhotoViewer=instance;
     instance.viewer.addEventListener("close",()=>{
       host.remove();
       if(activePhotoViewer===instance)activePhotoViewer=null;
     },{once:true});
   }catch(err){
     host.remove();activePhotoViewer=null;
     status("Unable to open photo: "+(err.message||""),true);
   }
 }
 async function load({openId=null}={}){
   const ticket=++seq;
   status("");busy=true;render();
   try{
     const list=check(await client.rpc("ag_project_journal_list",{p_organisation_code:"COSME",
       p_search:query||null,p_limit:100,p_offset:0}));
     if(ticket!==seq)return;
     entries=Array.isArray(list.items)?list.items:[];total=Number(list.total||0);
     ready=true;busy=false;
     if(openId&&UUID.test(openId))await open(openId);
     else render();
   }catch(e){if(ticket!==seq)return;busy=false;ready=true;status(e.message||"Journal unavailable",true);render();}
 }
 async function open(id){
   if(!UUID.test(id))return;
   activeId=id;editing=false;busy=true;render();
   try{
     detail=check(await client.rpc("ag_project_journal_get",{p_id:id}));
     if(detail?.organisation_code!=="COSME")throw Error("Journal entry unavailable");
     busy=false;render();
     const u=new URL(location.href);u.searchParams.set("tab","journal");u.searchParams.set("entry",id);
     history.replaceState(null,"",u);
   }catch(e){busy=false;detail=null;status(e.message||"Cannot load entry",true);render();}
 }
 async function fromPhoto(id){
   if(!UUID.test(id))return;
   try{
     const data=check(await client.rpc("ag_project_journal_for_photo",{p_photo_id:id}));
     if(Array.isArray(data)&&data.length)await open(data[0].id);
     else {activeId=null;detail=null;status("No project journal is linked to this photo.",true);render();}
   }catch(e){status(e.message||"Photo journal unavailable",true);}
 }
 function closeDetail(){
   activeId=null;detail=null;editing=false;render();
   const u=new URL(location.href);u.searchParams.delete("entry");u.searchParams.delete("photo");
   history.replaceState(null,"",u);
 }
 function makeHeading(){
   const top=add(root,"div","journal-heading");
   const left=add(top,"div");add(left,"h3","","Project journal");
   add(left,"p","journal-muted","Field visits, project notes, photos and locations.");
   const controls=add(top,"div","journal-heading-actions");
   button(controls,"New entry",()=>beginEdit(null),"metrics-button journal-primary");
   button(controls,"Refresh",()=>load({openId:activeId}),"metrics-button");
 }
 function renderList(){
   const search=add(root,"label","journal-search");
   add(search,"span","","Search journal");
   const input=add(search,"input");input.type="search";input.value=query;
   input.placeholder="Find a visit, place or observation";
   input.addEventListener("change",()=>{query=input.value.trim();load();});
   const list=add(root,"div","journal-entry-list");
   if(!entries.length){
     add(list,"p","journal-muted",query?"No matching entries.":"No journal entries yet.");
     return;
   }
   for(const item of entries){
     const row=button(list,"",()=>open(item.id),"journal-entry");
     const line=add(row,"span","journal-entry-head");
     add(line,"strong","",item.title);
     add(line,"span","journal-date",dateText(item.event_date));
     add(row,"span","journal-entry-context",[
       item.location_label,item.activity,item.photo_count?item.photo_count+" photos":""].filter(Boolean).join(" · "));
   }
   if(total>entries.length)add(root,"p","journal-muted",`Showing ${entries.length} of ${total} entries. Refine search for older records.`);
 }
 async function paintPhoto(img,item){
   try{
     const {data,error}=await client.storage.from(BUCKET).createSignedUrl(
       item.object_path,120,{transform:{width:400,height:320,resize:"cover",quality:75}});
     if(error)throw error;
     if(img.isConnected)img.src=data.signedUrl;
   }catch{}
 }
 function renderDetail(){
   const d=detail;
   if(!d)return;
   const wrap=add(root,"section","journal-detail");
   const head=add(wrap,"div","journal-detail-head");
   button(head,"← All entries",closeDetail,"metrics-button");
   button(head,"Edit entry",()=>beginEdit(d),"metrics-button");
   add(wrap,"h3","journal-title",d.title);
   const tags=add(wrap,"p","journal-detail-meta");
   tags.textContent=[dateText(d.event_date),d.entry_type,d.activity,d.location_label].filter(Boolean).join(" · ");
   const notes=add(wrap,"div","journal-notes",d.notes||"No notes recorded.");
   notes.style.whiteSpace="pre-wrap";
   if(d.latitude!=null&&d.longitude!=null){
     const loc=add(wrap,"p","journal-location");
     const a=add(loc,"a","","View location on map");
     a.href="https://www.google.com/maps?q="+encodeURIComponent(String(d.latitude)+","+String(d.longitude));
     a.target="_blank";a.rel="noopener noreferrer";
     add(loc,"span","journal-muted"," · GPS from "+(d.location_source==="photo_exif"?"photo metadata":d.location_source));
   }
   if(d.source_url&&/^https:\/\//.test(d.source_url)){
     const a=add(wrap,"a","journal-source-link","Source notes");
     a.href=d.source_url;a.target="_blank";a.rel="noopener noreferrer";
   }
   const photosHead=add(wrap,"div","journal-photo-heading");
   add(photosHead,"h4","","Linked photos · "+(Array.isArray(d.photo_ids)?d.photo_ids.length:0));
   button(photosHead,"Open photo library",onPhotos,"metrics-button");
   const gallery=add(wrap,"div","journal-photo-grid");
   const ids=Array.isArray(d.photo_ids)?d.photo_ids:[];
   if(!ids.length){add(gallery,"p","journal-muted","No photos linked yet.");return;}
   add(gallery,"p","journal-muted","Loading photos…");
   photos().then(map=>{
     if(!gallery.isConnected)return;
     gallery.replaceChildren();
     const linked=ids.map(id=>map.get(id)).filter(Boolean);
     for(const p of linked){
       const card=button(gallery,"",()=>openLinkedPhoto(p,linked),"journal-photo-card journal-photo-trigger");
       card.setAttribute("aria-label","View photo: "+(p.title||p.filename||"Project photo"));
       const preview=add(card,"span","journal-photo-open");
       const image=add(preview,"img");image.alt="";image.loading="lazy";
       paintPhoto(image,p);
       // Captions stay accessible in the full photo viewer, not the thumbnail tiles.
       add(card,"span","journal-photo-title",p.title||p.filename||"Project photo");
     }
     if(!gallery.children.length)add(gallery,"p","journal-muted","Photo references are unavailable to this account.");
   }).catch(e=>{if(gallery.isConnected)gallery.textContent=e.message||"Photos unavailable";});
 }
 function editDraftKey(id){return lastUser?"seaweed-ag:journal-edit-draft:"+lastUser+":"+id:null;}
 function readEditDraft(entry){
   try{
     const key=editDraftKey(entry.id);
     const draft=key?JSON.parse(localStorage.getItem(key)||"null"):null;
     return draft?.revision===entry.revision?draft:null;
   }catch{return null;}
 }
 function clearEditDraft(id){
   try{const key=editDraftKey(id);if(key)localStorage.removeItem(key);}catch{}
 }
 function startInlineEdit(entry){
   if(!entry||editing||busy)return;
   const wrap=root.querySelector(".journal-detail");
   const heading=wrap?.querySelector(".journal-title");
   const notes=wrap?.querySelector(".journal-notes");
   const head=wrap?.querySelector(".journal-detail-head");
   if(!wrap||!heading||!notes||!head)return;
   editing=true;selected.clear();
   const old=readEditDraft(entry);
   if(old)status("Unsaved edits restored from this device.");
   const editAction=Array.from(head.querySelectorAll("button"))
     .find(b=>b.textContent==="Edit entry");
   if(editAction)editAction.hidden=true;
   heading.contentEditable="plaintext-only";heading.setAttribute("role","textbox");
   heading.setAttribute("aria-label","Journal title");heading.spellcheck=true;
   notes.contentEditable="plaintext-only";notes.setAttribute("role","textbox");
   notes.setAttribute("aria-label","Journal notes");notes.setAttribute("aria-multiline","true");
   notes.spellcheck=true;notes.textContent=old?.notes??entry.notes??"";
   heading.textContent=old?.title??entry.title;
   heading.classList.add("journal-editable");
   notes.classList.add("journal-editable");
   notes.dataset.placeholder="Write your visit notes here…";
   const properties=add(wrap,"details","journal-inline-properties");
   wrap.insertBefore(properties,notes);
   add(properties,"summary","","Entry details · date, activity, GPS and photos");
   const fields=add(properties,"div","journal-fields");
   const field=(label,name,type,value)=>{
     const item=add(fields,"label","journal-field");
     add(item,"span","",label);
     const input=add(item,"input");
     input.type=type;input.name=name;input.value=String(value??"");
     if(type==="number"){input.step="any";input.inputMode="decimal";}
     return input;
   };
   const when=field("Visit date","event_date","date",old?.event_date??entry.event_date);
   const type=field("Visit type","entry_type","text",old?.entry_type??entry.entry_type);
   const activity=field("Activity","activity","text",old?.activity??entry.activity);
   const place=field("Location","location_label","text",old?.location_label??entry.location_label);
   const lat=field("Latitude","latitude","number",old?.latitude??entry.latitude??"");
   const lon=field("Longitude","longitude","number",old?.longitude??entry.longitude??"");
   let gpsSource=old?.location_source??entry.location_source??"unknown";
   for(const item of [lat,lon])item.addEventListener("input",()=>{gpsSource="manual";saveDraft();});
   const photoSection=add(properties,"div","journal-photo-select");
   add(photoSection,"h4","","Attach photos from an upload batch");
   const batch=add(photoSection,"select");
   add(batch,"option","","Choose a photo batch");
   const choices=add(photoSection,"div","journal-photo-choices");
   const drawBatch=id=>{
     selected.clear();choices.replaceChildren();
     const related=[...(photoLookup?.values()||[])].filter(p=>p.photo_metadata?.batch_id===id &&
       !entry.photo_ids?.includes(p.id));
     for(const p of related){
       const label=add(choices,"label","journal-photo-choice");
       const cb=add(label,"input");cb.type="checkbox";cb.checked=true;
       selected.add(p.id);
       cb.addEventListener("change",()=>cb.checked?selected.add(p.id):selected.delete(p.id));
       add(label,"span","",p.title||p.filename||"Photo");
     }
     const found=[...(photoLookup?.values()||[])].find(p=>p.photo_metadata?.batch_id===id&&p.photo_metadata?.gps);
     if(found){
       button(choices,"Use GPS from this batch",()=>{
         lat.value=String(found.photo_metadata.gps.latitude);
         lon.value=String(found.photo_metadata.gps.longitude);
         gpsSource="photo_exif";saveDraft();
       },"metrics-button");
     }
   };
   photos().then(map=>{
     if(!batch.isConnected)return;
     const batches=new Map();
     for(const p of map.values()){
       const id=p.photo_metadata?.batch_id;
       if(!id||entry.photo_ids?.includes(p.id))continue;
       if(!batches.has(id))batches.set(id,{id,at:p.created_at||p.captured_at||"",count:0,
         title:String(p.photo_metadata?.batch_description||p.activity||"Photo upload").split("\n")[0]});
       batches.get(id).count++;
     }
     for(const b of [...batches.values()].sort((x,y)=>y.at.localeCompare(x.at)).slice(0,30)){
       const option=add(batch,"option","",dateText(b.at.slice(0,10))+" · "+b.count+" photos · "+b.title.slice(0,50));
       option.value=b.id;
     }
     batch.addEventListener("change",()=>drawBatch(batch.value));
   }).catch(()=>add(choices,"p","journal-muted","Photo batches unavailable."));
   const actions=add(head,"div","journal-inline-actions");
   const feedback=add(actions,"span","journal-editor-feedback");
   feedback.setAttribute("role","status");
   const textValue=el=>String(el.innerText??el.textContent??"").replace(/\r/g,"");
   function values(){
     return {
       title:textValue(heading).trim(),notes:textValue(notes),
       event_date:when.value,entry_type:type.value.trim()||"Field visit",
       activity:activity.value.trim(),location_label:place.value.trim(),
       latitude:lat.value,longitude:lon.value,location_source:gpsSource
     };
   }
   function saveDraft(){
     try{const key=editDraftKey(entry.id);
       if(key)localStorage.setItem(key,JSON.stringify({...values(),revision:entry.revision}));
     }catch{}
   }
   heading.addEventListener("input",saveDraft);
   notes.addEventListener("input",saveDraft);
   properties.addEventListener("input",saveDraft);
   const cancel=()=>{
     if(busy)return;
     clearEditDraft(entry.id);editing=false;render();
   };
   button(actions,"Cancel",cancel,"metrics-button");
   const save=button(actions,"Save changes",async()=>{
     if(busy)return;
     const data=values();
     if(!data.title||data.title.length>180||!data.event_date||data.notes.length>30000){
       feedback.textContent="Add a title and date. Notes must be under 30,000 characters.";return;
     }
     if(Boolean(data.latitude)!==Boolean(data.longitude)){
       feedback.textContent="Enter both GPS coordinates or leave both empty.";return;
     }
     const changes={...data};
     if(data.latitude&&data.longitude){
       changes.latitude=Number(data.latitude);changes.longitude=Number(data.longitude);
       if(!Number.isFinite(changes.latitude)||!Number.isFinite(changes.longitude)||
         Math.abs(changes.latitude)>90||Math.abs(changes.longitude)>180){
         feedback.textContent="GPS coordinates are outside the valid range.";return;
       }
     }else{changes.latitude=null;changes.longitude=null;changes.location_source="unknown";}
     busy=true;save.disabled=true;feedback.textContent="Saving…";
     let linkedError="";
     try{
       const updated=check(await client.rpc("ag_project_journal_save",{
         p_id:entry.id,p_expected_revision:entry.revision,p_entry:changes
       }));
       entry.revision=updated.revision;
       clearEditDraft(entry.id);
       if(selected.size){
         try{check(await client.rpc("ag_project_journal_link_photos",{
           p_journal_id:entry.id,p_photo_ids:[...selected]
         }));}
         catch(err){linkedError=err.message||"Could not link photos";}
       }
       editing=false;notifySaved();
       const y=window.scrollY;
       await load({openId:entry.id});
       window.scrollTo(0,y);
       if(linkedError)status("Text saved, but photo links need another attempt: "+linkedError,true);
     }catch(err){
       feedback.textContent=(err?.message||"Could not save changes")+". Edits remain on this page.";
     }finally{busy=false;save.disabled=false;}
   },"metrics-button journal-primary");
   add(head,"span","journal-inline-indicator","Editing document");
 }
 function beginEdit(existing=null){
   if(existing){startInlineEdit(existing);return;}
   activeId=null;detail=null;editing=true;photoBatch="";selected.clear();
   savedDraft=draftData();render();
 }
 function renderEditor(){
   const existing=detail;
   const persisted=!existing?savedDraft:null;
   const form=add(root,"form","journal-editor");
   const header=add(form,"div","journal-editor-head");
   add(header,"h3","",existing?"Edit journal entry":"New journal entry");
   button(header,"Cancel",()=>{editing=false;render();},"metrics-button");
   const grid=add(form,"div","journal-fields");
   const field=(label,name,type,value,max)=>{
     const l=add(grid,"label","journal-field");add(l,"span","",label);
     const n=add(l,type==="textarea"?"textarea":"input");
     n.name=name;if(type!=="textarea")n.type=type;
     if(max)n.maxLength=max;
     n.value=String(value??"");
     return n;
   };
   const title=field("Title","title","text",existing?.title||persisted?.title||"",180);
   title.required=true;
   const when=field("Visit date","event_date","date",existing?.event_date||persisted?.event_date||localToday());
   when.required=true;
   const kind=field("Entry type","entry_type","text",existing?.entry_type||persisted?.entry_type||"Field visit",60);
   const activity=field("Activity (optional)","activity","text",existing?.activity||persisted?.activity||"",180);
   const place=field("Location","location_label","text",existing?.location_label||persisted?.location_label||"",180);
   const note=field("Field notes","notes","textarea",existing?.notes||persisted?.notes||"",30000);
   note.rows=10;note.placeholder="What happened, observations, people, next actions…";
   const lat=field("Latitude (optional)","latitude","number",existing?.latitude??persisted?.latitude??"");
   const lon=field("Longitude (optional)","longitude","number",existing?.longitude??persisted?.longitude??"");
   for(const n of [lat,lon]){n.step="any";n.inputMode="decimal";}
   // Distinguish EXIF-derived coordinates from manual location entry.
   let gpsSource=existing?.location_source||persisted?.location_source||"manual";
   for(const n of [lat,lon])n.addEventListener("input",()=>{gpsSource="manual";saveLocal();});
   const linkPhotos=add(form,"div","journal-photo-select");
   add(linkPhotos,"h4","","Link existing photos");
   const batchLabel=add(linkPhotos,"label","journal-field");
   add(batchLabel,"span","","Upload batch (optional)");
   const batch=add(batchLabel,"select");add(batch,"option","","No additional photos");
   const picks=add(linkPhotos,"div","journal-photo-picks");
   const gather=()=>({
     title:title.value.trim(),event_date:when.value,entry_type:kind.value.trim()||"Field visit",
     activity:activity.value.trim(),location_label:place.value.trim(),notes:note.value,
     latitude:lat.value,longitude:lon.value,location_source:gpsSource
   });
   const saveLocal=()=>{
     if(!existing)setDraft(gather());
   };
   form.addEventListener("input",saveLocal);
   const drawBatch=id=>{
     selected.clear();picks.replaceChildren();
     const list=(photoLookup?Array.from(photoLookup.values()):[])
       .filter(x=>x.photo_metadata?.batch_id===id);
     if(!list.length)return;
     const actions=add(picks,"div","journal-photo-selection-actions");
     button(actions,"Select all",()=>{list.forEach(x=>selected.add(x.id));showChoices();},"metrics-button");
     button(actions,"Clear",()=>{selected.clear();showChoices();},"metrics-button");
     const choiceArea=add(picks,"div","journal-photo-choices");
     function showChoices(){
       choiceArea.replaceChildren();
       for(const p of list){
         const label=add(choiceArea,"label","journal-photo-choice");
         const cb=add(label,"input");cb.type="checkbox";cb.checked=selected.has(p.id);
         cb.addEventListener("change",()=>cb.checked?selected.add(p.id):selected.delete(p.id));
         add(label,"span","",p.title||p.filename);
       }
     }
     list.forEach(x=>selected.add(x.id));showChoices();
     const first=list.find(x=>x.photo_metadata?.gps);
     if(first){
       button(picks,"Use GPS from selected batch",()=>{
         const gps=first.photo_metadata.gps;
         lat.value=String(gps.latitude);lon.value=String(gps.longitude);
          gpsSource="photo_exif";
         saveLocal();
       },"metrics-button");
     }
   };
   photos().then(map=>{
     if(!batch.isConnected)return;
     const batches=new Map();
     for(const p of map.values()){
       const id=p.photo_metadata?.batch_id;
       if(!id)continue;
       if(!batches.has(id))batches.set(id,{id,created:p.created_at||p.captured_at||"",count:0,
         name:String(p.photo_metadata?.batch_description||p.activity||"Photo upload").split("\n")[0]});
       batches.get(id).count++;
     }
     for(const b of [...batches.values()].sort((a,b)=>b.created.localeCompare(a.created)).slice(0,30)){
       const opt=add(batch,"option","",dateText(b.created.slice(0,10))+" · "+b.count+" photos · "+b.name.slice(0,55));
       opt.value=b.id;
     }
     batch.addEventListener("change",()=>drawBatch(batch.value));
   }).catch(()=>add(picks,"p","journal-muted","Photo batches unavailable."));
   const actions=add(form,"div","journal-editor-actions");
   const feedback=add(actions,"span","journal-editor-feedback");
   const save=button(actions,"Save entry",()=>form.requestSubmit(),"metrics-button journal-primary");
   form.addEventListener("submit",async e=>{
     e.preventDefault();if(busy)return;
     const data=gather();
     if(!data.title||!data.event_date){feedback.textContent="Title and date are required.";return;}
     if(Boolean(data.latitude)!==Boolean(data.longitude)){feedback.textContent="Enter both GPS coordinates, or leave both blank.";return;}
     const entry={...data,project:existing?.project||"COSME"};
     if(data.latitude&&data.longitude){
       entry.latitude=Number(data.latitude);entry.longitude=Number(data.longitude);
       entry.location_source=gpsSource==="photo_exif"?"photo_exif":"manual";
     }else{
       // Explicit nulls clear an existing pin; omitted fields would retain it.
       entry.latitude=null;entry.longitude=null;entry.location_source="unknown";
     }
     if(!existing)entry.organisation_code="COSME";
     busy=true;save.disabled=true;feedback.textContent="Saving…";
     try{
       const args={p_entry:entry};
       if(existing){args.p_id=existing.id;args.p_expected_revision=existing.revision;}
       const saved=check(await client.rpc("ag_project_journal_save",args));
       const id=saved.id;
       if(selected.size){
         try{check(await client.rpc("ag_project_journal_link_photos",{
           p_journal_id:id,p_photo_ids:[...selected]}));}
         catch(err){
           // The journal entry already exists: never leave the editor in
           // create mode, which would make a retry create a duplicate.
           setDraft(null);busy=false;editing=false;activeId=id;
           notifySaved();await load({openId:id});
           status("Entry saved, but photos were not linked: "+(err.message||"Please retry from Edit entry."),true);
           return;
         }
       }
       setDraft(null);busy=false;editing=false;activeId=id;
       notifySaved();await load({openId:id});
     }catch(err){feedback.textContent=err.message||"Unable to save. Notes remain in the editor.";
       busy=false;save.disabled=false;}
   });
 }
 function render(){
   if(!root)return;
   root.replaceChildren();root.className="metrics-panel project-journal";
   makeHeading();
   add(root,"p","journal-status");
   renderStatus();
   if(busy&&!ready){add(root,"p","journal-muted","Loading journal…");return;}
   if(editing){renderEditor();return;}
   if(detail&&activeId){renderDetail();return;}
   renderList();
 }
 return {
   load,open,fromPhoto,
   setUser(id){if(lastUser!==id){lastUser=id||null;savedDraft=null;}},
   clearDraft(){setDraft(null);if(activeId)clearEditDraft(activeId);},
   async showFromQuery(){
     const params=new URLSearchParams(location.search);
     if(UUID.test(params.get("entry")||""))await open(params.get("entry"));
     else if(UUID.test(params.get("photo")||""))await fromPhoto(params.get("photo"));
     else await load();
   },
   clear(){activePhotoViewer?.close?.();activePhotoViewer=null;photoCache.clear();
     ++seq;entries=[];detail=null;activeId=null;photoLookup=null;ready=false;editing=false;
     error="";message="";busy=false;lastUser=null;root.replaceChildren();},
   isEditing(){return editing||Boolean(activePhotoViewer?.viewer?.open)},
   refreshIfOpen(){if(!editing)load({openId:activeId}).catch(()=>{});}
 };
}
