import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, webkit } from 'playwright';

const html = '.search-photo-swipe.html';
const jsx = '.search-photo-swipe.jsx';
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { CSS } from './src/appStyles.js';
import { JobSearchMapView } from './src/components/JobSearchMapView.jsx';
import { setCache } from './src/lib/viewCache.js';
import { ADMIN_EMAIL } from './src/lib/utils';
import { CONSIGN_TERMS_VERSION } from './src/lib/consignAccess';
const image = (label, fill) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="440"><rect width="720" height="440" fill="' + fill + '"/><circle cx="530" cy="120" r="85" fill="white" opacity=".3"/><text x="35" y="90" font-size="48" fill="white">' + label + '</text></svg>');
const photos = [image('PHOTO A','#356452'),image('PHOTO B','#675686'),image('PHOTO C','#9c6037'),image('PHOTO D','#427184')];
const signedIn = new URLSearchParams(location.search).get('guest') !== '1';
const me = signedIn ? {id:'00000000-0000-4000-8000-000000000001',email:ADMIN_EMAIL} : null;
window.qaMe = me;
localStorage.clear(); sessionStorage.clear();
if (me) localStorage.setItem('cb_snap_me',JSON.stringify(me));
const job = (id, photos, extra={}) => ({id,crop:'ブロッコリー',task:'播種',region:'徳島県吉野川市',cityArea:'徳島県吉野川市',dateLabel:'12/20（日）',dateStartRaw:'2099-12-20',dateEndRaw:'2099-12-20',dateStart:'2099-12-20',dateEnd:'2099-12-20',workTime:'08:00〜17:00',payType:'daily',pay:10000,count:'2名',headcount:2,closed:false,filled:false,expired:false,hiredCount:0,isNew:false,photos,holidays:[],maskedFields:[],dangerPlaces:[],dangerTasks:[],beginnerOk:true,...extra});
const jobs = [job(101,photos),job(202,photos.slice(0,2)),job(303,photos.slice(0,1)),job(404,[]),job(505,photos.slice(0,2),{workVideoUrl:'https://youtu.be/aKydtOXW8mI'})];
const cache = {'search:jobs':jobs,'search:myJobNums':[],'search:myApps':{},'search:myPend':[], 'search:consignor':{consignment_terms_consent:true,consignment_terms_consent_version:CONSIGN_TERMS_VERSION}};
localStorage.setItem('cb_viewCache_v2_' + (me ? me.id.slice(0,8) : 'anon'),JSON.stringify(cache));
Object.entries(cache).forEach(([key,value])=>setCache(key,value));
createRoot(document.getElementById('root')).render(<><style>{CSS}</style><main style={{padding:'24px 12px 150px'}}><JobSearchMapView me={me}/></main></>);
`;
let server;
try {
  await writeFile(html, '<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/.search-photo-swipe.jsx"></script></body></html>');
  await writeFile(jsx, fixture);
  await mkdir('artifacts', {recursive:true});
  server = await createServer({configFile:false, plugins:[{
    name:'offline-search-fixture',enforce:'pre',resolveId(id) {
      if (/(?:^|\/)supabase(?:\.js)?$/.test(id)) return path.resolve('scripts/fixtures/job-expiry/client.js');
    },
  },react()],server:{host:'127.0.0.1',port:5143,strictPort:true}});
  await server.listen();
  for (const [name,type] of [['chromium',chromium],['webkit',webkit]]) {
    const browser = await type.launch();
    try {
      const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
      const errors=[]; page.on('pageerror',e=>{errors.push(e.message);console.error(name+' page error: '+e.message);});
      page.on('dialog',dialog=>dialog.dismiss());
      await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1' ? route.continue() : route.abort());
      const load = async (guest=false) => { await page.goto('http://127.0.0.1:5143/'+html+(guest?'?guest=1':'')+'#/work'); await page.locator('article.job-photo-card').first().waitFor(); await page.waitForTimeout(250); };
      const card = id => page.locator('article.job-photo-card').filter({has:page.locator('a[href="#/work/job/'+id+'"]')});
      const strip = id => card(id).locator('.job-card-media-scroll');
      const active = id => strip(id).evaluate(el=>Math.round(el.scrollLeft/el.clientWidth));
      const waitIndex = async (id,index) => { await page.waitForFunction(({id,index})=>{const el=[...document.querySelectorAll('article.job-photo-card')].find(el=>el.querySelector('a[href="#/work/job/'+id+'"]'))?.querySelector('.job-card-media-scroll');return el && Math.abs(el.scrollLeft-el.clientWidth*index)<2 && el.querySelectorAll('[data-media-type="photo"]')[index]?.tabIndex===0;},{id,index}); };
      await load();
      assert.equal(await card(101).count(),1);
      assert.equal(await strip(101).locator('[data-media-type="photo"]').count(),4);
      assert.equal(await card(101).locator('.job-card-media-controls').count(),0,'no external photo controls');
      assert.equal(await card(101).getByRole('button',{name:'次の画像・動画'}).count(),0);
      const sr=await card(101).locator('.job-card-media-status').evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,clip:getComputedStyle(el).clipPath}));
      assert.ok(sr.width<=1 && sr.height<=1 && sr.clip==='inset(50%)','counter is assistive text only');
      const nativeIsolation = await strip(101).evaluate(el=>{
        const make=(type,x,y)=>Object.assign(new Event(type,{bubbles:true,cancelable:true}),{touches:type==='touchend'?[]:[{identifier:42,target:el,clientX:x,clientY:y}],changedTouches:[{identifier:42,target:el,clientX:x,clientY:y}]});
        el.dispatchEvent(make('touchstart',280,170));
        const event=make('touchmove',60,172);el.dispatchEvent(event);el.dispatchEvent(make('touchend',60,172));
        return {prevented:event.defaultPrevented,url:location.hash};
      });
      assert.equal(nativeIsolation.prevented,false,'native lane listener cannot cancel media scrolling');
      assert.equal(nativeIsolation.url,'#/work','photo gesture cannot change the lane or route');
      if (name==='chromium') {
        const cdp=await page.context().newCDPSession(page);
        const swipe=async(x1,y1,x2,y2)=>{
          const point=(x,y)=>({id:1,x,y,radiusX:2,radiusY:2,force:1});
          await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(x1,y1)]});
          for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(x1+(x2-x1)*i/12,y1+(y2-y1)*i/12)]});await page.waitForTimeout(22);}
          await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(450);
        };
        const horizontal=async(forward=true)=>{
          const r=await strip(101).boundingBox();
          // Start over the summary text: it must not intercept the native photo swipe.
          const y=r.y+r.height*.65;
          await swipe(r.x+r.width*(forward?.85:.15),y,r.x+r.width*(forward?.15:.85),y+2);
        };
        await horizontal();await waitIndex(101,1);
        await horizontal();await waitIndex(101,2);
        await horizontal();await waitIndex(101,3);
        await horizontal(false);await waitIndex(101,2);
        assert.equal(await active(202),0,'another job never changes photographs');
        assert.equal(new URL(page.url()).hash,'#/work','swipe does not open detail');
        const before=await page.evaluate(()=>window.scrollY);
        const r=await strip(101).boundingBox();
        await swipe(r.x+r.width*.5,r.y+r.height*.75,r.x+r.width*.5+2,r.y+r.height*.75-140);
        assert.ok(await page.evaluate(()=>window.scrollY)>before+30,'vertical gesture scrolls the search page');
        assert.equal(await active(101),2,'vertical gesture never changes the photo');
        await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(150);
        console.log('Chromium trusted touch: four photos, reverse, vertical page scroll, independent jobs and unchanged lane passed');
      }
      // Also exercise actual WebKit layout and keyboard paths; this is not an iPhone hardware test.
      await strip(101).focus();
      await strip(101).evaluate(el=>el.scrollTo({left:0,behavior:'instant'}));await waitIndex(101,0);
      await page.keyboard.press('ArrowRight');await waitIndex(101,1);
      assert.equal(await active(202),0);
      for(const width of [320,390,768]) {
        await page.setViewportSize({width,height:844});await page.waitForTimeout(180);await waitIndex(101,1);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'no horizontal page overflow at '+width);
      }
      await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
      await page.screenshot({path:'artifacts/search-photo-swipe-'+name+'.png'});
      assert.equal(await page.locator('.job-card-video-below .job-video-facade').count(),1,'YouTube remains below the photo card');
      assert.equal(await page.locator('.job-card-video-below iframe').count(),0,'no autoplay introduced');
      assert.equal(await page.locator('a[data-guide="job-card"][href="#/work/job/303"]').count(),1,'single-photo card unchanged');
      assert.equal(await page.locator('a[data-guide="job-card"][href="#/work/job/404"]').count(),1,'no-photo card unchanged');
      await load(true);
      await strip(101).focus();await page.keyboard.press('ArrowRight');await waitIndex(101,1);
      const r=await strip(101).boundingBox();
      const popup=page.waitForEvent('popup');
      await page.touchscreen.tap(r.x+r.width*.5,r.y+r.height*.45);
      const detail=await popup;
      await detail.waitForURL(/#\/work\/job\/101/,{waitUntil:'commit'});
      assert.equal(new URL(page.url()).hash,'#/work','normal tap preserves the existing new-tab contract');
      await detail.close();
      assert.deepEqual(errors,[],'no runtime errors');
      console.log(name+': actual search view, native parent exclusion, no visible count/arrows, keyboard, resize, YouTube/single/fallback and normal photo tap passed');
    } finally {
      for (const context of browser.contexts()) for (const page of context.pages()) {
        try {
          await page.screenshot({path:'artifacts/search-photo-'+name+'-last.png'});
          console.log(name+' final state',await page.evaluate(()=>({url:location.href,scrollY,body:document.body.innerText.slice(0,1000),strips:[...document.querySelectorAll('.job-card-media-scroll')].map(el=>({x:el.scrollLeft,w:el.clientWidth,h:el.clientHeight,sw:el.scrollWidth}))})));
        } catch {}
      }
      await browser.close();
    }
  }
} finally {
  await server?.close();await Promise.all([rm(html,{force:true}),rm(jsx,{force:true})]);
}
