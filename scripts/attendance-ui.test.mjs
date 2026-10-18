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
const setText=(w,text)=>{const el=w.document.querySelector('textarea');Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype,'value').set.call(el,text);el.dispatchEvent(new w.Event('input',{bubbles:true}));};
test('actual attendance and dispute screens recover pending reports and never close on failed saves',async t=>{
 const output=await mkdtemp(path.join(tmpdir(),'cb-attendance-ui-'));let dom;
 try{
  await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'attendance-fixture',enforce:'pre',resolveId(id,importer){
   if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/attendance-ui-client.js');
   if(id.endsWith('/attendanceRecord.js')&&importer?.endsWith('/useAttendanceRecord.js'))return path.join(root,'scripts/fixtures/attendance-ui-record.js');
  }},react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/attendance-ui-entry.jsx'),name:'AttendanceQA',formats:['iife'],fileName:'fixture'},minify:false}});
  const script=await readFile(path.join(output,'fixture.iife.js'),'utf8');
  async function mount(mode,options={}){
   dom?.window.close();const vc=new VirtualConsole(),errors=[];vc.on('jsdomError',e=>errors.push(e.message));
   dom=new JSDOM('<div id="root"></div>',{url:'https://ui.test/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});
   const w=dom.window;Object.assign(w,{TextEncoder,TextDecoder,qaMode:mode,qaOptions:options,qaDone:[],qaAlerts:[],qaClosed:0,qaErrors:errors});w.alert=m=>w.qaAlerts.push(m);w.eval(script);
   await until(()=>w.document.querySelector('[role="alert"]')||w.document.querySelector('textarea:not(:disabled)'),'screen ready');return w;
  }
  async function fill(w,text='連絡内容'){
   if(w.qaMode==='daily'){
    button(w,'記録することを選ぶ →').click();
    const choices=[...w.document.querySelectorAll('button')].filter(b=>b.querySelector('span'));assert.ok(choices.length);choices[0].click();
   }
   setText(w,text);await pause(10);
  }
  const send=w=>button(w,w.qaMode==='daily'?'記録する':'送信する');
  for(const mode of ['daily','dispute']){
   await t.test(mode+' normal and double-click sends one event',async()=>{const w=await mount(mode);await fill(w);let release;w.qaOptions.beforeRPC=()=>new Promise(r=>{release=r;});send(w).click();send(w).click();await until(()=>release,'RPC');assert.equal(w.qaAttendance.state.calls.length,1);assert.ok(w.document.querySelector('textarea').disabled);release();await until(()=>w.qaDone.length,'done');assert.equal(w.qaAttendance.state.notifications,1);assert.deepEqual(w.qaErrors,[]);});
   await t.test(mode+' response loss restores original input after reopening and replays one event',async()=>{
    const w=await mount(mode,{lostResponse:true});await fill(w,'保存済みの内容');send(w).click();await until(()=>w.qaAlerts.length,'unknown');assert.equal(w.qaDone.length,0);assert.equal(w.qaAttendance.state.writes,1);
    w.qaUnmount();await pause(15);w.qaMount();await until(()=>w.document.querySelector('textarea:not(:disabled)'),'reopened');assert.equal(w.document.querySelector('textarea').value,'保存済みの内容');
    w.qaOptions.lostResponse=false;send(w).click();await until(()=>w.qaDone.length,'recovered');assert.equal(w.qaAttendance.state.writes,1);assert.equal(w.qaAttendance.state.notifications,1);
   });
   await t.test(mode+' rejected save keeps input and failed read blocks send',async()=>{
    const w=await mount(mode,{readError:true});assert.ok(w.document.querySelector('textarea').disabled);assert.equal(w.qaAttendance.state.calls.length,0);w.qaOptions.readError=false;button(w,'もう一度読み込む').click();await until(()=>!w.document.querySelector('textarea').disabled,'retry read');await fill(w);w.qaOptions.rejected=true;send(w).click();await until(()=>w.qaAlerts.length,'rejected');assert.equal(w.qaDone.length,0);assert.equal(w.document.querySelector('textarea').value,'連絡内容');assert.equal(w.qaAttendance.state.writes,0);
   });
  }
  await t.test('changed reason after unknown send is not falsely acknowledged as saved',async()=>{
   const w=await mount('dispute',{lostResponse:true});await fill(w,'元の内容');send(w).click();await until(()=>w.qaAlerts.length,'unknown');setText(w,'変更後の内容');await pause(10);w.qaOptions.lostResponse=false;send(w).click();await until(()=>w.qaAlerts.length===2,'changed warning');assert.equal(w.qaDone.length,0);assert.equal(w.document.querySelector('textarea').value,'変更後の内容');assert.equal(w.qaAttendance.state.writes,1);assert.match(w.qaAlerts[1],/まだ送信していません/);
  });
 }finally{dom?.window.close();await rm(output,{recursive:true,force:true});}
});
