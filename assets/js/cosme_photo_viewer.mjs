// COSME photo viewer: one persistent dialog, native-feeling swipes, in-place captions.
const el=(tag,cls="",value)=>{
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(value!==undefined)n.textContent=value;
  return n;
};
function add(parent,tag,cls="",value){
  const node=el(tag,cls,value);parent.append(node);return node;
}
function icon(parent,symbol,label,action){
  const button=add(parent,"button","library-photo-icon-button",symbol);
  button.type="button";button.title=label;
  button.setAttribute("aria-label",label);
  button.addEventListener("click",action);
  return button;
}
function result(response){
  if(response.error)throw response.error;
  return response.data;
}
export function swipeDirection(dx,dy,elapsed){
  if(Math.abs(dx)<52||Math.abs(dx)<=Math.abs(dy)*1.4||elapsed>1100)return 0;
  return dx<0?1:-1;
}
// A modest 5-image decoded cache, scoped to the user's currently signed-in
// COSME library instance. These URLs remain private and expire after 60 seconds.
export function createPhotoImageCache(client,bucket){
  const cached=new Map();
  function load(item){
    const key=item.object_path,now=Date.now();
    const old=cached.get(key);
    if(old&&old.expires>now){
      cached.delete(key);cached.set(key,old);
      return old.promise;
    }
    if(old)cached.delete(key);
    const entry={expires:now+45000,promise:null};
    entry.promise=client.storage.from(bucket).createSignedUrl(key,60)
      .then(({data,error})=>{
        if(error||!data?.signedUrl)throw error||Error("Photo unavailable");
        return new Promise((resolve,reject)=>{
          const preloaded=new Image();
          preloaded.onload=()=>resolve({url:data.signedUrl,preloaded});
          preloaded.onerror=()=>reject(Error("Photo could not be loaded"));
          preloaded.src=data.signedUrl;
          if(preloaded.complete&&preloaded.naturalWidth>0)
            resolve({url:data.signedUrl,preloaded});
        });
      }).catch(err=>{
        if(cached.get(key)===entry)cached.delete(key);
        throw err;
      });
    cached.set(key,entry);
    while(cached.size>5)cached.delete(cached.keys().next().value);
    return entry.promise;
  }
  return {load,clear:()=>cached.clear()};
}
export function createPhotoViewer({
  client,root,bucket,photo,photos,canEdit=false,imageCache,
  onChange=()=>{},onEditMetadata=()=>{},onDownload=()=>{}
}){
  const sequence=photos.some(p=>p.id===photo.id)?photos.slice():[photo,...photos];
  let index=sequence.findIndex(p=>p.id===photo.id);
  let current=sequence[index],editing=false,saving=false,dirty=false,requestId=0;
  let currentCaption=null;
  const viewer=add(root,"dialog","library-viewer library-photo-viewer");
  viewer.setAttribute("aria-label",current.title);
  const top=add(viewer,"div","library-photo-viewer-top");
  const title=add(top,"h3","library-photo-viewer-title");
  const nav=add(top,"div","library-photo-viewer-navigation");
  const previous=icon(nav,"‹","Previous photo",()=>navigate(-1));
  const next=icon(nav,"›","Next photo",()=>navigate(1));
  const close=icon(nav,"×","Close photo",()=>requestClose());
  close.classList.add("library-photo-close");
  const content=add(viewer,"div","library-viewer-content");
  const image=add(content,"img");image.alt="";image.loading="eager";
  const details=add(viewer,"div","library-viewer-meta");
  const footer=add(viewer,"div","library-photo-viewer-footer");
  const feedback=add(footer,"span","library-photo-viewer-feedback");
  feedback.setAttribute("role","status");
  icon(footer,"↓","Download photo",()=>onDownload(current));
  let favourite=null,pencil=null,cancel=null;
  if(canEdit){
    favourite=icon(footer,"♡","Favourite photo",toggleFavourite);
    pencil=icon(footer,"✎","Edit photo description",toggleEdit);
    cancel=icon(footer,"×","Cancel description edit",cancelEdit);
    cancel.hidden=true;
    icon(footer,"⋯","Edit other photo details",()=>editMetadata());
  }
  function textValue(){
    return String(currentCaption?.innerText??currentCaption?.textContent??"")
      .replace(/\r/g,"").trim().slice(0,1000);
  }
  function changedCaption(){return editing&&textValue()!==(current.caption||"")}
  function setEditing(on){
    editing=on;viewer.classList.toggle("is-editing",on);
    if(!currentCaption)return;
    currentCaption.contentEditable=on?"plaintext-only":"false";
    currentCaption.setAttribute("aria-label","Photo description");
    currentCaption.setAttribute("role",on?"textbox":"paragraph");
    if(on){
      currentCaption.hidden=false;
      currentCaption.setAttribute("aria-multiline","true");
      pencil.textContent="✓";pencil.title="Save description";
      pencil.setAttribute("aria-label","Save description");
      cancel.hidden=false;
    }else{
      pencil.textContent="✎";pencil.title="Edit photo description";
      pencil.setAttribute("aria-label","Edit photo description");
      cancel.hidden=true;
      currentCaption.hidden=!current.caption;
    }
  }
  function cancelEdit(){
    if(!editing||saving)return;
    currentCaption.textContent=current.caption||"";
    setEditing(false);feedback.textContent="";
  }
  async function saveEdit(){
    if(!editing)return true;
    if(saving)return false;
    const caption=textValue();
    if(caption===(current.caption||"")){setEditing(false);return true}
    const photoToSave=current;
    saving=true;pencil.disabled=true;cancel.disabled=true;
    feedback.textContent="Saving…";
    try{
      const updated=result(await client.rpc("cosme_library_photo_patch",{
        p_id:photoToSave.id,p_expected_revision:photoToSave.revision,
        p_changes:{caption}
      }));
      Object.assign(photoToSave,updated);
      if(typeof photoToSave.caption!=="string")photoToSave.caption=caption;
      currentCaption.textContent=photoToSave.caption;
      dirty=true;feedback.textContent="Saved";
      setEditing(false);
      return true;
    }catch(err){
      feedback.textContent=err?.message||"Could not save. Try again.";
      return false;
    }finally{
      saving=false;pencil.disabled=false;cancel.disabled=false;
    }
  }
  function toggleEdit(){
    if(saving)return;
    if(editing){saveEdit();return}
    feedback.textContent="";setEditing(true);
    // Same caption paragraph, same order/position. No replacement editor card.
    currentCaption.focus();
  }
  function updateFavourite(){
    if(!favourite)return;
    favourite.textContent=current.is_favourite?"♥":"♡";
    favourite.title=current.is_favourite?"Remove favourite":"Favourite photo";
    favourite.setAttribute("aria-label",favourite.title);
    favourite.classList.toggle("is-favourite",!!current.is_favourite);
  }
  async function toggleFavourite(){
    if(saving||!canEdit)return;
    const target=current,action=target.is_favourite?"unfavourite":"favourite";
    favourite.disabled=true;
    try{
      result(await client.rpc("cosme_library_photo_action",{
        p_ids:[target.id],p_action:action
      }));
      target.is_favourite=action==="favourite";dirty=true;
      if(current===target)updateFavourite();
      feedback.textContent=target.is_favourite?"Favourite":"Removed favourite";
    }catch(err){feedback.textContent=err?.message||"Could not update favourite"}
    finally{favourite.disabled=false}
  }
  function renderMetadata(){
    details.replaceChildren();
    if(current.captured_at)
      add(details,"span","","Captured: "+new Date(current.captured_at).toLocaleString());
    if(current.location)add(details,"span","","Location: "+current.location);
    if(current.activity)add(details,"span","","Activity: "+current.activity);
    if(current.asset)add(details,"span","","Asset: "+current.asset);
    currentCaption=add(details,"p","library-viewer-caption",current.caption||"");
    currentCaption.hidden=!current.caption;
    currentCaption.setAttribute("aria-label","Photo description");
    const gps=current.photo_metadata?.gps;
    if(gps&&Number.isFinite(gps.latitude)&&Number.isFinite(gps.longitude)){
      const link=add(details,"a","","View capture location on map");
      link.href="https://maps.google.com/?q="+gps.latitude+","+gps.longitude;
      link.target="_blank";link.rel="noopener noreferrer";
    }
    if(current.photo_metadata?.datetime_original&&!current.captured_at)
      add(details,"span","","Camera time: "+current.photo_metadata.datetime_original+
        " (timezone not recorded)");
    if(canEdit){updateFavourite();setEditing(false)}
  }
  function preloadNeighbours(){
    for(const i of [index-1,index+1]){
      if(i>=0&&i<sequence.length)imageCache.load(sequence[i]).catch(()=>{});
    }
  }
  function show(newIndex){
    if(newIndex<0||newIndex>=sequence.length||!viewer.isConnected)return;
    index=newIndex;current=sequence[index];const ticket=++requestId;
    title.textContent=current.title;title.title=current.title;
    viewer.setAttribute("aria-label",current.title);
    previous.disabled=index===0;next.disabled=index===sequence.length-1;
    renderMetadata();feedback.textContent="";
    viewer.scrollTop=0;
    content.classList.add("is-photo-loading");
    image.alt=current.title;
    imageCache.load(current).then(({url})=>{
      if(!viewer.isConnected||ticket!==requestId)return;
      image.src=url;
      content.classList.remove("is-photo-loading");
      preloadNeighbours();
    }).catch(err=>{
      if(!viewer.isConnected||ticket!==requestId)return;
      content.classList.remove("is-photo-loading");
      feedback.textContent=err?.message||"Photo unavailable";
    });
  }
  async function navigate(delta){
    if(saving||index+delta<0||index+delta>=sequence.length)return;
    if(editing&&!(await saveEdit()))return;
    show(index+delta);
  }
  async function requestClose(){
    if(saving)return;
    if(editing&&!(await saveEdit()))return;
    viewer.close();
  }
  async function editMetadata(){
    if(saving)return;
    if(editing&&!(await saveEdit()))return;
    const target=current;editingAdvanced=true;
    viewer.close();onEditMetadata(target);
  }
  let editingAdvanced=false,touchStart=null;
  // Listen on the entire dialog, not only the image. A read-only caption has
  // contenteditable="false" and must NOT be treated as an editing control.
  const interactiveTouchTarget=target=>Boolean(
    target?.closest?.('button,a,input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]')
    ||target?.isContentEditable
  );
  viewer.addEventListener("touchstart",event=>{
    if(editing||saving||event.touches?.length!==1||interactiveTouchTarget(event.target)){
      touchStart=null;return;
    }
    const finger=event.touches[0];
    touchStart={x:finger.clientX,y:finger.clientY,at:Date.now(),horizontal:false};
  },{passive:true});
  viewer.addEventListener("touchmove",event=>{
    if(!touchStart||editing||saving||event.touches?.length!==1)return;
    const finger=event.touches[0];
    const dx=finger.clientX-touchStart.x,dy=finger.clientY-touchStart.y;
    // Only claim a clearly horizontal gesture. Keep vertical scrolling
    // (including long descriptions) and native text editing untouched.
    if(Math.abs(dx)>14&&Math.abs(dx)>Math.abs(dy)*1.35){
      touchStart.horizontal=true;
    }
    if(touchStart.horizontal&&event.cancelable)event.preventDefault();
  },{passive:false});
  viewer.addEventListener("touchend",event=>{
    if(!touchStart||editing||saving||!event.changedTouches?.length)return;
    const finger=event.changedTouches[0];
    const direction=swipeDirection(finger.clientX-touchStart.x,
      finger.clientY-touchStart.y,Date.now()-touchStart.at);
    touchStart=null;
    if(direction)navigate(direction);
  },{passive:true});
  viewer.addEventListener("touchcancel",()=>{touchStart=null},{passive:true});
  viewer.addEventListener("keydown",event=>{
    if(editing||saving||event.target?.isContentEditable)return;
    if(event.key==="ArrowRight"){event.preventDefault();navigate(1)}
    if(event.key==="ArrowLeft"){event.preventDefault();navigate(-1)}
  });
  viewer.addEventListener("click",event=>{
    if(event.target===viewer)requestClose();
  });
  viewer.addEventListener("cancel",event=>{
    if(editing||saving){event.preventDefault();requestClose()}
  });
  viewer.addEventListener("close",()=>{
    requestId++;viewer.remove();
    if(dirty&&!editingAdvanced)onChange();
  });
  viewer.showModal();show(index);
  return {viewer,navigate,close:requestClose};
}
