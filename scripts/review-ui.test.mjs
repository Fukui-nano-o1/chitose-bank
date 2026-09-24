import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require(process.env.CB_TEST_NODE_MODULES ? `${process.env.CB_TEST_NODE_MODULES}/jsdom` : 'jsdom');
const root = fileURLToPath(new URL('../', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const button = (scope, label) => [...scope.querySelectorAll('button')].find(el => el.textContent.trim() === label);
async function until(predicate, label) {
  const deadline = Date.now() + 4000;
  while (!predicate()) { assert.ok(Date.now() < deadline, `timed out: ${label}`); await pause(10); }
}
async function choose(w, question, answer) {
  const field = [...w.document.querySelectorAll('fieldset')].find(el => el.querySelector('legend')?.textContent.includes(question));
  assert.ok(field, question);
  const choice = button(field, answer);
  assert.ok(choice, answer); choice.click();
  await until(() => choice.getAttribute('aria-pressed') === 'true', answer);
}
async function requiredAnswers(w) {
  await choose(w, '求人に書かれていた', '一致していた');
  await choose(w, '報酬は', '支払われた');
  await choose(w, 'またこの農家', 'はい');
}
async function confirm(w) {
  button(w.document, '送信する').click();
  await until(() => w.document.body.textContent.includes('これで送信します'), 'confirmation');
}

test('work review optional answers preserve completion, values and confirmation', async t => {
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
    async function mount(settings={}) {
      dom?.window.close();
      const console = new VirtualConsole();
      console.on('jsdomError', error => errors.push(error.message));
      console.on('error', (...args) => errors.push(args.join(' ')));
      dom = new JSDOM('<div id="root"></div>', { url:'https://review.test/', runScripts:'dangerously', pretendToBeVisual:true, virtualConsole:console });
      const w = dom.window;
      Object.assign(w, { qaInserts:[], qaDone:[], qaAlerts:[], ...settings });
      w.alert = message => w.qaAlerts.push(message);
      w.eval(script);
      await until(() => w.document.body.textContent.trim(), 'mount');
      if (settings.qaMode !== 'badges') await until(() => w.document.body.textContent.includes('記録された問題はありません'), 'initial effects and day facts');
      return w;
    }
    await t.test('three required answers submit without the optional section; skipped fields stay null', async () => {
      const w = await mount();
      button(w.document,'送信する').click();
      assert.equal(w.qaInserts.length,0);
      assert.doesNotMatch(w.document.body.textContent,/これで送信します/);
      assert.equal(w.document.querySelector('details').open,false);
      await requiredAnswers(w); await confirm(w);
      assert.match(w.document.body.textContent,/任意の項目は未回答/);
      button(w.document,'送信する').click();
      await until(() => w.qaDone.length === 1,'saved');
      assert.equal(w.qaInserts.length,1);
      for (const key of ['instructions_clear','safety_care','on_time']) assert.equal(w.qaInserts[0][key],null);
      assert.equal(w.qaInserts[0].paid_as_posted,true);
    });
    await t.test('yes/no/unknown retain distinct safe meanings and confirmation can be edited', async () => {
      const w = await mount(); await requiredAnswers(w);
      w.document.querySelector('summary').click();
      assert.equal(w.document.querySelector('details').open,true);
      await choose(w,'仕事の教え方','分かりやすかった');
      await choose(w,'安全に作業','配慮が足りなかった');
      await choose(w,'仕事は約束した時間','判断できない');
      await confirm(w);
      assert.match(w.document.body.textContent,/分かりやすかった/);
      assert.match(w.document.body.textContent,/配慮が足りなかった/);
      assert.match(w.document.body.textContent,/判断できない/);
      button(w.document,'もどって直す').click();
      await until(() => w.document.querySelector('fieldset'),'edit');
      assert.equal(w.document.querySelectorAll('[aria-pressed="true"]').length,6);
      await confirm(w); button(w.document,'送信する').click();
      await until(() => w.qaDone.length === 1,'saved details');
      const saved = w.qaInserts[0];
      assert.equal(saved.instructions_clear,true);
      assert.equal(saved.safety_care,false);
      assert.equal(saved.on_time,null);
    });
    await t.test('clearing optional choices removes them from confirmation and new jobs reset answers', async () => {
      const w = await mount(); await requiredAnswers(w);
      await choose(w,'仕事の教え方','分かりやすかった');
      button(w.document,'回答を取り消す').click();
      await until(() => !button(w.document,'回答を取り消す'),'cleared');
      await confirm(w);
      assert.doesNotMatch(w.document.body.textContent,/仕事の教え方や指示/);
      w.qaSetApp({ id:'application-b', farmer_id:'farmer-b' });
      await until(() => w.document.querySelector('fieldset'),'other job');
      assert.equal(w.document.querySelectorAll('[aria-pressed="true"]').length,0);
      assert.equal(w.qaInserts.length,0);
    });
    await t.test('failed saves keep all choices for retry and unpaid disclosure still appears', async () => {
      const w = await mount({ qaFailSave:true }); await requiredAnswers(w);
      await choose(w,'報酬は','未払い');
      await choose(w,'安全に作業','配慮があった');
      await confirm(w);
      assert.match(w.document.body.textContent,/未払いの申告として運営にも記録/);
      button(w.document,'送信する').click();
      await until(() => w.qaAlerts.length === 1,'save failed');
      assert.equal(w.qaDone.length,0);
      assert.match(w.document.body.textContent,/配慮があった/);
      w.qaFailSave=false; button(w.document,'送信する').click();
      await until(() => w.qaDone.length === 1,'retry');
      assert.deepEqual(w.qaInserts[0],w.qaInserts[1]);
    });
    await t.test('shared employer review remains usable without optional questions', async () => {
      const w = await mount({qaMode:'farmer'});
      assert.equal(w.document.querySelector('details'),null);
      await choose(w,'予定の仕事','完了した'); await confirm(w);
      button(w.document,'送信する').click();
      await until(() => w.qaDone.length === 1,'employer save');
    });
    await t.test('existing positive badge counts remain visible and all-items lists the three reactivated items', async () => {
      let w = await mount({ qaMode:'badges', qaBadges:{ ok:true, badges:{instructions_clear:2,safety_care:1,on_time:3}, comments:[] } });
      assert.match(w.document.body.textContent,/教え方が分かりやすい 2/);
      assert.match(w.document.body.textContent,/安全に配慮 1/);
      assert.match(w.document.body.textContent,/時間どおりに開始 3/);
      w = await mount({ qaMode:'badges', qaShowAll:true, qaBadges:{ok:true,badges:{},comments:[]} });
      for (const label of ['教え方が分かりやすい','安全に配慮','時間どおりに開始']) assert.ok(w.document.body.textContent.includes(label));
    });
    assert.deepEqual(errors,[]);
  } finally { dom?.window.close(); await rm(output,{recursive:true,force:true}); }
});
