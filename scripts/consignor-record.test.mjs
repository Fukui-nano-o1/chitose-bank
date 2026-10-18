import test from 'node:test';
import assert from 'node:assert/strict';
import {readConsignorRecord,saveConsignorRecord,saveConsignorConsent,consignorDraftKey} from '../src/features/consignment/consignorRecord.js';
import {consignorFixture} from './fixtures/consignor-client.mjs';
test('unreadable records never become an empty profile',async()=>{
  const f=consignorFixture({readError:true});await assert.rejects(readConsignorRecord(f.client),{code:'CONSIGNOR_READ'});
  await assert.rejects(saveConsignorRecord(f.client,null,'individual',{}),{code:'CONSIGNOR_NOT_LOADED'});assert.equal(f.state.writes,0);
});
for(const mode of ['normal','phoneError','profileError','lostResponse'])test('atomic profile transport: '+mode,async()=>{
  const f=consignorFixture({[mode]:true}),record=await readConsignorRecord(f.client);
  const input={cmn_bank:'変更後',ind_phone:'08000000000',ind_name:'not duplicated'};
  if(mode.endsWith('Error')){
    await assert.rejects(saveConsignorRecord(f.client,record,'individual',input),{code:'CONSIGNOR_SAVE'});
    assert.equal(f.state.rows.account_holders.contact_phone,null);assert.equal(f.state.rows.consignment_profiles.consignor_data.cmn_bank,'元の銀行');
  }else{
    const r=await saveConsignorRecord(f.client,record,'individual',input);
    assert.equal(r.account.contact_phone,input.ind_phone);assert.deepEqual(r.profile.consignor_data,{cmn_bank:'変更後'});
  }
  assert.equal(f.state.writes,1);assert.equal(input.ind_phone,'08000000000');
});
test('stale profile and phone conflicts preserve both current records',async()=>{
  for(const part of ['profile','phone']){
    const f=consignorFixture(),record=await readConsignorRecord(f.client);
    if(part==='profile')f.state.rows.consignment_profiles.consignor_data.cmn_lend_items=['other editor'];
    else f.state.rows.account_holders.contact_phone='09000000000';
    const before=JSON.stringify(f.state.rows);
    await assert.rejects(saveConsignorRecord(f.client,record,'individual',{ind_phone:'08000000000',cmn_bank:'new'}),{code:'CONSIGNOR_CONFLICT'});
    assert.equal(JSON.stringify(f.state.rows),before);
  }
});
test('unknown outcome and account switching cannot produce a success result',async()=>{
  const f=consignorFixture({lostResponse:true,readErrorAfterWrite:true}),record=await readConsignorRecord(f.client);
  await assert.rejects(saveConsignorRecord(f.client,record,'individual',{cmn_bank:'new'}),{code:'CONSIGNOR_UNCONFIRMED'});
  const g=consignorFixture({switchAfterWrite:true}),r=await readConsignorRecord(g.client);
  await assert.rejects(saveConsignorRecord(g.client,r,'individual',{cmn_bank:'new'}),{code:'CONSIGNOR_SESSION'});
  const h=consignorFixture(),rh=await readConsignorRecord(h.client);h.state.userId='other';
  await assert.rejects(saveConsignorRecord(h.client,rh,'individual',{}),{code:'CONSIGNOR_SESSION'});assert.equal(h.state.writes,0);
  assert.notEqual(consignorDraftKey('one'),consignorDraftKey('two'));
});
test('consent requires canonical confirmation and does not rebase old profile input',async()=>{
  const f=consignorFixture(),r=await readConsignorRecord(f.client);
  f.state.rows.consignment_profiles.consignor_data.cmn_bank='remote';
  const confirmed=await saveConsignorConsent(f.client,r,'new-version');
  assert.equal(confirmed.profile.consignor_data.cmn_bank,'元の銀行');
  assert.equal(confirmed.profile.consignment_data_consent_version,'new-version');
  for(const mode of ['dbError','lostResponse']){
    const g=consignorFixture({[mode]:true}),gr=await readConsignorRecord(g.client);
    if(mode==='dbError')await assert.rejects(saveConsignorConsent(g.client,gr,'new-version'),{code:'CONSIGNOR_CONSENT'});
    else assert.equal((await saveConsignorConsent(g.client,gr,'new-version')).profile.consignment_data_consent_version,'new-version');
  }
});
test('a session switch between the client check and RPC cannot write another account',async()=>{
  const f=consignorFixture(),r=await readConsignorRecord(f.client),before=JSON.stringify(f.state.rows);
  f.state.options.beforeAtomicWrite=s=>{s.userId='other';};
  await assert.rejects(saveConsignorRecord(f.client,r,'individual',{cmn_bank:'stale user data'}),{code:'CONSIGNOR_UNCONFIRMED'});
  assert.equal(JSON.stringify(f.state.rows),before);
});
