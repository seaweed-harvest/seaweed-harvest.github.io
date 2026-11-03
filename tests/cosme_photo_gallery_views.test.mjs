import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('COSME gallery provides both grid and selective list presentations',()=>{
  const src=read('../assets/js/cosme_project_library.mjs');
  assert.match(src,/function drawPhotos\(\)/);
  assert.match(src,/function photoListItem\(item,container\)/);
  assert.match(src,/photoView==="grid"/);
  assert.match(src,/\[\["grid","Grid"\],\["list","List"\]\]/);
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
