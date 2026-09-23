import { createClient } from '@supabase/supabase-js';

// 本物のPostgRESTクライアントを隔離した通信先につなぐ。実DBには到達しない。
export const supabase = createClient('https://applicants-fixture.test', 'fixture-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async (url, init) => {
    const request = new URL(url);
    const path = request.pathname.replace('/rest/v1/', '');
    window.qaRequests.push({ path, method: init?.method || 'GET', query: request.search });
    let data;
    if (path === 'rpc/my_farm_jobs') data = { jobs: window.qaJobs };
    else if (path === 'rpc/my_farm_applicants') data = window.qaBundle;
    else if (path === 'rpc/employer_trust_info') data = { ok: false };
    else if (path === 'repeat_roster') data = [];
    else if (['employer_profiles', 'emergency_contacts', 'account_holders'].includes(path)) data = null;
    else if (path === 'applications') {
      const id = request.searchParams.get('id')?.replace(/^eq\./, '');
      data = window.qaBundle.apps.filter(app => !id || app.id === id).map(app => ({ ...app,
        terms_snapshot: { crop: `${app.worker_id}専用の通知書`, date_start: '2026-09-24',
          party_names: { farmer: 'テスト農家', worker: app.worker_id } },
      }));
    } else {
      window.qaUnexpected.push(path);
      throw new Error(`Unexpected request: ${path}`);
    }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } },
});
supabase.auth.getSession = async () => ({ data: { session: { user: window.qaMe } } });
