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
const job=id=>({id,crop:`合成作物${id}`,task:'収穫',employerName:`合成募集主${id}`,beginnerOk:true,instantApproveRepeat:true,experiencedPreferred:true,region:'合成市',cityArea:'合成市',dateLabel:'2099-11-02',dateStartRaw:'2099-11-02',dateEndRaw:'2099-11-02',dateStart:'2099-11-02',dateEnd:'2099-11-02',workTime:'08:00〜17:00',payType:'daily',pay:10000,count:'2名',headcount:2,closed:false,filled:false,expired:false,hiredCount:0,isNew:false,photos:[],holidays:[],maskedFields:[],dangerPlaces:[],dangerTasks:[]});

test('real job search owns dedicated workplace entry, direct routes, same-job return and profile isolation',async()=>{
 const output=await mkdtemp(path.join(tmpdir(),'cb-workplace-search-'));let dom;
 try{
  await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'workplace-search-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/workplace-search-client.js');}},react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/workplace-search-entry.jsx'),name:'WorkplaceSearchQA',formats:['iife'],fileName:'fixture'},minify:false}});
  const script=await readFile(path.join(output,'fixture.iife.js'),'utf8');
  const errors=[];let releaseProfile,releasePhotos;
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
     if(body.p_job_number===404)return json([{nickname:'合成募集主404'}]);
     return json([{nickname:'合成募集主101',intro_atmosphere:'FIRST JOB'}]);
    }
    if(url.endsWith('/job_employer_trust_info'))return json(null);
    if(url.endsWith('/job_workplace')){
     if(body.p_job_number===202)return new Promise(resolve=>{releasePhotos=()=>resolve(new Response(JSON.stringify({photos:[{path:'11111111-1111-4111-8111-111111111111/'+'a'.repeat(64)+'.jpg'}]}),{headers:{'Content-Type':'application/json'}}));});
     return json({photos:[]});
    }
    return new Promise(()=>{});
   };
   w.localStorage.setItem('cb_viewCache_v2_anon',JSON.stringify({'search:jobs':[job(101),job(202),job(303),job(404)]}));
   w.eval(script);return w;
  }
  let w;
  for (const [place, scroll] of [['top',120],['intro',250],['host',680]]) {
   for (const action of place==='intro'?['click']:['click','Enter',' ']) {
    w=mount('#/work/job/101');
    await until(()=>w.document.querySelectorAll('[aria-label="職場紹介を見る"]').length===2,'both existing employer entries');
    const entries=[...w.document.querySelectorAll('[aria-label="職場紹介を見る"]')];
    assert.equal(entries.filter(entry=>entry.closest('#sec-host')).length,1,'one lower 募集主について entry');
    assert.equal(entries.filter(entry=>!entry.closest('#sec-host')).length,1,'one existing top employer entry');
    const entry=place==='intro' ? w.document.querySelector('.job-workplace-more') : entries.find(entry=>place==='host'?entry.closest('#sec-host'):!entry.closest('#sec-host'));
    if(place==='intro') {
     assert.equal(entry.tagName,'BUTTON','new entry has native keyboard activation');
     const section=w.document.querySelector('#sec-workplace');
     assert.match(section.previousElementSibling.textContent,/募集主/);
     assert.match(section.nextElementSibling.textContent,/経験者優遇/);
    } else assert.equal(entry.getAttribute('tabindex'),'0','entry is keyboard reachable');
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
  releaseProfile();releasePhotos();await pause(40);assert.doesNotMatch(w.document.querySelector('.workplace-page').textContent,/SECOND JOB/);
  w.location.hash='/work/job/303/workplace';await until(()=>w.document.querySelector('[role="alert"]'),'profile error distinct');assert.doesNotMatch(w.document.querySelector('.workplace-page').textContent,/FIRST JOB|職場紹介はまだ登録されていません/);
  w=mount('#/work/job/101/workplace');await until(()=>w.document.querySelector('.workplace-page')?.textContent.includes('FIRST JOB'),'direct route ready');
  [...w.document.querySelectorAll('button')].find(x=>x.textContent.includes('求人詳細に戻る')).click();await until(()=>w.location.hash==='#/work/job/101' && !!w.document.querySelector('#sec-host'),'direct return rendered same detail');
  w=mount('#/work/job/101');
  const preview=()=>w.document.querySelector('#sec-workplace');
  await until(()=>preview()?.textContent.includes('FIRST JOB'),'detail preview profile ready');
  releaseProfile=null;releasePhotos=null;
  w.location.hash='/work/job/202';await until(()=>preview()?.textContent.includes('読み込んでいます')&&!preview()?.textContent.includes('FIRST JOB'),'new detail hides old text');
  await until(()=>typeof releaseProfile==='function'&&typeof releasePhotos==='function','second detail reads in flight');
  w.location.hash='/work/job/101';await until(()=>preview()?.textContent.includes('FIRST JOB'),'first detail restored');
  releaseProfile();releasePhotos();await pause(40);
  assert.doesNotMatch(preview().textContent,/SECOND JOB/);assert.equal(preview().querySelector('img'),null,'stale photo list is ignored');
  w.qaRenderSearch({id:'11111111-1111-4111-8111-111111111111'});
  assert.doesNotMatch(preview().textContent,/FIRST JOB/,'account change hides the previous profile immediately');
  await until(()=>preview()?.textContent.includes('FIRST JOB'),'new account request resolves');
  w.qaRenderSearch(null);
  assert.doesNotMatch(preview().textContent,/FIRST JOB/,'sign-out hides the previous profile immediately');
  await until(()=>preview()?.textContent.includes('FIRST JOB'),'anonymous request resolves again');
  assert.match(w.document.querySelector('.job-secnav').textContent,/職場紹介/,'populated section is in the desktop navigation');
  w.location.hash='/work/job/404';
  await until(()=>w.document.querySelector('#sec-host')?.textContent.includes('合成募集主404')&&!preview(),'empty workplace hides its detail section');
  assert.equal(w.document.querySelector('.job-workplace-more'),null);
  await until(()=>!w.document.querySelector('.job-secnav')?.textContent.includes('職場紹介'),'no stale desktop navigation link');
  const emptyHost=w.document.querySelector('[aria-label="職場紹介を見る"]');
  assert.match(emptyHost.closest('.cb-reveal').nextElementSibling.textContent,/経験者優遇/,'no empty divider remains');
  emptyHost.click();await until(()=>w.document.querySelector('.workplace-page')?.textContent.includes('職場紹介はまだ登録されていません'),'existing host entry still opens the workplace page');
  [...w.document.querySelectorAll('button')].find(x=>x.textContent.includes('求人詳細に戻る')).click();
  await until(()=>w.location.hash==='#/work/job/404'&&!w.document.querySelector('.workplace-page'),'return from empty workplace');
  assert.equal(preview(),null,'empty section stays hidden on return');
  w.location.hash='/work/job/101';
  await until(()=>preview()?.textContent.includes('FIRST JOB')&&w.document.querySelector('.job-secnav')?.textContent.includes('職場紹介'),'switching back restores the introduction and its navigation link');
  assert.deepEqual(errors,[]);
 }finally{dom?.window.close();await rm(output,{recursive:true,force:true});}
});
