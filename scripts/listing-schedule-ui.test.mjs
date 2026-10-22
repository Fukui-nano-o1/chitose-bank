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

test('stage 2 real listing: one topic per URL, retained input, browser history and review round trips',async t=>{
  const output=await mkdtemp(path.join(tmpdir(),'cb-listing-schedule-'));let dom;
  const errors=[];
  try {
    await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
      name:'listing-schedule-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)supabase(?:\.js)?$/.test(id)||/(?:jobCreateGeo|lib\/zipLookup)(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/offline/client.js');},
    },react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/offline/entry.jsx'),name:'ScheduleQA',formats:['iife'],fileName:'fixture'},minify:false}});
    const script=await readFile(path.join(output,'fixture.iife.js'),'utf8');
    async function mount({url='https://ui.test/#/work/new/page/schedule',form,storage={},session={},job=null,offline=true}={}) {
      dom?.window.close();const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Could not load|Not implemented: navigation/.test(e.message))errors.push(e.message);});
      dom=new JSDOM('<div id="root"></div>',{url,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});
      const w=dom.window;w.Response=Response;w.Request=Request;w.Headers=Headers;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
      w.fetch=()=>Promise.reject(new Error('No live requests'));w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
      w.scrollTo=()=>{};w.HTMLElement.prototype.scrollTo=function(x,y){this.scrollTop=typeof x==='object'?x.top:y;};
      w.ResizeObserver=class{observe(){}disconnect(){}unobserve(){}};w.IntersectionObserver=class{observe(){}disconnect(){}unobserve(){}};
      w.alert=m=>errors.push(m);w.confirm=()=>true;w.qaOffline=offline;w.qaConsent=true;w.qaJob=job;w.qaListingForm=form;
      for(const[k,v]of Object.entries(storage))w.localStorage.setItem(k,v);for(const[k,v]of Object.entries(session))w.sessionStorage.setItem(k,v);
      w.eval(script);await until(()=>w.document.querySelector('[data-step-id]')||/再開するページを確認できません|保存した求人を読み込めませんでした/.test(w.document.body.textContent),'initial listing');return w;
    }
    const q=(w,s)=>w.document.querySelector(s);
    const button=(w,label)=>{const b=[...w.document.querySelectorAll('button')].find(x=>x.textContent.trim()===label);assert.ok(b,`button: ${label}`);return b;};
    const page=async(w,id)=>{await until(()=>q(w,'[data-step-id]')?.dataset.stepId===id,`page ${id}`);await pause(180);};
    const next=async(w,id)=>{button(w,'次へ').click();await page(w,id);};
    const storage=w=>Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]));
    const record=w=>w.qaDrafts.listDeviceDrafts(owner)[0];
    const setCount=async(w,value)=>{const input=q(w,'#listing-headcount');assert.ok(input);Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new w.Event('input',{bubbles:true}));await until(()=>record(w)?.form.jobCount===value,'count persisted');};

    await t.test('calendar, holidays and headcount have separate controls and preserve values through normal and browser back',async()=>{
      const w=await mount({form:initialForm()});await page(w,'schedule');
      assert.equal(q(w,'#listing-headcount'),null);assert.equal(button(w,'次へ').disabled,false);
      q(w,'[aria-label="2026-11-05"]').click();await until(()=>record(w).form.jobDateEnd==='2026-11-05','end chosen');
      await next(w,'holidays');assert.match(w.location.hash,/page\/holidays$/);assert.equal(q(w,'#listing-headcount'),null);
      for(const day of ['01','05','06'])assert.equal(q(w,`[aria-label="2026-11-${day}"]`).disabled,true);
      q(w,'[aria-label="2026-11-03"]').click();await until(()=>record(w).form.jobHolidays.includes('2026-11-03'),'holiday persisted');
      await next(w,'headcount');assert.equal(q(w,'[aria-label="2026-11-03"]'),null);assert.equal(button(w,'次へ').disabled,true);
      for(const value of ['0','-1','1.5']){await setCount(w,value);assert.equal(button(w,'次へ').disabled,true);}
      await setCount(w,'4');assert.equal(button(w,'次へ').disabled,false);
      button(w,'戻る').click();await page(w,'holidays');assert.equal(q(w,'[aria-label="2026-11-03"]').getAttribute('aria-pressed'),'true');
      await next(w,'headcount');assert.equal(q(w,'#listing-headcount').value,'4');await next(w,'terms');
      w.history.back();await page(w,'headcount');assert.equal(q(w,'#listing-headcount').value,'4');
      w.history.back();await page(w,'holidays');assert.deepEqual(Array.from(record(w).form.jobHolidays),['2026-11-03']);
      w.history.forward();await page(w,'headcount');
      assert.equal(record(w).payload.draft_step,4);assert.equal(Object.hasOwn(record(w).payload,'draft_step_id'),false);
      assert.equal(w.qaCalls.filter(c=>c.path?.startsWith('rpc/sync_')||c.path?.startsWith('rpc/publish_')).length,0);
    });
    await t.test('year boundary holidays toggle without changing the range; changing dates alone clears obsolete holidays',async()=>{
      const w=await mount({form:{...initialForm(),jobDateStart:'2026-12-29',jobDateEnd:'2027-01-03',jobHolidays:[],jobCount:'2'}});await page(w,'schedule');
      await next(w,'holidays');q(w,'[aria-label="次の月"]').click();await until(()=>q(w,'[aria-label="2027-01-01"]'),'January');
      q(w,'[aria-label="2027-01-01"]').click();await until(()=>record(w).form.jobHolidays.length===1,'holiday added');
      q(w,'[aria-label="2027-01-01"]').click();await until(()=>record(w).form.jobHolidays.length===0,'holiday removed');
      q(w,'[aria-label="2027-01-02"]').click();await until(()=>record(w).form.jobHolidays.length===1,'other holiday added');
      assert.equal(record(w).form.jobDateStart,'2026-12-29');assert.equal(record(w).form.jobDateEnd,'2027-01-03');
      button(w,'日程を変更する').click();await page(w,'schedule');q(w,'[aria-label="2026-12-30"]').click();
      await until(()=>record(w).form.jobDateEnd===null&&record(w).form.jobHolidays.length===0,'explicit range change');
      await next(w,'headcount');assert.equal(q(w,'#listing-headcount').value,'2');
    });
    await t.test('page scroll and heading focus restore on back; unknown completion URLs cannot claim publication',async()=>{
      let w=await mount({form:{...initialForm(),jobDateEnd:'2026-11-05'}});await page(w,'schedule');
      q(w,'.listing-scroll').scrollTop=125;q(w,'.listing-scroll').dispatchEvent(new w.Event('scroll'));
      await next(w,'holidays');assert.equal(q(w,'.listing-scroll').scrollTop,0);
      button(w,'戻る').click();await page(w,'schedule');assert.equal(q(w,'.listing-scroll').scrollTop,125);
      assert.equal(w.document.activeElement.textContent,'いつ来てほしいですか？');
      const snapshot=storage(w);w=await mount({url:'https://ui.test/#/work/new/page/complete',storage:snapshot});
      assert.match(w.document.body.textContent,/再開するページを確認できません/);assert.deepEqual(storage(w),snapshot);
    });
    await t.test('single-day skips holidays in both directions; same-day end also remains single-day',async()=>{
      for(const end of [null,'2026-11-01']){
        const w=await mount({form:{...initialForm(),jobDateEnd:end}});await page(w,'schedule');
        await next(w,'headcount');button(w,'戻る').click();await page(w,'schedule');assert.equal(record(w).form.jobDateEnd,end);
      }
    });
    await t.test('each new page survives reload and local-draft resume with unrelated input untouched',async()=>{
      let saved;
      for(const id of ['schedule','holidays','headcount']){
        let w=await mount({url:`https://ui.test/#/work/new/page/${id}`,form:{...initialForm(),jobDateEnd:'2026-11-05',jobHolidays:['2026-11-03'],jobCount:'7'}});await page(w,id);
        saved=record(w);const snapshot=storage(w);
        w=await mount({url:`https://ui.test/#/work/local/${saved.id}`,storage:snapshot});await page(w,id);
        assert.equal(record(w).form.jobCount,'7');assert.equal(record(w).form.jobDateStart,'2026-11-01');
        assert.deepEqual(Array.from(record(w).form.jobHolidays),['2026-11-03']);assert.equal(record(w).form.jobDescription,'保持する説明');
        assert.match(w.location.hash,new RegExp(`/page/${id}$`));
      }
    });
    await t.test('DB-only legacy step 4 resumes without shifting later pages or inventing holiday confirmation',async()=>{
      for(const [row,id]of [[dbRow({date_start:null,date_end:null,holidays:[],headcount:null}),'schedule'],[dbRow({date_end:null,holidays:[],headcount:null}),'headcount'],[dbRow(),'holidays'],[dbRow({draft_step:5,draft_step_id:'terms'}),'terms']]){
        const w=await mount({url:'https://ui.test/#/work/edit/42',job:row,offline:false});await page(w,id);
        assert.equal(record(w).base.draft_step_id,row.draft_step_id);assert.equal(record(w).payload.draft_step,id==='terms'?5:4);
      }
    });
    await t.test('copy prefill and existing open-job edit honor their own named page and keep comparison snapshots unchanged',async()=>{
      const copy=dbRow({draft_step:12,draft_step_id:'review'});
      let w=await mount({url:'https://ui.test/#/work/edit/42/page/schedule',session:{cb_editJobPrefill:JSON.stringify(copy)},job:copy,offline:false});await page(w,'schedule');
      assert.equal(record(w).base.draft_step,12);assert.equal(record(w).base.headcount,3);
      const open=dbRow({status:'open',draft_step:12,draft_step_id:'review'});
      w=await mount({url:'https://ui.test/#/work/edit/42/page/headcount?return=review',job:open,offline:false});await page(w,'headcount');
      await setCount(w,'5');assert.equal(record(w).base.headcount,3);assert.equal(record(w).payload.headcount,5);
      const snapshot=storage(w);w=await mount({url:w.location.href,storage:snapshot,job:open,offline:true});await page(w,'headcount');
      button(w,'確認に戻る').click();await page(w,'review');assert.ok(button(w,'変更を保存'));
      assert.equal(record(w).base.status,'open');assert.equal(w.qaCalls.filter(c=>c.path==='rpc/sync_my_open_job').length,0);
    });
    await t.test('review exposes separate edit links and missing headcount lands only on the headcount page',async()=>{
      let w=await mount({url:'https://ui.test/#/work/edit/42',job:dbRow({draft_step:12,draft_step_id:'review'}),offline:false});await page(w,'review');
      button(w,'採用人数').click();await page(w,'headcount');assert.match(w.location.hash,/return=review/);
      await setCount(w,'6');button(w,'確認に戻る').click();await page(w,'review');
      button(w,'休日').click();await page(w,'holidays');button(w,'確認に戻る').click();await page(w,'review');
      w=await mount({url:'https://ui.test/#/work/edit/42',job:dbRow({draft_step:12,draft_step_id:'review',headcount:null}),offline:false});await page(w,'review');
      await until(()=>!button(w,'掲載する').disabled,'minimum wage loaded');button(w,'掲載する').click();await page(w,'headcount');
      assert.equal(q(w,'[aria-label="2026-12-01"]'),null);assert.equal(record(w).payload.date_start,'2026-12-01');
    });
    await t.test('save and reopen keeps the exact synced-device page but reloads the authoritative DB input',async()=>{
      let w=await mount({url:'https://ui.test/#/work/edit/42/page/headcount',job:dbRow(),offline:false});await page(w,'headcount');await setCount(w,'8');
      button(w,'保存して終了').click();await until(()=>record(w)?.state==='synced','server confirmed');
      const snapshot=storage(w),row={...w.qaJob,headcount:9};
      w=await mount({url:'https://ui.test/#/work/edit/42',storage:snapshot,job:row,offline:false});await page(w,'headcount');
      assert.equal(q(w,'#listing-headcount').value,'9');assert.equal(record(w).base.headcount,9);
    });
    await t.test('unknown route or device generation is not guessed and never overwrites saved inputs',async()=>{
      let w=await mount({form:{...initialForm(),jobCount:'3'}});await page(w,'schedule');const snapshot=storage(w);
      w=await mount({url:'https://ui.test/#/work/new/page/future',storage:snapshot});
      assert.match(w.document.body.textContent,/再開するページを確認できません/);assert.deepEqual(storage(w),snapshot);
      const entry=Object.entries(snapshot).find(([key])=>key.startsWith('cb:device-draft:'));
      const value=JSON.parse(entry[1]);value.form.listingNavVersion='future';snapshot[entry[0]]=JSON.stringify(value);
      w=await mount({url:`https://ui.test/#/work/local/${value.id}`,storage:snapshot});
      assert.match(w.document.body.textContent,/再開するページを確認できません/);assert.deepEqual(storage(w),snapshot);
    });
    await t.test('storage failures keep visible input, expose the error and do not falsely report saved',async()=>{
      const w=await mount({form:{...initialForm(),jobCount:'3'},url:'https://ui.test/#/work/new/page/headcount'});await page(w,'headcount');
      const original=w.Storage.prototype.setItem;w.Storage.prototype.setItem=function(key,value){if(key.startsWith('cb:device-draft:'))throw new Error('quota');return original.call(this,key,value);};
      const input=q(w,'#listing-headcount');Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(input,'11');input.dispatchEvent(new w.Event('input',{bubbles:true}));
      await until(()=>/この端末に保存できません/.test(w.document.body.textContent),'storage error');assert.equal(input.value,'11');
      button(w,'保存して終了').click();await pause(30);assert.doesNotMatch(w.document.body.textContent,/保存して終了しました/);assert.equal(record(w).form.jobCount,'3');
    });
    assert.deepEqual(errors,[]);
  } finally {dom?.window.close();await rm(output,{recursive:true,force:true});}
});
