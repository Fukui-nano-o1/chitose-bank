import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_LISTING_FLOW, LISTING_NAV_VERSION, adjacentListingPage, legacyNumberForPage, parseListingRoute, listingPageHash, resolveListingResume, validSchedule, validHeadcount, isListingInputPage } from '../src/features/jobs/create/listingNavigation.js';
import { LEGACY_LISTING_STEPS, listingFrameState } from '../src/features/jobs/create/flowSteps.js';
import { serializeJobForm, jobFormFromRow, jobPayloadFromForm } from '../src/features/jobs/create/jobInputCodec.js';
import { jobInputSample, jobInputOptions } from './fixtures/job-input.js';
import { JOB_DRAFT_FIELDS } from '../src/lib/jobInputFields.js';
const range = {start:'2026-12-29',end:'2027-01-03'};
test('stage 2 adds only holidays and headcount; every saved legacy number retains its meaning', () => {
  assert.ok(Object.isFrozen(ACTIVE_LISTING_FLOW));
  assert.deepEqual(ACTIVE_LISTING_FLOW.slice(3,8),['workplace','schedule','holidays','headcount','terms']);
  for(const [number,id] of Object.entries(LEGACY_LISTING_STEPS['2026-10-05'])) assert.equal(legacyNumberForPage(id),Number(number));
  for(const id of ['schedule','holidays','headcount']) { assert.equal(legacyNumberForPage(id),4); assert.equal(listingFrameState(id).valid,true); }
  assert.equal(legacyNumberForPage('terms'),5); assert.equal(legacyNumberForPage('review'),12);
});
test('single-day skips only the holidays page; the backwards path uses the same conditional order', () => {
  for(const end of [null,'2026-12-29']) {
    assert.equal(adjacentListingPage('schedule',1,{start:range.start,end}),'headcount');
    assert.equal(adjacentListingPage('headcount',-1,{start:range.start,end}),'schedule');
  }
  assert.equal(adjacentListingPage('schedule',1,range),'holidays');
  assert.equal(adjacentListingPage('holidays',1,range),'headcount');
  assert.equal(adjacentListingPage('headcount',-1,range),'holidays');
  assert.equal(adjacentListingPage('holidays',-1,range),'schedule');
  assert.equal(adjacentListingPage('terms',-1,range),'headcount');
  assert.equal(adjacentListingPage('future',1,range),null);
});
test('new, edit and local URLs are distinct, preserve return-to-review, and reject unknown IDs', () => {
  for(const scope of ['work/new','work/edit/42','work/local/1234-abcd']) for(const pageId of ACTIVE_LISTING_FLOW.filter(id=>id!=='complete')) {
    const route=parseListingRoute(listingPageHash(scope,pageId,true));
    assert.equal(route.scope,scope);assert.equal(route.pageId,pageId);assert.equal(route.invalid,false);
    assert.equal(route.returnToConfirm,!['intro','review','complete'].includes(pageId));
  }
  assert.equal(parseListingRoute('#/work/new/4').pageId,'schedule');
  assert.equal(parseListingRoute('#/work/new/5').pageId,'terms');
  assert.equal(parseListingRoute('#/work/new/99').invalid,true);
  assert.equal(parseListingRoute('#/work/new/page/complete').invalid,true);
  assert.equal(parseListingRoute('#/work/new/13').invalid,true);
  assert.equal(listingPageHash('work/new','complete'),null);
  assert.ok(resolveListingResume({},13).error);
  assert.equal(parseListingRoute('#/work/new/page/future').invalid,true);
  assert.equal(parseListingRoute('#/work/new/3/workplace').auxiliary,true);
  assert.equal(parseListingRoute('#/work/edit/42/workplace').auxiliary,true);
  assert.equal(listingPageHash('work/edit/42/other','headcount'),null);
});
test('resume uses explicit device metadata, rejects unknown generations, and never invents a DB completion', () => {
  const old=Object.freeze({farmerStep:4,jobDateStart:range.start,jobDateEnd:range.end,jobCount:''});
  assert.deepEqual(resolveListingResume(old,4),{pageId:'holidays',returnToConfirm:false});
  assert.equal(resolveListingResume({...old,jobDateEnd:null},4).pageId,'headcount');
  assert.equal(resolveListingResume({...old,jobDateStart:null},4).pageId,'schedule');
  const metadata={listingPageId:'headcount',listingNavVersion:LISTING_NAV_VERSION,listingReturnToReview:true};
  assert.deepEqual(resolveListingResume({...old,...metadata},4),{pageId:'headcount',returnToConfirm:true});
  assert.ok(resolveListingResume({...metadata,listingNavVersion:'future'},4).error);
  assert.ok(resolveListingResume({...metadata,listingPageId:'future'},4).error);
  assert.ok(resolveListingResume({},99).error);
  assert.equal(JSON.stringify(old),JSON.stringify({farmerStep:4,jobDateStart:range.start,jobDateEnd:range.end,jobCount:''}));
});
test('page validation separates dates from counts and metadata never expands the 44-column payload', () => {
  assert.ok(validSchedule(range.start,range.end));
  assert.ok(!validSchedule('2026-02-30',null));
  assert.ok(!validSchedule(range.end,range.start));
  for(const count of ['',0,-1,1.5,'abc',null]) assert.equal(validHeadcount(count),false);
  for(const count of ['1',3,'12']) assert.equal(validHeadcount(count),true);
  const row=jobInputSample(), input=jobFormFromRow(row,jobInputOptions);
  for(const pageId of ['schedule','holidays','headcount']) {
    const form={...input,farmerStep:legacyNumberForPage(pageId),listingPageId:pageId,listingNavVersion:LISTING_NAV_VERSION};
    const local=serializeJobForm(form); assert.equal(local.listingPageId,pageId);
    const payload=jobPayloadFromForm(form,{ownerId:'owner',base:row});
    assert.equal(payload.draft_step,4);assert.equal(Object.hasOwn(payload,'draft_step_id'),false);
    assert.deepEqual(Object.keys(payload).filter(k=>!['farmer_id','status'].includes(k)).sort(),[...JOB_DRAFT_FIELDS].sort());
    assert.equal(isListingInputPage(pageId),true);
  }
});
