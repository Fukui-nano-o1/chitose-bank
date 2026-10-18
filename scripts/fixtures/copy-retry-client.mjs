export const uid='00000000-0000-4000-8000-000000000001';
const clone=x=>JSON.parse(JSON.stringify(x));
export function copyRetryFixture(options={}){
  const pending=new Map(),receipts=new Map();
  const state={userId:uid,writes:0,calls:[],pending,receipts};
  const store={async acquire(key,value){if(options.storageError)throw Error('storage');if(!pending.has(key))pending.set(key,clone(value));return clone(pending.get(key));},async clear(key,id){if(options.clearError)throw Error('storage');if(pending.get(key)?.requestId===id)pending.delete(key);}};
  const client={auth:{getSession:async()=>({data:{session:{user:{id:state.userId}}},error:null})},async rpc(name,a){
    if(name!=='copy_my_job_once')throw Error('Unexpected RPC '+name);state.calls.push(clone(a));await options.beforeRPC?.(state,a);
    if(a.p_owner!==state.userId)return {data:{ok:false,reason:'not_logged_in'},error:null};
    if(options.rejected)return {data:{ok:false,reason:'copy_rejected'},error:null};
    let data=receipts.get(a.p_request_id),replayed=!!data;
    if(!data){state.writes++;const number=100+state.writes;data={ok:true,owner:uid,request_id:a.p_request_id,job_number:number,job:{id:'target-'+number,job_number:number,farmer_id:uid,notes:'copy',status:'draft'},copy_unchanged:true,dates_cleared:true,video_reconfirmation_required:true};receipts.set(a.p_request_id,clone(data));}
    if(options.deleted)return {data:{ok:false,reason:'copy_deleted'},error:null};
    if(options.lostResponse)throw Error('response lost');
    if(options.switchAfterRPC)state.userId='other';
    return {data:{...clone(data),replayed},error:null};
  }};
  return {client,store,state,options};
}
