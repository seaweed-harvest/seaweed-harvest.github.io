import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");

test("COSME Photos map stylesheet is a separate valid link",()=>{
  const html=read("../cosme_metrics.html");
  const library=html.match(/<link\s+rel="stylesheet"\s+href="\.\/assets\/css\/cosme_project_library\.css\?v=\d+"\s*>/g)||[];
  const map=html.match(/<link\s+rel="stylesheet"\s+href="\.\/assets\/css\/cosme_photo_map\.css\?v=\d+"\s*>/g)||[];
  assert.equal(library.length,1,"Project library CSS must load");
  assert.equal(map.length,1,"Photo map CSS must load");
  assert.doesNotMatch(html,/href="[^"]*<link/,"Stylesheet href cannot contain an embedded tag");
});
test("Photo map has a real canvas height on mobile and desktop",()=>{
  const css=read("../assets/css/cosme_photo_map.css");
  assert.match(css,/\.project-library \.library-map-wrap\s*\{/);
  assert.match(css,/height:min\(74vh,740px\);min-height:460px/);
  assert.match(css,/height:clamp\(460px,69dvh,760px\)/);
  const js=read("../assets/js/cosme_photo_map.mjs");
  assert.match(js,/assets\/vendor\/leaflet\/leaflet\.css/);
  assert.match(js,/assets\/vendor\/leaflet\/leaflet\.js/);
});
