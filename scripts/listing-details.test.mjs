import test from "node:test";
import assert from "node:assert/strict";
import { ACTIVE_LISTING_FLOW, adjacentListingPage, legacyNumberForPage, resolveListingResume, listingPageHash, parseListingRoute } from "../src/features/jobs/create/listingNavigation.js";

const pages = ["photos","photo_captions","description","work_video","video_consent","danger_places","danger_tasks","belongings","cautions","worker_preferences","repeat_approval"];
test("stage4 has independent page IDs and stable old DB step numbers", () => {
  for (const id of pages) {
    assert.equal(ACTIVE_LISTING_FLOW.filter(p=>p===id).length, 1, id);
    assert.ok(Number.isInteger(legacyNumberForPage(id)), id);
    const hash = listingPageHash("work/new",id);
    assert.equal(parseListingRoute(hash).pageId,id);
  }
});
test("conditional pages skip only when there is no content", () => {
  assert.equal(adjacentListingPage("photos",1,{photoCount:0}),"description");
  assert.equal(adjacentListingPage("photos",1,{photoCount:2}),"photo_captions");
  assert.equal(adjacentListingPage("work_video",1,{hasVideo:false}),"danger_places");
  assert.equal(adjacentListingPage("work_video",1,{hasVideo:true}),"video_consent");
});
test("stage3 drafts and old detail steps resolve without losing existing fields", () => {
  assert.equal(resolveListingResume({listingNavVersion:"2026-10-23-stage3",listingPageId:"danger"}).pageId,"danger_places");
  assert.equal(resolveListingResume({listingNavVersion:"2026-10-23-stage3",listingPageId:"wishes"}).pageId,"belongings");
  assert.equal(resolveListingResume({},10).pageId,"danger_places");
  assert.equal(resolveListingResume({},11).pageId,"belongings");
  assert.equal(resolveListingResume({listingNavVersion:"unknown",listingPageId:"photos"}).error,"unknown_saved_page");
});
