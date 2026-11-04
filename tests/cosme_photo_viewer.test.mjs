import test from "node:test";
import assert from "node:assert/strict";
import {swipeDirection,createPhotoImageCache} from "../assets/js/cosme_photo_viewer.mjs";

test("quick horizontal thumb flicks navigate; scrolling and short drags do not",()=>{
  assert.equal(swipeDirection(-100,9,250),1);
  assert.equal(swipeDirection(95,-6,340),-1);
  assert.equal(swipeDirection(15,100,300),0);
  assert.equal(swipeDirection(-25,5,120),0);
  assert.equal(swipeDirection(-100,85,120),0);
  assert.equal(swipeDirection(-100,5,1500),0);
});

test("private signed photo previews prefetch once and retain a bounded decoded cache",async()=>{
  const previousImage=globalThis.Image;
  class FakeImage {
    complete=false;naturalWidth=0;onload=null;onerror=null;
    set src(url){
      this._src=url;this.naturalWidth=1200;this.complete=true;
      queueMicrotask(()=>this.onload?.());
    }
    get src(){return this._src}
  }
  globalThis.Image=FakeImage;
  const calls=[];
  const client={storage:{from:bucket=>{
    assert.equal(bucket,"cosme-project-library");
    return {createSignedUrl:async path=>{
      calls.push(path);
      return {data:{signedUrl:"https://private.example/signed/"+path}};
    }};
  }}};
  try{
    const cache=createPhotoImageCache(client,"cosme-project-library");
    const photos=Array.from({length:7},(_,i)=>({object_path:"photo/"+i}));
    const first=await cache.load(photos[0]);
    const again=await cache.load(photos[0]);
    assert.equal(first.url,again.url);
    assert.equal(calls.length,1);
    await Promise.all(photos.slice(1,5).map(p=>cache.load(p)));
    assert.equal(calls.length,5);
    await cache.load(photos[5]);
    await cache.load(photos[0]);
    assert.equal(calls.filter(path=>path==="photo/0").length,2,
      "oldest image was evicted from the bounded 5-image cache");
    cache.clear();
    await cache.load(photos[1]);
    assert.equal(calls.filter(path=>path==="photo/1").length,2);
  }finally{
    if(previousImage===undefined)delete globalThis.Image;
    else globalThis.Image=previousImage;
  }
});
