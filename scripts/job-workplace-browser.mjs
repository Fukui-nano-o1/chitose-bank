// Actual Chromium verification in CI only. Every record and image is synthetic;
// the network is intercepted and no production credentials or services are used.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {CSS} from '../src/appStyles.js';

if (process.env.CI !== 'true') throw new Error('Run this browser verification in the approved CI runtime.');
const root=fileURLToPath(new URL('../',import.meta.url));
const output=await mkdtemp(path.join(tmpdir(),'workplace-browser-'));
const evidence=process.env.CB_EVIDENCE_DIR || path.join(tmpdir(),'workplace-browser-evidence');
const origin='https://workplace-browser.test';
const results=[];
let browser;
try {
 await mkdir(evidence,{recursive:true});
 await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
  name:'workplace-browser-fixture',enforce:'pre',resolveId(id){
   if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/workplace-search-client.js');
  },
 },react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/workplace-search-entry.jsx'),name:'WorkplaceBrowserQA',formats:['iife'],fileName:'fixture'},minify:false}});
 const script=await readFile(path.join(output,'fixture.iife.js'),'utf8');
 const css=await readFile(path.join(output,'fixture.css'),'utf8');
 const baseCss=await readFile(path.join(root,'src/index.css'),'utf8');
 const fontDirectory=path.join(root,'public/fonts');
 const fontAssets=new Map(await Promise.all((await readdir(fontDirectory)).map(async name=>[name,await readFile(path.join(fontDirectory,name))])));
 browser=await chromium.launch({headless:true});
 const cases=[{width:320,mode:'ready',count:4},{width:390,mode:'ready',count:4},{width:768,mode:'ready',count:4},{width:1280,mode:'ready',count:4},{width:390,mode:'one',count:1},{width:390,mode:'two',count:2},{width:390,mode:'empty',count:0},{width:390,mode:'error',count:0}];
 for(const scenario of cases){
  const {width,mode,count}=scenario;
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin)return route.abort();
   if(url.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fonts/fonts.css"><style>'+baseCss+'\n'+CSS+'\n'+css+'\nbody{margin:0;font-family:Arial,"Noto Sans CJK JP",sans-serif;background:white;}</style><main style="max-width:1200px;margin:0 auto;padding:16px 24px 72px;min-height:100svh;box-sizing:border-box"><div id="root"></div></main><script src="/fixture.js"></script>'});
   if(url.pathname==='/fixture.js')return route.fulfill({contentType:'text/javascript; charset=utf-8',body:script});
   if(url.pathname.startsWith('/fonts/')&&fontAssets.has(path.basename(url.pathname)))return route.fulfill({contentType:url.pathname.endsWith('.css')?'text/css':'font/woff2',body:fontAssets.get(path.basename(url.pathname))});
   return route.abort();
  });
  await context.addInitScript(({mode,count})=>{
   const json=(data,status=200)=>Promise.resolve(new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}}));
   const owner='11111111-1111-4111-8111-111111111111';
   const photos=['a','b','c','d'].slice(0,count).map(hex=>({id:hex.repeat(64),path:`${owner}/${hex.repeat(64)}.jpg`}));
   window.qaWorkplaceRequest=(url)=>{
    if(url.includes('/workplace-photos/')){
     const tone={a:'#DCE9D5',b:'#E9DDC7',c:'#D7E5EC',d:'#F0DFC9'}[url.split('/').pop()[0]] || '#e6eee6';
     return Promise.resolve(new Response('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480"><rect width="720" height="480" fill="'+tone+'"/><path d="M0 340 Q180 180 360 290 T720 250 V480 H0Z" fill="#8EAC85"/><path d="M0 400 Q240 270 440 380 T720 300" fill="none" stroke="#5B8357" stroke-width="30"/><text x="360" y="120" text-anchor="middle" fill="#38513D" font-size="28" font-family="sans-serif">合成の職場写真</text></svg>',{headers:{'Content-Type':'image/svg+xml'}}));
    }
    if(url.endsWith('/job_employer_profile'))return mode==='error'?json({message:'synthetic unavailable'},503):json([{nickname:'合成農園',intro_atmosphere:mode==='empty'?'':'畑では声をかけ合いながら、それぞれのペースを大切にしています。はじめての作業は一緒に確認してから。休憩時間は木陰でゆっくり過ごせます。'.repeat(3),recruiter_contact:'PRIVATE CONTACT',recruiter_address:'PRIVATE ADDRESS',texts_pending:{intro_atmosphere:'PENDING COPY'}}]);
    if(url.endsWith('/job_workplace'))return mode==='error'?json({message:'synthetic unavailable'},503):json({photos});
    if(url.endsWith('/job_employer_trust_info'))return json({ok:true,member_since:'2026年04月'});
    return new Promise(()=>{});
   };
   const job={id:101,crop:'ブロッコリー',task:'播種',employerName:'合成農園',beginnerOk:true,instantApproveRepeat:true,region:'合成県 合成市',cityArea:'合成市',dateLabel:'2099-11-10',dateStartRaw:'2099-11-10',dateEndRaw:'2099-11-10',dateStart:'2099-11-10',dateEnd:'2099-11-10',workTime:'10:00〜12:00',payType:'daily',pay:2500,count:'1名',headcount:1,jobBody:'合成データの仕事説明です。',closed:false,filled:false,expired:false,hiredCount:0,isNew:false,photos:[],holidays:[],maskedFields:[],dangerPlaces:[],dangerTasks:[]};
   localStorage.setItem('cb_viewCache_v2_anon',JSON.stringify({'search:jobs':[job]}));
  },{mode,count});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  try {
   await page.goto(`${origin}/#/work/job/101`);
   const section=page.locator('#sec-workplace');await section.waitFor();
   if(count)await page.waitForFunction(count=>document.querySelectorAll('#sec-workplace [data-workplace-photo="ready"]').length===Math.min(3,count),count);
   else await section.getByText(mode==='error'?/読み込めませんでした/:/まだ登録されていません/).waitFor();
   await section.evaluate(el=>window.scrollTo(0,Math.max(0,el.previousElementSibling.getBoundingClientRect().top+window.scrollY-30)));
   await page.evaluate(()=>document.fonts.ready);
   await page.waitForTimeout(350);
   const metrics=await section.evaluate(el=>({before:el.previousElementSibling.textContent,after:el.nextElementSibling.textContent,width:el.getBoundingClientRect().width,viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,photoCount:el.querySelectorAll('img').length,summaryHeight:el.querySelector('.job-workplace-summary')?.getBoundingClientRect().height || 0,buttonHeight:el.querySelector('.job-workplace-more').getBoundingClientRect().height}));
   assert.match(metrics.before,/募集主/);assert.match(metrics.after,/初心者大歓迎/);
   assert.ok(metrics.scrollWidth<=width+1,`horizontal overflow at ${width}px`);
   assert.ok(metrics.width<=width,`section exceeds viewport ${width}px`);assert.ok(metrics.buttonHeight>=44,'touch target');
   assert.equal(metrics.photoCount,Math.min(3,count));assert.ok(metrics.summaryHeight<=82,'long intro is clamped to three lines');
   assert.doesNotMatch(await section.innerText(),/PRIVATE|PENDING COPY/);
   await page.screenshot({path:path.join(evidence,`workplace-${width}-${mode}.png`)});
   if(width===390&&mode==='ready'){
    const sourceY=await page.evaluate(()=>scrollY);
    const button=section.getByRole('button',{name:'職場紹介を詳しく見る'});
    await button.press('Enter');await page.locator('.workplace-page').waitFor();
    assert.equal(page.url(),`${origin}/#/work/job/101/workplace`);
    await page.getByRole('button',{name:'求人詳細に戻る'}).click();await section.waitFor();
    await page.waitForFunction(y=>Math.abs(scrollY-y)<=2,sourceY);
    await page.goForward();await page.locator('.workplace-page').waitFor();
    await page.goBack();await section.waitFor();
    await page.waitForFunction(y=>Math.abs(scrollY-y)<=2,sourceY);
    await section.getByRole('button',{name:'職場の写真をすべて見る'}).click();await page.locator('.workplace-page').waitFor();
    await page.getByRole('button',{name:'求人詳細に戻る'}).click();await section.waitFor();
   }
   assert.deepEqual(errors,[]);
   results.push({...scenario,metrics,result:'passed'});
  }catch(error){await page.screenshot({path:path.join(evidence,`failure-${width}-${mode}.png`)});throw error;}
  finally{await context.close();}
 }
 await writeFile(path.join(evidence,'results.json'),JSON.stringify({testedMergeCommit:process.env.GITHUB_SHA,headCommit:process.env.CB_HEAD_SHA,cases:results},null,2));
 console.log(JSON.stringify(results,null,2));
}finally{await browser?.close();await rm(output,{recursive:true,force:true});}
