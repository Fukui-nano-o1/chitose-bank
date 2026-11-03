import test from 'node:test';
import assert from 'node:assert/strict';
import {readWorkplaceLibrary,reuseWorkplacePhoto,deleteWorkplacePhoto} from '../src/lib/workplaceRecord.js';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const photo=(hex,uid=owner)=>({id:hex.repeat(64),path:`${uid}/${hex.repeat(64)}.jpg`});
const asset=(hex,state='ready',slot=1,uid=owner)=>({...photo(hex,uid),state,slot,content_hash:hex.repeat(64)});
const row=()=>({owner_id:owner,revision:1,draft_photos:[],published_photos:[],publication_active:false});
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const state={user:owner,row:row(),photos:[asset('a')],calls:[],removes:[],override:null,removeMode:'ok'};
 const client={auth:{getSession:async()=>({data:{session:state.user?{user:{id:state.user}}:null}})},storage:{from:bucket=>({remove:async paths=>{state.removes.push({bucket,paths});if(state.removeMode==='lost')throw Error('lost delete response');if(state.removeMode==='denied')return {error:Error('403')};return {};}})},rpc:async(name,args)=>{
  state.calls.push({name,args});if(state.override){const result=await state.override(name,args);if(result!==undefined)return result;}
  if(name==='read_my_workplace')return {data:{ok:true,row:clone(state.row)}};
  if(name==='read_my_workplace_photos')return {data:{ok:true,photos:clone(state.photos),limit:24}};
  if(name==='save_my_workplace'){state.row={...state.row,revision:state.row.revision+1,draft_photos:args.p_photos};return {data:{ok:true,row:clone(state.row)}};}
  if(name==='prepare_delete_workplace_photo'){const found=state.photos.find(p=>p.id===args.p_id);found.state='deleting';return {data:{ok:true,photo:clone(found)}};}
  if(name==='finalize_delete_workplace_photo'){const found=state.photos.find(p=>p.id===args.p_id);state.photos=state.photos.filter(p=>p.id!==args.p_id);return {data:{ok:true,photo:{...found,state:'deleted'}}};}
  throw Error('Unexpected RPC '+name);
 }};return {client,state};
}
test('saved library is own-session only and validates immutable owner paths',async()=>{
 const {client,state}=fixture();assert.deepEqual(await readWorkplaceLibrary(client,owner),state.photos);assert.deepEqual(state.calls[0],{name:'read_my_workplace_photos',args:{p_owner:owner}});
 state.user=other;await assert.rejects(readWorkplaceLibrary(client,owner));state.user=owner;
 for(const photos of [[asset('a','ready',1,other)],[asset('a'),asset('a')],[{...asset('a'),path:'https://external.test/photo.jpg'}],[asset('a','unknown')]]){state.photos=photos;await assert.rejects(readWorkplaceLibrary(client,owner));}
 state.photos=[asset('a')];state.override=async name=>{if(name==='read_my_workplace_photos'){state.user=other;return {data:{ok:true,photos:state.photos,limit:24}};}};await assert.rejects(readWorkplaceLibrary(client,owner));assert.equal(state.removes.length,0);
});
test('reuse only attaches a ready saved asset without upload or object deletion',async()=>{
 const {client,state}=fixture(),got=await reuseWorkplacePhoto(client,row(),photo('a').id);assert.deepEqual(got.draft_photos,[photo('a')]);assert.equal(state.removes.length,0);assert.equal(state.calls.filter(c=>c.name==='save_my_workplace').length,1);
 for(const value of ['pending','deleting']){const f=fixture();f.state.photos=[asset('a',value)];await assert.rejects(reuseWorkplacePhoto(f.client,row(),photo('a').id));assert.equal(f.state.calls.some(c=>c.name==='save_my_workplace'),false);}
 const f=fixture();await assert.rejects(reuseWorkplacePhoto(f.client,row(),photo('b').id));assert.equal(f.state.removes.length,0);
});
test('irreversible delete requires explicit confirmation and never deletes referenced draft or published photos',async()=>{
 for(const consent of [null,{}, {irreversible:false}]){const f=fixture();await assert.rejects(deleteWorkplacePhoto(f.client,row(),photo('a').id,consent));assert.equal(f.state.removes.length,0);assert.equal(f.state.calls.some(c=>c.name==='prepare_delete_workplace_photo'),false);}
 for(const field of ['draft_photos','published_photos']){const f=fixture();f.state.row[field]=[photo('a')];await assert.rejects(deleteWorkplacePhoto(f.client,f.state.row,photo('a').id,{irreversible:true}));assert.equal(f.state.removes.length,0);}
});
test('confirmed unused delete prepares exact asset then removes only its dedicated path and finalizes',async()=>{
 const {client,state}=fixture();await deleteWorkplacePhoto(client,row(),photo('a').id,{irreversible:true});
 assert.deepEqual(state.removes,[{bucket:'workplace-photos',paths:[photo('a').path]}]);assert.equal(state.photos.length,0);
 const prepare=state.calls.find(c=>c.name==='prepare_delete_workplace_photo');assert.deepEqual(prepare.args,{p_owner:owner,p_id:photo('a').id,p_confirm:true});assert.equal(state.calls.filter(c=>c.name==='finalize_delete_workplace_photo').length,1);
});
test('server-side reference race or uncertain preparation never reaches physical remove',async()=>{
 for(const mode of ['referenced','lost']){const {client,state}=fixture();state.override=async name=>{if(name==='prepare_delete_workplace_photo'){if(mode==='lost')throw Error('lost prepare');return {data:{ok:false,reason:'referenced'}};}};await assert.rejects(deleteWorkplacePhoto(client,row(),photo('a').id,{irreversible:true}));assert.equal(state.removes.length,0);assert.equal(state.calls.filter(c=>c.name==='prepare_delete_workplace_photo').length,1);}
});
test('unknown storage deletion/finalization is reported unconfirmed without blind retry',async()=>{
 for(const mode of ['lost','denied','finalize']){const {client,state}=fixture();state.removeMode=mode;state.override=async name=>{if(mode==='finalize'&&name==='finalize_delete_workplace_photo')throw Error('lost finalization');};await assert.rejects(deleteWorkplacePhoto(client,row(),photo('a').id,{irreversible:true}),e=>e.code==='DELETE_UNCONFIRMED');assert.equal(state.removes.length,1);assert.equal(state.calls.filter(c=>c.name==='prepare_delete_workplace_photo').length,1);}
});
test('session switch after preparation cannot remove another account object',async()=>{
 const {client,state}=fixture();state.override=async name=>{if(name==='prepare_delete_workplace_photo'){state.user=other;return {data:{ok:true,photo:asset('a','deleting')}};}};await assert.rejects(deleteWorkplacePhoto(client,row(),photo('a').id,{irreversible:true}));assert.equal(state.removes.length,0);
});
