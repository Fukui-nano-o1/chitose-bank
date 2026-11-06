import test from 'node:test';
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
 await t.test('legacy automatic approval history is neutral in inbox and bubbles without changing saved messages',async()=>{
  const data=records();const original='🌟リピート即決の設定により、応募を自動で承認しました（採用ではありません）。チャットで打ち合わせを進めましょう。';
  data.messages[0].body=original;data.messages[0].created_at=data.applications[0].created_at;
  const w=mount({qaData:data});await until(()=>w.document.querySelector('.chat-row-preview')?.textContent.includes('応募が承認されました'),'neutral preview');
  assert.doesNotMatch(w.document.body.textContent,/リピート即決/);
  w.qaNavigate(app);await until(()=>w.document.querySelector('.chat-bubble')?.textContent.includes('応募が承認されました'),'neutral bubble');
  assert.doesNotMatch(w.document.querySelector('.chat-messages').textContent,/リピート即決/);
  assert.equal(w.qaData.messages[0].body,original);assert.equal(w.qaData.messages[0].id,data.messages[0].id);
  assert.equal(w.qaRequests.some(r=>r.table==='messages'&&r.op==='update'&&r.value?.body),false);
 });
 await t.test('inbox load failures expose retry instead of claiming no conversations',async()=>{const w=mount({qaFailRead:'applications'});await until(()=>button(w,'再読み込み'),'retry');assert.doesNotMatch(w.document.body.textContent,/会話はここから始まります/);w.qaFailRead=null;button(w,'再読み込み').click();await until(()=>w.document.querySelectorAll('.chat-inbox-row').length===2,'recovered');});
 await t.test('keyboard, zoom and rotation keep both shell and closeable details in the visual viewport',async()=>{const w=mount({qaRoute:app});await until(()=>input(w)&&!input(w).disabled,'loaded');await fill(w,'textarea[aria-label="メッセージ"]','入力途中');const vv=w.visualViewport;Object.assign(vv,{width:320,height:290,offsetTop:155,offsetLeft:20,scale:1});vv.dispatchEvent(new w.Event('resize'));const room=w.document.querySelector('.chat-room');assert.equal(room.style.getPropertyValue('--chat-top'),'155px');assert.equal(room.style.getPropertyValue('--chat-height'),'290px');assert.equal(w.getComputedStyle(room).position,'fixed');assert.equal(w.getComputedStyle(room).display,'flex');assert.equal(w.getComputedStyle(room).flexDirection,'column');const rules=[];function visit(list){for(const rule of list){if(rule.selectorText)rules.push(rule);if(rule.cssRules)visit(rule.cssRules);}}for(const sheet of w.document.styleSheets)visit(sheet.cssRules);assert.ok(rules.some(rule=>rule.selectorText==='header:where(.app-header)'));assert.equal(rules.some(rule=>rule.style.getPropertyPriority('padding')==='important'&&w.document.querySelector('.chat-room-header').matches(rule.selectorText)),false);button(w,'詳細').click();await until(()=>w.document.querySelector('[role=dialog]'),'details');assert.equal(w.document.querySelector('.chat-sheet-overlay').style.getPropertyValue('--chat-height'),'290px');w.document.querySelector('[aria-label="閉じる"]').click();await until(()=>!w.document.querySelector('[role=dialog]'),'close');assert.equal(input(w).value,'入力途中');button(w,'詳細').click();await until(()=>w.document.querySelector('[aria-label="求人の詳細を見る"]'),'job link');w.document.querySelector('[aria-label="求人の詳細を見る"]').click();await until(()=>w.location.hash==='#/work/job/1311','direct job detail');assert.equal(w.sessionStorage.getItem('cb_jobBackTo'),`/chat/${app}`);assert.equal(w.document.querySelector('[role=dialog]'),null);Object.assign(vv,{width:844,height:390,offsetTop:0,offsetLeft:0,scale:1});vv.dispatchEvent(new w.Event('resize'));assert.equal(room.style.getPropertyValue('--chat-width'),'844px');assert.ok(w.document.querySelector('[aria-label="メッセージ一覧に戻る"]'));});
 await t.test('drafts survive navigation, templates append without sending, Enter only adds a newline',async()=>{const w=mount({qaRoute:app});await until(()=>input(w)&&!input(w).disabled,'loaded');await fill(w,'textarea[aria-label="メッセージ"]','先に入力した文');button(w,'定型文').click();await until(()=>button(w,'持ち物'),'templates');button(w,'持ち物').click();await until(()=>input(w).value.includes('持ち物'),'append');assert.ok(input(w).value.startsWith('先に入力した文'));input(w).dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(w.qaRequests.filter(r=>r.op==='insert').length,0);w.qaNavigate(past);await until(()=>w.document.body.textContent.includes('この仕事は完了'),'past thread');w.qaNavigate(app);await until(()=>input(w)?.value.includes('持ち物'),'draft restored');assert.equal(w.qaData.messages.length,2);assert.equal(Object.keys(w.localStorage).some(k=>String(w.localStorage.getItem(k)).includes('先に入力した文')),false);});
 await t.test('lost send response and double clicks retry the same UUID exactly once',async()=>{const w=mount({qaRoute:app,qaSendMode:'lost'});await until(()=>input(w)&&!input(w).disabled,'loaded');await fill(w,'textarea[aria-label="メッセージ"]','受信済みでも二重送信しない');button(w,'送信').click();button(w,'送信')?.click();await until(()=>button(w,'同じ内容で再送'),'failed');assert.equal(input(w).value,'受信済みでも二重送信しない');assert.equal(input(w).readOnly,true);button(w,'同じ内容で再送').click();await until(()=>input(w).value==='','acknowledged');const sent=w.qaData.messages.filter(m=>m.body==='受信済みでも二重送信しない');assert.equal(sent.length,1);const requests=w.qaRequests.filter(r=>r.op==='insert');assert.equal(new Set(requests.map(r=>r.value.id)).size,1);assert.equal(w.document.querySelectorAll('.chat-bubble').length,2);});
 await t.test('send deadline unblocks controls and late results cannot contaminate another thread',async()=>{const w=mount({qaRoute:app,qaSendMode:'hold'});await until(()=>input(w)&&!input(w).disabled,'loaded');await fill(w,'textarea[aria-label="メッセージ"]','送信後に別の会話へ移動');button(w,'送信').click();await until(()=>button(w,'同じ内容で再送'),'bounded timeout');w.qaNavigate(past);await until(()=>w.document.body.textContent.includes('この仕事は完了'),'switched');w.qaResolveSend();await pause(30);assert.doesNotMatch(w.document.querySelector('.chat-messages').textContent,/送信後に別の会話へ移動/);w.qaNavigate(app);await until(()=>input(w)?.value==='','confirmed by fetch');assert.equal(w.qaData.messages.filter(m=>m.body==='送信後に別の会話へ移動').length,1);});
 await t.test('opening clears message and newer status unread markers, including status-only chats',async()=>{
  for(const empty of [false,true]){
   const data=records(); data.applications[0].status_changed_at='2026-09-24T10:00:00.123456Z'; data.applications[0].status_changed_by=partner;
   data.messages[0].created_at='2026-09-24T10:00:00.123455Z';
   if(empty) data.messages=data.messages.filter(message=>message.application_id!==app);
   const w=mount({qaRoute:app,qaData:data,qaComputeUnread:true});
   await until(()=>w.qaData.chat_reads.some(row=>row.application_id===app && row.last_read_at==='2026-09-24T10:00:00.123456Z'),'status saved');
   await until(()=>w.qaRequests.some(row=>row.table==='chat_reads'&&row.op==='select'),'verified');
   await pause(30); w.qaNavigate('list');
   await until(()=>w.document.querySelectorAll('.chat-inbox-row').length===2,'return list');
   await until(()=>![...w.document.querySelectorAll('.chat-inbox-row')].find(row=>row.textContent.includes('1311'))?.querySelector('.chat-unread'),'dot cleared');
   assert.ok([...w.document.querySelectorAll('.chat-inbox-row')].find(row=>row.textContent.includes('1200'))?.querySelector('.chat-unread'),'other chat remains unread');
  }
 });
 await t.test('failed and silently rejected read writes retain unread and recover on explicit retry',async()=>{
  for(const failure of ['qaFailReadWrite','qaZeroReadWrite']){
   const data=records();data.applications[0].status_changed_at='2026-09-24T10:00:00Z';data.applications[0].status_changed_by=partner;
   const w=mount({qaRoute:app,qaData:data,qaComputeUnread:true,[failure]:'chat_reads'});
   await until(()=>button(w,'既読を再試行'),'read failure');
   assert.equal(w.qaData.chat_reads.length,0);assert.match(w.document.querySelector('.chat-messages').textContent,/明日は/);
   w[failure]=null;button(w,'既読を再試行').click();
   await until(()=>w.qaData.chat_reads.length===1,'retry saved');
   await until(()=>!button(w,'既読を再試行'),'retry clear');
  }
 });
 await t.test('an unchanged acknowledged snapshot clears a transient status-load error on recovery',async()=>{
  const data=records();data.messages=[];data.applications[0].status_changed_at='2026-09-24T10:00:00Z';
  const w=mount({qaRoute:app,qaData:data,qaComputeUnread:true});await until(()=>w.qaData.chat_reads.length===1,'acknowledged');await pause(30);
  w.qaFailRead='applications';w.dispatchEvent(new w.Event('focus'));await until(()=>button(w,'既読を再試行'),'status read failed');
  w.qaFailRead=null;button(w,'既読を再試行').click();await until(()=>!button(w,'既読を再試行'),'status recovered');
 });
 await t.test('failed message acknowledgement does not advance the status cursor',async()=>{
  const w=mount({qaRoute:app,qaComputeUnread:true,qaFailReadWrite:'messages'});
  await until(()=>button(w,'既読を再試行'),'failed write');assert.equal(w.qaData.chat_reads.length,0);
  assert.equal(w.qaData.messages[0].read_at,null);
  w.qaFailReadWrite=null;button(w,'既読を再試行').click();await until(()=>w.qaData.messages[0].read_at,'retry message');
 });
 await t.test('a delayed write never acknowledges messages or status changes arriving after its snapshot',async()=>{
  const data=records();data.applications[0].status_changed_at='2026-09-24T10:00:00Z';data.applications[0].status_changed_by=partner;
  const w=mount({qaRoute:app,qaData:data,qaComputeUnread:true,qaHoldReadWrite:'messages'});
  await until(()=>w.qaReleaseReadWrite,'pending write');
  w.qaData.messages.push({id:'new-unseen',application_id:app,sender_id:partner,body:'後から届いたメッセージ',created_at:'2026-09-24T12:00:00Z',read_at:null});
  w.qaData.applications[0].status_changed_at='2026-09-24T13:00:00Z';
  w.qaHoldReadWrite=null;w.qaReleaseReadWrite();
  await until(()=>w.qaData.chat_reads.length===1,'old snapshot saved');
  assert.equal(w.qaData.chat_reads[0].last_read_at,'2026-09-24T10:00:00Z');assert.equal(w.qaData.messages.at(-1).read_at,null);
  assert.doesNotMatch(w.document.querySelector('.chat-messages').textContent,/後から届いた/);
  w.dispatchEvent(new w.Event('focus'));
  await until(()=>w.qaData.messages.at(-1).read_at,'new message rendered and read');
  await until(()=>w.qaData.chat_reads[0].last_read_at==='2026-09-24T13:00:00Z','new status read');
 });
 await t.test('a later fetched message never acknowledges a status missing from the application snapshot',async()=>{
  const data=records();data.applications[0].status_changed_at='2026-09-24T10:00:00Z';data.applications[0].status_changed_by=partner;
  data.messages[0].created_at='2026-09-24T12:00:00Z';
  const w=mount({qaRoute:app,qaData:data,qaComputeUnread:true,qaHoldReadWrite:'messages'});
  await until(()=>w.qaReleaseReadWrite,'snapshot read');
  w.qaData.applications[0].status_changed_at='2026-09-24T11:00:00Z';
  w.qaHoldReadWrite=null;w.qaReleaseReadWrite();await until(()=>w.qaData.chat_reads.length===1,'observed status read');
  assert.equal(w.qaData.chat_reads[0].last_read_at,'2026-09-24T10:00:00Z');
  assert.ok(w.qaData.messages[0].read_at);
  w.qaNavigate('list');await until(()=>w.document.querySelectorAll('.chat-inbox-row').length===2,'return list');
  assert.ok([...w.document.querySelectorAll('.chat-inbox-row')].find(row=>row.textContent.includes('1311'))?.querySelector('.chat-unread'),'unseen status remains unread');
 });
 await t.test('identical refreshes do not cancel a delayed status acknowledgement',async()=>{
  const data=records();data.messages=[];data.applications[0].status_changed_at='2026-09-24T10:00:00Z';
  data.chat_reads=[{application_id:app,reader_id:user,last_read_at:'2026-09-23T10:00:00Z'}];
  const w=mount({qaRoute:app,qaData:data,qaComputeUnread:true,qaHoldReadWrite:'chat_reads'});
  await until(()=>w.qaReleaseReadWrite,'slow upsert');
  for(let i=0;i<3;i++){w.dispatchEvent(new w.Event('focus'));await pause(15);}
  assert.equal(w.qaRequests.filter(row=>row.table==='chat_reads'&&row.op==='upsert').length,1);
  w.qaHoldReadWrite=null;w.qaReleaseReadWrite();
  await until(()=>w.qaData.chat_reads[0].last_read_at==='2026-09-24T10:00:00Z','original acknowledgement finished');
  assert.equal(button(w,'既読を再試行'),undefined);
 });
 await t.test('a timed-out acknowledgement can retry and a late old response cannot regress it',async()=>{
  const data=records();data.messages=[];data.applications[0].status_changed_at='2026-09-24T10:00:00Z';
  data.chat_reads=[{application_id:app,reader_id:user,last_read_at:'2026-09-23T10:00:00Z'}];
  const w=mount({qaRoute:app,qaData:data,qaComputeUnread:true,qaHoldReadWrite:'chat_reads'});
  await until(()=>w.qaReleaseReadWrite,'held acknowledgement');const release=w.qaReleaseReadWrite;
  await until(()=>button(w,'既読を再試行'),'bounded read timeout');
  w.qaHoldReadWrite=null;w.qaData.applications[0].status_changed_at='2026-09-24T11:00:00Z';
  button(w,'既読を再試行').click();await until(()=>w.qaData.chat_reads[0].last_read_at==='2026-09-24T11:00:00Z','retry newer snapshot');
  release();await pause(30);assert.equal(w.qaData.chat_reads[0].last_read_at,'2026-09-24T11:00:00Z');
  assert.equal(button(w,'既読を再試行'),undefined);
 });
 await t.test('returning to the inbox during a slow write finishes only the already-opened snapshot',async()=>{
  const data=records();data.applications[0].status_changed_at='2026-09-24T10:00:00Z';data.applications[0].status_changed_by=partner;
  const w=mount({qaRoute:app,qaData:data,qaComputeUnread:true,qaHoldReadWrite:'messages'});
  await until(()=>w.qaReleaseReadWrite,'pending read');const release=w.qaReleaseReadWrite;
  w.qaNavigate('list');await until(()=>w.document.querySelectorAll('.chat-inbox-row').length===2,'back to list');
  assert.ok([...w.document.querySelectorAll('.chat-inbox-row')].find(row=>row.textContent.includes('1311'))?.querySelector('.chat-unread'));
  w.qaHoldReadWrite=null;release();
  await until(()=>w.qaData.chat_reads.length===1,'observed status saved after back');
  await until(()=>![...w.document.querySelectorAll('.chat-inbox-row')].find(row=>row.textContent.includes('1311'))?.querySelector('.chat-unread'),'list refreshes without reopening');
  assert.ok([...w.document.querySelectorAll('.chat-inbox-row')].find(row=>row.textContent.includes('1200'))?.querySelector('.chat-unread'));
 });
 await t.test('history scrolling leaves new messages unread until returning to the bottom',async()=>{
  const w=mount({qaRoute:app,qaComputeUnread:true});await until(()=>w.qaData.messages[0].read_at,'initial read');
  const panel=w.document.querySelector('.chat-messages');
  Object.defineProperties(panel,{scrollHeight:{configurable:true,value:1000},clientHeight:{configurable:true,value:200}});
  panel.scrollTop=0;panel.dispatchEvent(new w.Event('scroll',{bubbles:true}));
  w.qaData.messages.push({id:'scrolled-new',application_id:app,sender_id:partner,body:'スクロール中の新着',created_at:'2026-09-24T12:00:00Z',read_at:null});
  w.dispatchEvent(new w.Event('focus'));await until(()=>w.document.body.textContent.includes('スクロール中の新着'),'new history');
  await pause(40);assert.equal(w.qaData.messages.at(-1).read_at,null);
  panel.scrollTop=900;panel.dispatchEvent(new w.Event('scroll',{bubbles:true}));
  await until(()=>w.qaData.messages.at(-1).read_at,'bottom acknowledged');
 });
 await t.test('status cursor does not imply a read receipt for an unseen outgoing message',async()=>{
  const data=records();data.messages[0].sender_id=user;data.messages[0].read_at=null;
  data.chat_reads=[{application_id:app,reader_id:partner,last_read_at:'2026-09-25T00:00:00Z'}];
  const w=mount({qaRoute:app,qaData:data});await until(()=>w.document.querySelector('.chat-bubble'),'message');
  await pause(40);assert.doesNotMatch(w.document.querySelector('.chat-messages').textContent,/既読/);
  w.qaData.messages[0].read_at='2026-09-25T01:00:00Z';w.dispatchEvent(new w.Event('focus'));
  await until(()=>w.document.querySelector('.chat-messages').textContent.includes('既読'),'actual receipt');
 });
 await t.test('a newer persisted cursor is not regressed by an older open snapshot',async()=>{
  const data=records();data.chat_reads=[{application_id:app,reader_id:user,last_read_at:'2026-09-25T00:00:00Z'}];
  const w=mount({qaRoute:app,qaData:data});await until(()=>w.qaData.messages[0].read_at,'message read');await pause(40);
  assert.equal(w.qaData.chat_reads[0].last_read_at,'2026-09-25T00:00:00Z');
 });
 await t.test('late reads after account switch cannot refresh the new account or continue writes',async()=>{
  const w=mount({qaRoute:app,qaHoldReadWrite:'messages'});await until(()=>w.qaReleaseReadWrite,'pending read');
  const release=w.qaReleaseReadWrite;w.qaHoldReadWrite=null;w.qaNavigate('list');w.qaAccount('unrelated-account');await pause(30);
  const before=w.qaRequests.filter(row=>row.table==='chat_reads'&&row.op!=='select').length;
  release();await pause(50);
  assert.equal(w.qaRequests.filter(row=>row.table==='chat_reads'&&row.op!=='select').length,before);
 });
 await t.test('hidden conversations are not marked read and failure retains visible history',async()=>{const w=mount({qaRoute:app,qaFailRead:'messages'});Object.defineProperty(w.document,'visibilityState',{configurable:true,value:'hidden'});await until(()=>button(w,'再読み込み'),'read error');assert.equal(w.qaRequests.filter(r=>r.table==='messages'&&r.op==='update').length,0);w.qaFailRead=null;button(w,'再読み込み').click();await until(()=>w.document.querySelector('.chat-bubble'),'history recovered');assert.equal(w.qaRequests.filter(r=>r.table==='messages'&&r.op==='update').length,0);});
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
