import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {uploadJobPhoto,recompressBucket} from '../src/lib/image.js';
const owner='00000000-0000-4000-8000-000000000001';
const photo=()=>new File(['photo bytes'],'field.png',{type:'image/png'});
function fixture(options={}) {
 const state={owner,objects:new Map(),requests:[],writes:0};
 const client=createClient('https://storage.test','test-anon',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,init={})=>{
  const path=new URL(url).pathname,method=init.method||'GET';state.requests.push({path,method,headers:Object.fromEntries(new Headers(init.headers))});
  const key=decodeURIComponent(path.split('/storage/v1/object/')[1]||'');
  if(method==='POST'){
   assert.ok(key.includes('/'+state.owner+'/v2/'));assert.notEqual(new Headers(init.headers).get('x-upsert'),'true');
   if(options.denied)return Response.json({message:'denied',statusCode:'403'},{status:403});
   if(state.objects.has(key))return Response.json({message:'duplicate',statusCode:'409'},{status:409});
   const blob=init.body.get('');assert.ok(blob);state.objects.set(key,blob);state.writes++;
   if(options.corrupt)state.objects.set(key,new Blob(['wrong bytes'],{type:blob.type}));
   if(options.switchOwner)state.owner='other';
   if(options.lost||options.corrupt)throw new TypeError('response lost');
   return Response.json({Key:key});
  }
  if(method==='GET'){
   if(options.readError)return Response.json({message:'unavailable'},{status:503});
   return state.objects.has(key)?new Response(state.objects.get(key)):Response.json({message:'missing'},{status:404});
  }
  throw Error('unexpected '+method+' '+path);
 }}});
 client.auth.getSession=async()=>({data:{session:state.owner?{user:{id:state.owner}}:null},error:null});
 return {client,state,options};
}
test('normal, concurrent and lost-response photo uploads reuse exact owner-scoped bytes across fresh File objects',async()=>{
 for(const lost of [false,true]){const f=fixture({lost});const [a,b]=await Promise.all([uploadJobPhoto(f.client,photo(),{ownerId:owner,withThumb:false}),uploadJobPhoto(f.client,photo(),{ownerId:owner,withThumb:false})]);assert.equal(a.url,b.url);assert.match(a.url,/\/v2\/job_[a-f0-9]{64}\.png$/);assert.equal(f.state.writes,1);assert.equal((await uploadJobPhoto(f.client,photo(),{ownerId:owner,withThumb:false})).url,a.url);assert.equal(f.state.writes,1);}
});
test('unknown upload plus failed read retries the same object after recovery, without another object or overwrite',async()=>{
 const f=fixture({lost:true,readError:true});await assert.rejects(uploadJobPhoto(f.client,photo(),{withThumb:false}),{code:'PHOTO_UNCONFIRMED'});assert.equal(f.state.writes,1);f.options.readError=false;await uploadJobPhoto(f.client,photo(),{withThumb:false});assert.equal(f.state.writes,1);
});
test('denied and mismatched same-size objects cannot masquerade as saved photos; no delete is attempted',async()=>{
 for(const options of [{denied:true},{corrupt:true}]){const f=fixture(options);await assert.rejects(uploadJobPhoto(f.client,photo(),{withThumb:false}),{code:'PHOTO_UNCONFIRMED'});assert.equal(f.state.requests.some(r=>r.method==='DELETE'),false);}
});
test('owner loss or switch never returns a usable photo result, and wrong owner stops before upload',async()=>{
 const f=fixture({switchOwner:true});await assert.rejects(uploadJobPhoto(f.client,photo(),{ownerId:owner,withThumb:false}),{code:'PHOTO_SESSION'});
 for(const id of [null,'other']){const g=fixture();g.state.owner=id;await assert.rejects(uploadJobPhoto(g.client,photo(),{ownerId:owner,withThumb:false}),{code:'PHOTO_SESSION'});assert.equal(g.state.requests.length,0);}
});
test('full and thumbnail use separate immutable bytes; a failed optional thumbnail is not advertised',async()=>{
 const f=fixture();const old=globalThis.createImageBitmap;globalThis.createImageBitmap=async()=>({width:20,height:20,close(){}});
 try{const r=await uploadJobPhoto(f.client,photo());assert.ok(r.thumb);assert.notEqual(r.url,r.thumb);assert.equal(f.state.writes,2);await uploadJobPhoto(f.client,photo());assert.equal(f.state.writes,2);
 const base=f.client.storage.from.bind(f.client.storage);f.client.storage.from=b=>{const s=base(b);const up=s.upload.bind(s),down=s.download.bind(s);s.upload=(p,...a)=>p.includes('/thumb_')?Promise.resolve({error:{message:'denied'}}):up(p,...a);s.download=(p,...a)=>p.includes('/thumb_')?Promise.resolve({error:{message:'offline'}}):down(p,...a);return s;};const fallback=await uploadJobPhoto(f.client,photo());assert.equal(fallback.url,r.url);assert.equal(fallback.thumb,undefined);
 }finally{globalThis.createImageBitmap=old;}
});
test('bulk compression skips immutable content-addressed objects',async()=>{
 const paths=[];const client={storage:{from:()=>({list:async p=>({data:p===''?[{name:owner,id:null}]:p===owner?[{name:'v2',id:null}]:[{name:'job_hash.png',id:'id',metadata:{size:999999}}]}),download:async p=>{paths.push(p);throw Error('must not modify');}})}};
 const r=await recompressBucket(client,'job-photos');assert.equal(r.candidates,0);assert.deepEqual(paths,[]);
});
