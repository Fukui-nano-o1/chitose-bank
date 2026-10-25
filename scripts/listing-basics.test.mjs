import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIVE_LISTING_FLOW, LISTING_NAV_VERSION, PREVIOUS_LISTING_NAV_VERSION, legacyNumberForPage, adjacentListingPage, parseListingRoute, listingPageHash, resolveListingResume } from '../src/features/jobs/create/listingNavigation.js';
import { listingFrameState, FARMER_FLOW } from '../src/features/jobs/create/flowSteps.js';
import { serializeJobForm, jobFormFromRow, jobPayloadFromForm } from '../src/features/jobs/create/jobInputCodec.js';
import { jobInputSample, jobInputOptions } from './fixtures/job-input.js';
import { JOB_DRAFT_FIELDS } from '../src/lib/jobInputFields.js';
const topics=['task','task_scope','workplace','place_scope','access','work_time','break_time','overtime','daily_wage'];

test('stage 4 retains basic topics and expands details into single-topic pages',()=>{
  assert.deepEqual(ACTIVE_LISTING_FLOW, ['intro','crop','task','task_scope','workplace','place_scope','access','schedule','holidays','headcount','work_time','break_time','overtime','daily_wage','details_intro','photos','photo_captions','description','work_video','video_consent','danger_places','danger_tasks','belongings','cautions','worker_preferences','repeat_approval','review','complete']);
  assert.ok(!ACTIVE_LISTING_FLOW.includes('terms'));
  for(const [n,id] of FARMER_FLOW.entries()) assert.equal(legacyNumberForPage(id), n+1);
  assert.equal(legacyNumberForPage('task_scope'),2);
  for(const id of ['place_scope','access']) assert.equal(legacyNumberForPage(id),3);
  for(const id of ['work_time','break_time','overtime','daily_wage']) assert.equal(legacyNumberForPage(id),5);
});
test('basic frame has one stage, monotonically advancing progress, common widths and a local access skip',()=>{
  let last=0;
  for(const id of ACTIVE_LISTING_FLOW.slice(0,14)) {
    const frame=listingFrameState(id);assert.equal(frame.valid,true);assert.equal(frame.stage,0);
    assert.ok(frame.progress[0]>=last);last=frame.progress[0];assert.equal(frame.skipDetails,id==='access');
    if(id!=='intro')assert.equal(frame.wide,false);
  }
  const range={start:'2026-12-01',end:'2026-12-05'};
  for(const id of topics) {
    const next=adjacentListingPage(id,1,range);
    assert.equal(adjacentListingPage(next,-1,range),id);
  }
  assert.equal(adjacentListingPage('access',1,range),'schedule');
});
test('new/edit/local named URLs and old terms aliases have one canonical target',()=>{
  for(const scope of ['work/new','work/edit/42','work/local/ab12-34']) for(const id of topics) {
    const route=parseListingRoute(listingPageHash(scope,id,true));
    assert.equal(route.pageId,id);assert.equal(route.scope,scope);assert.equal(route.returnToConfirm,true);
  }
  for(const url of ['#/work/new/5','#/work/new/page/terms','#/work/edit/42/page/terms?return=review']) assert.equal(parseListingRoute(url).pageId,'work_time');
  for(const scope of ['work/new','work/edit/42','work/local/ab12-34']) {
    const route=parseListingRoute(`#/${scope}/workplace?return=review`);
    assert.equal(route.auxiliary,true);assert.equal(route.pageId,'workplace');assert.equal(route.returnToConfirm,true);
  }
});
test('known stage 2 positions migrate read-only; unknown versions and invented old IDs do not',()=>{
  const complete=jobFormFromRow(jobInputSample(),jobInputOptions);
  const old=Object.freeze({...complete,listingPageId:'terms',listingNavVersion:PREVIOUS_LISTING_NAV_VERSION,listingReturnToReview:true});
  const before=JSON.stringify(old);
  assert.deepEqual(resolveListingResume(old,5),{pageId:'daily_wage',returnToConfirm:true});
  assert.equal(JSON.stringify(old),before);
  for(const id of ['task','workplace','holidays','headcount','review']) assert.equal(resolveListingResume({...old,listingPageId:id},5).pageId,id);
  assert.ok(resolveListingResume({...old,listingPageId:'daily_wage'},5).error);
  assert.ok(resolveListingResume({...old,listingNavVersion:'future'},5).error);
  assert.ok(resolveListingResume({...old,listingNavVersion:LISTING_NAV_VERSION},5).error);
});
test('old combined conditions resume at the missing topic without inventing time, break or overtime answers',()=>{
  const full=jobFormFromRow(jobInputSample(),jobInputOptions);
  for(const [change,id] of [[{startHour:''},'work_time'],[{breakTime:''},'break_time'],[{overtimePolicy:''},'overtime'],[{overtimePolicy:'あり',overtimeDetail:''},'overtime'],[{},'daily_wage']]) {
    const form=Object.freeze({...full,...change});const before=JSON.stringify(form);
    assert.equal(resolveListingResume(form,5).pageId,id);assert.equal(JSON.stringify(form),before);
  }
});
test('every basic page preserves the 44-column payload and server comparison contract',()=>{
  const row=jobInputSample(), full=jobFormFromRow(row,jobInputOptions);
  for(const id of topics) {
    const form={...full,farmerStep:legacyNumberForPage(id),listingPageId:id,listingNavVersion:LISTING_NAV_VERSION};
    assert.equal(serializeJobForm(form).listingPageId,id);
    const payload=jobPayloadFromForm(form,{ownerId:'owner',base:row});
    assert.equal(payload.draft_step,legacyNumberForPage(id));
    assert.equal(Object.hasOwn(payload,'draft_step_id'),false);
    assert.deepEqual(Object.keys(payload).filter(k=>!['farmer_id','status'].includes(k)).sort(),[...JOB_DRAFT_FIELDS].sort());
    for(const key of JOB_DRAFT_FIELDS.filter(k=>k!=='draft_step')) assert.deepEqual(payload[key],row[key],`${id}: ${key}`);
  }
});
test('no obsolete scope overlay or combined terms body remains in the listing',async()=>{
  const code=await readFile(new URL('../src/features/jobs/create/LandingFlow.jsx',import.meta.url),'utf8');
  for(const removed of ['taskScopePageOpen','placeScopePageOpen','勤務時間と日給を決めましょう'])assert.ok(!code.includes(removed));
  for(const id of topics)assert.ok(code.includes(`pageId === "${id}"`),id);
  assert.match(code,/onSkipDetails=\{pageId === "access" \? goNext/);
});
