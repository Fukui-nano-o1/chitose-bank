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
async function until(fn,label){const end=Date.now()+4000;while(!fn()){assert.ok(Date.now()<end,label);await pause(10);}}
function select(w,index,names){const input=w.document.querySelectorAll('input[type=file]')[index];Object.defineProperty(input,'files',{configurable:true,value:names.map(n=>new w.File(['bytes'],n,{type:'image/png'}))});input.dispatchEvent(new w.Event('change',{bubbles:true}));}
test('real photo inputs lock simultaneous picks, enforce caps and ignore obsolete completions',async t=>{
 const output=await mkdtemp(path.join(tmpdir(),'cb-photo-ui-'));let dom;
 try{
  await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'photo-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)jobCreateApi(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/photo-input-api.js');}},react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/photo-input-entry.jsx'),name:'PhotoQA',formats:['iife'],fileName:'fixture'},minify:false}});
  const script=await readFile(path.join(output,'fixture.iife.js'),'utf8');
  async function mount(mode,photos=[]){dom?.window.close();dom=new JSDOM('<div id="root"></div>',{url:'https://ui.test',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});const w=dom.window;Object.assign(w,{qaMode:mode,qaInitialPhotos:photos,qaRequests:[],qaAlerts:[]});w.alert=m=>w.qaAlerts.push(m);w.eval(script);await until(()=>w.qaState,'mounted');return w;}
  await t.test('two danger slots cannot each add two photos; busy blocks next and removal',async()=>{const w=await mount('danger'),release=[];w.qaBeforeUpload=()=>new Promise(r=>release.push(r));select(w,0,['a','b','c']);select(w,1,['d','e']);await until(()=>release.length===2,'two uploads');assert.equal(w.qaRequests.length,2);await until(()=>w.document.querySelector('#next').disabled,'navigation locked');assert.equal(w.document.querySelector('fieldset').disabled,true);release.forEach(r=>r());await until(()=>w.qaState.places[0].photos.length===2&&!w.qaState.busy,'saved two');assert.deepEqual(Array.from(w.qaState.places[0].photos,p=>p.url),['https://photos.test/a','https://photos.test/b']);assert.equal(w.qaState.tasks[0].photos.length,0);});
  await t.test('failure retains descriptions and permits manual retry; repeated photo does not duplicate',async()=>{const w=await mount('danger');w.qaReject=true;select(w,0,['a']);await until(()=>w.qaAlerts.length&&!w.qaState.busy,'failed');assert.equal(w.qaState.places[0].label,'場所');assert.equal(w.qaState.places[0].photos.length,0);w.qaReject=false;select(w,0,['a']);await until(()=>w.qaState.places[0].photos.length===1,'retry');select(w,0,['a']);await until(()=>w.qaRequests.length===3&&!w.qaState.busy,'repeat');assert.equal(w.qaState.places[0].photos.length,1);});
  await t.test('job switch and unmount cannot append old uploads to the next draft',async()=>{for(const hide of [false,true]){const w=await mount('danger');let release;w.qaBeforeUpload=()=>new Promise(r=>release=r);select(w,0,['a']);await until(()=>release,'upload waiting');if(hide)w.qaHide();else w.qaSetJob(18);await until(()=>hide?w.qaCommitted?.visible===false:w.qaCommitted?.job===18,'new screen committed');release();await until(()=>!w.qaState.busy,'finished');assert.equal(w.qaState.places[0].photos.length,0);}});
  await t.test('general photos cap concurrent additions at ten and deduplicate retry',async()=>{const start=Array.from({length:9},(_,i)=>({url:'https://photos.test/'+i,caption:'keep'}));const w=await mount('photos',start);let release;w.qaBeforeUpload=()=>new Promise(r=>release=r);select(w,0,['a','b']);select(w,0,['c']);await until(()=>release,'upload waiting');assert.equal(w.qaRequests.length,1);w.qaSetPhotos([...start,{url:'https://photos.test/past',caption:'past'}]);await pause(20);release();await until(()=>!w.qaState.busy,'complete');assert.equal(w.qaState.photos.length,10);assert.equal(w.qaState.photos[9].caption,'past');});
 }finally{dom?.window.close();await rm(output,{recursive:true,force:true});}
});
