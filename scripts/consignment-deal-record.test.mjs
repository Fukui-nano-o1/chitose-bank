import test from 'node:test';
import assert from 'node:assert/strict';
import {saveConsignmentRecord,readConsignmentPending,consignmentPendingKey} from '../src/features/consignment/consignmentRecord.js';
import {consignmentFixture,memoryStorage,uid} from './fixtures/consignment-deal-client.mjs';
const input=f=>({owner:uid,row:f.state.row,patch:{spec:f.state.row.spec,status:'draft',notes:'変更メモ'},fields:[],terms:{}});
test('normal confirmation clears only this account and deal operation',async()=>{
  const f=consignmentFixture(),storage=memoryStorage();storage.setItem('other','keep');
  const r=await saveConsignmentRecord(f.client,input(f),{storage});assert.equal(r.changed,false);assert.equal(f.state.writes,1);assert.deepEqual([...storage.data.keys()],['other']);
});
test('response loss retains immutable operation across reload and does not duplicate',async()=>{
  const options={lostResponse:true},f=consignmentFixture(options),storage=memoryStorage(),i=input(f);
  await assert.rejects(saveConsignmentRecord(f.client,i,{storage}),{code:'CONSIGNMENT_UNCONFIRMED'});
  const pending=readConsignmentPending(storage,uid,i.row.id);assert.ok(pending.p_request_id);options.lostResponse=false;
  const r=await saveConsignmentRecord(f.client,i,{storage});assert.equal(r.changed,false);assert.equal(f.state.writes,1);assert.equal(f.state.events[0].p_request_id,f.state.events[1].p_request_id);
});
test('changed input after unknown result confirms old save without claiming new changes saved',async()=>{
  const options={lostResponse:true},f=consignmentFixture(options),storage=memoryStorage(),i=input(f);
  await assert.rejects(saveConsignmentRecord(f.client,i,{storage}));options.lostResponse=false;
  const changed={...i,patch:{...i.patch,notes:'unsaved later edit'}};
  const r=await saveConsignmentRecord(f.client,changed,{storage});assert.equal(r.changed,true);assert.equal(r.row.notes,i.patch.notes);assert.equal(f.state.writes,1);
});
test('new deal retry preserves both request UUID and deal UUID',async()=>{
  const options={lostResponse:true},f=consignmentFixture(options),storage=memoryStorage(),i={...input(f),row:null};
  await assert.rejects(saveConsignmentRecord(f.client,i,{storage}));const a=readConsignmentPending(storage,uid,null);options.lostResponse=false;
  const r=await saveConsignmentRecord(f.client,i,{storage});assert.equal(r.row.id,a.p_deal_id);assert.equal(f.state.writes,1);
});
test('storage failure blocks sending and corrupt stored operation is not discarded',async()=>{
  const f=consignmentFixture(),storage=memoryStorage();storage.setItem=()=>{throw Error('quota');};
  await assert.rejects(saveConsignmentRecord(f.client,input(f),{storage}),{code:'CONSIGNMENT_STORAGE'});assert.equal(f.state.events.length,0);
  const broken=memoryStorage(),key=consignmentPendingKey(uid,f.state.row.id);broken.setItem(key,'broken');
  await assert.rejects(saveConsignmentRecord(f.client,input(f),{storage:broken}),{code:'CONSIGNMENT_STORAGE'});assert.equal(broken.getItem(key),'broken');
});
for(const mode of ['rejected','conflict'])test(mode+' retains caller input and allows correcting a rejected request',async()=>{
  const f=consignmentFixture({[mode]:true}),storage=memoryStorage(),i=input(f);
  await assert.rejects(saveConsignmentRecord(f.client,i,{storage}));assert.equal(f.state.writes,0);assert.equal(storage.data.size,0);assert.equal(i.patch.notes,'変更メモ');
});
test('session changes before, between check/RPC, and after RPC do not report success',async()=>{
  for(const when of ['before','during','after']){
    const options={},f=consignmentFixture(options),storage=memoryStorage();
    if(when==='before')f.state.userId='other';if(when==='during')options.beforeWrite=s=>{s.userId='other';};if(when==='after')options.switchAfterWrite=true;
    await assert.rejects(saveConsignmentRecord(f.client,input(f),{storage}),{code:'CONSIGNMENT_SESSION'});assert.equal(f.state.writes,when==='after'?1:0);
  }
});
