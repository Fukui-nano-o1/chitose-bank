import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtureId = path.join(root, 'scripts/fixtures/navigation-visibility-virtual.jsx');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { assert.ok(Date.now() < deadline, label); await pause(10); }
}
const fixture = `
import React, {useState, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {LoginScreen} from '${root}src/components/LoginScreen.jsx';
import {MobileNavigation} from '${root}src/app/navigation/MobileNavigation.jsx';
import {installTypingVisibility} from '${root}src/app/navigation/typingVisibility.js';
function Journey() {
  const [me,setMe] = useState(window.qaInitialMe || null);
  const [login,setLogin] = useState(!window.qaInitialMe);
  const [hash,setHash] = useState('login');
  useEffect(() => installTypingVisibility(), []);
  useEffect(() => { const f = () => setHash(location.hash.replace(/^#\\/?/,'')); window.addEventListener('hashchange',f); return () => window.removeEventListener('hashchange',f); }, []);
  window.qaHydrate = user => {setMe(user);setLogin(false);};
  window.qaOpenLogin = () => setLogin(true);
  return <><MobileNavigation me={me} hasEmp={!!window.qaFarmer} empCtx={!!window.qaFarmer}
    curHash={hash} safeTab={hash} navFlip="" navBadges={{}} meAvatar={{}}
    tabUrlKeys={['search','saved','profile','chats','login']} setTab={setHash} setMobileMenuOpen={()=>{}} />
    {login && <LoginScreen onLogin={user => {setMe(user);setLogin(false);location.hash='/search';}} />}
    <div id="page-content" />
  </>;
}
const root = createRoot(document.getElementById('root'));
flushSync(() => root.render(<Journey />));
window.qaUnmount = () => flushSync(() => root.unmount());
`;

