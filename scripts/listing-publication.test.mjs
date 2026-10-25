import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_LISTING_FLOW, LISTING_NAV_VERSION, listingPageHash, parseListingRoute, legacyNumberForPage, resolveListingResume, adjacentListingPage } from '../src/features/jobs/create/listingNavigation.js';
import { listingFrameState } from '../src/features/jobs/create/flowSteps.js';
import { normalizeRecruiterDraft, recruiterValues, missingRecruiterPages, recruiterKeys } from '../src/features/jobs/create/listingPublicationPages.js';

const pages = ['recruiter_name','recruiter_address','recruiter_contact','smoking_policy','review','publish_consent'];
test('stage5 pages have URLs, common frame and unchanged legacy DB number 12', () => {
  for (const pageId of pages) {
    assert.ok(ACTIVE_LISTING_FLOW.includes(pageId)); assert.equal(legacyNumberForPage(pageId),12);
    const frame=listingFrameState(pageId); assert.equal(frame.valid,true); assert.equal(frame.stage,2);
    for (const scope of ['work/new','work/edit/42','work/local/ab12-34']) {
      const route=parseListingRoute(listingPageHash(scope,pageId,true));assert.equal(route.pageId,pageId);assert.equal(route.scope,scope);
    }
  }
  assert.equal(listingFrameState('publish_consent').consent,true);
  assert.equal(listingPageHash('work/new','complete'),null);
  assert.equal(parseListingRoute('#/work/new/page/complete').invalid,true);
});
test('known stage4 drafts upgrade without inventing stage5 pages in old data',()=>{
  for(const id of ['photos','photo_captions','description','video_consent','danger_places','cautions','review'])assert.equal(resolveListingResume({listingNavVersion:'2026-10-23-stage4',listingPageId:id}).pageId,id);
  assert.ok(resolveListingResume({listingNavVersion:'2026-10-23-stage4',listingPageId:'publish_consent'}).error);
  assert.equal(resolveListingResume({listingNavVersion:LISTING_NAV_VERSION,listingPageId:'publish_consent'}).pageId,'publish_consent');
});
test('recruiter pages skip only confirmed registered fields and preserve their direct edit routes',()=>{
  assert.equal(adjacentListingPage('repeat_approval',1),'review');
  assert.equal(adjacentListingPage('repeat_approval',1,{missingRecruiter:['recruiter_contact']}),'recruiter_contact');
  assert.equal(adjacentListingPage('recruiter_name',1,{missingRecruiter:['recruiter_contact']}),'recruiter_contact');
  assert.equal(adjacentListingPage('recruiter_contact',1),'review');
  assert.equal(adjacentListingPage('review',1),'publish_consent');
  assert.equal(adjacentListingPage('publish_consent',-1),'review');
});
test('local recruiter draft is an allowlist, keeps empty edits, and never treats typed values as server confirmation',()=>{
  const profile={recruiter_name:'登録名',recruiter_address:'住所',recruiter_contact:'連絡先',smoking_policy:'敷地内禁煙'};
  const draft=normalizeRecruiterDraft({recruiter_name:{value:'',base:'登録名'},role:{value:'admin',base:''},recruiter_contact:{value:1,base:''}});
  assert.deepEqual(Object.keys(draft),['recruiter_name']);assert.equal(recruiterValues(profile,draft).recruiter_name,'');
  assert.deepEqual(missingRecruiterPages(profile,draft),['recruiter_name']);assert.deepEqual(missingRecruiterPages(profile),[]);
  assert.deepEqual(recruiterKeys('smoking_policy'),['smoking_policy','smoking_area']);assert.deepEqual(recruiterKeys('role'),[]);
});
