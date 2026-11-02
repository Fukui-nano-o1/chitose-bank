import {createClient} from '@supabase/supabase-js';
export const supabase = createClient('https://workplace-fixture.test', 'fixture-key', {
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:{fetch:(url,init) => window.qaWorkplaceRequest(new URL(url).pathname, init?.body ? JSON.parse(init.body) : null)},
});
supabase.auth.getSession = async () => ({data:{session:null}});
supabase.auth.getUser = async () => ({data:{user:null}});
