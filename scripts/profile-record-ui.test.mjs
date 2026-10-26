import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../', import.meta.url)), baseline = process.env.CB_PROFILE_BASELINE === '1';
const pause = ms => new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+5000;while(!fn()){assert.ok(Date.now()<end,label);await pause(10);}}
const button=(w,text)=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
const tableOf = surface=>['worker','experience'].includes(surface)?'worker_profiles':surface==='emergency'?'emergency_contacts':'employer_profiles';

test('profile screens protect loaded values, concurrent edits and failed saves',async t=>{
 const output=await mkdtemp(path.join(tmpdir(),'cb-profile-ui-'));let dom;
 try {
  await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
   name:'profile-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/profile-ui-client.js');},
   load(id){if(baseline&&/\/(WorkerProfileEdit|EmployerProfileEdit|WorkerExperiencePage|InsurancePrepBox|VisitAndInsurance|EmergencyContactBox)\.jsx$/.test(id))return execFileSync('git',['show','eeed705216d1402fc242392e99efadabda6a367b:'+path.relative(root,id)],{cwd:root,encoding:'utf8'});},
  },react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/profile-ui-entry.jsx'),name:'ProfileQA',formats:['iife'],fileName:'fixture'},minify:false}});
  const script=await readFile(path.join(output,'fixture.iife.js'),'utf8');
  async function mount(surface,options={}) {
   dom?.window.close();const route=surface==='worker'?'worker/profile/residence':'employer/profile/nickname';
   const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
   dom=new JSDOM('<div id="root"></div>',{url:'https://ui.test/#/profile/'+route,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});
   const w=dom.window;Object.assign(w,{TextEncoder,TextDecoder,Response,Request,Headers,qaSurface:surface,qaOptions:options,qaAlerts:[],qaSaved:[],qaErrors:errors});
   w.alert=m=>w.qaAlerts.push(m);w.confirm=()=>true;w.fetch=()=>{throw Error('Unexpected network');};w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
   w.eval(script);
   await until(()=>w.document.querySelector('[role="alert"]')||button(w,'保存する'),'screen ready '+surface);
   return w;
  }
  async function edit(w,surface) {
   if(['insurance','insurancePage','experience'].includes(surface)) w.document.querySelector('[role="switch"]').click();
   else {
    const input=w.document.querySelector('input:not([type="file"])');
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(input,'変更後の値');
    input.dispatchEvent(new w.Event('input',{bubbles:true}));
   }
   await pause(20);
  }
  async function save(w){button(w,'保存する').click();await pause(30);await until(()=>!button(w,'保存中'),'save settles');}
  for(const surface of ['worker','employer','experience','insurance','insurancePage','emergency']) {
   await t.test(surface+': failed initial read cannot save or seed empty values',async()=>{
    const w=await mount(surface,{readError:true});
    assert.ok(w.document.querySelector('[role="alert"]'));
    assert.equal(button(w,'保存する'),undefined);assert.equal(w.qaProfile.state.writes,0);
    assert.equal(w.qaSaved.length,0);
    if(!baseline){w.qaOptions.readError=false;button(w,'もう一度読み込む').click();await until(()=>button(w,'保存する'),'retry loads real values');}
   });
   if(baseline)continue;
   await t.test(surface+': in-flight save blocks double submission and further editing',async()=>{
    const w=await mount(surface),f=w.qaProfile;await edit(w,surface);
    let release;f.state.options.beforeWrite=()=>new Promise(resolve=>{release=resolve;});
    const saveButton=button(w,'保存する');saveButton.click();saveButton.click();
    await until(()=>release,'write started');
    assert.ok(w.document.querySelector('fieldset[disabled]'));
    assert.equal(f.state.events.filter(e=>e.table===tableOf(surface)&&e.kind!=='read').length,1);
    release();await until(()=>!w.document.querySelector('fieldset[disabled]'),'save unlocks');
    assert.equal(w.qaAlerts.length,0);
   });
   for(const mode of ['dbError','lostResponse','normal']) await t.test(surface+': '+mode,async()=>{
    const w=await mount(surface),f=w.qaProfile;await edit(w,surface);const before=JSON.stringify(f.state.rows[tableOf(surface)]);
    f.state.options[mode]=true;await save(w);
    if(mode==='dbError'){assert.ok(w.qaAlerts.length);assert.equal(JSON.stringify(f.state.rows[tableOf(surface)]),before);assert.equal(w.qaSaved.length,0);}
    else {assert.equal(w.qaAlerts.length,0);assert.notEqual(JSON.stringify(f.state.rows[tableOf(surface)]),before);}
    assert.equal(f.state.events.filter(e=>e.table===tableOf(surface)&&e.kind!=='read').length,1);assert.deepEqual(w.qaErrors,[]);
   });
  }
  if(!baseline)await t.test('emergency: self contact is confirmed only by explicit save',async()=>{
   const w=await mount('emergency'),f=w.qaProfile;
   assert.match(w.document.body.textContent,/ご本人の連絡先も、内容を確認して「保存する」を押すまで相手に表示されません/);
   assert.equal(f.state.rows.emergency_contacts.confirmed_at,null);assert.equal(f.state.writes,0);
   button(w,'本人').click();await pause(20);assert.equal(f.state.writes,0);
   await save(w);
   assert.equal(f.state.rows.emergency_contacts.relation,'本人');
   assert.ok(Number.isFinite(Date.parse(f.state.rows.emergency_contacts.confirmed_at)));
   assert.equal(f.state.rows.emergency_contacts.name,'元の連絡先');
   assert.equal(f.state.rows.emergency_contacts.phone,'000-0000-0000');
  });
  if(!baseline)for(const role of ['worker','employer']) {
   await t.test(role+': another section survives a stale form save',async()=>{
    const w=await mount(role),f=w.qaProfile;f.state.rows[tableOf(role)].transport='他端末の値';await edit(w,role);await save(w);
    assert.equal(w.qaAlerts.length,0);assert.equal(f.state.rows[tableOf(role)].transport,'他端末の値');
    const write=f.state.events.find(e=>e.kind==='update');assert.equal(write.patch.transport,undefined);assert.equal(write.patch.pr_pending,undefined);
   });
   await t.test(role+': same field conflict preserves the remote value and local input',async()=>{
    const w=await mount(role),f=w.qaProfile,key=role==='worker'?'residence_city':'recruiter_name';
    f.state.rows[tableOf(role)][key]='他端末の値';await edit(w,role);await save(w);
    assert.match(w.qaAlerts[0],/最新の内容と比べて/);assert.match(w.qaAlerts[0],/入力を控え/);assert.equal(f.state.rows[tableOf(role)][key],'他端末の値');
    assert.equal(w.document.querySelector('input:not([type="file"])').value,'変更後の値');
   });
  }
 } finally {dom?.window.close();await rm(output,{recursive:true,force:true});}
});
