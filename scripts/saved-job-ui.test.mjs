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
async function until(fn,label){const end=Date.now()+5000;while(!fn()){assert.ok(Date.now()<end,label);await pause(10);}}
const heart=(w,liked=true)=>w.document.querySelector(`[aria-label="${liked?'いいねを解除':'いいね'}"]`);
const button=(w,label)=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);
test('actual saved, profile and search screens change hearts only after confirmation',async t=>{
 const output=await mkdtemp(path.join(tmpdir(),'cb-saved-job-ui-'));let dom;
 try{
  await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'saved-job-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/saved-job-ui-client.js');}},react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/saved-job-ui-entry.jsx'),name:'SavedJobQA',formats:['iife'],fileName:'fixture'},minify:false}});
  const script=await readFile(path.join(output,'fixture.iife.js'),'utf8');
  async function mount(mode,options={}){dom?.window.close();const vc=new VirtualConsole(),errors=[];vc.on('jsdomError',e=>{if(!/navigation/.test(e.message))errors.push(e.message);});dom=new JSDOM('<div id="root"></div>',{url:'https://ui.test/#/'+(mode==='search'?'search':'saved'),runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});const w=dom.window;Object.assign(w,{Response,Request,Headers,AbortController,AbortSignal,ReadableStream,TextEncoder,TextDecoder,qaMode:mode,qaOptions:options,qaAlerts:[],qaErrors:errors});w.alert=m=>w.qaAlerts.push(m);w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.eval(script);await until(()=>heart(w),'liked card ready');await pause(30);return w;}
  for(const mode of ['status','liked','search']){
   await t.test(mode+' denied delete keeps heart, row and cache',async()=>{const w=await mount(mode,{rejected:true});heart(w).click();await until(()=>w.qaAlerts.length,'failure');assert.ok(heart(w));assert.equal(w.qaSaved.state.saved,true);assert.equal(w.qaGetCache('saved:rows')[0].liked,true);assert.deepEqual(w.qaErrors,[]);});
   await t.test(mode+' lost response confirms removal; double click stays one request',async()=>{const w=await mount(mode,{lostResponse:true});let release;w.qaOptions.beforeWrite=()=>new Promise(r=>{release=r;});const h=heart(w);h.click();h.click();await until(()=>release,'write');assert.ok(heart(w));assert.equal(w.qaSaved.state.mutationCalls,1);release();await until(()=>!heart(w),'confirmed');assert.equal(w.qaSaved.state.saved,false);assert.equal(w.qaAlerts.length,0);if(mode==='status')assert.ok(button(w,'元に戻す'));else assert.ok(heart(w,false));});
  }
  await t.test('search restores a confirmed like without reopening answered onboarding',async()=>{const w=await mount('search',{lostResponse:true});heart(w).click();await until(()=>heart(w,false),'removed');heart(w,false).click();await until(()=>heart(w),'restored');assert.equal(w.qaSaved.state.saved,true);assert.equal(w.qaGetCache('saved:rows')[0].liked,true);assert.equal(button(w,'送信していいねする'),undefined);assert.equal(w.qaAlerts.length,0);assert.deepEqual(w.qaErrors,[]);});
  await t.test('failed undo stays available and duplicate-key undo confirms the existing saved row',async()=>{const w=await mount('status');heart(w).click();await until(()=>button(w,'元に戻す'),'undo');w.qaOptions.rejected=true;button(w,'元に戻す').click();await until(()=>w.qaAlerts.length,'undo rejected');assert.ok(button(w,'元に戻す'));assert.equal(heart(w),null);w.qaOptions.rejected=false;w.qaSaved.state.saved=true;button(w,'元に戻す').click();await until(()=>heart(w),'restored');assert.equal(button(w,'元に戻す'),undefined);assert.equal(w.qaGetCache('saved:rows')[0].liked,true);});
  await t.test('late pre-mutation list response cannot resurrect a confirmed removal',async()=>{let release;const w=await mount('status',{beforeList:()=>new Promise(r=>{release=r;})});await until(()=>release,'list waiting');heart(w).click();await until(()=>button(w,'元に戻す'),'removed');release();await pause(30);assert.equal(heart(w),null);assert.deepEqual(Array.from(w.qaGetCache('saved:rows')),[]);});
 }finally{dom?.window.close();await rm(output,{recursive:true,force:true});}
});
