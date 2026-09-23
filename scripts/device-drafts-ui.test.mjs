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
async function until(predicate, label, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `timed out: ${label}`);
    await pause(10);
  }
}

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
    async function mount({url='https://ui.test/?case=new#/work/new/8',storage={},session={},offline=true,job=null}={}) {
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
      for(const [k,v] of Object.entries(session)) w.sessionStorage.setItem(k,v);
      w.eval(script); await until(() => w.document.querySelector('textarea[aria-label="作業の説明"], input[aria-label="日給"]') || [...w.document.querySelectorAll('button')].some(b => ['同意して続ける','掲載する'].includes(b.textContent.trim())), 'initial screen');
      return w;
    }
    const button = (w,label) => {const found=[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);assert.ok(found,label);return found;};
    const snapshot = w => Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]));
    const change = async (w,value) => {
      const area=w.document.querySelector('textarea[aria-label="作業の説明"]');assert.ok(area,'description input');
      Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype,'value').set.call(area,value);
      area.dispatchEvent(new w.Event('input',{bubbles:true}));
      await until(() => w.qaDrafts.listDeviceDrafts(owner).some(d => d.form?.jobDescription === value), 'input persisted before the old 800 ms delay', 600);
    };
    let w=await mount();
    await change(w,'通信が切れても残す入力');
    let d=w.qaDrafts.listDeviceDrafts(owner)[0];
    assert.equal(d.form.jobDescription,'通信が切れても残す入力');
    button(w,'保存して終了').click();await until(() => /保存して終了しました/.test(w.document.body.textContent), 'local save exit');
    assert.match(w.document.body.textContent,/保存して終了しました/);
    assert.match(w.document.body.textContent,/この端末に保存済み・同期待ち/);
    assert.equal(w.qaDrafts.listDeviceDrafts(owner)[0].state,'pending');
    const persisted=snapshot(w);
    w=await mount({url:`https://ui.test/#/work/local/${d.id}`,storage:persisted});
    assert.equal(w.document.querySelector('textarea').value,'通信が切れても残す入力');
    await change(w,'再開後の新しい入力');
    assert.equal(w.qaDrafts.readDeviceDraft(owner,d.id).form.jobDescription,'再開後の新しい入力');
    w.qaOffline=false;w.dispatchEvent(new w.Event('online'));
    await until(() => w.qaDrafts.readDeviceDraft(owner,d.id)?.jobNumber === 42, 'queued draft acknowledged');
    d=w.qaDrafts.readDeviceDraft(owner,d.id);
    assert.equal(d.form.jobDescription,'再開後の新しい入力');
    assert.equal(d.jobNumber,42);
    assert.equal(d.state,'local'); // 新しい入力は勝手に送らず、古い保存の完了で消さない。
    button(w,'保存して終了').click();await until(() => w.qaJob?.notes === '再開後の新しい入力', 'newer save acknowledged');
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
    button(w,'同意して続ける').click();await until(() => /同意をこの端末に記録しました/.test(w.document.body.textContent), 'pending consent workspace');
    assert.match(w.document.body.textContent,/同意をこの端末に記録しました/);
    assert.ok(button(w,'求人の下書きを作る'));
    w.qaOffline=false;w.dispatchEvent(new w.Event('online'));await until(() => /同意確認済み/.test(w.document.body.textContent), 'consent confirmed');
    assert.match(w.document.body.textContent,/同意確認済み/);
    // 最低賃金の取得に失敗しても次の入力へ進める。掲載前には再確認が必要。
    w=await mount({url:'https://ui.test/?case=new#/work/new/5',offline:true});
    await until(() => /最低賃金を確認できませんでした/.test(w.document.body.textContent), 'wage lookup failure');
    assert.equal(button(w,'次へ').disabled,false);
    button(w,'次へ').click();
    await until(() => w.document.querySelector('[data-step="6"]'), 'continue drafting without wage lookup');
    w=await mount({url:'https://ui.test/#/work/new/11',storage:snapshot(w),offline:true});
    await until(() => /最低賃金を確認できませんでした/.test(w.document.body.textContent), 'offline draft review');
    assert.equal(button(w,'掲載する').disabled,true);
    assert.equal(w.qaCalls.filter(r=>r.path==='rpc/publish_my_job').length,0);
    w.qaOffline=false;w.dispatchEvent(new w.Event('online'));
    // 掲載前の下書き同期が従来の掲載導線を壊さず、サーバー確認後にだけ完了する。
    await until(() => !button(w,'掲載する').disabled, 'publish ready');
    button(w,'掲載する').click();await until(() => w.document.querySelector('input[type="checkbox"]'), 'publish confirmation');
    const check=w.document.querySelector('input[type="checkbox"]');assert.ok(check,'publication confirmation');
    check.click();await until(() => !button(w,'同意して掲載する').disabled, 'publish enabled');
    button(w,'同意して掲載する').click();await until(() => /掲載完了/.test(w.document.body.textContent), 'publication confirmed');
    assert.match(w.document.body.textContent,/掲載完了/);
    assert.equal(w.qaJob.status,'open');
    assert.equal(w.qaDrafts.listDeviceDrafts(owner).length,0);
    assert.equal(w.qaCalls.filter(r=>r.path==='rpc/publish_my_job').length,1);
    // ── 2026-09-23 根治の回帰：カレンダーの「この日にコピー」→ 掲載。離した日は画面にだけ入り、
    //    端末の比較元(base)はDBの行のまま＝同期が conflict で詰まらない（DRAFT_REQUIRES_REVIEW が出ない）
    const publish = async () => {
      await until(() => !button(w,'掲載する').disabled, 'publish ready');
      button(w,'掲載する').click();await until(() => w.document.querySelector('input[type="checkbox"]'), 'publish confirmation');
      w.document.querySelector('input[type="checkbox"]').click();await until(() => !button(w,'同意して掲載する').disabled, 'publish enabled');
      button(w,'同意して掲載する').click();await until(() => /掲載完了/.test(w.document.body.textContent), 'publication confirmed');
    };
    const copied={...w.qaJob,status:'draft',draft_step:11,date_start:null,date_end:null,date_label:null,holidays:[]};
    w=await mount({url:'https://ui.test/#/work/edit/42',offline:false,job:copied,
      session:{cb_editJobPrefill:JSON.stringify(copied),cb_editJobPresetDates:JSON.stringify({job_number:42,date_start:'2026-12-01',date_end:null,holidays:[]})}});
    await until(() => /12\/1/.test(w.document.body.textContent), 'preset date shown from the calendar copy');
    await publish();
    assert.equal(w.qaJob.status,'open');
    assert.equal(w.qaJob.date_start,'2026-12-01'); // 離した日は保存で入る
    assert.equal(w.qaSyncExpected.date_start,null); // 比較元はDBの行のまま（ここが旧バグ）
    assert.equal(w.qaDrafts.listDeviceDrafts(owner).length,0);
    // ── 衝突が一度返っても、比較元を取り直して いまの内容 で送り直し、掲載が完了する（利用者に生の符号を見せない）
    w=await mount({url:'https://ui.test/?case=new#/work/new/11',offline:false});
    w.qaConflictOnce=true;
    await publish();
    assert.equal(w.qaJob.status,'open');
    assert.equal(w.qaJob.notes,'最初の入力'); // 画面の内容が勝つ（別タブの保存 で上書きされない）
    assert.equal(w.qaSyncExpected.notes,'別のタブの保存'); // 取り直した比較元で送っている
    assert.equal(w.qaCalls.filter(r=>r.path==='rpc/sync_my_job_draft').length,2);
    assert.equal(w.qaDrafts.listDeviceDrafts(owner).length,0);
    assert.ok(!/DRAFT_REQUIRES_REVIEW|管理者デバッグ/.test(w.document.body.textContent));
    assert.deepEqual(errors,[]);
  } catch (error) {
    console.error(`Browser errors: ${JSON.stringify(errors)}\nScreen: ${dom?.window.document.body.textContent}\nRequests: ${JSON.stringify(dom?.window.qaCalls?.map(r=>r.path))}`);
    throw error;
  } finally {dom?.window.close();await rm(output,{recursive:true,force:true});}
});
