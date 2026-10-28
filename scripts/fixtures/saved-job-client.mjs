import {createClient} from '@supabase/supabase-js';
export const uid='00000000-0000-4000-8000-000000000001';
export const job={job_number:17,farmer_id:'00000000-0000-4000-8000-000000000002',status:'open',job_status:'open',crop:'試験野菜',task:'収穫',town:'徳島県吉野川市',photos:[],date_start:'2099-12-01',date_end:'2099-12-01',date_label:'12/1',work_time:'8:00〜16:00',pay_amount:10000,pay_unit:'日給',capacity:2,filled:false,liked:true,application_id:null};
export function savedJobFixture(options={}){
 const state={owner:uid,saved:true,writes:0,calls:[],mutationCalls:0};
 const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
 const client=createClient('https://saved-job-fixture.test','fixture-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(url,init)=>{
  const u=new URL(url),p=u.pathname.replace('/rest/v1/',''),method=init?.method||'GET';state.calls.push({path:p,method,query:u.search});
  if(p==='saved_jobs'){
   if(method==='GET'){
    if(options.readError)return json({message:'read failed'},400);
    const ownFilter=u.searchParams.get('worker_id')==='eq.'+state.owner;
    return json(state.saved&&ownFilter?[{worker_id:state.owner,job_number:17}]:[]);
   }
   state.mutationCalls++;await options.beforeWrite?.(state);
   if(options.rejected)return json({message:'denied'},403);
   const body=init.body?JSON.parse(init.body):null;
   const requestedOwner=method==='DELETE'?u.searchParams.get('worker_id')?.slice(3):body?.worker_id;
   if(requestedOwner!==state.owner)return json({message:'denied'},403);
   if(method==='POST'&&state.saved)return json({code:'23505',message:'already saved'},409);
   const desired=method==='POST';if(state.saved!==desired){state.saved=desired;state.writes++;}
   if(options.lostResponse)throw Error('response lost');if(options.switchAfterWrite)state.owner='other';
   return new Response(null,{status:204});
  }
  if(p==='rpc/my_job_actions'){const rows=state.saved||options.application?[{...job,liked:state.saved,application_id:options.application?'application':null}]:[];await options.beforeList?.();return json(rows);}
  if(p==='jobs_public')return json([job]);
  if(p==='user_onboarding_survey')return json([{auth_id:uid}]);
  if(p==='rpc/get_job_view_counts')return json([]);
  if(p==='rpc/signup_is_open')return json(false);
  if(p==='worker_profiles'||p==='account_holders')return json([]);
  if(p.startsWith('rpc/'))return json([]);
  return json([]);
 }}});
 client.auth.getSession=async()=>({data:{session:{user:{id:state.owner}}}});
 client.auth.getUser=async()=>({data:{user:{id:state.owner}}});
 return {client,state,options};
}
