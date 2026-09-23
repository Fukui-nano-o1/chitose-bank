import { createClient } from '@supabase/supabase-js';

// Real PostgREST client, isolated transport. No request may reach the live project.
window.qaCalls = [];
export const supabase = createClient('https://schedule-fixture.test', 'fixture-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async (url, init) => {
    const request = new URL(url);
    const path = request.pathname.replace('/rest/v1/', '');
    window.qaCalls.push({ path, method: init?.method || 'GET', query: request.search });
    if (window.qaOffline) throw new TypeError('Network error');
    let data;
    if (path === 'rpc/get_my_calendar_jobs') data = window.qaEntries;
    else if (path === 'applications') data = window.qaContracts || [];
    else if (path === 'account_holders') data = null;
    else throw new Error(`Unexpected request: ${path}`);
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } },
});
supabase.auth.getSession = async () => ({ data: { session: { user: window.qaMe } } });
