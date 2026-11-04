import {createQueuedBatch,putBatch,getBatch,listPendingBatches,listQueuedPhotos,putQueuedPhoto,deleteBatch,queueCounts} from "./cosme_photo_upload_queue.mjs?v=2";
import {LIBRARY_BUCKET,PROJECTS,EXAMPLES,filterLibrary,localDateTime,libraryMetadata,validateLibraryFile} from "./cosme_project_library_core.mjs?v=2";
import {prepareLibraryImage,captureTimestamp} from "./cosme_photo_exif.mjs?v=2";
const make=(tag,cls="",text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n};
const add=(root,tag,cls,text)=>{const n=make(tag,cls,text);root.append(n);return n};
const button=(root,text,fn)=>{const b=add(root,"button","metrics-button",text);b.type="button";b.addEventListener("click",fn);return b};
const check=result=>{if(result.error)throw result.error;return result.data};

export function createProjectLibrary(client,root,kind){
  let folders=[],items=[],trashItems=[],canEdit=false,loaded=false,busy=false,epoch=0,page=0,examples=true,filtersOpen=false;
  let filters={},message="",failed=false,viewTrash=false,favoritesOnly=false,selectMode=false,selectedIds=new Set(),photoView="grid",photoSearchOpen=false;
  let recovery=null,autoResumed=new Set();
  let mapRenderer=null,mapState=null,mapTicket=0;
  const noun=kind==="reports"?"report":"photo",pageSize=24;
  root.className="metrics-panel project-library";
  function releasePhotoMap(){
    mapTicket++;
    if(mapRenderer){
      mapState=mapRenderer.getView()||mapState;
      mapRenderer.destroy();
      mapRenderer=null;
    }
  }
  function clear(){
    releasePhotoMap();mapState=null;epoch++;
    folders=[];items=[];trashItems=[];canEdit=false;loaded=false;busy=false;
    filters={};page=0;filtersOpen=false;viewTrash=false;favoritesOnly=false;
    selectMode=false;selectedIds.clear();photoSearchOpen=false;
    message="";failed=false;root.replaceChildren();
  }
  function status(text,error=false){message=text;failed=error;const n=root.querySelector('[data-library-status]');if(n){n.hidden=!text;n.textContent=text;n.setAttribute("role",error?"alert":"status")}}
  function hasActiveInteraction(){
    if(kind!=="photos")return false;
    return Boolean(root.querySelector(".library-batch-form")||
      root.querySelector(".library-editor")||
      root.querySelector(".library-photo-viewer[open]")||
      root.querySelector(".library-photo-inline-edit"));
  }
  async function load(){
    // A returning iOS Photos picker or visibility refresh must never destroy
    // unsent files, dictated notes or an open photo. User navigation stays intact.
    if(busy||hasActiveInteraction())return;
    const ticket=++epoch;
    if(!loaded){root.replaceChildren(make("p","metrics-small-note","Loading "+kind+"…"))}
    try{
      const data=check(await client.rpc("cosme_library_list",{p_kind:kind}));
      if(ticket!==epoch||hasActiveInteraction())return;
      folders=data.folders||[];items=data.items||[];trashItems=data.trashed_items||[];canEdit=data.can_edit===true;loaded=true;message="";failed=false;draw();
      if(kind==="photos"&&canEdit)discoverRecovery().catch(()=>{});
    }catch(e){if(ticket!==epoch||hasActiveInteraction())return;folders=[];items=[];canEdit=false;status("Unable to load "+kind+". "+(e.message||"Please retry."),true);draw()}
  }
  function select(root,label,values,value,change){
    const l=add(root,"label","",label),s=add(l,"select");
    s.setAttribute("aria-label",label);
    for(const [v,name] of values){const o=add(s,"option","",name);o.value=v}
    s.value=value||"";s.addEventListener("change",()=>change(s.value));return s;
  }

  async function discoverRecovery(){
    const result=await client.auth.getUser();
    const owner=result.data?.user?.id;
    if(!owner)return;
    const pending=await listPendingBatches(owner);
    recovery=null;
    for(const queued of pending){
      const records=await listQueuedPhotos(queued.id);
      const counts=queueCounts(records);
      if(queued.state==="draft"){
        const hasNote=Boolean(Object.values(queued.snapshot||{}).some(v=>String(v||"").trim()));
        if(!records.length&&!hasNote){
          await deleteBatch(queued.id);continue;
        }
        recovery={id:queued.id,state:"draft",total:queued.total||0,...counts};
        break;
      }
      if(!records.length||counts.waiting===0){
        await deleteBatch(queued.id);
        continue;
      }
      recovery={id:queued.id,state:queued.state,total:queued.total,...counts};
      break;
    }
    if(!root.isConnected||busy||hasActiveInteraction())return;
    draw();
    // Recovery is opt-in. A photo selection/dictation draft must never start
    // uploading on its own when the iPhone returns from another app.
  }
  function photoIconButton(parent,symbol,label,handler){
    const control=add(parent,"button","library-photo-icon-button",symbol);
    control.type="button";
    control.setAttribute("aria-label",label);
    control.title=label;
    control.addEventListener("click",handler);
    return control;
  }
  async function openFile(item,download=false){
    const ticket=epoch;
    // Modal stays on the page: Escape, backdrop tap or compact × closes it.
    let viewer=null,content=null;
    if(!download){
      viewer=add(root,"dialog",kind==="photos"?"library-viewer library-photo-viewer":"library-viewer");
      viewer.setAttribute("aria-label",item.title);
      if(kind==="photos"){
        const top=add(viewer,"div","library-photo-viewer-top");
        const title=add(top,"h3","library-photo-viewer-title",item.title);
        title.title=item.title;
        const navigation=add(top,"div","library-photo-viewer-navigation");
        const visible=filterLibrary(items,filters).filter(p=>!favoritesOnly||p.is_favourite);
        const index=visible.findIndex(p=>p.id===item.id);
        const previous=photoIconButton(navigation,"‹","Previous photo",()=>{viewer.close();openFile(visible[index-1])});
        previous.disabled=index<=0;
        const next=photoIconButton(navigation,"›","Next photo",()=>{viewer.close();openFile(visible[index+1])});
        next.disabled=index<0||index>=visible.length-1;
        const close=photoIconButton(navigation,"×","Close photo",()=>viewer.close());
        close.classList.add("library-photo-close");
      }else{
        const head=add(viewer,"div","library-heading");
        add(head,"h3","",item.title);
        const actions=add(head,"div","library-actions");
        button(actions,"Download",()=>openFile(item,true));
        button(actions,"Close",()=>viewer.close());
      }
      viewer.addEventListener("click",e=>{if(e.target===viewer)viewer.close()});
      viewer.addEventListener("close",()=>viewer.remove());
      content=add(viewer,"div","library-viewer-content","Opening…");
      viewer.showModal();
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
      if(kind==="reports")add(content,"p","metrics-small-note","If the preview is unavailable, download a copy to read it in your PDF reader.");
      const media=add(content,kind==="reports"?"iframe":"img");
      if(kind==="reports"){media.title=item.title;media.referrerPolicy="no-referrer"}else media.alt=item.title;
      media.src=data.signedUrl;
      if(kind==="photos"){
        // Edit the description directly under the enlarged image. Keep the
        // photograph visible; don't navigate back to thumbnails to edit.
        const inline=add(viewer,"form","library-photo-inline-edit");
        inline.hidden=true;
        const label=add(inline,"label","","Photo description");
        const description=add(label,"textarea");
        description.rows=4;description.maxLength=1000;
        description.value=item.caption||"";
        description.placeholder="Describe what this photo shows…";
        const actions=add(inline,"div","library-photo-inline-actions");
        const save=add(actions,"button","metrics-button primary","Save description");
        save.type="submit";
        const cancel=button(actions,"Cancel",()=>{
          description.value=item.caption||"";
          inline.hidden=true;viewer.classList.remove("is-editing");
          captionDisplay.hidden=!item.caption;
        });
        const more=button(actions,"Other details",()=>{viewer.close();editor(item)});
        more.classList.add("library-photo-more-details");
        const editStatus=add(inline,"p","library-photo-inline-status");
        editStatus.setAttribute("role","status");
        inline.addEventListener("submit",async event=>{
          event.preventDefault();
          if(busy||!canEdit)return;
          const caption=description.value.trim();
          if(caption===(item.caption||"")){
            inline.hidden=true;viewer.classList.remove("is-editing");
            captionDisplay.hidden=!caption;return;
          }
          busy=true;save.disabled=true;cancel.disabled=true;
          editStatus.textContent="Saving…";
          try{
            const updated=check(await client.rpc("cosme_library_photo_patch",{
              p_id:item.id,p_expected_revision:item.revision,
              p_changes:{caption}
            }));
            Object.assign(item,updated);
            // The returned photo is authoritative, including its new revision.
            captionDisplay.textContent=item.caption||"";
            captionDisplay.hidden=!item.caption;
            inline.hidden=true;viewer.classList.remove("is-editing");
            editStatus.textContent="";
          }catch(err){
            editStatus.textContent=err?.message||"Could not save description. Try again.";
          }finally{busy=false;save.disabled=false;cancel.disabled=false}
        });
        const details=add(viewer,"div","library-viewer-meta");
        if(item.captured_at)add(details,"span","","Captured: "+new Date(item.captured_at).toLocaleString());
        if(item.location)add(details,"span","","Location: "+item.location);
        if(item.activity)add(details,"span","","Activity: "+item.activity);
        if(item.asset)add(details,"span","","Asset: "+item.asset);
        const captionDisplay=add(details,"p","library-viewer-caption",item.caption||"");
        captionDisplay.hidden=!item.caption;
        const gps=item.photo_metadata?.gps;
        if(gps&&Number.isFinite(gps.latitude)&&Number.isFinite(gps.longitude)){
          const link=add(details,"a","","View capture location on map");
          link.href="https://maps.google.com/?q="+gps.latitude+","+gps.longitude;
          link.target="_blank";link.rel="noopener noreferrer";
        }
        if(item.photo_metadata?.datetime_original&&!item.captured_at)
          add(details,"span","","Camera time: "+item.photo_metadata.datetime_original+" (timezone not recorded)");
        const footer=add(viewer,"div","library-photo-viewer-footer");
        photoIconButton(footer,"↓","Download photo",()=>openFile(item,true));
        if(canEdit){
          const favourite=photoIconButton(footer,item.is_favourite?"♥":"♡",
            item.is_favourite?"Remove favourite":"Favourite photo",()=>{
              viewer.close();
              photoAction([item.id],item.is_favourite?"unfavourite":"favourite");
            });
          if(item.is_favourite)favourite.classList.add("is-favourite");
          photoIconButton(footer,"✎","Edit photo description",()=>{
            inline.hidden=false;viewer.classList.add("is-editing");
            description.value=item.caption||"";
            captionDisplay.hidden=true;editStatus.textContent="";
            description.focus();
          });
        }
      }
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

  async function batchUpload(resumeId=null){
    if(busy)return;
    root.querySelector(".library-batch-form")?.remove();
    const form=add(root,"form","library-batch-form");
    const head=add(form,"div","library-heading");
    add(head,"h3","","Upload photos");
    let stopRequested=false,queued=null,entries=[],active=0,failedCount=0,errors=[],running=false;
    let draftWrite=Promise.resolve();
    const serialDraft=task=>{
      draftWrite=draftWrite.catch(()=>{}).then(task);
      return draftWrite;
    };
    const cancel=button(head,"Cancel",async()=>{
      if(running){stopRequested=true;cancel.disabled=true;cancel.textContent="Stopping…";return;}
      cancel.disabled=true;
      try {
        await draftWrite;
        if(queued?.state==="draft"){
          queued.snapshot=snapshot();
          await putBatch(queued);
          recovery={id:queued.id,state:"draft",total:queued.total,...queueCounts(entries)};
        }
        form.remove();
        if(kind==="photos")draw();
        if(queued?.state==="draft")status("Draft saved on this device");
      } catch(e) {
        cancel.disabled=false;
        errorLine.textContent=e.message||"Could not save draft";
      }
    });
    const grid=add(form,"div","library-fields");
    const chooser=add(grid,"label","","Select images");
    const files=add(chooser,"input");
    files.type="file";files.multiple=true;
    files.accept="image/jpeg,image/png,image/webp,image/heic,image/heif";
    files.required=!resumeId;
    const noteLabel=add(grid,"label","library-batch-note-label","Batch description");
    const note=add(noteLabel,"textarea");
    note.rows=3;note.maxLength=2500;
    note.placeholder="Describe these photos together. Dictation works here.";
    const project=select(grid,"Project",PROJECTS.map(v=>[v,v]),filters.project||"Whole project",()=>{});
    const activityLabel=add(grid,"label","","Activity"),activity=add(activityLabel,"input");
    activity.value=filters.activity||"";
    const locationLabel=add(grid,"label","","Location"),location=add(locationLabel,"input");
    location.value=filters.location||"";
    const assetLabel=add(grid,"label","","Asset / raft"),asset=add(assetLabel,"input");
    asset.value=filters.asset||"";
    const draftState=add(form,"p","library-draft-save-state");
    draftState.setAttribute("role","status");
    const run=add(form,"button","metrics-button primary",resumeId?"Resume upload":"Upload selected photos");
    run.type="submit";
    const feedback=add(form,"div","library-upload-progress");
    feedback.setAttribute("role","status");
    feedback.setAttribute("aria-live","polite");
    const countLine=add(feedback,"div","library-upload-status");
    const meter=add(feedback,"progress","library-upload-meter");
    meter.max=100;meter.value=0;meter.hidden=true;
    const savings=add(feedback,"div","library-upload-savings");
    const errorLine=add(feedback,"div","library-upload-errors");
    const formatMB=bytes=>(bytes/1048576).toFixed(1)+" MB";
    const fieldControls=[project,activity,location,asset,note];
    const snapshot=()=>({project:project.value,activity:activity.value.trim(),
      location:location.value.trim(),asset:asset.value.trim(),note:note.value.trim()});
    // Coalesce rapid keystrokes/dictation into the newest snapshot rather than
    // queuing dozens of IndexedDB transactions for one spoken description.
    let draftSaving=false,latestDraftSnapshot=null;
    const persistDraft=()=>{
      latestDraftSnapshot=snapshot();
      if(draftSaving)return draftWrite;
      draftSaving=true;
      return serialDraft(async()=>{
        try{
          if(running||(queued&&queued.state!=="draft"))return;
          const result=await client.auth.getUser();
          const owner=result.data?.user?.id;
          if(result.error||!owner)throw Error("Sign in to save this draft");
          if(!queued){
            queued={id:crypto.randomUUID(),owner,snapshot:latestDraftSnapshot,
              total:0,skipped:0,createdAt:Date.now(),state:"draft"};
          }
          while(latestDraftSnapshot){
            queued.snapshot=latestDraftSnapshot;
            latestDraftSnapshot=null;
            await putBatch(queued);
          }
          recovery={id:queued.id,state:"draft",total:queued.total,...queueCounts(entries)};
          if(form.isConnected){
            draftState.textContent="Draft saved on this iPhone";
            updateButtons();
          }
        }finally{draftSaving=false}
      });
    };
    for(const field of fieldControls){
      field.addEventListener("input",()=>{
        persistDraft().catch(e=>{errorLine.textContent="Draft not saved: "+(e.message||"device storage unavailable")});
      });
      field.addEventListener("change",()=>{
        persistDraft().catch(e=>{errorLine.textContent="Draft not saved: "+(e.message||"device storage unavailable")});
      });
    }
    files.addEventListener("change",()=>{
      if(!files.files.length||running)return;
      serialDraft(async()=>{
        countLine.textContent="Saving "+files.files.length+" selected photos on this device…";
        const session=await client.auth.getUser();
        const owner=session.data?.user?.id;
        if(session.error||!owner)throw Error("Sign in to save these photos");
        const selected=await createQueuedBatch({owner,snapshot:snapshot(),
          files:[...files.files],savedItems:items,state:"draft"});
        if(!selected.batch){
          countLine.textContent=selected.skipped+" photos already in the library";
          return;
        }
        const previous=queued?.state==="draft"?queued:null;
        queued=selected.batch;
        entries=await listQueuedPhotos(queued.id);
        recovery={id:queued.id,state:"draft",total:queued.total,...queueCounts(entries)};
        countLine.textContent=queued.total+" photos selected · saved on this device";
        draftState.textContent="Draft saved on this iPhone";
        if(selected.skipped)countLine.textContent+=" · "+selected.skipped+" already uploaded";
        if(previous&&previous.id!==queued.id)await deleteBatch(previous.id).catch(()=>{});
        updateButtons();
      }).catch(e=>{
        errorLine.textContent="Photo selection not saved: "+(e.message||"device storage unavailable");
      });
    });
    const setSnapshot=values=>{
      project.value=values.project||"Whole project";
      activity.value=values.activity||"";
      location.value=values.location||"";
      asset.value=values.asset||"";
      note.value=values.note||"";
    };
    function showProgress(){
      if(!queued)return;
      const {saved,complete,waiting,metadataPending}=queueCounts(entries);
      countLine.textContent=saved+" of "+queued.total+" saved"+
        (active?" · "+active+" uploading":"")+
        (waiting&&!active?" · "+waiting+" remaining":"")+
        (queued.skipped?" · "+queued.skipped+" skipped":"");
      meter.hidden=false;meter.value=Math.round(100*complete/Math.max(1,queued.total));
      const ready=entries.filter(e=>e.ready);
      const sourceBytes=ready.reduce((n,e)=>n+(e.originalBytes||0),0);
      const storedBytes=ready.reduce((n,e)=>n+(e.storedBytes||0),0);
      savings.textContent=sourceBytes?"Photos saved: "+formatMB(sourceBytes)+" original → "+
        formatMB(storedBytes)+" stored ("+Math.round(100*(1-storedBytes/sourceBytes))+"% smaller)":"";
      errorLine.textContent=errors.slice(0,2).join(" · ")||
        (metadataPending?"Checking "+metadataPending+" photo metadata records…":"");
    }
    function updateButtons(){
      const pending=queueCounts(entries).waiting;
      const draft=queued?.state==="draft";
      files.disabled=!!queued&&!draft;
      files.required=!queued?.total;
      fieldControls.forEach(control=>control.disabled=!!queued&&!draft);
      run.textContent=draft?(queued.total?"Upload "+queued.total+" photos":"Choose photos to upload"):
        queued?(pending?"Resume "+pending+" remaining":"Upload complete"):
        "Upload selected photos";
      run.disabled=!!queued&&(draft?!queued.total:!pending);
      cancel.disabled=false;cancel.textContent=draft?"Save for later":queued?"Close":"Cancel";
    }
    const transient=err=>{
      const code=Number(err?.statusCode||err?.status||0);
      return !code||[408,409,425,429].includes(code)||code>=500||
        /timeout|network|fetch|connection|temporar/i.test(err?.message||"");
    };
    const retry=async(action,attempts=3)=>{
      for(let n=0;n<attempts;n++){
        try{return await action();}
        catch(err){
          if(n===attempts-1||!transient(err))throw err;
          await new Promise(resolve=>setTimeout(resolve,350*(n+1)));
        }
      }
    };
    const verifySaved=async entry=>{
      // Covers an upload completed just before Safari terminated or a lost metadata response.
      const result=await client.rpc("cosme_library_list",{p_kind:"photos"});
      if(result.error)return false;
      const found=(result.data?.items||[]).find(x=>
        x.photo_metadata?.batch_id===queued.id &&
        x.photo_metadata?.batch_index===entry.index+1);
      if(!found)return false;
      entry.ready=true;entry.metadataSaved=true;entry.done=true;
      entry.reservation??={id:found.id,revision:found.revision};
      delete entry.original;delete entry.prepared;
      await putQueuedPhoto(entry);
      return true;
    };
    async function saveOne(entry){
      if((entry.ready||entry.uploaded) && await verifySaved(entry))return;
      const settings=queued.snapshot;
      if(!entry.ready && !entry.prepared){
        const source=entry.original;
        if(!source)throw Error("Original photo was not saved on this device");
        const original=new File([source],entry.originalName,{
          type:source.type||"image/jpeg",lastModified:entry.lastModified
        });
        const prep=await prepareLibraryImage(original);
        entry.prepared=prep.file;
        entry.exif=prep.metadata;
        entry.optimized=prep.optimized;
        entry.storedBytes=prep.file.size;
        // Retain only the smaller prepared image once it is durable.
        delete entry.original;
        await putQueuedPhoto(entry);
      }
      if(!entry.ready){
        const file=entry.prepared;
        const details=await validateLibraryFile("photos",file);
        const capture=captureTimestamp(entry.exif);
        const title=entry.originalName.replace(/\.[^.]+$/,"").replace(/[_-]+/g," ").slice(0,180)||"Project photo";
        const gps=entry.exif?.gps;
        const place=settings.location||(
          gps&&Number.isFinite(gps.latitude)&&Number.isFinite(gps.longitude)?
          "GPS: "+gps.latitude.toFixed(6)+", "+gps.longitude.toFixed(6):"");
        const metadata={title,project:settings.project,activity:settings.activity,
          location:place,asset:settings.asset,caption:settings.note.slice(0,1000),
          captured_at:capture.value,prototype:"",...details};
        if(!entry.reservation){
          entry.reservation=await retry(()=>client.rpc("cosme_library_save",{
            p_kind:"photos",p_metadata:metadata
          }).then(check));
          await putQueuedPhoto(entry);
        }
        if(!entry.uploaded){
          await retry(async()=>{
            const stored=await client.storage.from(LIBRARY_BUCKET).upload(
              entry.reservation.object_path,file,{contentType:details.mime_type,upsert:false});
            if(stored.error&&String(stored.error.statusCode||stored.error.status)!=="409")
              throw stored.error;
          });
          entry.uploaded=true;
          await putQueuedPhoto(entry);
        }
        await retry(()=>client.rpc("cosme_library_finish",{
          p_id:entry.reservation.id
        }).then(check));
        entry.ready=true;
        await putQueuedPhoto(entry);
      }
      if(!entry.metadataSaved){
        const cameraData={...entry.exif,
          capture_source:captureTimestamp(entry.exif).source,optimized:!!entry.optimized,
          batch_id:queued.id,batch_index:entry.index+1,batch_total:queued.total,
          batch_description:settings.note,original_last_modified:entry.lastModified};
        try{
          await retry(()=>client.rpc("cosme_library_photo_capture",{
            p_id:entry.reservation.id,p_expected_revision:entry.reservation.revision,
            p_metadata:cameraData,p_source:"web"
          }).then(check),2);
          entry.metadataSaved=true;
        }catch(err){
          if(!(await verifySaved(entry))) {
            entry.lastError="Metadata still needs saving";
            await putQueuedPhoto(entry);
            return;
          }
        }
        entry.done=true;entry.lastError="";
        delete entry.original;delete entry.prepared;
        await putQueuedPhoto(entry);
      }
    }
    async function runUpload(){
      if(running)return;
      const runStartedAt=Date.now();
      running=true;busy=true;stopRequested=false;active=0;failedCount=0;errors=[];
      document.body.dataset.cosmePhotoUploading="true";
      run.disabled=true;files.disabled=true;fieldControls.forEach(control=>control.disabled=true);
      cancel.textContent="Stop remaining";cancel.disabled=false;
      run.textContent="Uploading…";
      try{
        // Complete local photo/voice-note persistence before starting network uploads.
        await draftWrite;
        if(!queued||queued.state==="draft"&&!queued.total){
          const oldDraft=queued?.state==="draft"?queued:null;
          const session=await client.auth.getUser();
          const owner=session.data?.user?.id;
          if(session.error||!owner)throw Error("Sign in to save photos");
          if(!files.files.length)throw Error("Choose photos to upload");
          countLine.textContent="Saving selected photos on this device…";
          const createdQueue=await createQueuedBatch({
            owner,snapshot:snapshot(),files:[...files.files],savedItems:items
          });
          if(!createdQueue.batch){
            countLine.textContent=createdQueue.skipped+" photo(s) already saved";
            return;
          }
          queued=createdQueue.batch;
          if(oldDraft&&oldDraft.id!==queued.id)
            await deleteBatch(oldDraft.id).catch(()=>{});
          // Originals are now retained in IndexedDB, not tied to the picker.
          files.value="";
        }
        if(queued.state==="draft"){
          queued.snapshot=snapshot();
          await putBatch(queued);
        }
        entries=await listQueuedPhotos(queued.id);
        if(!entries.length)throw Error("This photo queue is empty");
        queued.state="running";
        await putBatch(queued);
        showProgress();
        // Always reuse the same reservation when a transfer is retried.
        const work=entries.filter(e=>!e.ready||!e.metadataSaved);
        let next=0;
        const preparation={current:Promise.resolve()};
        const workers=Array.from({length:Math.min(4,work.length)},async()=>{
          while(next<work.length&&!stopRequested){
            if(!navigator.onLine){stopRequested=true;break;}
            const entry=work[next++];
            active++;showProgress();
            try{
              // Serial photo decoding limits peak memory usage on iPhones,
              // while prepared files can transfer in parallel.
              const previous=preparation.current;
              let release;
              preparation.current=new Promise(resolve=>{release=resolve;});
              await previous;
              if(!entry.prepared&&!entry.ready){
                try {
                  const source=new File([entry.original],entry.originalName,{
                    type:entry.original.type||"image/jpeg",lastModified:entry.lastModified
                  });
                  const prep=await prepareLibraryImage(source);
                  entry.prepared=prep.file;entry.exif=prep.metadata;
                  entry.optimized=prep.optimized;entry.storedBytes=prep.file.size;
                  delete entry.original;
                  await putQueuedPhoto(entry);
                }finally{release();}
              }else release();
              await saveOne(entry);
            }catch(err){
              failedCount++;entry.lastError=err?.message||"Transfer failed";
              errors.push(entry.originalName+": "+entry.lastError);
              await putQueuedPhoto(entry).catch(()=>{});
            }finally{active--;showProgress();}
          }
        });
        await Promise.all(workers);
        const count=queueCounts(entries);
        if(count.waiting){
          queued.state="paused";
          await putBatch(queued);
          showProgress();
          const elapsed=Math.round((Date.now()-runStartedAt)/1000);
          const text=count.saved+" of "+queued.total+" photos saved · "+count.waiting+
            " to resume · "+(elapsed<60?elapsed+"s":Math.floor(elapsed/60)+"m "+String(elapsed%60).padStart(2,"0")+"s");
          status(text,failedCount>0);
          if(!navigator.onLine)errorLine.textContent="Offline. Resume when connected.";
          else if(stopRequested)errorLine.textContent="Paused. Your remaining photos are saved on this device.";
        }else{
          queued.state="complete";
          await deleteBatch(queued.id);
          const elapsed=Math.round((Date.now()-runStartedAt)/1000);
          const summary=count.saved+" photos saved"+
            (queued.skipped?" · "+queued.skipped+" duplicates skipped":"")+
            " · "+(elapsed<60?elapsed+"s":Math.floor(elapsed/60)+"m "+String(elapsed%60).padStart(2,"0")+"s");
          queued=null;entries=[];
          form.remove();busy=false;
          await load();
          status(summary);
        }
      }catch(err){
        const message=err?.message||"Could not save upload";
        errorLine.textContent=message;
        if(queued){
          queued.state="paused";
          await putBatch(queued).catch(()=>{});
        }
        status(message,true);
      }finally{
        running=false;busy=false;
        delete document.body.dataset.cosmePhotoUploading;
        if(form.isConnected)updateButtons();
      }
    }
    form.addEventListener("submit",e=>{e.preventDefault();runUpload().catch(err=>status(err.message,true));});
    if(resumeId){
      try{
        const session=await client.auth.getUser();
        queued=await getBatch(resumeId);
        if(!queued||queued.owner!==session.data?.user?.id)
          throw Error("Saved upload no longer available for this account");
        entries=await listQueuedPhotos(queued.id);
        files.required=!queued.total;
        files.disabled=queued.state!=="draft";
        setSnapshot(queued.snapshot);
        countLine.textContent=queued.total?
          entries.length+" photos recovered · saved on this device":
          "Draft description restored";
        if(queued.state==="draft")draftState.textContent="Draft restored";
        if(queued.state!=="draft")showProgress();
        updateButtons();
        // Drafts are never uploaded automatically on iPhone app reopen.
      }catch(err){
        errorLine.textContent=err.message||"Cannot recover upload";
        run.disabled=true;
      }
    }else files.focus();
  }
  function photoTile(item,container){
    const tile=add(container,"div","library-tile");
    const photo=add(tile,"button","library-tile-open");photo.type="button";
    photo.setAttribute("aria-label",(selectMode?"Select ":"Open ")+item.title);
    const img=add(photo,"img");img.alt="";img.loading="lazy";
    const epochAtRequest=epoch;
    let fallbackUsed=false;
    const originalThumbnail=()=>{
      if(fallbackUsed)return;
      fallbackUsed=true;
      client.storage.from(LIBRARY_BUCKET).createSignedUrl(item.object_path,60)
        .then(({data,error})=>{if(epoch===epochAtRequest&&img.isConnected&&!error&&data?.signedUrl)img.src=data.signedUrl})
        .catch(()=>{});
    };
    img.addEventListener("error",originalThumbnail);
    const getThumbnail=()=>{
      client.storage.from(LIBRARY_BUCKET).createSignedUrl(item.object_path,60,{
        transform:{width:320,height:320,resize:"cover",quality:70}
      }).then(({data,error})=>{
        if(epoch!==epochAtRequest||!img.isConnected)return;
        if(error||!data?.signedUrl)originalThumbnail();
        else img.src=data.signedUrl;
      }).catch(originalThumbnail);
    };
    // Generate private signed URLs only as tiles approach the viewport.
    if(typeof IntersectionObserver==="function"){
      const observer=new IntersectionObserver(entries=>{
        if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();getThumbnail()}
      },{rootMargin:"250px"});
      observer.observe(img);
    }else getThumbnail();
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
    if(canEdit&&!selectMode&&!viewTrash){
      const star=add(tile,"button","library-tile-fav"+(item.is_favourite?" is-favourite":""),item.is_favourite?"♥":"♡");
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
  function photoListItem(item,container){
    const row=add(container,"div","library-photo-row");
    photoTile(item,row);
    const openOrSelect=()=>{
      if(selectMode){
        if(selectedIds.has(item.id))selectedIds.delete(item.id);else selectedIds.add(item.id);
        draw();
      }else openFile(item);
    };
    const detail=add(row,"button","library-photo-row-detail");
    detail.type="button";
    detail.setAttribute("aria-label",(selectMode?"Select ":"Open ")+item.title);
    add(detail,"span","library-row-title",item.title);
    add(detail,"span","library-row-context",[
      item.project,item.location||item.activity
    ].filter(Boolean).join(" · "));
    if(item.captured_at){
      const date=new Date(item.captured_at).toLocaleDateString(undefined,{
        day:"numeric",month:"short",year:"numeric"
      });
      add(detail,"span","library-row-facts",date);
    }
    detail.addEventListener("click",openOrSelect);
    if(item.caption){
      const description=add(row,"button","library-row-caption",item.caption);
      description.type="button";
      description.setAttribute("aria-label",(selectMode?"Select ":"Read details for ")+item.title);
      description.addEventListener("click",openOrSelect);
    }
    if(selectedIds.has(item.id))row.classList.add("is-selected");
  }
  function photoTrashItem(item,container){
    const row=add(container,"div","library-trash-row");
    const symbol=add(row,"span","library-trash-symbol","▧");
    symbol.setAttribute("aria-hidden","true");
    const info=add(row,"div","library-trash-info");
    add(info,"span","library-row-title",item.title);
    add(info,"span","library-row-context",[item.project,item.location].filter(Boolean).join(" · "));
    if(item.deleted_at)add(info,"span","library-row-facts",
      "Moved to Trash "+new Date(item.deleted_at).toLocaleDateString());
    if(canEdit){
      const restore=button(row,"Restore",()=>photoAction([item.id],"restore"));
      restore.classList.add("library-restore-button");
    }
  }
  function drawPhotos(){
    releasePhotoMap();
    root.replaceChildren();
    const header=add(root,"div","library-gallery-header");
    const identity=add(header,"div","library-gallery-identity");
    add(identity,"h3","","Project photos");
    const activeItems=viewTrash?trashItems:items;
    add(identity,"span","library-photo-count",activeItems.length+" photo"+(activeItems.length===1?"":"s")+(viewTrash?" in Trash":""));
    const actions=add(header,"div","library-gallery-actions");
    if(canEdit&&!viewTrash){
      if(recovery && (recovery.waiting||recovery.state==="draft")){
        const label=recovery.state==="draft"?
          "Continue draft"+(recovery.total?" · "+recovery.total:""):
          "Resume "+recovery.waiting+" photos";
        const resume=button(actions,label,()=>batchUpload(recovery.id));
        resume.classList.add("primary","library-resume-photos");
      }
      const upload=button(actions,"Add photos",()=>batchUpload());
      upload.classList.add("primary","library-add-photos");
    }
    if(canEdit&&!viewTrash){
      const selecting=button(actions,selectMode?"Done":"Select",()=>{
        selectMode=!selectMode;selectedIds.clear();draw();
      });
      selecting.classList.add("library-select-toggle");
      selecting.setAttribute("aria-pressed",String(selectMode));
    }
    const more=add(actions,"details","library-more-menu");
    const moreSummary=add(more,"summary","","•••");
    moreSummary.setAttribute("aria-label","More photo actions");
    const menu=add(more,"div","library-more-menu-items");
    if(canEdit&&!viewTrash)button(menu,"New folder",()=>{more.open=false;folderForm()});
    if(canEdit)button(menu,viewTrash?"Back to library":"Trash",()=>{
      more.open=false;viewTrash=!viewTrash;favoritesOnly=false;selectMode=false;
      selectedIds.clear();page=0;draw();
    });
    button(menu,"Refresh",()=>{more.open=false;if(!busy)load()});
    const notice=add(root,"p","metrics-small-note",message);
    notice.hidden=!message;notice.dataset.libraryStatus="";notice.setAttribute("role",failed?"alert":"status");
    const toolbar=add(root,"div","library-gallery-toolbar");
    const scopes=add(toolbar,"div","library-gallery-scopes");
    const all=button(scopes,"All",()=>{favoritesOnly=false;page=0;draw()});
    all.classList.add("library-filter-pill");all.setAttribute("aria-pressed",String(!favoritesOnly));
    if(!viewTrash){
      const fav=button(scopes,"Favourites",()=>{favoritesOnly=true;page=0;draw()});
      fav.classList.add("library-filter-pill");fav.setAttribute("aria-pressed",String(favoritesOnly));
    }
    const category=add(toolbar,"div","library-gallery-category");
    select(category,"Activity",[
      ["","All activities"],
      ...[...new Set(items.map(i=>i.project).filter(Boolean))].sort().map(v=>[v,v])
    ],filters.project,value=>{filters.project=value;page=0;draw()});
    if(!viewTrash){
      const viewSwitch=add(toolbar,"div","library-gallery-view-toggle");
      viewSwitch.setAttribute("role","group");viewSwitch.setAttribute("aria-label","Photo display mode");
      for(const [mode,name] of [["grid","Grid"],["list","List"],["map","Map"]]){
        const control=button(viewSwitch,name,()=>{photoView=mode;draw()});
        control.classList.add("library-view-button");
        control.setAttribute("aria-pressed",String(photoView===mode));
        control.title=name+" view";
      }
    }
    const extra=add(root,"div","library-gallery-extras");
    const quick=add(extra,"div","library-gallery-quick");
    const searchToggle=button(quick,photoSearchOpen?"Hide search":"Search",()=>{
      photoSearchOpen=!photoSearchOpen;draw();
    });
    searchToggle.setAttribute("aria-expanded",String(photoSearchOpen));
    const activeFilters=Object.entries(filters).filter(([k,v])=>k!=="search"&&v).length;
    const advanced=add(extra,"details","library-gallery-advanced");
    const summary=add(advanced,"summary","","Filters"+(activeFilters?" · "+activeFilters:""));
    advanced.open=filtersOpen;
    advanced.addEventListener("toggle",()=>{filtersOpen=advanced.open});
    const moreFilters=add(advanced,"div","library-filters");
    const change=key=>value=>{filters[key]=value;page=0;draw()};
    select(moreFilters,"Folder",[["","All folders"],...folders.map(f=>[f.id,f.name])],filters.folder,change("folder"));
    for(const [key,label] of [["prototype","Prototype"],["location","Location"],["activity","Detail activity"],["asset","Asset"]]){
      const values=[...new Set(items.map(i=>i[key]).filter(Boolean))].sort();
      select(moreFilters,label,[["","All"],...values.map(v=>[v,v])],filters[key],change(key));
    }
    for(const [key,label] of [["from","From"],["to","To"]]){
      const control=add(moreFilters,"label","",label),date=add(control,"input");
      date.type="date";date.value=filters[key]||"";
      date.addEventListener("change",()=>change(key)(date.value));
    }
    button(moreFilters,"Clear filters",()=>{
      filters={};favoritesOnly=false;filtersOpen=false;page=0;draw();
    });
    if(photoSearchOpen){
      const searchWrap=add(root,"label","library-gallery-search");
      const search=add(searchWrap,"input");
      search.type="search";search.setAttribute("aria-label","Search project photos");
      search.placeholder="Search photos, locations or assets";
      search.value=filters.search||"";
      search.addEventListener("change",()=>{filters.search=search.value;page=0;draw()});
      search.focus();
    }
    if(canEdit&&selectedIds.size){
      const chosen=add(root,"div","library-selection-bar");
      add(chosen,"span","library-selection-count",selectedIds.size+" selected");
      if(viewTrash)button(chosen,"Restore",()=>photoAction([...selectedIds],"restore"));
      else{
        button(chosen,"Favourite",()=>photoAction([...selectedIds],"favourite"));
        button(chosen,"Unfavourite",()=>photoAction([...selectedIds],"unfavourite"));
        const trash=button(chosen,"Move to Trash",()=>photoAction([...selectedIds],"trash"));
        trash.classList.add("library-danger-action");
      }
    }
    const visible=filterLibrary(activeItems,filters).filter(i=>!favoritesOnly||i.is_favourite);
    page=Math.min(page,Math.max(0,Math.ceil(visible.length/pageSize)-1));
    if(filters.project||filters.search||activeFilters||favoritesOnly){
      const count=add(root,"div","library-results-line");
      add(count,"span","",visible.length+" shown"+(!canEdit?" · Read only":""));
      const reset=button(count,"Clear filters",()=>{
        filters={};favoritesOnly=false;page=0;draw();
      });reset.classList.add("library-reset-filters");
    }
    const mapMode=!viewTrash&&photoView==="map";
    const gallery=add(root,"div",viewTrash?"library-photo-trash-list":mapMode?
      "library-photo-map-host":photoView==="grid"?"library-photo-grid":"library-photo-list");
    gallery.setAttribute("aria-label",viewTrash?"Trashed photos":mapMode?
      "Photo locations map":photoView==="grid"?"Photo thumbnails":"Photo list");
    if(mapMode){
      const ticket=mapTicket;
      import("./cosme_photo_map.mjs?v=2").then(async module=>{
        if(ticket!==mapTicket||!gallery.isConnected)return;
        const rendered=await module.createPhotoMap({
          client,host:gallery,photos:visible,bucket:LIBRARY_BUCKET,
          initialView:mapState,onViewChange:view=>{if(ticket===mapTicket)mapState=view;},
          onOpen:item=>openFile(item)
        });
        if(ticket!==mapTicket||!gallery.isConnected)rendered.destroy();
        else mapRenderer=rendered;
      }).catch(()=>{
        if(ticket===mapTicket&&gallery.isConnected)
          add(gallery,"p","library-map-empty","Map unavailable");
      });
    }else{
      const slice=visible.slice(page*pageSize,(page+1)*pageSize);
      for(const item of slice){
        if(viewTrash)photoTrashItem(item,gallery);
        else if(photoView==="grid")photoTile(item,gallery);
        else photoListItem(item,gallery);
      }
    }
    if(!visible.length&&!mapMode)add(gallery,"p","library-gallery-empty",
      viewTrash?"Trash is empty":items.length?"No matching photos":"No project photos uploaded yet");
    if(!mapMode&&visible.length>pageSize){
      const pagination=add(root,"div","library-gallery-pagination");
      button(pagination,"Previous",()=>{page--;draw()}).disabled=page===0;
      add(pagination,"span","",`Page ${page+1} of ${Math.ceil(visible.length/pageSize)}`);
      button(pagination,"Next",()=>{page++;draw()}).disabled=(page+1)*pageSize>=visible.length;
    }
  }
  function draw(){
    if(busy)return;
    if(kind==="photos"){drawPhotos();return}
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
  return {load,clear,hasActiveInteraction,refreshMap:()=>mapRenderer?.refresh?.()};
}
