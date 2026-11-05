import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { employerUnsetCount } from '../src/lib/utils.js';
import { EMPLOYER_TEXTS, employerProfileChange } from '../src/lib/profileInput.js';
const sections={overview:['unique_point','intro_crops'],environment:['intro_atmosphere'],practical:['always_do','break_style'],representative:['owner_comment','intro_path','intro_joy','intro_message']};
const all=Object.values(sections).flat();
test('empty completion counts agree with grouped fields',()=>{assert.deepEqual(employerUnsetCount(null),employerUnsetCount({}));assert.equal(employerUnsetCount({}).total,12);});
test('new groups preserve every old text field exactly once and keep legacy saves',()=>{
 assert.deepEqual([...all].sort(),[...EMPLOYER_TEXTS.intro,...EMPLOYER_TEXTS.ask].sort());
 assert.equal(new Set(all).size,all.length);
 for(const [section,keys] of Object.entries(sections)) {
  const texts=Object.fromEntries(all.map(key=>[key,'new '+key]));
  const change=employerProfileChange(section,{},texts,'employer_profiles',{});
  assert.deepEqual(Object.keys(change.patch.texts_pending),keys);
  assert.deepEqual(change.options.guard,[...keys,'texts_pending']);
 }
});
const root=fileURLToPath(new URL('../',import.meta.url));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+5000;while(!fn()){assert.ok(Date.now()<end,'UI timeout');await pause(10);}}
test('grouped editor reads and saves only selected existing fields',async t=>{
 const output=await mkdtemp(path.join(tmpdir(),'profile-structure-'));let dom;
 try {
  await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/profile-ui-client.js');}},react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/profile-ui-entry.jsx'),name:'ProfileQA',formats:['iife'],fileName:'fixture'},minify:false}});
  const script=await readFile(path.join(output,'fixture.iife.js'),'utf8');
  async function mount(section,black=false){
   dom?.window.close();dom=new JSDOM('<div id="root"></div>',{url:'https://ui.test/#/profile/employer/profile'+(section?'/'+section:''),runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
   const w=dom.window;Object.assign(w,{TextEncoder,TextDecoder,Response,Request,Headers,qaSurface:'employer',qaBlack:black,qaOptions:{},qaSaved:[],qaAlerts:[]});
   w.alert=m=>w.qaAlerts.push(m);w.scrollTo=()=>{};w.fetch=()=>{throw Error('Unexpected network');};w.HTMLElement.prototype.scrollIntoView=()=>{};w.eval(script);
   await until(()=>w.document.querySelector('[data-guide="profile-rows"]')||w.document.querySelector('textarea'));return w;
  }
  await t.test('two groups replace ambiguous top-level prompts',async()=>{
   const w=await mount(''),text=w.document.querySelector('[data-guide="profile-rows"]').textContent;
   assert.match(text,/職場について/);assert.match(text,/代表について/);assert.doesNotMatch(text,/問いかけ|代表より/);
   assert.match(text,/設備・待遇/);assert.doesNotMatch(text,/0件記入/);assert.equal(w.qaProfile.state.writes,0);
  });
  await t.test('commission profile does not gain workplace or insurance fields',async()=>{const w=await mount('',true);const text=w.document.querySelector('[data-guide="profile-rows"]').textContent;assert.doesNotMatch(text,/職場について|代表について|保険の準備/);assert.match(text,/待遇/);});
  await t.test('owner preview separates workplace answers from person prompts without duplicate copies',async()=>{
   const w=await mount('');const row=w.qaProfile.state.rows.employer_profiles;
   Object.assign(row,{intro_crops:'CROPS_TOKEN',intro_atmosphere:'ATMOSPHERE_TOKEN',always_do:'WELCOME_TOKEN',break_style:'BREAK_TOKEN',intro_path:'PATH_TOKEN',intro_joy:'JOY_TOKEN',intro_message:'MESSAGE_TOKEN'});
   [...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()==='プレビュー').click();
   await until(()=>w.document.querySelector('[aria-label="職場についてのプレビュー"]'));
   const workplace=w.document.querySelector('[aria-label="職場についてのプレビュー"]');
   const person=w.document.querySelector('[aria-label="代表についてのプレビュー"]');
   assert.match(workplace.textContent,/CROPS_TOKEN/);assert.doesNotMatch(person.textContent,/CROPS_TOKEN|WELCOME_TOKEN/);
   assert.match(person.textContent,/PATH_TOKEN/);assert.doesNotMatch(workplace.textContent,/PATH_TOKEN|JOY_TOKEN/);
   for(const token of ['CROPS_TOKEN','ATMOSPHERE_TOKEN','WELCOME_TOKEN','BREAK_TOKEN','PATH_TOKEN','JOY_TOKEN','MESSAGE_TOKEN'])assert.equal((w.document.querySelector('.cb-preview-overlay').textContent.match(new RegExp(token,'g'))||[]).length,1);
   assert.equal(w.qaProfile.state.writes,0);
  });
  for(const [section,keys] of Object.entries(sections))await t.test(section,async()=>{
   const w=await mount(section);const fields=[...w.document.querySelectorAll('textarea')];
   assert.deepEqual(fields.map(f=>f.id.replace('employer-','')),keys);
   const before={...w.qaProfile.state.rows.employer_profiles};
   Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype,'value').set.call(fields[0],'new answer');fields[0].dispatchEvent(new w.Event('input',{bubbles:true}));await pause(20);
   [...w.document.querySelectorAll('button')].find(b=>b.textContent==='保存する').click();await until(()=>w.qaProfile.state.writes>0);await pause(60);
   assert.equal(w.qaAlerts.length,0);assert.equal(w.qaProfile.state.rows.employer_profiles[keys[0]],'new answer');
   for(const key of all.filter(k=>!keys.includes(k)))assert.equal(w.qaProfile.state.rows.employer_profiles[key],before[key]);
  });
  for(const section of ['intro','ask'])await t.test('legacy '+section,async()=>{const w=await mount(section);assert.equal(w.document.querySelectorAll('textarea').length,EMPLOYER_TEXTS[section].length);});
 }finally{dom?.window.close();await rm(output,{recursive:true,force:true});}
});
