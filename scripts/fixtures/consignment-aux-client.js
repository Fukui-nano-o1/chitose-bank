import {consignmentFixture,uid} from './consignment-deal-client.mjs';
export const fixture=consignmentFixture(window.qaOptions);
const {state,client}=fixture;window.qaAux=state;state.progress={};state.auxRequests=[];
if(window.qaMode==='progress')state.row.status='working';
if(window.qaMode==='terms')state.profile.consignment_terms_consent=false;
const rpc=client.rpc.bind(client);
client.rpc=async(name,q)=>{
 if(name!=='save_my_consignment_aux')return rpc(name,q);
 state.auxRequests.push(JSON.parse(JSON.stringify(q)));await window.qaOptions.beforeWrite?.();
 if(window.qaOptions.rejected)return {data:{ok:false,reason:'save_rejected'}};
 let row;
 if(q.p_operation==='advance'){state.row={...state.row,status:'agreed',updated_at:'2026-10-18T02:00:00Z'};row=state.row;}
 if(q.p_operation==='progress'){row=state.progress[q.p_id]||{id:q.p_id,...q.p_input};state.progress[q.p_id]=row;}
 if(q.p_operation==='field_save'){row={id:q.p_id,auth_id:uid,...q.p_input,updated_at:'2026-10-18T02:00:00Z'};state.fields=[row,...state.fields.filter(f=>f.id!==row.id)];}
 if(q.p_operation==='field_delete'){state.fields=state.fields.filter(f=>f.id!==q.p_id);row=null;}
 if(q.p_operation==='lend'){state.profile={...state.profile,consignor_data:{...state.profile.consignor_data,cmn_lend_items:q.p_input.items}};row=state.profile;}
 if(q.p_operation==='terms'){state.profile={...state.profile,consignment_terms_consent:true,consignment_terms_consent_version:q.p_input.version};row=state.profile;}
 if(window.qaOptions.lost)throw Error('lost response');
 return {data:{ok:true,owner:uid,id:q.p_id,operation:q.p_operation,input:q.p_input,row}};
};
export const supabase=client;
