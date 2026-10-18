import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {JOB_DRAFT_FIELDS} from '../src/lib/jobInputFields.js';
import {jobInputSample} from './fixtures/job-input.js';
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

test('actual consent and listing components continue offline, restore new/edit/copy input, and sync on reconnect', async t => {
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
    async function mount({url='https://ui.test/?case=new#/work/new/8',storage={},session={},offline=true,job=null,receipts={}}={}) {
      dom?.window.close();
      const console = new VirtualConsole();
      console.on('jsdomError',e=>{if(!/CSS|navigation/.test(e.message)) errors.push(e.message);});
      console.on('error',(...args)=>errors.push(args.join(' ')));
      dom = new JSDOM('<div id="root"></div>',{url,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console});
      const w = dom.window;
      Object.assign(w,{Response,Request,Headers,AbortController,AbortSignal,TextEncoder,TextDecoder,qaOffline:offline,qaConsent:true,qaJob:job,qaPublicationReceipts:receipts});
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
    // 初期値を注入するだけでは入力時の変換ミスを検知できない。実際のinputイベントを通す。
    const changeWage = async value => {
      const input=w.document.querySelector('input[aria-label="日給"]');
      Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new w.Event('input',{bubbles:true}));
      const expected=value.replace(/[^0-9]/g,'');
      await until(() => w.qaDrafts.listDeviceDrafts(owner).some(d => d.form.dailyWageInput === expected && d.payload.daily_wage === expected), 'typed wage saved without losing digits');
      assert.equal(input.value,expected);
    };
    await changeWage('12000');
    await changeWage('');
    await changeWage('12,000円');
    w=await mount({url:'https://ui.test/#/work/new/5',storage:snapshot(w),offline:true});
    assert.equal(w.document.querySelector('input[aria-label="日給"]').value,'12000');
    button(w,'次へ').click();
    await until(() => w.document.querySelector('[data-step="6"]'), 'continue drafting without wage lookup');
    w=await mount({url:'https://ui.test/#/work/new/12',storage:snapshot(w),offline:true});
    await until(() => /最低賃金を確認できませんでした/.test(w.document.body.textContent), 'offline draft review');
    assert.equal(button(w,'掲載する').disabled,true);
    assert.equal(w.qaCalls.filter(r=>r.path==='rpc/publish_my_job_with_check').length,0);
    w.qaOffline=false;w.dispatchEvent(new w.Event('online'));
    // 掲載前の下書き同期が従来の掲載導線を壊さず、サーバー確認後にだけ完了する。
    await until(() => !button(w,'掲載する').disabled, 'publish ready');
    button(w,'掲載する').click();await until(() => w.document.querySelector('input[type="checkbox"]'), 'publish confirmation');
    const check=w.document.querySelector('input[type="checkbox"]');assert.ok(check,'publication confirmation');
    check.click();await until(() => !button(w,'同意して掲載する').disabled, 'publish enabled');
    button(w,'同意して掲載する').click();await until(() => /掲載完了/.test(w.document.body.textContent), 'publication confirmed');
    assert.match(w.document.body.textContent,/掲載完了/);
    assert.equal(w.qaJob.status,'open');
    assert.equal(w.qaJob.daily_wage,'12000');
    assert.equal(w.qaDrafts.listDeviceDrafts(owner).length,0);
    assert.equal(w.qaCalls.filter(r=>r.path==='rpc/publish_my_job_with_check').length,1);
    assert.equal(w.qaCalls.filter(r=>['rpc/publish_my_job','job_publish_checks'].includes(r.path)).length,0);
    assert.equal(Object.keys(w.qaPublicationReceipts).length,1);
    const startPublish = async () => {
      await until(() => !button(w,'掲載する').disabled, 'publish ready');
      button(w,'掲載する').click();await until(() => w.document.querySelector('input[type="checkbox"]'), 'publish confirmation');
      w.document.querySelector('input[type="checkbox"]').click();await until(() => !button(w,'同意して掲載する').disabled, 'publish enabled');
      button(w,'同意して掲載する').click();
    };
    const publish = async () => { await startPublish(); await until(() => /掲載完了/.test(w.document.body.textContent), 'publication confirmed'); };
    // 確認記録の保存だけ失敗したときに、掲載完了や下書き削除へ進まない。
    w=await mount({url:'https://ui.test/?case=new#/work/new/12',offline:false});
    w.qaCheckError=true;
    await startPublish();
    await until(() => w.qaCalls.some(r=>r.path==='job_publish_checks' || r.path==='rpc/publish_my_job_with_check'), 'publication receipt attempted');
    await until(() => /掲載完了/.test(w.document.body.textContent) || [...w.document.querySelectorAll('button')].some(b=>b.textContent.trim()==='同意して掲載する' && !b.disabled), 'publication settles');
    assert.doesNotMatch(w.document.body.textContent,/掲載完了/);
    assert.equal(w.qaDrafts.listDeviceDrafts(owner).length,1);
    assert.equal(w.qaJob.status,'draft');
    assert.match(w.document.body.textContent,/掲載処理は確定していません/);
    assert.ok(w.qaCalls.some(r=>r.path==='app_errors' && r.body?.operation==='publish_rpc'));
    w.qaCheckError=false;
    button(w,'同意して掲載する').click();
    await until(() => /掲載完了/.test(w.document.body.textContent),'receipt retry completes');
    // DBで両方確定した後、通信応答だけを紛失。リロードでも同じ操作を照合し、再同期しない。
    w=await mount({url:'https://ui.test/?case=new#/work/new/12',offline:false});
    w.qaLosePublishResponse=true;
    await startPublish();
    await until(() => /掲載と確認記録の完了を確認できませんでした/.test(w.document.body.textContent),'lost response retained');
    const awaiting=w.qaDrafts.listDeviceDrafts(owner)[0];
    const requestBody=w.qaCalls.find(r=>r.path==='rpc/publish_my_job_with_check').body;
    assert.equal(awaiting.state,'publishing'); assert.equal(w.qaJob.status,'open');
    assert.equal(Object.keys(w.qaPublicationReceipts).length,1);
    assert.doesNotMatch(w.document.body.textContent,/掲載完了/);
    w=await mount({url:'https://ui.test/#/work/edit/42',offline:false,storage:snapshot(w),job:w.qaJob,receipts:w.qaPublicationReceipts});
    // openという状態だけ・別の確認記録IDでは完了にしない。
    w.qaReceiptMismatch=true;
    await startPublish();
    await until(() => /掲載と確認記録の完了を確認できませんでした/.test(w.document.body.textContent),'wrong receipt retained');
    assert.equal(w.qaDrafts.readDeviceDraft(owner,awaiting.id).publication.requestId,awaiting.publication.requestId);
    w.qaReceiptMismatch=false;
    button(w,'同意して掲載する').click();
    await until(() => /掲載完了/.test(w.document.body.textContent),'lost response confirmed after reload');
    assert.deepEqual(JSON.parse(JSON.stringify(w.qaCalls.find(r=>r.path==='rpc/publish_my_job_with_check').body)),JSON.parse(JSON.stringify(requestBody)));
    assert.equal(w.qaCalls.filter(r=>/rpc\/sync_my_(job_draft|open_job)$/.test(r.path)).length,0);
    assert.equal(Object.keys(w.qaPublicationReceipts).length,1);
    assert.equal(w.qaDrafts.listDeviceDrafts(owner).length,0);
    // 確認待ちの間に追加入力→保存して終了しても、古い掲載の成功応答で新しい入力を消さない。
    w=await mount({url:'https://ui.test/?case=new#/work/new/12',offline:false});
    w.qaLosePublishResponse=true;
    await startPublish();
    await until(() => /掲載と確認記録の完了を確認できませんでした/.test(w.document.body.textContent),'second lost response retained');
    const pendingStorage=snapshot(w),pendingJob=w.qaJob,pendingReceipts=w.qaPublicationReceipts;
    w=await mount({url:'https://ui.test/#/work/new/8',offline:false,storage:pendingStorage,job:pendingJob,receipts:pendingReceipts});
    await change(w,'掲載確認待ちの追加編集');
    button(w,'保存して終了').click();
    await until(() => /掲載結果の確認待ち/.test(w.document.body.textContent),'uncertain publication is visible in drafts');
    assert.equal(w.qaDrafts.listDeviceDrafts(owner)[0].state,'publishing');
    assert.equal(w.qaCalls.filter(r=>/rpc\/sync_my_/.test(r.path)).length,0);
    w=await mount({url:'https://ui.test/#/work/new/12',offline:false,storage:snapshot(w),job:pendingJob,receipts:pendingReceipts});
    await startPublish();
    await until(() => /その後の追加編集は未反映/.test(w.document.body.textContent),'new input preserved after receipt');
    assert.doesNotMatch(w.document.body.textContent,/掲載完了/);
    assert.equal(w.qaJob.notes,'最初の入力');
    assert.equal(w.qaDrafts.listDeviceDrafts(owner)[0].payload.notes,'掲載確認待ちの追加編集');
    assert.equal(w.qaDrafts.listDeviceDrafts(owner)[0].state,'local');
    // 結果確認前に終了した求人を、過去の操作IDで再掲載しない。
    w=await mount({url:'https://ui.test/?case=new#/work/new/12',offline:false});
    w.qaLosePublishResponse=true;
    await startPublish();
    await until(() => /掲載と確認記録の完了を確認できませんでした/.test(w.document.body.textContent),'third lost response retained');
    w.qaJob.status='closed';
    button(w,'同意して掲載する').click();
    await until(() => /再掲載は行っていません/.test(w.document.body.textContent),'current closed status respected');
    assert.equal(w.qaJob.status,'closed'); assert.equal(w.qaDrafts.listDeviceDrafts(owner)[0].state,'blocked');
    // カレンダーのコピー日程は入力にだけ入り、比較元はDBの行を維持する。
    const copied={...w.qaJob,status:'draft',draft_step:12,date_start:null,date_end:null,date_label:null,holidays:[]};
    w=await mount({url:'https://ui.test/#/work/edit/42',offline:false,job:copied,
      session:{cb_editJobPrefill:JSON.stringify(copied),cb_editJobPresetDates:JSON.stringify({job_number:42,date_start:'2026-12-01',date_end:null,holidays:[]})}});
    await until(() => /12\/1/.test(w.document.body.textContent), 'preset date shown from the calendar copy');
    await publish();
    assert.equal(w.qaJob.status,'open');
    assert.equal(w.qaJob.date_start,'2026-12-01');
    assert.equal(w.qaSyncExpected.date_start,null);
    assert.equal(w.qaDrafts.listDeviceDrafts(owner).length,0);
    // DB編集→端末保存→オフライン再開でも期間と休日を変換で壊さない。
    const period={...w.qaJob,status:'draft',draft_step:12,date_start:'2026-12-01',date_end:'2026-12-05',holidays:['2026-12-02']};
    w=await mount({url:'https://ui.test/#/work/edit/42',offline:false,job:period});
    await until(() => w.qaDrafts.listDeviceDrafts(owner).some(d => d.form?.jobDateEnd === '2026-12-05'), 'DB period saved as calendar dates');
    const periodDraft=w.qaDrafts.listDeviceDrafts(owner)[0];
    const checkPeriod = draft => {
      assert.equal(draft.form.jobDateStart,'2026-12-01');
      assert.equal(draft.form.jobDateEnd,'2026-12-05');
      assert.equal(draft.payload.date_start,'2026-12-01');
      assert.equal(draft.payload.date_end,'2026-12-05');
      assert.deepEqual(Array.from(draft.form.jobHolidays),['2026-12-02']);
      assert.deepEqual(Array.from(draft.payload.holidays),['2026-12-02']);
    };
    checkPeriod(periodDraft);
    w=await mount({url:`https://ui.test/#/work/local/${periodDraft.id}`,storage:snapshot(w),offline:true,job:period});
    await until(() => w.qaDrafts.readDeviceDraft(owner,periodDraft.id)?.form?.jobDateEnd === '2026-12-05', 'local period restored');
    checkPeriod(w.qaDrafts.readDeviceDraft(owner,periodDraft.id));
    assert.match(w.document.body.textContent,/12\/1/);
    // 旧ISO下書きも同時保存のpayloadを正として読む。再開先の時差には依存しない。
    const oldStorage=snapshot(w);
    const storageKey=`cb:device-draft:v1:${owner}:${periodDraft.id}`;
    const oldDraft=JSON.parse(oldStorage[storageKey]);
    oldDraft.form.jobDateStart='2026-11-30T15:00:00.000Z';
    oldDraft.form.jobDateEnd='2026-12-04T15:00:00.000Z';
    oldStorage[storageKey]=JSON.stringify(oldDraft);
    w=await mount({url:`https://ui.test/#/work/local/${periodDraft.id}`,storage:oldStorage,offline:true,job:period});
    await until(() => w.qaDrafts.readDeviceDraft(owner,periodDraft.id)?.form?.jobDateEnd === '2026-12-05', 'legacy ISO upgraded without changing its day');
    checkPeriod(w.qaDrafts.readDeviceDraft(owner,periodDraft.id));
    w.qaOffline=false;w.dispatchEvent(new w.Event('online'));
    await publish();
    assert.equal(w.qaJob.date_start,'2026-12-01');
    assert.equal(w.qaJob.date_end,'2026-12-05');
    assert.deepEqual(Array.from(w.qaJob.holidays),['2026-12-02']);
    // 入力内容は同じで、比較用の列が追加された旧キャッシュは安全に再照合して掲載できる。
    const legacy={...w.qaJob,status:'draft',draft_step:12};delete legacy.draft_step_id;
    w=await mount({url:'https://ui.test/#/work/edit/42',offline:false,job:legacy,
      session:{cb_editJobPrefill:JSON.stringify(legacy)}});
    w.qaConflictOnce='metadata';
    await publish();
    assert.equal(w.qaJob.status,'open');
    assert.equal(w.qaJob.notes,legacy.notes);
    assert.equal(w.qaSyncExpected.draft_step_id,'description');
    assert.equal(w.qaCalls.filter(r=>r.path==='rpc/sync_my_job_draft').length,2);
    assert.equal(w.qaCalls.filter(r=>r.path==='rpc/publish_my_job_with_check').length,1);
    // 別タブの本文変更は上書きしない。失敗理由・通知・入力保持と押し直しを実際のUIで検査。
    w=await mount({url:'https://ui.test/?case=new#/work/new/12',offline:false});
    w.qaConflictOnce=true;
    await startPublish();
    await until(() => /同期失敗の分類：保存競合/.test(w.document.body.textContent), 'real conflict is visible');
    await until(() => !button(w,'同意して掲載する').disabled, 'failed attempt is not stuck saving');
    const retained=w.qaDrafts.listDeviceDrafts(owner)[0];
    assert.equal(retained.form.jobDescription,'最初の入力');
    assert.equal(retained.state,'conflict');
    assert.equal(w.qaJob.notes,'別のタブの保存');
    assert.equal(w.qaJob.status,'draft');
    assert.equal(w.qaCalls.filter(r=>r.path==='rpc/publish_my_job_with_check').length,0);
    assert.ok(w.qaCalls.some(r=>r.path==='app_errors' && r.body?.component==='ListingFlow' && r.body?.operation==='draft_sync'));
    for(let retry=0;retry<2;retry++) {
      const profileReads=w.qaCalls.filter(r=>r.path==='employer_profiles').length;
      button(w,'同意して掲載する').click();
      await until(() => w.qaCalls.filter(r=>r.path==='employer_profiles').length>profileReads, 'explicit retry started');
      await until(() => !button(w,'同意して掲載する').disabled, 'explicit retry completed safely');
    }
    assert.equal(w.qaJob.notes,'別のタブの保存');
    assert.equal(w.qaCalls.filter(r=>r.path==='rpc/publish_my_job_with_check').length,0);
    assert.equal(w.qaCalls.filter(r=>r.path==='rpc/sync_my_job_draft').length,1);
    assert.equal(w.qaDrafts.readDeviceDraft(owner,retained.id).payload.notes,'最初の入力');
    assert.ok(!/DRAFT_REQUIRES_REVIEW|管理者デバッグ/.test(w.document.body.textContent));
    // codec単体だけでなく、全setter・端末保存・再開・同期の接続を44項目で確認する。
    await t.test('missing and unreadable work time stays unchanged through edit/reopen until both time controls are entered',async()=>{
      for(const raw of [null,'','不明']) {
        const row={...jobInputSample(),id:'00000000-0000-4000-8000-000000000044',job_number:42,farmer_id:owner,status:'draft',draft_step:5,work_time:raw};
        w=await mount({url:'https://ui.test/#/work/edit/42',offline:false,job:row,session:{cb_editJobPrefill:JSON.stringify(row)}});
        const clock=label=>w.document.querySelector(`input[aria-label="${label}"]`);
        await until(()=>clock('勤務開始時間')&&clock('勤務開始時間').value==='','empty legacy controls');
        assert.equal(clock('勤務終了時間').value,'');
        const inputTime=async(label,value)=>{const el=clock(label);Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new w.Event('input',{bubbles:true}));await pause(20);};
        const wage=w.document.querySelector('input[aria-label="日給"]');Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(wage,'15000');wage.dispatchEvent(new w.Event('input',{bubbles:true}));
        await until(()=>w.qaDrafts.listDeviceDrafts(owner).some(d=>d.payload.daily_wage==='15000'&&d.payload.work_time===raw),'other edit retains raw time');
        const stored=snapshot(w);w=await mount({url:'https://ui.test/#/work/edit/42',offline:true,storage:stored,job:row});
        assert.equal(clock('勤務開始時間').value,'');assert.equal(clock('勤務終了時間').value,'');
        assert.equal(w.qaDrafts.listDeviceDrafts(owner)[0].payload.work_time,raw);
        await inputTime('勤務開始時間','09:15');assert.equal(w.qaDrafts.listDeviceDrafts(owner)[0].payload.work_time,null);
        await inputTime('勤務終了時間','17:45');await until(()=>w.qaDrafts.listDeviceDrafts(owner)[0].payload.work_time==='9:15〜17:45','explicit time saved');
        await inputTime('勤務終了時間','');assert.equal(w.qaDrafts.listDeviceDrafts(owner)[0].payload.work_time,null);
      }
    });
    const fullRow={...jobInputSample(),id:'00000000-0000-4000-8000-000000000044',job_number:42,farmer_id:owner,status:'draft',draft_step_id:'review'};
    const expected={...fullRow,date_label:new Date().getFullYear()===2026 ? fullRow.date_label : '2026/12/1（火） 〜 2026/12/5（土）'};
    const assertInputs = actual => {
      for (const key of JOB_DRAFT_FIELDS) {
        assert.ok(Object.hasOwn(actual,key),key);
        assert.deepEqual(JSON.parse(JSON.stringify(actual[key])),expected[key],key);
      }
    };
    w=await mount({url:'https://ui.test/#/work/edit/42',offline:false,job:fullRow});
    await until(() => w.qaDrafts.listDeviceDrafts(owner).some(d=>d.form?.jobDescription===fullRow.notes),'all input restored from row');
    let allInputs=w.qaDrafts.listDeviceDrafts(owner)[0];
    assertInputs(allInputs.payload);
    w=await mount({url:'https://ui.test/#/work/edit/42',offline:true,job:fullRow,storage:snapshot(w)});
    assertInputs(w.qaDrafts.readDeviceDraft(owner,allInputs.id).payload);
    button(w,'保存して終了').click();
    await until(() => w.qaDrafts.readDeviceDraft(owner,allInputs.id)?.state==='pending','all input queued offline');
    w.qaOffline=false;w.dispatchEvent(new w.Event('online'));
    await until(() => w.qaDrafts.readDeviceDraft(owner,allInputs.id)?.state==='synced','all input synchronized');
    assertInputs(w.qaJob);
    // A copied video's URL survives, while its new job needs a fresh affirmative check.
    const videoCopy={...fullRow,work_video_job_consent:false,work_video_related_consent:false,work_video_consent_at:null,work_video_consent_version:null};
    w=await mount({url:'https://ui.test/#/work/edit/42',offline:false,job:videoCopy});
    await until(()=>w.qaDrafts.listDeviceDrafts(owner).some(d=>d.form?.workVideoUrl===videoCopy.work_video_url),'copied URL retained');
    await until(()=>button(w,'掲載する')&&!button(w,'掲載する').disabled,'video copy publish ready');
    button(w,'掲載する').click();
    await until(()=>w.document.querySelector('#work-video-url'),'missing consent opens video step');
    assert.equal(w.document.querySelector('#work-video-url').value,videoCopy.work_video_url);
    const consent=w.document.querySelector('input[type="checkbox"]');assert.equal(consent.checked,false);
    assert.equal(w.qaJob.status,'draft');
    assert.equal(w.document.querySelector('[data-guide="flow-next"]').disabled,true);
    w.document.querySelector('[data-guide="flow-next"]').click();
    assert.ok(w.document.querySelector('#work-video-url'),'cannot continue without consent');
    consent.click();
    await until(()=>w.qaDrafts.listDeviceDrafts(owner).some(d=>d.form?.workVideoJobConsent===true),'fresh consent persisted');
    w.document.querySelector('[data-guide="flow-next"]').click();
    await until(()=>[...w.document.querySelectorAll('button')].some(b=>b.textContent.trim()==='掲載する'),'return to review after consent');
    await publish();
    assert.equal(w.qaJob.work_video_url,videoCopy.work_video_url);assert.equal(w.qaJob.work_video_job_consent,true);
    assert.ok(w.qaJob.work_video_consent_at);assert.equal(w.qaJob.work_video_related_consent,false);
    assert.deepEqual(errors,[]);
  } catch (error) {
    console.error(`Browser errors: ${JSON.stringify(errors)}\nScreen: ${dom?.window.document.body.textContent}\nRequests: ${JSON.stringify(dom?.window.qaCalls?.map(r=>r.path))}`);
    throw error;
  } finally {dom?.window.close();await rm(output,{recursive:true,force:true});}
});
