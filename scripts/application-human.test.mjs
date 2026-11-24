import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(path.join(tmpdir(), 'cb-application-human-'));
await build({ configFile:false, root, logLevel:'error', define:{'process.env.NODE_ENV':'"production"'}, plugins:[react()], build:{outDir:output, lib:{entry:path.join(root,'scripts/fixtures/application-human-entry.jsx'),name:'ApplicationQA',formats:['iife'],fileName:'fixture'}, minify:false} });
const code = await readFile(path.join(output,'fixture.iife.js'),'utf8');
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
const days = ['2030-01-11','2030-01-12'];
async function setup({saved, periodDays=days, step=2}={}) {
 const dom = new JSDOM('<div id="root"></div>', {url:'https://synthetic.test/#/work/job/123/apply/dates', runScripts:'dangerously', pretendToBeVisual:true});
 const w = dom.window; w.fetch=()=>{throw Error('Real network is forbidden');};
 if(saved) w.sessionStorage.setItem('cb_application_dates_v1_synthetic-owner_123',JSON.stringify(saved));
 const calls=[];
 const props={selectedJob:{id:123,crop:'合成作物',task:'合成作業',pay:1000},step,me:{id:'synthetic-owner'},isPeriodJob:true,periodDays,applying:false,blocked:false,checking:false,applyAvailRef:{current:null},handleApply:()=>calls.push(props.applyAvailRef.current)};
 w.eval(code); w.qaRenderApplication(props); await pause();
 const click=async selector=>{w.document.querySelector(selector).click(); await pause();};
 return {dom,w,props,calls,click};
}
try {
 await test('switch from any back to a date selects exactly the visibly tapped date', async()=>{
  const {dom,w,props,calls,click}=await setup();
  try {
   await click('.application-page-dates button:nth-child(1)');
   await click('.application-page-dates button:nth-child(2)');
   await click('.application-page-any');
   await click('.application-page-dates button:nth-child(1)');
   assert.deepEqual([...w.document.querySelectorAll('.application-page-dates button')].map(b=>b.getAttribute('aria-pressed')),['true','false']);
   w.qaRenderApplication({...props,step:3});await pause(); await click('.btn-primary');
   assert.equal(JSON.stringify(calls),JSON.stringify([[days[0]]]));
  } finally {dom.window.close();}
 });
 await test('reopening any-availability after schedule changed requires a fresh selection', async()=>{
  const {dom,w,props,calls,click}=await setup({saved:{choice:'any',dates:[],periodDays:['2030-01-10']},step:3});
  try {
   assert.equal(w.document.querySelector('.btn-primary').disabled,true);
   await click('.btn-primary');assert.equal(calls.length,0);
   w.qaRenderApplication({...props,step:2});await pause();await click('.application-page-any');
   w.qaRenderApplication({...props,step:3});await pause();await click('.btn-primary');
   assert.equal(JSON.stringify(calls),JSON.stringify(['any']));
  } finally {dom.window.close();}
 });
 await test('no working days cannot enable any-availability or submit even via final route', async()=>{
  const {dom,w,props,calls,click}=await setup({periodDays:[]});
  try {
   await click('.application-page-any');assert.equal(w.document.querySelector('.btn-primary').disabled,true);
   w.qaRenderApplication({...props,step:3});await pause();await click('.btn-primary');assert.equal(calls.length,0);
  } finally {dom.window.close();}
 });
 await test('unchanged schedule retains choice, blocked and checking still prevent submission', async()=>{
  const {dom,w,props,calls,click}=await setup({saved:{choice:'any',dates:[],periodDays:days},step:3});
  try {
   assert.equal(w.document.querySelector('.btn-primary').disabled,false);
   for(const state of [{blocked:true},{checking:true},{applying:true}]) {
    w.qaRenderApplication({...props,...state});await pause();await click('.btn-primary');assert.equal(calls.length,0);
   }
   w.qaRenderApplication(props);await pause();await click('.btn-primary');assert.equal(JSON.stringify(calls),JSON.stringify(['any']));
  } finally {dom.window.close();}
 });
 await test('same date set reordered remains valid, including after a live rerender', async()=>{
  const {dom,w,props,calls,click}=await setup({saved:{choice:'any',dates:[],periodDays:[...days].reverse()},step:3});
  try {
   assert.equal(w.document.querySelector('.btn-primary').disabled,false);
   w.qaRenderApplication({...props,periodDays:[...days].reverse()});await pause();
   await click('.btn-primary');assert.equal(JSON.stringify(calls),JSON.stringify(['any']));
  } finally {dom.window.close();}
 });
 await test('live schedule change cannot silently broaden any-day promise or rewrite its saved scope', async()=>{
  const {dom,w,props,calls,click}=await setup({saved:{choice:'any',dates:[],periodDays:days},step:3});
  try {
   const expanded=[...days,'2030-01-13'];
   w.qaRenderApplication({...props,periodDays:expanded});await pause();
   assert.equal(w.document.querySelector('.btn-primary').disabled,true);
   assert.match(w.document.body.textContent,/選び直してください/);
   await click('.btn-primary');assert.equal(calls.length,0);
   const saved=JSON.parse(w.sessionStorage.getItem('cb_application_dates_v1_synthetic-owner_123'));
   assert.equal(JSON.stringify(saved.periodDays),JSON.stringify(days));
   w.qaRenderApplication({...props,periodDays:expanded,fixtureKey:'reopen'});await pause();
   assert.equal(w.document.querySelector('.btn-primary').disabled,true);
  } finally {dom.window.close();}
 });
 await test('explicitly turning any off restores previous actual dates; ordinary date toggles still work', async()=>{
  const {dom,w,click}=await setup();
  try {
   await click('.application-page-dates button:nth-child(1)');
   await click('.application-page-any');await click('.application-page-any');
   assert.deepEqual([...w.document.querySelectorAll('.application-page-dates button')].map(b=>b.getAttribute('aria-pressed')),['true','false']);
   await click('.application-page-dates button:nth-child(1)');
   assert.equal(w.document.querySelector('.btn-primary').disabled,true);
  } finally {dom.window.close();}
 });
 await test('legacy any draft without known scope requires reselection; actual date draft remains selected', async()=>{
  for(const choice of ['any','dates']) {
   const {dom,w}=await setup({saved:{choice,dates:[days[0]]},step:3});
   try {assert.equal(w.document.querySelector('.btn-primary').disabled,choice==='any');}
   finally {dom.window.close();}
  }
 });
} finally {await rm(output,{recursive:true,force:true});}
