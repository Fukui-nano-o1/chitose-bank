import { createClient } from '@supabase/supabase-js';
export const supabase = createClient('https://fixture.supabase.co','fixture-key',{
  auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false },
  global:{ fetch:async (input,options) => {
    const path = new URL(input).pathname;
    window.qaCalls.push({ path, method:options.method, body:options.body ? JSON.parse(options.body) : null });
    if (path.endsWith('/product_events')) return new Response('',{ status:201 });
    if (path.endsWith('/apply_to_job')) return new Response(JSON.stringify(window.qaApplyResult),{ status:200, headers:{ 'Content-Type':'application/json' } });
    if (path.endsWith('/admin_product_analytics')) return new Response(JSON.stringify(window.qaStatsError ? { message:'unavailable' } : window.qaStats),{ status:window.qaStatsError ? 403 : 200, headers:{ 'Content-Type':'application/json' } });
    throw Error('Unexpected fixture path '+path);
  } },
});
