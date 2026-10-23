import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {JSDOM, VirtualConsole} from 'jsdom';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
const root = fileURLToPath(new URL('../', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {const end=Date.now()+6000;while(!fn()){assert.ok(Date.now()<end,'UI settles');await pause(10);}}

test('contact display rechecks permission on opening and never reuses old contact values', async () => {
  const output=await mkdtemp(path.join(tmpdir(),'cb-emergency-ui-'));let dom;
  try {
    await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
      name:'emergency-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)lib\/supabase(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/emergency-contact-ui-client.js');},
    },react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/emergency-contact-ui-entry.jsx'),name:'EmergencyQA',formats:['iife'],fileName:'fixture'},minify:false}});
    dom=new JSDOM('<div id="root"></div>',{url:'https://ui.test',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
    const w=dom.window;let calls=0,release;
    const visible={ok:true,empty:false,name:'SECRET-NAME',relation:'本人',phone:'000-0000-0000'};
    const denied={ok:true,empty:true,reason:'not_confirmed',message:'ご本人の確認が済んでいないため表示できません'};
    let response={data:visible};
    const props={applicationId:'first',asButton:true,workWindow:false};
    w.qaProps=props;
    w.qaEmergencyClient={rpc:async(name)=>{assert.equal(name,'contract_emergency_contact');calls++;if(release===null)await new Promise(resolve=>{release=resolve;});return response;}};
    w.eval(await readFile(path.join(output,'fixture.iife.js'),'utf8'));
    await pause(30);assert.equal(calls,0);assert.equal(w.document.querySelector('button'),null);
    w.qaRender({...props,workWindow:true});await until(()=>w.document.querySelector('button'));
    assert.equal(calls,0,'closed button does not fetch');
    w.document.querySelector('button').click();await until(()=>w.document.querySelector('a[href^="tel:"]'));
    assert.equal(calls,1);assert.match(w.document.body.textContent,/確認・保存済み／作業中のみ表示/);
    w.document.querySelector('button').click();await pause(20);response={data:denied};
    w.document.querySelector('button').click();await until(()=>w.document.body.textContent.includes(denied.message));
    assert.equal(calls,2);assert.equal(w.document.querySelector('a'),null);assert.equal(w.document.body.textContent.includes('SECRET-NAME'),false);
    // Remounting the same application must also fetch, without a module-wide contact cache.
    w.qaRender({...props,workWindow:true,asButton:false},'remount');await until(()=>calls===3);await pause(20);
    assert.equal(w.document.querySelector('a'),null);
    response={data:visible};w.qaRender({...props,workWindow:true,asButton:false},'visible');await until(()=>w.document.querySelector('a'));
    release=null;w.qaRender({...props,applicationId:'second',workWindow:true,asButton:false},'pending');
    await until(()=>typeof release==='function');assert.equal(w.document.querySelector('a'),null);
    w.qaRender({...props,applicationId:'second',workWindow:false,asButton:false},'pending');await pause(20);release();await pause(20);
    assert.equal(w.document.body.textContent,'','in-flight response after work ends remains hidden');
    response={data:visible,error:{message:'denied'}};
    w.qaRender({...props,workWindow:true,asButton:false},'error');await until(()=>calls===6);await pause(20);
    assert.equal(w.document.querySelector('a'),null,'RPC error cannot display values');
  } finally {dom?.window.close();await rm(output,{recursive:true,force:true});}
});
