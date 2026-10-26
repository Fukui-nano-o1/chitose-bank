import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import * as throttle from '../src/app/diagnostics/errorThrottle.js';

test('real client logger submits diagnostics without trusting old caller identity or operator fields',async()=>{
 const source=await readFile(new URL('../src/app/diagnostics/errorLog.js',import.meta.url),'utf8');
 const rows=[],local=[];
 const {logAppError}=runInNewContext(source.replace(/^import .*;\n/gm,'').replace(/export /g,'')+'\n({logAppError})',{
  ...throttle,
  supabase:{from(table){assert.equal(table,'app_errors');return{async insert(row){rows.push(row);}};}},
  rememberSupportFailure:data=>local.push(data),
  localStorage:{getItem:()=> 'synthetic-session'},
  window:{location:{href:'https://example.invalid/#/test'}},navigator:{userAgent:'Synthetic test'},console,
 });
 for(let i=0;i<6;i++) await logAppError({
  userId:'forged-user',user_id:'forged-user',status:'fixed',admin_note:'forged',identity_verified:true,
  source:'test',component:'Synthetic',error:{message:'Failed for test@example.invalid',code:'TEST'},
 });
 assert.equal(local.length,6,'local diagnostics remain available even after throttling');
 assert.equal(rows.length,throttle.MAX_PER_MESSAGE,'normal reports remain bounded');
 for(const row of rows){
  assert.equal(row.session_id,'synthetic-session');assert.equal(row.component,'Synthetic');
  assert.equal(row.error_code,'TEST');assert.equal(row.message,'Failed for [email]');
  for(const field of ['user_id','status','admin_note','resolved_at','created_at','identity_verified'])
   assert.equal(Object.hasOwn(row,field),false,field+' must be decided by the database');
 }
 assert.equal(rows.at(-1).metadata.throttled_after,throttle.MAX_PER_MESSAGE);
});
