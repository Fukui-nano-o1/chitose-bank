import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase,s} from './authorization/database.mjs';
import {seed,login,id,farmer,worker,other,admin} from './authorization/seed.mjs';

test('authorization: real policies, functions and triggers with synthetic identities',async t=>{
 const db=await createDatabase();
 try {
  await seed(db);
  const as=async(who=worker,role='authenticated',email='qa@example.invalid',metadata={})=>login(db,who,role,email,metadata);
  const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
  const call=async(sql,args=[])=> (await query(sql,args))[0].result;
  const denied=async(sql,args=[])=>{
   await db.exec('savepoint denied');
   try {const rows=await query(sql,args);assert.equal(rows.length,0,'unauthorized operation returned rows');}
   catch(e){if(e.code)assert.equal(e.code,'42501',e.message);else throw e;}
   finally {await db.exec('rollback to denied');}
  };
  const scenario=async(name,who,fn,options={})=>t.test(name,async()=>{
   await as(who,options.role,options.email,options.metadata);await db.exec('begin');
   try{await fn();}finally{await db.exec('rollback');}
  });
  const fixture=async(sql)=>{await db.exec('reset role');await db.exec(sql);await db.exec('set role authenticated');};
  const targets={account_holders:`auth_id='${worker}'`,emergency_contacts:`auth_id='${worker}'`,worker_profiles:`auth_id='${worker}'`,employer_profiles:`auth_id='${farmer}'`,jobs:'job_number=10',applications:`id='${id(100)}'`,messages:`id='${id(200)}'`,admin_messages:`id='${id(201)}'`,records:`id='${id(203)}'`,feedback:`id='${id(204)}'`,notifications:`id='${id(205)}'`,attendance_events:`id='${id(206)}'`,reviews:`id='${id(207)}'`};
  for(const [table,where] of Object.entries(targets))for(const role of ['anon','authenticated'])for(const op of ['select','update','delete']){
   const col=['account_holders','emergency_contacts','worker_profiles','employer_profiles'].includes(table)?'auth_id':'id';
   const sql=op==='select'?`select ${col} from ${table} where ${where}`:op==='update'?`update ${table} set ${col}=${col} where ${where} returning ${col}`:`delete from ${table} where ${where} returning ${col}`;
   await scenario(`isolation: ${role} ${table}.${op}`,role==='anon'?'':other,()=>denied(sql),{role});
  }
  for(const state of ['canceled','expired','rejected','completed','applied','held',null]){
   await scenario('hiring: denies '+state,farmer,async()=>{
    if(state==='held'||state===null)await fixture('alter table applications drop constraint applications_status_check;alter table applications alter column status drop not null');
    await fixture(`update applications set status=${state===null?'null':`'${state}'`} where id='${id(100)}'`);
    const result=await call(`select confirm_terms('${id(100)}',true) result`);
    assert.equal(result.ok,false);assert.match(result.reason,/^(closed|not_approved)$/);
    assert.equal((await query(`select terms_confirmed_farmer_at from applications where id='${id(100)}'`))[0].terms_confirmed_farmer_at,null);
   });
  }
  await scenario('hiring: approved succeeds and replay is harmless',farmer,async()=>{
   assert.equal((await call(`select confirm_terms('${id(100)}',true) result`)).ok,true);
   const before=await query(`select terms_confirmed_farmer_at,terms_snapshot from applications where id='${id(100)}'`);
   assert.equal((await call(`select confirm_terms('${id(100)}',true) result`)).ok,true);
   assert.deepEqual(await query(`select terms_confirmed_farmer_at,terms_snapshot from applications where id='${id(100)}'`),before);
  });
  await scenario('hiring: nonparty rejected',other,async()=>assert.equal((await call(`select confirm_terms('${id(100)}',true) result`)).ok,false));
  await scenario('hiring: stopped account rejected',farmer,async()=>{
   await fixture(`insert into account_moderation(auth_id,state) values('${farmer}','suspended')`);
   assert.equal((await call(`select confirm_terms('${id(100)}',true) result`)).reason,'account_suspended');
  });
  await scenario('hiring: withdrawn/banned auth identity rejected with old subject claim',farmer,async()=>{
   await fixture(`update auth.users set banned_until='infinity' where id='${farmer}'`);
   assert.equal((await call(`select confirm_terms('${id(100)}',true) result`)).reason,'account_suspended');
  });
  for(const field of ["body='forged'","from_admin=false","created_at=now()-interval '1 year'",`user_id='${other}'`,`id='${id(999)}'`]){
   await scenario('support: immutable '+field,worker,()=>denied(`update admin_messages set ${field} where id='${id(201)}' returning id`));
  }
  await scenario('support: cannot impersonate staff on insert',worker,()=>denied(`insert into admin_messages(user_id,from_admin,body) values('${worker}',true,'fake') returning id`));
  await scenario('support: sender cannot mark own message read',worker,()=>denied(`update admin_messages set read_at=now() where id='${id(202)}' returning id`));
  await scenario('support: recipient receipt is server timed, audited and idempotent',worker,async()=>{
   const [r]=await query(`update admin_messages set read_at=now()-interval '1 year' where id='${id(201)}' returning read_at`);
   assert.ok(Date.now()-new Date(r.read_at).getTime()<60000);
   await db.exec('reset role');const [audit]=await query("select * from event_audit where table_name='admin_messages'");
   assert.equal(audit.row_pk,id(201));assert.equal(JSON.stringify(audit.diff).includes('架空運営本文'),false);
   await db.exec('set role authenticated');
   assert.deepEqual(await query(`update admin_messages set read_at=null where id='${id(201)}' returning read_at`),[r]);
  });
  await scenario('support: administrator can send and read but cannot rewrite history',admin,async()=>{
   assert.equal((await query(`insert into admin_messages(user_id,from_admin,body) values('${worker}',true,'QA') returning id`)).length,1);
   assert.equal((await query(`update admin_messages set read_at=now() where id='${id(202)}' returning id`)).length,1);
   await denied(`update admin_messages set body='rewrite' where id='${id(201)}' returning id`);
   await denied(`delete from admin_messages where id='${id(201)}' returning id`);
  });
  await scenario('support: audit failure rolls back message save',worker,async()=>{
   await fixture("create function public.qa_fail_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable';end$$;create trigger qa_fail_audit before insert on event_audit for each row execute function public.qa_fail_audit()");
   await assert.rejects(query(`insert into admin_messages(user_id,from_admin,body) values('${worker}',false,'unsaved') returning id`),/audit unavailable/);
  });
  await scenario('publication: own job allowed, other job rejected',farmer,async()=>{
   assert.equal((await query(`insert into job_publish_checks(job_number,farmer_id,items) values(10,'${farmer}','[]') returning id`)).length,1);
   await denied(`insert into job_publish_checks(job_number,farmer_id,items) values(11,'${farmer}','[]') returning id`);
  });
  // Set the synthetic notification clock immediately before the real trigger.
  // The real guard checks wall-clock time after locking, including the exact deadline.
  for(const [age,allowed] of [["71 hours 59 minutes",true],['72 hours',false],['73 hours',false]])for(const route of ['direct','rpc']){
   await scenario(`dispute: ${age} ${route}`,worker,async()=>{
    await db.exec('reset role');
    await db.exec('alter table applications disable trigger authz_no_show_clock');
    // Install a local clock trigger for this transaction only; never part of migration.
    await db.exec(`create function public.qa_dispute_clock() returns trigger language plpgsql as $$begin update public.applications set no_show_recorded_at=clock_timestamp()-interval '${age}' where id=new.application_id;return new;end$$;create trigger aaa_qa_clock before insert on attendance_events for each row execute function public.qa_dispute_clock()`);
    await db.exec('set role authenticated');
    // fixture clock must be SECURITY DEFINER to update the synthetic application.
    await fixture('alter function public.qa_dispute_clock() security definer');
    if(route==='direct'){
     const sql=`insert into attendance_events(application_id,actor_id,kind) values('${id(105)}','${worker}','dispute_no_show') returning id`;
     if(allowed)assert.equal((await query(sql)).length,1);else await denied(sql);
    }else{
     const result=await call(`select record_my_attendance_once('${worker}','${id(301)}','{"application_id":"${id(105)}","kind":"dispute_no_show"}') result`);
     assert.equal(result.ok,allowed);if(!allowed)assert.equal(result.reason,'dispute_window_closed');
    }
   });
  }
  await scenario('dispute: unknown historic notification time denied explicitly',worker,async()=>{
   const result=await call(`select record_my_attendance_once('${worker}','${id(301)}','{"application_id":"${id(105)}","kind":"dispute_no_show"}') result`);
   assert.equal(result.reason,'dispute_time_unknown');
  });
  await scenario('dispute: a saved request can be acknowledged after expiry without another row',worker,async()=>{
   await fixture(`alter table applications disable trigger authz_no_show_clock;update applications set no_show_recorded_at=now() where id='${id(105)}'`);
   const sql=`select record_my_attendance_once('${worker}','${id(302)}','{"application_id":"${id(105)}","kind":"dispute_no_show"}') result`;
   const first=await call(sql);assert.equal(first.ok,true);assert.equal(first.replayed,false);
   await fixture(`update applications set no_show_recorded_at=now()-interval '73 hours' where id='${id(105)}'`);
   const second=await call(sql);assert.equal(second.ok,true);assert.equal(second.replayed,true);assert.deepEqual(second.row,first.row);
   const [count]=await query(`select count(*)::int n from attendance_events where id='${id(302)}'`);assert.equal(count.n,1);
  });
  await scenario('dispute: no absence cannot be disputed',worker,()=>denied(`insert into attendance_events(application_id,actor_id,kind) values('${id(100)}','${worker}','dispute_no_show') returning id`));
  await scenario('dispute: farmer cannot file worker objection',farmer,()=>denied(`insert into attendance_events(application_id,actor_id,kind) values('${id(105)}','${farmer}','dispute_no_show') returning id`));
  await scenario('dispute: absence clock is server stamped and cannot be reset',farmer,async()=>{
   await db.exec('reset role');
   const [first]=await query(`update applications set attended=false,no_show_recorded_at=now()-interval '1 year' where id='${id(100)}' returning no_show_recorded_at`);
   assert.ok(Date.now()-new Date(first.no_show_recorded_at).getTime()<60000);
   const [next]=await query(`update applications set no_show_recorded_at=now()+interval '1 year' where id='${id(100)}' returning no_show_recorded_at`);
   assert.deepEqual(next,first);
  });
  await scenario('admin: metadata and legacy email are never sufficient',other,async()=>{
   assert.equal((await query('select is_app_admin() result'))[0].result,false);
   await denied(`delete from records where id='${id(203)}' returning id`);
   assert.equal((await call(`select admin_moderate_account('${worker}','suspend','QA') result`)).reason,'not_admin');
  },{email:'t5fki6643qty@gmail.com',metadata:{role:'admin',is_admin:true}});
  await scenario('admin: membership works with any email; revocation takes effect with same JWT',admin,async()=>{
   assert.equal((await query('select is_app_admin() result'))[0].result,true);
   assert.equal((await query(`select id from records where id='${id(203)}'`)).length,1);
   await fixture(`delete from app_admins where auth_id='${admin}'`);
   assert.equal((await query('select is_app_admin() result'))[0].result,false);
   await denied(`delete from records where id='${id(203)}' returning id`);
   assert.equal((await call(`select admin_moderate_account('${worker}','suspend','QA') result`)).reason,'not_admin');
  },{email:'t5fki6643qty@gmail.com'});
  await scenario('admin: self promotion and audit rewrite denied',other,async()=>{
   await denied(`insert into app_admins(auth_id) values('${other}') returning auth_id`);
   await denied("insert into event_audit(table_name,op) values('fake','INSERT') returning id");
  });
  for(const f of s.functions.filter(f=>f.schema==='public'&&f.name.startsWith('admin_')&&f.authenticated)){
   await scenario('admin RPC: ordinary member denied '+f.name,other,async()=>{
    const args=f.args?f.args.split(', ').map(a=>'NULL::'+a.replace(/^\w+ /,'')).join(','):'';
    let rows;
    try { rows=await query(`select * from public.${f.name}(${args})`); }
    catch(e){assert.equal(e.code,'P0001');assert.equal(e.message,'SUPPORT_FORBIDDEN');return;}
    assert.ok(rows.length===0||rows.every(r=>Object.values(r).every(v=>v===null||(v&&v.ok===false)||(Array.isArray(v)&&v.length===0))),JSON.stringify(rows));
   });
  }
  await scenario('default deny: unknown action never succeeds',worker,async()=>{
   await db.exec('reset role');assert.equal((await query(`select private.application_write_denial('${id(100)}','unknown') reason`))[0].reason,'unknown_action');
  });
  await scenario('storage: own upload allowed; another owner rejected',worker,async()=>{
   assert.equal((await query(`insert into storage.objects(bucket_id,name,owner_id) values('job-photos','${worker}/qa.png','${worker}') returning id`)).length,1);
   await denied(`insert into storage.objects(bucket_id,name,owner_id) values('job-photos','${other}/qa.png','${worker}') returning id`);
  });
 } finally {await db.close();}
});
