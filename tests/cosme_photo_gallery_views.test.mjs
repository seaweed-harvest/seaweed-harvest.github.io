import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('COSME gallery provides both grid and selective list presentations',()=>{
  const src=read('../assets/js/cosme_project_library.mjs');
  assert.match(src,/function drawPhotos\(\)/);
  assert.match(src,/function photoListItem\(item,container\)/);
  assert.match(src,/photoView==="grid"/);
  assert.match(src,/\[\["grid","Grid"\],\["list","List"\],\["map","Map"\]\]/);
  for(const field of ['library-row-title','library-row-context','library-row-facts','library-row-caption'])assert.ok(src.includes(field));
  assert.match(src,/setAttribute\("aria-pressed"/);
});
test('filters and search are compact but accessible across modes',()=>{
  const src=read('../assets/js/cosme_project_library.mjs');
  assert.match(src,/library-gallery-advanced/);
  assert.match(src,/library-gallery-category/);
  assert.match(src,/library-gallery-search/);
  assert.match(src,/library-gallery-toolbar/);
  assert.match(src,/setAttribute\("aria-expanded"/);
  assert.match(src,/function photoTrashItem\(item,container\)/);
});
test('mobile photo tiles are larger and favourite hearts visually smaller',()=>{
  const css=read('../assets/css/cosme_project_library.css');
  assert.match(css,/library-photo-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/library-tile-fav\{width:30px;height:30px/);
  assert.match(css,/library-gallery-view-toggle/);
  assert.match(css,/library-photo-list/);
  assert.match(css,/library-photo-trash-list/);
});
test('reports library and private signed-photo delivery remain intact',()=>{
  const src=read('../assets/js/cosme_project_library.mjs');
  assert.match(src,/if\(kind==="photos"\)\{drawPhotos\(\);return\}/);
  assert.match(src,/library-report-table/);
  assert.match(src,/createSignedUrl\(item.object_path,60/);
  assert.match(src,/cosme_library_photo_action/);
  assert.doesNotMatch(src,/getPublicUrl|innerHTML/);
});


test('photo viewer keeps only compact navigation above the image and actions below',()=>{
  const src=read('../assets/js/cosme_project_library.mjs');
  const start=src.indexOf('  async function openFile(item,download=false){');
  const end=src.indexOf('  function editor(',start);
  const viewer=src.slice(start,end);
  assert.match(viewer,/library-photo-viewer-top/);
  assert.match(viewer,/Previous photo/);assert.match(viewer,/Next photo/);
  assert.match(viewer,/Close photo/);assert.match(viewer,/e\.target===viewer/);
  assert.ok(viewer.indexOf('library-viewer-content') < viewer.indexOf('library-photo-viewer-footer'));
  for(const text of ['Download photo','Favourite photo','Edit photo description'])assert.ok(viewer.includes(text));
  assert.doesNotMatch(viewer,/button\(actions,"‹ Previous"/);
});
test('list uses a larger preview and caption beneath the full row, never file size',()=>{
  const src=read('../assets/js/cosme_project_library.mjs');
  const a=src.indexOf('  function photoListItem(');
  const b=src.indexOf('  function photoTrashItem(',a);
  const list=src.slice(a,b),css=read('../assets/css/cosme_project_library.css');
  assert.ok(list.includes('add(row,"button","library-row-caption"'));
  assert.doesNotMatch(list,/byte_size| KB| MB/);
  assert.match(css,/grid-template-columns:112px minmax\(0,1fr\)/);
  assert.match(css,/library-photo-row \.library-row-caption\{/);
  assert.match(css,/grid-column:1\/-1/);
});


test('browser batch upload retains files on device and resumes with bounded parallel transfer',()=>{
  const src=read('../assets/js/cosme_project_library.mjs');
  assert.match(src,/createQueuedBatch/);
  assert.match(src,/listPendingBatches/);
  assert.match(src,/putQueuedPhoto\(entry\)/);
  assert.match(src,/Array\.from\(\{length:Math\.min\(4,work\.length\)\}/);
  assert.match(src,/preparation=\{current:Promise\.resolve\(\)\}/);
  assert.match(src,/Stop remaining/);
  assert.match(src,/Resume \"\+pending\+\" remaining/);
  assert.match(src,/cosme_library_finish/);
  assert.match(src,/entry\.reservation\.object_path/);
});
test('voice-dictated batch descriptions remain attached to each photo for ChatGPT',()=>{
  const src=read('../assets/js/cosme_project_library.mjs');
  assert.match(src,/library-batch-note-label/);
  assert.match(src,/batch_description:settings\.note/);
  assert.match(src,/batch_id:queued\.id/);
  assert.match(src,/caption:settings\.note\.slice\(0,1000\)/);
  assert.match(src,/library-upload-savings/);
});
test('image optimisation avoids increasing storage and preserves camera metadata',()=>{
  const exif=read('../assets/js/cosme_photo_exif.mjs');
  assert.match(exif,/maxEdge=1920,quality=0\.80/);
  assert.match(exif,/const keepOriginal=supported&&factor===1&&file\.size<=candidate\.size/);
  assert.match(exif,/const targetMime=mime==="image\/png"\?"image\/png":"image\/jpeg"/);
  assert.match(exif,/const metadata=readPhotoExif/);
});


test('photo description is edited inside the open image viewer',()=>{
  const src=read('../assets/js/cosme_project_library.mjs');
  const begin=src.indexOf('  async function openFile(');
  const end=src.indexOf('  function editor(',begin);
  const viewer=src.slice(begin,end);
  assert.match(viewer,/library-photo-inline-edit/);
  assert.match(viewer,/library-photo-inline-actions/);
  assert.match(viewer,/cosme_library_photo_patch/);
  assert.match(viewer,/p_expected_revision:item\.revision/);
  assert.match(viewer,/Object\.assign\(item,updated\)/);
  assert.match(viewer,/description\.focus\(\)/);
  assert.doesNotMatch(viewer,/viewer\.close\(\);editor\(item\)/);
});
test('returning from iPhone Photos and recovery discovery preserve active forms and photo viewer',()=>{
  const src=read('../assets/js/cosme_project_library.mjs');
  const metrics=read('../assets/js/cosme_metrics_page.js');
  assert.match(src,/function hasActiveInteraction\(\)/);
  assert.match(src,/root\.querySelector\("\.library-batch-form"\)/);
  assert.match(src,/root\.querySelector\("\.library-photo-viewer\[open\]"\)/);
  assert.match(src,/if\(busy\|\|hasActiveInteraction\(\)\)return/);
  assert.match(src,/if\(ticket!==epoch\|\|hasActiveInteraction\(\)\)return/);
  assert.match(src,/if\(!root\.isConnected\|\|busy\|\|hasActiveInteraction\(\)\)return/);
  assert.match(metrics,/!libraries\.photos\.hasActiveInteraction\?\.\(\)/);
});
test('selected photos and partial dictated notes are saved as drafts, never auto-uploaded',()=>{
  const src=read('../assets/js/cosme_project_library.mjs');
  const queue=read('../assets/js/cosme_photo_upload_queue.mjs');
  assert.match(queue,/state = "queued"/);
  assert.match(src,/files\.addEventListener\("change"/);
  assert.match(src,/field\.addEventListener\("input"/);
  assert.match(src,/state:"draft"/);
  assert.match(src,/await createQueuedBatch\(\{owner,snapshot:snapshot\(\)/);
  assert.match(src,/files:\[\.\.\.files\.files\],savedItems:items,state:"draft"/);
  assert.match(src,/await draftWrite/);
  assert.match(src,/Drafts are never uploaded automatically/);
  assert.match(src,/Continue draft/);
});
