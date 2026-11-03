import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {JSDOM,VirtualConsole} from 'jsdom';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
const root=fileURLToPath(new URL('../',import.meta.url)),pause=ms=>new Promise(r=>setTimeout(r,ms));
const button=(w,label)=>[...w.document.querySelectorAll('button')].find(b=>b.textContent===label);
async function until(fn){const deadline=Date.now()+5000;while(!fn()){assert.ok(Date.now()<deadline,'editor settles');await pause(10);}}
test('independent editor separates local selection, draft and consent-gated publication',async()=>{
 const output=await mkdtemp(path.join(tmpdir(),'cb-workplace-editor-'));let dom;
 try{
  await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'editor-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)lib\/supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/listing-photo-client.js');}},react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/workplace-editor-entry.jsx'),name:'EditorQA',formats:['iife'],fileName:'fixture'},minify:false}});
  const vc=new VirtualConsole();const errors=[];vc.on('jsdomError',e=>errors.push(e.message));dom=new JSDOM('<div id="root"></div>',{url:'https://ui.test',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});const w=dom.window;
  const calls=[],revoked=[];let release;
  w.URL.createObjectURL=()=> 'blob:https://ui.test/selection';w.URL.revokeObjectURL=url=>revoked.push(url);w.fetch=()=>{throw Error('Unexpected real network');};
  w.qaPhotoClient={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{}},storage:{from:()=>({download:async()=>({error:Error('synthetic unconfigured')})})}};
  const photo=n=>({id:String(n),state:'ready',path:`11111111-1111-4111-8111-111111111111/${String(n).repeat(64)}.jpg`});
  const props={onBack:()=>calls.push(['back']),canEdit:true,status:'ready',draftPhotos:[photo(1)],publishedPhotos:[],onAdd:async file=>calls.push(['add',file.name]),onRemove:async id=>calls.push(['remove',id]),onPublish:async consent=>{calls.push(['publish',JSON.parse(JSON.stringify(consent))]);await new Promise(resolve=>{release=resolve;});},onUnpublish:async()=>calls.push(['unpublish'])};
  w.qaEditorProps=props;w.eval(await readFile(path.join(output,'fixture.iife.js'),'utf8'));
  const pub=()=>button(w,'この内容で公開する');assert.equal(pub().disabled,true);
  const checks=()=>[...w.document.querySelectorAll('input[type="checkbox"]')];checks()[0].click();assert.equal(pub().disabled,true);checks()[1].click();await until(()=>!pub().disabled);
  pub().click();pub().click();await until(()=>typeof release==='function');assert.equal(calls.filter(c=>c[0]==='publish').length,1);assert.deepEqual(calls[0],['publish',{publicWeb:true,people:true}]);assert.equal(pub().disabled,true);release();await until(()=>checks().every(c=>!c.checked));
  checks().forEach(c=>c.click());await until(()=>!pub().disabled);w.qaRenderEditor({...props,draftPhotos:[photo(2)]});await until(()=>checks().every(c=>!c.checked));assert.equal(pub().disabled,true,'new draft resets consent');
  const input=w.document.querySelector('input[type="file"]');Object.defineProperty(input,'files',{configurable:true,value:[new w.File(['synthetic'],'photo.jpg',{type:'image/jpeg'})]});input.dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>w.document.querySelector('[aria-label="選んだ写真の確認"]'));
  assert.equal(calls.filter(c=>c[0]==='add').length,0,'file picker does not upload');button(w,'この写真を下書きに追加').click();await until(()=>calls.some(c=>c[0]==='add'));await until(()=>!w.document.querySelector('[aria-label="選んだ写真の確認"]'));assert.ok(revoked.length);
  w.qaRenderEditor({...props,draftPhotos:Array.from({length:6},(_,i)=>photo(i+1))});assert.equal(w.document.querySelector('input[type="file"]').disabled,true,'six photos maximum');
  // Saved-library reuse must not re-upload, and deletion is an explicit second step.
  const libraryProps={...props,draftPhotos:[photo(1)],publishedPhotos:[photo(2)],savedPhotos:[{...photo(1),size:1024},{...photo(2),size:2048},{...photo(3),size:4096}],onReuse:async id=>calls.push(['reuse',id]),onDeleteSaved:async id=>{calls.push(['delete',id]);await new Promise(resolve=>{release=resolve;});}};
  w.qaRenderEditor(libraryProps);
  assert.equal(button(w,'保存済み写真1を下書きに追加').disabled,true);
  assert.equal(button(w,'保存済み写真1を削除').disabled,true,'draft reference cannot delete');
  assert.equal(button(w,'保存済み写真2を削除').disabled,true,'published reference cannot delete');
  button(w,'保存済み写真2を下書きに追加').click();await until(()=>calls.some(c=>c[0]==='reuse'));assert.equal(calls.filter(c=>c[0]==='add').length,1,'reuse does not upload');
  await until(()=>!button(w,'保存済み写真3を削除').disabled);
  button(w,'保存済み写真3を削除').click();await until(()=>button(w,'完全に削除する'));assert.equal(calls.filter(c=>c[0]==='delete').length,0,'opening confirmation never deletes');
  button(w,'削除をやめる').click();await until(()=>!button(w,'完全に削除する'));
  button(w,'保存済み写真3を削除').click();await until(()=>button(w,'完全に削除する'));
  // A newly appearing reference cancels an already-open deletion confirmation.
  w.qaRenderEditor({...libraryProps,draftPhotos:[photo(1),photo(3)]});await until(()=>!button(w,'完全に削除する'));assert.equal(button(w,'保存済み写真3を削除').disabled,true);
  w.qaRenderEditor(libraryProps);button(w,'保存済み写真3を削除').click();await until(()=>button(w,'完全に削除する'));
  release=null;button(w,'完全に削除する').click();button(w,'完全に削除する').click();await until(()=>typeof release==='function');assert.equal(calls.filter(c=>c[0]==='delete').length,1,'irreversible delete is single flight');release();await until(()=>!button(w,'完全に削除する'));
  w.qaRenderEditor({...libraryProps,libraryLimit:3});assert.equal(w.document.querySelector('input[type="file"]').disabled,false,'owner cap permits same pending file recovery; server enforces new-file quota');assert.equal(button(w,'保存済み写真3を下書きに追加').disabled,false,'full library can still reuse');
  w.qaRenderEditor({...libraryProps,libraryBytesLimit:7168});assert.equal(w.document.querySelector('input[type="file"]').disabled,false,'byte cap does not block pending file recovery');
  w.qaRenderEditor({...libraryProps,savedPhotos:[{...photo(1),state:'ready'},{...photo(2),state:'pending'},{...photo(3),state:'deleting'}]});
  assert.equal(button(w,'保存済み写真2を下書きに追加').disabled,true,'pending upload is not reusable');
  assert.equal(button(w,'保存済み写真3を下書きに追加').disabled,true,'unfinished deletion is not reusable');
  assert.equal(w.document.querySelector('[data-saved-photo-id="2"] img'),null,'unconfirmed upload has no preview');
  assert.equal(w.document.querySelector('[data-saved-photo-id="3"] img'),null,'unfinished deletion has no preview');
  assert.equal(button(w,'保存済み写真3を削除').disabled,false,'unused deleting photo permits explicit recovery');
  w.qaRenderEditor({...libraryProps,savedPhotos:[photo(1),photo(2),photo(3)]});assert.equal(w.document.querySelector('[aria-labelledby="workplace-library-title"]').textContent.includes('MiB'),false,'unknown sizes are not zero-byte claims');
  w.qaRenderEditor({...props,canEdit:false});for(const control of w.document.querySelectorAll('input'))assert.equal(control.disabled,true);assert.equal(pub().disabled,true);
  w.qaRenderEditor({...props,status:'error',error:'synthetic load failure'});assert.ok(w.document.querySelector('[role="alert"]'));assert.equal(pub().disabled,true);assert.equal(w.document.querySelector('input[type="file"]').disabled,true);
  assert.deepEqual(errors,[]);
 }finally{dom?.window.close();await rm(output,{recursive:true,force:true});}
});
