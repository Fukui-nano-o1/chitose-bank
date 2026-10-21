import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {JSDOM,VirtualConsole} from 'jsdom';
import {build} from 'vite';
const root=fileURLToPath(new URL('../',import.meta.url));
test('the actual shared copy flow reconciles before handing off to the editor',async t=>{
 const output=await mkdtemp(path.join(tmpdir(),'cb-copy-retry-'));let dom;
 try{
  await build({configFile:false,root,logLevel:'error',plugins:[{name:'copy-fixture',enforce:'pre',resolveId(id){if(id==='./supabase')return path.join(root,'scripts/fixtures/copy-retry-ui-client.js');if(id==='./copyJobRecord')return path.join(root,'scripts/fixtures/copy-retry-ui-record.js');},load(id){if(id.endsWith('/src/lib/feedback.js'))return 'export function fbError(){};export function fbSuccess(){};';}}],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/copy-retry-ui-entry.js'),name:'CopyQA',formats:['iife'],fileName:'fixture'},minify:false}});
  const script=await readFile(path.join(output,'fixture.iife.js'),'utf8');
  const mount=(options={})=>{dom?.window.close();dom=new JSDOM('<div></div>',{url:'https://ui.test/#/employer',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});const w=dom.window;Object.assign(w,{qaOptions:options,qaAlerts:[]});w.alert=m=>w.qaAlerts.push(m);w.eval(script);return w;};
  await t.test('response loss preserves intent, retry opens one copy with original date prefill',async()=>{
   const w=mount({lostResponse:true}),dates={date_start:'2026-11-01',date_end:'2026-11-01',holidays:[]};assert.equal((await w.qaCopyJob(1,{presetDates:dates,quietDates:true})).ok,false);assert.equal(w.location.hash,'#/employer');assert.equal(w.qaCopy.state.pending.size,1);
   assert.match(w.qaAlerts[0],/保存済みの場合もあります/);assert.match(w.qaAlerts[0],/同じ端末・ブラウザ/);
   w.qaOptions.lostResponse=false;assert.equal((await w.qaCopyJob(1)).ok,true);assert.equal(w.qaCopy.state.writes,1);assert.equal(w.location.hash,'#/work/edit/101');assert.equal(JSON.parse(w.sessionStorage.getItem('cb_editJobPresetDates')).date_start,dates.date_start);assert.equal(w.qaCopy.state.pending.size,0);
  });
  await t.test('edited retry target never receives old calendar presets',async()=>{
   const w=mount({lostResponse:true});await w.qaCopyJob(1,{presetDates:{date_start:'2026-11-01'}});const receipt=[...w.qaCopy.state.receipts.values()][0];receipt.job.notes='later edit';receipt.copy_unchanged=false;w.qaOptions.lostResponse=false;
   await w.qaCopyJob(1);assert.equal(w.sessionStorage.getItem('cb_editJobPresetDates'),null);assert.equal(JSON.parse(w.sessionStorage.getItem('cb_editJobPrefill')).notes,'later edit');assert.ok(w.qaAlerts.some(x=>x.includes('その後に編集された内容')));
  });
  await t.test('double click is held by the shared in-flight guard',async()=>{
   const w=mount();let release;w.qaOptions.beforeRPC=()=>new Promise(r=>{release=r;});const first=w.qaCopyJob(1);await new Promise(r=>setTimeout(r,10));assert.equal((await w.qaCopyJob(1)).busy,true);assert.ok(w.document.body.textContent.includes('コピーしています'));release();await first;assert.equal(w.qaCopy.state.writes,1);assert.equal(w.document.body.textContent,'');
  });
  await t.test('failed edit handoff retains the copy request for retry',async()=>{
   const w=mount();w.Storage.prototype.setItem=()=>{throw Error('quota');};assert.equal((await w.qaCopyJob(1)).ok,false);assert.equal(w.qaCopy.state.pending.size,1);assert.equal(w.location.hash,'#/employer');assert.equal(w.qaCopy.state.writes,1);
  });
 }finally{dom?.window.close();await rm(output,{recursive:true,force:true});}
});
