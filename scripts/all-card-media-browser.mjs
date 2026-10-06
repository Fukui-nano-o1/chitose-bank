// Isolated Chromium geometry/touch check. No production database or YouTube media is requested.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('../',import.meta.url));
const output = await mkdtemp(path.join(tmpdir(),'cb-media-browser-'));
let browser;
try {
  await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
    name:'media-browser-fixture',enforce:'pre',resolveId(module){
      if (/(?:^|\/)supabase(?:\.js)?$/.test(module)) return path.join(root,'scripts/fixtures/analytics/client.js');
    },
  },react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/job-video/entry.jsx'),name:'MediaQA',formats:['iife'],fileName:'fixture'},minify:false}});
  const bundle = await readFile(path.join(output,'fixture.iife.js'),'utf8');
  browser = await chromium.launch({headless:true});
  const results=[];
  for (const width of [320,390,768,1280]) {
    const context=await browser.newContext({viewport:{width,height:844},isMobile:width<760,hasTouch:true});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const jobs=['list','wide','related'].flatMap((variant,index)=>[
      {id:9100+index*2,variant,crop:'ブロッコリー',task:'収穫',photos:['/one.jpg','/two.jpg']},
      {id:9101+index*2,variant,crop:'ネギ',task:'調整',workVideoUrl:'https://youtu.be/aKydtOXW8mI',photos:['/one.jpg','/two.jpg']}
    ]);
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/fixture') return route.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:12px}#root{width:100%;min-width:0}img{display:block}</style><div id="root"></div><script>window.qaJobs=${JSON.stringify(jobs)};window.qaCalls=[];window.qaLikes=0;window.qaOpened=0;</script>`});
      if(url.hostname==='www.youtube-nocookie.com') return route.fulfill({contentType:'text/html',body:'<!doctype html><body style="margin:0;background:#111;color:white">YouTube test frame</body>'});
      if(/\.jpg$/.test(url.pathname)) return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#b5cdb9"/></svg>'});
      return route.abort();
    });
    await page.goto('https://ui.test/fixture');await page.addScriptTag({content:bundle});
    await page.waitForSelector('.job-media-card');
    assert.equal(await page.locator('iframe').count(),0);
    for(let index=0;index<jobs.length;index++){
      const card=page.locator('.job-media-card').nth(index);
      const strip=card.locator('.job-card-media-scroll');
      const bounds=await strip.boundingBox();
      const slide=await strip.locator(':scope > *').first().boundingBox();
      assert.ok(Math.abs(bounds.width-slide.width)<1);
      assert.ok(Math.abs(bounds.height-220)<1);
      if(jobs[index].variant==='related')assert.ok(bounds.width<=280);
      await card.locator('[aria-label="次の画像・動画"]').click();
      await page.waitForTimeout(100);
      const distance=await strip.evaluate(el=>Math.abs(el.scrollLeft-el.clientWidth));
      assert.ok(distance<1,`alignment ${width}/${index}: ${distance}`);
      results.push({width,variant:jobs[index].variant,video:!!jobs[index].workVideoUrl,frameWidth:bounds.width,frameHeight:bounds.height,alignmentError:distance});
    }
    const photo=page.locator('.job-photo-card').first();
    await photo.locator('[aria-label="前の画像・動画"]').click();
    await photo.scrollIntoViewIfNeeded();
    const strip=photo.locator('.job-card-media-scroll');
    const box=await strip.boundingBox();
    const session=await context.newCDPSession(page);
    const x1=box.x+box.width*.8,x2=box.x+box.width*.15,y=box.y+100;
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y}]});
    for(let step=1;step<=8;step++){
      await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x1+(x2-x1)*step/8,y}]});
      await page.waitForTimeout(20);
    }
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(600);
    assert.ok(await strip.evaluate(el=>el.scrollLeft>el.clientWidth*.9),'native touch swipe moves to second photo');
    assert.equal(await page.evaluate(()=>window.qaOpened),0,'swipe cannot open the job');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no page overflow');
    const video=page.locator('.job-video-card').first();
    await video.getByRole('button',{name:'YouTube',exact:true}).click();
    assert.equal(await page.locator('iframe').count(),0);
    await video.locator('.job-video-facade').click();
    await video.locator('iframe').waitFor();
    const frame=await video.locator('iframe').boundingBox();
    const videoBox=await video.locator('.job-card-media-scroll').boundingBox();
    assert.ok(Math.abs(frame.height-videoBox.height)<1&&Math.abs(frame.width-videoBox.width)<1);
    await video.getByRole('button',{name:'写真（2枚）',exact:true}).click();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('iframe').count(),0);
    assert.deepEqual(errors,[]);
    if(width===390){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/all-card-media-mobile.png',fullPage:false});}
    await context.close();
  }
  await writeFile('/tmp/all-card-media-browser.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify({geometryCases:results.length,nativeSwipeViewports:4,result:'passed',youtubePlayback:'mocked, not a real audio test'}));
} finally {await browser?.close();await rm(output,{recursive:true,force:true});}
