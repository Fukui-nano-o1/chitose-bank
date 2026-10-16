import test from 'node:test';
import assert from 'node:assert/strict';
import {newDeviceDraft,saveDeviceDraft,queueDeviceDraft,settleDeviceDraft,readDeviceDraft,
  prepareDevicePublication,settleDevicePublication,rebaseDeviceDraft,forkDeviceDraft} from '../src/lib/deviceDrafts.js';
const owner='owner',items=[{text:'確認文言',checked:true}];
test.beforeEach(()=>{
  const data={};
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:k=>data[k]??null,setItem:(k,v)=>{data[k]=v;},removeItem:k=>{delete data[k];},
  }});
});
function synced() {
  const draft=saveDeviceDraft(newDeviceDraft(owner),{jobDescription:'confirmed'},{notes:'confirmed',draft_step:12});
  queueDeviceDraft(owner,draft.id);
  return settleDeviceDraft(owner,draft.id,draft.revision,{ok:true,row:{...draft.payload,id:draft.jobId,farmer_id:owner,job_number:42,status:'draft'}});
}
const success=d=>({ok:true,request_id:d.publication.requestId,check_id:d.publication.requestId,
  job_id:d.jobId,job_number:d.jobNumber,published_base:{...d.publication.expected,status:'open'},row:{...d.base,status:'open'}});

test('publication intent is durable and frozen before network; retries do not replace consent or input',()=>{
  const d=synced(), first=prepareDevicePublication(owner,d.id,items);
  assert.equal(first.state,'publishing');
  assert.deepEqual(prepareDevicePublication(owner,d.id,[{text:'later text',checked:true}]),first);
  const changed=saveDeviceDraft(first,{jobDescription:'new input'},{notes:'new input',draft_step:8});
  assert.deepEqual(changed.publication,first.publication);
  assert.equal(queueDeviceDraft(owner,d.id).state,'publishing');
  assert.equal(queueDeviceDraft(owner,d.id).pending,null);
  assert.deepEqual(rebaseDeviceDraft(owner,d.id,{...d.base,notes:'remote'}).base,d.base);
  assert.throws(()=>forkDeviceDraft(changed),/PUBLICATION_UNCONFIRMED/);
});
test('storage failures prevent preparation and unsynced drafts cannot publish',()=>{
  const d=synced();
  localStorage.setItem=()=>{throw new Error('quota');};
  assert.throws(()=>prepareDevicePublication(owner,d.id,items),/quota/);
  assert.equal(readDeviceDraft(owner,d.id).publication,undefined);
  assert.throws(()=>prepareDevicePublication(owner,'missing',items),/DRAFT_NOT_CONFIRMED/);
});
test('status-only, wrong receipt, job and owner responses never confirm or erase the operation',()=>{
  const d=prepareDevicePublication(owner,synced().id,items),ok=success(d),id=d.publication.requestId;
  for (const response of [null,{ok:true},{...ok,published_base:null},{...ok,published_base:{status:'open'}},{...ok,check_id:'different'},{...ok,job_id:'different'},
    {...ok,row:{...ok.row,farmer_id:'other'}},{...ok,row:{...ok.row,job_number:99}},
    {ok:false,reason:'request_mismatch'}]) {
    assert.equal(settleDevicePublication(owner,d.id,id,response).confirmed,false);
    assert.deepEqual(readDeviceDraft(owner,d.id).publication,d.publication);
  }
  assert.equal(settleDevicePublication(owner,d.id,'different',ok).confirmed,false);
});
test('confirmed operation preserves newer input; a page change alone does not count as a new edit',()=>{
  for (const newer of [false,true]) {
    const d=prepareDevicePublication(owner,synced().id,items);
    saveDeviceDraft(d,{jobDescription:newer?'new':'confirmed'}, {...d.payload,draft_step:8,...(newer?{notes:'new'}:{})});
    const outcome=settleDevicePublication(owner,d.id,d.publication.requestId,success(d));
    assert.equal(outcome.confirmed,true); assert.equal(outcome.newerInput,newer);
    assert.equal(outcome.record.state,newer?'local':'synced');
    assert.equal(outcome.record.payload.notes,newer?'new':'confirmed');
    assert.equal(outcome.record.publication,undefined); assert.equal(outcome.record.base.status,'open');
  }
});
test('definitive transaction rejection allows correction; conflict retains the original comparison base',()=>{
  for (const reason of ['publication_rejected','conflict']) {
    const d=prepareDevicePublication(owner,synced().id,items);
    const outcome=settleDevicePublication(owner,d.id,d.publication.requestId,{ok:false,reason,row:{...d.base,notes:'remote'}});
    assert.equal(outcome.confirmed,false); assert.equal(outcome.record.publication,undefined);
    assert.equal(outcome.record.payload.notes,'confirmed');
    assert.equal(outcome.record.state,reason==='conflict'?'conflict':'blocked');
    if (reason==='conflict') assert.deepEqual(outcome.record.conflictContext.base,d.base);
  }
});
test('a proven old publication that is now closed stays recoverable, not current publication success',()=>{
  const d=prepareDevicePublication(owner,synced().id,items),result=success(d);
  result.row.status='closed';
  const outcome=settleDevicePublication(owner,d.id,d.publication.requestId,result);
  assert.equal(outcome.confirmed,true); assert.equal(outcome.record.state,'blocked');
  assert.equal(outcome.record.reason,'publication_changed');
  assert.equal(outcome.record.payload.notes,'confirmed');
});
test('replay never rebases new local input onto another device\'s later update',()=>{
  const d=prepareDevicePublication(owner,synced().id,items),result=success(d);
  saveDeviceDraft(d,{jobDescription:'new local'},{...d.payload,notes:'new local'});
  result.row.notes='new remote';
  const outcome=settleDevicePublication(owner,d.id,d.publication.requestId,result);
  assert.equal(outcome.confirmed,true); assert.equal(outcome.newerInput,true);
  assert.equal(outcome.record.base.notes,'confirmed');
  assert.equal(queueDeviceDraft(owner,d.id).pending.base.notes,'confirmed');
});
