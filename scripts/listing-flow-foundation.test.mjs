import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FARMER_FLOW, legacyStepId, listingFrameState, stepNumber, nextStepId, previousStepId } from '../src/features/jobs/create/flowSteps.js';
import { SINGLE_TOPIC_PAGES, AUXILIARY_LISTING_PAGES, NON_INPUT_COLUMNS, LEGACY_PAGE_TARGETS, plannedResumeCandidates, PRESERVED_SNAPSHOT_FIELDS } from '../src/features/jobs/create/listingPagePlan.js';
import { JOB_DRAFT_FIELDS } from '../src/lib/jobInputFields.js';

const existing = ['crop','task','workplace','schedule','terms','details_intro','photos','description','work_video','danger','wishes','review','complete'];
test('stage 1 leaves every live page number and order unchanged', () => {
  assert.deepEqual(FARMER_FLOW, existing);
  existing.forEach((id, i) => { assert.equal(stepNumber(id), i+1); assert.equal(legacyStepId(i+1), id); assert.equal(nextStepId(id), existing[i+1] || null); assert.equal(previousStepId(id), existing[i-1] || null); });
  assert.ok(Object.isFrozen(FARMER_FLOW));
});
test('both historic numbering generations have explicit mappings, with no unknown-version guess', () => {
  const old = [...existing]; old.splice(8, 1);
  old.forEach((id, i) => assert.equal(legacyStepId(i+1, 'pre-video'), id));
  assert.equal(legacyStepId(9, '2026-10-05'), 'work_video');
  assert.equal(legacyStepId(9, 'pre-video'), 'danger');
  for (const bad of [-1, 1.5, 99, null, undefined, {}, 'abc', '']) assert.equal(legacyStepId(bad), null);
  assert.equal(legacyStepId(4, 'unknown-version'), null);
});
test('legacy and named page IDs produce identical stage, footer, width and progress decisions', () => {
  for (let n = 0; n <= 12; n++) {
    const id = n === 0 ? 'intro' : existing[n-1];
    const frame = listingFrameState(n);
    assert.deepEqual(frame, listingFrameState(id));
    assert.equal(frame.stage, n >= 12 ? 2 : n >= 6 ? 1 : 0);
    assert.deepEqual(frame.progress, [Math.min(n/6,1), Math.max(0,Math.min((n-6)/6,1)), n>=12 ? 0.5 : 0]);
    assert.equal(frame.skipDetails, n>=6 && n<=11);
    assert.equal(frame.wide, [0,6,12].includes(n));
    assert.equal(frame.lastDetail, n===11);
  }
  assert.equal(listingFrameState('missing').valid, false);
});
test('all permitted input columns have exactly one owner or an explicit preservation policy', () => {
  const owned = SINGLE_TOPIC_PAGES.flatMap(p => p.columns);
  const accounted = [...owned, ...Object.keys(NON_INPUT_COLUMNS)];
  assert.equal(new Set(accounted).size, accounted.length, 'no duplicated column owner');
  assert.deepEqual([...accounted].sort(), [...JOB_DRAFT_FIELDS].sort(), 'no lost or invented storage columns');
  const fields = SINGLE_TOPIC_PAGES.flatMap(p => p.formFields);
  assert.equal(new Set(fields).size, fields.length, 'no duplicate state owner');
  assert.deepEqual(PRESERVED_SNAPSHOT_FIELDS, ['draft_step_id']);
});
test('single-topic contract separates calendar, headcount, hours, breaks, pay and unrelated details', () => {
  const p = Object.fromEntries(SINGLE_TOPIC_PAGES.map(x => [x.id, x]));
  assert.deepEqual(p.schedule.formFields, ['jobDateStart','jobDateEnd']);
  assert.deepEqual(p.headcount.formFields, ['jobCount']);
  assert.deepEqual(p.break_time.columns, ['break_time']);
  assert.deepEqual(p.daily_wage.columns, ['daily_wage']);
  assert.deepEqual(p.description.formFields, ['jobDescription']);
  assert.deepEqual(p.belongings.columns, ['belongings']);
  assert.deepEqual(p.cautions.columns, ['cautions']);
  assert.equal(p.photo_captions.storageOwner, 'photos');
  assert.equal(p.video_consent.condition, 'has-video');
  assert.equal(p.holidays.condition, 'multi-day');
});
test('every page, auxiliary parent and legacy destination has a unique stable ID', () => {
  const all = [...SINGLE_TOPIC_PAGES, ...AUXILIARY_LISTING_PAGES];
  const ids = all.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of all) { assert.match(p.id,/^[a-z_]+$/); if(p.parent) assert.ok(ids.includes(p.parent)); assert.ok(Object.isFrozen(p)); }
  for (const id of ['intro',...existing]) {
    assert.ok(LEGACY_PAGE_TARGETS[id].length);
    for(const target of LEGACY_PAGE_TARGETS[id]) assert.ok(ids.includes(target));
  }
});
test('resume translation preserves source data, unknown IDs and old video-era ambiguity', () => {
  const draft = Object.freeze({legacyStep:4, legacyVersion:'2026-10-05', form:Object.freeze({jobCount:'3',jobHolidays:['2026-11-02']})});
  const before = JSON.stringify(draft);
  assert.deepEqual(plannedResumeCandidates(draft), ['schedule','holidays','headcount']);
  assert.equal(JSON.stringify(draft), before);
  assert.deepEqual(plannedResumeCandidates({pageId:'headcount',legacyStep:4}), ['headcount']);
  assert.deepEqual(plannedResumeCandidates({pageId:'future_page',legacyStep:4}), []);
  assert.deepEqual(plannedResumeCandidates({legacyStep:9,legacyVersion:'pre-video'}), ['danger_places','danger_tasks']);
  assert.deepEqual(plannedResumeCandidates({legacyStep:9}), ['work_video','video_consent']);
  assert.deepEqual(plannedResumeCandidates({legacyStep:5}), ['work_time','break_time','overtime','daily_wage']);
  const answer = plannedResumeCandidates(draft); answer.push('extra');
  assert.deepEqual(plannedResumeCandidates(draft), ['schedule','holidays','headcount']);
  assert.deepEqual(plannedResumeCandidates({legacyStep:4,legacyVersion:'future'}), []);
});
test('live listing uses the common frame and retains independent stage-2 schedule pages', async () => {
  const code = await readFile(new URL('../src/features/jobs/create/LandingFlow.jsx', import.meta.url), 'utf8');
  assert.match(code, /import \{ ListingPage \} from "\.\/components\/ListingPage"/);
  assert.match(code, /<ListingPage key=\{isFarmer \? pageId : step\}/);
  assert.ok(!code.includes('SINGLE_TOPIC_PAGES'));
  assert.match(code, /pageId === "schedule" && farmerPurpose === "post"/);
  assert.ok(!code.includes("いつ、何人に来てほしいですか"));
  for (const name of ["StepSchedule", "StepHolidays", "StepHeadcount"]) assert.ok(code.includes(`<${name}`));
});
