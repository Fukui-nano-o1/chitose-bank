import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {JSDOM,VirtualConsole} from 'jsdom';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {uid,dealId} from './fixtures/consignment-deal-client.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),key=`cb_consignmentSave_v1:${uid}:${dealId}`;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+5000;while(!fn()){assert.ok(Date.now()<end,label);await pause(10);}}
const button=(w,label)=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);
test('actual consignment screen confirms the complete save and retains unknown operations',async t=>{
  const output=await mkdtemp(path.join(tmpdir(),'cb-consignment-ui-'));let dom;
  try{
    await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'consignment-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/consignment-deal-ui-client.js');}},react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/consignment-deal-ui-entry.jsx'),name:'ConsignmentQA',formats:['iife'],fileName:'fixture'},minify:false}});
    const script=await readFile(path.join(output,'fixture.iife.js'),'utf8');
    async function mount(options={},storage={}){
      dom?.window.close();const vc=new VirtualConsole(),errors=[];vc.on('jsdomError',e=>{if(!/navigation/.test(e.message))errors.push(e.message);});
      dom=new JSDOM('<div id="root"></div>',{url:'https://ui.test/#/admin/consignment/deal/'+dealId,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});
      const w=dom.window;Object.assign(w,{TextEncoder,TextDecoder,Response,Request,Headers,qaOptions:options,qaAlerts:[],qaErrors:errors});
      w.alert=m=>w.qaAlerts.push(m);w.confirm=()=>true;w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
      w.scrollTo=()=>{};w.HTMLElement.prototype.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.fetch=async()=>({json:async()=>({})});
      w.sessionStorage.setItem('cb_consignPhotoHeal_v1','1');for(const [k,v] of Object.entries(storage))w.localStorage.setItem(k,v);
      w.eval(script);await until(()=>button(w,'更新を保存'),'screen ready');await pause(30);return w;
    }
    const snapshot=w=>Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]));
    async function save(w){button(w,'更新を保存').click();await pause(20);await until(()=>!w.document.querySelector('fieldset[disabled]'),'save settled');}
    for(const mode of ['normal','rejected','conflict','lostResponse'])await t.test(mode,async()=>{
      const w=await mount({[mode]:true});await save(w);
      if(mode==='normal'){assert.equal(w.qaAlerts.length,0);assert.equal(w.localStorage.getItem(key),null);assert.equal(w.qaConsignment.state.writes,1);}
      else{assert.ok(w.qaAlerts.length);assert.equal(w.location.hash,'#/admin/consignment/deal/'+dealId);assert.match(w.document.body.textContent,/試験圃場/);assert.equal(!!w.localStorage.getItem(key),mode==='lostResponse');}
      assert.equal(w.qaConsignment.state.events.length,1);assert.deepEqual(w.qaErrors,[]);
    });
    await t.test('double click sends once and blocks edits while the request is in flight',async()=>{
      const w=await mount();let release;w.qaOptions.beforeWrite=()=>new Promise(r=>{release=r;});
      const b=button(w,'更新を保存');b.click();b.click();await until(()=>release,'request started');assert.ok(w.document.querySelector('fieldset[disabled]'));assert.equal(w.qaConsignment.state.events.length,1);
      release();await until(()=>!w.document.querySelector('fieldset[disabled]'),'request finished');
    });
    await t.test('reload restores unknown payload and original baseline for the same operation',async()=>{
      let w=await mount({lostResponse:true});await save(w);const stored=snapshot(w),pending=JSON.parse(stored[key]);
      w=await mount({},stored);assert.match(w.document.body.textContent,/前回の保存結果が未確認/);await save(w);
      const sent=w.qaConsignment.state.events[0];assert.equal(sent.p_request_id,pending.p_request_id);assert.equal(sent.p_expected.updated_at,pending.p_expected.updated_at);assert.equal(w.localStorage.getItem(key),null);
    });
  }finally{dom?.window.close();await rm(output,{recursive:true,force:true});}
});
