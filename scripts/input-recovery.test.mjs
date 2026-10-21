import test from 'node:test';
import assert from 'node:assert/strict';
import { inputRecovery, inputError, jobSaveGuidance } from '../src/lib/inputRecovery.js';
import { explainError } from '../src/lib/errorCatalog.js';
import { readProfileRecord, saveProfileRecord } from '../src/lib/profileRecord.js';
import { profileFixture } from './fixtures/profile-client.mjs';
import { registerAccountHolder } from '../src/lib/accountHolderRecord.js';
import { accountSaveFixture, uid } from './fixtures/account-save-client.mjs';
import { recordAttendance } from '../src/lib/attendanceRecord.js';
import { attendanceFixture, applicationId } from './fixtures/attendance-client.mjs';
import { copyJobRecord } from '../src/lib/copyJobRecord.js';
import { copyRetryFixture } from './fixtures/copy-retry-client.mjs';
import { saveConsignmentRecord } from '../src/features/consignment/consignmentRecord.js';
import { consignmentFixture, memoryStorage } from './fixtures/consignment-deal-client.mjs';
const capture = async work => { try { await work(); assert.fail('expected failure'); } catch (e) { if (e.code === 'ERR_ASSERTION') throw e; return e; } };

test('lost profile response describes uncertainty, preserves caller input, and verifies the committed value on retry', async()=>{
 const f=profileFixture({lostResponse:true,readErrorAfterWrite:true}), before=await readProfileRecord(f.client,'worker_profiles');
 const patch={transport:'車'}, e=await capture(()=>saveProfileRecord(f.client,before,patch));
 assert.equal(e.code,'PROFILE_UNCONFIRMED'); assert.match(e.message,/保存済みの場合もあります/); assert.match(e.message,/閉じる前に入力を控え/);
 assert.equal(f.state.rows.worker_profiles.transport,'車'); assert.equal(before.row.transport,'自転車'); assert.deepEqual(patch,{transport:'車'});
 f.state.options.readErrorAfterWrite=false; f.state.options.lostResponse=false;
 assert.equal((await saveProfileRecord(f.client,before,patch)).row.transport,'車');
});
test('overlapping profile edits advise comparison instead of repeated writes; the other edit is retained',async()=>{
 const f=profileFixture(),a=await readProfileRecord(f.client,'worker_profiles'),b=await readProfileRecord(f.client,'worker_profiles');
 await saveProfileRecord(f.client,a,{nickname:'first editor'});
 const patch={nickname:'second editor'},e=await capture(()=>saveProfileRecord(f.client,b,patch));
 assert.equal(e.code,'PROFILE_CONFLICT'); assert.match(e.message,/最新の内容と比べて/); assert.match(e.message,/繰り返し送らない/);
 assert.equal(f.state.rows.worker_profiles.nickname,'first editor'); assert.equal(patch.nickname,'second editor');
});
test('read failure and changed account do not claim local persistence or start a registration',async()=>{
 const f=accountSaveFixture({readError:true}); let e=await capture(()=>registerAccountHolder(f.client,uid,{full_name:'fixture'}));
 assert.equal(e.code,'ACCOUNT_READ'); assert.equal(f.state.inserts,0); assert.match(e.message,/今回の登録は進めていません/);
 f.options.readError=false;f.state.owner='other';e=await capture(()=>registerAccountHolder(f.client,uid,{}));
 assert.equal(e.code,'ACCOUNT_SESSION');assert.match(e.message,/同じアカウント/);assert.match(e.message,/閉じる前に入力を控え/);assert.doesNotMatch(e.message,/端末に保存済み/);assert.equal(f.state.inserts,0);
});
test('storage refusal advises preservation without sending or clearing the old operation',async()=>{
 const f=attendanceFixture({storageError:true}), input={application_id:applicationId,kind:'late',work_date:'2026-11-01',reason:'fixture'};
 const e=await capture(()=>recordAttendance(f.client,uid,input,'event',f));
 assert.equal(e.code,'ATTENDANCE_STORAGE');assert.match(e.message,/サイトデータは削除しない/);assert.match(e.message,/空き容量とブラウザの保存設定/);assert.equal(f.state.calls.length,0);assert.equal(input.reason,'fixture');
});
test('attendance response loss follows the advertised retry and confirms the original input only once',async()=>{
 const f=attendanceFixture({lostResponse:true}), input={application_id:applicationId,kind:'late',work_date:'2026-11-01',reason:'first'};
 const e=await capture(()=>recordAttendance(f.client,uid,input,'event',f));assert.equal(e.code,'ATTENDANCE_UNCONFIRMED');assert.match(e.message,/まず前回送った内容/);
 f.options.lostResponse=false;const retry=await recordAttendance(f.client,uid,{...input,reason:'later edit'},'event',f);
 assert.equal(retry.changed,true);assert.equal(retry.row.reason,'first');assert.equal(f.state.writes,1);assert.equal(f.state.notifications,1);assert.equal(f.state.calls[0].p_event_id,f.state.calls[1].p_event_id);
});
test('copy acknowledgement failure says saved and reuses the existing copy',async()=>{
 const f=copyRetryFixture({clearError:true}), first=await copyJobRecord(f.client,1,{},f),e=await capture(()=>first.acknowledge());
 assert.equal(e.code,'COPY_ACK');assert.match(e.message,/コピー先は保存済み/);assert.doesNotMatch(e.message,/保存済みの場合も/);
 const again=await copyJobRecord(f.client,1,{},f);assert.equal(first.data.job_number,again.data.job_number);assert.equal(f.state.writes,1);
});
test('confirmed consignment save and failed local cleanup have a distinct saved-state notice',async()=>{
 const f=consignmentFixture(),storage=memoryStorage(),i={owner:uid,row:f.state.row,patch:{spec:f.state.row.spec,status:'draft',notes:'fixture'},fields:[],terms:{}};
 const remove=storage.removeItem;storage.removeItem=()=>{throw Error('blocked cleanup');};
 const e=await capture(()=>saveConsignmentRecord(f.client,i,{storage}));assert.equal(e.code,'CONSIGNMENT_ACK');assert.match(e.message,/保存は確認できました/);assert.doesNotMatch(e.message,/保存済みの場合も/);assert.equal(f.state.writes,1);
 storage.removeItem=remove;await saveConsignmentRecord(f.client,i,{storage});assert.equal(f.state.writes,1);assert.equal(storage.data.size,0);
});
test('job rejection guidance distinguishes consent, permission, state and uncertainty without promising delayed success',()=>{
 const permission=jobSaveGuidance({state:'blocked',reason:'42501'});assert.match(permission,/許可されていません/);assert.doesNotMatch(permission,/ログインし直し/);
 assert.match(jobSaveGuidance({state:'blocked',reason:'consent_required'}),/内容を確認して同意/);
 assert.match(jobSaveGuidance({state:'blocked',reason:'has_applications'}),/応募状況を確認/);
 assert.match(jobSaveGuidance({state:'blocked',reason:'unexpected_constraint'}),/ヘルプ・お問い合わせ/);
 assert.match(jobSaveGuidance({state:'pending'}),/反映は確認待ち/);
 assert.match(inputError('TERMS_REJECTED','fallback','closed').message,/この仕事は終了/);
});
test('unknown errors stay unknown, and administrative explanations never auto-resolve expected states',()=>{
 for(const code of ['P0001','42501','23505','PROFILE_FIELDS','UNRECOGNIZED_UNCONFIRMED'])assert.equal(inputRecovery(code),null);
 assert.equal(inputError('TERMS_REJECTED','unknown rejection','new_server_reason').message,'unknown rejection');
 const explained=explainError({error_code:'PROFILE_UNCONFIRMED',message:'opaque'});assert.match(explained.action,/復帰を確認するまでは解決済みにしない/);
 const network=explainError({message:'Failed to fetch'});assert.match(network.cause,/実行済みかは.*確認できない/);assert.doesNotMatch(network.cause,/端末側が大半/);
 assert.match(explainError({error_code:'42501',message:'permission denied'}).action,/繰り返すだけで直るとは案内しない/);
});
