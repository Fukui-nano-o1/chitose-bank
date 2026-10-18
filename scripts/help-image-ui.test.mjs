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
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+5000;while(!fn()){assert.ok(Date.now()<end,label);await pause(10);}}
const button=(w,label)=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);
test('actual help and installation screens preserve old images until a confirmed reference change',async t=>{
  const output=await mkdtemp(path.join(tmpdir(),'cb-help-image-ui-'));let dom;
  try{
    await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'help-image-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/help-image-ui-client.js');},load(id){if(id.endsWith('/src/lib/image.js'))return 'export async function compressImage(){return new Blob(["compressed"],{type:"image/jpeg"});}';}},react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/help-image-ui-entry.jsx'),name:'HelpImageQA',formats:['iife'],fileName:'fixture'},minify:false}});
    const script=await readFile(path.join(output,'fixture.iife.js'),'utf8');
    async function mount(role,options={}){
      dom?.window.close();const vc=new VirtualConsole(),errors=[];vc.on('jsdomError',e=>{if(!/navigation/.test(e.message))errors.push(e.message);});
      dom=new JSDOM('<div id="root"></div>',{url:'https://ui.test/#/'+(role==='install'?'install':'help/about'),runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});
      const w=dom.window;Object.assign(w,{TextEncoder,TextDecoder,Response,Request,Headers,Blob,File,qaRole:role,qaOptions:options,qaAlerts:[],qaErrors:errors});
      w.alert=m=>w.qaAlerts.push(m);w.confirm=()=>true;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
      w.fetch=async()=>({ok:true,blob:async()=>new Blob(['large original image'],{type:'image/png'})});
      w.eval(script);await until(()=>w.document.querySelector('[role="alert"]')||w.document.querySelector('img'),'screen ready');return w;
    }
    async function choose(w,twice=false){
      const input=[...w.document.querySelectorAll('input[type="file"]')].find(e=>e.closest('div').querySelector('img'));
      assert.ok(input);Object.defineProperty(input,'files',{configurable:true,value:[new File(['input'],'image.png',{type:'image/png'})]});
      input.dispatchEvent(new w.Event('change',{bubbles:true}));if(twice)input.dispatchEvent(new w.Event('change',{bubbles:true}));await pause(20);return input;
    }
    for(const mode of ['normal','uploadError','dbError','uploadLostResponse','dbLostResponse'])await t.test('install '+mode,async()=>{
      const w=await mount('install',{[mode]:true}),input=await choose(w);await until(()=>!input.disabled,'upload settled');
      const f=w.qaHelpImage;assert.ok(f.state.objects.has('old.png'));assert.deepEqual(w.qaErrors,[]);
      if(mode.endsWith('Error')){assert.equal(f.state.rows[f.slot].url,f.oldUrl);assert.ok(w.qaAlerts.length);}
      else{assert.notEqual(f.state.rows[f.slot].url,f.oldUrl);assert.equal(w.qaAlerts.length,0);assert.ok([...w.document.querySelectorAll('img')].some(img=>img.src===f.state.rows[f.slot].url));}
    });
    for(const mode of ['normal','dbError','dbLostResponse'])await t.test('help deletion '+mode,async()=>{
      const w=await mount('help',{[mode]:true});button(w,'🗑 削除').click();await pause(30);const f=w.qaHelpImage;
      assert.ok(f.state.objects.has('old.png'));if(mode==='dbError'){assert.ok(w.document.querySelector('img'));assert.ok(w.qaAlerts.length);}else{assert.equal(w.document.querySelector('img'),null);assert.equal(f.state.rows[f.slot],undefined);}
    });
    await t.test('failed read blocks writes and retry restores the current record',async()=>{
      const w=await mount('install',{readError:true});assert.ok([...w.document.querySelectorAll('input')].every(e=>e.disabled));assert.equal(w.qaHelpImage.state.writes,0);
      w.qaOptions.readError=false;button(w,'もう一度読み込む').click();await until(()=>w.document.querySelector('img'),'loaded');assert.ok([...w.document.querySelectorAll('input')].every(e=>!e.disabled));
    });
    await t.test('double upload cannot overlap',async()=>{
      const w=await mount('install');let release;w.qaOptions.beforeUpload=()=>new Promise(r=>{release=r;});const input=await choose(w,true);
      await until(()=>release,'upload started');assert.equal(w.qaHelpImage.state.events.filter(e=>e.upload).length,1);assert.ok(input.disabled);release();await until(()=>!input.disabled,'done');
    });
    await t.test('bulk conversion DB failure keeps the original image and reports failure count',async()=>{
      const w=await mount('help',{dbError:true});const bulk=[...w.document.querySelectorAll('button')].find(b=>b.textContent.includes('スクショを一括軽量化'));bulk.click();await until(()=>w.qaAlerts.length,'bulk report');
      assert.match(w.qaAlerts[0],/0枚の差し替えを確認/);assert.match(w.qaAlerts[0],/1枚は確認できません/);assert.equal(w.qaHelpImage.state.rows[w.qaHelpImage.slot].url,w.qaHelpImage.oldUrl);assert.ok(w.qaHelpImage.state.objects.has('old.png'));
    });
    await t.test('deletion is disabled while bulk replacement is in flight',async()=>{
      const w=await mount('help');let release;w.qaOptions.beforeRPC=()=>new Promise(r=>{release=r;});
      [...w.document.querySelectorAll('button')].find(b=>b.textContent.includes('スクショを一括軽量化')).click();await until(()=>release,'bulk RPC started');
      const deletion=button(w,'🗑 削除');assert.ok(deletion.disabled);deletion.click();assert.equal(w.qaHelpImage.state.events.filter(e=>e.rpc).length,1);
      release();await until(()=>w.qaAlerts.length,'bulk done');assert.equal(w.qaHelpImage.state.writes,1);
    });
  }finally{dom?.window.close();await rm(output,{recursive:true,force:true});}
});
