import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordedPhotoCounts,lastCompletedBackup,visibleBackupOrganisations} from '../../assets/js/backup_summary.mjs';
test('internal archive organisation is excluded only from display choices and the source inventory is unchanged',()=>{
 const archived={id:'f207d31e-0b35-4f21-b405-2588d2347b7f',name:'Green Space Project Sandbox',record_count:1704};
 const active={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'COSME',record_count:80};
 const rows=[active,archived];
 assert.deepEqual(visibleBackupOrganisations(rows),[active]);
 assert.equal(rows.length,2,'Full archive data must remain untouched');
 assert.equal(rows.reduce((count,row)=>count+row.record_count,0),1784);
 assert.deepEqual(visibleBackupOrganisations(null),[]);
});
test('new-or-changed photo counts compare versions, identity, size and known checksum without claiming disk verification',()=>{
 const row={object_id:'one',object_version:'v1',bucket_id:'photos',object_path:'one.jpg',byte_size:3,archive:{sha256:'right'}};
 const saved={...row,sha256:'right'};
 assert.deepEqual(recordedPhotoCounts([row],{files:[saved]}),{recorded:1,newOrChanged:0});
 for(const change of [{object_version:'v2'},{byte_size:4},{bucket_id:'elsewhere'},{object_path:'other.jpg'},{sha256:'wrong'}])
   assert.deepEqual(recordedPhotoCounts([row],{files:[{...saved,...change}]}),{recorded:0,newOrChanged:1});
});
test('backup history only reports completed matching coverage and separates interrupted or incomplete attempts',()=>{
 const complete={status:'complete',relative_path:'snapshots/a.json',sha256:'hash',organisation_ids:null,
   completed_at:'2026-10-30T10:00:00Z',photos_requested:true,photo_results:{saved:1,reused:2,failed:0,skipped:0,pending:0}};
 for(const change of [{status:'running'},{status:'stopped'},{status:'incomplete'},
   {photo_results:{failed:1}},{photo_results:{pending:1}},{missing_linked_photo_references:1}]){
   assert.equal(lastCompletedBackup({snapshots:[{...complete,...change}]},null),null);
 }
 assert.equal(lastCompletedBackup({snapshots:[complete]},['a']),complete);
 assert.equal(lastCompletedBackup({snapshots:[{...complete,organisation_ids:['b']}]},['a']),null);
 assert.equal(lastCompletedBackup({snapshots:[{...complete,organisation_ids:['a']}]},null),null);
 assert.equal(lastCompletedBackup({snapshots:[complete,{...complete,status:'stopped',completed_at:'2026-10-31T10:00:00Z'}]},null),complete);
});
