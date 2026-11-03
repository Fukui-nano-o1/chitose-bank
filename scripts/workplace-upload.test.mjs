import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'vite';
const root=fileURLToPath(new URL('../',import.meta.url));
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const raw={name:'synthetic.png'},encoded=new Blob(['encoded-jpeg-only'],{type:'image/jpeg'}),id=createHash('sha256').update('encoded-jpeg-only').digest('hex'),photo={id,path:`${owner}/${id}.jpg`};
const record=()=>({owner_id:owner,revision:1,draft_photos:[],published_photos:[],publication_active:false});
function fixture(){
 const state={user:owner,calls:[],remove:[],row:record(),uploadMode:'ok',saveMode:'ok',downloadBytes:encoded,reserveMode:'ok',finalizeMode:'ok',library:[],reserved:null};
 const client={auth:{getSession:async()=>({data:{session:{user:{id:state.user}}}})},storage:{from:bucket=>({
  upload:async(path,blob,options)=>{state.calls.push({action:'upload',bucket,path,blob,options});if(state.uploadMode==='switch'){state.user=other;return {data:{}};}if(state.uploadMode==='lost')throw Error('lost upload response');return state.uploadMode==='denied'?{error:Error('403')}:{data:{}};},
  download:async(path,_options,request)=>{state.calls.push({action:'download',bucket,path,request});return {data:state.downloadBytes};},
  remove:async paths=>{state.remove.push(paths);return {};},
 })},rpc:async(name,args)=>{
  state.calls.push({action:'rpc',name,args});
  if(name==='read_my_workplace')return {data:{ok:true,row:state.row}};
  if(name==='read_my_workplace_photos')return {data:{ok:true,photos:state.library,limit:24}};
  if(name==='reserve_workplace_photo'){state.reserved=state.library.find(p=>p.id===args.p_id)||{id:args.p_id,path:`${owner}/${args.p_id}.jpg`,content_hash:args.p_content_hash,state:'pending',slot:1};return state.reserveMode==='quota'?{data:{ok:false,reason:'quota'}}:{data:{ok:true,photo:state.reserved}};}
  if(name==='finalize_workplace_photo')return state.finalizeMode==='denied'?{data:{ok:false,reason:'missing'}}:{data:{ok:true,photo:{...state.reserved,state:'ready'}}};
  if(state.saveMode==='conflict'){state.row={...record(),revision:2};return {data:{ok:false,reason:'conflict'}};}
  state.row={...record(),revision:2,draft_photos:args.p_photos};if(state.saveMode==='lost')throw Error('lost save response');return {data:{ok:true,row:state.row}};
 }};
 return {client,state};
}
test('upload adapter hashes encoded JPEG and reconciles uncertain uploads without destructive retries',async t=>{
 const output=await mkdtemp(path.join(tmpdir(),'cb-workplace-upload-'));const prior=globalThis.qaEncodeWorkplace;
 try{
  await build({configFile:false,root,logLevel:'error',plugins:[{name:'encoded-fixture',enforce:'pre',resolveId(id){if(id.endsWith('/workplaceImage.js')||id==='./workplaceImage.js')return '\0workplace-encoder-fixture';},load(id){if(id==='\0workplace-encoder-fixture')return 'export const encodeWorkplaceImage = file => globalThis.qaEncodeWorkplace(file);';}}],build:{outDir:output,lib:{entry:path.join(root,'src/lib/workplaceRecord.js'),formats:['es'],fileName:()=> 'adapter.mjs'},minify:false}});
  const {addWorkplacePhoto}=await import(pathToFileURL(path.join(output,'adapter.mjs')).href);
  globalThis.qaEncodeWorkplace=async file=>{assert.equal(file,raw);return encoded;};
  await t.test('only re-encoded bytes upload with immutable dedicated path and content type',async()=>{
   const {client,state}=fixture(),got=await addWorkplacePhoto(client,record(),raw);const upload=state.calls.find(c=>c.action==='upload');
   assert.equal(upload.bucket,'workplace-photos');assert.equal(upload.path,`${owner}/${state.reserved.id}.jpg`);assert.notEqual(state.reserved.id,id,'asset id differs from content hash');assert.equal(state.reserved.content_hash,id);assert.equal(upload.blob,encoded);assert.deepEqual(upload.options,{upsert:false,contentType:'image/jpeg'});assert.deepEqual(got.draft_photos,[{id:state.reserved.id,path:state.reserved.path}]);assert.equal(state.remove.length,0);
  });
  await t.test('fresh file selection creates new identity even when identical bytes are already ready in draft',async()=>{
   const {client,state}=fixture(),old={...record(),draft_photos:[photo]};state.library=[{...photo,state:'ready',slot:1,content_hash:id}];
   const got=await addWorkplacePhoto(client,old,raw);assert.notEqual(state.reserved.id,photo.id);assert.equal(state.reserved.content_hash,id);assert.deepEqual(got.draft_photos,[photo,{id:state.reserved.id,path:state.reserved.path}]);assert.equal(state.calls.filter(c=>c.action==='upload').length,1);
  });
  await t.test('fresh selection never implicitly reuses ready assets; only matching pending upload resumes',async()=>{
   for(const phase of ['ready','pending']){const {client,state}=fixture();state.library=[{...photo,content_hash:id,state:phase,slot:1}];const got=await addWorkplacePhoto(client,record(),raw);assert.deepEqual(got.draft_photos,[{id:state.reserved.id,path:state.reserved.path}]);if(phase==='pending')assert.equal(state.reserved.id,id);else assert.notEqual(state.reserved.id,id);assert.equal(state.calls.filter(c=>c.action==='upload').length,1);}
  });
  await t.test('reupload after deleted tombstone uses fresh random identity, not content hash',async()=>{
   const first=fixture(),second=fixture();await addWorkplacePhoto(first.client,record(),raw);await addWorkplacePhoto(second.client,record(),raw);assert.equal(first.state.reserved.content_hash,second.state.reserved.content_hash);assert.notEqual(first.state.reserved.id,second.state.reserved.id);assert.notEqual(second.state.reserved.id,id);
  });
  await t.test('lost upload confirms exact bytes by no-store download; lost save is read back',async()=>{
   const {client,state}=fixture();state.uploadMode='lost';state.saveMode='lost';const got=await addWorkplacePhoto(client,record(),raw);assert.deepEqual(got.draft_photos,[{id:state.reserved.id,path:state.reserved.path}]);
   assert.equal(state.calls.filter(c=>c.action==='upload').length,1);assert.equal(state.calls.find(c=>c.action==='download').request.cache,'no-store');assert.deepEqual(state.calls.filter(c=>c.action==='rpc').map(c=>c.name),['read_my_workplace_photos','reserve_workplace_photo','finalize_workplace_photo','save_my_workplace','read_my_workplace']);assert.equal(state.remove.length,0);
  });
  await t.test('unconfirmed upload or conflicted record never deletes the retained private object',async()=>{
   const {client,state}=fixture();state.uploadMode='denied';state.downloadBytes=new Blob(['different']);await assert.rejects(addWorkplacePhoto(client,record(),raw),e=>e.code==='UPLOAD');assert.equal(state.calls.filter(c=>c.action==='rpc'&&c.name==='save_my_workplace').length,0);assert.equal(state.remove.length,0);
   state.calls=[];state.uploadMode='ok';state.saveMode='conflict';await assert.rejects(addWorkplacePhoto(client,record(),raw),e=>e.code==='CONFLICT');assert.equal(state.remove.length,0);
  });
  await t.test('quota refusal happens before upload; finalization refusal cannot attach bytes',async()=>{
   const first=fixture();first.state.reserveMode='quota';await assert.rejects(addWorkplacePhoto(first.client,record(),raw));assert.equal(first.state.calls.some(c=>c.action==='upload'),false);assert.equal(first.state.remove.length,0);
   const second=fixture();second.state.finalizeMode='denied';await assert.rejects(addWorkplacePhoto(second.client,record(),raw));assert.equal(second.state.calls.some(c=>c.name==='save_my_workplace'),false);assert.equal(second.state.remove.length,0);
  });
  await t.test('account switch and encoding failure cannot attach photos',async()=>{
   const {client,state}=fixture();state.uploadMode='switch';await assert.rejects(addWorkplacePhoto(client,record(),raw),e=>e.code==='SESSION');assert.equal(state.calls.filter(c=>c.action==='rpc'&&c.name==='save_my_workplace').length,0);assert.equal(state.remove.length,0);
   const fresh=fixture();globalThis.qaEncodeWorkplace=async()=>{throw Error('cannot encode');};await assert.rejects(addWorkplacePhoto(fresh.client,record(),raw),/cannot encode/);assert.equal(fresh.state.calls.length,0);
  });
 }finally{globalThis.qaEncodeWorkplace=prior;await rm(output,{recursive:true,force:true});}
});
