import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
const root = fileURLToPath(new URL('../',import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
async function until(fn) { const end = Date.now()+4000; while(!fn()) { assert.ok(Date.now()<end,'render completes'); await pause(10); } }
test('real common frame preserves navigation, busy gates, IDs and existing layout',async t => {
  const output=await mkdtemp(path.join(tmpdir(),'cb-listing-frame-')); let dom;
  try {
    await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/listing-frame-entry.jsx'),name:'ListingFrameQA',formats:['iife'],fileName:'fixture'},minify:false}});
    const errors=[]; const virtualConsole=new VirtualConsole(); virtualConsole.on('jsdomError', e=>errors.push(e.message));
    dom=new JSDOM('<div id="root"></div>',{url:'https://ui.test',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole});
    const w=dom.window; w.qaEvents=[]; w.eval(await readFile(path.join(output,'fixture.iife.js'),'utf8'));
    await until(()=>w.qaRender);
    const q=selector=>w.document.querySelector(selector);
    async function render(props) { const rev=Number(q('[data-revision]').dataset.revision); w.qaEvents=[]; w.qaRender(props); await until(()=>Number(q('[data-revision]').dataset.revision)>rev); }
    await t.test('all legacy input pages retain labels, section, skip policy and width class',async()=>{
      for(let n=0;n<=12;n++) {
        await render({step:n});
        assert.equal(q('.listing-next').textContent,n===0?'はじめる':n===12?'掲載する':n===11?'確認へ':'次へ');
        assert.equal(q('.listing-save').textContent,n===0?'終了':'保存して終了');
        assert.equal(!!q('.listing-skip'),n>=6&&n<=11);
        assert.equal(q('[data-step]').classList.contains('listing-page-wide'),[0,6,12].includes(n));
        assert.equal(q('[aria-current="step"]').textContent.startsWith(String(n>=12?3:n>=6?2:1)),true);
        q('.listing-next').click(); assert.deepEqual(Array.from(w.qaEvents),[n===12?'publish':'next']);
      }
    });
    await t.test('named IDs use the same common header, footer and body',async()=>{
      await render({step:'schedule'}); assert.equal(q('[data-step-id]').dataset.stepId,'schedule');
      q('.listing-back').click();q('.listing-save').click();assert.deepEqual(Array.from(w.qaEvents),['back','save']);
      await render({step:'review',editingOpen:true}); assert.equal(q('.listing-next').textContent,'変更を保存');
      q('.listing-next').click();assert.deepEqual(Array.from(w.qaEvents),['publish']);
    });
    await t.test('saving and publication gates cannot trigger a second operation',async()=>{
      await render({step:'review',busy:true,saving:true});
      assert.equal(q('.listing-save').textContent,'保存中…');
      for(const selector of ['.listing-save','.listing-back','.listing-next']) {assert.equal(q(selector).disabled,true);q(selector).click();}
      assert.deepEqual(Array.from(w.qaEvents),[]);
      await render({step:12,publishDisabled:true});assert.equal(q('.listing-next').disabled,true);
      await render({step:4,canNext:false});assert.equal(q('.listing-next').disabled,true);
      await render({step:'unknown'});assert.equal(q('.listing-next').disabled,true);
    });
    await t.test('review round-trip, upload label and absent save action retain their semantics',async()=>{
      await render({step:8,returnToConfirm:true});assert.equal(q('.listing-next').textContent,'確認に戻る');assert.equal(q('.listing-back').textContent,'確認に戻る');assert.equal(q('.listing-skip'),null);
      await render({step:7,uploading:true,busy:true});assert.equal(q('.listing-next').textContent,'アップロード中…');assert.equal(q('.listing-next').disabled,true);
      await render({step:3,noSave:true});assert.equal(q('.listing-save').textContent,'閉じる');q('.listing-save').click();assert.deepEqual(Array.from(w.qaEvents),['exit']);
      await render({step:7});q('.listing-skip').click();assert.deepEqual(Array.from(w.qaEvents),['skip']);
    });
    await t.test('shared body has no extra nesting, no hidden page data and preserves worker layout',async()=>{
      await render({step:4});assert.equal(q('[data-step] > input').value,'入力内容');assert.equal(q('[data-step]').getAttribute('style'),null);
      await render({step:4,isFarmer:false,embedded:true});assert.equal(q('[data-step]').style.maxWidth,'480px');assert.equal(q('[data-step]').hasAttribute('data-step-id'),false);assert.equal(q('[data-step]').className,'fade-in');
      await render({step:12,isFarmer:false});assert.equal(q('[data-step]').style.maxWidth,'1280px');
      await render({step:4,hidden:true});assert.equal(q('.listing-footer').hidden,true);
    });
    assert.deepEqual(errors,[]);
  } finally { dom?.window.close();await rm(output,{recursive:true,force:true}); }
});
