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

test('job workplace preview preserves ordering, published-only photos, truthful states and navigation', async t=>{
 const output=await mkdtemp(path.join(tmpdir(),'cb-workplace-intro-'));let dom;
 try{
  await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'intro-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)lib\/supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/listing-photo-client.js');}},react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/job-workplace-intro-entry.jsx'),name:'IntroQA',formats:['iife'],fileName:'fixture'},minify:false}});
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
  dom=new JSDOM('<div id="root"></div>',{url:'https://intro.test',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});const w=dom.window;
  const owner='11111111-1111-4111-8111-111111111111';
  const photo=hex=>({id:hex.repeat(64),path:`${owner}/${hex.repeat(64)}.jpg`});
  const downloads=[],revoked=[];let releaseSlow;
  w.fetch=()=>{throw Error('Unexpected real network');};
  w.URL.createObjectURL=()=>`blob:https://intro.test/${downloads.length}`;w.URL.revokeObjectURL=url=>revoked.push(url);
  w.qaPhotoClient={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{}},storage:{from:bucket=>({download:async key=>{
   downloads.push({bucket,key});
   if(key===photo('d').path)await new Promise(resolve=>{releaseSlow=resolve;});
   return key===photo('e').path?{error:Error('403')}:{data:new w.Blob(['synthetic-photo'])};
  }})}};
  w.eval(await readFile(path.join(output,'fixture.iife.js'),'utf8'));
  const section=()=>w.document.querySelector('#sec-workplace'),text=()=>section().textContent;
  await t.test('section sits between the host row and beginner highlights with a real button',()=>{
   assert.match(section().previousElementSibling.textContent,/募集主：合成農園/);
   assert.match(section().nextElementSibling.textContent,/初心者大歓迎/);
   assert.equal(section().dataset.secLabel,'職場紹介');
   const button=section().querySelector('.job-workplace-more');assert.equal(button.tagName,'BUTTON');
   button.click();button.click();assert.equal(w.qaWorkplaceOpen,2);
  });
  await t.test('loading, failure, missing capability and empty stay distinct',()=>{
   assert.match(text(),/読み込んでいます/);assert.doesNotMatch(text(),/まだ登録されていません/);
   for(const props of [{status:'error',photoStatus:'ready'},{status:'ready',photoStatus:'error'}]){
    w.qaRenderIntro(props);assert.match(text(),/読み込めませんでした/);assert.doesNotMatch(text(),/まだ登録されていません/);
   }
   w.qaRenderIntro({status:'ready',photoStatus:'unconfigured'});assert.match(text(),/写真は準備中/);
   w.qaRenderIntro({status:'ready',photoStatus:'ready'});assert.match(text(),/まだ登録されていません/);
   assert.equal(section().querySelector('img'),null);
  });
  await t.test('only selected public profile fields render, long text stays safely clamped',()=>{
   w.qaRenderIntro({status:'ready',photoStatus:'ready',employer:{intro_atmosphere:'  合成の雰囲気\n'+'長い紹介文'.repeat(100),recruiter_contact:'PRIVATE CONTACT',recruiter_address:'PRIVATE ADDRESS',texts_pending:{intro_atmosphere:'PENDING COPY'},avatar_url:'https://avatar.test/private.jpg'}});
   assert.match(text(),/合成の雰囲気/);assert.doesNotMatch(text(),/PRIVATE|PENDING COPY/);
   assert.equal(section().querySelector('img,iframe,video'),null);
   w.qaRenderIntro({status:'ready',photoStatus:'ready',employer:{teaching_style:'show_first,invalid-value'}});
   assert.match(text(),/やって見せてから任せる/);assert.doesNotMatch(text(),/invalid-value/);
   w.qaRenderIntro({status:'ready',photoStatus:'ready',employer:{intro_atmosphere:' ',teaching_style:'unknown'}});
   assert.match(text(),/まだ登録されていません/);
  });
  await t.test('preview takes three independent published photos and never reads arbitrary URLs',async()=>{
   const photos=[photo('a'),photo('b'),photo('c'),photo('f'),{path:'https://external.test/photo.jpg'},{path:'job-photos/private.jpg'}];
   for(const photoStatus of ['loading','error','unconfigured']){
    w.qaRenderIntro({status:'ready',photos,photoStatus});await pause(10);assert.equal(section().querySelector('img'),null);
   }
   assert.deepEqual(downloads,[]);
   w.qaRenderIntro({status:'ready',photos,photoStatus:'ready'});
   await until(()=>section().querySelectorAll('[data-workplace-photo="ready"]').length===3,'three published images');
   assert.equal(section().querySelector('.job-workplace-photos').dataset.count,'3');assert.match(text(),/写真4枚を見る/);
   assert.deepEqual(downloads.map(item=>item.bucket),['workplace-photos','workplace-photos','workplace-photos']);
   assert.deepEqual(downloads.map(item=>item.key),photos.slice(0,3).map(item=>item.path));
   section().querySelector('.job-workplace-photos').click();assert.equal(w.qaWorkplaceOpen,3);
   for(const count of [1,2]){
    w.qaRenderIntro({status:'ready',photos:photos.slice(0,count),photoStatus:'ready'});
    assert.equal(section().querySelector('.job-workplace-photos').dataset.count,String(count));
    assert.equal(section().querySelectorAll('img').length,count);
   }
  });
  await t.test('slow old images and private data cannot survive replacement with a loading job',async()=>{
   w.qaRenderIntro({status:'ready',photoStatus:'ready',photos:[photo('d')],employer:{intro_atmosphere:'OLD WORKPLACE'}});
   await until(()=>typeof releaseSlow==='function','slow photo request');
   w.qaRenderIntro({status:'loading',photoStatus:'loading',photos:[photo('d')],employer:{intro_atmosphere:'OLD WORKPLACE'}});
   assert.equal(section().querySelector('img'),null);assert.doesNotMatch(text(),/OLD WORKPLACE/);
   releaseSlow();await pause(30);assert.equal(section().querySelector('img'),null);
   w.qaRenderIntro({status:'ready',photoStatus:'ready',photos:[photo('e')]});
   await until(()=>section().querySelector('[data-workplace-photo="unavailable"]'),'denied photo');
   assert.equal(section().querySelector('img').getAttribute('src'),null);
   assert.ok(revoked.length,'old blob leases are released');
  });
  const css=await readFile(path.join(root,'src/features/jobs/search/components/jobWorkplaceIntro.css'),'utf8');
  assert.match(css,/-webkit-line-clamp: 3/);assert.match(css,/overflow-wrap: anywhere/);
  assert.match(css,/max-width: 479px/);assert.match(css,/min-height: 44px/);assert.match(css,/:focus-visible/);
  assert.deepEqual(errors,[]);
 }finally{dom?.window.close();await rm(output,{recursive:true,force:true});}
});
