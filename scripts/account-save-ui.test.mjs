import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {JSDOM,VirtualConsole} from 'jsdom';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
const root=fileURLToPath(new URL('../',import.meta.url)),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+5000;while(!fn()){assert.ok(Date.now()<end,label);await pause(10);}}
const button=(w,label)=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);
test('actual registration form verifies committed saves and preserves inputs on failures',async t=>{
 const output=await mkdtemp(path.join(tmpdir(),'cb-account-save-ui-'));let dom;
 try{
  await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'account-save-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/account-save-ui-client.js');},load(id){if(id.endsWith('/src/lib/zipLookup.js'))return 'export const zipLookup=async()=>({ok:true,prefecture:"徳島県",city:"吉野川市"});';}},react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/account-save-ui-entry.jsx'),name:'AccountSaveQA',formats:['iife'],fileName:'fixture'},minify:false}});
  const script=await readFile(path.join(output,'fixture.iife.js'),'utf8');
  async function mount(options={}){dom?.window.close();const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));dom=new JSDOM('<div id="root"></div>',{url:'https://ui.test/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});const w=dom.window;Object.assign(w,{qaOptions:options,qaDone:0,qaErrors:errors});w.eval(script);await until(()=>w.document.querySelector('form'),'ready');return w;}
  async function set(w,selector,value){const el=w.document.querySelector(selector);assert.ok(el,selector);Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?w.HTMLSelectElement.prototype:w.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new w.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));await pause(10);}
  async function fill(w){for(const [key,value] of [['name','試験 太郎'],['bday-year','2000'],['bday-month','1'],['bday-day','2'],['postal-code','7793303']])await set(w,`[autocomplete="${key}"]`,value);button(w,'住所を検索').click();await until(()=>w.document.querySelector('[autocomplete="address-line1"]').value,'address');await set(w,'[autocomplete="address-line2"]','山川町1');w.document.querySelector('input[type="checkbox"]').click();await until(()=>!button(w,'同意して登録する')?.disabled,'valid');}
  for(const mode of ['normal','lostResponse','insertError','readError'])await t.test(mode,async()=>{
   const w=await mount({[mode]:true});await fill(w);button(w,'同意して登録する').click();await until(()=>w.qaDone||w.document.querySelector('[role="alert"]'),'settled');
   if(mode.endsWith('Error')){assert.equal(w.qaDone,0);assert.equal(w.document.querySelector('[autocomplete="name"]').value,'試験 太郎');assert.equal(w.qaAccountSave.state.writes,0);}else{assert.equal(w.qaDone,1);assert.equal(w.qaAccountSave.state.writes,1);}assert.deepEqual(w.qaErrors,[]);
  });
  await t.test('a rejected session read is visible and can be retried',async()=>{const w=await mount({sessionError:true});assert.match(w.document.querySelector('[role="alert"]').textContent,/ログインを確認できません/);w.qaOptions.sessionError=false;button(w,'ログインを再確認').click();await until(()=>button(w,'同意して登録する'),'session recovered');});
  await t.test('double submit is locked synchronously and all inputs remain disabled until confirmation',async()=>{const w=await mount();await fill(w);let release;w.qaOptions.beforeInsert=()=>new Promise(r=>{release=r;});const form=w.document.querySelector('form');for(let i=0;i<2;i++)form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>release,'insert');assert.equal(w.qaAccountSave.state.inserts,1);assert.ok(w.document.querySelector('fieldset').disabled);release();await until(()=>w.qaDone,'done');assert.equal(w.qaDone,1);});
 }finally{dom?.window.close();await rm(output,{recursive:true,force:true});}
});
