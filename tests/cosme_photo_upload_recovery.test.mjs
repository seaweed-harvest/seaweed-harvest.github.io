import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {photoFingerprint,selectNewPhotos,queueCounts} from '../assets/js/cosme_photo_upload_queue.mjs';

const src=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('duplicate photos already recorded on server are excluded after a restarted selection',()=>{
  const files=[
    {name:'IMG_0069.jpeg',size:4469624,lastModified:1},
    {name:'IMG_0200.jpeg',size:555123,lastModified:2},
    {name:'IMG_0200.jpeg',size:555123,lastModified:2}
  ];
  const saved=[{filename:'IMG_0069.jpg',byte_size:1004427,
    photo_metadata:{original_filename:'IMG_0069.jpeg',original_bytes:4469624}}];
  const result=selectNewPhotos(files,saved);
  assert.deepEqual(result.selected.map(x=>x.index),[1]);
  assert.equal(result.skipped,2);
  assert.equal(photoFingerprint('IMG_0069.JPEG',4469624),photoFingerprint('img_0069.jpeg',4469624));
});

test('recovery distinguishes stored photos and pending metadata without re-uploading images',()=>{
  const records=[
    {ready:true,metadataSaved:true},
    {ready:true,metadataSaved:false,uploaded:true},
    {ready:false,metadataSaved:false,uploaded:true},
    {ready:false,metadataSaved:false,uploaded:false}
  ];
  assert.deepEqual(queueCounts(records),{saved:2,complete:1,waiting:3,metadataPending:1});
  assert.deepEqual(queueCounts(records.slice(0,1)),{saved:1,complete:1,waiting:0,metadataPending:0});
});

test('original images are stored in IndexedDB before uploads begin',()=>{
  const queue=src('../assets/js/cosme_photo_upload_queue.mjs');
  const upload=src('../assets/js/cosme_project_library.mjs');
  assert.match(queue,/indexedDB\.open/);
  assert.match(queue,/store\.put\(photo\)/);
  assert.match(queue,/await putQueuedPhoto\(\{ key:/);
  assert.ok(queue.indexOf('await putQueuedPhoto({ key:') < queue.indexOf('await putBatch(batch)'));
  assert.match(upload,/await createQueuedBatch\(/);
  assert.match(upload,/entry\.uploaded=true/);
  assert.match(upload,/entry\.ready=true/);
  assert.match(upload,/entry\.metadataSaved=true/);
  assert.match(upload,/await putQueuedPhoto\(entry\)/);
  assert.match(upload,/if\(\(entry\.ready\|\|entry\.uploaded\) && await verifySaved\(entry\)\)return/);
});

test('completion can be retried against the same immutable reservation',()=>{
  const upload=src('../assets/js/cosme_project_library.mjs');
  assert.match(upload,/if\(!entry\.reservation\)\{/);
  assert.match(upload,/entry\.reservation=await retry/);
  assert.doesNotMatch(upload,/entry\.reservation=check\(await retry/);
  assert.match(upload,/p_id:entry\.reservation\.id/);
  assert.match(upload,/upsert:false/);
  assert.match(upload,/statusCode\|\|stored\.error\.status\)!=="409"/);
  assert.match(upload,/cosme_library_list/);
  assert.match(upload,/batch_index===entry\.index\+1/);
});

test('Home Screen service worker changes never force a reload during uploads',()=>{
  const pwa=src('../assets/js/pwa_bootstrap.js');
  const metrics=src('../assets/js/cosme_metrics_page.js');
  assert.doesNotMatch(pwa,/controllerchange[\s\S]*?window\.location\.reload\(\)/);
  assert.match(pwa,/pwa-last-route-v1/);
  assert.match(metrics,/cosme-last-tab/);
  assert.match(metrics,/cosmePhotoUploading !== "true"/);
  assert.match(metrics,/tab\(selected\)/);
});
