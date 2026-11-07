import test from "node:test";
import assert from "node:assert/strict";
import {
  createPhotoViewer,createPhotoImageCache,createCaptionDrafts,boundedPhotoSave
} from "../assets/js/cosme_photo_viewer.mjs";

class FakeNode {
  constructor(tag) {
    this.tag=tag;this.children=[];this.events={};this.attrs={};
    this.className="";this.textContent="";this.style={};
    this.isConnected=true;this.open=false;this.hidden=false;this.disabled=false;
    this.classList={
      add:(...names)=>{for(const n of names)if(!this.className.split(" ").includes(n))
        this.className=(this.className+" "+n).trim()},
      remove:n=>{this.className=this.className.split(" ").filter(x=>x!==n).join(" ")},
      toggle:(n,v)=>v?this.classList.add(n):this.classList.remove(n)
    };
  }
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);node.isConnected=true}}
  replaceChildren(...nodes){this.children.forEach(n=>n.isConnected=false);this.children=[];this.append(...nodes)}
  addEventListener(type,callback){(this.events[type]??=[]).push(callback)}
  setAttribute(name,value){this.attrs[name]=value}
  async fire(type,detail={}){
    for(const cb of this.events[type]||[])await cb({
      target:this,cancelable:true,preventDefault(){},stopImmediatePropagation(){},...detail
    });
  }
  remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this)}
  showModal(){this.open=true}
  close(){this.open=false;this.events.close?.forEach(fn=>fn())}
  focus(){}
  closest(){return null}
}
const walk=n=>[n,...n.children.flatMap(walk)];
const tick=async()=>{for(let i=0;i<16;i++)await Promise.resolve()};
class FakeImage {
  set src(url){this._src=url;this.complete=true;this.naturalWidth=1000;queueMicrotask(()=>this.onload?.())}
}
function setup(rpcMode="fail"){
  const prevDoc=globalThis.document,prevImage=globalThis.Image;
  const document={
    createElement:tag=>new FakeNode(tag),
    documentElement:new FakeNode("html"),body:new FakeNode("body")
  };
  globalThis.document=document;globalThis.Image=FakeImage;
  const storage=new Map(),drafts=createCaptionDrafts({
    getItem:k=>storage.get(k)??null,
    setItem:(k,v)=>storage.set(k,v),
    removeItem:k=>storage.delete(k)
  });
  const photos=[
    {id:"a",title:"Mkwiro A",caption:"",object_path:"private/a",revision:1},
    {id:"b",title:"Mkwiro B",caption:"",object_path:"private/b",revision:1}
  ];
  const patchCalls=[];
  const client={
    storage:{from:()=>({createSignedUrl:async key=>({data:{signedUrl:"https://example.invalid/"+key}})})},
    rpc:(name,args)=>{
      if(name==="cosme_library_photo_patch"){
        patchCalls.push(args);
        if(rpcMode==="fail")return Promise.reject(new TypeError("Load failed"));
        if(rpcMode==="hang")return{
          abortSignal(signal){
            return new Promise((_,reject)=>{
              signal.addEventListener("abort",()=>reject(Error("aborted")),{once:true});
            });
          }
        };
        return Promise.resolve({data:{...photos[0],caption:args.p_changes.caption,revision:2}});
      }
      if(name==="cosme_library_photo_action")return Promise.resolve({data:{}});
      throw Error("Unexpected RPC: "+name);
    }
  };
  const root=new FakeNode("main");
  const imageCache=createPhotoImageCache(client,"private");
  const open=(photo=photos[0])=>createPhotoViewer({
    client,root,bucket:"private",photo,photos,canEdit:true,imageCache,drafts
  });
  const cleanup=()=>{
    if(prevDoc===undefined)delete globalThis.document;else globalThis.document=prevDoc;
    if(prevImage===undefined)delete globalThis.Image;else globalThis.Image=prevImage;
  };
  const byLabel=(viewer,label)=>walk(viewer).find(n=>n.attrs["aria-label"]===label);
  const caption=viewer=>walk(viewer).find(n=>n.className==="library-viewer-caption");
  const title=viewer=>walk(viewer).find(n=>n.className==="library-photo-viewer-title");
  return {open,cleanup,byLabel,caption,title,storage,drafts,patchCalls,document};
}

test("mobile load failure releases buttons, retains caption and permits closing",async()=>{
  const app=setup("fail");
  try{
    const session=app.open(),viewer=session.viewer;
    await tick();
    assert.equal(app.document.body.style.overflow,"hidden");
    await app.byLabel(viewer,"Edit photo description").fire("click");
    const p=app.caption(viewer);
    p.textContent="Off bottom Mkwiro.";
    await p.fire("input");
    await app.byLabel(viewer,"Save description").fire("click");
    await tick();
    assert.match(walk(viewer).find(n=>n.className==="library-photo-viewer-feedback").textContent,/Not saved/);
    assert.equal(app.byLabel(viewer,"Save description").disabled,false);
    assert.equal(app.drafts.get("a"),"Off bottom Mkwiro.");
    await session.close();
    assert.equal(viewer.open,false);
    assert.equal(app.document.body.style.overflow,"");
    const reopened=app.open().viewer;
    await tick();
    assert.equal(app.caption(reopened).textContent,"Off bottom Mkwiro.");
    assert.ok(reopened.className.includes("is-editing"));
    reopened.close();
  }finally{app.cleanup()}
});

