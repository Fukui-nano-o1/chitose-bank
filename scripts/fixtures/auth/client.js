import { createClient } from '@supabase/supabase-js';
import { createSupabaseFetch } from '../../../src/lib/requestTransport';

export const supabase = createClient('https://auth-fixture.test', 'fixture-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: createSupabaseFetch({ supabaseUrl: 'https://auth-fixture.test', timeoutMs: 60,
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname;
      window.qaRequests.push({ path, body: options.body ? JSON.parse(options.body) : null });
      if (path === '/rest/v1/rpc/signup_open') return new Response('true');
      if (path === '/rest/v1/app_errors') return new Response(null, { status: 201 });
      if (window.qaProfile) return new Response('[]');
      if (path !== '/auth/v1/otp') throw new Error('Unexpected endpoint');
      if (window.qaMode === 'timeout') return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
      if (window.qaMode === 'body-timeout') return new Response(new ReadableStream({ start(controller) {
        options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true });
      } }));
      if (window.qaMode === 'smtp') return new Response(JSON.stringify({ msg: 'Error sending confirmation email', error_code: 'unexpected_failure' }), { status: 500 });
      return new Response('{}');
    },
  }) },
});
