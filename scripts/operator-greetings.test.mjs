import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperatorGreetingDelivery, operatorGreetingIdentity } from '../src/lib/operatorGreetingDelivery.js';
const userId='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const sid='20000000-0000-4000-8000-000000000001',sid2='20000000-0000-4000-8000-000000000002';
const session=(id=userId,sessionId=sid)=>({user:{id},access_token:`x.${Buffer.from(JSON.stringify({sub:id,session_id:sessionId})).toString('base64url')}.x`});
function fixture(enabled=true, storage=new Map()) {
 const calls=[];
 let current=session(), result={data:{status:'delivered'}}, fail=false;
 const client={auth:{getSession:async()=>({data:{session:current}})},rpc:async(name,args)=>{calls.push({name,args});if(fail)throw Error('offline');return result;}};
 const getStorage=()=>({getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)});
 return {calls,storage,client,getStorage,delivery:createOperatorGreetingDelivery({client,enabled,getStorage,retryDelays:[]}),setSession:s=>{current=s;},setResult:r=>{result=r;},setFail:v=>{fail=v;}};
}
test('default disabled means no RPC, session lookup, or persistent intent',async()=>{
 const f=fixture(false);
 assert.equal(await f.delivery.recordLogin(session()),'disabled');
 assert.equal(await f.delivery.retry(userId),'disabled');assert.equal(f.calls.length,0);assert.equal(f.storage.size,0);
});
test('identity fails closed on malformed tokens and account mismatch',()=>{
 assert.deepEqual(operatorGreetingIdentity(session()),{userId,sessionId:sid});
 assert.equal(operatorGreetingIdentity({...session(),user:{id:other}}),null);
 for(const s of [null,{}, {access_token:'x.y.z'},session(userId,'invalid')])assert.equal(operatorGreetingIdentity(s),null);
});
test('restore/refresh only drain server events, explicit success creates intent and duplicate calls coalesce',async()=>{
 const f=fixture();
 await f.delivery.retry(userId);assert.equal(f.calls[0].args.p_record_login,false);
 await Promise.all([f.delivery.recordLogin(session()),f.delivery.recordLogin(session())]);
 assert.equal(f.calls.length,2);assert.equal(f.calls[1].args.p_record_login,true);assert.equal(f.storage.size,0);
 await f.delivery.retry(userId);assert.equal(f.calls[2].args.p_record_login,false);
 f.setSession(session(userId,sid2));await f.delivery.recordLogin(session(userId,sid2));assert.equal(f.calls.at(-1).args.p_expected_session,sid2);
});
test('unknown outcome survives reload as the same intent, without persisting credentials',async()=>{
 const f=fixture();f.setFail(true);
 assert.equal(await f.delivery.recordLogin(session()),'retry');assert.equal(f.storage.size,1);
 assert.equal([...f.storage.values()][0],'1');assert.ok(!JSON.stringify([...f.storage]).includes('access_token'));
 f.setFail(false);
 const reloaded=createOperatorGreetingDelivery({client:f.client,enabled:true,getStorage:f.getStorage,retryDelays:[]});
 await reloaded.retry(userId);assert.equal(f.calls.at(-1).args.p_record_login,true);assert.equal(f.storage.size,0);
 await reloaded.retry(userId);assert.equal(f.calls.at(-1).args.p_record_login,false);
});
test('account switch and a new restored session cannot replay an old login identity',async()=>{
 const f=fixture();f.setFail(true);await f.delivery.recordLogin(session());f.setFail(false);
 f.setSession(session(other));assert.equal(await f.delivery.retry(userId),'stale');assert.equal(f.calls.length,1);
 await f.delivery.retry(other);assert.equal(f.calls.at(-1).args.p_record_login,false);
 f.setSession(session(userId,sid2));await f.delivery.retry(userId);assert.equal(f.calls.at(-1).args.p_record_login,false);
});
test('storage denial and greeting failure never reject authentication or registration continuation',async()=>{
 const f=fixture();f.setFail(true);
 const delivery=createOperatorGreetingDelivery({client:f.client,enabled:true,getStorage:()=>{throw Error('denied');},retryDelays:[]});
 assert.equal(await delivery.recordLogin(session()),'retry');f.setFail(false);
 await delivery.retry(userId);assert.equal(f.calls.at(-1).args.p_record_login,true);
 await delivery.retry(userId);assert.equal(f.calls.at(-1).args.p_record_login,false);
});
test('disabled and registration-pending responses consume only the local retry marker',async()=>{
 for(const status of ['disabled','registration_pending','stale']){
  const f=fixture();f.setResult({data:{status}});assert.equal(await f.delivery.recordLogin(session()),status);assert.equal(f.storage.size,0);
 }
});

test('transient failure retries in the background with the identical session, then stops on success',async()=>{
 const f=fixture();f.setFail(true);const timers=[];
 const delivery=createOperatorGreetingDelivery({client:f.client,enabled:true,getStorage:f.getStorage,setTimer:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimer:()=>{}});
 assert.equal(await delivery.recordLogin(session()),'retry');assert.equal(timers[0].ms,1000);
 f.setFail(false);timers[0].fn();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.calls.length,2);assert.deepEqual(f.calls[0].args,f.calls[1].args);assert.equal(f.storage.size,0);assert.equal(timers.length,1);
});
test('post-registration drain is fresh even when a pre-save login RPC is still in flight',async()=>{
 const f=fixture();let release;
 f.client.rpc=async(name,args)=>{f.calls.push({name,args});if(f.calls.length===1)return new Promise(resolve=>{release=resolve;});return {data:{status:'delivered'}};};
 const before=f.delivery.recordLogin(session());await new Promise(resolve=>setImmediate(resolve));
 const after=f.delivery.retry(userId,{afterRegistration:true});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.calls.length,1);release({data:{status:'registration_pending'}});await before;await after;
 assert.equal(f.calls.length,2);assert.equal(f.storage.size,0);
});
