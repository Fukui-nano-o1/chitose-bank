// Real card components and styles. YouTube networking is mocked, not real playback.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium,webkit} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url));
const temp=await mkdtemp(path.join(root,'.photo-summary-qa-'));
const results=[];
const within=(a,b)=>a.x>=b.x-.5&&a.y>=b.y-.5&&a.x+a.width<=b.x+b.width+.5&&a.y+a.height<=b.y+b.height+.5;
try {
  const entry=path.join(temp,'entry.jsx');
  await writeFile(entry,"import {CSS} from '../src/appStyles'; import '../scripts/fixtures/job-video/entry.jsx'; window.qaCSS=CSS;");
  await build({root,configFile:false,logLevel:'error',define:{'process.env.NODE_ENV':'\"production\"'},plugins:[{name:'photo-summary-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/analytics/client.js');}},react()],build:{outDir:path.join(temp,'out'),lib:{entry,name:'PhotoSummaryQA',formats:['iife'],fileName:'fixture'},minify:false}});
  const bundle=await readFile(path.join(temp,'out','fixture.iife.js'),'utf8');
  const css=(await Promise.all((await readdir(path.join(temp,'out'))).filter(f=>f.endsWith('.css')).map(f=>readFile(path.join(temp,'out',f),'utf8')))).join('\n');
  for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]) {
    const browser=await type.launch({headless:true});
    try {
      for(const width of [320,390,430,1280]) {
        const context=await browser.newContext({viewport:{width,height:950},hasTouch:width<760,isMobile:width<760});
        const page=await context.newPage();page.setDefaultTimeout(7000);
        const errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.route('**/*',route=>{
          const u=new URL(route.request().url());
          if(u.hostname==='ui.test'&&u.pathname==='/fixture')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><main style="max-width:1200px;margin:auto;padding:0 12px"><div id="root"></div></main><script>window.qaJobs=[];window.qaCalls=[];window.qaLikes=0;window.qaOpened=0;</script>'});
          if(u.hostname==='www.youtube-nocookie.com')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#111;color:white}button{position:absolute;top:8px;right:8px;min-height:44px}</style><button id="settings" onclick="this.textContent=\'opened\'">Settings</button>'});
          if(/\.jpg$/.test(u.pathname))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#aac3af"/></svg>'});
          return route.abort();
        });
        try {
          await page.goto('https://ui.test/fixture');await page.addScriptTag({content:bundle});
          await page.addStyleTag({content:(await page.evaluate(()=>window.qaCSS))+'\n'+css});
          for(const [i,kind] of ['multiple','single','no-photo','no-video','invalid','hourly','no-pay','closed','single-filled','long','no-region','no-date'].entries()) {
            const job={id:9600+i,variant:'list',videoPlacement:'below',crop:'ブロッコリー',task:'収穫',region:'徳島県吉野川市',dateStartRaw:'2026-11-01',dateEndRaw:'2026-11-03',pay:kind==='no-pay'?0:kind==='hourly'?1250:10000,payType:kind==='hourly'?'hourly':'daily',photos:kind==='no-photo'?[]:kind==='single'?['/one.jpg']:['/one.jpg','/two.jpg'],workVideoUrl:kind==='no-video'?'':kind==='invalid'?'https://example.com/video':'https://youtu.be/aKydtOXW8mI',beginnerOk:true,experiencedPreferred:true,instantApproveRepeat:true,closed:kind==='closed'};
            if(kind==='single-filled'){job.photos=['/one.jpg'];job.filled=true;}
            if(kind==='long'){job.region='徳島県吉野川市山川町の長い地域名も表示する確認';job.task='収穫・調整・出荷準備';job.pay=1250000;}
            if(kind==='no-region')job.region='';
            if(kind==='no-date')job.dateStartRaw='';
            job.isNew=kind==='single';
            console.log(JSON.stringify({engine,width,kind}));
            await page.evaluate(j=>{window.scrollTo(0,0);window.qaLikes=0;window.qaOpened=0;window.qaRender([j]);},job);
            const card=page.locator('.job-card-photo-summary');await card.waitFor();
            await page.waitForFunction(id=>document.querySelector('.job-card-photo-summary')?.textContent.includes('#'+id),job.id);
            const geometry=await card.evaluate(el=>{
              const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
              return {cover:rect(el.querySelector('.job-card-media-scroll')||el.querySelector('.job-card-cover')),summary:rect(el.querySelector('.job-card-summary')),text:[...el.querySelectorAll('.job-card-summary p')].map(rect),color:getComputedStyle(el.querySelector('.job-card-summary p')).color};
            });
            assert.ok(within(geometry.summary,geometry.cover),'entire summary is inside the photo');
            for(const text of geometry.text)assert.ok(within(text,geometry.cover),'every text row is inside the photo');
            assert.equal(geometry.color,'rgb(255, 255, 255)');
            const layout=await card.evaluate(el=>{
              const box=n=>{if(!n)return null;const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
              const summary=el.querySelector('.job-card-summary');
              return {cover:box(el.querySelector(".job-card-media-scroll")||el.querySelector(".job-card-cover")),summary:box(summary),heading:box(el.querySelector('.job-card-heading')),region:box(el.querySelector('.job-card-region')),dates:box(el.querySelector('.job-card-dates')),pay:box(el.querySelector('.job-card-pay')),conditions:box(el.querySelector('.job-card-conditions')),heart:box(el.querySelector('[aria-label="いいね"]')),end:box(el.querySelector('.job-card-end-label')),background:getComputedStyle(summary).backgroundImage,display:getComputedStyle(summary).display};
            });
            assert.equal(layout.display,'block','distributed grid is removed');
            assert.ok(Math.abs(layout.summary.y+layout.summary.height-layout.cover.y-layout.cover.height)<1,'summary is bottom-aligned inside the photograph: '+JSON.stringify(layout));
            const rows=[layout.heading,layout.region,layout.dates,layout.pay,layout.conditions].filter(Boolean);
            for(let row=1;row<rows.length;row++){
              assert.ok(rows[row].y>=rows[row-1].y+rows[row-1].height-.5,'text is grouped in consecutive vertical rows');
              assert.ok(Math.abs(rows[row].x-layout.heading.x)<1,'all summary rows share the original left alignment');
            }
            assert.ok(layout.heading.y>=layout.cover.y+31,'title has space above it instead of occupying the photo top');
            if(layout.conditions)assert.ok(Math.abs(layout.conditions.y+layout.conditions.height-layout.summary.y-layout.summary.height+14)<1,'conditions finish at the bottom padding');
            const alphas=[...layout.background.matchAll(/rgba\([^)]*,\s*([\d.]+)\)/g)].map(m=>Number(m[1]));
            assert.equal(alphas.length,5,'the backdrop uses five gradual stops');
            assert.equal(alphas[0],0,'the upper edge is transparent');
            for(let stop=1;stop<alphas.length;stop++)assert.ok(alphas[stop]>alphas[stop-1],'black becomes progressively darker toward the bottom');
            assert.ok(alphas.at(-1)>=.55&&alphas.at(-1)<=.60,'the darkest edge is capped at 60 percent, not the old 90 percent');
            const overlap=(a,b)=>a&&b&&Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>.5&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>.5;
            const fields=[layout.heading,layout.region,layout.dates,layout.pay,layout.conditions].filter(Boolean);
            for(let a=0;a<fields.length;a++)for(let b=a+1;b<fields.length;b++)assert.equal(overlap(fields[a],fields[b]),false,'grouped text fields never overlap');
            for(const field of fields){assert.equal(!!overlap(field,layout.heart),false,'text avoids the like control');assert.equal(!!overlap(field,layout.end),false,'closed label remains separate');}
            assert.equal(!!layout.region,!!job.region);assert.equal(!!layout.dates,!!job.dateStartRaw);
            geometry.bottomSummary=layout;
            assert.equal(await card.locator('.job-card-summary').count(),1,'no duplicated summary outside card');
            if(job.pay>0)assert.equal(await card.locator('.job-card-summary .f-mono').textContent(),kind==='hourly'?'時給1,250円':kind==='long'?'日給1,250,000円':'日給10,000円');
            else assert.equal(await card.locator('.job-card-summary .f-mono').count(),0,'missing pay is not invented');
            assert.equal(await page.locator('iframe').count(),0,'video is not loaded on render');
            if(!job.closed&&!job.filled){await card.locator('[aria-label="いいね"]').click();assert.equal(await page.evaluate(()=>window.qaLikes),1);assert.equal(await page.evaluate(()=>window.qaOpened),0);}
            if(job.photos.length>1){
              await card.locator('[aria-label="次の画像・動画"]').click();
              await page.waitForFunction(()=>{const s=document.querySelector('.job-card-photo-summary .job-card-media-scroll');return Math.abs(s.scrollLeft-s.clientWidth)<1;});
              assert.match(await card.locator('[aria-live]').textContent(),/写真2.*2\/2/);
              assert.equal(await page.evaluate(()=>window.qaOpened),0,'photo controls do not navigate');
              const summaryLink=card.locator('.job-card-summary-link');await summaryLink.focus();await page.keyboard.press('Enter');
              assert.equal(await page.evaluate(()=>window.qaOpened),1,'summary remains a keyboard link');
              await page.evaluate(()=>{window.qaOpened=0;window.scrollTo(0,0);});
            }
            // A real click on visible overlaid text reaches the photo/job, not a dead overlay.
            const target=await card.locator('.job-card-summary p').first().boundingBox();
            await page.mouse.click(target.x+Math.min(30,target.width/2),target.y+target.height/2);
            assert.equal(await page.evaluate(()=>window.qaOpened),1,'tapping on text still opens the job');
            await page.evaluate(()=>window.qaOpened=0);
            const valid=kind!=='no-video'&&kind!=='invalid';
            assert.equal(await page.locator('.job-card-video-below').count(),valid?1:0);
            if(valid){
              const below=page.locator('.job-card-video-below');
              await below.locator('.job-video-facade').click();await below.locator('iframe').waitFor();
              await page.frameLocator('.job-card-video-below iframe').locator('#settings').click();
              assert.equal(await page.evaluate(()=>window.qaOpened),0,'YouTube controls never open the job');
              const g=await page.evaluate(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom};};return {card:rect(document.querySelector('.job-card-photo-summary')),frame:rect(document.querySelector('iframe'))};});
              assert.ok(g.frame.top>=g.card.bottom+11,'YouTube stays below the whole card');
              assert.equal(await below.locator('.job-card-summary').count(),0,'nothing overlays the player');
            }
            if(engine==='chromium'&&width===390&&kind==='multiple'){
              await page.evaluate(()=>{window.dispatchEvent(new Event("hashchange"));window.scrollTo(0,0);});
              await page.waitForFunction(()=>!document.querySelector("iframe"));
              await page.screenshot({path:"/tmp/photo-summary-mobile.png",fullPage:true});
            }
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no page overflow');
            assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.qaCalls.length),0,'no database changes');
            results.push({engine,width,kind,geometry,passed:true});
          }
          // Other card variants keep their existing summary layout.
          await page.evaluate(()=>window.qaRender([{id:9699,variant:'related',crop:'野菜',task:'収穫',pay:10000,photos:['/one.jpg','/two.jpg'],workVideoUrl:'https://youtu.be/aKydtOXW8mI'}]));
          await page.locator('.job-video-card').waitFor();
          assert.equal(await page.locator('.job-card-photo-summary').count(),0);
          assert.equal(await page.locator('.job-card-media-types button').count(),2);
        } catch(error) {
          await page.screenshot({path:'/tmp/photo-summary-failure.png',fullPage:true});
          throw error;
        } finally {await context.close();}
      }
    } finally {await browser.close();}
  }
  await writeFile('/tmp/photo-summary-results.json',JSON.stringify({cases:results.length,results,YouTube:'mocked',iPhoneHardware:'not tested'},null,2));
  console.log(JSON.stringify({cases:results.length,result:'passed'}));
} finally {await rm(temp,{recursive:true,force:true});}
