import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {uploadJobPhoto,recompressBucket,generateJobPhotoThumbs} from '../src/lib/image.js';
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

function maintenanceFixture(options={}) {
 const id='00000000-0000-4000-8000-000000000010',path='job-photos/farmer/original.png';
 const original=[{url:'https://storage.test/storage/v1/object/public/'+path,caption:'残す説明'}];
 const state={owner,row:{id,photos:structuredClone(original),notes:'別項目'},objects:new Map([[path,photo()]]),requests:[],patches:0};
 const client=createClient('https://storage.test','test-anon',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,init={})=>{
  const u=new URL(url),method=init.method||'GET';state.requests.push({path:u.pathname,method});
  if(u.pathname==='/rest/v1/jobs'){
   if(method==='PATCH'){
    state.patches++;assert.equal(u.searchParams.get('id'),'eq.'+id);
    const baseline=JSON.parse(u.searchParams.get('photos').slice(3));assert.deepEqual(baseline,original);
    options.beforePatch?.(state);
    if(options.denied)return Response.json({code:'42501',message:'denied'},{status:403});
    if(!options.zero&&state.row&&JSON.stringify(state.row.photos)===JSON.stringify(baseline))state.row={...state.row,...JSON.parse(init.body)};
    if(options.dbLost)throw TypeError('lost result');
    return new Response(null,{status:204});
   }
   assert.equal(method,'GET');
   if(u.searchParams.has('id')){
    if(options.readError)return Response.json({message:'unreadable'},{status:403});
    return Response.json(state.row?[state.row]:[]);
   }
   if(options.listError)return Response.json({message:'unreadable'},{status:403});
   return Response.json(state.row?[state.row]:[]);
  }
  const key=decodeURIComponent(u.pathname.split('/storage/v1/object/')[1]||'');
  if(method==='POST'){
   assert.notEqual(new Headers(init.headers).get('x-upsert'),'true');assert.match(key,/\/v2\/thumb_backfill_[a-f0-9]{64}\.png$/);
   if(options.uploadDenied)return Response.json({message:'denied'},{status:403});
   if(state.objects.has(key))return Response.json({message:'duplicate'},{status:409});
   state.objects.set(key,init.body.get(''));
   if(options.switchOwner)state.owner='other';
   if(options.storageLost)throw TypeError('lost object response');
   return Response.json({Key:key});
  }
  if(method==='GET')return state.objects.has(key)?new Response(state.objects.get(key)):Response.json({message:'missing'},{status:404});
  throw Error('unexpected '+method+' '+u.pathname);
 }}});
 client.auth.getSession=async()=>({data:{session:state.owner?{user:{id:state.owner}}:null},error:null});
 return {client,state,options,original,path};
}
test('thumbnail backfill confirms immutable upload and CAS, preserves caption and unrelated input, and skips replay',async()=>{
 const f=maintenanceFixture({storageLost:true,dbLost:true});const r=await generateJobPhotoThumbs(f.client);
 assert.equal(r.updatedJobs,1);assert.equal(r.unconfirmedJobs,0);assert.equal(f.state.row.photos[0].caption,'残す説明');assert.equal(f.state.row.notes,'別項目');assert.ok(f.state.row.photos[0].thumb.includes('/v2/'));
 assert.equal(await f.state.objects.get(f.path).text(),'photo bytes');assert.equal(f.state.objects.size,2);
 const replay=await generateJobPhotoThumbs(f.client);assert.equal(replay.skipped,1);assert.equal(replay.updatedJobs,0);assert.equal(f.state.patches,1);
 const forced=await generateJobPhotoThumbs(f.client,{force:true});assert.equal(forced.failed,0);assert.equal(f.state.objects.size,2);assert.equal(f.state.patches,1);
 assert.equal(f.state.requests.some(r=>r.method==='DELETE'),false);
});
test('backfill cannot resurrect removed photos or undo added/reordered photos during compression',async()=>{
 for(const photos of [[],['new-photo'],['new-photo',{url:'kept-photo'}]]){
  const f=maintenanceFixture({beforePatch:s=>{s.row.photos=photos;s.row.notes='別端末の入力';}});
  const r=await generateJobPhotoThumbs(f.client);assert.equal(r.updatedJobs,0);assert.equal(r.conflictedJobs,1);assert.deepEqual(f.state.row.photos,photos);assert.equal(f.state.row.notes,'別端末の入力');assert.ok(f.state.objects.has(f.path));
 }
});
test('zero rows, permission denial, deleted job, and unreadable confirmation never count as saved',async()=>{
 for(const options of [{zero:true},{denied:true},{beforePatch:s=>{s.row=null;}},{dbLost:true,readError:true}]){
  const f=maintenanceFixture(options);const r=await generateJobPhotoThumbs(f.client);assert.equal(r.updatedJobs,0);assert.equal(r.conflictedJobs+r.unconfirmedJobs,1);
  assert.equal(f.state.requests.some(x=>x.method==='DELETE'),false);assert.ok(f.state.objects.has(f.path));
 }
});
test('failed thumbnail upload and owner switch keep the original references; failed list read starts no work',async()=>{
 for(const options of [{uploadDenied:true},{switchOwner:true},{listError:true}]){
  const f=maintenanceFixture(options);const r=await generateJobPhotoThumbs(f.client);assert.deepEqual(f.state.row.photos,f.original);assert.equal(f.state.patches,0);
  if(options.listError){assert.ok(r.error);assert.equal(f.state.requests.length,1);}else assert.equal(r.failed,1);
 }
});
