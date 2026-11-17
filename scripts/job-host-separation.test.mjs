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
test('person entry focuses existing public host details; workplace alone navigates, without widening fields',async()=>{
 const out=await mkdtemp(path.join(tmpdir(),'host-ui-'));let dom;
 try {
 await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'host-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)lib\/supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/listing-photo-client.js');}},react()],build:{outDir:out,lib:{entry:path.join(root,'scripts/fixtures/job-host-entry.jsx'),name:'HostQA',formats:['iife'],fileName:'fixture'},minify:false}});
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));dom=new JSDOM('<div id="root"></div>',{url:'https://ui.test/#/work/job/101',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});const w=dom.window;
 w.fetch=()=>{throw Error('Unexpected network');};w.qaPreview=0;w.qaWorkplace=0;
 w.HTMLElement.prototype.scrollIntoView=function(){w.scrolled=this.id;};w.scrollTo=()=>{};
 const employer={nickname:'Synthetic host',owner_comment:'PUBLIC PERSON INTRO',intro_atmosphere:'PUBLIC WORKPLACE ATMOSPHERE',break_style:'PUBLIC BREAK STYLE',recruiter_address:'PRIVATE ADDRESS',recruiter_contact:'PRIVATE CONTACT',texts_pending:{owner_comment:'PENDING INTRO'}};
 w.qaProps={employer};w.eval(await readFile(path.join(out,'fixture.iife.js'),'utf8'));await pause(30);
 const host=()=>w.document.querySelector('button[aria-label="募集主を見る"]');assert.ok(host());
 const history=w.history.length;host().click();assert.equal(w.scrolled,'sec-host');assert.equal(w.document.activeElement.textContent,'募集主について');assert.equal(w.location.hash,'#/work/job/101');assert.equal(w.history.length,history);assert.equal(w.qaPreview,0);assert.equal(w.qaWorkplace,0);
 const person=w.document.getElementById('sec-host');assert.match(person.textContent,/PUBLIC PERSON INTRO/);assert.doesNotMatch(person.textContent,/WORKPLACE|BREAK STYLE|PRIVATE|PENDING/);assert.equal(person.querySelector('[role="button"]'),null);assert.doesNotMatch(person.textContent,/職場紹介を見る/);
 w.document.querySelector('.job-workplace-more').click();assert.equal(w.qaWorkplace,1);assert.equal(w.location.hash,'#/work/job/101/workplace');w.qaReturnWorkplace();await pause(35);assert.equal(w.location.hash,'#/work/job/101');w.history.forward();await pause(35);assert.equal(w.location.hash,'#/work/job/101/workplace');w.history.back();await pause(35);host().click();assert.equal(w.location.hash,'#/work/job/101');
 w.qaRenderHost({employer,interactive:false});assert.equal(host(),null,'default preview has no dead button');
 w.qaRenderHost({employer,preview:true});host().click();assert.equal(w.qaPreview,1);const previewCard=w.document.querySelector('#sec-host [role="button"]');previewCard.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));previewCard.dispatchEvent(new w.KeyboardEvent('keydown',{key:' ',bubbles:true}));assert.equal(w.qaPreview,3,'explicit preview keyboard callbacks preserved');assert.equal(w.qaWorkplace,1);
 w.qaRenderHost({employer,preview:true,both:true});host().click();assert.equal(w.qaPreview,3);assert.equal(w.qaWorkplace,1);assert.equal(w.document.querySelector("#sec-host [role=button]"),null,"public mode wins over preview callback");
 assert.deepEqual(errors,[]);
 }finally{dom?.window.close();await rm(out,{recursive:true,force:true});}
});
test('render boundary retains compatibility without invoking workplace callback',async()=>{
 const source=await readFile(path.join(root,'src/features/jobs/search/components/JobDetailPanel.jsx'),'utf8');
 const row=source.slice(source.indexOf('export function JobHostRow'),source.indexOf('export function JobHostRow')+2600);
 assert.match(row,/typeof onOpenWorkplace === "function" \? focusJobHostSection/);
 assert.doesNotMatch(row,/onOpenWorkplace\(/);
});
