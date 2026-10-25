// Optional local Chromium check. No production authentication or network is used.
// CHROMIUM_PATH=/usr/bin/chromium node scripts/listing-publication-browser.mjs
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(path.join(tmpdir(), 'listing-publication-browser-'));
const evidence = process.env.CB_EVIDENCE_DIR || path.join(tmpdir(), 'listing-publication-evidence');
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
  const origin=process.env.CB_TEST_ORIGIN || 'https://example.org'; // Intercepted fixture origin; never sent to the network.
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
  const topics=['recruiter_name','recruiter_address','recruiter_contact','smoking_policy','review','publish_consent'];
  const results=[];
  for (const viewport of [{width:360,height:640},{width:390,height:844},{width:1440,height:900}]) {
    const context=await browser.newContext({viewport,locale:'ja-JP',timezoneId:'Asia/Tokyo',isMobile:viewport.width<500,hasTouch:viewport.width<500});
    const errors=[];
    await context.route('**/*',route=>{const url=new URL(route.request().url());const item=url.origin===origin && assets.get(url.pathname);return item?route.fulfill({status:200,contentType:item.mime,body:item.data}):route.abort();});
    await context.addInitScript(() => {
      window.qaOffline=false;window.qaConsent=true;window.qaMinimumWage=1100;
      if (!localStorage.getItem('listing-basics-test-seeded')) {
        window.qaListingForm={role:'farmer',farmerStep:2,farmerCropPill:'ブロッコリー',farmerTaskPill:'収穫',farmerPurpose:'post',
          farmerZip:'7793401',farmerPref:'徳島県',farmerCity:'吉野川市',farmerTown:'山川町',farmerAddr:'123番地',
          jobDateStart:'2026-11-01',jobDateEnd:null,jobHolidays:[],jobCount:'3',dailyWageInput:'10000',breakTime:'60分',
          startHour:'8',startMinute:'00',endHour:'16',endMinute:'00',overtimePolicy:'なし',overtimeDetail:'1時間程度',jobDescription:'保存する入力',
          taskChangeScope:'変更なし',placeChangeScope:'変更なし',nearestStation:'山瀬',commuteTime:'車10分以内',workVideoUrl:''};
        localStorage.setItem('listing-basics-test-seeded','1');
      }
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${origin}/#/work/new/page/recruiter_name`);
    for (const id of topics) {
      await page.evaluate(id=>{location.hash=`/work/new/page/${id}`;},id);
      await page.locator(`[data-step-id="${id}"]`).waitFor();
      await page.waitForTimeout(180);
      const overflow=await page.evaluate(()=>({document:document.documentElement.scrollWidth>innerWidth+1,fields:[...document.querySelectorAll('[data-step-id] input,[data-step-id] select,[data-step-id] textarea')].filter(el=>{const r=el.getBoundingClientRect();return r.width && (r.left < -1 || r.right > innerWidth+1);}).map(el=>el.id||el.getAttribute('aria-label'))}));
      assert.equal(overflow.document,false,`${viewport.width}/${id}: document overflow`);
      assert.deepEqual(overflow.fields,[],`${viewport.width}/${id}: fields overflow`);
      const footer=await page.locator('.listing-footer').boundingBox();
      assert.ok(footer && footer.y>=0 && footer.y+footer.height<=viewport.height+1,`${id}: visible footer`);
      const next=page.locator('.listing-next');if(id==='publish_consent')assert.equal(await next.isEnabled(),false,'unchecked consent cannot publish');else await next.waitFor();
      await page.screenshot({path:path.join(evidence,`${viewport.width}-${id}.png`)});
      await page.reload();await page.locator(`[data-step-id="${id}"]`).waitFor();
      const values=await page.evaluate(()=>window.qaDrafts.listDeviceDrafts('00000000-0000-4000-8000-000000000001')[0]?.form);
      assert.equal(values.jobCount,'3');assert.equal(values.dailyWageInput,'10000');assert.equal(values.nearestStation,'山瀬');
      results.push({width:viewport.width,page:id,overflow:false,reload:true});
    }
    await page.evaluate(()=>{location.hash='/work/new/page/recruiter_name?return=review';});await page.locator('[data-step-id="recruiter_name"]').waitFor();
    await page.locator('#listing-recruiter_name').fill('ブラウザーで入力した名称');
    await page.reload();await page.locator('#listing-recruiter_name').waitFor();assert.equal(await page.locator('#listing-recruiter_name').inputValue(),'ブラウザーで入力した名称');
    await page.locator('.listing-next').click();await page.locator('[data-step-id="review"]').waitFor();
    await page.locator('.listing-next').click();await page.locator('[data-step-id="publish_consent"]').waitFor();
    assert.equal(await page.locator('#listing-publish-confirmed').isChecked(),false);
    await page.locator('#listing-publish-confirmed').check();await page.goBack();await page.locator('[data-step-id="review"]').waitFor();
    await page.goForward();await page.locator('[data-step-id="publish_consent"]').waitFor();assert.equal(await page.locator('#listing-publish-confirmed').isChecked(),false);
    await page.evaluate(()=>{window.qaCheckError=true;});await page.locator('#listing-publish-confirmed').check();await page.locator('.listing-next').click();
    await page.getByRole('alert').filter({hasText:'保存を受け付けられませんでした'}).waitFor();
    assert.equal(await page.locator('[data-step-id="publish_consent"]').count(),1);
    await page.screenshot({path:path.join(evidence,`${viewport.width}-publish-error.png`)});
    assert.deepEqual(errors,[],`${viewport.width}: page errors`);
    await context.close();
  }
  await writeFile(path.join(evidence,'results.json'),JSON.stringify({checkedAt:new Date().toISOString(),engine:'Chromium',checks:results,browserBack:true,editedInputReload:true,reviewReturn:true,consentReset:true,inlineFailure:true,pageErrors:0},null,2));
  console.log(JSON.stringify({checks:results.length,browserBack:true,editedInputReload:true,reviewReturn:true,consentReset:true,inlineFailure:true,pageErrors:0,evidence}));
} finally { await browser?.close();await rm(output,{recursive:true,force:true}); }
