import {profileFixture,uid} from './profile-client.mjs';
import {sameProfileValue} from '../../src/lib/profileRecord.js';
export {uid};
const clone=x=>JSON.parse(JSON.stringify(x));
export function consignorFixture(options={}){
  const f=profileFixture(options),{state,client}=f;
  state.rows.account_holders={auth_id:uid,full_name:'試験用の氏名',entity_type:'individual',contact_phone:null,contact_email:'test@example.invalid',address:'試験用の住所'};
  state.rows.consignment_profiles={auth_id:uid,consignor_type:'individual',consignor_data:{cmn_bank:'元の銀行'},consignment_data_consent:true,
    consignment_data_consent_version:'consignment-data-v2-2026-08',consignment_data_consent_user_id:uid,consignment_data_consent_at:'2026-10-01T00:00:00Z'};
  if(options.remoteData)state.rows.consignment_profiles.consignor_data=clone(options.remoteData);
  client.rpc=async(name,a)=>{
    state.events.push({rpc:name,args:clone(a)});state.writes++;
    await options.beforeAtomicWrite?.(state,a);
    if(a.p_owner!==state.userId)return {data:{ok:false,reason:'not_logged_in'},error:null};
    if(name==='save_my_consignor_consent'){
      if(options.dbError)return {data:null,error:{code:'42501'}};
      Object.assign(state.rows.consignment_profiles,{consignment_data_consent:true,consignment_data_consent_at:a.p_at,consignment_data_consent_version:a.p_version,consignment_data_consent_user_id:a.p_owner});
      if(options.lostResponse)throw Error('Response lost');
      return {data:{ok:true,profile:clone(state.rows.consignment_profiles)},error:null};
    }
    if(options.phoneError||options.profileError)return {data:null,error:{code:'P0001',message:'Injected refusal'}};
    const p=state.rows.consignment_profiles,account=state.rows.account_holders;
    const base=p?{consignor_type:p.consignor_type,consignor_data:p.consignor_data}:null;
    if(!sameProfileValue(base,a.p_expected))return {data:{ok:false,reason:'conflict'},error:null};
    if(a.p_phone&&account.contact_phone&&account.contact_phone!==a.p_phone)return {data:{ok:false,reason:'phone_conflict'},error:null};
    if(a.p_phone)account.contact_phone=a.p_phone;
    state.rows.consignment_profiles={...p,auth_id:uid,consignor_type:a.p_type,consignor_data:clone(a.p_data)};
    if(options.switchAfterWrite)state.userId='different-user';
    if(options.lostResponse)throw Error('Response lost');
    return {data:{ok:true,profile:clone(state.rows.consignment_profiles),account:clone(account)},error:null};
  };
  return f;
}
