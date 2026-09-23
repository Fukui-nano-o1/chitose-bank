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
const root = fileURLToPath(new URL('../',import.meta.url));
const button = (w,label) => [...w.document.querySelectorAll('button')].find(el=>el.textContent===label);
async function until(predicate,label) {
  const deadline = Date.now()+5000;
  while (!predicate()) { assert.ok(Date.now()<deadline,`timed out: ${label}`); await new Promise(resolve=>setTimeout(resolve,10)); }
}

test('real preferences and PostgREST: no-consent application still works; opt-in, outcomes, revoke, and admin retry', async () => {
  const output = await mkdtemp(path.join(tmpdir(),'cb-analytics-ui-'));
  let dom; const errors=[];
  try {
    await build({ configFile:false,root,logLevel:'error',define:{ 'process.env.NODE_ENV':'"production"' },plugins:[{
      name:'analytics-fixture',enforce:'pre',resolveId(module) {
        if (/(?:^|\/)supabase(?:\.js)?$/.test(module)) return path.join(root,'scripts/fixtures/analytics/client.js');
      },
    },react()],build:{ outDir:output,lib:{ entry:path.join(root,'scripts/fixtures/analytics/entry.jsx'),name:'AnalyticsQA',formats:['iife'],fileName:'fixture' },minify:false } });
    const console=new VirtualConsole();console.on('jsdomError',error=>errors.push(error.message));console.on('error',(...args)=>errors.push(args.join(' ')));
    dom=new JSDOM('<div id="root"></div>',{ url:'https://ui.test/?src=insta#/work/job/1311',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console });
    const w=dom.window; Object.assign(w,{ Response,Request,Headers,AbortController,AbortSignal,TextEncoder,TextDecoder });
    w.qaCalls=[];w.qaApplyResult={ ok:true };w.qaStatsError=true;
    w.qaStats={ sessions:2, pages:[{ screen:'job',views:2,sessions:2 }], sources:[{ source:'instagram',sessions:2 }],operations:[{ name:'pdf',started:3,succeeded:1,failed:1,in_progress:0,unrecorded:1,slow:1 }] };
    w.fetch=()=>{throw Error('unexpected network');};
    w.eval(await readFile(path.join(output,'fixture.iife.js'),'utf8'));
    await until(()=>button(w,'許可しない'),'initial choice');
    const measurements=()=>w.qaCalls.filter(call=>call.path.endsWith('/product_events'));
    assert.equal((await w.qaApply()).data.ok,true);w.qaAnalytics.flush();assert.equal(measurements().length,0);
    button(w,'許可しない').click(); await until(()=>!button(w,'許可しない'),'decline dismisses prompt');
    assert.equal((await w.qaApply()).data.ok,true);w.qaAnalytics.flush();assert.equal(measurements().length,0);
    button(w,'設定を開く').click();await until(()=>button(w,'許可する'),'preferences remain accessible');
    assert.match(w.document.body.textContent,/現在：許可していません/);
    button(w,'許可する').click();await until(()=>/現在：許可しています/.test(w.document.body.textContent),'granted');
    w.qaAnalytics.flush();await until(()=>measurements().length===1,'page insert');
    assert.equal(measurements()[0].body[0].screen,'job');assert.equal(measurements()[0].body[0].source,'instagram');
    await w.qaApply();w.qaAnalytics.flush();await until(()=>measurements().length===2,'success event');
    assert.deepEqual(JSON.parse(JSON.stringify(measurements()[1].body.map(row=>row.event))),['apply_start','apply_success']);
    w.qaApplyResult={ ok:false,reason:'job_not_open' };await w.qaApply();w.qaAnalytics.flush();await until(()=>measurements().length===3,'failure event');
    assert.deepEqual(JSON.parse(JSON.stringify(measurements()[2].body.map(row=>row.event))),['apply_start','apply_failure']);
    assert.doesNotMatch(JSON.stringify(measurements()),/1311|2026-09-24|job_number|available_dates/);
    const finish=w.qaAnalytics.begin('pdf');button(w,'許可しない').click();
    await until(()=>/現在：許可していません/.test(w.document.body.textContent),'withdrawn');finish('success');w.qaAnalytics.flush();
    assert.equal(measurements().length,3);
    button(w,'管理を開く').click();await until(()=>button(w,'再読み込み'),'failed summary is explicit');
    assert.doesNotMatch(w.document.querySelector('.admin-analytics').textContent,/計測した訪問/);
    w.qaStatsError=false;button(w,'再読み込み').click();await until(()=>w.document.querySelector('.analytics-total'),'summary retry');
    assert.match(w.document.querySelector('.admin-analytics').textContent,/結果未記録（30分経過）1件/);
    assert.equal(w.document.querySelector('.analytics-heading a').getAttribute('href'),'#/admin');
    assert.deepEqual(errors,[]);
  } finally { dom?.window.close();await rm(output,{ recursive:true,force:true }); }
});
