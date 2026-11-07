import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {photoFingerprint,selectNewPhotos,queueCounts,matchQueuedReplacements} from '../assets/js/cosme_photo_upload_queue.mjs';

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

test('reselection only restores incomplete photo references, never confirmed uploads',()=>{
  const entries=[
    {key:'b:0',originalName:'IMG_3239.jpeg',originalBytes:123,ready:false,uploaded:false},
    {key:'b:1',originalName:'IMG_3240.jpeg',originalBytes:456,ready:false,uploaded:false},
    {key:'b:2',originalName:'IMG_3000.jpeg',originalBytes:789,ready:true,uploaded:true},
    {key:'b:3',originalName:'IMG_3239.jpeg',originalBytes:999,ready:false,uploaded:false},
    {key:'b:4',originalName:'IMG_3239.jpeg',originalBytes:1,ready:true,uploaded:true}
  ];
  const result=matchQueuedReplacements(entries,[
    {name:'img_3239.JPEG',size:999},
    {name:'IMG_3240.jpeg',size:456},
    {name:'IMG_3000.jpeg',size:789},
    {name:'unrelated.jpg',size:400}
  ]);
  assert.deepEqual(result.matches.map(x=>x.entry.key),['b:3','b:1']);
  assert.deepEqual(result.unmatched,['IMG_3000.jpeg','unrelated.jpg']);
});
test('iPhone upload recovery copies photo bytes and refreshes old reservations',()=>{
  const queue=src('../assets/js/cosme_photo_upload_queue.mjs');
  const upload=src('../assets/js/cosme_project_library.mjs');
  assert.match(queue,/const bytes=await file\.arrayBuffer\(\)/);
  assert.match(queue,/durable=new Blob\(\[bytes\]/);
  assert.match(upload,/Re-select remaining photos/);
  assert.match(upload,/matchQueuedReplacements\(entries,selected\)/);
  assert.match(upload,/entry\.original=new Blob\(\[bytes\]/);
  assert.match(upload,/Date\.now\(\)-reservedAt>45\*60\*1000/);
  assert.match(upload,/entry\.reservation=null/);
  assert.match(upload,/p_id:entry\.reservation\.id/);
  assert.match(upload,/upload\(\s*entry\.reservation\.object_path,bytes,/);
  assert.match(upload,/if\(unavailableSource\(err\)\)/);
  assert.match(upload,/entry\.needsReselect=true/);
});

test('prior missing-iPhone-file errors require reselection rather than endless retry',()=>{
  const src=readFileSync(new URL('../assets/js/cosme_project_library.mjs',import.meta.url),'utf8');
  assert.match(src,/!entry\.needsReselect\)/);
  assert.match(src,/actionable\?"Resume "\+actionableCount\+" available":"Re-select missing photos"/);
  assert.match(src,/unavailableSource\(\{message:entry\.lastError\}\)/);
  assert.match(src,/if\(missing\)repairStatus\.textContent=/);
  const exact=matchQueuedReplacements([{key:'a',originalName:'IMG_3239.jpeg',originalBytes:42,ready:false,uploaded:false}],
    [{name:'IMG_3239.jpeg',size:40}]);
  assert.equal(exact.matches.length,1);
  assert.equal(exact.matches[0].entry.key,'a');
  assert.deepEqual(exact.unmatched,[]);
});

test('batch recovery checks server catalogue once and preflights missing local files',()=>{
  const src=readFileSync(new URL('../assets/js/cosme_project_library.mjs',import.meta.url),'utf8');
  const fn=src.slice(src.indexOf('    let savedBatchRecords=null;'),src.indexOf('    async function saveOne('));
  assert.match(fn,/async function refreshSavedBatch\(\)/);
  assert.match(fn,/savedBatchRecords=new Map/);
  assert.match(fn,/const known=refresh\?await refreshSavedBatch\(\)/);
  assert.match(fn,/entry\.needsReselect=false/);
  assert.match(src,/const existing=await refreshSavedBatch\(\)/);
  assert.match(src,/if\(\(!entry\.ready\|\|!entry\.metadataSaved\)&&existing\.has\(entry\.index\+1\)\)/);
  assert.match(src,/await source\.slice\(0,1\)\.arrayBuffer\(\)/);
  assert.match(src,/delete entry\.original;delete entry\.prepared;/);
  assert.match(src,/if\(!\(await verifySaved\(entry,true\)\)\)/);
});
