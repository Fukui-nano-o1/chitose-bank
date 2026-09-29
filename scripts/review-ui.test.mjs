import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require(process.env.CB_TEST_NODE_MODULES ? `${process.env.CB_TEST_NODE_MODULES}/jsdom` : 'jsdom');
const root = fileURLToPath(new URL('../', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const button = (scope, label) => [...scope.querySelectorAll('button')].find(el => el.textContent.trim() === label || el.getAttribute('aria-label') === label);
const title = w => w.document.querySelector('#work-review-title')?.textContent;
async function until(predicate, label) {
  const deadline = Date.now() + 4000;
  while (!predicate()) { assert.ok(Date.now() < deadline, `timed out: ${label}`); await pause(10); }
}
async function press(w, label, expectedTitle) {
  const el = button(w.document, label); assert.ok(el, label); el.click();
  if (expectedTitle) await until(() => title(w) === expectedTitle, label);
  else await pause(15);
}
async function toggle(w, label, expected = true) {
  const el = [...w.document.querySelectorAll('[aria-pressed]')].find(node => node.querySelector('strong')?.textContent === label);
  assert.ok(el, label); el.click();
  await until(() => el.getAttribute('aria-pressed') === String(expected), label);
}
const negativePage = w => press(w, '悪い点へ', '悪かった点はありますか？');
const confirm = w => press(w, '内容を確認', 'この内容で送信しますか？');
async function save(w) { await press(w, '送信する'); await until(() => w.qaDone.length === 1, 'saved'); return w.qaInserts[0]; }
const keys = ['as_described', 'instructions_clear', 'safety_care', 'paid_as_posted', 'want_again'];

test('work review has 20 positive choices, 20 negative choices and a separate confirmation in both directions', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'cb-review-'));
  let dom;
  const errors = [];
  try {
    await build({ configFile:false, root, logLevel:'error', define:{ 'process.env.NODE_ENV':'"production"' }, plugins:[{
      name:'review-fixture', enforce:'pre', resolveId(id) {
        if (/(?:^|\/)supabase(?:\.js)?$/.test(id)) return path.join(root,'scripts/fixtures/reviews/client.js');
      },
    }, react()], build:{ outDir:output, lib:{ entry:path.join(root,'scripts/fixtures/reviews/entry.jsx'), name:'ReviewQA', formats:['iife'], fileName:'fixture' }, minify:false } });
    const script = await readFile(path.join(output,'fixture.iife.js'),'utf8');
    const cssFile = (await readdir(output)).find(name => name.endsWith('.css'));
    const css = await readFile(path.join(output,cssFile),'utf8');
    async function mount(settings={}) {
      dom?.window.close();
      const console = new VirtualConsole();
      console.on('jsdomError', error => errors.push(error.message));
      console.on('error', (...args) => errors.push(args.join(' ')));
      dom = new JSDOM('<button id="opener">評価を開く</button><div id="root" style="transform:translateX(10px)"></div>', { url:'https://review.test/', runScripts:'dangerously', pretendToBeVisual:true, virtualConsole:console });
      const w = dom.window;
      Object.assign(w, { qaInserts:[], qaSelects:[], qaDone:[], ...settings });
      if (settings.qaViewport) Object.defineProperty(w,'visualViewport',{ value:Object.assign(new w.EventTarget(),settings.qaViewport) });
      const style = w.document.createElement('style'); style.textContent = css; w.document.head.append(style);
      w.document.querySelector('#opener').focus();
      w.eval(script);
      await until(() => ['badges','own'].includes(settings.qaMode) ? w.document.querySelector('#root').textContent.trim()
        : settings.qaMode?.startsWith('farmer') ? w.document.body.textContent.includes('記録された問題はありません')
          : w.document.activeElement?.id === 'work-review-title', 'initial effects');
      return w;
    }
    await t.test('each page contains 20 choices in five groups; navigation never saves; skipped values remain null', async () => {
      const w = await mount();
      assert.equal(title(w),'良かった点はありますか？');
      assert.equal(w.document.querySelectorAll('[aria-pressed]').length,20);
      assert.equal(w.document.querySelectorAll('.work-review-group').length,5);
      assert.equal(button(w.document,'送信する'),undefined);
      await negativePage(w);
      assert.equal(w.document.querySelectorAll('[aria-pressed]').length,20);
      await confirm(w); assert.equal(w.qaInserts.length,0);
      assert.match(w.document.body.textContent,/項目を選択せずに、この仕事の評価を終了/);
      const payload = await save(w);
      for (const key of [...keys,'match_level','pay_status','want_again_choice']) assert.equal(payload[key],null,key);
      assert.equal(payload.direction,'worker_to_farmer');
      assert.equal(payload.traits.length,0);
    });
    await t.test('new worker choices survive editing and save separate positive and private negative tags', async () => {
      const w = await mount();
      await toggle(w,'集合場所の案内が分かりやすかった');
      await toggle(w,'必要な道具が用意されていた');
      await negativePage(w);
      await toggle(w,'集合場所の案内が分かりにくかった');
      await toggle(w,'休憩や水分補給を取りにくかった');
      await confirm(w);
      await press(w,'良い点を変更','良かった点はありますか？');
      assert.equal(w.document.querySelectorAll('[aria-pressed="true"]').length,1);
      await negativePage(w); await confirm(w);
      const payload = await save(w);
      assert.deepEqual([...payload.traits],['job_meeting_clear_improve','job_tools_ready_good','job_rest_water_improve']);
      assert.equal(payload.pay_status,null);
    });
    await t.test('mixed answers survive back navigation and editing confirmation; opposite selection replaces the earlier answer', async () => {
      const w = await mount();
      await toggle(w,'求人の内容どおりだった');
      await toggle(w,'説明・教え方が分かりやすかった');
      await negativePage(w);
      assert.match(w.document.body.textContent,/良い点から変更できます/);
      await toggle(w,'求人の内容と違いがあった');
      assert.match(w.document.querySelector('[role="status"]').textContent,/仕事内容.*悪い点に変更/);
      await toggle(w,'安全や休憩への配慮が足りなかった');
      await confirm(w);
      assert.equal(w.document.querySelector('[aria-label="良い点の確認"] li').textContent,'説明・教え方が分かりやすかった');
      assert.equal(w.document.querySelectorAll('[aria-label="悪い点の確認"] li').length,2);
      await press(w,'良い点を変更','良かった点はありますか？');
      assert.equal(w.document.querySelectorAll('[aria-pressed="true"]').length,1);
      await toggle(w,'またこの農家で働きたい');
      await negativePage(w); await confirm(w);
      await press(w,'悪い点を変更','悪かった点はありますか？');
      assert.equal(w.document.querySelectorAll('[aria-pressed="true"]').length,2);
      await confirm(w);
      const payload = await save(w);
      assert.equal(payload.as_described,false); assert.equal(payload.match_level,null);
      assert.equal(payload.instructions_clear,true); assert.equal(payload.safety_care,false);
      assert.equal(payload.want_again_choice,'yes'); assert.equal(payload.paid_as_posted,null);
    });
    await t.test('choices can be cleared and changing the job or account resets the form and page', async () => {
      const w = await mount();
      await toggle(w,'説明・教え方が分かりやすかった');
      await toggle(w,'説明・教え方が分かりやすかった',false);
      assert.equal(w.document.querySelectorAll('[aria-pressed="true"]').length,0);
      await toggle(w,'求人の内容どおりだった'); await negativePage(w); await confirm(w);
      w.qaSetApp({id:'application-b',farmer_id:'farmer-b'});
      await until(()=>title(w)==='良かった点はありますか？','new job');
      assert.equal(w.document.querySelectorAll('[aria-pressed="true"]').length,0);
      await toggle(w,'求人の内容どおりだった');
      w.qaSetMeId('worker-b');
      await until(()=>w.document.querySelectorAll('[aria-pressed="true"]').length===0,'new account');
      await negativePage(w); await confirm(w);
      const payload=await save(w);
      assert.equal(payload.application_id,'application-b'); assert.equal(payload.reviewer_id,'worker-b');
      assert.equal(payload.reviewee_id,'farmer-b');
    });
    await t.test('a pay complaint is not automatically an unpaid report; explicit unpaid consent is shown and reset when changed', async () => {
      let w = await mount(); await negativePage(w);
      await toggle(w,'報酬が約束どおりではなかった'); await confirm(w);
      assert.doesNotMatch(w.document.body.textContent,/未払いとして申告します/);
      assert.equal((await save(w)).pay_status,'other');
      w = await mount(); await negativePage(w);
      await toggle(w,'報酬が約束どおりではなかった');
      w.document.querySelector('input[type="checkbox"]').click();
      await confirm(w); assert.match(w.document.body.textContent,/未払いとして申告します/);
      assert.match(w.document.body.textContent,/未払いの申告として運営にも記録/);
      assert.equal((await save(w)).pay_status,'unpaid');
      w = await mount(); await negativePage(w);
      await toggle(w,'報酬が約束どおりではなかった');
      w.document.querySelector('input[type="checkbox"]').click();
      await press(w,'前のページに戻る','良かった点はありますか？');
      await toggle(w,'報酬が約束どおりだった');
      await negativePage(w); await toggle(w,'報酬が約束どおりではなかった');
      assert.equal(w.document.querySelector('input[type="checkbox"]').checked,false);
    });
    await t.test('failed saves retain choices, support retry and block duplicate clicks while saving', async () => {
      const w = await mount({qaFailSave:true});
      await toggle(w,'安全や休憩への配慮があった'); await negativePage(w); await confirm(w);
      await press(w,'送信する'); await until(()=>w.document.querySelector('[role="alert"]'),'inline failure');
      assert.equal(w.qaDone.length,0);
      assert.match(w.document.body.textContent,/安全や休憩への配慮があった/);
      w.qaFailSave=false; w.qaHoldSave=true;
      const send=button(w.document,'送信する'); send.click(); send.click();
      await until(()=>w.qaReleaseSave,'held save');
      assert.equal(w.qaInserts.length,2,'one failure and one retry only');
      assert.equal(button(w.document,'評価を閉じる').disabled,true);
      w.qaReleaseSave(); await until(()=>w.qaDone.length===1,'retry saved');
      assert.deepEqual(w.qaInserts[0],w.qaInserts[1]);
    });
    await t.test('a transport exception can be retried and an already submitted review has a way back', async () => {
      let w = await mount({qaThrowSave:true}); await negativePage(w); await confirm(w);
      await press(w,'送信する'); await until(()=>w.document.querySelector('[role="alert"]'),'transport error');
      w.qaThrowSave=false; await save(w);
      w = await mount({qaFailSave:true,qaFailCode:'23505'}); await negativePage(w); await confirm(w);
      await press(w,'送信する'); await until(()=>button(w.document,'評価済みの仕事に戻る'),'duplicate handled');
      assert.match(w.document.body.textContent,/すでに送信されています/);
      assert.equal(w.qaDone.length,0);
      await press(w,'評価済みの仕事に戻る');
      assert.equal(w.qaDone.length,1); assert.equal(w.qaInserts.length,1);
    });
    await t.test('viewport fitting, independent scrolling, keyboard focus and close work inside a transformed parent', async () => {
      const w = await mount({qaViewport:{width:300,height:440,scale:1.3,offsetLeft:12,offsetTop:30}});
      const shell=w.document.querySelector('[role="dialog"]');
      assert.equal(shell.parentElement,w.document.body);
      assert.equal(shell.style.height,'440px'); assert.equal(shell.style.width,'300px');
      assert.equal(shell.style.transform,'translate(12px, 30px)');
      assert.equal(w.getComputedStyle(shell).position,'fixed');
      assert.equal(w.getComputedStyle(shell).flexDirection,'column');
      assert.equal(w.getComputedStyle(w.document.querySelector('.work-review-scroll')).overflowY,'auto');
      assert.equal(w.getComputedStyle(w.document.querySelector('.work-review-header')).flexShrink,'0');
      assert.equal(w.getComputedStyle(w.document.querySelector('.work-review-footer')).flexShrink,'0');
      assert.equal(w.document.body.style.overflow,'hidden');
      await negativePage(w);
      const close=button(w.document,'評価を閉じる');
      assert.ok(close); assert.ok(button(w.document,'前のページに戻る'));
      button(w.document,'内容を確認').focus();
      shell.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
      assert.equal(w.document.activeElement,button(w.document,'前のページに戻る'));
      w.visualViewport.height=330; w.visualViewport.offsetTop=65; w.visualViewport.dispatchEvent(new w.Event('resize'));
      await until(()=>shell.style.height==='330px','viewport resize');
      assert.equal(shell.style.transform,'translate(12px, 65px)');
      close.click(); await until(()=>!w.document.querySelector('[role="dialog"]'),'close');
      assert.equal(w.document.body.style.overflow,''); assert.equal(w.document.activeElement.id,'opener');
    });
    await t.test('shared employer review remains usable', async () => {
      const w = await mount({qaMode:'farmer'});
      assert.equal(w.document.querySelector('details'),null);
      await press(w,'完了した'); await press(w,'送信する');
      await until(()=>w.document.body.textContent.includes('これで送信します'),'employer confirmation');
      await press(w,'送信する'); await until(()=>w.qaDone.length===1,'employer save');
    });
    await t.test('expanded farmer flow requires its core answers and retains all choices when returning along the same steps', async () => {
      const w = await mount({qaMode:'farmer-expanded'});
      assert.equal(button(w.document,'良い点へ').disabled,true);
      await press(w,'予定どおり完了'); await press(w,'はい');
      await press(w,'良い点へ','良かった点はありますか？');
      assert.equal(w.document.querySelectorAll('[aria-pressed]').length,20);
      assert.equal(w.document.querySelectorAll('.work-review-group').length,5);
      await toggle(w,'丁寧だった'); await toggle(w,'周りと協力して作業した');
      await negativePage(w);
      assert.equal(w.document.querySelectorAll('[aria-pressed]').length,20);
      await toggle(w,'作業に問題があった'); await toggle(w,'安全上の注意が守られなかった');
      await press(w,'前のページに戻る','良かった点はありますか？');
      assert.equal(w.document.querySelectorAll('[aria-pressed="true"]').length,1);
      await press(w,'前のページに戻る','今回の仕事を完了する');
      assert.equal(button(w.document,'はい').getAttribute('aria-pressed'),'true');
      await press(w,'一部完了'); await press(w,'良い点へ');
      await negativePage(w); await confirm(w);
      assert.match(w.document.body.textContent,/一部完了/);
      assert.equal(w.qaInserts.length,0);
      const payload=await save(w);
      assert.equal(payload.work_outcome,'partial');
      assert.deepEqual([...payload.traits].sort(),['safety_issue','teamwork','work_issue']);
    });
    await t.test('author history includes the new selections and only requests this author and recipient', async () => {
      const w = await mount({qaMode:'own',qaMyReviews:[{id:'r1',created_at:'2026-09-29',want_again_choice:'neutral',want_again:null,work_outcome:'partial',traits:['careful','teamwork','safety_issue']}]});
      assert.match(w.document.body.textContent,/また呼びたい：どちらともいえない/);
      assert.match(w.document.body.textContent,/仕事の完了：一部完了/);
      assert.match(w.document.body.textContent,/良い点：丁寧だった・周りと協力して作業した/);
      assert.match(w.document.body.textContent,/悪い点（非公開）：安全上の注意が守られなかった/);
      assert.deepEqual(JSON.parse(JSON.stringify(w.qaSelects[0].filters)),[['reviewer_id','farmer-a'],['reviewee_id','reviewed-worker'],['direction','farmer_to_worker']]);
    });
    await t.test('new positive badges and historical counts stay visible while negative tags never render', async () => {
      let w = await mount({qaMode:'badges',qaBadges:{ok:true,badges:{instructions_clear:2,safety_care:1,on_time:3},comments:[]}});
      assert.match(w.document.body.textContent,/教え方が分かりやすい 2/);
      assert.match(w.document.body.textContent,/安全に配慮 1/);
      assert.match(w.document.body.textContent,/時間どおりに開始 3/);
      w = await mount({qaMode:'badges',qaShowAll:true,qaBadges:{ok:true,badges:{},comments:[]}});
      for (const label of ['また働きたい','求人のとおりだった','報酬は約束どおり','教え方が分かりやすい','安全に配慮']) assert.ok(w.document.body.textContent.includes(label));
      assert.doesNotMatch(w.document.body.textContent,/時間どおりに開始/);
      assert.equal(w.document.querySelectorAll('b').length,20);
      w = await mount({qaMode:'badges',qaBadges:{ok:true,badges:{trait_job_tools_ready_good:2,trait_job_meeting_clear_improve:3},comments:[]}});
      assert.match(w.document.body.textContent,/必要な道具が用意されていた 2/);
      assert.doesNotMatch(w.document.body.textContent,/集合場所の案内が分かりにくかった/);
      w = await mount({qaMode:'badges',qaDirection:'farmer_to_worker',qaBadges:{ok:true,badges:{trait_careful:1,trait_teamwork:2,trait_safety_issue:3},comments:[]}});
      assert.match(w.document.body.textContent,/丁寧だった 1/);
      assert.match(w.document.body.textContent,/周りと協力して作業した 2/);
      assert.doesNotMatch(w.document.body.textContent,/安全上の注意が守られなかった/);
    });
    assert.deepEqual(errors,[]);
  } finally { dom?.window.close(); await rm(output,{recursive:true,force:true}); }
});
