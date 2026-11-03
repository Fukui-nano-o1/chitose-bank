import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { CSS } from '../src/appStyles.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  const deadline = Date.now() + 5000;
  while (!fn()) { assert.ok(Date.now() < deadline, label); await pause(10); }
}
const job = id => ({ id, crop:`合成作物${id}`, task:'収穫', region:'合成市', cityArea:'合成市',
  dateLabel:'2099-11-02', dateStartRaw:'2099-11-02', dateEndRaw:'2099-11-02', dateStart:'2099-11-02', dateEnd:'2099-11-02',
  workTime:'08:00〜17:00', payType:'daily', pay:10000, count:'2名', headcount:2,
  closed:false, filled:false, expired:false, hiredCount:0, photos:[], holidays:[], maskedFields:[], dangerPlaces:[], dangerTasks:[] });
const fixtureId = path.join(root, 'scripts/fixtures/job-detail-navigation-virtual.jsx');
const fixture = `
import React, {useState, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {JobSearchMapView} from '${root}src/features/jobs/search/JobSearchMapView.jsx';
import {MobileNavigation} from '${root}src/app/navigation/MobileNavigation.jsx';
function Journey() {
  const [hash,setHash] = useState(location.hash.replace(/^#\\/?/,''));
  useEffect(() => { const on = () => setHash(location.hash.replace(/^#\\/?/,'')); window.addEventListener('hashchange',on); return () => window.removeEventListener('hashchange',on); },[]);
  const search = hash === 'search' || hash.startsWith('work/job/');
  return <><MobileNavigation me={window.qaMe} hasEmp={false} empCtx={false} curHash={hash} safeTab={search?'search':hash}
    navBadges={{}} meAvatar={{}} tabUrlKeys={['search','saved','chats','profile','login']} setTab={()=>{}} setMobileMenuOpen={()=>{}} />
    {search ? <JobSearchMapView me={window.qaMe || null} /> : <main data-other-page={hash} />}</>;
}
flushSync(() => createRoot(document.getElementById('root')).render(<Journey />));
`;
const navSelector = 'body:has(.job-detail-body-mobile) .app-header-mobile';

