import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM,VirtualConsole} from 'jsdom';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
const root=fileURLToPath(new URL('../',import.meta.url));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const deadline=Date.now()+5000;while(!fn()){assert.ok(Date.now()<deadline,label);await pause(10);}}
const job=id=>({id,crop:`合成作物${id}`,task:'収穫',employerName:`合成募集主${id}`,region:'合成市',cityArea:'合成市',dateLabel:'2099-11-02',dateStartRaw:'2099-11-02',dateEndRaw:'2099-11-02',dateStart:'2099-11-02',dateEnd:'2099-11-02',workTime:'08:00〜17:00',payType:'daily',pay:10000,count:'2名',headcount:2,closed:false,filled:false,expired:false,hiredCount:0,isNew:false,photos:[],holidays:[],maskedFields:[],dangerPlaces:[],dangerTasks:[]});

test('real job search owns dedicated workplace entry, direct routes, same-job return and profile isolation',async()=>{
 const output=await mkdtemp(path.join(tmpdir(),'cb-workplace-search-'));let dom;
 try{
  await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'workplace-search-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/workplace-search-client.js');}},react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/job-expiry/entry.jsx'),name:'WorkplaceSearchQA',formats:['iife'],fileName:'fixture'},minify:false}});
  const script=await readFile(path.join(output,'fixture.iife.js'),'utf8');
  const errors=[];let releaseProfile;
  function mount(hash){
   dom?.window.close();const console=new VirtualConsole();console.on('jsdomError',e=>{if(!/CSS/.test(e.message))errors.push(e.message);});console.on('error',(...args)=>errors.push(args.join(' ')));
   dom=new JSDOM('<div id="root"></div>',{url:`https://workplace.test/${hash}`,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console});const w=dom.window;
   Object.assign(w,{Response,Request,Headers,AbortController,AbortSignal,TextEncoder,TextDecoder});
   w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
   w.qaScroll=[];w.scrollTo=(...args)=>{w.qaScroll.push(args);w.scrollY=typeof args[0]==='object'?args[0].top:args[1];};
   w.HTMLElement.prototype.scrollTo=()=>{};w.HTMLElement.prototype.scrollBy=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
   w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.fetch=()=>{throw Error('Unexpected real network');};
   const json=(value,status=200)=>Promise.resolve(new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}}));
   w.qaWorkplaceRequest=(url,body)=>{
    if(url.endsWith('/job_employer_profile')){
     if(body.p_job_number===202)return new Promise(resolve=>{releaseProfile=()=>resolve(new Response(JSON.stringify([{nickname:'合成募集主202',intro_atmosphere:'SECOND JOB'}]),{headers:{'Content-Type':'application/json'}}));});
     if(body.p_job_number===303)return json({message:'synthetic failure'},503);
     return json([{nickname:'合成募集主101',intro_atmosphere:'FIRST JOB'}]);
    }
    if(url.endsWith('/job_employer_trust_info'))return json(null);
    return new Promise(()=>{});
   };
   w.localStorage.setItem('cb_viewCache_v2_anon',JSON.stringify({'search:jobs':[job(101),job(202),job(303)]}));
   w.eval(script);return w;
  }
  let w;
  for (const [place, scroll] of [['top',120],['host',680]]) {
   for (const action of ['click','Enter',' ']) {
    w=mount('#/work/job/101');
    await until(()=>w.document.querySelectorAll('[aria-label="職場紹介を見る"]').length===2,'both existing employer entries');
    const entries=[...w.document.querySelectorAll('[aria-label="職場紹介を見る"]')];
    assert.equal(entries.filter(entry=>entry.closest('#sec-host')).length,1,'one lower 募集主について entry');
    assert.equal(entries.filter(entry=>!entry.closest('#sec-host')).length,1,'one existing top employer entry');
    const entry=entries.find(entry=>place==='host'?entry.closest('#sec-host'):!entry.closest('#sec-host'));
    assert.equal(entry.getAttribute('tabindex'),'0','entry is keyboard reachable');
    w.scrollY=scroll;const length=w.history.length;
    const activate=()=>action==='click'?entry.click():entry.dispatchEvent(new w.KeyboardEvent('keydown',{key:action,bubbles:true,cancelable:true}));
    activate();activate();
    await until(()=>w.document.querySelector('.workplace-page')?.textContent.includes('FIRST JOB'),`${place} ${JSON.stringify(action)} opens dedicated page`);
    assert.equal(w.location.hash,'#/work/job/101/workplace');assert.equal(w.document.querySelector('.cb-sheet-up'),null);
    assert.equal(w.history.length,length+1,'repeat activation creates one destination');
    [...w.document.querySelectorAll('button')].find(x=>x.textContent.includes('求人詳細に戻る')).click();
    await until(()=>w.location.hash==='#/work/job/101' && !w.document.querySelector('.workplace-page'),'same detail returned');
    await until(()=>w.qaScroll.some(args=>(typeof args[0]==='object'?args[0].top:args[1])===scroll),`${place} source scroll restored`);
    assert.equal(w.history.length,length+1,'back button does not append a detail entry');
    w.history.forward();await until(()=>!!w.document.querySelector('.workplace-page'),'browser forward reopens dedicated page');
    w.history.back();await until(()=>!w.document.querySelector('.workplace-page')&&w.location.hash==='#/work/job/101','browser back returns same detail');
    await until(()=>w.scrollY===scroll,'browser back restores source position');
    w.history.forward();await until(()=>!!w.document.querySelector('.workplace-page'),'forward again');
   }
  }
  w.location.hash='/work/job/202/workplace';await until(()=>typeof releaseProfile==='function','second profile request');
  assert.doesNotMatch(w.document.querySelector('.workplace-page').textContent,/FIRST JOB/);
  w.location.hash='/work/job/101/workplace';await until(()=>w.document.querySelector('.workplace-page')?.textContent.includes('FIRST JOB'),'return first job');
  releaseProfile();await pause(40);assert.doesNotMatch(w.document.querySelector('.workplace-page').textContent,/SECOND JOB/);
  w.location.hash='/work/job/303/workplace';await until(()=>w.document.querySelector('[role="alert"]'),'profile error distinct');assert.doesNotMatch(w.document.querySelector('.workplace-page').textContent,/FIRST JOB|職場紹介はまだ登録されていません/);
  w=mount('#/work/job/101/workplace');await until(()=>w.document.querySelector('.workplace-page')?.textContent.includes('FIRST JOB'),'direct route ready');
  [...w.document.querySelectorAll('button')].find(x=>x.textContent.includes('求人詳細に戻る')).click();await until(()=>w.location.hash==='#/work/job/101' && !!w.document.querySelector('#sec-host'),'direct return rendered same detail');
  assert.deepEqual(errors,[]);
 }finally{dom?.window.close();await rm(output,{recursive:true,force:true});}
});
