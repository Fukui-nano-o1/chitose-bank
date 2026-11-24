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
   dom?.window.close();const route=surface==='worker'?'worker/profile/residence':surface.startsWith('employerPerks')?'employer/profile/perks':'employer/profile/nickname';
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
  async function save(w){button(w,'保存する').click();await pause(30);await until(()=>!w.document.querySelector('fieldset').disabled,'save settles');}
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
 if(!baseline) await t.test('employer perks: protected comparison and deliberate retry', async t => {
   const editPark = async (w, value) => {
     const field = w.document.querySelector('input[type="number"]');
     Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(field, value);
     field.dispatchEvent(new w.Event('input', { bubbles:true }));
     await pause(20);
   };
   const read = async w => {
     await until(()=>button(w,'保存済みの内容と比べる'),'recovery visible');
     button(w,'保存済みの内容と比べる').click();
     await until(() => button(w,'入力を見直す'), 'comparison loaded');
   };
   const row = w => w.qaProfile.state.rows.employer_profiles;
   const writes = w => w.qaProfile.state.events.filter(e=>e.table==='employer_profiles'&&e.kind!=='read');
   await t.test('unchanged empty profile exits without creating a row or reporting a save',async () => {
     const empty=await mount('employerPerks',{emptyEmployer:true});
     await save(empty);
     assert.equal(writes(empty).length,0);
     assert.equal(row(empty),null);
     assert.doesNotMatch(empty.document.body.textContent,/保存しました|保存内容を確認/);
   });
   await t.test('Back after conflict returns to the editor, then re-entry retains the draft',async () => {
     const w = await mount('employerPerks');
     row(w).parking_capacity=4;
     await editPark(w,'5');
     await save(w);
     await until(()=>button(w,'保存済みの内容と比べる'),'recovery visible');
     w.document.querySelector('button[aria-label="戻る"]').click();
     await until(()=>!w.location.hash.endsWith('/perks'),'returned without saving');
     await until(()=>[...w.document.querySelectorAll('button')].some(b=>b.textContent.trim().startsWith('待遇')),'profile list restored');
     [...w.document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('待遇')).click();
     await until(()=>button(w,'保存済みの内容と比べる'),'reopened perks with recovery');
     assert.equal(w.document.querySelector('input[type="number"]').value,'5');
     await read(w);
     assert.match(w.document.body.textContent,/今回の入力：あり ／ 5/);
     assert.equal(writes(w).length,1);
   });
   await t.test('posting editor without an owner prop uses only the authenticated loaded owner',async () => {
     const w = await mount('employerPerksNoOwner');
     await editPark(w,'5');
     row(w).parking_capacity = 4;
     await save(w);
     await read(w);
     assert.match(w.document.body.textContent,/現在：あり ／ 4/);
     button(w,'今回の変更だけ適用').click();
     await until(()=>row(w).parking_capacity===5,'authenticated owner can finish');
     assert.equal(writes(w).length,2);
   });
   await t.test('different perks are not overwritten; dependent detail is guarded',async () => {
     const w = await mount('employerPerks');
     row(w).has_bonus = true;
     row(w).bonus_detail = '合成賞与';
     await editPark(w,'5');
     await save(w);
     assert.equal(row(w).parking_capacity,5);
     assert.equal(row(w).has_bonus,true);
     assert.equal(row(w).bonus_detail,'合成賞与');
     assert.deepEqual(JSON.parse(JSON.stringify(writes(w)[0].patch)),{parking_capacity:5});
     assert.ok(writes(w)[0].filters.some(([k]) => k==='has_parking'));
   });
   await t.test('comparison keeps draft; another edit after comparison still cannot be overwritten',async () => {
     const w = await mount('employerPerks');
     row(w).parking_capacity = 4;
     await editPark(w,'5');
     await save(w);
     assert.equal(row(w).parking_capacity,4);
     assert.equal(button(w,'保存する'),undefined);
     assert.equal(w.document.querySelector('input[type="number"]').value,'5');
     assert.equal(w.document.querySelector('button[aria-label="戻る"]').disabled,false);
     assert.equal(writes(w).length,1);
     await read(w);
     assert.match(w.document.body.textContent,/現在：あり ／ 4/);
     assert.match(w.document.body.textContent,/今回の入力：あり ／ 5/);
     assert.equal(writes(w).length,1);
     row(w).parking_capacity = 6;
     button(w,'今回の変更だけ適用').click();
     await until(() => button(w,'保存済みの内容と比べる'),'stale comparison rejected');
     assert.equal(row(w).parking_capacity,6);
     await read(w);
     row(w).has_bonus = true;
     row(w).bonus_detail = '別の項目';
     button(w,'今回の変更だけ適用').click();
     await until(() => row(w).parking_capacity===5,'deliberate update');
     assert.equal(row(w).bonus_detail,'別の項目');
     assert.deepEqual(Array.from(writes(w), e=>Object.keys(e.patch)),[['parking_capacity'],['parking_capacity'],['parking_capacity']]);
     const event = w.qaProfile.state.events.find(e => e.table==='app_errors');
     assert.equal(event.patch.error_code,'PROFILE_CONFLICT');
     assert.equal(event.patch.message,'PROFILE_CONFLICT');
     assert.ok(!('user_agent' in event.patch));
   });
   await t.test('boolean and helper text are atomic and shared pending text cannot be published',async () => {
     const w = await mount('employerPerks');
     const toggle=[...w.document.querySelectorAll('[role="switch"]')].find(el=>el.getAttribute('aria-label')==='送迎');
     toggle.click();
     await until(()=>w.document.querySelector('input[placeholder="例：吉野川市内"]'),'detail visible');
     const field=w.document.querySelector('input[placeholder="例：吉野川市内"]');
     Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(field,'合成条件');
     field.dispatchEvent(new w.Event('input',{bubbles:true}));
     await pause(20);
     row(w).texts_pending={owner_comment:'他の項目'};
     await save(w);
     assert.equal(row(w).has_transport,false);
     assert.equal(row(w).texts_pending.owner_comment,'他の項目');
     assert.equal(writes(w).length,1);
     await read(w);
     assert.equal(button(w,'今回の変更だけ適用'),undefined);
     row(w).texts_pending={};
     button(w,'入力を見直す').click();
     await until(()=>w.document.body.textContent.includes('もう一度比べてください'),'latest pending map changed');
     button(w,'入力を見直す').click();
     await until(()=>button(w,'保存する'),'editable after reading latest');
     assert.equal(w.document.querySelector('input[placeholder="例：吉野川市内"]').value,'合成条件');
     await save(w);
     assert.equal(row(w).has_transport,true);
     assert.equal(row(w).transport_area,'合成条件');
     assert.deepEqual(JSON.parse(JSON.stringify(writes(w)[1].patch)),{has_transport:true,texts_pending:{transport_area:'合成条件'}});
   });
   await t.test('already-applied change is verified without another write',async () => {
     const w = await mount('employerPerks');
     row(w).parking_capacity = 4;
     await editPark(w,'5');
     await save(w);
     row(w).parking_capacity = 5;
     await read(w);
     button(w,'今回の変更だけ適用').click();
     await until(() => w.document.body.textContent.includes('保存しました'),'verified same value');
     assert.equal(writes(w).length,1);
   });
   await t.test('lost response plus unavailable read can recover; a switched owner is never read',async () => {
     const w = await mount('employerPerks',{lostResponse:true,readErrorAfterWrite:true});
     await editPark(w,'5');
     await save(w);
     assert.equal(row(w).parking_capacity,5);
     assert.ok(button(w,'保存済みの内容と比べる'));
     assert.doesNotMatch(w.document.body.textContent,/保存しました/);
     const state=w.qaProfile.state;
     const readCount=state.events.filter(e=>e.table==='employer_profiles'&&e.kind==='read').length;
     const owner=state.userId;state.userId='other-account';state.options.readErrorAfterWrite=false;
     await until(()=>button(w,'保存済みの内容と比べる'),'recovery visible');
     button(w,'保存済みの内容と比べる').click();
     await until(()=>w.document.body.textContent.includes('入力を始めたアカウントに戻って'),'owner mismatch');
     assert.equal(state.events.filter(e=>e.table==='employer_profiles'&&e.kind==='read').length,readCount);
     state.userId=owner;
     await read(w);
     button(w,'今回の変更だけ適用').click();
     await until(()=>w.document.body.textContent.includes('保存しました'),'verified after unavailable read');
     assert.equal(writes(w).length,1);
   });
   await t.test('a mounted editor cannot display the prior account’s comparison or draft',async () => {
     const w=await mount('employerPerks');
     await editPark(w,'93');
     row(w).parking_capacity=4;
     await save(w);
     await read(w);
     assert.match(w.document.body.textContent,/今回の入力：あり ／ 93/);
     const newOwner='22222222-2222-4222-8222-222222222222';
     const state=w.qaProfile.state;
     state.userId=newOwner;
     state.rows.employer_profiles={...row(w),auth_id:newOwner,parking_capacity:8};
     w.qaRenderOwner(newOwner);
     await until(()=>w.document.querySelector('input[type="number"]')?.value==='8','new owner’s form');
     assert.doesNotMatch(w.document.body.textContent,/今回の入力：あり ／ 93/);
     assert.equal(button(w,'今回の変更だけ適用'),undefined);
     assert.equal(writes(w).length,1);
   });
   await t.test('disabled setting cannot silently reactivate; returning to form preserves the intended detail',async () => {
     const w=await mount('employerPerks');
     const old=w.document.querySelector('input[type="number"]');
     assert.equal(old.value,'2');
     await editPark(w,'5');
     row(w).has_parking=false;
     row(w).parking_capacity=null;
     await save(w);
     await read(w);
     assert.equal(button(w,'今回の変更だけ適用'),undefined);
     button(w,'入力を見直す').click();
     await until(()=>button(w,'保存する'),'editable again');
     const toggle=[...w.document.querySelectorAll('[role="switch"]')].find(el=>el.getAttribute('aria-label')==='駐車場');
     assert.equal(toggle.getAttribute('aria-checked'),'false');
     toggle.click();
     await until(()=>w.document.querySelector('input[type="number"]'),'input revealed');
     assert.equal(w.document.querySelector('input[type="number"]').value,'5');
     assert.equal(writes(w).length,1);
   });
 });
 } finally {dom?.window.close();await rm(output,{recursive:true,force:true});}
});
