import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { newDeviceDraft, saveDeviceDraft, readDeviceDraft, listDeviceDrafts, queueDeviceDraft,
  settleDeviceDraft, rebaseDeviceDraft } from '../src/lib/deviceDrafts.js';
import { jobDraftBase, jobDraftPatch, safeDraftRebase, syncDeviceWork } from '../src/lib/offlineSync.js';

// 2026-10-14に読み取った本番RPCのv_allowed。フロントの定数から生成しない。
const dbFields = ['crop','task','zip','prefecture','city','town','address','date_label','date_start','date_end','holidays','headcount','pay_type','hourly_wage','daily_wage','work_time','break_time','nearest_station','commute_time','job_exp','beginner_ok','instant_approve_repeat','perks','experienced_preferred','notes','belongings','cautions','overtime_policy','overtime_detail','place_change_scope','task_change_scope','danger_places','danger_tasks','photos','work_video_url','work_video_job_consent','work_video_related_consent','work_video_consent_at','work_video_consent_version','draft_step','draft_step_id','lat','lng','geo_radius_m','geocoded_from'];
const owner = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002';
const jobId = '00000000-0000-4000-8000-000000000003', version = 'fixture-only';
const copy = value => structuredClone(value);
const currentRow = (values = {}) => ({ ...Object.fromEntries(dbFields.map(key => [key,null])), id:jobId, farmer_id:owner, job_number:42, status:'draft', notes:'original', ...values });
const snapshot = row => Object.fromEntries([...dbFields,'status'].map(key=>[key,row[key]]));
function storage() {
  const data = {};
  Object.defineProperties(data, {
    getItem:{value:key=>data[key] ?? null}, setItem:{value:(key,value)=>{data[key]=String(value);}}, removeItem:{value:key=>{delete data[key];}},
  });
  return data;
}
function local(row=null, payload={notes:'edited'}) { return saveDeviceDraft(newDeviceDraft(owner,row),{jobDescription:payload.notes},payload); }
function fixture(initial=null) {
  const rows = new Map(initial ? [[initial.id,copy(initial)]] : []);
  const calls=[];
  const state={user:owner,consent:version,writes:0,failBefore:null,loseAfter:false,wait:null};
  const client={
    auth:{getSession:async()=>({data:{session:{user:{id:state.user}}}})},
    from(table) {
      assert.equal(table,'account_holders');
      const q={select:()=>q,eq:()=>q,maybeSingle:()=>q,retry:async()=>({data:{agreed_privacy_version:state.consent}})};
      return q;
    },
    rpc(name,args) {
      calls.push({name,args:copy(args)});
      return {retry:async enabled=>{
        assert.equal(enabled,false);
        if(state.wait) await state.wait;
        if(state.failBefore) return copy(state.failBefore);
        assert.equal(name,'sync_my_job_draft');
        if(args.p_owner !== state.user) return {data:{ok:false,reason:'not_logged_in'}};
        if(Object.keys(args.p_patch).some(k=>!dbFields.includes(k))) return {data:{ok:false,reason:'bad_field'}};
        let row=rows.get(args.p_id);
        if(row) {
          if(row.status !== 'draft' && row.status !== 'pending') return {data:{ok:false,reason:'conflict',row:copy(row)}};
          const same=Object.entries(args.p_patch).every(([k,v])=>isDeepStrictEqual(row[k],v));
          if(row.status === 'draft' && same) return {data:{ok:true,row:copy(row)}};
          if(!isDeepStrictEqual(snapshot(row),args.p_expected)) return {data:{ok:false,reason:'conflict',row:copy(row)}};
        } else if(args.p_expected!==null) return {data:{ok:false,reason:'conflict',row:null}};
        row={...currentRow({id:args.p_id,job_number:row?.job_number||42}),...row,...copy(args.p_patch),status:'draft'};
        rows.set(args.p_id,row);state.writes++;
        if(state.loseAfter) {state.loseAfter=false;return {status:0,error:{message:'Failed to fetch'}};}
        return {data:{ok:true,row:copy(row)}};
      }};
    },
  };
  return {client,calls,state,rows};
}
test.beforeEach(()=>{
  Object.defineProperty(globalThis,'localStorage',{value:storage(),configurable:true});
  Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
});

