import { createClient } from '@supabase/supabase-js';
import { PRIVACY_VERSION } from '../../../src/lib/utils';
export const owner = '00000000-0000-4000-8000-000000000001';
export const profile = { auth_id:owner, nickname:'テスト農園', recruiter_name:'テスト農園',
  recruiter_address:'テスト住所', recruiter_contact:'000-0000-0000', smoking_policy:'敷地内禁煙' };
window.qaCalls = [];
export const supabase = createClient('https://offline-fixture.test', 'fixture-key', {
  auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false },
  global: { fetch: async (url, init) => {
    const path = new URL(url).pathname.split('/rest/v1/')[1];
    const body = init.body ? JSON.parse(init.body) : null;
    window.qaCalls.push({path, body, method: init.method || "GET"});
    if (window.qaOffline) throw new TypeError('Network error');
    let result = null;
    if (path === 'employer_profiles') {
      if (window.qaProfileReadError && !body) return new Response(JSON.stringify({code:'42501',message:'test profile read failure'}),{status:403,headers:{'Content-Type':'application/json'}});
      if (body) {
        if (window.qaProfileWriteError) return new Response(JSON.stringify({code:'42501',message:'test profile save failure'}),{status:403,headers:{'Content-Type':'application/json'}});
        window.qaProfile = {...(window.qaProfile || profile), ...body};
        if (window.qaLoseProfileResponse) { window.qaLoseProfileResponse = false; throw new TypeError('Lost profile save response'); }
        return new Response(null, {status:204});
      }
      result = [window.qaProfile || profile];
    }
    else if (path === 'account_holders') {
      if (window.qaDelayRegistration) await new Promise(resolve => { window.qaReleaseRegistration = resolve; });
      result = [{ ...(window.qaRegistration || {}), agreed_privacy_version: window.qaConsent ? PRIVACY_VERSION : 'old' }];
    }
    else if (path === 'jobs_public') result = [];
    else if (path === 'jobs') result = window.qaJob ? [window.qaJob] : [];
    else if (path === 'rpc/get_minimum_wage') result = Object.hasOwn(window,'qaMinimumWage') ? window.qaMinimumWage : 1100;
    else if (path === 'rpc/employer_trust_info') result = {ok:true};
    else if (path === 'rpc/save_my_privacy_consent') { window.qaConsent = true; result = { agreed_privacy_version:PRIVACY_VERSION }; }
    else if (path === 'rpc/sync_my_job_draft' || path === 'rpc/sync_my_open_job') {
      if (window.qaConflictOnce) {
        // metadataは既存の入力内容を変えず、本番にある比較用の列だけを返す。
        // trueは別の編集者が本文を変更した、本当に上書きしてはいけない競合。
        const metadataOnly = window.qaConflictOnce === 'metadata';
        window.qaConflictOnce = false;
        window.qaJob = {...window.qaJob, id:body.p_id, job_number:42, farmer_id:owner, status:'draft',
          ...(metadataOnly ? {draft_step_id:'description'} : {notes:'別のタブの保存'})};
        result = {ok:false,reason:'conflict',row:window.qaJob};
      } else {
        window.qaSyncExpected = body.p_expected;
        window.qaJob = {...window.qaJob, ...body.p_patch, id:body.p_id, job_number:42, farmer_id:owner, status:path.endsWith('open_job')?'open':'draft'};
        result = {ok:true,row:window.qaJob};
      }
    } else if (path === 'rpc/publish_my_job_with_check') {
      const receipts = window.qaPublicationReceipts ||= {};
      if (!receipts[body.p_request_id]) {
        if (window.qaCheckError) return new Response(JSON.stringify({ok:false,reason:'publication_rejected',code:'P0001'}),{status:200,headers:{'Content-Type':'application/json'}});
        if (!['draft','pending'].includes(window.qaJob.status)) result = {ok:false,reason:'bad_status'};
        else {
          window.qaJob.status = window.qaJob.revision_requested_at ? 'pending' : 'open';
          receipts[body.p_request_id] = {ok:true,request_id:body.p_request_id,check_id:body.p_request_id,
            job_id:body.p_job_id,job_number:42,pending:window.qaJob.status==='pending',
            published_base:{...body.p_expected,status:window.qaJob.status}};
        }
      }
      result ||= {...receipts[body.p_request_id],row:window.qaJob};
      if (window.qaLosePublishResponse) { window.qaLosePublishResponse = false; throw new TypeError('Lost publication response'); }
      if (window.qaReceiptMismatch) result.check_id = 'wrong-receipt';
    } else if (path === 'rpc/publish_my_job') { window.qaJob.status = 'open'; result = {ok:true}; }
    else if (path === 'job_publish_checks') {
      if (window.qaCheckError) return new Response(JSON.stringify({code:'P0001',message:'test receipt failure'}),{status:500,headers:{'Content-Type':'application/json'}});
      result = null;
    }
    else if (path === 'applications') return new Response(null,{status:200,headers:{'Content-Range':'*/0'}});
    return new Response(JSON.stringify(result), {status:200,headers:{'Content-Type':'application/json'}});
  } },
});
supabase.auth.getSession = async () => ({data:{session:{user:{id:window.qaSessionOwner || owner,email:'fixture@example.test'}}}});
export const geocodeTown = async () => null;
// 住所の実在チェック（2026-09-27）：オフラインでは確かめられない＝"error"（止めない側）
export const verifyTownAddress = async () => "error";
export const zipLookup = async () => ({ok:false,reason:'network'});
