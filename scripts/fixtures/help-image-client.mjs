import {sameProfileValue} from '../../src/lib/profileRecord.js';
export const uid='00000000-0000-4000-8000-000000000001';
export const origin='https://project.supabase.co/storage/v1/object/public/help-images/';
const clone=x=>JSON.parse(JSON.stringify(x));
export function helpImageFixture(options={}){
  const slot=options.slot||'about-purpose',oldUrl=origin+'old.png',oldBlob=new Blob(['old image'],{type:'image/png'});
  const state={userId:uid,rows:{[slot]:{slot_key:slot,url:oldUrl,updated_at:'2026-10-18T00:00:00Z'}},objects:new Map([['old.png',oldBlob]]),events:[],writes:0};
  const client={auth:{getSession:async()=>({data:{session:{user:{id:state.userId}}},error:null})},from(table){
    if(table!=='help_images')throw Error('Unexpected table');let slots;
    return {select(){return this;},in(k,v){slots=v;return this;},then(resolve,reject){return Promise.resolve({data:Object.values(state.rows).filter(r=>!slots||slots.includes(r.slot_key)).map(clone),error:options.readError?{message:'injected read error'}:null}).then(resolve,reject);}};
  },storage:{from(bucket){if(bucket!=='help-images')throw Error('Unexpected bucket');return {
    getPublicUrl:path=>({data:{publicUrl:origin+path}}),
    async upload(path,blob,settings){state.events.push({upload:path,upsert:settings.upsert});await options.beforeUpload?.(state);
      if(options.uploadError)return {error:{message:'upload failed'}};if(state.objects.has(path))return {error:{message:'duplicate'}};
      state.objects.set(path,options.wrongBytes?new Blob(['wrong'],{type:blob.type}):blob);if(options.uploadLostResponse)throw Error('lost');return {error:null};},
    async download(path){return {data:state.objects.get(path)||null,error:options.downloadError?{}:null};},
    async remove(){throw Error('Object deletion must never happen during reference changes');}
  };}},async rpc(name,a){
    if(name!=='save_help_image_reference')throw Error('Unexpected RPC');state.events.push({rpc:name,args:clone(a)});await options.beforeRPC?.(state,a);
    if(a.p_owner!==state.userId)return {data:{ok:false,reason:'not_logged_in'},error:null};
    if(options.dbError)return {data:null,error:{message:'DB failed'}};
    const current=state.rows[a.p_slot],base=current?{url:current.url,updated_at:current.updated_at}:null;
    if(!sameProfileValue(base,a.p_expected))return {data:{ok:false,reason:'conflict'},error:null};
    state.writes++;const row=a.p_url?{slot_key:a.p_slot,url:a.p_url,updated_at:'2026-10-18T01:00:00Z'}:null;
    if(row)state.rows[a.p_slot]=row;else delete state.rows[a.p_slot];
    if(options.switchAfterRPC)state.userId='different';if(options.dbLostResponse){if(options.failReadAfterLoss)options.readError=true;throw Error('lost');}
    return {data:{ok:true,row:clone(row)},error:null};
  }};
  return {client,state,slot,oldUrl,oldBlob};
}
