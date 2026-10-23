import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { jobInputSample } from './fixtures/job-input.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const owner='00000000-0000-4000-8000-000000000001';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label) {const end=Date.now()+5000;while(!fn()){assert.ok(Date.now()<end,`timed out: ${label}`);await pause(10);}}
const initialForm=()=>({role:'farmer',farmerStep:4,farmerCropPill:'ブロッコリー',farmerTaskPill:'収穫',farmerPurpose:'post',
  farmerZip:'7793401',farmerPref:'徳島県',farmerCity:'吉野川市',farmerTown:'山川町',farmerAddr:'123番地',
  jobDateStart:'2026-11-01',jobDateEnd:null,jobHolidays:[],jobCount:'',dailyWageInput:'10000',breakTime:'60分',
  overtimePolicy:'なし',jobDescription:'保持する説明',workVideoUrl:''});
const dbRow=(extra={})=>({...jobInputSample(),id:'00000000-0000-4000-8000-000000000042',job_number:42,farmer_id:owner,status:'draft',draft_step:4,draft_step_id:'schedule',...extra});

test('stage 3 real listing: basic topics, navigation, recovery, minimum wage and publication',async t=>{
  const output=await mkdtemp(path.join(tmpdir(),'cb-listing-schedule-'));let dom;
  const errors=[];
  try {
    await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
      name:'listing-schedule-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)supabase(?:\.js)?$/.test(id)||/(?:jobCreateGeo|lib\/zipLookup)(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/offline/client.js');},
    },react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/offline/entry.jsx'),name:'ScheduleQA',formats:['iife'],fileName:'fixture'},minify:false}});
    const script=await readFile(path.join(output,'fixture.iife.js'),'utf8');
    async function mount({url='https://ui.test/#/work/new/page/schedule',form,storage={},session={},job=null,offline=true,minimumWage=1100,profile=null}={}) {
      dom?.window.close();const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Could not load|Not implemented: navigation/.test(e.message))errors.push(e.message);});
      dom=new JSDOM('<div id="root"></div>',{url,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});
      const w=dom.window;w.Response=Response;w.Request=Request;w.Headers=Headers;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
      w.fetch=()=>Promise.reject(new Error('No live requests'));w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
      w.scrollTo=()=>{};w.HTMLElement.prototype.scrollTo=function(x,y){this.scrollTop=typeof x==='object'?x.top:y;};
      w.ResizeObserver=class{observe(){}disconnect(){}unobserve(){}};w.IntersectionObserver=class{observe(){}disconnect(){}unobserve(){}};
      w.alert=m=>errors.push(m);w.confirm=()=>true;w.qaOffline=offline;w.qaConsent=true;w.qaJob=job;w.qaListingForm=form;w.qaMinimumWage=minimumWage;w.qaProfile=profile;
      for(const[k,v]of Object.entries(storage))w.localStorage.setItem(k,v);for(const[k,v]of Object.entries(session))w.sessionStorage.setItem(k,v);
      w.eval(script);await until(()=>w.document.querySelector('[data-step-id],#listing-workplace-form')||/再開するページを確認できません|保存した求人を読み込めませんでした/.test(w.document.body.textContent),'initial listing');return w;
    }
    const q=(w,s)=>w.document.querySelector(s);
    const button=(w,label)=>{const b=[...w.document.querySelectorAll('button')].find(x=>x.textContent.trim()===label);assert.ok(b,`button: ${label}`);return b;};
    const page=async(w,id)=>{await until(()=>q(w,'[data-step-id]')?.dataset.stepId===id,`page ${id}`);await pause(180);};
    const next=async(w,id)=>{button(w,'次へ').click();await page(w,id);};
    const storage=w=>Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]));
    const record=w=>w.qaDrafts.listDeviceDrafts(owner)[0];
    const _setCount=async(w,value)=>{const input=q(w,'#listing-headcount');assert.ok(input);Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new w.Event('input',{bubbles:true}));await until(()=>record(w)?.form.jobCount===value,'count persisted');};

    const topics=['task','task_scope','workplace','place_scope','access','work_time','break_time','overtime','daily_wage'];
    const plain=v=>JSON.parse(JSON.stringify(v));
    const route=async(w,id,scope='work/new')=>{w.location.hash=`/${scope}/page/${id}`;await page(w,id);};
    const input=async(w,selector,value)=>{const el=q(w,selector);assert.ok(el,selector);const proto=el.tagName==='SELECT'?w.HTMLSelectElement.prototype:w.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new w.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));await pause(35);};
    const form=()=>({...initialForm(),farmerStep:5,jobCount:'3',startHour:'8',startMinute:'00',endHour:'16',endMinute:'00',taskChangeScope:'変更なし',placeChangeScope:'変更なし',nearestStation:'山瀬',commuteTime:'車10分以内'});

    await t.test('task and change scope are separate pages with retained values and normal/back history',async()=>{
      const w=await mount({url:'https://ui.test/#/work/new/page/task',form:form()});await page(w,'task');
      assert.equal(q(w,'[aria-label="作業の変更の範囲"]'),null);
      await next(w,'task_scope');assert.equal(q(w,'.lf-crop-grid'),null);
      button(w,'関連する農作業の範囲内').click();await until(()=>record(w).form.taskChangeScope==='関連する農作業の範囲内','scope input');
      await next(w,'workplace');w.history.back();await page(w,'task_scope');
      assert.equal(button(w,'関連する農作業の範囲内').getAttribute('aria-pressed'),'true');
      button(w,'戻る').click();await page(w,'task');assert.equal(record(w).payload.task,'収穫');
    });
    await t.test('location, location scope and optional access each ask one topic; skipping access preserves input and goes to calendar',async()=>{
      const w=await mount({url:'https://ui.test/#/work/new/page/workplace',form:form()});await page(w,'workplace');
      assert.ok(q(w,'#meeting-zip'));assert.equal(q(w,'#listing-nearest-station'),null);assert.equal(q(w,'[aria-label="場所の変更の範囲"]'),null);
      await next(w,'place_scope');assert.equal(q(w,'#meeting-zip'),null);button(w,'この農園の圃場の範囲内').click();
      await next(w,'access');assert.equal(q(w,'#meeting-zip'),null);
      await input(w,'#listing-nearest-station','阿波川島');await input(w,'#listing-commute-time','車20分以内');
      button(w,'あとで追加').click();await page(w,'schedule');button(w,'戻る').click();await page(w,'access');
      assert.equal(q(w,'#listing-nearest-station').value,'阿波川島');assert.equal(q(w,'#listing-commute-time').value,'車20分以内');
      assert.equal(record(w).payload.place_change_scope,'この農園の圃場の範囲内');assert.equal(record(w).payload.address,'123番地');
    });
    await t.test('time, break, overtime and pay are independent; validation belongs to the current topic',async()=>{
      const w=await mount({url:'https://ui.test/#/work/new/page/work_time',form:{...form(),breakTime:'',overtimePolicy:'',dailyWageInput:''}});await page(w,'work_time');
      assert.equal(q(w,'[aria-label="日給"]'),null);assert.equal(q(w,'[aria-label="休憩時間"]'),null);assert.equal(button(w,'次へ').disabled,false);
      await input(w,'input[aria-label="勤務終了時間"]','07:00');assert.equal(button(w,'次へ').disabled,true);assert.match(w.document.body.textContent,/終了は開始より後/);
      await input(w,'input[aria-label="勤務終了時間"]','16:00');await next(w,'break_time');
      assert.equal(q(w,'input[type="time"]'),null);assert.equal(button(w,'次へ').disabled,true);
      await input(w,'select[aria-label="休憩時間"]','60分');await next(w,'overtime');
      assert.equal(q(w,'select[aria-label="休憩時間"]'),null);assert.equal(button(w,'次へ').disabled,true);
      button(w,'あり').click();await pause(30);assert.equal(button(w,'次へ').disabled,true);
      await input(w,'input[aria-label="時間外労働の目安"]','1日30分');assert.equal(button(w,'次へ').disabled,false);
      button(w,'なし').click();await pause(25);button(w,'あり').click();await pause(25);assert.equal(q(w,'input[aria-label="時間外労働の目安"]').value,'1日30分');
      await next(w,'daily_wage');assert.equal(q(w,'input[type="time"]'),null);assert.equal(q(w,'select'),null);
      assert.equal(button(w,'次へ').disabled,true);await input(w,'input[aria-label="日給"]','12,000円');assert.equal(record(w).payload.daily_wage,'12000');
      assert.match(w.document.body.textContent,/7時間/);button(w,'勤務時間を変更').click();await page(w,'work_time');
      assert.equal(record(w).form.breakTime,'60分');assert.equal(record(w).form.overtimeDetail,'1日30分');assert.equal(record(w).form.dailyWageInput,'12000');
    });
    await t.test('minimum wage exact boundary passes, one yen below and zero cannot advance, and missing lookup never allows publication',async()=>{
      let w=await mount({url:'https://ui.test/#/work/new/page/daily_wage',form:{...form(),dailyWageInput:'7700'},offline:false});await page(w,'daily_wage');
      assert.equal(button(w,'次へ').disabled,false);await input(w,'input[aria-label="日給"]','7699');assert.equal(button(w,'次へ').disabled,true);assert.match(w.document.body.textContent,/最低賃金.*下回っています/);
      await input(w,'input[aria-label="日給"]','0');assert.equal(button(w,'次へ').disabled,true);
      await input(w,'input[aria-label="日給"]','7700');assert.equal(button(w,'次へ').disabled,false);
      w=await mount({url:'https://ui.test/#/work/new/page/daily_wage',form:{...form(),dailyWageInput:'7700'},minimumWage:null,offline:false});await page(w,'daily_wage');
      assert.match(w.document.body.textContent,/最低賃金を確認できませんでした/);assert.equal(button(w,'次へ').disabled,false);
      await route(w,'review');assert.equal(button(w,'掲載する').disabled,true);assert.equal(w.qaCalls.filter(c=>c.path==='rpc/publish_my_job_with_check').length,0);
      w.qaMinimumWage=1100;button(w,'最低賃金を再確認').click();await until(()=>!button(w,'掲載する').disabled,'wage recheck');
    });
    await t.test('each basic page survives save and local resume with every unrelated input and old DB number retained',async()=>{
      for(const id of topics) {
        let w=await mount({url:`https://ui.test/#/work/new/page/${id}`,form:form()});await page(w,id);
        const before=plain(record(w).payload), saved=record(w);button(w,'保存して終了').click();await until(()=>/保存して終了しました/.test(w.document.body.textContent),'local save');
        w=await mount({url:`https://ui.test/#/work/local/${saved.id}`,storage:storage(w)});await page(w,id);
        assert.deepEqual(plain(record(w).payload),before);assert.equal(record(w).form.listingPageId,id);
        assert.equal(record(w).payload.draft_step, ['task','task_scope'].includes(id)?2:['workplace','place_scope','access'].includes(id)?3:5);
      }
    });
    await t.test('old DB terms and previous-generation device metadata resume without losing opaque time or changing the comparison snapshot',async()=>{
      for(const [change,id]of [[{work_time:null},'work_time'],[{break_time:''},'break_time'],[{overtime_policy:'',overtime_detail:''},'overtime'],[{},'daily_wage']]) {
        const row=dbRow({draft_step:5,draft_step_id:'terms',...change});
        let w=await mount({url:'https://ui.test/#/work/edit/42',job:row,offline:false});await page(w,id);
        assert.equal(record(w).payload.work_time,row.work_time);assert.equal(record(w).base.draft_step_id,'terms');assert.equal(record(w).payload.draft_step,5);
      }
      const w=await mount({url:'https://ui.test/#/work/new',form:{...form(),listingPageId:'terms',listingNavVersion:'2026-10-22-stage2'}});await page(w,'daily_wage');
      assert.equal(record(w).form.listingNavVersion,'2026-10-23-stage3');assert.equal(record(w).form.dailyWageInput,'10000');
    });
    await t.test('every review edit has its own URL and returns directly to review, including after reload',async()=>{
      let w=await mount({url:'https://ui.test/#/work/edit/42',job:dbRow({draft_step:12}),offline:false});await page(w,'review');
      for(const [label,id]of [['作業','task'],['作業の変更範囲','task_scope'],['集合場所','workplace'],['場所の変更範囲','place_scope'],['アクセス','access'],['勤務時間','work_time'],['休憩時間','break_time'],['時間外労働','overtime'],['日給','daily_wage']]) {
        button(w,label).click();await page(w,id);assert.match(w.location.hash,/return=review/);
        const snapshot=storage(w), url=w.location.href;
        w=await mount({url,storage:snapshot,offline:true});await page(w,id);button(w,'確認に戻る').click();await page(w,'review');
      }
    });
    await t.test('publication guards route invalid time, break, overtime and pay to the exact input page without sending a publish',async()=>{
      for(const [change,id]of [[{work_time:null},'work_time'],[{break_time:''},'break_time'],[{overtime_policy:'',overtime_detail:''},'overtime'],[{daily_wage:'1'},'daily_wage']]) {
        const w=await mount({url:'https://ui.test/#/work/edit/42',job:dbRow({draft_step:12,...change}),offline:false});await page(w,'review');
        await until(()=>!button(w,'掲載する').disabled,'publish preflight ready');button(w,'掲載する').click();await page(w,id);
        assert.match(w.location.hash,/return=review/);assert.equal(w.qaCalls.filter(c=>c.path==='rpc/publish_my_job_with_check').length,0);
      }
    });
    await t.test('copied and open jobs retain legacy custom scopes/access, preserve all input and never publish during page navigation',async()=>{
      for(const status of ['draft','open']) {
        const row=dbRow({status,draft_step:12});const base=plain(row);
        const w=await mount({url:'https://ui.test/#/work/edit/42/page/task_scope',job:row,offline:false,session:status==='draft'?{cb_editJobPrefill:JSON.stringify(row)}:{}});await page(w,'task_scope');
        assert.equal(button(w,row.task_change_scope).getAttribute('aria-pressed'),'true');
        await route(w,'place_scope','work/edit/42');assert.equal(button(w,row.place_change_scope).getAttribute('aria-pressed'),'true');
        await route(w,'access','work/edit/42');assert.equal(q(w,'#listing-commute-time').value,'10分');
        await route(w,'work_time','work/edit/42');assert.equal(q(w,'input[aria-label="勤務開始時間"]').value,'09:15');
        await route(w,'break_time','work/edit/42');assert.equal(q(w,'select').value,'60分');
        await route(w,'overtime','work/edit/42');assert.equal(q(w,'input').value,'30分');
        await route(w,'daily_wage','work/edit/42');assert.equal(q(w,'input[aria-label="日給"]').value,'12000');
        for(const key of ['id','farmer_id','status','draft_step_id','work_time','nearest_station','commute_time','task_change_scope','place_change_scope']) assert.deepEqual(record(w).base[key],base[key],key);
        assert.equal(w.qaCalls.filter(c=>/^rpc\/(sync_my_|publish_my_)/.test(c.path||'')).length,0);
      }
    });
    await t.test('saved workplace populates only the address and auxiliary back retains the review return after reload',async()=>{
      const profile={auth_id:owner,place_zip:'7793401',place_prefecture:'徳島県',place_city:'吉野川市',place_town:'山川町',place_address:'456番地'};
      let w=await mount({url:'https://ui.test/#/work/new/page/workplace?return=review',form:form(),offline:false,profile});await page(w,'workplace');
      await until(()=>[...w.document.querySelectorAll('button')].some(b=>b.textContent.includes('登録した作業場を使う')),'saved place');
      [...w.document.querySelectorAll('button')].find(b=>b.textContent.includes('登録した作業場を使う')).click();await pause(35);
      assert.equal(q(w,'#meeting-addr').value,'456番地');assert.equal(record(w).payload.nearest_station,'山瀬');assert.equal(record(w).payload.place_change_scope,'変更なし');
      const snapshot=storage(w);w=await mount({url:'https://ui.test/#/work/new/workplace?return=review',storage:snapshot,offline:true});
      await until(()=>q(w,'#listing-workplace-form'),'registered place form');button(w,'戻る').click();await page(w,'workplace');
      assert.match(w.location.hash,/page\/workplace\?return=review$/);button(w,'確認に戻る').click();await page(w,'review');
    });
    await t.test('storage failure on a separated pay page keeps the typed amount visible and cannot falsely finish saving',async()=>{
      const w=await mount({url:'https://ui.test/#/work/new/page/daily_wage',form:form()});await page(w,'daily_wage');
      const original=w.Storage.prototype.setItem;w.Storage.prototype.setItem=function(key,value){if(key.startsWith('cb:device-draft:'))throw new Error('quota');return original.call(this,key,value);};
      await input(w,'input[aria-label="日給"]','15000');assert.match(w.document.body.textContent,/この端末に保存できません/);
      button(w,'保存して終了').click();await pause(25);assert.equal(q(w,'input[aria-label="日給"]').value,'15000');assert.doesNotMatch(w.document.body.textContent,/保存して終了しました/);
      assert.equal(record(w).payload.daily_wage,'10000');
    });

    assert.deepEqual(errors,[]);
  } finally {dom?.window.close();await rm(output,{recursive:true,force:true});}
});
