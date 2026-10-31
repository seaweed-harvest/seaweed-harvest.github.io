import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedPicks,validatePickState} from '../assets/js/cosme_metrics_picks.mjs';
import {headlineMetrics,metricCategory,METRIC_CATEGORIES,normalizeReleaseItems,exportSelectedCsv,selectMetrics} from '../assets/js/cosme_metrics_core.mjs';

const metrics=[{id:'TEST-A',title:'Sample A',featured:true,publishedFeatured:true},
  {id:'TEST-B',title:'Sample B',featured:false,publishedFeatured:false}];
function server(canEdit=true){
  const state=new Map(metrics.map(m=>[m.id,{metric_id:m.id,featured:m.featured,revision:0}]));
  const calls=[];
  return {state,calls,async rpc(name,p){
    calls.push({name,p});
    if(name==='cosme_metrics_get_picks')return {data:{can_edit:canEdit,picks:[...state.values()]}};
    if(!canEdit)return {error:new Error('Access denied')};
    const old=state.get(p.p_metric_id);
    if(old.revision!==p.p_expected_revision)return {error:new Error('Conflict')};
    const saved={metric_id:p.p_metric_id,featured:p.p_featured,revision:old.revision+1};
    state.set(saved.metric_id,saved);return {data:saved};
  }};
}
test('one shared selection drives headlines, filter and CSV across sessions',async()=>{
  const client=server(),a=createSharedPicks(client,()=>{});
  await a.load({major:0,minor:2},metrics);
  assert.equal(await a.toggle('TEST-B'),true);
  assert.equal(await a.toggle('TEST-A'),true);
  const b=createSharedPicks(client,()=>{});
  await b.load({major:0,minor:2},metrics);
  const rows=b.apply(metrics);
  assert.deepEqual(headlineMetrics(rows).map(m=>m.id),['TEST-B']);
  assert.deepEqual(selectMetrics(rows,{featured:true}).map(m=>m.id),['TEST-B']);
  assert.match(exportSelectedCsv(rows,'V0.2'),/"Top Pick"/);
  assert.equal(metrics[0].featured,true,'immutable published selection retained');
});
test('readers cannot issue a star write',async()=>{
  const client=server(false),p=createSharedPicks(client,()=>{});
  await p.load({major:0,minor:1},metrics);
  assert.equal(p.editable(),false);assert.equal(await p.toggle('TEST-A'),false);
  assert.equal(client.calls.some(c=>c.name==='cosme_metrics_set_pick'),false);
});
test('conflicting or failed writes retain confirmed state and block blind retries',async()=>{
  const client=server(),p=createSharedPicks(client,()=>{});
  await p.load({major:0,minor:2},metrics);
  client.state.set('TEST-A',{metric_id:'TEST-A',featured:false,revision:1});
  assert.equal(await p.toggle('TEST-A'),false);
  assert.equal(p.apply(metrics)[0].featured,true);assert.equal(p.editable(),false);
  assert.match(p.message(),/could not be confirmed/);
  await p.load({major:0,minor:2},metrics);
  assert.equal(p.apply(metrics)[0].featured,false);assert.equal(p.editable(),true);
});
test('incomplete, duplicate and malformed reads fail closed',async()=>{
  const ids=new Set(metrics.map(m=>m.id));
  const valid={can_edit:true,picks:metrics.map(m=>({metric_id:m.id,featured:m.featured,revision:0}))};
  assert.equal(validatePickState(valid,ids),true);
  for(const bad of [null,{...valid,picks:valid.picks.slice(1)},
    {...valid,picks:[valid.picks[0],valid.picks[0]]},
    {...valid,picks:[{...valid.picks[0],revision:-1},valid.picks[1]]}])assert.equal(validatePickState(bad,ids),false);
  const p=createSharedPicks({rpc:async()=>({error:new Error('Unavailable')})},()=>{});
  await p.load({major:0,minor:2},metrics);
  assert.equal(p.editable(),false);assert.deepEqual(p.apply(metrics),metrics);
});
test('an in-flight response cannot restore state after signout or a version change',async()=>{
  let resolve;
  const client={rpc:()=>new Promise(r=>{resolve=r;})};
  let renders=0;const p=createSharedPicks(client,()=>{renders++;});
  const task=p.load({major:0,minor:2},metrics);p.clear();
  resolve({data:{can_edit:true,picks:metrics.map(m=>({metric_id:m.id,featured:!m.featured,revision:1}))}});
  await task;assert.equal(p.editable(),false);assert.deepEqual(p.apply(metrics),metrics);
  assert.equal(renders,1);
});
test('pending mutations disable duplicate submissions and keep state until acknowledgement',async()=>{
  const client=server(),original=client.rpc.bind(client);let resolve;
  client.rpc=(name,p)=>name==='cosme_metrics_set_pick'?new Promise(r=>{resolve=()=>original(name,p).then(r);}):original(name,p);
  const picks=createSharedPicks(client,()=>{});await picks.load({major:0,minor:2},metrics);
  const pending=picks.toggle('TEST-A');assert.equal(picks.busy('TEST-A'),true);
  assert.equal(picks.apply(metrics)[0].featured,true);
  assert.equal(await picks.toggle('TEST-A'),false);resolve();await pending;
  assert.equal(picks.apply(metrics)[0].featured,false);
});
test('acknowledged save survives a failed readback with an accurate status',async()=>{
  const client=server(),original=client.rpc.bind(client);let reads=0;
  client.rpc=(name,p)=>name==='cosme_metrics_get_picks'&&++reads>1?Promise.resolve({error:new Error('Network')}):original(name,p);
  const picks=createSharedPicks(client,()=>{});await picks.load({major:0,minor:2},metrics);
  assert.equal(await picks.toggle('TEST-B'),true);assert.equal(picks.apply(metrics)[1].featured,true);
  assert.match(picks.message(),/was saved/);
});
test('eight categories consolidate source themes without erasing the original',()=>{
  assert.equal(Object.keys(METRIC_CATEGORIES).length,8);
  assert.equal(metricCategory('Verification - Perth Datalog'),'Performance & evidence');
  assert.equal(metricCategory('Original Design - 2025'),'Design & capacity');
  assert.equal(metricCategory('Unknown label'),'Other');
  const [m]=normalizeReleaseItems([{metric_id:'TEST-A',frozen:{theme:'Performance & evidence',original:{theme:'Verification - Datalog'}}}]);
  assert.equal(m.theme,'Performance & evidence');assert.equal(m.originalTheme,'Verification - Datalog');
  assert.match(exportSelectedCsv([m],'V0.2'),/Verification - Datalog/);
});
