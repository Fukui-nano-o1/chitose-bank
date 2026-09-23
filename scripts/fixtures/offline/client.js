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
    window.qaCalls.push({path, body});
    if (window.qaOffline) throw new TypeError('Network error');
    let result = null;
    if (path === 'employer_profiles') result = [profile];
    else if (path === 'account_holders') result = [{ agreed_privacy_version: window.qaConsent ? PRIVACY_VERSION : 'old' }];
    else if (path === 'jobs_public') result = [];
    else if (path === 'jobs') result = window.qaJob ? [window.qaJob] : [];
    else if (path === 'rpc/get_minimum_wage') result = 1100;
    else if (path === 'rpc/employer_trust_info') result = {ok:true};
    else if (path === 'rpc/save_my_privacy_consent') { window.qaConsent = true; result = { agreed_privacy_version:PRIVACY_VERSION }; }
    else if (path === 'rpc/sync_my_job_draft' || path === 'rpc/sync_my_open_job') {
      if (window.qaConflictOnce) {
        // 一度だけ「別の場所で更新あり」＝本番と同じく現在の行を添えて返す（20260923070439）
        window.qaConflictOnce = false;
        window.qaJob = {...window.qaJob, id:body.p_id, job_number:42, farmer_id:owner, status:'draft', notes:'別のタブの保存'};
        result = {ok:false,reason:'conflict',row:window.qaJob};
      } else {
        window.qaSyncExpected = body.p_expected;
        window.qaJob = {...window.qaJob, ...body.p_patch, id:body.p_id, job_number:42, farmer_id:owner, status:path.endsWith('open_job')?'open':'draft'};
        result = {ok:true,row:window.qaJob};
      }
    } else if (path === 'rpc/publish_my_job') { window.qaJob.status = 'open'; result = {ok:true}; }
    else if (path === 'job_publish_checks') result = null;
    else if (path === 'applications') return new Response(null,{status:200,headers:{'Content-Range':'*/0'}});
    return new Response(JSON.stringify(result), {status:200,headers:{'Content-Type':'application/json'}});
  } },
});
supabase.auth.getSession = async () => ({data:{session:{user:{id:owner,email:'fixture@example.test'}}}});
export const geocodeTown = async () => null;
export const zipLookup = async () => ({ok:false,reason:'network'});
