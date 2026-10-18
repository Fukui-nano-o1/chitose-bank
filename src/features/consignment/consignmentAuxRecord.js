import {createOperationStore} from '../../lib/operationStore.js';
import {sameProfileValue} from '../../lib/profileRecord.js';
import {consignmentOwner} from './consignmentRecord.js';
const fail=(code,message)=>Object.assign(new Error(message),{code});
export const consignmentAuxStore=()=>createOperationStore('cb_consignment_aux_v1');
export const auxKey=(owner,operation,target)=>`${owner}:${operation}:${target || 'new'}`;
export const fieldBase=row=>row?Object.fromEntries(['name','region','area_a','data','updated_at'].map(k=>[k,row[k]])):null;
export async function readConsignmentAuxPending(client,owner,operation,target,store=consignmentAuxStore()){
  if(!owner)throw fail('CONSIGN_AUX_OWNER','ログイン中の本人を確認してから読み込んでください。');
  await consignmentOwner(client,owner);
  let pending;
  try{pending=await store.read(auxKey(owner,operation,target));if(pending&&(pending.owner!==owner||pending.operation!==operation||pending.target!==(target||null)))throw Error('Invalid operation');}
  catch{throw fail('CONSIGN_AUX_STORAGE','前回の保存操作を読み込めません。端末の保存領域を確認してください。');}
  await consignmentOwner(client,owner);return pending;
}
export async function saveConsignmentAux(client,{owner,operation,target,expected=null,input},{store=consignmentAuxStore(),uuid=()=>crypto.randomUUID()}={}){
  if(!owner)throw fail('CONSIGN_AUX_OWNER','ログイン中の本人を確認してから保存してください。');
  await consignmentOwner(client,owner);
  const key=auxKey(owner,operation,target);let intent;
  try{intent=await store.acquire(key,{requestId:uuid(),owner,operation,target:target||null,id:operation==='progress'?uuid():target||uuid(),expected,input});
    if(intent.owner!==owner||intent.operation!==operation||intent.target!==(target||null)||!intent.id||!intent.requestId)throw Error('Invalid operation');
  }catch{throw fail('CONSIGN_AUX_STORAGE','保存操作を端末に保持できません。入力は残しています。');}
  await consignmentOwner(client,owner);let result;
  try{result=await client.rpc('save_my_consignment_aux',{p_owner:owner,p_operation:operation,p_id:intent.id,p_expected:intent.expected,p_input:intent.input});}
  catch{/* The same input and ID remain durable for manual retry. */}
  await consignmentOwner(client,owner);
  const data=result?.data;
  if(result?.error||!data||typeof data.ok!=='boolean')throw fail('CONSIGN_AUX_UNCONFIRMED','保存結果を確認できません。同じ操作で前回の結果を確認できます。');
  if(!data.ok){await store.clear(key,intent.requestId);throw fail('CONSIGN_AUX_REJECTED',data.reason==='conflict'?'別の画面で内容が変更されています。入力を控えて最新情報と照合してください。':'保存できませんでした。入力は残しています。');}
  if(data.owner!==owner||data.operation!==operation||data.id!==intent.id||!sameProfileValue(data.input,intent.input))throw fail('CONSIGN_AUX_UNCONFIRMED','保存結果と送信内容を照合できません。再試行してください。');
  if(operation==='field_delete'?data.row!==null:['lend','terms'].includes(operation)?data.row?.auth_id!==owner:data.row?.id!==intent.id)throw fail('CONSIGN_AUX_UNCONFIRMED','保存先の記録を照合できません。再試行してください。');
  return {...data,changed:!sameProfileValue(intent.input,input),acknowledge:()=>store.clear(key,intent.requestId)};
}
