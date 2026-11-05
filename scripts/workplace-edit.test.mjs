import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {JSDOM,VirtualConsole} from 'jsdom';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
const root=fileURLToPath(new URL('../',import.meta.url));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){const end=Date.now()+5000;while(!fn()){assert.ok(Date.now()<end,label);await pause(10);}}
const workplaceEntry=w=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.includes('職場の写真')&&b.textContent.includes('写真の下書き・公開を管理'));

test('real employer profile links to a dedicated read-only workplace preparation page',async()=>{
 const output=await mkdtemp(path.join(tmpdir(),'cb-workplace-edit-'));let dom;
 try{
  await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'workplace-edit-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/profile-ui-client.js');}},react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/profile-ui-entry.jsx'),name:'WorkplaceEditQA',formats:['iife'],fileName:'fixture'},minify:false}});
  const script=await readFile(path.join(output,'fixture.iife.js'),'utf8');
  const errors=[];
  function mount(suffix=''){
   dom?.window.close();const vc=new VirtualConsole();vc.on('jsdomError',error=>errors.push(error.message));
   dom=new JSDOM('<div id="root"></div>',{url:'https://ui.test/#/profile/employer/profile'+suffix,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});const w=dom.window;
   Object.assign(w,{TextEncoder,TextDecoder,Response,Request,Headers,qaSurface:'employer',qaOptions:{},qaAlerts:[],qaSaved:[]});
   w.qaWorkplaceRPC=async()=>({error:{code:'PGRST202'}});
   w.alert=m=>w.qaAlerts.push(m);w.fetch=()=>{throw Error('Unexpected real network');};w.scrollTo=(_x,y)=>{w.scrollY=y;};w.HTMLElement.prototype.scrollIntoView=()=>{};
   w.eval(script);return w;
  }
  async function checkPreparation(w){
   await until(()=>w.document.body.textContent.includes("写真の選択・アップロード・保存・公開はできません"),"unconfigured settled");
   const page=w.document.querySelector('.workplace-edit-page');assert.ok(page);
   assert.match(page.textContent,/求人の写真とは別/);
   assert.match(page.textContent,/写真の選択・アップロード・保存・公開はできません/);
   assert.equal(page.querySelector('textarea,select,form,[contenteditable="true"],img,video,iframe'),null);
   for (const input of page.querySelectorAll('input')) assert.equal(input.disabled,true,'unconfigured inputs disabled');
   const buttons=[...page.querySelectorAll('button')];assert.match(buttons[0].textContent,/プロフィール編集に戻る/);
   for (const button of buttons.slice(1).filter(b=>!b.textContent.includes('読み込み'))) assert.equal(button.disabled,true,'unconfigured actions disabled');
   assert.equal(w.document.querySelector('[role="dialog"],.cb-sheet-up'),null);
   assert.equal(w.qaProfile.state.writes,0,'no insert/update triggered');assert.deepEqual([...w.qaSaved],[]);
   return buttons[0];
  }
  let w=mount();await until(()=>workplaceEntry(w),'profile workplace entry');const length=w.history.length;w.scrollY=410;
  workplaceEntry(w).click();await until(()=>w.document.querySelector('.workplace-edit-page'),'dedicated preparation opens');
  assert.equal(w.location.hash,'#/profile/employer/profile/workplace');(await checkPreparation(w)).click();
  await until(()=>workplaceEntry(w),'back to profile');await until(()=>w.scrollY===410,'profile list scroll restored');assert.equal(w.history.length,length+1);
  w.history.forward();await until(()=>w.document.querySelector('.workplace-edit-page'),'browser forward');await checkPreparation(w);
  w.history.back();await until(()=>workplaceEntry(w),'browser back');assert.equal(w.qaProfile.state.writes,0);
  w=mount('/workplace');await until(()=>w.document.querySelector('.workplace-edit-page'),'direct link preparation');(await checkPreparation(w)).click();
  await until(()=>workplaceEntry(w)&&w.location.hash==='#/profile/employer/profile','direct link returns to profile');assert.equal(w.qaProfile.state.writes,0);
  assert.deepEqual(errors,[]);
 }finally{dom?.window.close();await rm(output,{recursive:true,force:true});}
});
