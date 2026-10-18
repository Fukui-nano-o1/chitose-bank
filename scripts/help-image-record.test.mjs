import test from 'node:test';
import assert from 'node:assert/strict';
import {readHelpImages,saveHelpImage} from '../src/lib/helpImageRecord.js';
import {helpImageFixture,uid} from './fixtures/help-image-client.mjs';
const blob=()=>new Blob(['new image'],{type:'image/jpeg'});
const args=f=>({client:f.client,userId:uid,slotKey:f.slot,record:f.state.rows[f.slot],blob:blob()});
for(const mode of ['normal','uploadLostResponse','dbLostResponse'])test(mode+' confirms replacement without overwriting or deleting old bytes',async()=>{
  const f=helpImageFixture({[mode]:true}),r=await saveHelpImage(args(f));assert.notEqual(r.url,f.oldUrl);assert.equal(f.state.writes,1);assert.equal(f.state.objects.get('old.png'),f.oldBlob);assert.ok(f.state.events.filter(e=>e.upload).every(e=>e.upsert===false));
});
for(const mode of ['uploadError','dbError','readError'])test(mode+' retains original reference and image',async()=>{
  const f=helpImageFixture({[mode]:true});await assert.rejects(saveHelpImage(args(f)));assert.equal(f.state.rows[f.slot].url,f.oldUrl);assert.equal(f.state.objects.get('old.png'),f.oldBlob);assert.equal(f.state.writes,0);
});
test('lost upload with wrong bytes cannot confirm success',async()=>{const f=helpImageFixture({uploadLostResponse:true,wrongBytes:true});await assert.rejects(saveHelpImage(args(f)),{code:'HELP_IMAGE_UPLOAD'});assert.equal(f.state.writes,0);});
test('delete failure leaves old reference and object; response-loss deletion rereads the absence',async()=>{
  for(const mode of ['dbError','dbLostResponse','normal']){const f=helpImageFixture({[mode]:true}),a={...args(f),blob:null};
    if(mode==='dbError'){await assert.rejects(saveHelpImage(a));assert.ok(f.state.rows[f.slot]);}else{assert.equal(await saveHelpImage(a),null);assert.equal(f.state.rows[f.slot],undefined);}
    assert.equal(f.state.objects.get('old.png'),f.oldBlob);
  }
});
test('unknown DB result never deletes either candidate object',async()=>{const f=helpImageFixture({dbLostResponse:true,failReadAfterLoss:true});await assert.rejects(saveHelpImage(args(f)),{code:'HELP_IMAGE_UNCONFIRMED'});assert.equal(f.state.objects.size,2);});
test('other editor between read and RPC wins without being overwritten',async()=>{
  const f=helpImageFixture({beforeRPC:s=>{s.rows['about-purpose'].url='https://other.test/new.jpg';}});await assert.rejects(saveHelpImage(args(f)),{code:'HELP_IMAGE_CONFLICT'});assert.equal(f.state.writes,0);assert.equal(f.state.rows[f.slot].url,'https://other.test/new.jpg');
});
test('stale visible record prevents any upload and other slots retain shared URLs',async()=>{
  const f=helpImageFixture(),a=args(f);a.record={...a.record,url:'stale'};await assert.rejects(saveHelpImage(a),{code:'HELP_IMAGE_CONFLICT'});assert.equal(f.state.events.length,0);
  f.state.rows.shared={slot_key:'shared',url:f.oldUrl,updated_at:'2026-10-18T00:00:00Z'};await saveHelpImage({...args(f),blob:null});assert.equal(f.state.rows.shared.url,f.oldUrl);assert.ok(f.state.objects.has('old.png'));
});
test('session switch around upload/RPC never reports success for another account',async()=>{
  for(const when of ['before','upload','rpc','after']){const options={},f=helpImageFixture(options);if(when==='before')f.state.userId='other';if(when==='upload')options.beforeUpload=s=>{s.userId='other';};if(when==='rpc')options.beforeRPC=s=>{s.userId='other';};if(when==='after')options.switchAfterRPC=true;
    await assert.rejects(saveHelpImage(args(f)),{code:'HELP_IMAGE_SESSION'});assert.equal(f.state.writes,when==='after'?1:0);assert.ok(f.state.objects.has('old.png'));
  }
});
test('failed list read is distinct from an empty set',async()=>{const f=helpImageFixture({readError:true});await assert.rejects(readHelpImages(f.client),{code:'HELP_IMAGE_READ'});});
