import {sameProfileValue} from '../../lib/profileRecord.js';
import {stripConsignorIdentity} from './model.js';
const fail=(code,message)=>Object.assign(new Error(message),{code});
async function owner(client,expected){
  const {data,error}=await client.auth.getSession();
  const id=data?.session?.user?.id;
  if(error||!id||(expected&&id!==expected))throw fail('CONSIGNOR_SESSION','ログインを確認できません。画面を開き直してください。');
  return id;
}
export const consignorDraftKey=id=>`cb_consignorDraft_v2:${id}`;
export const consignorBase=record=>({profile:record.profile?{consignor_type:record.profile.consignor_type,consignor_data:record.profile.consignor_data}:null,phone:record.account.contact_phone??null});
export async function readConsignorRecord(client){
  const userId=await owner(client);
  const [p,a]=await Promise.all([
    client.from('consignment_profiles').select('*').eq('auth_id',userId).maybeSingle(),
    client.from('account_holders').select('*').eq('auth_id',userId).maybeSingle(),
  ]);
  if(p.error||a.error)throw fail('CONSIGNOR_READ','保存済みの情報を読み込めませんでした。もう一度読み込んでください。');
  if(!a.data)throw fail('CONSIGNOR_ACCOUNT','登録情報を確認できません。登録情報を確認してから開き直してください。');
  await owner(client,userId);
  return {status:'ready',userId,profile:p.data,account:a.data};
}
export async function saveConsignorRecord(client,record,type,input){
  if(record?.status!=='ready')throw fail('CONSIGNOR_NOT_LOADED','保存済みの情報を読み込んでから保存してください。');
  await owner(client,record.userId);
  const data=stripConsignorIdentity(input);
  delete data.ind_phone;
  const phone=type==='individual'&&!String(record.account.contact_phone||'').trim()?String(input.ind_phone||'').trim()||null:null;
  const matches=r=>r.profile?.consignor_type===type&&sameProfileValue(r.profile.consignor_data,data)&&(!phone||r.account?.contact_phone===phone);
  let result,failed;
  try {
    const r=await client.rpc('save_my_consignor_profile',{
      p_owner:record.userId,
      p_expected:record.profile?{consignor_type:record.profile.consignor_type,consignor_data:record.profile.consignor_data}:null,
      p_type:type,p_data:data,p_expected_phone:record.account.contact_phone??null,p_phone:phone,
    });result=r.data;failed=r.error;
  }catch(e){failed=e;}
  if(!failed&&result?.ok&&matches(result)){
    await owner(client,record.userId);
    return {...record,profile:result.profile,account:result.account};
  }
  let current;
  try{current=await readConsignorRecord(client);if(current.userId!==record.userId)throw fail('CONSIGNOR_SESSION','アカウントが変わりました。');}
  catch{throw fail('CONSIGNOR_UNCONFIRMED','保存結果を確認できませんでした。入力は残しています。通信を確認してから再試行してください。');}
  if(matches(current))return current;
  if(['conflict','phone_conflict'].includes(result?.reason))throw fail('CONSIGNOR_CONFLICT','別の画面で登録情報が変更されています。入力は残しています。最新の情報を確認してください。');
  throw fail('CONSIGNOR_SAVE','保存に失敗しました。電話番号と委託者情報の両方が確認できるまで完了にしません。入力は残しています。');
}

export async function saveConsignorConsent(client,record,version){
  if(record?.status!=='ready')throw fail('CONSIGNOR_NOT_LOADED','保存済みの情報を読み込んでから同意してください。');
  await owner(client,record.userId);
  const at=new Date().toISOString();
  try{await client.rpc('save_my_consignor_consent',{p_owner:record.userId,p_version:version,p_at:at});}
  catch{/* Read the canonical record before claiming confirmation. */}
  const current=await readConsignorRecord(client),p=current.profile;
  if(current.userId!==record.userId||!p?.consignment_data_consent||p.consignment_data_consent_version!==version
    ||p.consignment_data_consent_user_id!==record.userId||Date.parse(p.consignment_data_consent_at)!==Date.parse(at)){
    throw fail('CONSIGNOR_CONSENT','同意の記録を確認できませんでした。入力は残しています。再試行してください。');
  }
  // A consent refresh must not adopt another editor's profile as the baseline for old form input.
  return {...record,profile:{...current.profile,...(record.profile?consignorBase(record).profile:{})}};
}
