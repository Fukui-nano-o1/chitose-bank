import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { goAlongPath, pushAlongPath, routeReturn, returnAlongPath, readApplicantView, rememberApplicantView, clearApplicantView } from '../src/lib/routeTrail.js';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn) { const end=Date.now()+2000; while(!fn()) {assert.ok(Date.now()<end,'history timed out');await pause(10);} }
test('nested navigation retraces actual entries, preserving applicant tab/scroll without leaking into unrelated visits',async()=>{
 const dom=new JSDOM('',{url:'https://test.invalid/#/profile/employer/applicants'}); globalThis.window=dom.window; const NativeEvent=globalThis.Event; globalThis.Event=dom.window.Event;
 try {
  rememberApplicantView('farmer','app-a','application',135);
  assert.equal(readApplicantView('other'),null);
  const length=window.history.length;
  goAlongPath('/chat/app-a','応募者詳細に戻る'); await pause(10);
  assert.equal(readApplicantView('farmer'),null);
  goAlongPath('/work/job/1311','会話に戻る');await pause(10);
  pushAlongPath('#/work/job/1312','前の求人に戻る');
  assert.equal(routeReturn().from,'/work/job/1311');
  assert.equal(returnAlongPath(),true);await until(()=>window.location.hash==='#/work/job/1311');
  assert.equal(routeReturn().from,'/chat/app-a');
  assert.equal(returnAlongPath(),true);await until(()=>window.location.hash==='#/chat/app-a');
  assert.equal(routeReturn().from,'/profile/employer/applicants');
  assert.equal(returnAlongPath(),true);await until(()=>window.location.hash==='#/profile/employer/applicants');
  assert.equal(readApplicantView('farmer').id,'app-a');assert.equal(readApplicantView('farmer').tab,'application');assert.equal(readApplicantView('farmer').scrollTop,135);
  assert.equal(window.history.length,length+3,'returning never appends duplicate source entries');
  window.history.forward();await until(()=>window.location.hash==='#/chat/app-a');
  assert.equal(routeReturn().label,'応募者詳細に戻る');
  window.history.back();await until(()=>window.location.hash==='#/profile/employer/applicants');
  clearApplicantView();assert.equal(readApplicantView('farmer'),null);
  window.location.hash='/search';await pause(10);assert.equal(routeReturn(),null);assert.equal(returnAlongPath(),false);
 } finally {dom.window.close();delete globalThis.window;globalThis.Event=NativeEvent;}
});
