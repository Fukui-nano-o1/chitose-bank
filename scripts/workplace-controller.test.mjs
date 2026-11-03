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
const button=(w,text)=>[...w.document.querySelectorAll('button')].find(b=>b.textContent===text);
async function until(fn,label){const end=Date.now()+5000;while(!fn()){assert.ok(Date.now()<end,label);await pause(10);}}
test('real workplace controller confirms draft, publish and unpublish while preserving uncertain objects',async()=>{
 const output=await mkdtemp(path.join(tmpdir(),'cb-workplace-controller-'));let dom;
 try{
  await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'controller-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)lib\/supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/listing-photo-client.js');}},react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/workplace-controller-entry.jsx'),name:'ControllerQA',formats:['iife'],fileName:'fixture'},minify:false}});
  const script=await readFile(path.join(output,'fixture.iife.js'),'utf8');const errors=[];
  const owner='11111111-1111-4111-8111-111111111111',photo=hex=>({id:hex.repeat(64),path:`${owner}/${hex.repeat(64)}.jpg`});
  function mount(mode='ready'){
   dom?.window.close();const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));dom=new JSDOM('<div id="root"></div>',{url:'https://ui.test',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});const w=dom.window;
   const state={user:owner,mode,calls:[],removes:[],library:['a','b','c'].map((hex,index)=>({...photo(hex),content_hash:hex.repeat(64),state:'ready',slot:index+1})),row:{owner_id:owner,revision:1,draft_photos:[photo('a'),photo('b')],published_photos:[photo('a')],publication_active:true}},subscriptions=new Set();
   w.qaState=state;w.qaMe={id:owner};w.fetch=()=>{throw Error('Unexpected real network');};w.URL.createObjectURL=()=> 'blob:https://ui.test/photo';w.URL.revokeObjectURL=()=>{};
   w.qaChangeUser=id=>{state.user=id;for(const callback of subscriptions)callback('AUTH_CHANGED',id?{user:{id}}:null);};
   w.qaPhotoClient={auth:{getSession:async()=>({data:{session:state.user?{user:{id:state.user}}:null}}),onAuthStateChange:callback=>{subscriptions.add(callback);return {data:{subscription:{unsubscribe:()=>subscriptions.delete(callback)}}};}},storage:{from:()=>({download:async()=>({error:Error('synthetic bytes omitted')}),remove:async paths=>{state.removes.push([...paths]);return {};}})},rpc:async(name,args)=>{
    state.calls.push(name);if(name==='read_my_workplace_photos')return state.mode==='unconfigured'?{error:{code:'PGRST202'}}:{data:{ok:true,photos:structuredClone(state.library),limit:24}};
    if(name==='read_my_workplace')return state.mode==='unconfigured'?{error:{code:'PGRST202'}}:{data:{ok:true,row:structuredClone(state.row)}};
    if(name==='prepare_delete_workplace_photo'){const found=state.library.find(p=>p.id===args.p_id);found.state='deleting';return {data:{ok:true,photo:structuredClone(found)}};}
    if(name==='finalize_delete_workplace_photo'){const found=state.library.find(p=>p.id===args.p_id);state.library=state.library.filter(p=>p.id!==args.p_id);return {data:{ok:true,photo:{...found,state:'deleted'}}};}
    if(state.mode==='conflict'){state.row={...state.row,revision:state.row.revision+1};return {data:{ok:false,reason:'conflict'}};}
    if(name==='save_my_workplace')state.row={...state.row,draft_photos:args.p_photos};
    if(name==='publish_my_workplace')state.row={...state.row,published_photos:state.row.draft_photos,publication_active:true};
    if(name==='unpublish_my_workplace')state.row={...state.row,published_photos:[],publication_active:false};
    state.row={...state.row,revision:state.row.revision+1};return {data:{ok:true,row:structuredClone(state.row)}};
   }};w.eval(script);return w;
  }
  let w=mount();await until(()=>button(w,'下書きから写真1を外す')&&!button(w,'下書きから写真1を外す').disabled,'controller loads draft');
  button(w,'下書きから写真1を外す').click();await until(()=>w.qaState.row.draft_photos.length===1,'draft removal saved');await until(()=>w.document.body.textContent.includes('公開中の写真は変わりません'),'save confirmed UI');
  assert.equal(w.qaState.row.published_photos[0].id,photo('a').id);assert.equal(w.qaState.removes.length,0,'published old photo retained despite draft removal');
  [...w.document.querySelectorAll('input[type="checkbox"]')].forEach(x=>x.click());await until(()=>!button(w,'この内容で公開する').disabled,'consents checked');button(w,'この内容で公開する').click();
  await until(()=>w.qaState.row.published_photos[0]?.id===photo('b').id,'published references replaced');await until(()=>w.document.body.textContent.includes('職場紹介の写真を公開しました'),'publication confirmed');assert.equal(w.qaState.removes.length,0,'old unreferenced private object retained');
  await until(()=>!button(w,'公開を取り下げる').disabled,'publish settles');button(w,'公開を取り下げる').click();await until(()=>w.qaState.row.publication_active===false,'unpublish persisted');assert.equal(w.qaState.row.draft_photos.length,1);assert.equal(w.qaState.row.published_photos.length,0);assert.equal(w.qaState.removes.length,0,'unpublish never deletes stored bytes');
  await until(()=>button(w,'保存済み写真3を下書きに追加')&&!button(w,'保存済み写真3を下書きに追加').disabled,'saved library ready');button(w,'保存済み写真3を下書きに追加').click();await until(()=>w.qaState.row.draft_photos.some(p=>p.id===photo('c').id),'reuse persisted');await until(()=>w.document.body.textContent.includes('保存済み写真を下書きに追加しました'),'reuse confirmed');assert.equal(w.qaState.removes.length,0);
  button(w,'保存済み写真1を削除').click();await until(()=>button(w,'完全に削除する'),'irreversible confirmation appears');assert.equal(w.qaState.removes.length,0,'opening confirmation never deletes');button(w,'完全に削除する').click();await until(()=>w.qaState.library.length===2,'explicit unused delete complete');await until(()=>w.document.body.textContent.includes('保存済み写真の削除を完了しました'),'library refreshed');assert.deepEqual(w.qaState.removes,[[photo('a').path]]);
  w.qaChangeUser(null);await until(()=>w.document.body.textContent.includes('アカウントが変わりました'),'logout disables controller');assert.equal(w.document.querySelector('input[type="file"]').disabled,true);
  w=mount('conflict');await until(()=>button(w,'下書きから写真1を外す')&&!button(w,'下書きから写真1を外す').disabled,'conflict initial load');button(w,'下書きから写真1を外す').click();await until(()=>w.document.body.textContent.includes('別の画面'),'conflict visible');assert.equal(w.qaState.removes.length,0);assert.equal(w.document.querySelector('input[type="file"]').disabled,true);
  w=mount('unconfigured');await until(()=>w.document.body.textContent.includes('保存先はまだ準備中'),'capability absence');assert.equal(w.document.querySelector('input[type="file"]').disabled,true);assert.deepEqual([...w.qaState.calls].sort(),['read_my_workplace','read_my_workplace_photos'].sort());
  assert.deepEqual(errors,[]);
 }finally{dom?.window.close();await rm(output,{recursive:true,force:true});}
});
