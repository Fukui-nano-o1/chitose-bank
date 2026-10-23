import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const root=new URL('../',import.meta.url);
const migrations=await readdir(new URL('supabase/migrations/',root));
const file=migrations.find(name=>name.endsWith('_meeting_address_approval_gate.sql'));
const migration=await readFile(new URL('supabase/migrations/'+file,root),'utf8');
const own='00000000-0000-4000-8000-000000000001',worker='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',admin='00000000-0000-4000-8000-000000000004';
test('meeting address approval is enforced on listing, party details and meeting RPC',async t=>{
 const db=new PGlite();
 try{
  await db.exec(await readFile(new URL('scripts/fixtures/meeting-address-schema.sql',root),'utf8'));
  await db.query("insert into jobs(job_number,farmer_id,status,address,town,prefecture,city,headcount) values(1,$1,'open','SECRET-42','町','県','市',1),(2,$1,'draft','PRIVATE-99','町','県','市',1)",[own]);
  await db.query('insert into app_admins values($1)',[admin]);
  await db.query("insert into applications(job_number,worker_id,farmer_id,status) values(1,$1,$2,'applied'),(2,$1,$2,'applied')",[worker,own]);
  const login=async(uid,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid||'',role]);await db.exec('set role '+role);};
  const listing=async()=> (await db.query('select job_number,work_address,has_work_address from jobs_public order by job_number')).rows;
  const party=async()=> (await db.query('select job_details_for_party(array[1,2]) as result')).rows[0].result;
  const meeting=async()=> (await db.query('select job_meeting_place(1) as result')).rows[0].result;
  await login(worker);
  assert.deepEqual(await listing(),[],'existing listing RLS already restricts rows');
  assert.equal((await party())[0].work_address,'SECRET-42','reproduce original party RPC leak');
  assert.equal((await meeting()).ok,false,'dedicated meeting RPC already gates approval');
  await db.exec('reset role');await db.exec(migration);
  await login(worker);assert.deepEqual(await listing(),[],'migration preserves existing row visibility');
  assert.equal((await db.query("select reloptions from pg_class where oid='public.jobs_public'::regclass")).rows[0].reloptions.includes('security_invoker=true'),true);
  assert.equal((await db.query('select count(*)::int n from jobs')).rows[0].n,0);
  // Test the column gate independently of the existing row gate. This policy
  // exists only in this synthetic database, never in the production migration.
  await db.exec('reset role');await db.exec("create policy fixture_listing on jobs for select to anon,authenticated using(status='open')");
  await t.test('anonymous listing retains town masking and never returns detailed address',async()=>{await login(null,'anon');assert.equal((await listing())[0].work_address,null);assert.equal((await db.query('select town from jobs_public')).rows[0].town,null);await assert.rejects(party(),/permission denied/);assert.equal((await meeting()).ok,false);});
  await t.test('unrelated member cannot read address or infer it with view filters',async()=>{await login(other);assert.equal((await listing())[0].work_address,null);assert.equal((await db.query("select count(*)::int n from jobs_public where work_address='SECRET-42'")).rows[0].n,0);assert.deepEqual(await party(),[]);assert.equal((await meeting()).ok,false);});
  for(const status of ['applied','rejected','canceled','cancelled','expired','held','unknown']) await t.test(status+' cannot obtain an address through either general read path',async()=>{
   await db.exec('reset role');await db.query('update applications set status=$1',[status]);await login(worker);
   assert.deepEqual(await listing(),[{job_number:1,work_address:null,has_work_address:true}]);
   const rows=await party();assert.equal(rows.length,2);assert.ok(rows.every(r=>r.work_address===null&&!('address' in r)&&!('zip' in r)));
   assert.equal(JSON.stringify(rows).includes('SECRET-42'),false);assert.equal((await meeting()).ok,false);
  });
  for(const status of ['approved','meeting','interview','contracted','working','completed']) await t.test(status+' preserves legitimate meeting details',async()=>{
   await db.exec('reset role');await db.query('update applications set status=$1',[status]);await login(worker);
   assert.equal((await listing())[0].work_address,'SECRET-42');assert.equal((await party()).find(r=>r.job_number===1).work_address,'SECRET-42');assert.equal((await meeting()).full_address,'県市町 SECRET-42');
  });
  await t.test('another approved applicant does not authorize an unrelated account',async()=>{await login(other);assert.equal((await listing())[0].work_address,null);});
  await t.test('owner and admin retain access; owner retains draft address',async()=>{for(const uid of [own,admin]){await login(uid);assert.equal((await listing())[0].work_address,'SECRET-42');assert.equal((await party()).find(r=>r.job_number===2).work_address,'PRIVATE-99');}});
  await t.test('revocation immediately masks subsequent reads; contract snapshot is not rewritten',async()=>{
   await db.exec('reset role');await db.exec("update applications set status='rejected',terms_snapshot=jsonb_build_object('address','SAVED-CONTRACT') where job_number=1");await login(worker);
   assert.equal((await listing())[0].work_address,null);assert.equal((await party()).find(r=>r.job_number===1).work_address,null);assert.equal((await meeting()).ok,false);
   await db.exec('reset role');assert.equal((await db.query("select terms_snapshot->>'address' as address from applications where job_number=1")).rows[0].address,'SAVED-CONTRACT');
  });
  await t.test('empty address does not invent a location; missing job does not reveal one',async()=>{
   await db.exec('reset role');await db.exec("update jobs set address=null where job_number=1");await login(own);assert.deepEqual(await listing(),[{job_number:1,work_address:null,has_work_address:false}]);assert.equal((await db.query('select private.can_read_meeting_address(999) as allowed')).rows[0].allowed,false);
  });
 }finally{await db.close();}
});
