import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {JSDOM,VirtualConsole} from 'jsdom';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {uid} from './fixtures/consignor-client.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),key=`cb_consignorDraft_v2:${uid}`;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+5000;while(!fn()){assert.ok(Date.now()<end,label);await pause(10);}}
const button=(w,label)=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);
test('consignor screen retains drafts until both canonical records are confirmed',async t=>{
  const output=await mkdtemp(path.join(tmpdir(),'cb-consignor-ui-'));let dom;
  try{
    await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'consignor-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/consignor-ui-client.js');}},react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/consignor-ui-entry.jsx'),name:'ConsignorQA',formats:['iife'],fileName:'fixture'},minify:false}});
    const script=await readFile(path.join(output,'fixture.iife.js'),'utf8');
    async function mount(options={},storage={}){
      dom?.window.close();const vc=new VirtualConsole(),errors=[];vc.on('jsdomError',e=>{if(!/navigation/.test(e.message))errors.push(e.message);});
      dom=new JSDOM('<div id="root"></div>',{url:'https://ui.test/#/admin/consignment/profile',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});
      const w=dom.window;Object.assign(w,{TextEncoder,TextDecoder,Response,Request,Headers,qaOptions:options,qaAlerts:[],qaErrors:errors});
      w.alert=m=>w.qaAlerts.push(m);w.confirm=()=>true;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.fetch=()=>{throw Error('Unexpected network');};
      for(const [k,v] of Object.entries(storage))w.localStorage.setItem(k,v);
      w.eval(script);await until(()=>w.document.querySelector('[role="alert"]')||button(w,'内容を編集')||button(w,'保存する'),'screen ready');return w;
    }
    const snapshot=w=>Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]));
    async function edit(w){
      button(w,'内容を編集').click();await until(()=>w.document.querySelector('input[placeholder="例：090-1234-5678"]'),'phone input');
      const input=w.document.querySelector('input[placeholder="例：090-1234-5678"]');
      Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(input,'08000000000');input.dispatchEvent(new w.Event('input',{bubbles:true}));
      await until(()=>JSON.parse(w.localStorage.getItem(key)||'{}').d?.ind_phone==='08000000000','phone draft');
      button(w,'次へ →').click();await until(()=>button(w,'この情報を委託者情報として使用します'),'confirmation');
      button(w,'この情報を委託者情報として使用します').click();await pause(10);
    }
    async function save(w){button(w,'保存する').click();await pause(20);await until(()=>!w.document.querySelector('fieldset[disabled]'),'save settled');}
    await t.test('read failure blocks all editing and retry restores existing values',async()=>{
      const w=await mount({readError:true});assert.equal(button(w,'保存する'),undefined);assert.equal(w.qaConsignor.state.writes,0);
      w.qaOptions.readError=false;button(w,'もう一度読み込む').click();await until(()=>button(w,'内容を編集'),'retry');assert.match(w.document.body.textContent,/試験用の氏名/);
    });
    for(const mode of ['phoneError','profileError','lostResponse','normal'])await t.test(mode,async()=>{
      const w=await mount({[mode]:true});await edit(w);await save(w);
      if(mode.endsWith('Error')){assert.ok(w.qaAlerts.length);assert.ok(w.localStorage.getItem(key));assert.equal(w.qaConsignor.state.rows.account_holders.contact_phone,null);assert.doesNotMatch(w.document.body.textContent,/保存しました/);}
      else{assert.equal(w.qaAlerts.length,0);assert.equal(w.localStorage.getItem(key),null);assert.equal(w.qaConsignor.state.rows.account_holders.contact_phone,'08000000000');assert.match(w.document.body.textContent,/保存しました/);}
      assert.equal(w.qaConsignor.state.events.filter(e=>e.rpc==='save_my_consignor_profile').length,1);assert.deepEqual(w.qaErrors,[]);
    });
    await t.test('double click is one write and the whole form is disabled in flight',async()=>{
      const w=await mount();await edit(w);let release;w.qaOptions.beforeAtomicWrite=()=>new Promise(r=>{release=r;});
      const b=button(w,'保存する');b.click();b.click();await until(()=>release,'request started');assert.ok(w.document.querySelector('fieldset[disabled]'));
      assert.equal(w.qaConsignor.state.writes,1);release();await until(()=>!w.document.querySelector('fieldset[disabled]'),'released');
    });
    await t.test('a stale recovered draft keeps its old comparison baseline',async()=>{
      let w=await mount();await edit(w);const stored=snapshot(w);
      const remote={cmn_bank:'元の銀行',cmn_lend_items:['他の画面の道具']};
      w=await mount({remoteData:remote},stored);await until(()=>button(w,'保存する'),'restored confirm');
      assert.match(w.document.body.textContent,/下書きの作成後に保存済みの情報が変更/);
      button(w,'この情報を委託者情報として使用します').click();await pause(10);await save(w);
      assert.ok(w.qaAlerts.some(x=>/別の画面/.test(x)));assert.deepEqual(JSON.parse(JSON.stringify(w.qaConsignor.state.rows.consignment_profiles.consignor_data)),remote);
      assert.ok(w.localStorage.getItem(key));
    });
    await t.test('drafts for another account and unscoped legacy drafts are not applied or deleted',async()=>{
      const legacy=JSON.stringify({t:'individual',s:2,d:{cmn_bank:'別の人の銀行'}});
      const otherKey='cb_consignorDraft_v2:other';const w=await mount({}, {'cb_consignorDraft_v1':legacy,[otherKey]:legacy});
      assert.doesNotMatch(w.document.body.textContent,/別の人の銀行/);assert.equal(w.localStorage.getItem('cb_consignorDraft_v1'),legacy);assert.equal(w.localStorage.getItem(otherKey),legacy);
    });
  }finally{dom?.window.close();await rm(output,{recursive:true,force:true});}
});
