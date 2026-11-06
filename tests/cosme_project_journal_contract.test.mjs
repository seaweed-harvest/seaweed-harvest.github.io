// Run from repository root: node --test tests/cosme_project_journal_contract.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const root=new URL("../",import.meta.url);
const read=p=>readFileSync(fileURLToPath(new URL(p,root)),"utf8");

test("Project Journal is reachable from the COSME workspace",()=>{
 const page=read("cosme_metrics.html");
 const script=read("assets/js/cosme_metrics_page.js");
 assert.match(page,/data-tab="journal"/);
 assert.match(page,/id="projectJournal"/);
 assert.match(script,/createProjectJournal/);
 assert.match(script,/journalPanel\.showFromQuery\(\)/);
 assert.match(script,/journalPanel\.setUser\(newUserId\)/);
});

test("Journal uses authenticated RPCs and existing private Project Photos",()=>{
 const app=read("assets/js/cosme_project_journal.mjs");
 for(const name of ["ag_project_journal_list","ag_project_journal_get",
 "ag_project_journal_save","ag_project_journal_link_photos","ag_project_journal_for_photo",
 "cosme_library_list"]){
   assert.ok(app.includes(name),name+" is required");
 }
 assert.match(app,/createSignedUrl/);
 assert.match(app,/p_expected_revision:existing\.revision/);
 assert.match(app,/BUCKET = "cosme-project-library"/);
 assert.doesNotMatch(app,/SUPABASE_SERVICE_ROLE_KEY|service_role/);
 assert.match(app,/localStorage\.setItem/);
 assert.match(app,/DRAFT_KEY\+":"\+lastUser/);
});

test("Timeline and photo viewer link back to the same journal record",()=>{
 const timeline=read("assets/js/cosme_metrics_timeline.mjs");
 const viewer=read("assets/js/cosme_photo_viewer.mjs");
 const library=read("assets/js/cosme_project_library.mjs");
 assert.match(timeline,/journal_id/);
 assert.match(timeline,/tab=journal&entry=/);
 assert.match(viewer,/Open linked project journal/);
 assert.match(library,/ag_project_journal_for_photo/);
});

test("Journal editor remains mobile sized and never deletes photo records",()=>{
 const style=read("assets/css/cosme_project_journal.css");
 const app=read("assets/js/cosme_project_journal.mjs");
 assert.match(style,/@media\(max-width:650px\)/);
 assert.match(style,/grid-template-columns:1fr/);
 assert.doesNotMatch(app,/delete_photo|remove_project_photo|storage\.from\(BUCKET\)\.remove/);
});
