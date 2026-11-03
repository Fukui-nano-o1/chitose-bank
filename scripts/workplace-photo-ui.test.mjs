import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {JSDOM,VirtualConsole} from 'jsdom';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
const root=fileURLToPath(new URL('../',import.meta.url));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){const end=Date.now()+5000;while(!fn()){assert.ok(Date.now()<end,'independent photo UI settled');await pause(10);}}
test('WorkplacePhoto renders only dedicated authorized blobs and clears denied or stale images',async()=>{
 const output=await mkdtemp(path.join(tmpdir(),'cb-workplace-photo-'));let dom;
 try{
  await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'workplace-photo-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)lib\/supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/listing-photo-client.js');}},react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/workplace-photo-entry.jsx'),name:'IndependentPhotoQA',formats:['iife'],fileName:'fixture'},minify:false}});
  const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
  dom=new JSDOM('<div id="root"></div>',{url:'https://workplace.test',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});const w=dom.window;
  const owner='11111111-1111-4111-8111-111111111111',makePath=hex=>`${owner}/${hex.repeat(64)}.jpg`;
  let user=null,authCallback,release;const requests=[],revoked=[];
  w.qaPhotoPath=makePath('a');w.URL.createObjectURL=()=>`blob:https://workplace.test/${requests.length}`;w.URL.revokeObjectURL=url=>revoked.push(url);
  w.fetch=()=>{throw Error('Unexpected real network');};
  w.qaPhotoClient={auth:{getSession:async()=>({data:{session:user?{user:{id:user}}:null}}),onAuthStateChange:fn=>{authCallback=fn;}},storage:{from:bucket=>({download:async(key,options,parameters)=>{
   requests.push({bucket,key,parameters});
   if(key===makePath('c'))await new Promise(resolve=>{release=resolve;});
   return key===makePath('b')||(key===makePath('d')&&!user)?{error:Error('403')}:{data:new w.Blob(['synthetic'])};
  }})}};
  w.eval(await readFile(path.join(output,'fixture.iife.js'),'utf8'));
  await until(()=>w.document.querySelector('[data-workplace-photo="ready"]'));
  assert.equal(w.document.querySelector('img').getAttribute('src'),'blob:https://workplace.test/1');
  assert.ok(requests.every(r=>r.bucket==='workplace-photos'&&r.parameters.cache==='no-store'));
  w.qaWorkplacePhoto(makePath('b'));await until(()=>w.document.querySelector('[data-workplace-photo="unavailable"]'));
  assert.equal(w.document.querySelector('img').getAttribute('src'),null);
  const before=requests.length;
  for(const invalid of ['https://example.test/photo.jpg','/local.jpg',`job-photos/${makePath('a')}`]){
   w.qaWorkplacePhoto(invalid);await pause(10);assert.equal(w.document.querySelector('img').getAttribute('src'),null);
  }
  assert.equal(requests.length,before,'invalid inputs never fetch');
  user=owner;authCallback('SIGNED_IN',{user:{id:user}});w.qaWorkplacePhoto(makePath('d'));await until(()=>w.document.querySelector('[data-workplace-photo="ready"]'));
  user=null;authCallback('SIGNED_OUT',null);await until(()=>w.document.querySelector('[data-workplace-photo="unavailable"]'));assert.equal(w.document.querySelector('img').getAttribute('src'),null);assert.ok(revoked.length);
  w.qaWorkplacePhoto(makePath('c'));await until(()=>typeof release==='function');w.qaWorkplacePhoto(null);release();await pause(30);assert.equal(w.document.querySelector('img'),null);
  assert.deepEqual(errors,[]);
 }finally{dom?.window.close();await rm(output,{recursive:true,force:true});}
});
