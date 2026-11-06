// Synthetic Chromium release gate. Every network request is intercepted or aborted.
// Run locally or in the dedicated GitHub browser workflow.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { jobInputSample } from './fixtures/job-input.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(path.join(tmpdir(), 'retired-flags-browser-'));
const evidence = process.env.CB_EVIDENCE_DIR || path.join(tmpdir(), 'retired-flags-browser-evidence');
let browser;
try {
  await mkdir(evidence, { recursive: true });
  await build({ configFile:false, root, logLevel:'error', define:{'process.env.NODE_ENV':'"production"'}, plugins:[{
    name:'isolated-listing-fixture', enforce:'pre', resolveId(id) {
      if (/(?:^|\/)supabase(?:\.js)?$/.test(id)||/(?:jobCreateGeo|lib\/zipLookup)(?:\.js)?$/.test(id)) return path.join(root,'scripts/fixtures/offline/client.js');
    },
  }, react()], build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/listing-basics-browser-entry.jsx'),name:'ListingBasicsQA',formats:['iife'],fileName:'fixture'},minify:false}});
  const css = (await readdir(output)).filter(f => f.endsWith('.css'));
  const html = `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(f=>`<link rel="stylesheet" href="/${f}">`).join('')}</head><body><div id="root"></div><script src="/fixture.iife.js"></script></body></html>`;
  const assets = new Map([['/', { data: html, mime:'text/html; charset=utf-8' }]]);
  for (const file of [...css,'fixture.iife.js']) assets.set(`/${file}`,{data:await readFile(path.join(output,file)),mime:file.endsWith('.css')?'text/css':'text/javascript'});
  const surfaceOut=path.join(output,'surfaces');
  await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
    name:'surface-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)lib\/supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/listing-photo-client.js');}
  },react()],build:{outDir:surfaceOut,lib:{entry:path.join(root,'scripts/fixtures/retired-flags-browser-entry.jsx'),name:'FlagsSurfacesQA',formats:['iife'],fileName:'surfaces'},minify:false}});
  const surfaceAssets=new Map();const surfaceCss=(await readdir(surfaceOut)).filter(f=>f.endsWith('.css'));
  surfaceAssets.set('/',{data:`<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${surfaceCss.map(f=>`<link rel="stylesheet" href="/${f}">`).join('')}</head><body><div id="root"></div><script src="/surfaces.iife.js"></script></body></html>`,mime:'text/html; charset=utf-8'});
  for(const file of [...surfaceCss,'surfaces.iife.js'])surfaceAssets.set(`/${file}`,{data:await readFile(path.join(surfaceOut,file)),mime:file.endsWith('.css')?'text/css':'text/javascript'});
  const origin='https://example.org'; // Intercepted fixture origin; never sent to the network.
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
  const topics=['worker_preferences','review'];
  const results=[];
  for (const viewport of [{width:360,height:640},{width:390,height:844},{width:1440,height:900}]) {
    const context=await browser.newContext({viewport,locale:'ja-JP',timezoneId:'Asia/Tokyo',isMobile:viewport.width<500,hasTouch:viewport.width<500,serviceWorkers:'block'});
    const errors=[];
    await context.route('**/*',route=>{const url=new URL(route.request().url());const item=url.origin===origin && assets.get(url.pathname);return item?route.fulfill({status:200,contentType:item.mime,body:item.data}):route.abort();});
    await context.addInitScript(() => {
      window.qaOffline=false;window.qaConsent=true;window.qaMinimumWage=1100;
      if (!localStorage.getItem('listing-basics-test-seeded')) {
        window.qaListingForm={role:'farmer',farmerStep:2,farmerCropPill:'ブロッコリー',farmerTaskPill:'収穫',farmerPurpose:'post',
          farmerZip:'7793401',farmerPref:'徳島県',farmerCity:'吉野川市',farmerTown:'山川町',farmerAddr:'123番地',
          jobDateStart:'2099-11-01',jobDateEnd:null,jobHolidays:[],jobCount:'3',dailyWageInput:'10000',breakTime:'60分',
          startHour:'8',startMinute:'00',endHour:'16',endMinute:'00',overtimePolicy:'なし',overtimeDetail:'1時間程度',jobDescription:'保存する入力',
          taskChangeScope:'変更なし',placeChangeScope:'変更なし',nearestStation:'山瀬',commuteTime:'車10分以内',workVideoUrl:'',beginnerOk:true,instantApproveRepeat:true,experiencedPreferred:true,listingPageId:'repeat_approval',listingNavVersion:'2026-10-26-stage5'};
        localStorage.setItem('listing-basics-test-seeded','1');
      }
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${origin}/#/work/new/page/repeat_approval`);
    await page.locator('[data-step-id="worker_preferences"]').waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(),/初心者大歓迎|リピート即決|リピーターの自動承認|また呼びたい即決/);
    for (const id of topics) {
      await page.evaluate(id=>{location.hash=`/work/new/page/${id}`;},id);
      await page.locator(`[data-step-id="${id}"]`).waitFor();
      await page.waitForTimeout(180);
      const overflow=await page.evaluate(()=>({document:document.documentElement.scrollWidth>innerWidth+1,fields:[...document.querySelectorAll('[data-step-id] input,[data-step-id] select,[data-step-id] textarea')].filter(el=>{const r=el.getBoundingClientRect();return r.width && (r.left < -1 || r.right > innerWidth+1);}).map(el=>el.id||el.getAttribute('aria-label'))}));
      assert.equal(overflow.document,false,`${viewport.width}/${id}: document overflow`);
      assert.deepEqual(overflow.fields,[],`${viewport.width}/${id}: fields overflow`);
      const footer=await page.locator('.listing-footer').boundingBox();
      assert.ok(footer && footer.y>=0 && footer.y+footer.height<=viewport.height+1,`${id}: visible footer`);
      if(id!=='review'){await page.waitForFunction(()=>{const next=document.querySelector('.listing-next');return next && !next.disabled;});}
      await page.screenshot({path:path.join(evidence,`${viewport.width}-${id}.png`)});
      await page.reload();await page.locator(`[data-step-id="${id}"]`).waitFor();
      const values=await page.evaluate(()=>window.qaDrafts.listDeviceDrafts('00000000-0000-4000-8000-000000000001')[0]?.form);
      assert.equal(values.beginnerOk,true);assert.equal(values.instantApproveRepeat,true);assert.doesNotMatch(await page.locator('body').innerText(),/初心者大歓迎|リピート即決|リピーターの自動承認|また呼びたい即決/);assert.equal(values.jobCount,'3');assert.equal(values.dailyWageInput,'10000');assert.equal(values.nearestStation,'山瀬');
      results.push({width:viewport.width,page:id,overflow:false,reload:true});
    }
    await page.evaluate(()=>{location.hash='/work/new/page/worker_preferences';});await page.locator('[data-step-id="worker_preferences"]').waitFor();
    await page.locator('.listing-next').click();await page.locator('[data-step-id="review"]').waitFor();
    await page.goBack();await page.locator('[data-step-id="worker_preferences"]').waitFor();
    await page.reload();await page.locator('[data-step-id="worker_preferences"]').waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(),/初心者大歓迎|リピート即決|リピーターの自動承認|また呼びたい即決/);
    assert.deepEqual(errors,[],`${viewport.width}: page errors`);
    await context.close();
    const surfaceContext=await browser.newContext({viewport,locale:'ja-JP',serviceWorkers:'block'});
    await surfaceContext.route('**/*',route=>{const url=new URL(route.request().url());const item=url.origin===origin&&surfaceAssets.get(url.pathname);return item?route.fulfill({status:200,contentType:item.mime,body:item.data}):route.abort();});
    await surfaceContext.addInitScript(()=>{window.qaPhotoClient={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{}}};});
    const surface=await surfaceContext.newPage();surface.on('pageerror',e=>errors.push(e.message));
    await surface.goto(origin);await surface.waitForFunction(()=>typeof window.qaRenderRetiredFlags==='function');
    for(const expert of [false,true]){
      await surface.evaluate(expert=>window.qaRenderRetiredFlags(expert),expert);
      assert.doesNotMatch(await surface.locator('body').innerText(),/初心者大歓迎|リピート即決|リピーターの自動承認|また呼びたい即決/);
      assert.equal(await surface.locator('.job-card-conditions').count(),expert?1:0);
      await surface.screenshot({path:path.join(evidence,`${viewport.width}-card-detail-${expert?'expert':'no-flags'}.png`),fullPage:true});
      results.push({width:viewport.width,scenario:'card-and-highlights',expert,retiredTrueFlagsHidden:true});
    }
    assert.deepEqual(errors,[],`${viewport.width}/card: page errors`);await surfaceContext.close();
    // Existing draft and copied draft both enter the real edit path with stored true flags.
    for (const scenario of ['edit','copy']) {
      const row={...jobInputSample(),id:'00000000-0000-4000-8000-000000000044',job_number:42,
        farmer_id:'00000000-0000-4000-8000-000000000001',status:'draft',draft_step:12,draft_step_id:null,
        beginner_ok:true,instant_approve_repeat:true,photos:[],danger_places:[],danger_tasks:[],
        work_video_url:'',date_start:'2099-12-01',date_end:null,holidays:[]};
      const editContext=await browser.newContext({viewport,locale:'ja-JP',timezoneId:'Asia/Tokyo',serviceWorkers:'block'});
      await editContext.route('**/*',route=>{const url=new URL(route.request().url());const item=url.origin===origin&&assets.get(url.pathname);return item?route.fulfill({status:200,contentType:item.mime,body:item.data}):route.abort();});
      await editContext.addInitScript(({row,scenario})=>{
        window.qaOffline=false;window.qaConsent=true;window.qaMinimumWage=1100;window.qaJob=row;
        if(scenario==='copy'){
          sessionStorage.setItem('cb_editJobPrefill',JSON.stringify(row));
          sessionStorage.setItem('cb_editJobPresetDates',JSON.stringify({job_number:42,date_start:'2099-12-02',date_end:null,holidays:[]}));
        }
      },{row,scenario});
      const edit=await editContext.newPage();edit.on('pageerror',e=>errors.push(e.message));
      await edit.goto(`${origin}/#/work/edit/42/page/repeat_approval?return=review`);
      await edit.locator('[data-step-id="worker_preferences"]').waitFor();
      await edit.waitForFunction(()=>window.qaDrafts.listDeviceDrafts('00000000-0000-4000-8000-000000000001').some(d=>d.form.beginnerOk&&d.form.instantApproveRepeat));
      assert.doesNotMatch(await edit.locator('body').innerText(),/初心者大歓迎|リピート即決|リピーターの自動承認|また呼びたい即決/);
      await edit.locator('.listing-next').click();await edit.locator('[data-step-id="review"]').waitFor();
      assert.equal(await edit.locator('[data-edit-page="repeat_approval"]').count(),0);
      assert.doesNotMatch(await edit.locator('body').innerText(),/初心者大歓迎|リピート即決|リピーターの自動承認|また呼びたい即決/);
      await edit.screenshot({path:path.join(evidence,`${viewport.width}-${scenario}-detail.png`),fullPage:true});
      await edit.reload();await edit.locator('[data-step-id="review"]').waitFor();
      const values=await edit.evaluate(()=>window.qaDrafts.listDeviceDrafts('00000000-0000-4000-8000-000000000001')[0].form);
      assert.equal(values.beginnerOk,true);assert.equal(values.instantApproveRepeat,true);
      assert.equal(await edit.evaluate(()=>window.qaCalls.some(c=>c.path==='rpc/publish_my_job_with_check')),false);
      results.push({width:viewport.width,scenario,legacyEditRoute:true,detail:true,reload:true,preservedLegacyValues:true});
      assert.deepEqual(errors,[],`${viewport.width}/${scenario}: page errors`);
      await editContext.close();
    }
  }
  await writeFile(path.join(evidence,'results.json'),JSON.stringify({checkedAt:new Date().toISOString(),headSha:process.env.CB_HEAD_SHA||null,engine:'Chromium',checks:results,browserBack:true,preservedLegacyValues:true,retiredDeepLink:true,pageErrors:0},null,2));
  console.log(JSON.stringify({checks:results.length,browserBack:true,preservedLegacyValues:true,retiredDeepLink:true,pageErrors:0,evidence}));
} finally { await browser?.close();await rm(output,{recursive:true,force:true}); }
