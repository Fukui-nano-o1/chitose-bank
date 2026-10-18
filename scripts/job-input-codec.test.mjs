import test from 'node:test';
import assert from 'node:assert/strict';
import {JOB_INPUT_GROUPS, JOB_DRAFT_FIELDS} from '../src/lib/jobInputFields.js';
import {jobDraftPatch} from '../src/lib/jobDraftProtocol.js';
import {calendarDateFromYmd, restoreDraftCalendarDate} from '../src/lib/calendarDate.js';
import {digitsOnly, wageAmount, dateLabel, serializeJobForm, jobFormFromRow, jobPayloadFromForm} from '../src/features/jobs/create/jobInputCodec.js';
import {jobInputSample, jobInputOptions} from './fixtures/job-input.js';

const now = new Date(2026, 9, 16);
const context = base => ({ownerId: 'owner', status: 'draft', base, now});
const decode = row => jobFormFromRow(row, jobInputOptions);

test('all 44 columns survive row, form, local JSON and payload with one field list', () => {
  const row = jobInputSample();
  const original = structuredClone(row);
  assert.equal(JOB_DRAFT_FIELDS.length,44);
  assert.equal(new Set(Object.values(JOB_INPUT_GROUPS).flat()).size,44);
  assert.deepEqual([...JOB_DRAFT_FIELDS].sort(),Object.keys(row).sort());
  const form = decode(row);
  // 列名と画面上の意味を確認する。対称な誤マッピングを往復一致だけで見逃さない。
  assert.equal(form.jobDescription,'作業の説明\n二行目');
  assert.equal(form.jobNotes,'長靴');
  assert.equal(form.jobCautions,'雨天注意');
  assert.equal(form.farmerZip,'0123456');
  assert.equal(form.startHour,'9'); assert.equal(form.endMinute,'45');
  assert.equal(form.jobCount,'3'); assert.equal(form.dailyWageInput,'12000');
  const saved = JSON.parse(JSON.stringify(serializeJobForm(form)));
  assert.equal(saved.jobDateStart,'2026-12-01');
  assert.equal(saved.jobDateEnd,'2026-12-05');
  const restored = {...saved, jobDateStart: restoreDraftCalendarDate(saved.jobDateStart), jobDateEnd: restoreDraftCalendarDate(saved.jobDateEnd)};
  const payload = jobPayloadFromForm(restored,context(row));
  assert.deepEqual(jobDraftPatch(payload),row);
  assert.equal(payload.farmer_id,'owner'); assert.equal(payload.status,'draft');
  assert.deepEqual(row,original); // 復元・保存が比較元を変更しない。
});

test('clearing text, false flags, empty photos and zero perk values are not dropped', () => {
  const row = jobInputSample();
  const form = {...decode(row), jobDescription:'', jobNotes:'', jobCautions:'', beginnerOk:false, experiencedPreferred:false,
    jobHolidays:[], jobPhotos:[], jobPerks:{has_parking:false,parking_capacity:0}, jobCount:'',
    overtimePolicy:'なし',overtimeDetail:'古い目安',workVideoUrl:'',workVideoJobConsent:true,workVideoRelatedConsent:true};
  const payload = jobPayloadFromForm(form,context(row));
  for (const field of ['notes','belongings','cautions','overtime_detail']) assert.equal(payload[field],'');
  for (const field of ['beginner_ok','experienced_preferred']) assert.equal(payload[field],false);
  assert.deepEqual(payload.photos,[]); assert.deepEqual(payload.holidays,[]);
  assert.deepEqual(payload.perks,{has_parking:false,parking_capacity:0});
  assert.equal(payload.headcount,null);
  for (const field of JOB_INPUT_GROUPS.video) assert.equal(payload[field],null);
  assert.equal(Object.keys(jobDraftPatch(payload)).length,44);
});

test('legacy choices and photos keep their meaning while documented fixed values normalize', () => {
  const row = {...jobInputSample(),crop:'在来野菜',task:'独自の作業',pay_type:'時給',hourly_wage:'1500',
    photos:['https://example.invalid/old.jpg',null,{caption:'URLなし'}],place_change_scope:null,task_change_scope:null};
  const form = decode(row);
  assert.equal(form.farmerCropPill,'__other__'); assert.equal(form.farmerTaskPill,'__other__');
  const payload = jobPayloadFromForm(form,context(row));
  assert.equal(payload.crop,row.crop); assert.equal(payload.task,row.task);
  assert.equal(payload.pay_type,'日給'); assert.equal(payload.hourly_wage,'');
  assert.equal(payload.place_change_scope,'変更なし'); assert.equal(payload.task_change_scope,'変更なし');
  assert.deepEqual(payload.photos,[{url:'https://example.invalid/old.jpg'}]);
});

test('geo uses the matching base only, and explicit geocoding wins', () => {
  const row=jobInputSample(); const form=decode(row);
  const changed=jobPayloadFromForm({...form,farmerTown:'変更後'},context(row));
  for (const field of JOB_INPUT_GROUPS.geo) assert.equal(changed[field],null);
  const explicit=jobPayloadFromForm(form,{...context(row),geo:{lat:0,lng:0,radius:0,from:'新しい照合'}});
  assert.equal(explicit.lat,0); assert.equal(explicit.lng,0); assert.equal(explicit.geo_radius_m,0); assert.equal(explicit.geocoded_from,'新しい照合');
});

test('video consent timestamps are retained or generated only when consent and URL exist', () => {
  const row=jobInputSample(); const form=decode(row);
  const fresh=jobPayloadFromForm({...form,workVideoUrl:'  '+row.work_video_url+'  ',workVideoConsentAt:null,workVideoConsentVersion:null},context(row));
  assert.equal(fresh.work_video_url,row.work_video_url); assert.equal(fresh.work_video_consent_at,now.toISOString());
  assert.equal(fresh.work_video_consent_version,'2026-10-05-v1');
  const revoked=jobPayloadFromForm({...form,workVideoJobConsent:false,workVideoRelatedConsent:false},context(row));
  assert.equal(revoked.work_video_job_consent,false); assert.equal(revoked.work_video_related_consent,false);
  assert.equal(revoked.work_video_consent_at,null); assert.equal(revoked.work_video_consent_version,null);
});

test('wage digits and date labels share their UI and save conversions', () => {
  for (const [raw,expected] of [['12000','12000'],['12,000円','12000'],['',''],[null,''],[12000,'12000'],['0','0']]) {
    assert.equal(digitsOnly(raw),expected); assert.equal(wageAmount(raw),Number(expected));
  }
  const day=calendarDateFromYmd;
  assert.equal(dateLabel(null,null,now),'日程を選択してください');
  assert.equal(dateLabel(day('2026-12-01'),null,now),'12/1（火）');
  assert.equal(dateLabel(day('2026-12-01'),day('2026-12-05'),now),'12/1（火） 〜 5（土）');
  assert.equal(dateLabel(day('2026-12-31'),day('2027-01-01'),now),'2026/12/31（木） 〜 2027/1/1（金）');
});

test('unreadable legacy work time does not invent a replacement in the decoder', () => {
  for (const work_time of [null,'','不明']) {
    const form=decode({...jobInputSample(),work_time});
    for (const key of ['startHour','startMinute','endHour','endMinute']) assert.equal(Object.hasOwn(form,key),false);
  }
});
