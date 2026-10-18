export const uid='00000000-0000-4000-8000-000000000001',applicationId='10000000-0000-4000-8000-000000000001';
const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));
export function attendanceFixture(options={}){
 const state={owner:uid,pending:new Map(),receipts:new Map(),calls:[],writes:0,notifications:0};
 const store={async read(key){if(options.readError)throw Error('read failed');return clone(state.pending.get(key)||null);},async acquire(key,proposal){if(options.storageError)throw Error('storage');if(!state.pending.has(key))state.pending.set(key,clone(proposal));return clone(state.pending.get(key));},async clear(key,id){if(options.clearError)throw Error('clear');if(state.pending.get(key)?.requestId===id)state.pending.delete(key);}};
 let seq=0;
 const client={auth:{getSession:async()=>({data:{session:{user:{id:state.owner}}}})},async rpc(name,a){
  if(name!=='record_my_attendance_once')throw Error('unexpected RPC '+name);state.calls.push(clone(a));await options.beforeRPC?.(state,a);
  if(a.p_owner!==state.owner||options.rejected)return {data:{ok:false,reason:'save_rejected'}};
  let row=state.receipts.get(a.p_event_id);
  if(!row){row={id:a.p_event_id,actor_id:a.p_owner,...clone(a.p_input)};state.receipts.set(a.p_event_id,row);state.writes++;state.notifications++;}
  if(options.lostResponse)throw Error('response lost');if(options.switchAfterRPC)state.owner='other';
  return {data:{ok:true,row:options.wrongReceipt?{...row,id:'wrong'}:clone(row)}};
 }};
 return {state,store,client,options,uuid:()=>`20000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`};
}
