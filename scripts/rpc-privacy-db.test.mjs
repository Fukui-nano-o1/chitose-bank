import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const root=new URL('../',import.meta.url);
const file=(await readdir(new URL('supabase/migrations/',root))).find(f=>f.endsWith('_rpc_privacy_fail_closed.sql'));
const migration=await readFile(new URL('supabase/migrations/'+file,root),'utf8');
const own='00000000-0000-4000-8000-000000000001',worker='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',admin='00000000-0000-4000-8000-000000000004',missing='00000000-0000-4000-8000-000000000005';
test('RPC privacy: fail closed without breaking existing owner/party flows',async t=>{
 const db=new PGlite();
 try{
  await db.exec(await readFile(new URL('scripts/fixtures/rpc-privacy-baseline.sql',root),'utf8'));
  await db.query("insert into auth.users values($1,'2026-01-01'),($2,'2026-02-01'),($3,'2026-03-01'),($4,'2026-04-01')",[own,worker,other,admin]);
  await db.query("insert into account_holders values($1,'individual')",[own]);
  await db.query('insert into app_admins values($1)',[admin]);
  await db.query("insert into jobs(job_number,farmer_id,status) values(1,$1,'draft'),(2,$1,'closed'),(3,$1,'closed')",[own]);
  await db.query("insert into applications(id,job_number,farmer_id,worker_id,status) values(1,1,$1,$2,'applied'),(2,2,$1,$2,'withdrawn'),(3,3,$1,$2,'rejected'),(4,999,$1,$2,'completed')",[own,worker]);
  await db.query("insert into applications(id,job_number,farmer_id,worker_id,status,attended,decided_at,created_at) values(5,2,$1,$2,'completed',true,'2026-01-02','2026-01-01')",[own,worker]);
  await db.query("insert into reviews values(5,$1,'worker_to_farmer','matched',true)",[own]);
  const login=async(uid,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);await db.exec('set role '+role);};
  const trust=async(uid=own)=>(await db.query('select employer_trust_info($1) result',[uid])).rows[0].result;
  const exists=async(id)=>(await db.query('select job_exists($1) result',[id])).rows[0].result;
  const metadata=async()=> (await db.query("select oid::regprocedure::text signature,proacl,prosecdef,proconfig,provolatile,proowner from pg_proc where oid in ('employer_trust_info(uuid)'::regprocedure,'job_exists(integer)'::regprocedure,'is_account_moderated(uuid)'::regprocedure,'is_job_party(integer)'::regprocedure) order by 1")).rows;
  const before=await metadata();
  await login(null,'anon');
  assert.equal((await trust()).ok,true,'baseline reproduces NULL authorization bypass');
  assert.equal(await exists(1),true,'baseline reproduces draft enumeration');
  await login(own);const authorizedBefore=await trust();
  assert.equal(authorizedBefore.completed_hires,1);assert.equal(authorizedBefore.match_total,1);
  assert.equal(authorizedBefore.want_again_workers,1);assert.equal(authorizedBefore.avg_response_hours,24);
  await db.exec('reset role');await db.exec(migration);
  assert.deepEqual(await metadata(),before,'ACL/security mode/search_path stay unchanged');
  await t.test('anonymous private, nonexistent and NULL targets all deny',async()=>{
   await login(null,'anon');
   for(const uid of [own,other,missing,null])assert.deepEqual(await trust(uid),{ok:false});
   for(const id of [1,2,3,999,null])assert.equal(await exists(id),false);
   assert.equal((await db.query('select count(*)::int n from jobs')).rows[0].n,0);
  });
  await t.test('authenticated role without a subject is not authentication',async()=>{
   await login(null);assert.deepEqual(await trust(),{ok:false});assert.equal(await exists(1),false);
  });
  await t.test('unrelated authenticated caller and admin do not gain private trust',async()=>{
   for(const uid of [other,admin]){await login(uid);assert.deepEqual(await trust(),{ok:false});}
   await login(other);for(const id of [1,2,3,999,null])assert.equal(await exists(id),false);
  });
  await t.test('owner and every former/current application party retain existing-job checks',async()=>{
   for(const uid of [own,worker,admin]){
    await login(uid);for(const id of [1,2,3])assert.equal(await exists(id),true);
    for(const id of [999,null])assert.equal(await exists(id),false,'orphan application is not physical existence');
   }
   for(const uid of [own,worker]){await login(uid);const result=await trust();assert.deepEqual(result,authorizedBefore,'authorized aggregate JSON is unchanged');assert.equal(result.ok,true);assert.equal(result.entity_type,'individual');assert.equal(result.id_checked,true);assert.equal(result.member_since,'2026年01月');}
  });
  await t.test('existing public trust remains, but job_exists is intentionally party-only even for open jobs',async()=>{
   await db.exec('reset role');await db.exec("update jobs set status='open' where job_number=1");
   for(const [uid,role] of [[null,'anon'],[other,'authenticated'],[admin,'authenticated']]){
    await login(uid,role);assert.equal((await trust()).ok,true);
    assert.equal(await exists(1),uid===admin);
   }
  });
  await t.test('moderation keeps existing self/third-party trust behavior; job parties retain records',async()=>{
   await db.exec('reset role');await db.query("insert into account_moderation values($1,'suspended')",[own]);
   for(const [uid,role] of [[null,'anon'],[worker,'authenticated'],[other,'authenticated'],[admin,'authenticated']]){await login(uid,role);assert.deepEqual(await trust(),{ok:false});}
   await login(own);assert.equal((await trust()).ok,true);assert.equal(await exists(1),true);
   await login(worker);assert.equal(await exists(2),true);
   await db.exec('reset role');await db.query("insert into account_moderation values($1,'banned')",[worker]);
   await login(worker);assert.equal(await exists(2),true,'existing helper has no moderation gate for record retention');
   await login(null,'service_role');assert.equal(await exists(1),false,'JWT-less backend is not implicitly a party');
  });
  await t.test('migration is repeatable and does not widen helper execution grants',async()=>{
   await db.exec('reset role');await db.exec(migration);assert.deepEqual(await metadata(),before);
   await login(worker);await assert.rejects(db.query('select is_job_party(1)'),e=>e.code==='42501');
   assert.equal(await exists(1),true);
  });
 }finally{await db.close();}
});
