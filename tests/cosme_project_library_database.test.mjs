// Run with PGLITE_MODULE_PATH pointing to an independently installed PGlite module.
// This disposable Postgres rehearsal never connects to a Supabase project.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
test('private library migration: upload lifecycle, immutable files and role isolation',{
  skip:!process.env.PGLITE_MODULE_PATH
},async()=>{
  const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
  const db=new PGlite();
  try{
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema cosme_metrics; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth,storage to authenticated,anon;
      grant execute on function auth.uid() to authenticated,anon;
      create table cosme_metrics.test_grants(user_id uuid primary key,role text,active boolean default true);
      create function cosme_metrics.caller_role() returns text language sql stable security definer set search_path='' as $$
        select role from cosme_metrics.test_grants where user_id=auth.uid() and active $$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
      alter table storage.objects enable row level security;
      grant select,insert on storage.objects to authenticated;
      insert into auth.users values
        ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),
        ('00000000-0000-0000-0000-000000000003'),('00000000-0000-0000-0000-000000000004');
      insert into cosme_metrics.test_grants(user_id,role) values
        ('00000000-0000-0000-0000-000000000001','owner'),
        ('00000000-0000-0000-0000-000000000002','editor'),
        ('00000000-0000-0000-0000-000000000003','reader');
    `);
    await db.exec(readFileSync(new URL('../supabase/migrations/20261102053127_cosme_project_library.sql',import.meta.url),'utf8'));
    const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
    const actor=async(n,role='authenticated')=>{
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`:'']);
      await db.exec('set role '+role);
    };
    const save=metadata=>scalar('select public.cosme_library_save($1,$2::jsonb)', ['reports',JSON.stringify(metadata)]);
    const data={title:'Synthetic report',project:'Solar Drying Tables',prototype:'V1.2',submitted_on:'2026-11-02',mime_type:'application/pdf',byte_size:123,filename:'sample.pdf'};
    await actor(1);
    const folder=await scalar("select public.cosme_library_add_folder('reports','Closeout reports')");
    const item=await save({...data,folder_id:folder});
    assert.equal((await scalar("select public.cosme_library_list('reports')")).items.length,0,'pending files must be hidden');
    await assert.rejects(db.query('select public.cosme_library_finish($1)',[item.id]),/missing/);
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name,metadata) values('cosme-project-library','reports/arbitrary.pdf','{}')"),/row-level security/);
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('cosme-project-library',$1,$2::jsonb)",[item.object_path,JSON.stringify({size:122,mimetype:'application/pdf'})]);
    assert.equal((await db.query('select * from storage.objects')).rows.length,0,'pending upload cannot be read');
    await assert.rejects(db.query('select public.cosme_library_finish($1)',[item.id]),/do not match/);
    await db.exec('reset role');
    await db.query("update storage.objects set metadata=$1::jsonb where name=$2",[JSON.stringify({size:123,mimetype:'image/png'}),item.object_path]);
    await actor(1);
    await assert.rejects(db.query('select public.cosme_library_finish($1)',[item.id]),/do not match/);
    await db.exec('reset role');
    await db.query("update storage.objects set metadata=$1::jsonb where name=$2",[JSON.stringify({size:123,mimetype:'application/pdf'}),item.object_path]);
    await actor(1);
    await db.query('select public.cosme_library_finish($1)',[item.id]);
    await db.query('select public.cosme_library_finish($1)',[item.id]);
    assert.equal((await db.query('select * from storage.objects')).rows.length,1);
    assert.equal(await scalar('select public.cosme_library_object_allowed($1,true)',[item.object_path]),false,'ready files cannot be replaced');
    await assert.rejects(db.query('select * from cosme_metrics.library_items'),/permission denied/);
    await assert.rejects(db.query('update storage.objects set metadata=metadata'),/permission denied/);
    await assert.rejects(save({...data,byte_size:30*1024*1024}),/check constraint/);
    await assert.rejects(save({...data,mime_type:'text/html'}),/Unsupported/);
    await assert.rejects(save({...data,mime_type:'image/png'}),/check constraint/);
    const photoFolder=await scalar("select public.cosme_library_add_folder('photos','Site photos')");
    await assert.rejects(save({...data,folder_id:photoFolder}),/does not belong/);
    await actor(2);
    const edited=await scalar('select public.cosme_library_save($1,$2::jsonb,$3,$4)', ['reports',JSON.stringify({...data,title:'Edited reference'}),item.id,1]);
    assert.equal(edited.revision,2);assert.equal(edited.object_path,item.object_path);
    await assert.rejects(db.query('select public.cosme_library_save($1,$2::jsonb,$3,$4)',['reports',JSON.stringify(data),item.id,1]),/changed/);
    const editorPending=await save(data);
    await actor(1);
    assert.equal(await scalar('select public.cosme_library_object_allowed($1,true)',[editorPending.object_path]),false,'another editor cannot use an upload reservation');
    await db.exec('reset role');
    await db.query("update cosme_metrics.library_items set created_at=now()-interval '2 hours' where id=$1",[editorPending.id]);
    await actor(2);
    assert.equal(await scalar('select public.cosme_library_object_allowed($1,true)',[editorPending.object_path]),false,'expired reservations cannot upload');
    await actor(3);
    assert.equal((await scalar("select public.cosme_library_list('reports')")).can_edit,false);
    assert.equal((await db.query('select * from storage.objects')).rows.length,1);
    await assert.rejects(save(data),/editor access/);
    await assert.rejects(db.query("select public.cosme_library_add_folder('reports','Denied')"),/editor access/);
    await assert.rejects(db.query('select public.cosme_library_finish($1)',[editorPending.id]),/editor access/);
    await actor(4);
    await assert.rejects(db.query("select public.cosme_library_list('reports')"),/access required/);
    assert.equal((await db.query('select * from storage.objects')).rows.length,0);
    await actor(null,'anon');
    await assert.rejects(db.query("select public.cosme_library_list('reports')"),/permission denied/);
    await actor(null);
    await assert.rejects(db.query("select public.cosme_library_list('reports')"),/access required/);
    await actor(1);
    const competing=await save(data);
    const replacement=await save({...data,title:'Current replacement',report_type:'Report',submitted_on:'2026-11-02'});
    assert.equal(replacement.file_version,2);
    assert.equal((await scalar("select public.cosme_library_list('reports')")).items[0].id,item.id,'old PDF stays current during upload');
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('cosme-project-library',$1,$2::jsonb)",[replacement.object_path,JSON.stringify({size:123,mimetype:'application/pdf'})]);
    await db.query('select public.cosme_library_finish($1)',[replacement.id]);
    await db.query('select public.cosme_library_finish($1)',[replacement.id]);
    const current=(await scalar("select public.cosme_library_list('reports')")).items;
    assert.equal(current.length,1);assert.equal(current[0].id,replacement.id);
    assert.equal(await scalar('select public.cosme_library_object_allowed($1,false)',[item.object_path]),false,'superseded PDFs cannot be read through Storage');
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('cosme-project-library',$1,$2::jsonb)",[competing.object_path,JSON.stringify({size:123,mimetype:'application/pdf'})]);
    await assert.rejects(db.query('select public.cosme_library_finish($1)',[competing.id]),/current report changed/);
    assert.equal((await scalar("select public.cosme_library_list('reports')")).items[0].id,replacement.id,'stale replacement must not overwrite the current PDF');
    await assert.rejects(db.query('select public.cosme_library_finish($1)',[editorPending.id]),/reservation not found/);
    await actor(1);await db.exec('reset role');
    assert.equal(await scalar("select public from storage.buckets where id='cosme-project-library'"),false);
    await db.query('update cosme_metrics.test_grants set active=false where user_id=$1',['00000000-0000-0000-0000-000000000001']);
    await actor(1);
    await assert.rejects(db.query("select public.cosme_library_list('reports')"),/access required/);
    assert.equal((await db.query('select * from storage.objects')).rows.length,0,'revoked grant stops file access');
  }finally{await db.close()}
});

