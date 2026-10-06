// Real shared card components in Chromium/WebKit; YouTube responses are mocked.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium,webkit} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url));
const temp=await mkdtemp(path.join(root,'.search-card-qa-'));
const results=[];
// Read related rectangles in the same browser frame. Separate remote calls can
// straddle scroll anchoring or font layout after a card replaces the previous one.
const geometry=page=>page.evaluate(()=>{
  const card=document.querySelector('.job-card-with-video > [data-guide="job-card"]');
  const below=document.querySelector('.job-card-video-below');
  const box=el=>el?.getBoundingClientRect().toJSON();
  return {upper:box(card),before:box(below?.querySelector('.job-card-media-scroll')),player:box(below?.querySelector('iframe')),scrollY:window.scrollY};
});
try{
  const entry=path.join(temp,'entry.jsx');
  await writeFile(entry,"import {CSS} from '../src/appStyles'; import '../scripts/fixtures/job-video/entry.jsx'; window.qaCSS=CSS;");
  await build({root,configFile:false,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'search-card-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/analytics/client.js');}},react()],build:{outDir:path.join(temp,'out'),lib:{entry,name:'SearchCardQA',formats:['iife'],fileName:'fixture'},minify:false}});
  const bundle=await readFile(path.join(temp,'out','fixture.iife.js'),'utf8');
  const cssFiles=(await readdir(path.join(temp,'out'))).filter(f=>f.endsWith('.css'));
  const componentCSS=(await Promise.all(cssFiles.map(f=>readFile(path.join(temp,'out',f),'utf8')))).join('\n');
  for(const [engine,type]of [['chromium',chromium],['webkit',webkit]]){
    const browser=await type.launch({headless:true});
    try{
      for(const width of [320,390,430,1280]){
        const context=await browser.newContext({viewport:{width,height:950},hasTouch:width<760,isMobile:width<760});
        const page=await context.newPage();page.setDefaultTimeout(7000);
        const errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.route('**/*',route=>{
          const u=new URL(route.request().url());
          if(u.hostname==='ui.test'&&u.pathname==='/fixture')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><main style="max-width:1200px;margin:auto;padding:0 12px"><div id="root"></div></main><script>window.qaJobs=[];window.qaCalls=[];window.qaLikes=0;window.qaOpened=0;</script>'});
          if(u.hostname==='www.youtube-nocookie.com')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#111;color:white}button{position:absolute;top:8px;right:8px;min-height:44px}</style><button id="settings" onclick="this.textContent=\'opened\'">Settings</button>'});
          if(/\.jpg$/.test(u.pathname))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#b5cdb9"/></svg>'});
          return route.abort();
        });
        await page.goto('https://ui.test/fixture');await page.addScriptTag({content:bundle});
        await page.addStyleTag({content:(await page.evaluate(()=>window.qaCSS))+'\n'+componentCSS});
        for(const [i,kind]of ['multiple','single','no-photo','no-video','invalid','closed'].entries()){
          console.log(JSON.stringify({engine,width,kind}));
          try{
            const job={id:9400+i,variant:'list',videoPlacement:'below',priority:true,crop:'ブロッコリー',task:'収穫',region:'徳島県吉野川市',dateStartRaw:'2026-11-01',pay:10000,views:8,beginnerOk:true,photos:kind==='no-photo'?[]:kind==='single'?['/one.jpg']:['/one.jpg','/two.jpg'],workVideoUrl:kind==='no-video'?'':kind==='invalid'?'https://youtube.com.evil.test/watch?v=aKydtOXW8mI':'https://youtu.be/aKydtOXW8mI',closed:kind==='closed'};
            await page.evaluate(j=>{window.scrollTo(0,0);window.qaRender([j]);},job);
            await page.locator(`[href="#/work/job/${job.id}"]`).first().waitFor();
            await page.evaluate(()=>document.fonts.ready);
            assert.equal(await page.locator('iframe').count(),0,'no iframe before explicit play');
            const valid=kind!=='no-video'&&kind!=='invalid';
            assert.equal(await page.locator('.job-card-video-below').count(),valid?1:0);
            if(valid){
              const shell=page.locator('.job-card-with-video');
              const card=shell.locator(':scope > [data-guide="job-card"]');
              const below=page.locator('.job-card-video-below');
              assert.equal(await card.locator('[data-media-type="youtube"]').count(),0);
              assert.equal(await below.locator('[data-media-type="photo"]').count(),0);
              assert.equal(await shell.locator('.job-card-media-types').count(),0);
              assert.ok((await card.textContent()).includes(job.region));
              assert.ok((await card.textContent()).includes('10,000'));
              const {before,upper}=await geometry(page);
              assert.ok(before.y>=upper.y+upper.height+11,'video starts below all card text: '+JSON.stringify({before,upper}));
              assert.ok(Math.abs(before.width-upper.width)<1,'video matches card width');
              assert.ok(Math.abs(before.height-Math.max(200,before.width*9/16))<1,'responsive 16:9 frame, minimum height 200');
              assert.equal(await card.locator('[aria-label="いいね"]').count(),job.closed?0:1);
              if(!job.closed){await card.locator('[aria-label="いいね"]').click();assert.equal(await page.evaluate(()=>window.qaOpened),0);}
              await below.locator('.job-video-facade').click();
              await below.locator('iframe').waitFor();
              await page.frameLocator('.job-card-video-below iframe').locator('#settings').click();
              assert.equal(await page.frameLocator('.job-card-video-below iframe').locator('#settings').textContent(),'opened');
              assert.equal(await page.evaluate(()=>window.qaOpened),0,'video controls do not open a job');
              const {player,upper:photoCard}=await geometry(page);
              assert.ok(player.y>=photoCard.y+photoCard.height+11,'loaded player remains below card');
              assert.ok(Math.abs(player.height-before.height)<1,'loading player does not shift the layout');
              assert.equal(await below.locator('.job-video-facade').count(),0);
              if(engine==='chromium'&&width===390&&kind==='multiple'){
                await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'/tmp/search-card-video-mobile.png',fullPage:true});
              }
              if(job.photos.length>1){
                await card.locator('[aria-label="次の画像・動画"]').click();
                await page.waitForFunction(()=>{const el=document.querySelector('.job-card-with-video > [data-guide="job-card"] .job-card-media-scroll');return Math.abs(el.scrollLeft-el.clientWidth)<1;});
                assert.match(await card.locator('[aria-live]').textContent(),/写真2.*2\/2/);
              }
            }
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');
            assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.qaCalls.length),0);
            results.push({engine,width,kind,passed:true});
          }catch(error){
            const debug={engine,width,kind,geometry:await geometry(page),message:error.message,results};
            await writeFile('/tmp/search-card-debug.json',JSON.stringify(debug,null,2));
            await page.screenshot({path:'/tmp/search-card-debug.png',fullPage:true});
            throw error;
          }
        }
        // Related cards still use their original mixed gallery and dimensions.
        await page.evaluate(()=>window.qaRender([{id:9499,variant:'related',crop:'野菜',task:'収穫',photos:['/one.jpg','/two.jpg'],workVideoUrl:'https://youtu.be/aKydtOXW8mI'}]));
        await page.locator('.job-video-card').waitFor();
        assert.equal(await page.locator('.job-card-video-below').count(),0);
        assert.equal(await page.locator('.job-card-media-types button').count(),2);
        assert.equal(await page.locator('[data-media-type="photo"]').count(),2);
        await context.close();
      }
    }finally{await browser.close();}
  }
  await writeFile('/tmp/search-card-video-layout.json',JSON.stringify({cases:results.length,results,YouTube:'mocked controls, no real playback',iPhoneHardware:'not tested'},null,2));
  console.log(JSON.stringify({cases:results.length,result:'passed',engines:['Chromium','WebKit']}));
}finally{await rm(temp,{recursive:true,force:true});}