test('snapshot contains server-only draft_step_id, including explicit null',()=>{
  assert.deepEqual(jobDraftBase(currentRow()),snapshot(currentRow()));
  assert.deepEqual(jobDraftBase(currentRow({draft_step_id:'description'})),snapshot(currentRow({draft_step_id:'description'})));
});
test('patch cannot alter ownership, publication status, or server-only step id',()=>{
  assert.deepEqual(jobDraftPatch({notes:'allowed',id:'x',farmer_id:other,status:'open',draft_step_id:'injected'}),{notes:'allowed'});
});
test('normal edit with complete server snapshot saves rather than looping in conflict',async()=>{
  const row=currentRow();const d=local(row);queueDeviceDraft(owner,d.id);const f=fixture(row);
  await syncDeviceWork(f.client,owner,version);
  assert.equal(readDeviceDraft(owner,d.id).state,'synced');assert.equal(f.state.writes,1);assert.equal(f.rows.get(jobId).notes,'edited');
});
test('legacy snapshot is not padded with an invented draft_step_id; a verified rebase repairs it',async()=>{
  const row=currentRow({draft_step_id:'description'}), legacy={...row};delete legacy.draft_step_id;
  assert.equal(Object.hasOwn(jobDraftBase(legacy),'draft_step_id'),false);
  const d=local(legacy);queueDeviceDraft(owner,d.id);const f=fixture(row);await syncDeviceWork(f.client,owner,version);
  assert.equal(readDeviceDraft(owner,d.id).state,'conflict');
  assert.equal(safeDraftRebase(legacy,row,d.payload).safe,true);
  rebaseDeviceDraft(owner,d.id,row);queueDeviceDraft(owner,d.id);await syncDeviceWork(f.client,owner,version);
  assert.equal(readDeviceDraft(owner,d.id).state,'synced');assert.equal(f.rows.size,1);assert.equal(f.state.writes,1);
});
test('JSON object key order alone never creates a conflict',()=>{
  const base=currentRow({photos:[{url:'photo',caption:'old',meta:{a:1,b:2}}]});
  const remote=currentRow({photos:[{meta:{b:2,a:1},caption:'old',url:'photo'}]});
  assert.equal(safeDraftRebase(base,remote,{photos:[{url:'photo',caption:'new',meta:{a:1,b:2}}]}).safe,true);
});
test('photo array order is significant and cannot be overwritten',()=>{
  const base=currentRow({photos:[{url:'a'},{url:'b'}]});const remote=currentRow({photos:[{url:'b'},{url:'a'}]});
  assert.equal(safeDraftRebase(base,remote,{photos:base.photos}).safe,false);
});
test('a real conflicting edit is rejected, not merged by last-writer-wins',()=>{
  assert.deepEqual(safeDraftRebase(currentRow(),currentRow({notes:'another editor'}),{notes:'mine'}),{safe:false,reason:'overlapping_edits',fields:['notes']});
});
test('a remote-only change covered by a full stale payload is also protected',()=>{
  const base=currentRow({daily_wage:'10000'}),remote=currentRow({daily_wage:'11000'});
  assert.equal(safeDraftRebase(base,remote,{notes:'edited',daily_wage:'10000'}).safe,false);
});
test('a sparse patch preserves unrelated remote fields and matching edits are safe',()=>{
  assert.equal(safeDraftRebase(currentRow(),currentRow({daily_wage:'11000'}),{notes:'edited'}).safe,true);
  assert.equal(safeDraftRebase(currentRow(),currentRow({notes:'edited'}),{notes:'edited'}).safe,true);
});
test('missing identities and changed owner or job are never safe to rebase',()=>{
  for(const [base,remote] of [[{status:'draft'},{status:'draft'}],[currentRow(),currentRow({farmer_id:other})],[currentRow(),currentRow({id:other})],[null,currentRow()]])
    assert.equal(safeDraftRebase(base,remote,{notes:'edited'}).safe,false);
});
test('open, closed, and ended listings are never automatically rebased',()=>{
  for(const status of ['open','closed','expired']) assert.equal(safeDraftRebase(currentRow(),currentRow({status}),{notes:'edited'}).safe,false);
});
test('lost response after INSERT retries the identical request and creates only one job',async()=>{
  const d=local();queueDeviceDraft(owner,d.id);const f=fixture();f.state.loseAfter=true;
  await syncDeviceWork(f.client,owner,version);
  const pending=readDeviceDraft(owner,d.id);assert.equal(pending.state,'pending');assert.equal(pending.form.jobDescription,'edited');
  await syncDeviceWork(f.client,owner,version);
  assert.deepEqual(f.calls[0].args,f.calls[1].args);assert.equal(readDeviceDraft(owner,d.id).state,'synced');assert.equal(f.rows.size,1);assert.equal(f.state.writes,1);
});
test('lost response after UPDATE is confirmed without an extra mutation',async()=>{
  const row=currentRow(),d=local(row);queueDeviceDraft(owner,d.id);const f=fixture(row);f.state.loseAfter=true;
  await syncDeviceWork(f.client,owner,version);await syncDeviceWork(f.client,owner,version);
  assert.deepEqual(f.calls[0].args,f.calls[1].args);assert.equal(f.state.writes,1);assert.equal(f.rows.size,1);assert.equal(readDeviceDraft(owner,d.id).state,'synced');
});
test('server outage before saving preserves the request for explicit retry',async()=>{
  const d=local();queueDeviceDraft(owner,d.id);const f=fixture();f.state.failBefore={status:503,error:{code:'PGRST000'}};
  assert.equal((await syncDeviceWork(f.client,owner,version)).retry,true);assert.equal(readDeviceDraft(owner,d.id).state,'pending');
  f.state.failBefore=null;await syncDeviceWork(f.client,owner,version);assert.deepEqual(f.calls[0].args,f.calls[1].args);assert.equal(f.state.writes,1);
});
test('two concurrent sync callers share one in-flight write',async()=>{
  const d=local();queueDeviceDraft(owner,d.id);const f=fixture();let release;f.state.wait=new Promise(r=>{release=r;});
  const one=syncDeviceWork(f.client,owner,version),two=syncDeviceWork(f.client,owner,version);
  await new Promise(r=>setImmediate(r));release();await Promise.all([one,two]);assert.equal(f.calls.length,1);assert.equal(f.state.writes,1);
});
test('offline does not send or pretend the pending data is saved',async()=>{
  const d=local();queueDeviceDraft(owner,d.id);const f=fixture();navigator.onLine=false;
  assert.equal((await syncDeviceWork(f.client,owner,version)).retry,true);assert.equal(f.calls.length,0);assert.equal(readDeviceDraft(owner,d.id).state,'pending');
});
test('changed login cannot submit another account draft',async()=>{
  const d=local();queueDeviceDraft(owner,d.id);const f=fixture();f.state.user=other;
  assert.equal((await syncDeviceWork(f.client,owner,version)).authRequired,true);assert.equal(f.calls.length,0);assert.equal(readDeviceDraft(other,d.id),null);
});
test('expired authorization keeps input and pending request for re-login',async()=>{
  const d=local();queueDeviceDraft(owner,d.id);const f=fixture();f.state.failBefore={status:401,error:{code:'PGRST301'}};
  assert.equal((await syncDeviceWork(f.client,owner,version)).authRequired,true);assert.equal(readDeviceDraft(owner,d.id).form.jobDescription,'edited');assert.equal(f.state.writes,0);
});
test('unconfirmed consent cannot send a draft',async()=>{
  const d=local();queueDeviceDraft(owner,d.id);const f=fixture();f.state.consent='old';
  assert.equal((await syncDeviceWork(f.client,owner,version)).consentRequired,true);assert.equal(f.calls.length,0);
});
test('database business refusal preserves input and does not automatically repeat the write',async()=>{
  const d=local();queueDeviceDraft(owner,d.id);const f=fixture();f.state.failBefore={status:403,error:{code:'42501'}};
  await syncDeviceWork(f.client,owner,version);await syncDeviceWork(f.client,owner,version);
  assert.equal(readDeviceDraft(owner,d.id).state,'blocked');assert.equal(readDeviceDraft(owner,d.id).form.jobDescription,'edited');assert.equal(f.calls.length,1);
});
test('late acknowledgements cannot erase new input or settle the wrong request',()=>{
  const d=local();queueDeviceDraft(owner,d.id);const newer=saveDeviceDraft(d,{jobDescription:'newer'},{notes:'newer'});queueDeviceDraft(owner,d.id);
  settleDeviceDraft(owner,d.id,d.revision,{ok:true,row:currentRow({id:d.jobId,notes:'edited'})});
  assert.equal(readDeviceDraft(owner,d.id).form.jobDescription,'newer');assert.equal(readDeviceDraft(owner,d.id).pending.token,newer.revision);
  settleDeviceDraft(owner,d.id,d.revision,{ok:false,reason:'conflict',row:null});
  assert.equal(readDeviceDraft(owner,d.id).pending.token,newer.revision);
});
test('another tab cannot silently replace the current input',()=>{
  const d=local();saveDeviceDraft(d,{jobDescription:'newer'},{notes:'newer'});
  assert.throws(()=>saveDeviceDraft(d,{jobDescription:'older'},{notes:'older'}),/DEVICE_DRAFT_CHANGED/);
});
test('storage failures are never reported as successful saves',()=>{
  localStorage.setItem('unrelated','keep');
  Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>null,setItem:()=>{throw new Error('quota');}},configurable:true});
  assert.throws(()=>local(),/quota/);
});
test('repeated publish attempts do not turn a genuine conflict into an overwrite',async()=>{
  const base=currentRow(),d=local(base),remote=currentRow({notes:'remote edit'});const f=fixture(remote);queueDeviceDraft(owner,d.id);
  await syncDeviceWork(f.client,owner,version);
  for(let i=0;i<3;i++) {queueDeviceDraft(owner,d.id);await syncDeviceWork(f.client,owner,version);}
  assert.equal(f.rows.get(jobId).notes,'remote edit');assert.equal(f.state.writes,0);
  assert.equal(readDeviceDraft(owner,d.id).form.jobDescription,'edited');assert.equal(readDeviceDraft(owner,d.id).state,'conflict');
});
test('changing another field after a conflict does not erase the original comparison',async()=>{
  const base=currentRow(),d=local(base),remote=currentRow({notes:'remote edit'});const f=fixture(remote);queueDeviceDraft(owner,d.id);await syncDeviceWork(f.client,owner,version);
  const changed=saveDeviceDraft(readDeviceDraft(owner,d.id),{jobDescription:'edited',dailyWageInput:'10000'},{notes:'edited',daily_wage:'10000'});
  queueDeviceDraft(owner,changed.id);await syncDeviceWork(f.client,owner,version);
  assert.equal(f.state.writes,0);assert.equal(f.rows.get(jobId).notes,'remote edit');assert.equal(readDeviceDraft(owner,d.id).payload.daily_wage,'10000');
});
test('rebase cannot switch to a different job belonging to the same user',()=>{
  const d=local(currentRow());rebaseDeviceDraft(owner,d.id,currentRow({id:other}));
  assert.equal(readDeviceDraft(owner,d.id).jobId,jobId);assert.equal(readDeviceDraft(owner,d.id).state,'conflict');
});
test('a deleted existing job is never silently recreated by retry or rebase',async()=>{
  const d=local(currentRow());queueDeviceDraft(owner,d.id);const f=fixture();await syncDeviceWork(f.client,owner,version);
  rebaseDeviceDraft(owner,d.id,null);queueDeviceDraft(owner,d.id);await syncDeviceWork(f.client,owner,version);
  assert.equal(f.rows.size,0);assert.equal(f.state.writes,0);assert.equal(readDeviceDraft(owner,d.id).form.jobDescription,'edited');
});
test('a conflict on a new UUID cannot overwrite an existing row with different content',async()=>{
  const d=local();queueDeviceDraft(owner,d.id);const f=fixture(currentRow({id:d.jobId,notes:'different'}));
  await syncDeviceWork(f.client,owner,version);queueDeviceDraft(owner,d.id);await syncDeviceWork(f.client,owner,version);
  assert.equal(f.state.writes,0);assert.equal(f.rows.get(d.jobId).notes,'different');assert.equal(readDeviceDraft(owner,d.id).payload.notes,'edited');
});
test('a successful response for another row is not allowed to consume a pending request',()=>{
  const d=local();queueDeviceDraft(owner,d.id);
  settleDeviceDraft(owner,d.id,d.revision,{ok:true,row:currentRow({id:other,farmer_id:other})});
  const remaining=readDeviceDraft(owner,d.id);
  assert.equal(remaining.jobId,d.jobId);assert.equal(remaining.state,'blocked');assert.equal(remaining.reason,'response_mismatch');
  assert.equal(remaining.form.jobDescription,'edited');assert.equal(remaining.base,null);
});
test('primitive value types and nested nulls remain significant',()=>{
  const base=currentRow({perks:{limit:1}}),remote=currentRow({perks:{limit:'1'}});
  assert.equal(safeDraftRebase(base,remote,{perks:{limit:1}}).safe,false);
  assert.equal(safeDraftRebase(currentRow({perks:{}}),currentRow({perks:{limit:null}}),{perks:{}}).safe,false);
});
