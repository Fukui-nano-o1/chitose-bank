import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkplacePhotoReader,validWorkplacePhotoPath} from '../src/lib/workplacePhotoAccess.js';
const owner='11111111-1111-4111-8111-111111111111';
const path=`${owner}/${'a'.repeat(64)}.jpg`;
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(){
 let user=null,callback,authError=false,before=async()=>{},result={data:new Blob(['synthetic'])};
 const calls=[],revoked=[],created=[];
 const client={auth:{getSession:async()=>({data:{session:user?{user:{id:user}}:null},error:authError?Error('auth'):null}),onAuthStateChange:fn=>{callback=fn;}},storage:{from:bucket=>({download:async(path,options,parameters)=>{calls.push({bucket,path,options,parameters});await before();return result;}})}};
 const reader=createWorkplacePhotoReader(client,{createObjectURL:()=>{const url=`blob:workplace/${created.length+1}`;created.push(url);return url;},revokeObjectURL:url=>revoked.push(url)});
 return {reader,calls,revoked,created,setUser:id=>{user=id;callback('AUTH_CHANGED',id?{user:{id}}:null);},setAuthError:value=>{authError=value;},setBefore:fn=>{before=fn;},setResult:value=>{result=value;}};
}
test('independent workplace paths accept only UUID/64hex.jpg, never URLs or listing paths',()=>{
 assert.equal(validWorkplacePhotoPath(path),true);
 for(const value of [null,{},'',`https://example.test/${path}`,`blob:${path}`,`job-photos/${path}`,`consignment-photos/${path}`,`/${path}`,`${path}?token=secret`,`${path}#fragment`,`${owner}/../${'a'.repeat(64)}.jpg`,`${owner}/%2e%2e/${'a'.repeat(64)}.jpg`,`${owner}/${'a'.repeat(63)}.jpg`,`${owner}/${'g'.repeat(64)}.jpg`,`${owner}/${'a'.repeat(64)}.png`,`${owner}\\${'a'.repeat(64)}.jpg`,`${path}\n`]) assert.equal(validWorkplacePhotoPath(value),false,String(value));
});
test('invalid workplace refs fail before storage and never fall back to URL',async()=>{
 const f=fixture();for(const value of [null,{},`https://example.test/${path}`,`job-photos/${path}`])await assert.rejects(f.reader.acquire(value));
 assert.equal(f.calls.length,0);assert.equal(f.created.length,0);
});
test('anonymous workplace reads use only dedicated storage, no-store and shared leases',async()=>{
 const f=fixture();const [a,b]=await Promise.all([f.reader.acquire(path),f.reader.acquire(path)]);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].bucket,'workplace-photos');assert.equal(f.calls[0].path,path);assert.equal(f.calls[0].parameters.cache,'no-store');assert.ok(f.calls[0].parameters.signal);
 assert.equal(a.url,b.url);a.release();assert.equal(f.revoked.length,0);b.release();assert.deepEqual(f.revoked,[a.url]);b.release();assert.equal(f.revoked.length,1);
 const c=await f.reader.acquire(path);assert.equal(f.calls.length,2);c.release();
});
test('storage denial, empty bytes and auth errors are fail-closed',async()=>{
 for(const result of [{error:Error('403')},{data:null}]){const f=fixture();f.setResult(result);await assert.rejects(f.reader.acquire(path));assert.equal(f.created.length,0);}
 const f=fixture();f.setAuthError(true);await assert.rejects(f.reader.acquire(path));assert.equal(f.calls.length,0);
});
test('logout invalidates mounted independent photos and notifies subscribers',async()=>{
 const f=fixture();f.setUser(owner);let notices=0;const unsubscribe=f.reader.subscribe(()=>{notices++;});const a=await f.reader.acquire(path);
 f.setUser(null);assert.ok(f.revoked.includes(a.url));assert.equal(notices,1);const b=await f.reader.acquire(path);assert.equal(f.calls.length,2);unsubscribe();f.setUser('another');assert.equal(notices,1);a.release();b.release();
});
test('account changes reject late workplace image bytes',async()=>{
 const f=fixture();let release;f.setBefore(()=>new Promise(resolve=>{release=resolve;}));const pending=f.reader.acquire(path);await pause();assert.equal(typeof release,'function');f.setUser(owner);release();await assert.rejects(pending);assert.equal(f.created.length,0);
});