test("swipe anywhere on card, including caption and footer, without moving underlying page",async()=>{
  const app=setup("success");
  try{
    const v=app.open().viewer;await tick();
    async function swipe(target,dx,dy){
      await v.fire("touchstart",{target,touches:[{clientX:280,clientY:440}]});
      await v.fire("touchmove",{target,cancelable:true,touches:[{clientX:280+dx,clientY:440+dy}]});
      await v.fire("touchend",{target,changedTouches:[{clientX:280+dx,clientY:440+dy}]});
      await tick();
    }
    await swipe(app.caption(v),-135,6);
    assert.equal(app.title(v).textContent,"Mkwiro B");
    const footer=walk(v).find(n=>n.className==="library-photo-viewer-footer");
    await swipe(footer,125,8);
    assert.equal(app.title(v).textContent,"Mkwiro A");
    await swipe(app.caption(v),-5,110);
    assert.equal(app.title(v).textContent,"Mkwiro A","vertical scroll must not navigate");
    v.close();
  }finally{app.cleanup()}
});

test("hanging caption request does not trap the close button",async()=>{
  const app=setup("hang");
  try{
    const session=app.open(),v=session.viewer;await tick();
    await app.byLabel(v,"Edit photo description").fire("click");
    const p=app.caption(v);p.textContent="Important field note";
    await p.fire("input");
    await app.byLabel(v,"Save description").fire("click");
    await tick();
    assert.equal(app.byLabel(v,"Save description").disabled,true);
    await session.close();await tick();
    assert.equal(v.open,false);
    assert.equal(app.drafts.get("a"),"Important field note");
  }finally{app.cleanup()}
});

test("network request timeout is finite",async()=>{
  await assert.rejects(boundedPhotoSave(()=>new Promise(()=>{}),20),/Connection timed out/);
});

test("viewer reuses loaded original with no additional signing or download",async()=>{
  const app=setup("success");
  try{
    let loads=0;
    const cache={load:()=>{loads++;return Promise.reject(Error("Unexpected request"))}};
    const photos=[{id:"a",title:"Mkwiro A",caption:"",object_path:"private/a",revision:1}];
    const root=new FakeNode("main");
    const v=createPhotoViewer({client:{},root,bucket:"private",photo:photos[0],photos,
      imageCache:cache,thumbnailFor:()=> "https://example.invalid/original"});
    const img=walk(v.viewer).find(n=>n.tag==="img");
    assert.equal(img.src,"https://example.invalid/original");
    assert.equal(loads,0);
    const content=v.viewer.children.find(n=>n.className==="library-viewer-content");
    assert.equal(content.className,"library-viewer-content");
    v.close();
  }finally{app.cleanup()}
});

test("an expired gallery image URL fetches a fresh signature on image error",async()=>{
  const app=setup("success");
  try{
    let loads=0;
    const cache={load:async()=>{loads++;return {url:"https://example.invalid/fresh"}}};
    const photos=[{id:"a",title:"Mkwiro A",caption:"",object_path:"private/a",revision:1}];
    const root=new FakeNode("main");
    const v=createPhotoViewer({client:{},root,bucket:"private",photo:photos[0],photos,
      imageCache:cache,thumbnailFor:()=> "https://example.invalid/expired"});
    const img=walk(v.viewer).find(n=>n.tag==="img");
    assert.equal(loads,0);
    await img.fire("error");await tick();
    assert.equal(loads,1);
    assert.equal(img.src,"https://example.invalid/fresh");
    v.close();
  }finally{app.cleanup()}
});

test("favourite button updates status and Trash requires confirmation",async()=>{
  const app=setup("success");
  const oldConfirm=globalThis.confirm;
  try{
    let confirmed=false;
    const current={id:"a",title:"Mkwiro A",caption:"",object_path:"private/a",revision:1,is_favourite:false};
    const rpcCalls=[],favourites=[],trashed=[];
    const client={
      rpc:async(name,args)=>{
        rpcCalls.push({name,args});
        return {data:{updated:1}};
      }
    };
    const root=new FakeNode("main");
    const photos=[current];
    const v=createPhotoViewer({client,root,bucket:"private",photo:current,photos,
      canEdit:true,imageCache:{load:async()=>({url:"https://example.invalid/a"})},
      thumbnailFor:()=>"https://example.invalid/a",
      onFavourite:item=>favourites.push(item.is_favourite),
      onTrash:item=>trashed.push(item.id)});
    assert.ok(app.byLabel(v.viewer,"Favourite photo"));
    assert.ok(app.byLabel(v.viewer,"Move photo to Trash"));
    await app.byLabel(v.viewer,"Favourite photo").fire("click");
    await tick();
    assert.equal(current.is_favourite,true);
    assert.deepEqual(favourites,[true]);
    assert.equal(app.byLabel(v.viewer,"Remove favourite").attrs["aria-pressed"],"true");
    globalThis.confirm=()=>false;
    await app.byLabel(v.viewer,"Move photo to Trash").fire("click");
    await tick();
    assert.equal(rpcCalls.filter(x=>x.args.p_action==="trash").length,0);
    assert.equal(v.viewer.open,true);
    globalThis.confirm=()=>{confirmed=true;return true};
    await app.byLabel(v.viewer,"Move photo to Trash").fire("click");
    await tick();
    assert.equal(confirmed,true);
    assert.equal(rpcCalls.filter(x=>x.args.p_action==="trash").length,1);
    assert.deepEqual(trashed,["a"]);
    assert.equal(v.viewer.open,false);
  }finally{
    if(oldConfirm===undefined)delete globalThis.confirm;
    else globalThis.confirm=oldConfirm;
    app.cleanup();
  }
});
