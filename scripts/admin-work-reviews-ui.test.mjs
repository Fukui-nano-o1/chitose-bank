import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { JSDOM } from 'jsdom';
import { reviewAnswers } from '../src/components/admin/workReviewModel.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sample={id:'r1',direction:'worker_to_farmer',job_number:1311,crop:'ブロッコリー',task:'収穫',worker_name:'働き手A',farmer_name:'農家A',created_at:'2026-09-29T00:00:00Z',work_completed_at:'2026-09-28T00:00:00Z',as_described:true,instructions_clear:false,safety_care:null,pay_status:'other'};
const ok=(items=[],has_more=false)=>({data:{ok:true,items,has_more}});
async function until(fn) { const end=Date.now()+4000; while(!fn()) { assert.ok(Date.now()<end,'timed out'); await pause(10); } }
function button(w,text) { return [...w.document.querySelectorAll('button')].find(x=>x.textContent===text); }
test('admin review answer labels preserve null, neutral, legacy and unpaid distinctions',()=>{
  const result=reviewAnswers(sample);
  assert.deepEqual(result.positive,['求人の内容どおりだった']);
  assert.deepEqual(result.negative,['説明・教え方が分かりにくかった']);
  assert.equal(result.other.includes('未払いの申告あり'),false);
  assert.deepEqual(reviewAnswers({direction:'worker_to_farmer'}),{positive:[],negative:[],other:[]});
  const farmer=reviewAnswers({direction:'farmer_to_worker',want_again_choice:'neutral',work_outcome:'partial',traits:['careful','comm_issue']});
  assert.deepEqual(farmer.positive,['丁寧だった']); assert.deepEqual(farmer.negative,['コミュニケーションに問題があった']);
  assert.ok(farmer.other.includes('また働きたいか：どちらともいえない'));
  assert.ok(reviewAnswers({direction:'worker_to_farmer',pay_status:'unpaid'}).other.includes('未払いの申告あり'));
});
test('admin review list: directions, pagination, retry, denied, stale requests and links',async t=>{
  const output=await mkdtemp(path.join(tmpdir(),'admin-reviews-')); let dom;
  try {
    await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
      name:'fixture',enforce:'pre',resolveId(id) {if (/(?:^|\/)supabase(?:\.js)?$/.test(id)) return path.join(root,'scripts/fixtures/admin-work-reviews/client.js');},
    },react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/admin-work-reviews/entry.jsx'),name:'AdminReviewsQA',formats:['iife'],fileName:'fixture'},minify:false}});
    const script=await readFile(path.join(output,'fixture.iife.js'),'utf8');
    async function mount(results) {
      dom?.window.close(); dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid/#/admin/evaluation/reviews',runScripts:'dangerously',pretendToBeVisual:true});
      const w=dom.window; w.qaCalls=[]; w.qaResults=results; w.HTMLElement.prototype.scrollIntoView=()=>{}; w.eval(script);
      await until(()=>w.qaCalls.length>0); return w;
    }
    await t.test('shows saved answers, direct job link and independent paging per direction',async()=>{
      const w=await mount([ok([sample],true),ok([{...sample,id:'r2'}]),ok([])]);
      await until(()=>w.document.querySelector('article'));
      assert.match(w.document.body.textContent,/良い点 1 · 悪い点 1/);
      assert.match(w.document.body.textContent,/働き手A → 農家A/);
      assert.ok(w.document.querySelector('a[href="#/admin/review/1311"]'));
      assert.ok(w.document.querySelector('a[href="#/admin"]'));
      assert.equal(w.document.querySelector('a[href="#/admin/reports"]'),null);
      button(w,'次の30件').click(); await until(()=>w.qaCalls.length===2 && w.document.querySelector('article'));
      assert.equal(w.qaCalls[1].args.p_offset,30);
      button(w,'農家 → 働き手').click(); await until(()=>w.document.body.textContent.includes('この方向の評価はまだありません'));
      assert.deepEqual(JSON.parse(JSON.stringify(w.qaCalls[2].args)),{p_direction:'farmer_to_worker',p_offset:0});
    });
    await t.test('failed request is not an empty list; retry restores rows and unpaid link',async()=>{
      const w=await mount([{error:{message:'offline'}},ok([{...sample,pay_status:'unpaid'}])]);
      await until(()=>button(w,'もう一度読み込む')); assert.doesNotMatch(w.document.body.textContent,/まだありません/);
      button(w,'もう一度読み込む').click(); await until(()=>w.document.querySelector('article'));
      assert.ok(w.document.querySelector('a[href="#/admin/reports"]'));
    });
    await t.test('denied responses show no review cards',async()=>{
      const w=await mount([{data:{ok:false,reason:'not_admin',items:[sample]}}]);
      await until(()=>w.document.body.textContent.includes('管理者のみ'));
      assert.equal(w.document.querySelector('article'),null);
    });
    await t.test('slow response from old direction cannot overwrite current view',async()=>{
      const w=await mount([{...ok([sample]),delay:150},ok([])]);
      button(w,'農家 → 働き手').click(); await until(()=>w.qaCalls.length===2); await pause(180);
      assert.equal(w.document.querySelector('article'),null);
      assert.match(w.document.body.textContent,/この方向の評価はまだありません/);
    });
  } finally { dom?.window.close(); await rm(output,{recursive:true,force:true}); }
});
