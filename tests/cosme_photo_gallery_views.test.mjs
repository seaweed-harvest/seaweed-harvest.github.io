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


test('photo viewer keeps compact navigation above the image and actions below',()=>{
  const viewer=read('../assets/js/cosme_photo_viewer.mjs');
  assert.match(viewer,/library-photo-viewer-top/);
  assert.match(viewer,/Previous photo/);assert.match(viewer,/Next photo/);
  assert.match(viewer,/Close photo/);assert.match(viewer,/event.target===viewer/);
  assert.ok(viewer.indexOf('library-viewer-content') < viewer.indexOf('library-photo-viewer-footer'));
  for(const text of ['Download photo','Favourite photo','Edit photo description'])
    assert.ok(viewer.includes(text));
  assert.match(viewer,/show\(index\)/);
  assert.doesNotMatch(viewer,/viewer\.close\(\);openFile\(/);
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


test('photo description is edited in place without replacing image or metadata',()=>{
  const viewer=read('../assets/js/cosme_photo_viewer.mjs');
  assert.match(viewer,/currentCaption=add\(details,"p","library-viewer-caption"/);
  assert.match(viewer,/currentCaption\.contentEditable=on\?"plaintext-only":"false"/);
  assert.match(viewer,/cosme_library_photo_patch/);
  assert.match(viewer,/p_expected_revision:photoToSave\.revision/);
  assert.match(viewer,/Object\.assign\(photoToSave,updated\)/);
  assert.match(viewer,/currentCaption\.focus\(\)/);
  assert.doesNotMatch(viewer,/library-photo-inline-edit|description\.rows/);
  const css=read('../assets/css/cosme_project_library.css');
  assert.match(css,/max-height:59svh/);
  assert.match(css,/library-viewer-caption\[contenteditable="plaintext-only"\]/);
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

test('swiping horizontally uses a five-image private signed cache and preloads neighbours',()=>{
  const viewer=read('../assets/js/cosme_photo_viewer.mjs');
  assert.match(viewer,/createPhotoImageCache/);
  assert.match(viewer,/now\+45000/);
  assert.match(viewer,/while\(cached\.size>5\)/);
  assert.match(viewer,/preloadNeighbours/);
  assert.match(viewer,/imageCache\.load\(sequence\[i\]\)/);
  assert.match(viewer,/viewer\.addEventListener\("touchstart"/);
  assert.match(viewer,/viewer\.addEventListener\("touchend"/);
  assert.match(viewer,/swipeDirection\(/);
  assert.match(viewer,/Math\.abs\(dx\)<=Math\.abs\(dy\)\*1\.4/);
  assert.match(viewer,/viewer\.addEventListener\("keydown"/);
  assert.doesNotMatch(viewer,/viewer\.close\(\);openFile\(/);
});

test('photo grid and list progressively append 48 images instead of paging',()=>{
  const src=read('../assets/js/cosme_project_library.mjs');
  const gallery=src.slice(src.indexOf('  function drawPhotos(){'),src.indexOf('  function draw(){'));
  assert.match(src,/photoBatchSize=48/);
  assert.match(gallery,/visible\.slice\(0,photoLimit\)/);
  assert.match(gallery,/visible\.slice\(start,photoLimit\)/);
  assert.match(gallery,/photoLimit=Math\.min\(visible\.length,start\+photoBatchSize\)/);
  assert.match(gallery,/new IntersectionObserver\(entries/);
  assert.match(gallery,/photoLoadObserver\.observe\(loader\)/);
  assert.match(gallery,/if\(!gallery\.isConnected\|\|!loader\.isConnected\)return/);
  assert.match(gallery,/else button\(loader,"Load more",appendNext\)/);
  assert.doesNotMatch(gallery,/Page \$\{page\+1\}|library-gallery-pagination/);
});

test('photo selection toggles individual tiles and the bulk bar without recreating thumbnails',()=>{
  const src=read('../assets/js/cosme_project_library.mjs');
  const css=read('../assets/css/cosme_project_library.css');
  const selection=src.slice(src.indexOf('  function updatePhotoSelectionActions(){'),src.indexOf('  function card('));
  const list=src.slice(src.indexOf('  function photoListItem('),src.indexOf('  function photoTrashItem('));
  const gallery=src.slice(src.indexOf('  function drawPhotos(){'),src.indexOf('  function draw(){'));
  assert.match(selection,/function togglePhotoSelection\(item,tile\)/);
  assert.match(selection,/syncPhotoTileSelection\(tile\)/);
  assert.match(selection,/updatePhotoSelectionActions\(\)/);
  assert.match(selection,/tile\.classList\.toggle\("is-selected",active\)/);
  assert.match(selection,/row\.classList\.toggle\("is-selected",active\)/);
  assert.match(selection,/open\.setAttribute\("aria-pressed",String\(active\)\)/);
  assert.doesNotMatch(selection,/draw\(\)/);
  assert.match(list,/togglePhotoSelection\(item,tile\)/);
  assert.doesNotMatch(list,/draw\(\)/);
  assert.match(gallery,/root\.querySelectorAll\("\.library-tile"\)\.forEach\(syncPhotoTileSelection\)/);
  assert.match(gallery,/const chosen=add\(root,"div","library-selection-bar"\)/);
  assert.match(gallery,/updatePhotoSelectionActions\(\)/);
  assert.match(css,/not\(\.is-select-mode\) \.library-tile-check\{display:none\}/);
  assert.match(css,/is-select-mode \.library-tile-fav\{display:none\}/);
  assert.match(css,/library-selection-bar\[hidden\]\{display:none\}/);
});

test('upload form opens above endless photo gallery without rebuilding thumbnails',()=>{
  const src=read('../assets/js/cosme_project_library.mjs');
  const css=read('../assets/css/cosme_project_library.css');
  const upload=src.slice(src.indexOf('  async function batchUpload('),src.indexOf('  function updatePhotoSelectionActions('));
  const gallery=src.slice(src.indexOf('  function drawPhotos(){'),src.indexOf('  function draw(){'));
  assert.match(upload,/const host=root\.querySelector\("\.library-upload-host"\)\|\|root/);
  assert.match(upload,/const form=add\(host,"form","library-batch-form"\)/);
  assert.match(upload,/currentForm\.scrollIntoView/);
  assert.match(upload,/form\.scrollIntoView\(\{behavior:"smooth",block:"start"\}\)/);
  assert.match(upload,/refreshResumeAction\(\)/);
  assert.doesNotMatch(upload,/if\(kind==="photos"\)draw\(\)/);
  assert.ok(gallery.indexOf('add(root,"div","library-upload-host")')<gallery.indexOf('const gallery=add(root,'));
  assert.match(css,/library-upload-host:empty\{display:none\}/);
  assert.match(css,/scroll-margin-top:72px/);
  assert.match(gallery,/photoLimit\=Math\.min\(visible\.length,start\+photoBatchSize\)/);
});
