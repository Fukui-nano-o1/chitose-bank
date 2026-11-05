// Approved CI-only Chromium QA. Synthetic records, no accounts, no live requests.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { CSS } from '../src/appStyles.js';

const buildOnly=process.argv.includes('--build-only');
if(!buildOnly && process.env.CI!=='true')throw new Error('Run browser verification in the approved CI runtime.');
const root=fileURLToPath(new URL('../',import.meta.url));
const output=await mkdtemp(path.join(tmpdir(),'profile-structure-browser-'));
const evidence=process.env.CB_EVIDENCE_DIR || path.join(tmpdir(),'profile-structure-evidence');
const origin='https://profile-structure.test';
const results=[];let browser;
try {
 await mkdir(evidence,{recursive:true});
 const bundles={};
 for(const [surface,entry,client] of [
  ['public','workplace-search-entry.jsx','workplace-search-client.js'],
  ['editor','profile-ui-entry.jsx','profile-ui-client.js'],
 ]) {
  const outDir=path.join(output,surface);
  await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
   name:'synthetic-profile-structure',enforce:'pre',resolveId(id){if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures',client);},
  },react()],build:{outDir,lib:{entry:path.join(root,'scripts/fixtures',entry),name:'ProfileStructureQA',formats:['iife'],fileName:'fixture'},minify:false}});
  bundles[surface]={script:await readFile(path.join(outDir,'fixture.iife.js'),'utf8'),css:await readFile(path.join(outDir,'fixture.css'),'utf8').catch(()=> '')};
 }
 if(buildOnly){console.log('Public and owner fixture bundles built successfully; browser assertions were not run.');}
 else {
  const baseCss=await readFile(path.join(root,'src/index.css'),'utf8');
  const fontDirectory=path.join(root,'public/fonts');
  const fonts=new Map(await Promise.all((await readdir(fontDirectory)).map(async name=>[name,await readFile(path.join(fontDirectory,name))])));
  assert.match(process.env.CB_HEAD_SHA || '',/^[a-f0-9]{40}$/,'CI evidence requires exact PR head SHA');
  browser=await chromium.launch({headless:true});
  for(const width of [375,1440]) for(const scenario of [{surface:'public',mode:'ready'},{surface:'public',mode:'error'},{surface:'editor',mode:'ready'}]) {
   const {surface,mode}=scenario;
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
   const bundle=bundles[surface],errors=[],unexpected=[];
   await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin){unexpected.push(url.origin+url.pathname);return route.abort();}
    if(url.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fonts/fonts.css"><style>'+baseCss+'\n'+CSS+'\n'+bundle.css+'\nbody{margin:0;background:white}main{max-width:'+(surface==='editor'?680:1200)+'px;margin:0 auto;padding:16px 20px 100px;box-sizing:border-box}</style><main><div id="root"></div></main><script src="/fixture.js"></script>'});
    if(url.pathname==='/favicon.ico')return route.fulfill({status:204,body:''});
    if(url.pathname==='/fixture.js')return route.fulfill({contentType:'text/javascript',body:bundle.script});
    if(url.pathname.startsWith('/fonts/')&&fonts.has(path.basename(url.pathname)))return route.fulfill({contentType:url.pathname.endsWith('.css')?'text/css':'font/woff2',body:fonts.get(path.basename(url.pathname))});
    unexpected.push(url.pathname);return route.abort();
   });
   await context.addInitScript(({surface,mode})=>{
    Object.assign(window,{qaSurface:'employer',qaOptions:{},qaSaved:[],qaAlerts:[]});
    window.alert=message=>qaAlerts.push(message);
    const json=(data,status=200)=>Promise.resolve(new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}}));
    const owner='11111111-1111-4111-8111-111111111111';
    window.qaWorkplaceRequest=(url)=>{
     if(mode==='error' && (url.endsWith('/job_employer_profile')||url.endsWith('/job_workplace')))return json({message:'synthetic unavailable'},503);
     if(url.includes('/workplace-photos/'))return Promise.resolve(new Response('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480"><rect width="720" height="480" fill="#DCE9D5"/><path d="M0 340 Q180 180 360 290 T720 250 V480 H0Z" fill="#8EAC85"/><text x="40" y="80" font-size="28">合成の職場写真</text></svg>',{headers:{'Content-Type':'image/svg+xml'}}));
     if(url.endsWith('/job_employer_profile'))return json([{nickname:'合成農園',
      unique_point:'概要の回答',intro_crops:'作物の回答',intro_atmosphere:'環境の回答',chat_style:'calm',
      interaction_style:'together',teaching_style:'show_first',question_style:'anytime',always_do:'初日の回答',break_style:'休憩の回答',
      has_parking:true,has_transport:true,employer_pays_supplies:true,
      owner_comment:'代表のあいさつ',intro_path:'代表の経歴',intro_joy:'代表の楽しみ',intro_message:'代表の歓迎',
      texts_pending:{unique_point:'PENDING_SECRET'},
     }]);
     if(url.endsWith('/job_workplace'))return json({photos:[{id:'a'.repeat(64),path:owner+'/'+'a'.repeat(64)+'.jpg'}]});
     if(url.endsWith('/job_employer_trust_info'))return json({ok:true,member_since:'2026年04月'});
     return new Promise(()=>{});
    };
    if(surface==='public') {
     const job={id:101,crop:'ブロッコリー',task:'収穫',employerName:'合成農園',beginnerOk:true,region:'合成市',cityArea:'合成市',dateLabel:'2099-11-10',dateStartRaw:'2099-11-10',dateEndRaw:'2099-11-10',dateStart:'2099-11-10',dateEnd:'2099-11-10',workTime:'08:00〜12:00',payType:'daily',pay:5000,count:'1名',headcount:1,closed:false,filled:false,expired:false,hiredCount:0,photos:[],holidays:[],maskedFields:[],dangerPlaces:[],dangerTasks:[]};
     localStorage.setItem('cb_viewCache_v2_anon',JSON.stringify({'search:jobs':[job]}));
    }
   },{surface,mode});
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   const screenshot=async label=>{
    await page.evaluate(async()=>{
     await document.fonts.ready;
     // reducedMotion does not turn off the existing sheet's cbPop/fadeIn rules.
     // Observe natural completion rather than capture translucent intermediate UI.
     const finite=document.getAnimations().filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime));
     await Promise.all(finite.map(animation=>animation.finished.catch(()=>{})));
     await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    });
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${surface} ${width}px horizontal overflow`);
    const sheet=page.locator('.cb-sheet-up').last();
    const modal=await sheet.count()>0;
    if(modal) {
     const settled=await sheet.evaluate(el=>{
      const ancestors=[];
      for(let node=el;node;node=node.parentElement)ancestors.push({tag:node.tagName,opacity:Number(getComputedStyle(node).opacity)});
      const style=getComputedStyle(el),rect=el.getBoundingClientRect();
      const foreground=[.2,.5,.8].every(x=>[.2,.5,.8].every(y=>{
       const hit=document.elementFromPoint(rect.left+rect.width*x,rect.top+rect.height*y);
       return hit && el.contains(hit);
      }));
      return {ancestors,background:style.backgroundColor,foreground,
       running:el.getAnimations({subtree:true}).filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime)&&animation.playState==='running').length,
       scrollable:el.scrollHeight>el.clientHeight+2};
     });
     assert.ok(settled.ancestors.every(node=>node.opacity===1),'sheet and all ancestors must be fully opaque after animation');
     assert.equal(settled.background,'rgb(255, 255, 255)','sheet has opaque white background');
     assert.equal(settled.running,0,'finite sheet animations finished');
     assert.equal(settled.foreground,true,'sheet owns hit targets instead of underlying page');
     await sheet.evaluate(el=>{el.scrollTop=0;});
     await page.screenshot({path:path.join(evidence,`${surface}-${width}-${mode}-${label}.png`),fullPage:false,animations:'disabled'});
     if(settled.scrollable) {
      await sheet.evaluate(el=>{el.scrollTop=el.scrollHeight;});
      await page.screenshot({path:path.join(evidence,`${surface}-${width}-${mode}-${label}-bottom.png`),fullPage:false,animations:'disabled'});
      await sheet.evaluate(el=>{el.scrollTop=0;});
     }
     results.push({surface,mode,width,evidence:label,settled});
    } else {
     await page.screenshot({path:path.join(evidence,`${surface}-${width}-${mode}-${label}.png`),fullPage:true,animations:'disabled'});
    }
   };
   try {
    if(surface==='public') {
     await page.goto(origin+'/#/work/job/101');
     const workplaceButton=page.getByRole('button',{name:'職場紹介を詳しく見る'});
     if(mode==='error') {
      const section=page.locator('#sec-workplace');
      await section.getByText(/読み込めませんでした/).waitFor();
      assert.doesNotMatch(await section.innerText(),/まだ登録されていません/);
      await section.scrollIntoViewIfNeeded();await screenshot('detail-error');
      await workplaceButton.click();
      await page.locator('.workplace-page').getByText('職場紹介を読み込めませんでした。求人詳細に戻って、もう一度お試しください。',{exact:true}).waitFor();
      assert.doesNotMatch(await page.locator('.workplace-page').innerText(),/職場紹介はまだ登録されていません/);
      await screenshot('workplace-error');
      await page.getByRole('button',{name:'求人詳細に戻る'}).click();await workplaceButton.waitFor();
      assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
      results.push({surface,mode,width,result:'passed'});continue;
     }
     await workplaceButton.click();await page.locator('.workplace-page').waitFor();
     await page.locator('[data-workplace-photo="ready"]').waitFor();
     const workplace=page.locator('.workplace-page');
     assert.deepEqual(await workplace.locator('h2').allTextContents(),['職場の写真','職場の概要','働く環境','設備・サポート','教え方・関わり方','働く前に知っておきたいこと']);
     const copy=await workplace.innerText();
     for(const answer of ['概要の回答','作物の回答','環境の回答','初日の回答','休憩の回答'])assert.equal(copy.split(answer).length-1,1);
     assert.doesNotMatch(copy,/代表の経歴|代表の歓迎|PENDING_SECRET/);
     await screenshot('workplace');
     await page.getByRole('button',{name:'求人詳細に戻る'}).click();await workplaceButton.waitFor();
     await page.goForward();await workplace.waitFor();await page.goBack();await workplaceButton.waitFor();
     const host=page.getByRole('button',{name:'代表について見る',exact:true});await host.press('Enter');
     const person=page.locator('.cb-sheet-up');await person.getByRole('heading',{name:'代表について',exact:true}).waitFor();
     const personCopy=await person.innerText();
     for(const answer of ['代表のあいさつ','代表の経歴','代表の楽しみ','代表の歓迎'])assert.equal(personCopy.split(answer).length-1,1);
     assert.doesNotMatch(personCopy,/概要の回答|作物の回答|環境の回答|初日の回答|休憩の回答|PENDING_SECRET/);
     await screenshot('representative');
     await person.getByRole('button',{name:'求人詳細に戻る'}).click();await person.waitFor({state:'detached'});
     for(const destination of ['/search','/work/job/101/workplace']) {
      await host.click();await person.waitFor();
      await page.evaluate(destination=>{location.hash=destination;},destination);
      await person.waitFor({state:'detached'});
      await page.goBack();await host.waitFor();assert.equal(await person.count(),0);
      await page.goForward();await page.waitForURL(origin+'/#'+destination);assert.equal(await person.count(),0);
      await page.goBack();await host.waitFor();assert.equal(await person.count(),0);
     }
    } else {
     await page.goto(origin+'/#/profile/employer/profile');
     const rows=page.locator('[data-guide="profile-rows"]');await rows.waitFor();
     const copy=await rows.innerText();assert.match(copy,/職場について/);assert.match(copy,/代表について/);assert.doesNotMatch(copy,/問いかけ|代表より/);
     await screenshot('groups');
     const expected={overview:['unique_point','intro_crops'],environment:['intro_atmosphere'],practical:['always_do','break_style'],representative:['owner_comment','intro_path','intro_joy','intro_message']};
     for(const [section,keys] of Object.entries(expected)) {
      await page.evaluate(section=>{location.hash='/profile/employer/profile/'+section;},section);
      await page.locator('#employer-'+keys[0]).waitFor();
      assert.deepEqual(await page.locator('textarea').evaluateAll(nodes=>nodes.map(node=>node.id.replace('employer-',''))),keys);
      await screenshot(section);
      await page.goBack();await rows.waitFor();
     }
     await page.evaluate(()=>Object.assign(qaProfile.state.rows.employer_profiles,{
      unique_point:'概要の回答',intro_crops:'作物の回答',intro_atmosphere:'環境の回答',always_do:'初日の回答',break_style:'休憩の回答',
      owner_comment:'代表のあいさつ',intro_path:'代表の経歴',intro_joy:'代表の楽しみ',intro_message:'代表の歓迎',
     }));
     await page.getByRole('button',{name:'プレビュー',exact:true}).click();
     const place=page.getByLabel('職場についてのプレビュー'),person=page.getByLabel('代表についてのプレビュー');
     await place.waitFor();await person.waitFor();
     assert.doesNotMatch(await place.innerText(),/代表の経歴|代表の歓迎/);assert.doesNotMatch(await person.innerText(),/作物の回答|初日の回答/);
     const preview=await page.locator('.cb-preview-overlay').innerText();
     for(const answer of ['概要の回答','作物の回答','環境の回答','初日の回答','休憩の回答','代表のあいさつ','代表の経歴','代表の楽しみ','代表の歓迎'])assert.equal(preview.split(answer).length-1,1);
     await screenshot('preview');
     assert.equal(await page.evaluate(()=>qaProfile.state.writes),0,'read-only owner QA performs no writes');
     assert.deepEqual(await page.evaluate(()=>qaAlerts),[]);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
    results.push({surface,mode,width,result:'passed'});
   } catch(error) {
    await page.screenshot({path:path.join(evidence,`${surface}-${width}-${mode}-failure.png`),fullPage:true}).catch(()=>{});
    results.push({surface,mode,width,result:'failed',error:String(error),pageErrors:errors,unexpectedRequests:unexpected});throw error;
   } finally {await context.close();}
  }
 }
} finally {
 await writeFile(path.join(evidence,'results.json'),JSON.stringify({testedMergeCommit:process.env.GITHUB_SHA,headCommit:process.env.CB_HEAD_SHA,buildOnly,cases:results},null,2));
 await browser?.close();await rm(output,{recursive:true,force:true});
}
console.log(JSON.stringify(results));
