import {photosWithPositions,clusterPhotoPositions} from "./cosme_photo_map_core.mjs?v=1";

let leafletReady=null;
const THUMBNAIL_SECONDS=90;
function loadLeaflet(){
  if(window.L?.map)return Promise.resolve(window.L);
  if(leafletReady)return leafletReady;
  leafletReady=new Promise((resolve,reject)=>{
    if(!document.querySelector('link[data-cosme-map-style]')){
      const link=document.createElement("link");
      link.rel="stylesheet";
      link.href=new URL("./assets/vendor/leaflet/leaflet.css",document.baseURI).href;
      link.dataset.cosmeMapStyle="1";document.head.append(link);
    }
    const script=document.createElement("script");
    script.src=new URL("./assets/vendor/leaflet/leaflet.js",document.baseURI).href;
    script.async=true;
    script.onload=()=>window.L?.map?resolve(window.L):reject(Error("Map could not open"));
    script.onerror=()=>reject(Error("Map could not open"));
    document.head.append(script);
  }).catch(err=>{leafletReady=null;throw err});
  return leafletReady;
}
function el(tag,cls="",text){
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(text!==undefined)n.textContent=text;
  return n;
}
export async function createPhotoMap({client,host,photos,bucket,onOpen,initialView,onViewChange}){
  const {located,unmapped}=photosWithPositions(photos);
  const panel=el("div","library-map-wrap");
  const canvas=el("div","library-map-canvas");
  canvas.setAttribute("aria-label","Project photo locations");
  panel.append(canvas);
  const floating=el("div","library-map-floating");
  const count=el("span","library-map-count",located.length+" on map");
  floating.append(count);
  const gps=el("button","library-map-gps-filter","GPS only");
  gps.type="button";gps.setAttribute("aria-pressed","false");
  floating.append(gps);
  const fit=el("button","library-map-fit","⌗");
  fit.type="button";fit.title="Fit all photo locations";
  fit.setAttribute("aria-label","Fit photo locations");
  floating.append(fit);
  panel.append(floating);
  const sheet=el("div","library-map-sheet");
  sheet.hidden=true;panel.append(sheet);
  host.append(panel);
  if(!located.length){
    canvas.append(el("div","library-map-empty","No photos with a map location yet"));
    count.textContent="0 on map";
    gps.disabled=true;fit.disabled=true;
    return {destroy(){panel.remove()},getView(){return initialView||null}};
  }
  let L;
  try{L=await loadLeaflet()}catch(err){
    if(panel.isConnected)canvas.append(el("p","library-map-empty","Map unavailable"));
    return {destroy(){panel.remove()},getView(){return initialView||null}};
  }
  if(!panel.isConnected)return {destroy(){},getView(){return initialView||null}};
  const map=L.map(canvas,{zoomControl:false,scrollWheelZoom:true,
    attributionControl:true,preferCanvas:false,maxZoom:18,minZoom:3});
  L.control.zoom({position:"bottomright"}).addTo(map);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",{
    subdomains:"abcd",maxZoom:19,maxNativeZoom:19,
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
  }).addTo(map);
  const layer=L.layerGroup().addTo(map);
  let gpsOnly=false,closed=false,raf=0;
  const thumbCache=new Map();
  const signed=async item=>{
    const cached=thumbCache.get(item.id);
    if(cached&&cached.until>Date.now())return cached.url;
    const {data,error}=await client.storage.from(bucket).createSignedUrl(item.object_path,THUMBNAIL_SECONDS,{
      transform:{width:200,height:200,resize:"cover",quality:70}
    });
    if(error||!data?.signedUrl){
      const second=await client.storage.from(bucket).createSignedUrl(item.object_path,THUMBNAIL_SECONDS);
      if(second.error||!second.data?.signedUrl)throw Error("Photo preview unavailable");
      thumbCache.set(item.id,{url:second.data.signedUrl,until:Date.now()+75000});
      return second.data.signedUrl;
    }
    thumbCache.set(item.id,{url:data.signedUrl,until:Date.now()+75000});
    return data.signedUrl;
  };
  const loadImage=(img,item)=>{
    signed(item).then(url=>{if(!closed&&img.isConnected)img.src=url}).catch(()=>{});
    img.addEventListener("error",()=>{
      // If image transformations are not supported by the storage plan,
      // retry the original protected image once.
      if(img.dataset.retried)return;
      img.dataset.retried="1";
      client.storage.from(bucket).createSignedUrl(item.object_path,THUMBNAIL_SECONDS)
        .then(({data})=>{if(!closed&&img.isConnected&&data?.signedUrl)img.src=data.signedUrl})
        .catch(()=>{});
    });
  };
  const closeSheet=()=>{sheet.hidden=true;sheet.replaceChildren()};
  function showGroup(group){
    closeSheet();
    const header=el("div","library-map-sheet-head");
    header.append(el("strong","",group.photos.length+" photos"));
    const close=el("button","library-map-sheet-close","×");
    close.type="button";close.setAttribute("aria-label","Close photo group");
    close.addEventListener("click",closeSheet);header.append(close);
    sheet.append(header);
    const images=el("div","library-map-sheet-images");
    for(const p of group.photos){
      const entry=el("button","library-map-sheet-photo");
      entry.type="button";entry.title=p.item.title;
      const image=el("img");image.alt="";
      entry.append(image);
      entry.append(el("span","",p.item.title));
      entry.addEventListener("click",()=>{closeSheet();onOpen(p.item)});
      images.append(entry);loadImage(image,p.item);
    }
    sheet.append(images);sheet.hidden=false;
  }
  function fitToPhotos(){
    const shown=gpsOnly?located.filter(p=>p.source==="gps"):located;
    if(!shown.length)return;
    if(shown.length===1){map.setView([shown[0].lat,shown[0].lng],14);return}
    map.fitBounds(L.latLngBounds(shown.map(p=>[p.lat,p.lng])),{
      padding:[35,35],maxZoom:14,animate:false
    });
  }
  function paint(){
    if(closed)return;
    layer.clearLayers();
    const shown=gpsOnly?located.filter(p=>p.source==="gps"):located;
    count.textContent=shown.length+" on map"+(unmapped.length?" · "+unmapped.length+" unplaced":"");
    if(!shown.length){closeSheet();return}
    const groups=clusterPhotoPositions(shown,p=>map.latLngToContainerPoint([p.lat,p.lng]),92);
    for(const group of groups){
      const representative=group.photos[0].item;
      const face=el("div","library-map-pin"+(group.source==="site"?" is-site":""));
      const img=el("img");img.alt="";
      face.append(img);
      if(group.photos.length>1)face.append(el("span","library-map-pin-count",String(group.photos.length)));
      const icon=L.divIcon({html:face,className:"library-map-div-icon",
        iconSize:[70,80],iconAnchor:[35,78]});
      const marker=L.marker([group.lat,group.lng],{icon,title:group.photos.length===1?
        representative.title:group.photos.length+" photos",keyboard:true}).addTo(layer);
      marker.on("click",()=>{
        if(group.photos.length===1){onOpen(representative);return}
        if(map.getZoom()<16){closeSheet();map.flyTo([group.lat,group.lng],Math.min(16,map.getZoom()+2),{duration:.38})}
        else showGroup(group);
      });
      loadImage(img,representative);
    }
  }
  const schedule=()=>{
    if(raf||closed)return;
    raf=requestAnimationFrame(()=>{raf=0;paint()});
  };
  map.on("zoomend",()=>{
    closeSheet();
    onViewChange?.({lat:map.getCenter().lat,lng:map.getCenter().lng,zoom:map.getZoom()});
    schedule();
  });
  map.on("moveend",()=>{
    onViewChange?.({lat:map.getCenter().lat,lng:map.getCenter().lng,zoom:map.getZoom()});
    schedule();
  });
  gps.addEventListener("click",()=>{
    gpsOnly=!gpsOnly;gps.setAttribute("aria-pressed",String(gpsOnly));
    closeSheet();fitToPhotos();schedule();
  });
  fit.addEventListener("click",()=>{closeSheet();fitToPhotos();schedule()});
  if(initialView&&Number.isFinite(initialView.lat)&&Number.isFinite(initialView.lng)&&
    Number.isFinite(initialView.zoom)){
    map.setView([initialView.lat,initialView.lng],initialView.zoom,{animate:false});
  }else fitToPhotos();
  requestAnimationFrame(()=>{if(!closed){map.invalidateSize();paint()}});
  return {
    getView(){if(closed)return null;const center=map.getCenter();
      return {lat:center.lat,lng:center.lng,zoom:map.getZoom()};},
    destroy(){if(closed)return;closed=true;cancelAnimationFrame(raf);closeSheet();map.remove();panel.remove()}
  };
}
