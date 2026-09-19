import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
const require = createRequire(import.meta.url);
const {JSDOM,VirtualConsole} = require(process.env.CB_TEST_NODE_MODULES ? `${process.env.CB_TEST_NODE_MODULES}/jsdom` : 'jsdom');
const root = fileURLToPath(new URL('../',import.meta.url));
const owner = '00000000-0000-4000-8000-000000000001';
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));

test('actual consent and listing components continue offline, restore new/edit/copy input, and sync on reconnect', async () => {
  const output = await mkdtemp(path.join(tmpdir(),'cb-offline-ui-'));
  let dom;
  const errors = [];
  try {
    await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
      name:'offline-fixture',enforce:'pre',resolveId(id) {
        if (/(?:^|\/)supabase(?:\.js)?$/.test(id) || /(?:jobCreateGeo|lib\/zipLookup)(?:\.js)?$/.test(id)) return path.join(root,'scripts/fixtures/offline/client.js');
      },
    },react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/offline/entry.jsx'),name:'OfflineQA',formats:['iife'],fileName:'fixture'},minify:false}});
    const script = await readFile(path.join(output,'fixture.iife.js'),'utf8');
    async function mount({url='https://ui.test/?case=new#/work/new/8',storage={},offline=true,job=null}={}) {
      dom?.window.close();
      const console = new VirtualConsole();
      console.on('jsdomError',e=>{if(!/CSS|navigation/.test(e.message)) errors.push(e.message);});
      console.on('error',(...args)=>errors.push(args.join(' ')));
      dom = new JSDOM('<div id="root"></div>',{url,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console});
      const w = dom.window;
      Object.assign(w,{Response,Request,Headers,AbortController,AbortSignal,TextEncoder,TextDecoder,qaOffline:offline,qaConsent:true,qaJob:job});
      w.scrollTo=()=>{};w.HTMLElement.prototype.scrollTo=()=>{};w.HTMLElement.prototype.scrollBy=()=>{};
      w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
      w.fetch=()=>Promise.reject(new Error('Unexpected network'));
      w.alert=message=>errors.push(message);w.confirm=()=>true;
      for(const [k,v] of Object.entries(storage)) w.localStorage.setItem(k,v);
      w.eval(script); await pause(100);
      return w;
    }
    const button = (w,label) => {const found=[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);assert.ok(found,label);return found;};
    const snapshot = w => Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]));
    const change = async (w,value) => {
      const area=w.document.querySelector('textarea[aria-label="作業の説明"]');assert.ok(area,'description input');
      Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype,'value').set.call(area,value);
      area.dispatchEvent(new w.Event('input',{bubbles:true})); await pause(30);
    };
    let w=await mount();
    await change(w,'通信が切れても残す入力');
    let d=w.qaDrafts.listDeviceDrafts(owner)[0];
    assert.equal(d.form.jobDescription,'通信が切れても残す入力');
    button(w,'保存して終了').click();await pause(30);
    assert.match(w.document.body.textContent,/保存して終了しました/);
    assert.match(w.document.body.textContent,/この端末に保存済み・同期待ち/);
    assert.equal(w.qaDrafts.listDeviceDrafts(owner)[0].state,'pending');
    const persisted=snapshot(w);
    w=await mount({url:`https://ui.test/#/work/local/${d.id}`,storage:persisted});
    assert.equal(w.document.querySelector('textarea').value,'通信が切れても残す入力');
    await change(w,'再開後の新しい入力');
    assert.equal(w.qaDrafts.readDeviceDraft(owner,d.id).form.jobDescription,'再開後の新しい入力');
    w.qaOffline=false;w.dispatchEvent(new w.Event('online'));await pause(700);
    d=w.qaDrafts.readDeviceDraft(owner,d.id);
    assert.equal(d.form.jobDescription,'再開後の新しい入力');
    assert.equal(d.jobNumber,42);
    assert.equal(d.state,'local'); // 新しい入力は勝手に送らず、古い保存の完了で消さない。
    button(w,'保存して終了').click();await pause(700);
    assert.equal(w.qaJob.notes,'再開後の新しい入力');
    // 編集/コピーのサーバー行から始めた入力も、同じアカウントの端末下書きへ復元する。
    const job={...w.qaJob,draft_step:8,notes:'DBから開いたコピー'};
    w=await mount({url:'https://ui.test/#/work/edit/42',offline:false,job});
    await change(w,'編集コピー中の未送信入力');
    const editPersisted=snapshot(w);
    w=await mount({url:'https://ui.test/#/work/edit/42',storage:editPersisted,offline:true});
    assert.equal(w.document.querySelector('textarea').value,'編集コピー中の未送信入力');
    // 同意は通信応答を待たず作業できる画面へ。復旧して初めて確認済みに進む。
    w=await mount({url:'https://ui.test/?case=consent',offline:true});
    button(w,'同意して続ける').click();await pause(30);
    assert.match(w.document.body.textContent,/同意をこの端末に記録しました/);
    assert.ok(button(w,'求人の下書きを作る'));
    w.qaOffline=false;w.dispatchEvent(new w.Event('online'));await pause(700);
    assert.match(w.document.body.textContent,/同意確認済み/);
    // 掲載前の下書き同期が従来の掲載導線を壊さず、サーバー確認後にだけ完了する。
    w=await mount({url:'https://ui.test/?case=new#/work/new/11',offline:false});
    button(w,'掲載する').click();await pause(30);
    const check=w.document.querySelector('input[type="checkbox"]');assert.ok(check,'publication confirmation');
    check.click();await pause(30);button(w,'同意して掲載する').click();await pause(500);
    assert.match(w.document.body.textContent,/掲載完了/);
    assert.equal(w.qaJob.status,'open');
    assert.equal(w.qaDrafts.listDeviceDrafts(owner).length,0);
    assert.equal(w.qaCalls.filter(r=>r.path==='rpc/publish_my_job').length,1);
    assert.deepEqual(errors,[]);
  } finally {dom?.window.close();await rm(output,{recursive:true,force:true});}
});
