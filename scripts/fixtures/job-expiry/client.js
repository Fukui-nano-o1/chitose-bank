import { createClient } from '@supabase/supabase-js';

// Every request is trapped here. An unresponsive server must not prevent local
// expiry, and no test may send a request or mutate a real Supabase project.
window.qaRequests = [];
export const supabase = createClient('https://expiry-fixture.test', 'fixture-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (url, init) => {
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(init.body) : null;
    window.qaRequests.push({ path, body, method: init?.method || 'GET' });
    const json = (value, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }));
    if (window.qaApplyMode) {
      if (path.endsWith('/account_holders')) return json({ id: 'fixture-holder' });
      if (path.endsWith('/is_worker_profile_ready')) return json(true);
      if (path.endsWith('/worker_profiles')) return json({ nickname: 'worker', residence_city: 'city', pr: 'intro' });
      if (path.endsWith('/apply_to_job')) return window.qaApplyMode === 'error' ? json({ message: 'unavailable' }, 503) : json({ ok: true });
    }
    return new Promise(() => {});
  } },
});
supabase.auth.getSession = async () => ({ data: { session: window.qaApplyMode ? { user: window.qaMe } : null } });
supabase.auth.getUser = async () => ({ data: { user: window.qaMe || null } });
