import test from 'node:test';
import assert from 'node:assert/strict';
import { listingPhotoReference, createListingPhotoReader } from '../src/lib/listingPhotoAccess.js';
const base='https://project.supabase.co', src=base+'/storage/v1/object/public/job-photos/owner/v2/photo.jpg';
const ref=listingPhotoReference(src,base);
function fixture(){
 let user='owner',callback;const calls=[],revoked=[];let before=async()=>{};
 const client={auth:{getSession:async()=>({data:{session:user?{user:{id:user}}:null}}),onAuthStateChange:fn=>{callback=fn;}},storage:{from:bucket=>({download:async(path,options,parameters)=>{calls.push({bucket,path,parameters});await before();return {data:new Blob(['image'])};}})}};
 const reader=createListingPhotoReader(client,{createObjectURL:()=>`blob:${calls.length}`,revokeObjectURL:u=>revoked.push(u)});
 return {reader,calls,revoked,session:id=>{user=id;callback('SIGNED_OUT',id?{user:{id}}:null);},wait:fn=>before=fn};
}
test('only the configured project listing buckets are authenticated',()=>{
 assert.deepEqual(ref,{bucket:'job-photos',path:'owner/v2/photo.jpg'});
 for(const url of ['/static.jpg','https://external.test/photo.jpg',src.replace('project','another'),base+'/storage/v1/object/public/avatars/a.jpg']) assert.equal(listingPhotoReference(url,base),null);
 assert.equal(listingPhotoReference(src.replace('photo.jpg','bad%00.jpg'),base).blocked,true);
 assert.equal(listingPhotoReference(src.replace('public','sign')+'?token=old',base).path,ref.path);
});
test('simultaneous renders share authenticated no-store bytes and revoke on final release',async()=>{
 const f=fixture();const [a,b]=await Promise.all([f.reader.acquire(ref),f.reader.acquire(ref)]);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].parameters.cache,'no-store');assert.equal(a.url,b.url);
 a.release();assert.equal(f.revoked.length,0);b.release();assert.deepEqual(f.revoked,['blob:1']);
 const c=await f.reader.acquire(ref);assert.equal(f.calls.length,2);c.release();
});
test('logout revokes mounted images and denies further reads',async()=>{
 const f=fixture();const image=await f.reader.acquire(ref);f.session(null);
 assert.ok(f.revoked.includes(image.url));await assert.rejects(f.reader.acquire(ref),/NOT_AUTHENTICATED/);image.release();
});
test('account switch during download rejects the old response',async()=>{
 const f=fixture();let resume;f.wait(()=>new Promise(r=>resume=r));
 const pending=f.reader.acquire(ref);await new Promise(r=>setTimeout(r,0));f.session('other');resume();
 await assert.rejects(pending,/NOT_AVAILABLE/);assert.equal(f.revoked.length,0);
});
test('download refusal never falls back to a public URL',async()=>{
 const f=fixture();f.wait(()=>{throw Error('403');});await assert.rejects(f.reader.acquire(ref));assert.equal(f.calls.length,1);
});
