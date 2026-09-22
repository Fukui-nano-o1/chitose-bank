import { createClient } from '@supabase/supabase-js';

// Every request is trapped here. An unresponsive server must not prevent local
// expiry, and no test may send a request or mutate a real Supabase project.
window.qaRequests = [];
export const supabase = createClient('https://expiry-fixture.test', 'fixture-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (url, init) => {
    window.qaRequests.push({ path: new URL(url).pathname, method: init?.method || 'GET' });
    return new Promise(() => {});
  } },
});
supabase.auth.getSession = async () => ({ data: { session: null } });
