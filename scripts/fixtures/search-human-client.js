import { createClient } from '@supabase/supabase-js';

const json = (value, status = 200) => Promise.resolve(new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
}));
export const supabase = createClient('https://search-fixture.test', 'fixture-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: url => {
    const target = new URL(url);
    if (target.origin !== 'https://search-fixture.test') throw new Error('Unexpected origin');
    if (target.pathname.endsWith('/jobs_public')) {
      const job = target.searchParams.get('job_number');
      if (job && window.qaDetail.has(job)) { window.qaDetailRequests.push(job); return window.qaDetail.get(job); }
      if (job) return json([]);
      window.qaListCount += 1;
      return window.qaList();
    }
    if (target.pathname.endsWith('/signup_open')) return json(false);
    return json([]);
  } },
});
