export const uid='00000000-0000-4000-8000-000000000001';
const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));
export function accountSaveFixture(options={}){
 const state={owner:uid,row:null,reads:0,inserts:0,writes:0};
 const client={auth:{getSession:async()=>{if(options.sessionError)throw Error('session failed');return {data:{session:{user:{id:state.owner,email:'owner@fixture.test',phone:null}}}};}},rpc:async name=>{if(name!=='am_i_account_allowed')throw Error('unexpected RPC');return {data:true};},from(table){
  if(table!=='account_holders')throw Error('unexpected table');
  return {select(){return {eq(field,owner){if(field!=='auth_id')throw Error('owner filter required');return {async maybeSingle(){state.reads++;if(options.readError||(options.verifyError&&state.inserts))return {error:{message:'read failed'}};return {data:owner===state.owner?clone(state.row):null};}};}};},insert(row){return {select(){return {async single(){
   state.inserts++;await options.beforeInsert?.(state,row);
   if(options.insertError||row.auth_id!==state.owner)return {error:{code:'42501',message:'denied'}};
   if(state.row)return {error:{code:'23505',message:'duplicate'}};
   state.row=clone(row);state.writes++;if(options.lostResponse)throw Error('lost response');if(options.responseError)return {error:{code:'TIMEOUT'}};if(options.switchAfterInsert)state.owner='other';
   return {data:clone(row)};
  }};}};}};
 }};
 return {client,state,options};
}