test('mobile navigation recovers when a focused login or route input disappears without blur', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'cb-navigation-visibility-'));
  let dom;
  try {
    await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
      name:'visibility-fixture',enforce:'pre',
      resolveId(id) { if(id===fixtureId)return id; if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/auth/client.js'); },
      load(id) { if(id===fixtureId)return fixture; },
    },react()],build:{outDir:output,lib:{entry:fixtureId,name:'VisibilityQA',formats:['iife'],fileName:'fixture'},minify:false}});
    const script = await readFile(path.join(output,'fixture.iife.js'),'utf8');
    function mount(settings={}) {
      dom?.window.close();
      const vc=new VirtualConsole(), errors=[];
      vc.on('jsdomError',e=>errors.push(e.message));
      dom=new JSDOM('<div id="root"></div>',{url:'https://navigation.test/#/login',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});
      const w=dom.window;
      Object.assign(w,{Response,Request,Headers,ReadableStream,AbortController,AbortSignal,TextEncoder,TextDecoder,qaRequests:[],qaMode:'success',...settings});
      w.fetch=()=>{throw Error('Unexpected real network');};
      w.scrollTo=()=>{};
      w.qaErrors=errors;
      w.eval(script);
      return w;
    }
    const typing=w=>w.document.body.classList.contains('cb-typing');
    const labels=w=>[...w.document.querySelectorAll('.app-header-mobile-tab .label')].map(el=>el.textContent);
    async function fill(w,selector,value) {
      const el=w.document.querySelector(selector);
      Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(el,value);
      el.dispatchEvent(new w.Event('input',{bubbles:true}));
      await pause(10);return el;
    }
    await t.test('real password login leaves worker and farmer navigation available without reload',async()=>{
      for(const qaFarmer of [null,{id:'fixture-farmer',auth_id:'10000000-0000-4000-8000-000000000001',name:'Synthetic farm'}]) {
        const w=mount({qaFarmer});
        await until(()=>w.document.querySelector('input[name="password"]'),'login mounted');
        await fill(w,'input[type="email"]','person@fixture.test');
        const input=await fill(w,'input[name="password"]','synthetic-password');
        input.focus();assert.equal(typing(w),true);
        let blurs=0;input.addEventListener('focusout',()=>blurs++);
        // Keyboard submission keeps focus on the password until React removes the login screen.
        input.closest('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
        await until(()=>!w.document.querySelector('.cb-login-page'),'login replaced');
        assert.equal(blurs,0,'fixture reproduces removal without focusout');
        await pause(160);
        assert.equal(typing(w),false,'detached login input must not keep the bottom bar hidden');
        assert.ok(labels(w).includes('カレンダー'));
        assert.ok(labels(w).includes('さがす'));
        assert.equal(labels(w).includes('掲載'),!!qaFarmer);
        assert.equal(w.location.hash,'#/search');
        assert.equal(w.qaRequests.filter(r=>r.path==='/auth/v1/token').length,1);
        assert.deepEqual(w.qaErrors,[]);
      }
    });
    await t.test('late authentication hydration and repeated route removal clear stale typing',async()=>{
      const w=mount();await until(()=>w.document.querySelector('input[type="email"]'),'email ready');
      w.document.querySelector('input[type="email"]').focus();assert.equal(typing(w),true);
      w.qaHydrate({id:'fixture-worker',name:'Synthetic worker'});
      await until(()=>!w.document.querySelector('.cb-login-page'),'hydrated');await pause(160);
      assert.equal(typing(w),false);assert.ok(labels(w).includes('カレンダー'));
      for(let i=0;i<3;i++) {
        const parent=w.document.createElement('div'),input=w.document.createElement('textarea');
        parent.append(input);w.document.querySelector('#page-content').append(parent);input.focus();assert.equal(typing(w),true);
        parent.remove();await pause(20);assert.equal(typing(w),false,'route or overlay removes ancestor');
      }
      assert.deepEqual(w.qaErrors,[]);
    });
    await t.test('field switching, failed login, unrelated mutations and cleanup retain keyboard behavior',async()=>{
      const w=mount({qaInvalidPassword:true});await until(()=>w.document.querySelector('input[name="password"]'),'login ready');
      const email=await fill(w,'input[type="email"]','person@fixture.test');
      const password=await fill(w,'input[name="password"]','synthetic-password');
      email.focus();password.focus();await pause(160);assert.equal(typing(w),true);
      w.document.querySelector('#page-content').append(w.document.createElement('span'));await pause(20);assert.equal(typing(w),true);
      password.closest('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
      await until(()=>w.document.querySelector('[role="alert"]'),'login error');assert.equal(typing(w),true,'failure does not reveal chrome over active input');
      password.blur();await pause(160);assert.equal(typing(w),false);
      password.focus();w.qaUnmount();await pause(160);assert.equal(typing(w),false);
      const input=w.document.createElement('input');w.document.body.append(input);input.focus();assert.equal(typing(w),false,'listeners removed');
      assert.deepEqual(w.qaErrors,[]);
    });
    await t.test('Back and Forward keep navigation usable after a focused route is removed',async()=>{
      const w=mount({qaInitialMe:{id:'fixture-worker'}});
      w.location.hash='/search';await until(()=>w.location.hash==='#/search','search route');await pause(30);
      const input=w.document.createElement('input');w.document.querySelector('#page-content').append(input);input.focus();
      w.location.hash='/saved';input.remove();await pause(30);assert.equal(typing(w),false);
      w.history.back();await until(()=>w.location.hash==='#/search','Back restores search');
      assert.equal(typing(w),false);assert.ok(labels(w).includes('カレンダー'));
      w.history.forward();await until(()=>w.location.hash==='#/saved','Forward restores calendar');
      assert.equal(typing(w),false);assert.ok(labels(w).includes('さがす'));
      assert.deepEqual(w.qaErrors,[]);
    });
    await t.test('replacement autofocus remains hidden, non-text controls do not hide, and repeated login is safe',async()=>{
      const w=mount({qaInitialMe:{id:'fixture-worker'}}),host=w.document.querySelector('#page-content');
      const old=w.document.createElement('textarea');host.append(old);old.focus();assert.equal(typing(w),true);
      const replacement=w.document.createElement('input');host.replaceChildren(replacement);replacement.focus();
      await pause(160);assert.equal(typing(w),true,'new field retains keyboard protection');
      const check=w.document.createElement('input');check.type='checkbox';host.append(check);check.focus();
      await pause(160);assert.equal(typing(w),false);
      w.qaOpenLogin();await until(()=>w.document.querySelector('input[name="password"]'),'login reopened');
      w.document.querySelector('input[name="password"]').focus();assert.equal(typing(w),true);
      w.qaHydrate({id:'fixture-worker'});await pause(160);assert.equal(typing(w),false,'repeated login removal recovers');
      assert.deepEqual(w.qaErrors,[]);
    });
    await t.test('App installs cleanup once and mobile CSS retains account-independent visibility rules',async()=>{
      const app=await readFile(path.join(root,'src/App.jsx'),'utf8');
      const css=await readFile(path.join(root,'src/appStyles.js'),'utf8');
      assert.match(app,/useEffect\(\(\) => installTypingVisibility\(\), \[\]\)/);
      assert.match(app,/!\(needsAccountHolder \|\| openAccountForm\) && <MobileNavigation/);
      assert.match(css,/@media \(max-width: 768px\)/);
      assert.match(css,/body\.cb-typing \.app-header-mobile,/);
      assert.match(css,/body:has\(\.cb-login-page\)\.cb-typing \.app-header-mobile \{ display: block !important; \}/);
      assert.match(css,/padding: 0 4px env\(safe-area-inset-bottom, 0px\) !important/);
    });
    await t.test('restored session begins with navigation visible and never requires typing cleanup',async()=>{
      const w=mount({qaInitialMe:{id:'fixture-restored',name:'Synthetic restored user'}});
      assert.equal(typing(w),false);assert.ok(labels(w).includes('カレンダー'));assert.equal(w.document.querySelector('.cb-login-page'),null);
      assert.deepEqual(w.qaErrors,[]);
    });
  } finally {dom?.window.close();await rm(output,{recursive:true,force:true});}
});
