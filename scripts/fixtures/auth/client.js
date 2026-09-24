import { createClient } from '@supabase/supabase-js';
import { createSupabaseFetch } from '../../../src/lib/requestTransport';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const user = () => ({ id: '10000000-0000-4000-8000-000000000001', email: 'person@fixture.test', aud: 'authenticated',
  created_at: '2026-01-01T00:00:00Z', email_confirmed_at: '2026-09-24T00:00:00Z' });
const session = () => ({ user: user(), access_token: 'fixture-token', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600 });

export const supabase = createClient('https://auth-fixture.test', 'fixture-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: createSupabaseFetch({ supabaseUrl: 'https://auth-fixture.test', timeoutMs: 60,
    fetchImpl: async (url, options) => {
      const parsed = new URL(url), path = parsed.pathname;
      window.qaRequests.push({ path, query: parsed.search, method: options.method || 'GET',
        authorization: new Headers(options.headers).get('Authorization'), body: options.body ? JSON.parse(options.body) : null });
      if (path === '/rest/v1/rpc/signup_open') return json(window.qaSignupOpen ?? true);
      if (path === '/rest/v1/app_errors') return new Response(null, { status: 201 });
      if (window.qaProfile) return new Response('[]');
      if (path === '/auth/v1/verify') return window.qaVerifyError
        ? json({ msg: 'Token has expired or is invalid', error_code: 'otp_expired' }, 403) : json(session());
      if (path === '/auth/v1/token') return json(session());
      if (path === '/auth/v1/user' && options.method === 'PUT') return json({ user: user() });
      if (path === '/rest/v1/account_holders') return window.qaLookupError
        ? json({ code: 'fixture_error', message: 'Unable to read account' }, 400)
        : json(window.qaRegistered === false ? [] : [{ id: 'fixture-account-holder' }]);
      if (path === '/rest/v1/farmers') return window.qaFarmerError
        ? json({ code: 'fixture_error', message: 'Unable to read profile' }, 400)
        : json(window.qaFarmer ? [window.qaFarmer] : []);
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
