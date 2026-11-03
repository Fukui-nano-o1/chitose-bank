import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as workplaceAdapter from '../src/lib/workplaceRecord.js';
import {workplaceOwner,validWorkplacePhotos,readWorkplaceRecord,saveWorkplacePhotos,publishWorkplace,unpublishWorkplace} from '../src/lib/workplaceRecord.js';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const photo=(hex,uid=owner)=>({id:hex.repeat(64),path:`${uid}/${hex.repeat(64)}.jpg`});
const record=(patch={})=>({owner_id:owner,revision:1,draft_photos:[photo('a')],published_photos:[],publication_active:false,...patch});
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(initial=record()){
 const state={user:owner,row:clone(initial),calls:[],removes:[],handler:null,authError:null,removeError:null};
 const client={auth:{getSession:async()=>({data:{session:state.user?{user:{id:state.user}}:null},error:state.authError})},rpc:async(name,args)=>{
  state.calls.push({name,args});if(state.handler)return state.handler(name,args,state);
  return {data:{ok:true,row:clone(state.row)}};
 },storage:{from:bucket=>({remove:async paths=>{state.removes.push({bucket,paths});return {error:state.removeError};}})}};
 return {client,state};
}
const code=expected=>error=>error.code===expected;
test('owner/session boundaries and absent server capability fail closed',async()=>{
 const {client,state}=fixture();assert.equal(await workplaceOwner(client,owner),owner);
 state.user=null;await assert.rejects(readWorkplaceRecord(client,owner),code('SESSION'));assert.equal(state.calls.length,0);
 state.user=other;await assert.rejects(readWorkplaceRecord(client,owner),code('SESSION'));assert.equal(state.calls.length,0);
 state.user=owner;state.authError=Error('auth');await assert.rejects(readWorkplaceRecord(client,owner),code('SESSION'));state.authError=null;
 for(const errorCode of ['PGRST202','42883']){state.handler=async()=>({error:{code:errorCode}});await assert.rejects(readWorkplaceRecord(client,owner),code('UNCONFIGURED'));}
 state.handler=async()=>({error:{code:'403'}});await assert.rejects(readWorkplaceRecord(client,owner),code('READ'));
});
test('read validates owner, integer revision and both independent photo lists',async()=>{
 const {client,state}=fixture();const got=await readWorkplaceRecord(client,owner);assert.deepEqual(got,state.row);
 for(const patch of [{owner_id:other},{revision:1.5},{draft_photos:[photo('a',other)]},{published_photos:[{...photo('a'),url:'https://bad'}]},{draft_photos:[photo('a'),photo('a')]}]){
  state.row=record(patch);await assert.rejects(readWorkplaceRecord(client,owner),code('READ'));
 }
 state.handler=async()=>({data:{ok:true,row:null}});assert.deepEqual(await readWorkplaceRecord(client,owner),record({revision:0,draft_photos:[]}));
 state.handler=async()=>{state.user=other;return {data:{ok:true,row:record()}};};await assert.rejects(readWorkplaceRecord(client,owner),code('SESSION'));
});
test('photo shape validates exact owner, fields, uniqueness and six-photo cap',()=>{
 assert.equal(validWorkplacePhotos([],owner),true);assert.equal(validWorkplacePhotos([photo('a')],owner),true);
 for(const photos of [null,[photo('a'),photo('a')],[photo('a',other)],[{...photo('a'),caption:'not allowed'}],Array.from({length:7},(_,i)=>photo(String(i)))])assert.equal(validWorkplacePhotos(photos,owner),false);
});
test('save sends one CAS request and returns confirmed draft without changing published list',async()=>{
 const old=record({published_photos:[photo('a')],publication_active:true}),{client,state}=fixture(old),next=[photo('b')];
 state.handler=async(name,args)=>{assert.equal(name,'save_my_workplace');assert.deepEqual(args,{p_owner:owner,p_expected_revision:1,p_photos:next});return {data:{ok:true,row:record({revision:2,draft_photos:next,published_photos:old.published_photos,publication_active:true})}};};
 const got=await saveWorkplacePhotos(client,old,next);assert.equal(got.revision,2);assert.deepEqual(got.published_photos,old.published_photos);assert.equal(state.calls.length,1);assert.equal(state.removes.length,0);
 await assert.rejects(saveWorkplacePhotos(client,old,[photo('a',other)]),code('PHOTOS'));assert.equal(state.calls.length,1);
});
test('malformed successful RPC rows are not accepted as confirmed writes',async()=>{
 const next=[photo('b')];
 for(const patch of [{revision:2.5},{owner_id:other},{published_photos:[photo('a',other)]},{publication_active:'true'}]){
  const {client,state}=fixture();state.handler=async name=>({data:{ok:true,row:name==='save_my_workplace'?{...record({revision:2,draft_photos:next}),...patch}:record()}});
  await assert.rejects(saveWorkplacePhotos(client,record(),next),code('SAVE'));assert.deepEqual(state.calls.map(c=>c.name),['save_my_workplace','read_my_workplace']);assert.equal(state.removes.length,0);
 }
});
test('lost write response is reconciled by read, never blindly repeated',async()=>{
 const {client,state}=fixture(),old=record(),next=[photo('b')];
 state.handler=async name=>{if(name==='save_my_workplace'){state.row=record({revision:2,draft_photos:next});throw Error('lost response');}return {data:{ok:true,row:state.row}};};
 const got=await saveWorkplacePhotos(client,old,next);assert.equal(got.revision,2);assert.deepEqual(state.calls.map(c=>c.name),['save_my_workplace','read_my_workplace']);assert.equal(state.removes.length,0);
});
test('conflict and unconfirmed mutation preserve objects without cleanup',async()=>{
 for(const mode of ['conflict','unconfirmed','save']){
  const {client,state}=fixture();state.handler=async name=>{
   if(name==='save_my_workplace')return {data:{ok:false,reason:mode==='conflict'?'conflict':'failed'}};
   if(mode==='unconfirmed')return {error:Error('offline')};
   return {data:{ok:true,row:mode==='conflict'?record({revision:2,draft_photos:[photo('c')]}):record()}};
  };
  await assert.rejects(saveWorkplacePhotos(client,record(),[photo('b')]),code(mode==='conflict'?'CONFLICT':mode==='unconfirmed'?'UNCONFIRMED':'SAVE'));
  assert.equal(state.removes.length,0);
 }
});
test('publish needs both consents and exact draft snapshot; unpublish confirms inactive flag',async()=>{
 const {client,state}=fixture(),old=record();
 for(const consent of [null,{}, {publicWeb:true},{people:true}])await assert.rejects(publishWorkplace(client,old,consent),code('CONSENT'));
 assert.equal(state.calls.length,0);
 state.handler=async(name,args)=>{
  if(name==='publish_my_workplace'){assert.deepEqual(args,{p_owner:owner,p_expected_revision:1,p_image_consent:true,p_people_consent:true});return {data:{ok:true,row:record({revision:2,published_photos:old.draft_photos,publication_active:true})}};}
  assert.equal(name,'unpublish_my_workplace');return {data:{ok:true,row:record({revision:3,published_photos:[],publication_active:false})}};
 };
 const published=await publishWorkplace(client,old,{publicWeb:true,people:true});assert.equal(published.publication_active,true);
 const unpublished=await unpublishWorkplace(client,published);assert.equal(unpublished.publication_active,false);assert.deepEqual(unpublished.published_photos,[]);assert.deepEqual(unpublished.draft_photos,old.draft_photos);assert.equal(state.removes.length,0);
});
test('ordinary save and publication APIs never automatically remove stored objects',async()=>{
 assert.equal(workplaceAdapter.cleanupWorkplacePhotos,undefined);
 const source=await readFile(new URL('../src/components/WorkplaceEditor.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/\.remove\s*\(|cleanupWorkplacePhotos/,'controller delegates explicit deletion only');
});
