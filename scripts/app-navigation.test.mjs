import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtureId = path.join(root, 'scripts/fixtures/app-navigation-virtual.jsx');
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MobileNavigation } from '${path.join(root, 'src/app/navigation/MobileNavigation.jsx')}';
import { CSS } from '${path.join(root, 'src/appStyles.js')}';
const root = createRoot(document.getElementById('root'));
window.qaActions = [];
let props = { me:null, hasEmp:false, empCtx:false, curHash:'search', safeTab:location.hash.split('/')[1] || 'search', navFlip:'',
  navBadges:{}, meAvatar:{}, showJobPost:false, chatAppId:null,
  tabUrlKeys:['search','saved','chats','profile','install','login'], ...window.qaNavProps };
window.qaRenderNav = patch => {
  props = {...props,...patch};
  flushSync(() => root.render(<><style>{CSS}</style><MobileNavigation {...props}
    setTab={value => { window.qaActions.push(['tab', value]); props.safeTab = value; }}
    setMobileMenuOpen={value => window.qaActions.push(['menu', value])} /></>));
};
for (const name of ['cb:workerHome','cb:employerHome']) window.addEventListener(name, () => window.qaActions.push(['event',name]));
window.addEventListener('hashchange', () => window.qaRenderNav({curHash:location.hash.replace(/^#\\/?/,'')}));
window.qaRenderNav({curHash:location.hash.replace(/^#\\/?/,'') || 'search'});
`;
const labelButtons = w => [...w.document.querySelectorAll('.app-header-mobile-tab')];
const button = (w, label) => labelButtons(w).find(el => el.querySelector('.label').textContent === label);
const activeLabels = w => labelButtons(w).filter(el => el.classList.contains('active')).map(el => el.querySelector('.label').textContent);
const signedIn = { id:'fixture-user', name:'合成ユーザー' };

// CB_NAV_BROWSER=1 CHROMIUM_PATH=/usr/bin/chromium node --test scripts/app-navigation.test.mjs
// The optional browser pass uses the same real component and never reaches a live service.
test('App mobile navigation owns presentation and preserves selection behavior', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'app-navigation-'));
  let dom;
  try {
    await build({ configFile:false, root, logLevel:'error', define:{'process.env.NODE_ENV':'"production"'}, plugins:[{
      name:'navigation-fixture', enforce:'pre',
      resolveId(id) { if (id === fixtureId) return id; },
      load(id) { if (id === fixtureId) return fixture; },
    }, react()], build:{outDir:output,lib:{entry:fixtureId,name:'NavigationQA',formats:['iife'],fileName:'fixture'},minify:false} });
    const script = await readFile(path.join(output, 'fixture.iife.js'), 'utf8');
    function mount(props = {}, hash = '/search') {
      dom?.window.close();
      const console = new VirtualConsole();
      const errors = [];
      console.on('jsdomError', error => errors.push(error.message));
      dom = new JSDOM('<div id="root"></div>', {url:`https://navigation.test/#${hash}`,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console});
      const w = dom.window;
      w.qaNavProps = props;
      w.qaRuntimeErrors = errors;
      w.qaScroll = [];
      w.scrollTo = (...args) => w.qaScroll.push(args);
      w.fetch = () => { throw new Error('Unexpected real network'); };
      w.eval(script);
      return w;
    }
    const actions = w => JSON.parse(JSON.stringify(w.qaActions));

    await t.test('App keeps account form visibility and passes navigation state rather than duplicating tab behavior', async () => {
      const source = await readFile(path.join(root, 'src/App.jsx'), 'utf8');
      assert.match(source, /!\(needsAccountHolder \|\| openAccountForm\) && <MobileNavigation/);
      for (const name of ['me','hasEmp','empCtx','curHash','safeTab','navFlip','navBadges','meAvatar','showJobPost','chatAppId']) assert.ok(source.includes(`${name}={${name}}`), name);
      assert.match(source, /tabUrlKeys=\{TAB_URL_KEYS\}/);
      assert.doesNotMatch(source, /const (navTabs|visitorNav|calendarTab|postTab) =/);
    });
    await t.test('visitor tabs retain installation and login destinations without profile redirects', () => {
      const w = mount();
      assert.deepEqual(labelButtons(w).map(el=>el.querySelector('.label').textContent), ['さがす','入れ方','登録・ログイン']);
      assert.deepEqual(activeLabels(w), ['さがす']);
      button(w, '入れ方').click();
      assert.equal(w.location.hash, '#/install');
      assert.deepEqual(actions(w), [['menu',false],['tab','install']]);
      button(w, '登録・ログイン').click();
      assert.equal(w.location.hash, '#/login');
      assert.deepEqual(actions(w).slice(-2), [['menu',false],['tab','login']]);
      assert.deepEqual(w.qaRuntimeErrors, []);
    });
    await t.test('calendar follows employer capability independently of active role', () => {
      for (const [hasEmp, empCtx, expected] of [[false,false,'#/saved'],[true,false,'#/profile/employer/calendar'],[true,true,'#/profile/employer/calendar']]) {
        const w = mount({me:signedIn,hasEmp,empCtx});
        button(w,'カレンダー').click();
        assert.equal(w.location.hash,expected);
        assert.equal(!!button(w,'掲載'),empCtx);
        assert.equal(button(w,'カレンダー').getAttribute('data-prefetch-route'),hasEmp?'/emp-calendar':'/saved');
        assert.deepEqual(w.qaRuntimeErrors,[]);
      }
    });
    await t.test('route changes and role changes recompute highlighting, badges and avatars', () => {
      const w = mount({me:signedIn,hasEmp:true,empCtx:true,navBadges:{chat_threads:120,review_due:2,todo:8},meAvatar:{name:'働',empName:'農'},navFlip:'nav-flip'},'/work/new/page/crop');
      assert.deepEqual(activeLabels(w),['掲載']);
      assert.ok(button(w,'チャット').textContent.includes('99+'));
      assert.ok(button(w,'チャット').querySelector('.cb-jump'));
      assert.ok(button(w,'マイページ').textContent.includes('農'));
      assert.ok(w.document.querySelector('.nav-flip'));
      w.qaRenderNav({curHash:'profile/employer/calendar',navBadges:{},empCtx:false});
      assert.deepEqual(activeLabels(w),['カレンダー']);
      assert.equal(button(w,'掲載'),undefined);
      assert.equal(button(w,'チャット').querySelector('.cb-jump'),null);
      assert.ok(button(w,'マイページ').textContent.includes('働'));
      assert.deepEqual(w.qaRuntimeErrors,[]);
    });
    await t.test('profile item and schedule return paths take precedence over active-tab reload', () => {
      for (const [hash, expected] of [
        ['/profile/worker/profile/nickname','#/profile/worker/profile'],
        ['/profile/employer/profile/address','#/profile/employer/profile'],
        ['/profile/worker/schedule/00000000-0000-4000-8000-000000000001','#/profile/worker'],
        ['/profile/employer/schedule/00000000-0000-4000-8000-000000000001','#/profile/employer'],
      ]) {
        const w = mount({me:signedIn,hasEmp:true},hash);
        assert.deepEqual(activeLabels(w),['マイページ']);
        button(w,'マイページ').click();
        assert.equal(w.location.hash,expected);
        assert.equal(w.sessionStorage.getItem('cb_topAfterReload'),null);
        assert.deepEqual(actions(w),[['menu',false]]);
        assert.deepEqual(w.qaRuntimeErrors,[]);
      }
    });
    await t.test('ordinary repeated tab requests reload from the top but listing and chat input are protected', () => {
      let w = mount({me:signedIn});
      button(w,'さがす').click();
      assert.equal(w.sessionStorage.getItem('cb_topAfterReload'),'1');
      assert.deepEqual(w.qaScroll,[[0,0]]);
      assert.equal(w.qaRuntimeErrors.length,1);
      assert.match(w.qaRuntimeErrors[0],/Not implemented: navigation/, 'JSDOM reports the requested real reload');
      for (const protection of [{showJobPost:true},{chatAppId:'fixture-chat'}]) {
        w = mount({me:signedIn,...protection});
        button(w,'さがす').click();button(w,'さがす').click();
        assert.equal(w.sessionStorage.getItem('cb_topAfterReload'),null);
        assert.deepEqual(w.qaScroll,[]);
        assert.deepEqual(actions(w),[['menu',false],['tab','search'],['menu',false],['tab','search']]);
        assert.deepEqual(w.qaRuntimeErrors,[]);
      }
    });
    await t.test('profile navigation dispatches only the current role home event', () => {
      for (const empCtx of [false,true]) {
        const w = mount({me:signedIn,hasEmp:true,empCtx});
        button(w,'マイページ').click();
        assert.equal(w.location.hash,empCtx?'#/profile/employer':'#/profile/worker');
        assert.deepEqual(actions(w),empCtx?[['menu',false],['event','cb:employerHome']]:[['menu',false],['tab','profile'],['event','cb:workerHome']]);
        assert.deepEqual(w.qaRuntimeErrors,[]);
      }
    });

    if (process.env.CB_NAV_BROWSER === '1') {
      await t.test('synthetic Chromium preserves history, real reload and narrow-screen layout', async () => {
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
        const evidence = process.env.CB_EVIDENCE_DIR || path.join(tmpdir(),'app-navigation-evidence');
        const results = [];
        try {
          await mkdir(evidence,{recursive:true});
          for (const width of [360,390,768]) {
            const context = await browser.newContext({viewport:{width,height:844},locale:'ja-JP'});
            const errors = [];
            await context.route('**/*',route => {
              const url = new URL(route.request().url());
              if (url.origin !== 'https://navigation.test') return route.abort();
              if (url.pathname === '/') return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script src="/fixture.js"></script>'});
              if (url.pathname === '/fixture.js') return route.fulfill({contentType:'text/javascript',body:script});
              return route.abort();
            });
            await context.addInitScript(() => { sessionStorage.setItem('qaLoads',String(Number(sessionStorage.getItem('qaLoads') || 0)+1)); });
            const page = await context.newPage();
            page.on('pageerror',e=>errors.push(e.message));
            await page.goto('https://navigation.test/#/search');
            await page.locator('.app-header-mobile-tab').first().waitFor();
            await page.getByRole('button',{name:'入れ方',exact:true}).click();
            await page.waitForURL('**/#/install');
            await page.getByRole('button',{name:'登録・ログイン',exact:true}).click();
            await page.waitForURL('**/#/login');
            await page.goBack();await page.waitForURL('**/#/install');
            await page.waitForFunction(()=>document.querySelector('.app-header-mobile-tab.active .label')?.textContent==='入れ方');
            assert.equal(await page.locator('.app-header-mobile-tab.active .label').textContent(),'入れ方');
            await page.goForward();await page.waitForURL('**/#/login');
            const before = await page.evaluate(()=>Number(sessionStorage.getItem('qaLoads')));
            await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'登録・ログイン',exact:true}).click()]);
            await page.locator('.app-header-mobile-tab').first().waitFor();
            assert.equal(await page.evaluate(()=>Number(sessionStorage.getItem('qaLoads'))),before+1);
            assert.equal(await page.evaluate(()=>sessionStorage.getItem('cb_topAfterReload')),'1');
            await page.evaluate(()=>window.qaRenderNav({me:{id:'fixture-user',name:'合成ユーザー'},hasEmp:true,empCtx:true,navBadges:{chat_threads:120,review_due:2},showJobPost:true}));
            assert.equal(await page.locator('.app-header-mobile-tab').count(),5);
            assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
            await page.getByRole('button',{name:'掲載',exact:true}).click();
            await page.waitForURL('**/#/profile/employer/drafts');
            await page.getByRole('button',{name:'掲載',exact:true}).click();
            assert.equal(await page.evaluate(()=>Number(sessionStorage.getItem('qaLoads'))),before+1);
            await page.screenshot({path:path.join(evidence,`navigation-${width}.png`)});
            assert.deepEqual(errors,[]);
            results.push({width,history:true,reload:true,inputProtection:true,overflow:false,pageErrors:0});
            await context.close();
          }
          await writeFile(path.join(evidence,'results.json'),JSON.stringify(results,null,2));
          console.log(`Navigation browser evidence: ${evidence}`);
        } finally { await browser.close(); }
      });
    }
  } finally { dom?.window.close(); await rm(output,{recursive:true,force:true}); }
});
