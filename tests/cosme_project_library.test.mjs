import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filterLibrary,libraryMetadata,validateLibraryFile,EXAMPLES,localDateTime} from '../assets/js/cosme_project_library_core.mjs';
import {expenseActivity,expenseCategory,expenseOverview,itemDescription} from '../assets/js/cosme_finances_view.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const other={activity:'COSME Procurement — Project / Other'};
test('software is independent while explicit logger products and connectivity are retained',()=>{
  assert.equal(expenseActivity(other,{category:'Software',original_product:'T/H Sensing',description:'Electornics'}),'Software');
  const connectivity={original_product:'T/H Sensing',description:'Electronics',item_detail:'SIM Credit'};
  assert.equal(expenseActivity(other,connectivity),'Data Loggers');
  assert.equal(expenseCategory(connectivity,'Data Loggers'),'Connectivity');
  assert.equal(expenseActivity(other,{original_product:'Offshore Nursery',category:'Travel',description:'Ferry'}),'Offshore Nursery');
  assert.equal(expenseActivity(other,{description:'COSME Kenyan Contractors'}),'Project / Other');
  assert.equal(itemDescription({description:'Expense',amount:-50}),'Credit / adjustment');
});
test('expense regrouping preserves excluded, negative, missing amounts, currencies and bases',()=>{
  const lines=[{id:'a',amount:30,description:'Software',category:'Software'},
    {id:'b',amount:-3,description:'Storage'},{id:'c',amount:500,included_in_total:false},
    {id:'d',amount:null}];
  const entries=[{...other,id:'p',currency:'CAD',basis:'paid',lines},
    {...other,id:'q',currency:'KES',basis:'paid',lines:[{id:'e',amount:100}]},
    {...other,id:'r',currency:'CAD',basis:'estimated',lines:[{id:'f',amount:40}]}];
  const before=JSON.stringify(entries),result=expenseOverview(entries);
  assert.equal(JSON.stringify(entries),before);
  assert.equal(result.flatMap(x=>x.lines).length,6);
  assert.equal(result.filter(x=>x.currency==='CAD'&&x.basis==='paid').reduce((s,x)=>s+x.summary.total,0),27);
  assert.equal(result.find(x=>x.currency==='KES').summary.total,100);
  assert.equal(result.find(x=>x.basis==='estimated').summary.total,40);
});
test('combined filters match prototype, project, asset, folder and date; unknown capture dates are not invented',()=>{
  const rows=[{id:'a',title:'Meter',project:'Mawimbi',asset:'Brix meter',folder_id:'f',captured_at:'2026-10-04T12:00:00Z'},
    {id:'b',title:'Meter',project:'Mawimbi',asset:'Brix meter'},
    {id:'c',title:'Table',project:'Solar Drying Tables',prototype:'V1.2'}];
  assert.deepEqual(filterLibrary(rows,{project:'Mawimbi',asset:'Brix meter',folder:'f',from:'2026-10-01',to:'2026-10-31'}).map(x=>x.id),['a']);
  assert.deepEqual(filterLibrary(rows,{search:'v1.2'}).map(x=>x.id),['c']);
  assert.equal(filterLibrary(rows,{location:'Unknown'}).length,0);
  assert.ok(EXAMPLES.every(x=>x.example&&!x.object_path&&!x.captured_at));
});
test('metadata validation trims fields, keeps missing time null and converts local time consistently',()=>{
  const input={title:' Title ',project:'Mawimbi',asset:'Instrument-1'};
  assert.equal(libraryMetadata(input).title,'Title');assert.equal(libraryMetadata(input).captured_at,null);
  assert.throws(()=>libraryMetadata({...input,title:''}),/title/);
  assert.throws(()=>libraryMetadata({...input,captured_at:'nonsense'}),/date/);
  const iso='2026-10-04T12:30:00Z';assert.equal(new Date(localDateTime(iso)).toISOString(),iso.replace(':00Z',':00.000Z'));
});
test('report register uses submission dates and report types independently of photo capture dates',()=>{
  const row={kind:'reports',title:'Sample report',project:'Solar Drying Tables',report_type:'Closeout',submitted_on:'2026-11-02'};
  assert.equal(filterLibrary([row],{from:'2026-11-02',to:'2026-11-02',report_type:'Closeout'}).length,1);
  assert.equal(filterLibrary([row],{report_type:'Verification'}).length,0);
  assert.throws(()=>libraryMetadata({title:'Report',project:'Solar Drying Tables'},'reports'),/submission|submitted/);
  const code=read('../assets/js/cosme_project_library.mjs');
  assert.match(code,/library-report-table/);assert.match(code,/Replace PDF/);assert.match(code,/file_version/);
  assert.match(code,/if\(kind===\"photos\"\)button\(actions,\"New folder\"/);
});
test('file bytes, non-empty size and size limits control accepted reports and photos',async()=>{
  const file=(name,bytes,size=bytes.length)=>({name,size,slice:()=>new Blob([new Uint8Array(bytes)])});
  assert.equal((await validateLibraryFile('reports',file('x.pdf',[37,80,68,70,45]))).mime_type,'application/pdf');
  assert.equal((await validateLibraryFile('photos',file('x.jpg',[255,216,255,0]))).mime_type,'image/jpeg');
  await assert.rejects(validateLibraryFile('reports',file('fake.pdf',[0,1,2])),/PDF/);
  await assert.rejects(validateLibraryFile('photos',file('x.pdf',[37,80,68,70,45])),/JPG/);
  await assert.rejects(validateLibraryFile('reports',file('x.pdf',[37,80,68,70,45],21*1024*1024)),/20 MB/);
  await assert.rejects(validateLibraryFile('photos',file('empty.jpg',[])),/non-empty/);
});
test('phone expense rows omit worksheet positions and retain dates, quantities and software relationship',()=>{
  const code=read('../assets/js/cosme_finances_panel.mjs').split('const compact=')[1].split('function costSections')[0];
  assert.doesNotMatch(code,/source_row/);assert.match(code,/entry_date/);assert.match(code,/For Data Loggers/);
});
test('both tabs share existing access lifecycle; uploads use immutable private paths, no local data storage',()=>{
  const page=read('../assets/js/cosme_metrics_page.js'),html=read('../cosme_metrics.html');
  assert.match(page,/libraries\[name\]&&access/);assert.match(page,/panel=>panel\.clear\(\)/);
  for(const id of ['reports','photos'])assert.match(html,new RegExp(`data-tab="${id}"`));
  const code=read('../assets/js/cosme_project_library.mjs');
  assert.match(code,/upsert:false/);assert.match(code,/createSignedUrl\(item.object_path,60[,)]/);
  assert.match(code,/download:true/);
  assert.match(code,/viewer.showModal\(\)/);assert.match(code,/navigator.pdfViewerEnabled/);
  assert.doesNotMatch(code,/localStorage|sessionStorage|innerHTML|getPublicUrl/);
});
