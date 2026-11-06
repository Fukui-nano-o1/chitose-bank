import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {ACTIVE_LISTING_FLOW,LISTING_NAV_VERSION,STAGE4_LISTING_NAV_VERSION,parseListingRoute,resolveListingResume,adjacentListingPage} from '../src/features/jobs/create/listingNavigation.js';
const root=fileURLToPath(new URL('../',import.meta.url));
test('retired repeat page never renders or appears in the active route and survives saved links',()=>{
 assert.equal(ACTIVE_LISTING_FLOW.includes('repeat_approval'),false);
 for(const scope of ['new','edit/123','local/abcdef'])assert.equal(parseListingRoute(`#/work/${scope}/page/repeat_approval?return=review`).pageId,'worker_preferences');
 for(const version of [LISTING_NAV_VERSION,STAGE4_LISTING_NAV_VERSION])assert.deepEqual(resolveListingResume({listingPageId:'repeat_approval',listingNavVersion:version,listingReturnToReview:true}),{pageId:'worker_preferences',returnToConfirm:true});
 assert.equal(adjacentListingPage('worker_preferences',1),'review');
});
test('true legacy flags cannot surface on cards, highlights, badges, or old wishes modes',async()=>{
 const out=await mkdtemp(path.join(tmpdir(),'retired-flags-'));let dom;
 try{
  await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)lib\/supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/listing-photo-client.js');}},react()],build:{outDir:out,lib:{entry:path.join(root,'scripts/fixtures/retired-job-flags-entry.jsx'),name:'FlagsQA',formats:['iife'],fileName:'fixture'},minify:false}});
  dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.test',runScripts:'dangerously',pretendToBeVisual:true});const w=dom.window;
  w.qaPhotoClient={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{}}};
  w.fetch=()=>{throw Error('No real network allowed');};
  w.eval(await readFile(path.join(out,'fixture.iife.js'),'utf8'));
  for(const expert of [false,true])for(const mode of ['all','preferences','repeat']){
   w.qaRenderRetiredFlags(expert,mode);
   assert.doesNotMatch(w.document.body.textContent,/初心者|はじめての人|リピート|リピーター|自動承認|また呼びたい/);
   if(expert)assert.match(w.document.body.textContent,/経験者優遇/);
   if(!expert)assert.equal(w.document.querySelector('.job-card-conditions'),null,'no empty badge gap');
  }
 }finally{dom?.window.close();await rm(out,{recursive:true,force:true});}
});
