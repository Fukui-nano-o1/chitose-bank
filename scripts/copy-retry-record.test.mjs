import test from 'node:test';
import assert from 'node:assert/strict';
import {copyJobRecord,copyRequestStore} from '../src/lib/copyJobRecord.js';
import {copyRetryFixture} from './fixtures/copy-retry-client.mjs';
test('confirmed copy is retained until edit handoff acknowledgment',async()=>{const f=copyRetryFixture();const r=await copyJobRecord(f.client,1,{},f);assert.equal(f.state.writes,1);assert.equal(f.state.pending.size,1);await r.acknowledge();assert.equal(f.state.pending.size,0);});
test('lost response and reload reuse the operation and original calendar dates',async()=>{
 const f=copyRetryFixture({lostResponse:true}),dates={date_start:'2026-11-01',date_end:'2026-11-01',holidays:[]};
 await assert.rejects(copyJobRecord(f.client,1,{presetDates:dates,quietDates:true},f),{code:'COPY_UNCONFIRMED'});f.options.lostResponse=false;
 const recovered=await copyJobRecord(f.client,1,{presetDates:{date_start:'changed'}},f);assert.deepEqual(recovered.intent.presetDates,dates);assert.equal(recovered.intent.quietDates,true);assert.equal(f.state.writes,1);assert.equal(f.state.calls[0].p_request_id,f.state.calls[1].p_request_id);await recovered.acknowledge();
});
test('two callers holding the same durable intent resolve one target',async()=>{const f=copyRetryFixture();const [a,b]=await Promise.all([copyJobRecord(f.client,1,{},f),copyJobRecord(f.client,1,{},f)]);assert.equal(a.data.job_number,b.data.job_number);assert.equal(f.state.writes,1);});
test('owner/source scopes do not collide and acknowledgment cannot delete a newer operation',async()=>{const f=copyRetryFixture();const a=await copyJobRecord(f.client,1,{},f),b=await copyJobRecord(f.client,2,{},f);assert.notEqual(a.data.job_number,b.data.job_number);await a.acknowledge();const next=await copyJobRecord(f.client,1,{},f);await a.acknowledge();assert.equal(f.state.pending.size,2);await next.acknowledge();});
test('blocked durable storage prevents the server call',async()=>{const f=copyRetryFixture({storageError:true});await assert.rejects(copyJobRecord(f.client,1,{},f),{code:'COPY_STORAGE'});assert.equal(f.state.calls.length,0);await assert.rejects(copyRequestStore(null).acquire('key',{}),/unavailable/);});
test('definite rejection clears pending but a failed acknowledgment preserves it',async()=>{
 const f=copyRetryFixture({rejected:true});await assert.rejects(copyJobRecord(f.client,1,{},f),{code:'COPY_REJECTED'});assert.equal(f.state.pending.size,0);assert.equal(f.state.writes,0);
 f.options.rejected=false;f.options.clearError=true;const r=await copyJobRecord(f.client,1,{},f);await assert.rejects(r.acknowledge(),{code:'COPY_ACK'});assert.equal(f.state.pending.size,1);
});
test('deleted target and account switches never report a new successful copy',async()=>{
 const f=copyRetryFixture();await copyJobRecord(f.client,1,{},f);f.options.deleted=true;await assert.rejects(copyJobRecord(f.client,1,{},f),{code:'COPY_REJECTED'});assert.equal(f.state.writes,1);
 for(const when of ['during','after']){const g=copyRetryFixture();if(when==='during')g.options.beforeRPC=s=>{s.userId='other';};else g.options.switchAfterRPC=true;await assert.rejects(copyJobRecord(g.client,1,{},g),{code:'COPY_SESSION'});assert.equal(g.state.writes,when==='during'?0:1);}
});
