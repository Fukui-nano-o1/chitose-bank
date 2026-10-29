import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as legacy from '../src/lib/utils.js';
import * as status from '../src/features/jobs/model/jobStatus.js';
import * as presentation from '../src/features/jobs/model/jobPresentation.js';

test('legacy job exports forward to the same feature implementation', () => {
  for (const [name, implementation] of Object.entries({ ...status, ...presentation })) {
    assert.equal(legacy[name], implementation, name);
  }
});

test('job models do not depend on the legacy utility barrel, UI, storage, or transport', async () => {
  for (const file of ['jobStatus.js', 'jobPresentation.js']) {
    const source = await readFile(new URL(`../src/features/jobs/model/${file}`, import.meta.url), 'utf8');
    const imports = [...source.matchAll(/^import .* from ["']([^"']+)["'];/gm)].map(match => match[1]);
    assert.deepEqual(imports, file === 'jobPresentation.js' ? ['./jobStatus.js'] : []);
    assert.doesNotMatch(source, /\b(?:window|document|localStorage|sessionStorage|fetch|supabase)\b/);
  }
});

test('public row projection retains supplied snapshots and masking without inventing private fields', () => {
  const photos = [{ url: 'https://example.test/photo.jpg', caption: 'Synthetic photo' }];
  const perks = { has_parking: true };
  const insurance = { items: ['synthetic'], notes: {} };
  const row = {
    job_number: 17, crop: 'Synthetic crop', task: 'Synthetic task', date_start: '2099-11-01',
    date_end: '2099-11-03', pay_type: '日給', daily_wage: '10000', prefecture: 'テスト県', city: 'テスト市', town: 'テスト町',
    has_work_address: true, masked_fields: ['work_address', 'recruiter_contact'],
    recruiter_name: 'Synthetic farm', recruiter_address: '', recruiter_contact: '',
    lat: '34', lng: '134', geo_radius_m: '1000', headcount: 2, hired_count: '1', photos,
    perks, insurance_snapshot: insurance, profile_snapshot_at: '2099-10-01T00:00:00Z',
    work_time: '08:00〜16:00', break_time: '60分', pay_method: 'cash',
    pay_timing: 'same_day_after_work', wage_closing_rule: 'each_workday',
    holidays: ['2099-11-02'], danger_places: [null, {}, { label: 'Slope' }],
    danger_tasks: [{ desc: 'Synthetic task note' }, {}], status: 'open',
    private_test_field: 'not part of the projection',
  };
  const before = structuredClone(row);
  const job = presentation.mapJobPublicRow(row);
  assert.deepEqual(job, {
    id: 17, crop: 'Synthetic crop', task: 'Synthetic task',
    dateLabel: '2099/11/1（日） 〜 2099/11/3（火）', dateStartRaw: '2099-11-01', dateEndRaw: '2099-11-03',
    isNew: false, payType: 'daily', pay: 10000, town: 'テスト町', region: 'テスト県テスト市テスト町', cityArea: 'テスト県テスト市',
    workAddress: '', hasWorkAddress: true, maskedFields: ['work_address', 'recruiter_contact'], experience: '',
    lat: 34, lng: 134, radius: 1000, count: '2名', headcount: 2, photos, workVideoUrl: '',
    recruiterName: 'Synthetic farm', recruiterAddress: '', recruiterContact: '', nearestStation: '',
    workTime: '08:00〜16:00', breakTime: '60分', commuteTime: '', jobBody: '', cautions: '',
    overtimePolicy: '', overtimeDetail: '', placeChangeScope: '', taskChangeScope: '', contractRenewal: '',
    retirementTerms: '', laborInsuranceStatus: '', wanted: '', items: '',
    payMethod: 'cash', payTiming: 'same_day_after_work', wageClosingRule: 'each_workday',
    dateStart: new Date('2099-11-01'), dateEnd: new Date('2099-11-03'), holidays: ['2099-11-02'],
    dangerPlaces: [{ label: 'Slope' }], dangerTasks: [{ desc: 'Synthetic task note' }],
    fullPayGuarantee: false, beginnerOk: false, instantApproveRepeat: false, perks,
    insuranceSnapshot: insurance, profileSnapshotAt: '2099-10-01T00:00:00Z', employerName: '', employerAvatar: '',
    experiencedPreferred: false, closed: false, hiredCount: 1, filled: false, expired: false,
  });
  assert.deepEqual(row, before, 'mapping must not mutate its source');
  assert.equal(job.photos, photos);
  assert.equal(job.perks, perks);
  assert.equal(job.insuranceSnapshot, insurance);
});

test('legacy rows preserve unknown values, owner-address fallback, status, and wage labels', () => {
  const [job] = [{ job_number: 18, date_label: 'Saved legacy label', hourly_wage: '1234',
    address: 'Synthetic owner address', status: 'closed', headcount: 1, hired_count: 2 }].map(presentation.mapJobPublicRow);
  assert.equal(job.dateLabel, 'Saved legacy label');
  assert.equal(job.dateStart, null);
  assert.equal(job.expired, false);
  assert.equal(job.closed, true);
  assert.equal(job.filled, true);
  assert.equal(job.workAddress, 'Synthetic owner address');
  assert.equal(job.hasWorkAddress, true);
  assert.deepEqual(job.maskedFields, []);
  assert.equal(job.perks, null);
  assert.equal(job.insuranceSnapshot, null);
  assert.equal(presentation.payLabel(job), `時給${(1234).toLocaleString()}円`);
  assert.equal(presentation.payLabel({ payType: 'daily', pay: 10000 }), `日給${(10000).toLocaleString()}円`);
  assert.equal(presentation.dateRangeLabel('', ''), '');
});

test('draft and temporarily unpublished states keep their original distinctions', () => {
  const future = { date_start: '2099-11-01', status: 'draft' };
  assert.equal(status.isJobDraft(future), true);
  assert.equal(status.isJobUnpublished(future), false);
  assert.equal(status.isJobDraft({ ...future, opened_at: '2099-10-01' }), false);
  assert.equal(status.isJobUnpublished({ ...future, opened_at: '2099-10-01' }), true);
  assert.equal(status.isJobDraft({ ...future, date_start: '2000-01-01' }), false);
  assert.equal(status.isJobDraft(null), false);
});
