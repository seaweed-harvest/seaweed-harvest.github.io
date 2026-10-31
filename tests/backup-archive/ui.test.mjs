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
      object_version: "v1",
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
  q("archiveCleanup").click();
  await settled();
  assert.match(q("archiveStatus").textContent, /failed verification/);
  assert.equal(calls.includes("preview_cleanup"), false);
  assert.equal(calls.includes("delete_original"), false);
});

function memoryFolder() {
  const files=new Map();
  const writes=new Map();
  const writers=new Set();
  const missing=()=>Object.assign(new Error('Missing'),{name:'NotFoundError'});
  function dir(prefix='') { return {
    name:'SeaweedArchive',
    async getDirectoryHandle(name,{create}={}) { return dir(prefix+name+'/'); },
    async getFileHandle(name,{create}={}) {
      const path=prefix+name;
      if(!create && !files.has(path)) throw missing();
      return {async getFile(){if(!files.has(path))throw missing();return files.get(path)},
        async createWritable(){
          writes.set(path,(writes.get(path)||0)+1);
          assert.equal(writers.has(path),false,'Concurrent writers for '+path);
          writers.add(path);
          let pending;return {async write(value){pending=value instanceof Blob?value:new Blob([value])},
            async close(){await new Promise(resolve=>setTimeout(resolve,1));files.set(path,pending);writers.delete(path)},
            async abort(){writers.delete(path)}}}};
    }
  }; }
  return {root:dir(),files,writes};
}
async function backupFixture(existingFolder, photoNames = ['one','two']) {
  const {hashBlob}=await import('../../assets/js/archive_files.mjs');
  const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const rows=await Promise.all(photoNames.map(async(name,i)=>{
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
  // Most legacy photo-selection tests exercise the optional advanced picker.
  fixture.q('archivePhotoDetails').open=true;
  fixture.q('archivePhotoDetails').dispatchEvent(new window.Event('toggle'));
  fixture.q('archiveFolder').click();await settled();
  return {...fixture,...folder,rows,a,b};
}
function change(element,checked){element.checked=checked;element.dispatchEvent(new window.Event('change',{bubbles:true}));}
test('one backup button saves selected organisation records without photos by default',async()=>{
  const f=await backupFixture();
  const checkbox=document.querySelector('[data-organisation-id="'+f.a+'"]');
  change(checkbox,true);await settled();
  assert.equal(f.q('archiveAllOrganisations').checked,false);
  change(f.q('archiveIncludePhotos'),true);
  f.q('archivePhotoDetails').dispatchEvent(new window.Event('toggle'));
  assert.equal(document.querySelectorAll('[data-archive-key]').length,1);
  change(f.q('archiveIncludePhotos'),false);
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

test('photo transfers overlap up to eight at a time and all verified entries survive ordered manifest writes',async()=>{
  const names=Array.from({length:9},(_,i)=>'photo-'+i);
  const f=await backupFixture(undefined,names),previous=globalThis.fetch;
  let active=0,peak=0,downloads=0;
  globalThis.fetch=async url=>{
    active++;downloads++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,15));
    active--;
    return new Response(names[Number(url.split('/').at(-1))]);
  };
  try {
    change(f.q('archiveIncludePhotos'),true);f.q('archiveSave').click();await settled();
    assert.equal(peak,8);assert.equal(downloads,9);
    assert.match(f.q('archiveStatus').textContent,/9 saved, 0 already verified, 0 skipped, 0 failed/);
    const manifest=JSON.parse(await f.files.get('seaweed-archive.json').text());
    assert.equal(manifest.files.length,9);
    assert.equal(new Set(manifest.files.map(r=>r.object_id)).size,9);
    assert.equal(f.q('archiveProgress').value,9);
    for(let i=0;i<names.length;i++)assert.equal(await f.files.get('photos/'+names[i]+'.jpg').text(),names[i]);
  }finally{globalThis.fetch=previous}
});
test('first-time photos reuse their initial preparation URL instead of preparing twice',async()=>{
  const f=await backupFixture(undefined,['one']),previous=globalThis.fetch;
  const archive=f.rows[0].archive;delete f.rows[0].archive;
  const invoke=f.client.functions.invoke;let prepares=0;
  f.client.functions.invoke=async(name,options)=>{
    if(options.body.action==='prepare'){prepares++;return {data:{archive,signed_url:'https://synthetic.test/0'}}}
    return invoke(name,options);
  };
  globalThis.fetch=async()=>new Response('one');
  try{
    change(f.q('archiveIncludePhotos'),true);f.q('archiveSave').click();await settled();
    assert.equal(prepares,1);assert.match(f.q('archiveStatus').textContent,/1 saved/);
  }finally{globalThis.fetch=previous}
});
test('photos sharing a content-addressed path have one writer and one download',async()=>{
  const f=await backupFixture(),previous=globalThis.fetch;let downloads=0;
  f.rows[1].archive.sha256=f.rows[0].archive.sha256;
  f.rows[1].archive.relative_path=f.rows[0].archive.relative_path;
  globalThis.fetch=async()=>{downloads++;await new Promise(resolve=>setTimeout(resolve,5));return new Response('one')};
  try{
    change(f.q('archiveIncludePhotos'),true);f.q('archiveSave').click();await settled();
    assert.equal(downloads,1);
    assert.match(f.q('archiveStatus').textContent,/1 saved, 1 already verified, 0 skipped, 0 failed/);
    assert.equal(JSON.parse(await f.files.get('seaweed-archive.json').text()).files.length,2);
  }finally{globalThis.fetch=previous}
});
test('a newer version returned by initial preparation never downloads into the captured backup',async()=>{
  const f=await backupFixture(undefined,['one']),previous=globalThis.fetch;let downloads=0;
  const archive={...f.rows[0].archive,object_version:'new-version'};delete f.rows[0].archive;
  const invoke=f.client.functions.invoke;
  f.client.functions.invoke=async(name,options)=>options.body.action==='prepare'
    ? {data:{archive,signed_url:'https://synthetic.test/0'}}:invoke(name,options);
  globalThis.fetch=async()=>{downloads++;return new Response('one')};
  try{
    change(f.q('archiveIncludePhotos'),true);f.q('archiveSave').click();await settled();
    assert.equal(downloads,0);assert.match(f.q('archiveStatus').textContent,/1 failed/);
    assert.equal(JSON.parse(await f.files.get('seaweed-archive.json').text()).files.length,0);
  }finally{globalThis.fetch=previous}
});

test('Stop safely finishes active files, checkpoints progress and resumes without redownloading verified copies',async()=>{
  const names=Array.from({length:20},(_,i)=>'stop-photo-'+i);
  const f=await backupFixture(undefined,names),previous=globalThis.fetch;
  let release,downloads=0;
  const gate=new Promise(resolve=>{release=resolve});
  globalThis.fetch=async url=>{downloads++;await gate;return new Response(names[Number(url.split('/').at(-1))])};
  try{
    change(f.q('archiveIncludePhotos'),true);f.q('archiveSave').click();
    const deadline=Date.now()+2000;
    while(downloads<8 && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,2));
    assert.equal(downloads,8);
    const leaving=new window.Event('beforeunload',{cancelable:true});window.dispatchEvent(leaving);
    assert.equal(leaving.defaultPrevented,true);
    assert.equal(f.q('archiveStop').disabled,false);
    f.q('archiveStop').click();release();await settled();
    assert.equal(downloads,8);assert.match(f.q('archiveStatus').textContent,/Stopped safely/);
    assert.equal(f.q('archiveSave').textContent,'Resume backup');
    let manifest=JSON.parse(await f.files.get('seaweed-archive.json').text());
    assert.equal(manifest.files.length,8);assert.equal(manifest.snapshots.at(-1).status,'stopped');
    assert.equal(manifest.snapshots.at(-1).photo_results.pending,12);
    f.q('archiveSave').click();await settled();
    assert.equal(downloads,20);
    assert.match(f.q('archiveStatus').textContent,/12 saved, 8 already verified, 0 skipped, 0 failed/);
    manifest=JSON.parse(await f.files.get('seaweed-archive.json').text());
    assert.equal(manifest.files.length,20);assert.equal(manifest.snapshots.at(-1).status,'complete');
    const finished=new window.Event('beforeunload',{cancelable:true});window.dispatchEvent(finished);
    assert.equal(finished.defaultPrevented,false);
  }finally{release();globalThis.fetch=previous}
});
test('large photos respect the byte budget instead of downloading eight large files together',async()=>{
  const f=await backupFixture(undefined,['large-one','large-two','large-three']),previous=globalThis.fetch;
  const blob=new Blob([new Uint8Array(20*1024*1024)]);
  const {hashBlob}=await import('../../assets/js/archive_files.mjs');const sha=await hashBlob(blob);
  for(const row of f.rows){row.byte_size=blob.size;row.archive.byte_size=blob.size;row.archive.sha256=sha}
  let active=0,peak=0;
  globalThis.fetch=async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return new Response(blob)};
  try{
    change(f.q('archiveIncludePhotos'),true);f.q('archiveSave').click();await settled();
    assert.equal(peak,1);assert.match(f.q('archiveStatus').textContent,/3 saved, 0 already verified, 0 skipped, 0 failed/);
  }finally{globalThis.fetch=previous}
});
test('normal backups omit redundant server receipts but explicit local verification still records fresh receipts',async()=>{
  const f=await backupFixture(),previous=globalThis.fetch;
  globalThis.fetch=async url=>new Response(url.endsWith('/0')?'one':'two');
  try{
    change(f.q('archiveIncludePhotos'),true);f.q('archiveSave').click();await settled();
    assert.equal(f.calls.includes('verify_local'),false);
    f.q('archiveVerify').click();await settled();
    assert.equal(f.calls.filter(x=>x==='verify_local').length,2);
    assert.match(f.q('archiveStatus').textContent,/2 local originals read and verified/);
  }finally{globalThis.fetch=previous}
});

test('normal summary is compact, updates with selection and only creates individual-photo rows on demand',async()=>{
  const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const orgs=[{id:a,name:'Org A',record_count:12,photo_count:1,ledgers:[{table:'collections',record_count:12}]},
    {id:b,name:'Org B',record_count:3,photo_count:0,ledgers:[{table:'ag_process_records',record_count:3}]}];
  const f=setup(body=>({objects:[{object_id:'photo',object_version:'v1',object_path:'one.jpg',bucket_id:'photos',byte_size:5}],
    organisations:orgs,summary:{record_count:body.organisation_ids?12:17,ledgers:body.organisation_ids?orgs[0].ledgers:[...orgs[0].ledgers,...orgs[1].ledgers],
      organisations:body.organisation_ids?[orgs[0]]:orgs,shared:body.organisation_ids?null:{name:'Shared / unassigned',record_count:2,photo_count:0,ledgers:[{table:'seaweed_drying_submissions',record_count:2}]}}}));
  await mountFullBackupArchive({client:f.client,profile:owner});
  assert.match(f.q('archiveSummaryTotals').textContent,/17 ledger records/);
  assert.match(f.q('archiveSummaryRows').textContent,/Org A.*12.*1.*Org B.*3.*0.*Shared \/ unassigned.*2/s);
  change(f.q('archiveIncludePhotos'),true);
  assert.equal(document.querySelectorAll('[data-archive-key]').length,0);
  assert.match(f.q('archivePhotoSummary').textContent,/1 photos/);
  change(document.querySelector('[data-organisation-id="'+a+'"]'),true);await settled();
  assert.equal(f.q('archiveSummaryHead').textContent,'LedgerRecords');
  assert.equal(f.q('archiveSummaryRows').textContent,'Collections12');
  assert.equal(f.q('archiveLedgerDetails').hidden,true);
  f.q('archivePhotoDetails').open=true;f.q('archivePhotoDetails').dispatchEvent(new window.Event('toggle'));
  assert.equal(document.querySelectorAll('[data-archive-key]').length,1);
});
test('existing-file reuse batches checkpoints instead of committing the manifest after every file',async()=>{
  const names=Array.from({length:48},(_,i)=>'saved-'+i),f=await backupFixture(undefined,names);
  for(let i=0;i<names.length;i++)f.files.set('photos/'+names[i]+'.jpg',new Blob([names[i]]));
  const before=f.writes.get('seaweed-archive.json')||0;
  change(f.q('archiveIncludePhotos'),true);f.q('archiveSave').click();await settled();
  assert.match(f.q('archiveStatus').textContent,/48 already verified/);
  assert.equal(f.calls.includes('prepare'),false);
  assert.ok(f.writes.get('seaweed-archive.json')-before<=6,'Reuse should checkpoint in batches');
  const manifest=JSON.parse(await f.files.get('seaweed-archive.json').text());
  assert.equal(manifest.files.length,48);assert.ok(manifest.snapshots.at(-1).completed_at);
  assert.match(f.q('archiveHistory').textContent,/Last completed in this folder.*records and photos/);
  assert.equal(f.q('archiveRunningHint').hidden,true);
});

