import {LIBRARY_BUCKET,PROJECTS,EXAMPLES,filterLibrary,localDateTime,libraryMetadata,validateLibraryFile} from "./cosme_project_library_core.mjs?v=2";
import {prepareLibraryImage,captureTimestamp} from "./cosme_photo_exif.mjs?v=1";
const make=(tag,cls="",text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n};
const add=(root,tag,cls,text)=>{const n=make(tag,cls,text);root.append(n);return n};
const button=(root,text,fn)=>{const b=add(root,"button","metrics-button",text);b.type="button";b.addEventListener("click",fn);return b};
const check=result=>{if(result.error)throw result.error;return result.data};

export function createProjectLibrary(client,root,kind){
  let folders=[],items=[],trashItems=[],canEdit=false,loaded=false,busy=false,epoch=0,page=0,examples=true,filtersOpen=false;
  let filters={},message="",failed=false,viewTrash=false,favoritesOnly=false,selectMode=false,selectedIds=new Set();
  const noun=kind==="reports"?"report":"photo",pageSize=24;
  root.className="metrics-panel project-library";
  function clear(){epoch++;folders=[];items=[];trashItems=[];canEdit=false;loaded=false;busy=false;filters={};page=0;filtersOpen=false;viewTrash=false;favoritesOnly=false;selectMode=false;selectedIds.clear();message="";failed=false;root.replaceChildren()}
  function status(text,error=false){message=text;failed=error;const n=root.querySelector('[data-library-status]');if(n){n.hidden=!text;n.textContent=text;n.setAttribute("role",error?"alert":"status")}}
  async function load(){
    if(busy)return;
    const ticket=++epoch;
    if(!loaded){root.replaceChildren(make("p","metrics-small-note","Loading "+kind+"…"))}
    try{
      const data=check(await client.rpc("cosme_library_list",{p_kind:kind}));
      if(ticket!==epoch)return;
      folders=data.folders||[];items=data.items||[];trashItems=data.trashed_items||[];canEdit=data.can_edit===true;loaded=true;message="";failed=false;draw();
    }catch(e){if(ticket!==epoch)return;folders=[];items=[];canEdit=false;status("Unable to load "+kind+". "+(e.message||"Please retry."),true);draw()}
  }
  function select(root,label,values,value,change){
    const l=add(root,"label","",label),s=add(l,"select");
    s.setAttribute("aria-label",label);
    for(const [v,name] of values){const o=add(s,"option","",name);o.value=v}
    s.value=value||"";s.addEventListener("change",()=>change(s.value));return s;
  }
  async function openFile(item,download=false){
    const ticket=epoch;
    // Same-page viewer preserves phone filters and does not require popup permission.
    let viewer=null,content=null;
    if(!download){
      viewer=add(root,"dialog","library-viewer");viewer.setAttribute("aria-label",item.title);
      const head=add(viewer,"div","library-heading");add(head,"h3","",item.title);
      const actions=add(head,"div","library-actions");button(actions,"Download",()=>openFile(item,true));
      button(actions,"Close",()=>viewer.close());
      viewer.addEventListener("close",()=>viewer.remove());
      content=add(viewer,"div","library-viewer-content","Opening…");viewer.showModal();
    }
    try{
      const data=check(await client.storage.from(LIBRARY_BUCKET).createSignedUrl(item.object_path,60,download?{download:true}:undefined));
      if(ticket!==epoch||viewer&&!viewer.isConnected){viewer?.remove();return}
      if(download){
        const link=make("a");link.href=data.signedUrl;link.download=item.filename;
        document.body.append(link);link.click();link.remove();return;
      }
      content.replaceChildren();
      if(kind==="reports"&&!navigator.pdfViewerEnabled){
        add(content,"p","metrics-small-note","Download this report to read it in your PDF reader.");return;
      }
      if(kind==="reports")add(content,"p","metrics-small-note","If the preview is unavailable, download a copy to read on your device.");
      const media=add(content,kind==="reports"?"iframe":"img");
      if(kind==="reports"){media.title=item.title;media.referrerPolicy="no-referrer"}else media.alt=item.title;
      media.src=data.signedUrl;
    }catch(e){viewer?.remove();if(ticket===epoch)status("Could not open file. "+e.message,true)}
  }
  function editor(existing=null,replace=false){
    if(busy)return;
    root.querySelector(".library-editor")?.remove();
    const label=replace?"Replace PDF":existing?"Edit reference":"Add "+noun;
    const form=add(root,"form","library-editor");form.setAttribute("aria-label",label);
    add(form,"h3","",label);
    if(kind==="reports")add(form,"p","metrics-small-note","One current PDF per activity and report type. Uploading a replacement advances its file version.");
    const grid=add(form,"div","library-fields"),fields={};
    function input(key,label,type="text",limit=180){
      const l=add(grid,"label","",label),n=add(l,key==="caption"?"textarea":"input");
      if(key!=="caption")n.type=type;n.maxLength=limit;n.value=existing?.[key]||"";fields[key]=n;return n;
    }
    input("title","Title").required=true;
    fields.project=select(grid,kind==="reports"?"Activity":"Project",PROJECTS.map(v=>[v,v]),existing?.project||"Whole project",()=>{});
    // Preserve existing/custom project labels rather than silently changing them.
    if(existing?.project&&!PROJECTS.includes(existing.project)){const o=add(fields.project,"option","",existing.project);o.value=existing.project;fields.project.value=existing.project}
    if(kind==="photos")fields.folder_id=select(grid,"Folder",[["","No folder"],...folders.map(f=>[f.id,f.name])],existing?.folder_id||filters.folder,()=>{});
    if(kind==="reports"){
      const types=["Closeout","Verification","Maintenance","Innovation","Assembly","Other"];
      if(existing?.report_type&&!types.includes(existing.report_type))types.push(existing.report_type);
      fields.report_type=select(grid,"Report type",types.map(v=>[v,v]),existing?.report_type||"Closeout",()=>{});
      input("submitted_on","Date submitted to register","date").value=replace?localDateTime(new Date().toISOString()).slice(0,10):existing?.submitted_on||localDateTime(new Date().toISOString()).slice(0,10);
    }
    input("prototype","Prototype version","text",100).placeholder="e.g. V1.2";
    if(kind==="photos"){
      input("captured_at","Photo date & time (local, optional)","datetime-local").value=localDateTime(existing?.captured_at);
      input("location","Location (optional)");input("activity","Activity (optional)");input("asset","Asset / instrument ID (optional)");
    }
    input("caption","Notes (optional)","text",1000);
    let file=null;
    if(!existing||replace){
      file=input("file",kind==="reports"?"PDF (up to 20 MB)":"Photo (JPG, PNG or WebP, up to 20 MB)","file");
      file.accept=kind==="reports"?"application/pdf":"image/jpeg,image/png,image/webp";file.required=true;
    }
    const actions=add(form,"div","library-actions");
    const submitText=replace?"Replace PDF":existing?"Save reference":"Upload "+noun;
    const submit=add(actions,"button","metrics-button primary",submitText);submit.type="submit";
    const cancel=button(actions,"Cancel",()=>form.remove());
    const error=add(form,"p","metrics-small-note");error.setAttribute("role","alert");
    // Keep an upload reservation for retry, including a finish failure after upload.
    let reservation=null,uploaded=false,reservedFile=null,reservedMetadata=null;
    form.addEventListener("submit",async event=>{
      event.preventDefault();if(busy)return;
      const ticket=epoch;busy=true;submit.disabled=true;cancel.disabled=true;error.textContent="";
      submit.textContent=existing?"Saving…":"Uploading…";form.setAttribute("aria-busy","true");
      Object.values(fields).forEach(n=>n.disabled=true);
      try{
        const metadata=libraryMetadata(Object.fromEntries(Object.entries(fields).filter(([k])=>k!=="file").map(([k,n])=>[k,n.value])),kind);
        if(replace){metadata.replaces_id=existing.id;metadata.replaces_revision=existing.revision}
        if(existing&&!replace){
          check(await client.rpc("cosme_library_save",{p_kind:kind,p_metadata:metadata,p_id:existing.id,p_revision:existing.revision}));
        }else{
          const selected=file.files[0];
          const details=await validateLibraryFile(kind,selected);if(ticket!==epoch)return;
          if(reservedFile!==selected){reservation=null;uploaded=false;reservedFile=selected}
          if(!reservation){reservation=check(await client.rpc("cosme_library_save",{p_kind:kind,p_metadata:{...metadata,...details}}));reservedMetadata=JSON.stringify(metadata)}
          if(ticket!==epoch)return;
          if(!uploaded){
            const result=await client.storage.from(LIBRARY_BUCKET).upload(reservation.object_path,selected,{contentType:details.mime_type,upsert:false});
            // A lost response may follow a successful immutable upload. Finish validates
            // the reserved path, size and MIME before making it visible.
            if(result.error&&String(result.error.statusCode)!=="409")throw result.error;
            uploaded=true;
          }
          if(ticket!==epoch)return;
          check(await client.rpc("cosme_library_finish",{p_id:reservation.id}));
          // If fields changed during a retry, persist the latest metadata after finalisation.
          if(ticket!==epoch)return;
          if(JSON.stringify(metadata)!==reservedMetadata)
            check(await client.rpc("cosme_library_save",{p_kind:kind,p_metadata:metadata,p_id:reservation.id,p_revision:reservation.revision}));
        }
        if(ticket!==epoch)return;form.remove();busy=false;await load();
      }catch(e){if(ticket===epoch)error.textContent=e.message||"Could not save. Your fields are kept; retry when connected."}
      finally{if(ticket===epoch){busy=false;submit.disabled=false;cancel.disabled=false;submit.textContent=submitText;form.setAttribute("aria-busy","false");Object.values(fields).forEach(n=>n.disabled=false)}}
    });
    fields.title.focus();
  }
  function folderForm(){
    if(busy)return;
    if(root.querySelector(".library-folder-form"))return;
    const form=add(root,"form","library-folder-form");
    const label=add(form,"label","","Folder name"),name=add(label,"input");name.required=true;name.maxLength=120;
    const save=add(form,"button","metrics-button","Create folder");save.type="submit";
    button(form,"Cancel",()=>form.remove());
    const error=add(form,"span","metrics-small-note");error.setAttribute("role","alert");
    form.addEventListener("submit",async e=>{
      e.preventDefault();if(busy)return;const ticket=epoch;busy=true;save.disabled=true;
      try{const id=check(await client.rpc("cosme_library_add_folder",{p_kind:kind,p_name:name.value.trim()}));
        if(ticket!==epoch)return;filters.folder=id;page=0;busy=false;await load();
      }catch(e){if(ticket===epoch)error.textContent=e.message}
      finally{if(ticket===epoch){busy=false;save.disabled=false}}
    });name.focus();
  }
  async function photoAction(ids,action){
    if(!canEdit||busy||!ids.length)return;
    if(action==="trash"&&!confirm("Move "+ids.length+" photo"+(ids.length===1?"":"s")+" to Trash? You can restore them later."))return;
    busy=true;
    try{
      const result=check(await client.rpc("cosme_library_photo_action",{p_ids:ids,p_action:action}));
      selectedIds.clear();selectMode=false;busy=false;await load();
      status((result.updated||0)+" photo"+(result.updated===1?"":"s")+" updated");
    }catch(e){busy=false;status(e.message||"Could not update photos",true)}
  }
  function batchUpload(){
    if(busy)return;
    root.querySelector(".library-batch-form")?.remove();
    const form=add(root,"form","library-batch-form");
    const head=add(form,"div","library-heading");
    add(head,"h3","","Upload photos");
    button(head,"Cancel",()=>form.remove());
    const grid=add(form,"div","library-fields");
    const chooser=add(grid,"label","","Select images");
    const files=add(chooser,"input");files.type="file";files.multiple=true;
    files.accept="image/jpeg,image/png,image/webp,image/heic,image/heif";files.required=true;
    const project=select(grid,"Project",PROJECTS.map(v=>[v,v]),filters.project||"Whole project",()=>{});
    const activityLabel=add(grid,"label","","Activity"),activity=add(activityLabel,"input");activity.value=filters.activity||"";
    const locationLabel=add(grid,"label","","Location"),location=add(locationLabel,"input");location.value=filters.location||"";
    const assetLabel=add(grid,"label","","Asset / raft"),asset=add(assetLabel,"input");asset.value=filters.asset||"";
    const note=add(form,"p","metrics-small-note","Camera date and GPS are saved when present. Images are optimised for storage.");
    const run=add(form,"button","metrics-button primary","Upload selected photos");run.type="submit";
    const feedback=add(form,"p","metrics-small-note");feedback.setAttribute("role","status");
    form.addEventListener("submit",async e=>{
      e.preventDefault();if(busy||!files.files.length)return;
      const entries=[...files.files];busy=true;run.disabled=true;files.disabled=true;
      const duplicates=new Set();
      let completed=0,failed=0;
      for(let i=0;i<entries.length;i++){
        const original=entries[i];
        if(duplicates.has(original.name+"|"+original.size+"|"+original.lastModified)){failed++;continue}
        duplicates.add(original.name+"|"+original.size+"|"+original.lastModified);
        feedback.textContent="Uploading "+(i+1)+" of "+entries.length+"…";
        try{
          const prep=await prepareLibraryImage(original),file=prep.file;
          const details=await validateLibraryFile("photos",file);
          const capture=captureTimestamp(prep.metadata);
          const title=original.name.replace(/\.[^.]+$/,"").replace(/[_-]+/g," ").slice(0,180)||"Project photo";
          const gps=prep.metadata.gps;
          const place=location.value.trim()||(
            gps&&Number.isFinite(gps.latitude)&&Number.isFinite(gps.longitude)?
            "GPS: "+gps.latitude.toFixed(6)+", "+gps.longitude.toFixed(6):""
          );
          const metadata={title,project:project.value,activity:activity.value.trim(),
            location:place,asset:asset.value.trim(),caption:"",captured_at:capture.value,
            prototype:"",...details};
          const reservation=check(await client.rpc("cosme_library_save",{p_kind:"photos",p_metadata:metadata}));
          const stored=await client.storage.from(LIBRARY_BUCKET).upload(reservation.object_path,file,{
            contentType:details.mime_type,upsert:false});
          if(stored.error)throw stored.error;
          check(await client.rpc("cosme_library_finish",{p_id:reservation.id}));
          const captureMeta={...prep.metadata,capture_source:capture.source,optimized:prep.optimized};
          const saved=await client.rpc("cosme_library_photo_capture",{
            p_id:reservation.id,p_expected_revision:reservation.revision,
            p_metadata:captureMeta,p_source:"web"
          });
          if(saved.error)feedback.textContent="Saved image; camera metadata could not be added: "+(saved.error.message||"Try editing later");
          completed++;
        }catch(err){failed++;feedback.textContent=original.name+": "+(err.message||"Upload failed")}
      }
      busy=false;
      const message=completed+" of "+entries.length+" saved"+(failed?" · "+failed+" failed":"");
      if(completed){form.remove();await load()}
      else{run.disabled=false;files.disabled=false;feedback.textContent=message}
      status(message,!!failed);
    });
    files.focus();
  }
  function photoTile(item,container){
    const tile=add(container,"div","library-tile");
    const photo=add(tile,"button","library-tile-open");photo.type="button";
    photo.setAttribute("aria-label",(selectMode?"Select ":"Open ")+item.title);
    const img=add(photo,"img");img.alt="";img.loading="lazy";
    const epochAtRequest=epoch;
    client.storage.from(LIBRARY_BUCKET).createSignedUrl(item.object_path,60).then(({data,error})=>{
      if(epoch===epochAtRequest&&img.isConnected&&!error)img.src=data.signedUrl;
    }).catch(()=>{});
    if(selectMode){
      const checkmark=add(photo,"span","library-tile-check",selectedIds.has(item.id)?"✓":"");
      if(selectedIds.has(item.id))tile.classList.add("is-selected");
    }
    photo.addEventListener("click",()=>{
      if(selectMode){
        if(selectedIds.has(item.id))selectedIds.delete(item.id);else selectedIds.add(item.id);
        draw();
      }else openFile(item);
    });
    if(item.is_favourite){const heart=add(tile,"span","library-tile-heart","♥");heart.setAttribute("aria-label","Favourite")}
    if(canEdit&&!selectMode&&!viewTrash){
      const star=add(tile,"button","library-tile-fav",item.is_favourite?"♥":"♡");
      star.type="button";star.setAttribute("aria-label",item.is_favourite?"Remove favourite":"Favourite");
      star.addEventListener("click",()=>photoAction([item.id],item.is_favourite?"unfavourite":"favourite"));
    }
  }
  function card(item,container){
    const article=add(container,"article","library-card"+(item.example?" library-example":""));
    if(kind==="photos"){
      const preview=add(article,"div","library-photo");
      if(item.example)add(preview,"span","metrics-small-note","Example photo reference");
      else{
        const img=add(preview,"img");img.alt=item.title;img.loading="lazy";
        const ticket=epoch;
        client.storage.from(LIBRARY_BUCKET).createSignedUrl(item.object_path,60).then(result=>{
          if(ticket!==epoch||!img.isConnected)return;
          if(result.error){preview.replaceChildren(make("span","metrics-small-note","Preview unavailable. Use Open photo."));return}
          img.src=result.data.signedUrl;
        }).catch(()=>{if(ticket===epoch)preview.replaceChildren(make("span","metrics-small-note","Preview unavailable. Use Open photo."))});
      }
    }
    add(article,"h3","",item.title);
    add(article,"p","library-context",[item.project,item.prototype,item.example?"Example · not saved":null].filter(Boolean).join(" · "));
    if(item.captured_at)add(article,"p","metrics-small-note",new Date(item.captured_at).toLocaleString());
    for(const [key,label] of [["location","Location"],["activity","Activity"],["asset","Asset"]])if(item[key])add(article,"p","metrics-small-note",label+": "+item[key]);
    if(item.caption)add(article,"p","metrics-small-note",item.caption);
    if(!item.example){
      const actions=add(article,"div","library-actions");button(actions,"Open "+(kind==="reports"?"PDF":"photo"),()=>openFile(item));
      button(actions,"Download",()=>openFile(item,true));
      if(canEdit)button(actions,"Edit reference",()=>editor(item));
    }
  }
  function draw(){
    if(busy)return;
    root.replaceChildren();
    const heading=add(root,"div","library-heading");add(heading,"h3","",kind==="reports"?"Reports":"Project photos");
    const actions=add(heading,"div","library-actions");
    if(kind==="photos"){
      if(canEdit&&!viewTrash)button(actions,"Add Photos",batchUpload).classList.add("primary");
      if(canEdit)button(actions,selectMode?"Cancel":"Select",()=>{selectMode=!selectMode;selectedIds.clear();draw()});
      button(actions,viewTrash?"Library":"Trash",()=>{viewTrash=!viewTrash;favoritesOnly=false;selectMode=false;selectedIds.clear();page=0;draw()});
    }else if(canEdit)button(actions,"Add "+noun,()=>editor());
    button(actions,"Refresh",()=>{if(!busy)load()});
    const notice=add(root,"p","metrics-small-note",message);notice.hidden=!message;notice.dataset.libraryStatus="";notice.setAttribute("role",failed?"alert":"status");
    if(kind==="photos"){
      const toolbar=add(root,"div","library-photo-toolbar");
      const activeFilter=(k,value,fn)=>{const b=button(toolbar,value,fn);if(k)b.classList.add("is-active");return b};
      activeFilter(!favoritesOnly,"All",()=>{favoritesOnly=false;page=0;draw()});
      if(!viewTrash)activeFilter(favoritesOnly,"Favourites",()=>{favoritesOnly=true;page=0;draw()});
      select(toolbar,"Activity",[["","All activities"],...[...new Set(items.map(i=>i.project).filter(Boolean))].sort().map(v=>[v,v])],filters.project,value=>{filters.project=value;page=0;draw()});
      if(canEdit&&selectedIds.size){
        add(toolbar,"span","metrics-small-note",selectedIds.size+" selected");
        if(viewTrash)button(toolbar,"Restore",()=>photoAction([...selectedIds],"restore"));
        else{
          button(toolbar,"Favourite",()=>photoAction([...selectedIds],"favourite"));
          button(toolbar,"Unfavourite",()=>photoAction([...selectedIds],"unfavourite"));
          button(toolbar,"Move to Trash",()=>photoAction([...selectedIds],"trash"));
        }
      }
    }
    const controls=add(root,"div","library-filters");
    const searchLabel=add(controls,"label","","Search"),search=add(searchLabel,"input");search.type="search";search.value=filters.search||"";search.placeholder="Project, prototype, location, activity or asset";
    search.addEventListener("change",()=>{filters.search=search.value;page=0;draw()});
    const change=key=>value=>{filters[key]=value;page=0;draw()};
    const details=add(root,"details","library-more-filters");add(details,"summary","","Filters");
    const more=add(details,"div","library-filters");
    if(kind==="photos")select(more,"Folder",[["","All folders"],...folders.map(f=>[f.id,f.name])],filters.folder,change("folder"));
    select(more,kind==="reports"?"Activity":"Project",[["","All activities"],...[...new Set([...PROJECTS,...items.map(i=>i.project)])].map(v=>[v,v])],filters.project,change("project"));
    for(const [key,label] of (kind==="reports"?[["report_type","Report type"],["prototype","Prototype"]]:[["prototype","Prototype"],["location","Location"],["activity","Activity"],["asset","Asset"]])){
      const values=[...new Set([...items,...EXAMPLES.filter(x=>x.kind===kind)].map(i=>i[key]).filter(Boolean))].sort();
      select(more,label,[["","All"],...values.map(v=>[v,v])],filters[key],change(key));
    }
    for(const [key,label] of [["from","From"],["to","To"]]){const l=add(more,"label","",label),n=add(l,"input");n.type="date";n.value=filters[key]||"";n.addEventListener("change",()=>change(key)(n.value))}
    button(more,"Clear filters",()=>{filters={};page=0;draw()});
    details.open=filtersOpen;
    details.addEventListener("toggle",()=>{filtersOpen=details.open});
    const active=Object.entries(filters).filter(([k,v])=>k!=="search"&&v).length;
    details.querySelector("summary").textContent="Filters"+(active?" ("+active+")":"");
    const source=kind==="photos"&&viewTrash?trashItems:items;
    const selected=filterLibrary(source,filters).filter(i=>kind!=="photos"||!favoritesOnly||i.is_favourite);
    page=Math.min(page,Math.max(0,Math.ceil(selected.length/pageSize)-1));
    add(root,"p","metrics-small-note",selected.length+" "+(selected.length===1?noun:kind)+(canEdit?"":" · Read only"));
    const list=add(root,"div",kind==="photos"?"library-photo-grid":"library-report-list");
    const slice=selected.slice(page*pageSize,(page+1)*pageSize);
    if(kind==="reports"&&slice.length){
      const table=add(list,"table","library-report-table"),head=add(table,"thead"),hr=add(head,"tr");
      const headers=["Report","Activity","Report type","Submitted","File version","PDF"];
      for(const title of headers)add(hr,"th","",title).scope="col";
      const body=add(table,"tbody");
      for(const item of slice){
        const row=add(body,"tr");
        const values=[item.title,item.project,item.report_type,item.submitted_on||"Not recorded","V"+(item.file_version||1)];
        values.forEach((value,i)=>{const td=add(row,"td","",value);td.dataset.label=headers[i]});
        const cell=add(row,"td");cell.dataset.label="PDF";
        const actions=add(cell,"div","library-actions");button(actions,"Open PDF",()=>openFile(item));button(actions,"Download",()=>openFile(item,true));
        if(canEdit){button(actions,"Edit metadata",()=>editor(item));button(actions,"Replace PDF",()=>editor(item,true))}
      }
    }else for(const item of slice)if(kind==="photos")photoTile(item,list);else card(item,list);
    if(!selected.length)add(list,"p","metrics-small-note",items.length?"No matching references.":"No "+kind+" added yet.");
    if(selected.length>pageSize){const pages=add(root,"div","library-actions");button(pages,"Previous",()=>{page--;draw()}).disabled=page===0;add(pages,"span","metrics-small-note",`Page ${page+1} of ${Math.ceil(selected.length/pageSize)}`);button(pages,"Next",()=>{page++;draw()}).disabled=(page+1)*pageSize>=selected.length}
    if(kind==="reports"||kind==="photos")return;
    const sample=add(root,"details","library-examples");sample.open=examples;
    const summary=add(sample,"summary","","Examples (not saved)");
    sample.addEventListener("toggle",()=>{examples=sample.open});
    const sampleList=add(sample,"div",kind==="photos"?"library-gallery":"library-report-list");
    for(const item of filterLibrary(EXAMPLES.filter(x=>x.kind===kind),filters))card(item,sampleList);
    summary.setAttribute("aria-label","Illustrative "+kind+" metadata; these are not uploaded files");
  }
  return {load,clear};
}
