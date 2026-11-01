import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hasMetricValue,populatedMetrics,metricEvidence,concisePickStatus} from '../assets/js/cosme_metrics_presentation.js';
import {selectMetrics,exportSelectedCsv} from '../assets/js/cosme_metrics_core.mjs';

test('omit empty and placeholder values while retaining zero and meaningful negative findings',()=>{
  for(const value of [null,'','  ','—','Not yet available','Not reported','Not verified','Records not verified','Completion evidence outstanding','Pending design confirmation','Unconfirmed','Not measured','No data']){
    assert.equal(hasMetricValue({value}),false,String(value));
  }
  for(const value of [0,'0','Not detected','Observed structural failure','Conditional pass','8 / 12','17, 20, 18']){
    assert.equal(hasMetricValue({value}),true,String(value));
  }
  assert.equal(hasMetricValue({value:'Unspecified',valueState:'not_established'}),false);
});
test('visible register, highlights and export can use the same nonmutating population',()=>{
  const all=[{id:'A',value:'',featured:true},{id:'B',value:'0',featured:true},{id:'C',value:'Not detected',featured:false}];
  const available=populatedMetrics(all);
  assert.deepEqual(available.map(m=>m.id),['B','C']);
  assert.deepEqual(selectMetrics(available,{featured:true}).map(m=>m.id),['B']);
  const csv=exportSelectedCsv(available,'V0.2');
  assert.ok(!csv.includes('"A",'));assert.ok(csv.includes('"0"'));
  assert.equal(all.length,3);assert.equal(all[0].featured,true);
});
test('group evidence requires a bounded unique list with an explicit source and location',()=>{
  const source={groups:['Group A','Group B'],source:'Synthetic assessment',locator:'Matrix row 7',method:'Matched synthetic response cells'};
  const parsed=metricEvidence(source);
  assert.deepEqual(parsed,source);assert.notEqual(parsed.groups,source.groups);
  for(const invalid of [null,{...source,groups:[]},{...source,groups:['Group A','Group A']},
    {...source,groups:['']},{...source,source:''},{...source,locator:''},{...source,groups:['A'.repeat(181)]}]){
    assert.equal(metricEvidence(invalid),null);
  }
});
test('routine guidance disappears while actionable save and error states remain',()=>{
  assert.equal(concisePickStatus('Shared project Top Picks · select a star to update them for every reader.'),'');
  assert.equal(concisePickStatus('Saving shared Top Picks…'),'Saving…');
  assert.equal(concisePickStatus('Top Picks saved for every reader.'),'Saved');
  assert.equal(concisePickStatus('The shared change could not be confirmed.'),'The shared change could not be confirmed.');
});
test('overview is separate from current feeds and has no explanatory footer or star controls',()=>{
  const html=readFileSync(new URL('../cosme_metrics.html',import.meta.url),'utf8');
  const page=readFileSync(new URL('../assets/js/cosme_metrics_page.js',import.meta.url),'utf8');
  const overview=html.split('<section id="overview">')[1].split('<section id="current"')[0];
  assert.ok(!overview.includes('currentDryerMetrics'));
  assert.ok(!html.includes('About this register'));
  assert.ok(!html.includes('Stars select the shared project Top Picks for every reader.'));
  const cards=page.split('const cards = el("activityCards");')[1].split('renderCategoryChoices();')[0];
  assert.ok(cards);
  assert.ok(!cards.includes('configureStar'));
  assert.ok(!cards.includes('metric.note'));
  assert.match(page,/function renderRegisterSummary\(\)/);
  assert.match(page,/metrics-value-open/);
  assert.match(page,/metricEvidence/);
  assert.match(html,/<details class="metrics-record-details"><summary>Record details<\/summary><dl id="metricMetadata">/);
});
