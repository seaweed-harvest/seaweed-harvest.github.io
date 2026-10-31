import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { mountFullBackupArchive } from "../../assets/js/full_backup_archive.js";
const html = readFileSync(
  new URL("../../admin_backups.html", import.meta.url),
  "utf8",
);
const owner = { account_status: "active", is_protected_owner: true };
async function settled() {
  const end = Date.now() + 10000;
  while (
    document.getElementById("fullBackupArchive").getAttribute("aria-busy") ===
      "true" && Date.now() < end
  ) await new Promise((r) => setTimeout(r, 5));
  assert.notEqual(
    document.getElementById("fullBackupArchive").getAttribute("aria-busy"),
    "true",
    "Archive operation did not settle",
  );
}
function setup(inventory, handler) {
  const dom = new JSDOM(html, {
    url: "https://seaweed-harvest.com/admin_backups.html",
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Option = dom.window.Option;
  const calls = [], bodies = [];
  const client = {
    supabaseUrl: "https://wwzmajhdusfyfskppupg.supabase.co",
    functions: {
      async invoke(name, { body }) {
        assert.equal(name, "backup-archive");
        calls.push(body?.action); bodies.push(body);
        if (body.action === "inventory") return { data: typeof inventory === "function" ? await inventory(body) : inventory };
        if (handler) return handler(body);
        throw new Error("Unexpected action");
      },
    },
  };
  return { dom, calls, bodies, client, q: (id) => document.getElementById(id) };
}
test("full backups remain hidden for non-owner admins and do not call the service", async () => {
  const { client, q, calls } = setup({});
  await mountFullBackupArchive({
    client,
    profile: {
      account_status: "active",
      is_protected_owner: false,
      app_role: "system_admin",
    },
  });
  assert.equal(q("fullBackupArchive").hidden, true);
  assert.deepEqual(calls, []);
});
test("unconfigured database and destructive cleanup controls stay disabled with accurate coverage", async () => {
  const { client, q } = setup({
    objects: [],
    database_jobs: [],
    cleanup_enabled: false,
    database_runner_enabled: false,
  });
  await mountFullBackupArchive({ client, profile: owner });
  assert.equal(q("fullBackupArchive").hidden, false);
  assert.equal(q("archiveCleanup").disabled, true);
  assert.equal(q("archiveDatabase").disabled, true);
  assert.match(
    q("archiveReadiness").textContent,
    /do not preserve Auth password hashes/,
  );
});
test("corrupt local original stops cleanup before a preview or delete request", async () => {
  const row = {
    object_id: "id",
    object_version: "v1",
    object_path: "image.jpg",
    bucket_id: "photos",
    byte_size: 8,
    archive: {
      id: "archive",
      relative_path: "photos/sha",
      sha256: "a".repeat(64),
      byte_size: 8,
      cloud_state: "present",
    },
  };
  const { client, q, calls, dom } = setup({
    objects: [row],
    database_jobs: [],
    cleanup_enabled: true,
    database_runner_enabled: false,
  });
  const saved = {
    format_version: 1,
    project_ref: "wwzmajhdusfyfskppupg",
    copy_id: "copy",
    files: [],
    database_backups: [],
    snapshots: [],
  };
  const fake = {
    name: "external-drive",
    async getDirectoryHandle() {
      return fake;
    },
    async getFileHandle(name) {
      return {
        async getFile() {
          return new Blob([
            name === "seaweed-archive.json"
              ? JSON.stringify(saved)
              : "corrupt!",
          ]);
        },
        async createWritable() {
          return { async write() {}, async close() {}, async abort() {} };
        },
      };
    },
  };
  dom.window.showDirectoryPicker = async () => fake;
  await mountFullBackupArchive({ client, profile: owner });
  q("archiveFolder").click();
  await settled();
  document.querySelector("input[data-archive-key]").checked = true;
  q("archiveCleanup").click();
  await settled();
  assert.match(q("archiveStatus").textContent, /failed verification/);
  assert.equal(calls.includes("preview_cleanup"), false);
  assert.equal(calls.includes("delete_original"), false);
});

function memoryFolder() {
  const files=new Map();
  const missing=()=>Object.assign(new Error('Missing'),{name:'NotFoundError'});
  function dir(prefix='') { return {
    name:'SeaweedArchive',
    async getDirectoryHandle(name,{create}={}) { return dir(prefix+name+'/'); },
    async getFileHandle(name,{create}={}) {
      const path=prefix+name;
      if(!create && !files.has(path)) throw missing();
      return {async getFile(){if(!files.has(path))throw missing();return files.get(path)},
        async createWritable(){let pending;return {async write(value){pending=value instanceof Blob?value:new Blob([value])},
          async close(){files.set(path,pending)},async abort(){}}}};
    }
  }; }
  return {root:dir(),files};
}
async function backupFixture(existingFolder) {
  const {hashBlob}=await import('../../assets/js/archive_files.mjs');
  const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const rows=await Promise.all(['one','two'].map(async(name,i)=>{
    const data=new Blob([name]);const hash=await hashBlob(data);
    return {object_id:String(i),object_version:'v1',bucket_id:'photos',object_path:name+'.jpg',byte_size:data.size,
      archive:{id:String(i),object_id:String(i),object_version:'v1',sha256:hash,byte_size:data.size,
        relative_path:'photos/'+name+'.jpg',cloud_state:'present'}};
  }));
  const fixture=setup(body=>({objects:body.organisation_ids?.includes(a)?[rows[0]]:rows,
    organisations:[{id:a,name:'Org A'},{id:b,name:'Org B'}],database_jobs:[],cleanup_enabled:false,database_runner_enabled:false}),
    async body=>({data:body.action==='export_data'?{captured_at:'2026-10-31T08:00:00Z',tables:[],photo_inventory:rows.map(r=>({...r,archive:undefined})),database_recovery_complete:false}
      :body.action==='prepare'?{archive:rows.find(r=>r.object_id===body.object_id).archive,signed_url:'https://synthetic.test/'+body.object_id}: {ok:true}}));
  const folder=existingFolder ?? memoryFolder();fixture.dom.window.showDirectoryPicker=async()=>folder.root;
  await mountFullBackupArchive({client:fixture.client,profile:owner});
  fixture.q('archiveFolder').click();await settled();
  return {...fixture,...folder,rows,a,b};
}
function change(element,checked){element.checked=checked;element.dispatchEvent(new window.Event('change',{bubbles:true}));}
test('one backup button saves selected organisation records without photos by default',async()=>{
  const f=await backupFixture();
  const checkbox=document.querySelector('[data-organisation-id="'+f.a+'"]');
  change(checkbox,true);await settled();
  assert.equal(f.q('archiveAllOrganisations').checked,false);
  assert.equal(document.querySelectorAll('[data-archive-key]').length,1);
  f.q('archiveSave').click();await settled();
  const request=f.bodies.find(b=>b.action==='export_data');
  assert.deepEqual(request.organisation_ids,[f.a]);
  assert.equal(f.calls.includes('prepare'),false);
  const manifest=JSON.parse(await f.files.get('seaweed-archive.json').text());
  assert.equal(manifest.snapshots.length,1);
  assert.equal(manifest.snapshots[0].photos_requested,false);
  assert.deepEqual(manifest.snapshots[0].expected_photo_versions,[]);
});
test('selected photos only are downloaded, verified copies are reused and conflicts require replacement opt-in',async()=>{
  const f=await backupFixture(),previous=globalThis.fetch;let downloads=0;
  globalThis.fetch=async url=>{downloads++;return new Response(url.endsWith('/0')?'one':'two')};
  try {
    change(f.q('archiveIncludePhotos'),true);
    change(document.querySelectorAll('[data-archive-key]')[1],false);
    f.q('archiveSave').click();await settled();
    assert.equal(downloads,1);assert.equal(f.files.has('photos/two.jpg'),false);
    assert.match(f.q('archiveStatus').textContent,/1 saved/);
    f.q('archiveSave').click();await settled();
    assert.equal(downloads,1);assert.match(f.q('archiveStatus').textContent,/1 already verified/);
    f.files.set('photos/one.jpg',new Blob(['bad']));
    f.q('archiveSave').click();await settled();
    assert.equal(downloads,1);assert.equal(await f.files.get('photos/one.jpg').text(),'bad');
    assert.match(f.q('archiveStatus').textContent,/1 skipped/);
    change(f.q('archiveReplaceExisting'),true);
    f.q('archiveSave').click();await settled();
    assert.equal(downloads,2);assert.equal(await f.files.get('photos/one.jpg').text(),'one');
    const manifest=JSON.parse(await f.files.get('seaweed-archive.json').text());
    assert.equal(manifest.files.length,1);
    assert.equal(manifest.snapshots.at(-1).expected_photo_versions.length,1);
  } finally {globalThis.fetch=previous}
});
test('a failed photo can be retried in the same folder without downloading completed copies again',async()=>{
  const f=await backupFixture(),previous=globalThis.fetch;let fail=true,first=0,second=0;
  globalThis.fetch=async url=>{
    if(url.endsWith('/0')){first++;return new Response('one')}
    second++;if(fail)throw new Error('Synthetic interruption');return new Response('two');
  };
  try {
    change(f.q('archiveIncludePhotos'),true);
    f.q('archiveSave').click();await settled();
    assert.match(f.q('archiveStatus').textContent,/1 failed/);
    fail=false;
    const reopened=await backupFixture({root:f.root,files:f.files});
    change(reopened.q('archiveIncludePhotos'),true);reopened.q('archiveSave').click();await settled();
    assert.equal(first,1);assert.equal(second,2);
    assert.match(reopened.q('archiveStatus').textContent,/1 saved, 1 already verified, 0 skipped, 0 failed/);
    assert.equal(JSON.parse(await f.files.get('seaweed-archive.json').text()).files.length,2);
  } finally {globalThis.fetch=previous}
});
test('an empty organisation selection blocks backup and a failed scope refresh cannot reuse the previous photos',async()=>{
  const f=await backupFixture();
  change(f.q('archiveAllOrganisations'),false);await settled();
  assert.equal(f.q('archiveSave').disabled,true);
  assert.equal(document.querySelectorAll('[data-archive-key]').length,0);
  f.client.functions.invoke=async()=>({error:{message:'Synthetic unavailable'}});
  change(document.querySelector('[data-organisation-id="'+f.a+'"]'),true);await settled();
  assert.equal(f.q('archiveSave').disabled,true);
  assert.equal(document.querySelectorAll('[data-archive-key]').length,0);
});

test('a photo version changed between inventory and record capture blocks the export before any file is written',async()=>{
  const f=await backupFixture(),invoke=f.client.functions.invoke;
  f.client.functions.invoke=async(name,options)=>options.body.action==='export_data'
    ? {data:{tables:[],photo_inventory:[{...f.rows[0],object_version:'v2'}]}}:invoke(name,options);
  change(f.q('archiveIncludePhotos'),true);f.q('archiveSave').click();await settled();
  assert.match(f.q('archiveStatus').textContent,/Photos changed/);
  assert.equal([...f.files.keys()].some(p=>p.startsWith('snapshots/')),false);
  assert.equal(f.calls.includes('prepare'),false);
});

test('including photos permits a valid records backup when the organisation has no photos',async()=>{
  const f=await backupFixture();
  f.client.functions.invoke=async(name,{body})=>({data:body.action==='inventory'
    ? {objects:[],organisations:[{id:f.a,name:'Org A'}],database_jobs:[]}
    : {tables:[],photo_inventory:[],captured_at:'2026-10-31T08:00:00Z'}});
  f.q('archiveRefresh').click();await settled();
  change(f.q('archiveIncludePhotos'),true);
  f.q('archiveSave').click();await settled();
  assert.match(f.q('archiveStatus').textContent,/Records saved and verified/);
  assert.equal(JSON.parse(await f.files.get('seaweed-archive.json').text()).snapshots.at(-1).photos_requested,true);
});

