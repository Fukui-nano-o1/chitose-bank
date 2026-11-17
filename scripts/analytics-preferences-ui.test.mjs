import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
const root=fileURLToPath(new URL('../',import.meta.url));
test('measurement disclosure is closed by default; opening and policy navigation never grant consent',async()=>{
 const out=await mkdtemp(path.join(tmpdir(),'measurement-ui-'));let dom;
 try {
 await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
 name:'synthetic-measurement-ui',enforce:'pre',resolveId(id){
 if(id==='./PrivacyPolicy')return '\0synthetic-policy';
 if(id.endsWith('/Terms'))return '\0synthetic-terms';
 if(id.endsWith('/lib/productAnalytics'))return '\0measurement-store';
 if(id.endsWith('/lib/supabase'))return '\0measurement-client';
 if(id.endsWith('/lib/utils'))return '\0measurement-utils';
 },load(id){
 if(id==='\0synthetic-policy')return `export const PRIVACY_SECTIONS=[{id:'privacy-3',title:'Ledger',body:[],table:{rows:[['任意の利用状況の計測（synthetic exact fields）']]}},{id:'privacy-10',title:'Measurement policy',body:['1. Initial choice','2. 計測データの送信先 synthetic exact destination']}];export const PrivacyDataTable=()=>null;`;
 if(id==='\0synthetic-terms')return 'export const TERMS_ARTICLES=[];export const renderRichText=t=>t;';
 if(id==='\0measurement-store')return `let choice=null;const listeners=new Set();export const ANALYTICS_CHOICE_KEY='synthetic';export const productAnalytics={subscribe:f=>{listeners.add(f);return()=>listeners.delete(f)},choice:()=>choice,choose:v=>{window.choices.push(v);choice=v;listeners.forEach(f=>f());return true}};`;
 if(id==='\0measurement-client')return 'export const supabase={};';
 if(id==='\0measurement-utils')return 'export const isAdmin=()=>false;';
 }
 },react()],build:{outDir:out,lib:{entry:path.join(root,'scripts/fixtures/analytics-preferences-entry.jsx'),name:'MeasurementQA',formats:['iife'],fileName:'fixture'},minify:false}});
 dom=new JSDOM('<div id="root"></div>',{url:'https://ui.test/#/profile',runScripts:'dangerously',pretendToBeVisual:true});const w=dom.window;w.choices=[];w.eval(await readFile(path.join(out,'fixture.iife.js'),'utf8'));
 const details=w.document.querySelector('details'),summary=w.document.querySelector('summary');
 assert.equal(details.open,false);assert.match(summary.textContent,/使いやすくするための計測/);assert.match(summary.textContent,/未選択/);summary.click();assert.equal(details.open,true);assert.equal(w.choices.length,0);
 const routeEvents=[];w.addEventListener('hashchange',()=>routeEvents.push(w.location.hash));
 const historyLength=w.history.length;const link=w.document.querySelector('a');assert.equal(link.getAttribute('href'),'#/privacy');link.click();await new Promise(r=>setTimeout(r,20));assert.equal(w.location.hash,'#/privacy');assert.deepEqual(routeEvents,['#/privacy']);assert.equal(w.history.state.cbPrivacySection,'analytics');assert.equal(w.choices.length,0);
 link.click();await new Promise(r=>setTimeout(r,10));assert.equal(w.choices.length,0);assert.equal(w.history.length,historyLength+1);
 w.history.back();await new Promise(r=>setTimeout(r,30));assert.equal(w.location.hash,'#/profile');assert.equal(w.history.state?.cbPrivacySection,undefined);
 w.history.forward();await new Promise(r=>setTimeout(r,30));assert.equal(w.location.hash,'#/privacy');assert.equal(w.history.state.cbPrivacySection,'analytics');
 const buttons=[...w.document.querySelectorAll('button')];buttons.find(b=>b.textContent==='許可する').click();await new Promise(r=>setTimeout(r,10));assert.deepEqual([...w.choices],['granted']);assert.match(w.document.querySelector('[role="status"]').textContent,/許可しています/);
 summary.click();summary.click();assert.deepEqual([...w.choices],['granted']);buttons.find(b=>b.textContent==='許可しない').click();await new Promise(r=>setTimeout(r,10));assert.deepEqual([...w.choices],['granted','denied']);
 w.renderPreferences({always:true,hidden:true});assert.equal(w.document.querySelector('details'),null);w.renderPreferences({always:true});assert.equal(w.document.querySelector('details').open,false);
 w.HTMLElement.prototype.scrollIntoView=function(){w.lastScrolled=this.id;};w.scrollTo=()=>{w.lastScrolled='top';};
 w.renderPrivacy();await new Promise(r=>setTimeout(r,40));assert.equal(w.lastScrolled,'privacy-10');assert.equal(w.document.activeElement.textContent,'Measurement policy');
 const overview=w.document.querySelector('[aria-label="計測の記録内容と送信先"]');assert.match(overview.textContent,/synthetic exact fields/);assert.match(overview.textContent,/synthetic exact destination/);
 w.history.replaceState(null,'','#/privacy');w.dispatchEvent(new w.Event('popstate'));await new Promise(r=>setTimeout(r,40));assert.equal(w.lastScrolled,'top');assert.equal(w.document.activeElement.textContent,'プライバシーポリシー');
 }finally{dom?.window.close();await rm(out,{recursive:true,force:true});}
});
