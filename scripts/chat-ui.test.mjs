import test from 'node:test';
import { chatReadWatermarks } from '../src/lib/chatReadWatermarks.js';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
const require=createRequire(import.meta.url);
const {JSDOM,VirtualConsole}=require(process.env.CB_TEST_NODE_MODULES?`${process.env.CB_TEST_NODE_MODULES}/jsdom`:'jsdom');
const root=fileURLToPath(new URL('../',import.meta.url));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const user='10000000-0000-4000-8000-000000000001', partner='10000000-0000-4000-8000-000000000002';
const app='20000000-0000-4000-8000-000000000001', past='20000000-0000-4000-8000-000000000002';
const button=(w,label)=>[...w.document.querySelectorAll('button')].find(el=>el.textContent.replace(/›/g,'').trim()===label);
async function until(fn,label){const end=Date.now()+5000;while(!fn()){assert.ok(Date.now()<end,`timed out: ${label}`);await pause(10);}}
async function fill(w,selector,value){const el=w.document.querySelector(selector);assert.ok(el,selector);Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?w.HTMLTextAreaElement.prototype:w.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new w.Event('input',{bubbles:true}));await pause(10);}
function records(){return {
 applications:[{id:app,farmer_id:partner,worker_id:user,job_number:1311,status:'approved',terms_confirmed_worker_at:'2026-09-01',created_at:'2026-09-01T01:00:00Z'},{id:past,farmer_id:partner,worker_id:user,job_number:1200,status:'completed',created_at:'2026-08-01T00:00:00Z'}],
 jobs_public:[{job_number:1311,crop:'ブロッコリー',task:'播種',date_start:'2026-09-24',date_end:'2026-09-24',work_time:'10:00〜12:00'},{job_number:1200,crop:'にんじん',task:'収穫',date_start:'2026-08-24'}],
 employer_profiles_public:[{auth_id:partner,nickname:'農園サンプル',avatar_url:''}],worker_profiles:[{auth_id:user,nickname:'働き手サンプル',avatar_url:''}],
 messages:[{id:'30000000-0000-4000-8000-000000000001',application_id:app,sender_id:partner,body:'明日は集合場所でお待ちしています。',created_at:'2026-09-23T09:00:00Z',read_at:null},{id:'30000000-0000-4000-8000-000000000002',application_id:past,sender_id:partner,body:'ありがとうございました。',created_at:'2026-08-24T09:00:00Z',read_at:null}],
 chat_reads:[],admin_messages:[]};}