test('job-detail-only navigation guard follows the real mounted page and retains application controls', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'cb-job-detail-nav-'));
  let dom;
  try {
    await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
      name:'job-detail-navigation-fixture',enforce:'pre',resolveId(id) {
        if(id===fixtureId)return id;
        if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/job-expiry/client.js');
      },load(id){if(id===fixtureId)return fixture;},
    },react()],build:{outDir:output,lib:{entry:fixtureId,name:'JobDetailNavQA',formats:['iife'],fileName:'fixture'},minify:false}});
    const script = await readFile(path.join(output,'fixture.iife.js'),'utf8');
    function mount(hash, signedIn) {
      dom?.window.close();
      const errors=[], vc=new VirtualConsole();
      vc.on('jsdomError',e=>errors.push(e.message));vc.on('error',(...args)=>errors.push(args.join(' ')));
      dom=new JSDOM('<div id="root"></div>',{url:`https://detail.test/#/${hash}`,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});
      const w=dom.window;
      Object.assign(w,{Response,Request,Headers,AbortController,AbortSignal,TextEncoder,TextDecoder,qaErrors:errors});
      w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
      w.scrollTo=()=>{};w.HTMLElement.prototype.scrollTo=()=>{};w.HTMLElement.prototype.scrollBy=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
      w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.fetch=()=>{throw Error('Unexpected real network');};
      w.qaMe=signedIn?{id:'00000000-0000-4000-8000-000000000001',email:'worker@fixture.test'}:null;
      if(w.qaMe)w.localStorage.setItem('cb_snap_me',JSON.stringify(w.qaMe));
      w.localStorage.setItem(`cb_viewCache_v2_${signedIn?w.qaMe.id.slice(0,8):'anon'}`,JSON.stringify({
        'search:jobs':[job(101),job(202)],'search:myJobNums':[],'search:myApps':{},'search:myPend':[],
      }));
      w.eval(script);return w;
    }
    const hiddenByDetail=w=>!!w.document.querySelector(navSelector);
    async function detail(w,id=101) {
      await until(()=>w.document.querySelector('.job-detail-body-mobile')?.textContent.includes(`合成作物${id}`),'real detail mounted');
      assert.equal(hiddenByDetail(w),true);
      assert.equal(w.document.querySelectorAll('.mobile-apply-bar').length,1,'application bar retained');
      assert.ok(w.document.querySelector('.mobile-apply-bar [data-guide="apply-btn"]'));
    }
    for(const signedIn of [false,true])await t.test(`${signedIn?'signed-in':'anonymous'} deep link, nested routes, switching and history`,async()=>{
      const w=mount('work/job/101',signedIn);await detail(w);
      w.location.hash='/work/job/202';await detail(w,202);
      w.location.hash='/work/job/202/questions';await until(()=>!!w.document.querySelector('.job-detail-body-mobile')&&!w.document.querySelector('#sec-host'),'questions mounted');assert.equal(hiddenByDetail(w),true);
      w.location.hash='/work/job/202/workplace';await until(()=>!!w.document.querySelector('.workplace-page'),'workplace mounted');assert.equal(hiddenByDetail(w),false);
      w.history.back();await until(()=>hiddenByDetail(w),'Back to questions');
      w.history.forward();await until(()=>!!w.document.querySelector('.workplace-page'),'Forward to workplace');assert.equal(hiddenByDetail(w),false);
      w.location.hash='/work/job/101/apply/intro';await until(()=>!w.document.querySelector('.workplace-page')&&!w.document.querySelector('.job-detail-body-mobile'),'application page mounted');assert.equal(hiddenByDetail(w),false);
      w.location.hash='/work/job/101';await detail(w);
      w.document.querySelector('.job-float-back').click();await until(()=>w.location.hash==='#/search'&&!hiddenByDetail(w),'explicit back restores search');
      assert.equal(w.document.querySelector('.mobile-apply-bar'),null);
      assert.ok(w.document.querySelector('.app-header-mobile'));
      w.history.back();await until(()=>w.location.hash==='#/work/job/101','browser Back restores detail');await detail(w);
      w.history.forward();await until(()=>w.location.hash==='#/search'&&!hiddenByDetail(w),'browser Forward restores search');
      for(const route of ['saved','chats','profile','login','work/new','admin/review/101']) {
        w.location.hash=`/${route}`;await until(()=>w.document.querySelector('[data-other-page]')?.getAttribute('data-other-page')===route,route);
        assert.equal(hiddenByDetail(w),false,`${route} unaffected`);
      }
      assert.deepEqual(w.qaErrors,[]);
    });
    // Run only in the approved CI browser runtime, never as a local fallback.
    if(process.env.CB_NAV_BROWSER==='1')await t.test('real mobile layout keeps one bottom bar across history and deep links',async()=>{
      const {chromium}=await import('playwright');
      const browser=await chromium.launch({headless:true});
      try {
        for(const width of [360,390,759,768,1024])for(const signedIn of [false,true]) {
          const context=await browser.newContext({viewport:{width,height:844}});
          await context.route('**/*',route=>{
            const url=new URL(route.request().url());
            if(url.origin!=='https://detail.test')return route.abort();
            if(url.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+CSS+'</style><div id="root"></div><script src="/fixture.js"></script>'});
            if(url.pathname==='/fixture.js')return route.fulfill({contentType:'text/javascript; charset=utf-8',body:script});
            return route.abort();
          });
          await context.addInitScript(({signedIn,jobs})=>{
            window.qaMe=signedIn?{id:'00000000-0000-4000-8000-000000000001',email:'worker@fixture.test'}:null;
            if(window.qaMe)localStorage.setItem('cb_snap_me',JSON.stringify(window.qaMe));
            localStorage.setItem(`cb_viewCache_v2_${signedIn?window.qaMe.id.slice(0,8):'anon'}`,JSON.stringify({'search:jobs':jobs,'search:myJobNums':[],'search:myApps':{},'search:myPend':[]}));
          },{signedIn,jobs:[job(101),job(202)]});
          const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
          await page.goto('https://detail.test/#/work/job/101');await page.locator('.job-detail-body-mobile').waitFor();
          assert.equal(await page.locator('.app-header-mobile').isVisible(),false);
          assert.equal(await page.locator('.job-float-back').isVisible(),true);
          assert.equal(await page.locator('.job-float-back').isEnabled(),true);
          assert.equal(await page.evaluate(()=>{const button=document.querySelector('.app-header-mobile button');button.focus();return document.activeElement===button;}),false,'hidden global tabs cannot receive keyboard focus');
          if(width<760){
            const bar=page.locator('.mobile-apply-bar');await bar.waitFor();
            const rect=await bar.boundingBox();assert.ok(Math.abs(rect.y+rect.height-844)<1,'application bar touches viewport bottom');
            for(const state of ['cb-scroll-hide','cb-typing']){
              await page.evaluate(state=>document.body.classList.add(state),state);await page.waitForTimeout(300);
              const rect=await bar.boundingBox();assert.ok(Math.abs(rect.y+rect.height-844)<1,'scroll/typing must not move the bar below the viewport');
              await page.evaluate(state=>document.body.classList.remove(state),state);
            }
          }
          await page.locator('.job-float-back').click();await page.waitForURL('**/#/search');
          await page.waitForFunction(()=>!document.querySelector('.job-detail-body-mobile'));
          assert.equal(await page.locator('.app-header-mobile').isVisible(),width<=768);
          await page.goBack();await page.locator('.job-detail-body-mobile').waitFor();assert.equal(await page.locator('.app-header-mobile').isVisible(),false);
          await page.goForward();await page.waitForURL('**/#/search');await page.waitForFunction(()=>!document.querySelector('.job-detail-body-mobile'));
          assert.equal(await page.locator('.app-header-mobile').isVisible(),width<=768);
          assert.deepEqual(errors,[]);await context.close();
        }
      }finally{await browser.close();}
    });
    await t.test('mobile stylesheet removes double stack and retains safe area and footer behavior',()=>{
      assert.match(CSS,/@media \(max-width: 768px\) \{\s*body:has\(\.job-detail-body-mobile\) \.app-header-mobile,\s*body:has\(\.job-detail-body-mobile\) \.app-header-mobile-float \{ display: none !important; \}/);
      const bar=CSS.match(/@media \(max-width: 759px\) \{\s*\.mobile-apply-bar \{([^}]+)\}/)?.[1];
      assert.ok(bar);assert.match(bar,/bottom: 0;/);assert.match(bar,/padding: 14px 16px calc\(18px \+ env\(safe-area-inset-bottom, 0px\)\)/);
      assert.doesNotMatch(CSS,/body\.cb-(?:scroll-hide|typing) \.mobile-apply-bar/);
      assert.match(CSS,/body\.cb-at-bottom \.mobile-apply-bar \{ transform: translateY\(105%\); \}/);
    });
  } finally {dom?.window.close();await rm(output,{recursive:true,force:true});}
});
