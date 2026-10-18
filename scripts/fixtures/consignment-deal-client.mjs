import {sameProfileValue} from '../../src/lib/profileRecord.js';
import {CONSIGN_EMPTY,CONSIGN_CROP,CONSIGN_FIXED_CLAUSES} from '../../src/features/consignment/model.js';
// Current production consent version; fixture does not import browser-only utils.
const CONSIGN_TERMS_VERSION='consignment-terms-v1-2026-08';
export const uid='00000000-0000-4000-8000-000000000001',dealId='00000000-0000-4000-8000-000000000010';
const clone=x=>JSON.parse(JSON.stringify(x));
export function consignmentFixture(options={}){
  const spec={...CONSIGN_EMPTY,field_name:'試験圃場',area_a:'30',photos:[{url:'https://image.test/1'},{url:'https://image.test/2'},{url:'https://image.test/3'}],crop:CONSIGN_CROP,fixed_clauses:CONSIGN_FIXED_CLAUSES};
  const state={userId:uid,writes:0,events:[],receipts:new Map(),row:{id:dealId,spec,status:'draft',notes:null,updated_at:'2026-10-18T00:00:00Z'},fields:[],profile:{auth_id:uid,consignor_data:{},consignment_terms_consent:true,consignment_terms_consent_version:CONSIGN_TERMS_VERSION}};
  const client={auth:{getSession:async()=>({data:{session:{user:{id:state.userId}}},error:null})},from(table){
    const filters=[];let single=false;const query={select(){return this;},eq(k,v){filters.push([k,v]);return this;},order(){return this;},maybeSingle(){single=true;return this;},
      then(resolve,reject){const rows=table==='consignment_deals'?[state.row]:table==='consignment_fields'?state.fields:table==='consignment_profiles'?[state.profile]:[];
        const found=rows.filter(r=>filters.every(([k,v])=>r[k]===v));return Promise.resolve({data:single?clone(found[0]||null):clone(found),error:options.readError?{message:'read failed'}:null}).then(resolve,reject);}};return query;
  },async rpc(name,q){
    if(name==='consignment_summary')return {data:null,error:null};
    if(name!=='save_my_consignment_bundle')throw Error('Unexpected RPC '+name);
    state.events.push(clone(q));await options.beforeWrite?.(state,q);
    if(q.p_owner!==state.userId)return {data:{ok:false,reason:'not_logged_in'},error:null};
    let receipt=state.receipts.get(q.p_request_id);
    if(receipt&&!sameProfileValue(receipt.request,q))return {data:{ok:false,reason:'request_mismatch'},error:null};
    if(!receipt){
      if(options.rejected)return {data:{ok:false,reason:'save_rejected'},error:null};
      if(options.conflict)return {data:{ok:false,reason:'conflict'},error:null};
      state.writes++;state.row={...state.row,...clone(q.p_patch),id:q.p_deal_id,updated_at:'2026-10-18T01:00:00Z'};
      const data={ok:true,owner:state.userId,request_id:q.p_request_id,row:clone(state.row),field:null,profile:null};
      receipt={request:clone(q),data};state.receipts.set(q.p_request_id,receipt);
    }
    if(options.lostResponse)throw Error('Response lost');
    if(options.switchAfterWrite)state.userId='other';
    return {data:clone(receipt.data),error:null};
  }};
  return {client,state};
}
export const memoryStorage=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k),data};};