test('chat inbox, conversation, recovery and mobile viewport work together',async t=>{
 const output=await mkdtemp(path.join(tmpdir(),'cb-chat-'));let dom;const errors=[];
 try{
 await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'chat-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/chat/client.js');},transform(code,id){if(id.endsWith('/src/lib/chatMessaging.js'))return code.replace('CHAT_TIMEOUT_MS = 15000','CHAT_TIMEOUT_MS = 120');}},react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/chat/entry.jsx'),name:'ChatQA',formats:['iife'],fileName:'fixture',cssFileName:'fixture'},minify:false}});
 const script=await readFile(path.join(output,'fixture.iife.js'),'utf8'),css=await readFile(path.join(output,'fixture.css'),'utf8');
 function mount(settings={}){dom?.window.close();const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/CSS|navigation/.test(e.message))errors.push(e.message);});vc.on('error',(...args)=>errors.push(args.join(' ')));dom=new JSDOM('<div id="root"></div>',{url:'https://chat.test/#/chats',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});const w=dom.window;Object.assign(w,{qaUser:user,qaData:records(),qaUnread:{[app]:1},qaChannels:[],qaRequests:[],...settings,TextEncoder,TextDecoder});w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.visualViewport=Object.assign(new w.EventTarget(),{width:390,height:844,offsetLeft:0,offsetTop:0,scale:1});w.alert=value=>errors.push('alert: '+value);const style=w.document.createElement('style');style.textContent=css;w.document.head.append(style);w.eval(script);return w;}
 const input=w=>w.document.querySelector('textarea[aria-label="メッセージ"]');
 await t.test('inbox shows recent previews and filters by job, unread and lifecycle',async()=>{const w=mount();await until(()=>w.document.querySelectorAll('.chat-inbox-row').length===2,'rows');await until(()=>w.document.querySelector('.chat-row-preview')?.textContent.includes('明日は'),'preview');button(w,'終了').click();await until(()=>w.document.querySelectorAll('.chat-inbox-row').length===1,'past');assert.match(w.document.querySelector('.chat-inbox-row').textContent,/にんじん/);button(w,'すべて').click();await fill(w,'input[type=search]','1311');assert.equal(w.document.querySelectorAll('.chat-inbox-row').length,1);await fill(w,'input[type=search]','存在しない');assert.match(w.document.body.textContent,/該当する仕事の会話はありません/);button(w,'すべての会話を表示').click();await until(()=>w.document.querySelectorAll('.chat-inbox-row').length===2,'reset');assert.ok(button(w,'この画面を報告'));});
 await t.test('inbox load failures expose retry instead of claiming no conversations',async()=>{const w=mount({qaFailRead:'applications'});await until(()=>button(w,'再読み込み'),'retry');assert.doesNotMatch(w.document.body.textContent,/会話はここから始まります/);w.qaFailRead=null;button(w,'再読み込み').click();await until(()=>w.document.querySelectorAll('.chat-inbox-row').length===2,'recovered');});
 await t.test('keyboard, zoom and rotation keep both shell and closeable details in the visual viewport',async()=>{const w=mount({qaRoute:app});await until(()=>input(w)&&!input(w).disabled,'loaded');await fill(w,'textarea[aria-label="メッセージ"]','入力途中');const vv=w.visualViewport;Object.assign(vv,{width:320,height:290,offsetTop:155,offsetLeft:20,scale:1});vv.dispatchEvent(new w.Event('resize'));const room=w.document.querySelector('.chat-room');assert.equal(room.style.getPropertyValue('--chat-top'),'155px');assert.equal(room.style.getPropertyValue('--chat-height'),'290px');assert.equal(w.getComputedStyle(room).position,'fixed');assert.equal(w.getComputedStyle(room).display,'flex');assert.equal(w.getComputedStyle(room).flexDirection,'column');const rules=[];function visit(list){for(const rule of list){if(rule.selectorText)rules.push(rule);if(rule.cssRules)visit(rule.cssRules);}}for(const sheet of w.document.styleSheets)visit(sheet.cssRules);assert.ok(rules.some(rule=>rule.selectorText==='header:where(.app-header)'));assert.equal(rules.some(rule=>rule.style.getPropertyPriority('padding')==='important'&&w.document.querySelector('.chat-room-header').matches(rule.selectorText)),false);button(w,'詳細').click();await until(()=>w.document.querySelector('[role=dialog]'),'details');assert.equal(w.document.querySelector('.chat-sheet-overlay').style.getPropertyValue('--chat-height'),'290px');w.document.querySelector('[aria-label="閉じる"]').click();await until(()=>!w.document.querySelector('[role=dialog]'),'close');assert.equal(input(w).value,'入力途中');button(w,'詳細').click();await until(()=>w.document.querySelector('[aria-label="求人の詳細を見る"]'),'job link');w.document.querySelector('[aria-label="求人の詳細を見る"]').click();await until(()=>w.location.hash==='#/work/job/1311','direct job detail');assert.equal(w.sessionStorage.getItem('cb_jobBackTo'),`/chat/${app}`);assert.equal(w.document.querySelector('[role=dialog]'),null);Object.assign(vv,{width:844,height:390,offsetTop:0,offsetLeft:0,scale:1});vv.dispatchEvent(new w.Event('resize'));assert.equal(room.style.getPropertyValue('--chat-width'),'844px');assert.ok(w.document.querySelector('[aria-label="メッセージ一覧に戻る"]'));});
 await t.test('drafts survive navigation, templates append without sending, Enter only adds a newline',async()=>{const w=mount({qaRoute:app});await until(()=>input(w)&&!input(w).disabled,'loaded');await fill(w,'textarea[aria-label="メッセージ"]','先に入力した文');button(w,'定型文').click();await until(()=>button(w,'持ち物'),'templates');button(w,'持ち物').click();await until(()=>input(w).value.includes('持ち物'),'append');assert.ok(input(w).value.startsWith('先に入力した文'));input(w).dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(w.qaRequests.filter(r=>r.op==='insert').length,0);w.qaNavigate(past);await until(()=>w.document.body.textContent.includes('この仕事は完了'),'past thread');w.qaNavigate(app);await until(()=>input(w)?.value.includes('持ち物'),'draft restored');assert.equal(w.qaData.messages.length,2);assert.equal(Object.keys(w.localStorage).some(k=>String(w.localStorage.getItem(k)).includes('先に入力した文')),false);});
 await t.test('lost send response and double clicks retry the same UUID exactly once',async()=>{const w=mount({qaRoute:app,qaSendMode:'lost'});await until(()=>input(w)&&!input(w).disabled,'loaded');await fill(w,'textarea[aria-label="メッセージ"]','受信済みでも二重送信しない');button(w,'送信').click();button(w,'送信')?.click();await until(()=>button(w,'同じ内容で再送'),'failed');assert.equal(input(w).value,'受信済みでも二重送信しない');assert.equal(input(w).readOnly,true);button(w,'同じ内容で再送').click();await until(()=>input(w).value==='','acknowledged');const sent=w.qaData.messages.filter(m=>m.body==='受信済みでも二重送信しない');assert.equal(sent.length,1);const requests=w.qaRequests.filter(r=>r.op==='insert');assert.equal(new Set(requests.map(r=>r.value.id)).size,1);assert.equal(w.document.querySelectorAll('.chat-bubble').length,2);});
 await t.test('send deadline unblocks controls and late results cannot contaminate another thread',async()=>{const w=mount({qaRoute:app,qaSendMode:'hold'});await until(()=>input(w)&&!input(w).disabled,'loaded');await fill(w,'textarea[aria-label="メッセージ"]','送信後に別の会話へ移動');button(w,'送信').click();await until(()=>button(w,'同じ内容で再送'),'bounded timeout');w.qaNavigate(past);await until(()=>w.document.body.textContent.includes('この仕事は完了'),'switched');w.qaResolveSend();await pause(30);assert.doesNotMatch(w.document.querySelector('.chat-messages').textContent,/送信後に別の会話へ移動/);w.qaNavigate(app);await until(()=>input(w)?.value==='','confirmed by fetch');assert.equal(w.qaData.messages.filter(m=>m.body==='送信後に別の会話へ移動').length,1);});
 await t.test('hidden conversations are not marked read and failure retains visible history',async()=>{const w=mount({qaRoute:app,qaFailRead:'messages'});Object.defineProperty(w.document,'visibilityState',{configurable:true,value:'hidden'});await until(()=>button(w,'再読み込み'),'read error');assert.equal(w.qaRequests.filter(r=>r.table==='messages'&&r.op==='update').length,0);w.qaFailRead=null;button(w,'再読み込み').click();await until(()=>w.document.querySelector('.chat-bubble'),'history recovered');assert.equal(w.qaRequests.filter(r=>r.table==='messages'&&r.op==='update').length,0);assert.equal(w.qaData.chat_reads.length,0);});
 await t.test('status changes after the last message become read, and later changes stay unread until reloaded',async()=>{
  const data=records();data.applications[1].status_changed_at='2026-10-15T00:00:00.328748Z';
  const w=mount({qaRoute:past,qaData:data});
  await until(()=>w.qaData.chat_reads.some(r=>r.application_id===past),'status receipt');
  const receipt=w.qaData.chat_reads.find(r=>r.application_id===past && r.reader_id===user);
  assert.equal(receipt.last_read_at,'2026-10-15T00:00:00.328748Z');
  w.qaData.applications[1].status_changed_at='2026-10-16T00:00:00Z';
  assert.ok(Date.parse(receipt.last_read_at)<Date.parse(w.qaData.applications[1].status_changed_at));
  w.dispatchEvent(new w.Event('focus'));
  await until(()=>receipt.last_read_at==='2026-10-16T00:00:00Z','status-only refresh without 60 second delay');
 });
 await t.test('status-only conversations are read; failed receipt writes retry on the next load',async()=>{
  const data=records();data.messages=[];data.applications[1].status_changed_at='2026-10-15T00:00:00Z';
  const w=mount({qaRoute:past,qaData:data,qaFailUpsert:'chat_reads'});
  await until(()=>w.qaRequests.some(r=>r.table==='chat_reads'&&r.op==='upsert'),'failed receipt attempted');
  assert.equal(w.qaData.chat_reads.length,0);w.qaFailUpsert=null;w.dispatchEvent(new w.Event('focus'));
  await until(()=>w.qaData.chat_reads.length,'receipt retried');
  assert.equal(w.qaData.chat_reads[0].last_read_at,'2026-10-15T00:00:00Z');
 });
 await t.test('closed threads remain readable and cannot send; screen reports stay available',async()=>{const w=mount({qaRoute:past});await until(()=>w.document.body.textContent.includes('この仕事は完了'),'closed');assert.equal(input(w),null);assert.match(w.document.querySelector('.chat-messages').textContent,/ありがとうございました/);button(w,'詳細').click();await until(()=>button(w,'この画面を報告'),'screen report');let report;w.addEventListener('cb:open-support',event=>report=event.detail);button(w,'この画面を報告').click();assert.equal(report.view,'compose');assert.equal(report.topic,'chat');});
 await t.test('detail rows go straight to this job, participant, schedule and map while preserving the draft',async()=>{
  const w=mount({qaRoute:app}); await until(()=>input(w)&&!input(w).disabled,'loaded');
  await fill(w,'textarea[aria-label="メッセージ"]','戻って続ける下書き');
  let profile; w.addEventListener('cb:openEmployerPreview',event=>profile=event.detail);
  button(w,'詳細').click(); await until(()=>w.document.querySelector('[aria-label="相手のプロフィールを見る"]'),'details');
  w.document.querySelector('[aria-label="相手のプロフィールを見る"]').click();
  await until(()=>!w.document.querySelector('[role=dialog]'),'profile handoff'); assert.equal(profile,partner);
  assert.equal(input(w).value,'戻って続ける下書き');
  button(w,'詳細').click(); await until(()=>w.document.querySelector('[aria-label="この仕事の予定を見る"]'),'schedule link');
  const map=w.document.querySelector('a[aria-label="集合場所を地図で見る（別タブ）"]');
  assert.equal(new URL(map.href).searchParams.get('query'),'集合場所のサンプル'); assert.equal(map.target,'_blank');
  assert.equal(w.document.querySelector('a[href="#/calendar"]'),null);
  w.document.querySelector('[aria-label="この仕事の予定を見る"]').click();
  await until(()=>w.location.hash===`#/profile/worker/schedule/${app}`,'exact schedule');
  assert.equal(w.history.state.cbScheduleChat,app); assert.equal(w.document.querySelector('[role=dialog]'),null);
  button(w,'詳細').click(); await until(()=>w.document.querySelector('[aria-label="求人の詳細を見る"]'),'job link');
  w.document.querySelector('[aria-label="求人の詳細を見る"]').click();
  await until(()=>w.location.hash==='#/work/job/1311','exact job');
  assert.equal(w.sessionStorage.getItem('cb_jobBackTo'),`/chat/${app}`);
  assert.equal(w.document.querySelector('[aria-label="仕事の内容"]'),null,'no intermediate preview');
 });
 await t.test('employer links select the worker profile and the same application in the employer schedule',async()=>{
  const w=mount({qaRoute:app,qaUser:partner}); await until(()=>input(w)&&!input(w).disabled,'employer loaded');
  let profile; w.addEventListener('cb:openWorkerPreview',event=>profile=event.detail);
  button(w,'詳細').click(); await until(()=>w.document.querySelector('[aria-label="相手のプロフィールを見る"]'),'details');
  w.document.querySelector('[aria-label="相手のプロフィールを見る"]').click(); await pause(10); assert.equal(profile,user);
  button(w,'詳細').click(); await until(()=>w.document.querySelector('[aria-label="この仕事の予定を見る"]'),'schedule');
  w.document.querySelector('[aria-label="この仕事の予定を見る"]').click();
  await until(()=>w.location.hash===`#/profile/employer/schedule/${app}`,'employer schedule');
 });
 await t.test('rejected expired and cancelled conversations do not advertise appointments or meeting points',async()=>{
  for(const status of ['rejected','expired','canceled']){
   const data=records(); data.applications[0].status=status;
   const w=mount({qaRoute:app,qaData:data}); await until(()=>w.document.querySelector('.chat-stage') && w.document.querySelector('.chat-stage').textContent!=='確認中' && w.document.querySelector('.chat-bubble'),'closed loaded');
   button(w,'詳細').click(); await until(()=>w.document.querySelector('[aria-label="求人の詳細を見る"]'),'details');
   assert.equal(w.document.querySelector('[aria-label="この仕事の予定を見る"]'),null,status);
   assert.equal(w.document.querySelector('a[aria-label="集合場所を地図で見る（別タブ）"]'),null,status);
   assert.ok(button(w,'この画面を報告')); assert.ok(button(w,'メッセージを通報')); assert.equal(input(w),null);
  }
 });
 await t.test('help and screen reports close the detail page and message reporting opens the selected message',async()=>{
  const w=mount({qaRoute:app}); await until(()=>input(w)&&!input(w).disabled,'loaded');
  const requests=[]; w.addEventListener('cb:open-support',event=>requests.push(event.detail));
  for(const [label,view] of [['使い方・お問い合わせ','guide'],['この画面を報告','compose']]){
   button(w,'詳細').click(); await until(()=>w.document.querySelector('[role=dialog]'),label); const action=[...w.document.querySelectorAll('[role=dialog] button')].find(el=>el.textContent.replace(/›/g,'').trim()===label); assert.ok(action,label); action.click();
   await until(()=>!w.document.querySelector('[role=dialog]'),'details closed');
   assert.equal(requests.at(-1).view,view); assert.equal(requests.at(-1).topic,'chat');
  }
  button(w,'詳細').click(); await until(()=>button(w,'メッセージを通報'),'report'); button(w,'メッセージを通報').click();
  await until(()=>w.document.querySelector('.is-reportable'),'select message');
  w.document.querySelector('.is-reportable').click();
  await until(()=>w.document.querySelector('[role=dialog][aria-label="メッセージを通報"]'),'message form');
  assert.match(w.document.querySelector('[role=dialog]').textContent,/明日は集合場所でお待ちしています/);
  assert.equal(w.qaRequests.filter(row=>row.op==='insert').length,0,'navigating never sends');
 });
 await t.test('support chat also preserves failed messages and requires explicit send for multiline input',async()=>{const w=mount({qaRoute:'admin',qaSendMode:'lost'});await until(()=>w.document.querySelector('textarea')&&!w.document.querySelector('textarea').disabled,'support composer');await fill(w,'textarea','運営への相談\n二行目');const el=w.document.querySelector('textarea');el.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(w.qaData.admin_messages.length,0);button(w,'送信').click();await until(()=>button(w,'同じ内容で再送'),'support failure');button(w,'同じ内容で再送').click();await until(()=>el.value==='','support recovered');assert.equal(w.qaData.admin_messages.length,1);assert.ok(button(w,'この画面を報告'));});
 await t.test('worker confirmation commits the chat record once and retains failed confirmation cards',async()=>{
  for(const mode of ['normal','rejected','lost','switch','double']){
   const data=records();data.applications[0].terms_confirmed_worker_at=null;
   const w=mount({qaRoute:app,qaData:data,qaTermsMode:mode,qaTermsWrites:0});const alerts=[];w.alert=m=>alerts.push(m);
   await until(()=>[...w.document.querySelectorAll('button')].some(b=>b.textContent.includes('確認する →')),'confirmation invitation');
   [...w.document.querySelectorAll('button')].find(b=>b.textContent.includes('確認する →')).click();
   for(let i=0;i<20 && !button(w,'内容に相違ありません');i++){
    await until(()=>button(w,'はい')||button(w,'内容に相違ありません'),'confirmation step');
    const yes=button(w,'はい');if(yes){yes.click();await pause(10);}
   }
   const finish=button(w,'内容に相違ありません');assert.ok(finish);
   let release;if(mode==='double')w.qaTermsBeforeRPC=()=>new Promise(r=>{release=r;});
   finish.click();if(mode==='double'){finish.click();await until(()=>release,'confirmation RPC');assert.equal(w.qaRequests.filter(r=>r.rpc==='confirm_my_worker_terms').length,1);release();}
   if(['rejected','lost','switch'].includes(mode)){
    await until(()=>alerts.length && button(w,'内容に相違ありません')?.disabled === false,'confirmation error and retry');assert.ok(w.document.querySelector('[role="dialog"]'),'card remains open');
    if(mode==='lost'){button(w,'内容に相違ありません').click();await until(()=>!w.document.querySelector('[role="dialog"]'),'recovered');assert.equal(w.qaTermsWrites,1);}
    if(mode==='rejected')assert.equal(w.qaTermsWrites,0);
   }else{await until(()=>!w.document.querySelector('[role="dialog"]'),'confirmed');assert.equal(w.qaTermsWrites,1);}
   assert.equal(w.qaRequests.filter(r=>r.table==='messages'&&r.op==='insert').length,0,'no second client-side record insert');
   assert.equal(w.qaData.messages.filter(m=>m.id==='terms-message').length,mode==='rejected'?0:1);
  }
 });
 assert.deepEqual(errors,[]);
 }finally{dom?.window.close();await rm(output,{recursive:true,force:true});}
});

test('read watermarks isolate jobs, preserve prior reads and keep sub-millisecond status updates',()=>{
 const base={scope:[app,past],readerId:user,statusApplicationId:app,
 messages:[{application_id:app,created_at:'2026-08-19T05:19:22.449947Z'},{application_id:past,created_at:'2026-07-01T00:00:00Z'}],
 applications:[{id:app,status_changed_at:'2026-10-15T00:00:00.328748Z'},{id:past,status_changed_at:'2026-10-20T00:00:00Z'}],reads:[]};
 const rows=chatReadWatermarks(base);
 assert.equal(rows[0].last_read_at,'2026-10-15T00:00:00.328748Z');
 assert.equal(rows[1].last_read_at,'2026-07-01T00:00:00Z','another job status is not displayed and remains unread');
 base.reads=[{application_id:app,reader_id:user,last_read_at:'2026-10-15T00:00:00.328749Z'}];
 assert.equal(chatReadWatermarks(base)[0].last_read_at,'2026-10-15T00:00:00.328749Z','existing read cannot regress within a millisecond');
 assert.deepEqual(chatReadWatermarks({...base,messages:[],applications:[],reads:[]}),[]);
});
