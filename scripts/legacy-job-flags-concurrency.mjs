import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { legacyJobFlagsSchema, legacyJobFlagsRuntime } from './fixtures/legacy-job-flags-schema.mjs';

// Only an ephemeral, explicitly named loopback PostgreSQL service is allowed.
// Never pass a production connection string to this script.
const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid.invalid/missing');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname), 'CI database must use loopback');
assert.equal(url.pathname, '/legacy_flags_ci', 'Use the dedicated synthetic CI database');
assert.equal(url.protocol, 'postgresql:');
const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
const migrations = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(n=>/^\d+_isolate_legacy_job_flags\.sql$/.test(n));
assert.equal(migrations.length,1,'Exactly one isolation migration');
const migration = await read('supabase/migrations/'+migrations[0]);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const farmer=id(1),worker=id(2),nextWorker=id(3),stranger=id(4);
const clients=[];

class Client {
  constructor(label) {
    this.name='legacy-flags-'+label;
    this.buffer='';this.stderr='';this.pending=null;this.closed=false;
    this.process=spawn('psql',['--no-psqlrc','-X','-qAt','-v','ON_ERROR_STOP=1'],{
      env:{...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGDATABASE:'legacy_flags_ci',
        PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGAPPNAME:this.name,
        PGCONNECT_TIMEOUT:'10',PGOPTIONS:'-c statement_timeout=20000 -c idle_in_transaction_session_timeout=60000'},
      stdio:['pipe','pipe','pipe'],
    });
    this.process.stdout.on('data',chunk=>{
      this.buffer+=chunk.toString();
      let end;
      while((end=this.buffer.indexOf('\n'))>=0){
        const line=this.buffer.slice(0,end).replace(/\r$/,'');this.buffer=this.buffer.slice(end+1);
        if(!this.pending)continue;
        if(line===this.pending.token){const p=this.pending;this.pending=null;p.resolve(p.lines);}
        else this.pending.lines.push(line);
      }
    });
    this.process.stderr.on('data',chunk=>{this.stderr+=chunk.toString();});
    this.process.on('error',error=>{this.closed=true;this.pending?.reject(error);this.pending=null;});
    this.process.on('exit',code=>{
      this.closed=true;
      if(this.pending){this.pending.reject(new Error(`${this.name} psql exited ${code}: ${this.stderr}`));this.pending=null;}
    });
    clients.push(this);
  }
  run(sql){
    assert.equal(this.pending,null,`${this.name} already has a command`);
    assert.equal(this.closed,false,`${this.name} connection is closed`);
    const token='DONE_'+randomUUID().replaceAll('-','');
    return new Promise((resolve,reject)=>{
      this.pending={token,resolve,reject,lines:[]};
      this.process.stdin.write(`${sql}\nselect '${token}';\n`);
    });
  }
  async json(sql){const lines=await this.run(sql);assert.equal(lines.length,1,`${this.name}: expected one JSON result: ${lines.join('\n')}`);return JSON.parse(lines[0]);}
  async login(uid){await this.run(`reset role;set request.jwt.claim.sub='${uid}';set request.jwt.claims='{"email":"synthetic@example.invalid"}';set role authenticated;`);}
  close(){if(!this.closed){this.process.stdin.end();this.process.kill();}}
}
const observer=new Client('observer'),older=new Client('older'),release=new Client('release'),newer=new Client('newer'),peer=new Client('peer');
const waitForLock=async client=>{
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){
    const waiting=await observer.json(`select to_json(exists(select 1 from pg_stat_activity where application_name='${client.name}' and wait_event_type='Lock'));`);
    if(waiting)return;
    await delay(40);
  }
  throw new Error(`${client.name} never reached the expected concurrent lock wait`);
};
try {
  const identity=await observer.json("select json_build_object('database',current_database(),'server',inet_server_addr()::text,'version',current_setting('server_version_num'));");
  assert.equal(identity.database,'legacy_flags_ci');assert.ok(Number(identity.version)>=170000);
  await observer.run(legacyJobFlagsSchema({farmer,worker,nextWorker,stranger}));
  for(const file of ['legacy-job-flags-production.sql','legacy-job-flags-display-production.sql','legacy-job-flags-party-production.sql','legacy-job-flags-copy-production.sql'])
    await observer.run(await read('scripts/fixtures/'+file));
  await observer.run('revoke all on function job_details_for_party(integer[]) from public,anon;grant execute on function job_details_for_party(integer[]) to authenticated,service_role;');
  await observer.run(legacyJobFlagsRuntime);
  console.log('PASS synthetic PostgreSQL setup; no external mail transport');

  // An already-running old approval may complete before release. The release must
  // wait for that transaction, preserve it, and stop the request queued behind it.
  await older.login(worker);await older.run('begin;');
  const oldResult=await older.json('select public.apply_to_job(10,null);');assert.equal(oldResult.ok,true);
  const releaseResult=release.run(migration);
  await waitForLock(release);
  await newer.login(nextWorker);
  const afterRelease=newer.json('select public.apply_to_job(10,null);');
  await waitForLock(newer);
  await older.run('commit;');
  await releaseResult;const newResult=await afterRelease;assert.equal(newResult.ok,true);
  const states=await observer.json(`select jsonb_object_agg(worker_id::text,status) from applications where job_number=10;`);
  assert.equal(states[worker],'approved');assert.equal(states[nextWorker],'applied');
  assert.equal(await observer.json(`select to_json(count(*)::int) from messages where application_id='${newResult.application_id}' and body like '%リピート即決%';`),0);
  assert.deepEqual(await observer.json("select json_build_object('beginner',beginner_ok,'repeat',instant_approve_repeat) from jobs where job_number=10;"),{beginner:true,repeat:true});
  console.log('PASS old transaction drains, release serializes, queued old-client application stays applied');

  // The real partial unique index serializes two same-user requests. The second
  // must return already without duplicate messages/notifications/mail.
  await older.login(stranger);await peer.login(stranger);await older.run('begin;');
  const first=await older.json('select public.apply_to_job(10,null);');assert.equal(first.ok,true);
  const duplicate=peer.json('select public.apply_to_job(10,null);');
  await waitForLock(peer);await older.run('commit;');
  assert.equal((await duplicate).already,true);
  assert.equal(await observer.json(`select to_json(count(*)::int) from applications where job_number=10 and worker_id='${stranger}';`),1);
  assert.equal(await observer.json(`select to_json(count(*)::int) from messages where application_id='${first.application_id}';`),1);
  assert.equal(await observer.json(`select to_json(count(*)::int) from qa_mail where recipient='${stranger}';`),1);
  console.log('PASS simultaneous duplicate application creates one application and one worker message/mail');

  // Two owner edits race on an old true row. Both must retain original flags;
  // privileged copy still returns a new false row without changing the source.
  await older.login(farmer);await peer.login(farmer);await older.run('begin;');
  const update="update jobs set beginner_ok=false,instant_approve_repeat=false where job_number=11 returning json_build_object('beginner',beginner_ok,'repeat',instant_approve_repeat);";
  assert.deepEqual(await older.json(update),{beginner:true,repeat:true});
  const secondEdit=peer.json(update);await waitForLock(peer);await older.run('commit;');
  assert.deepEqual(await secondEdit,{beginner:true,repeat:true});
  await observer.run(`set request.jwt.claim.sub='${farmer}';`);
  const copy=await observer.json('select copy_job(10);');assert.equal(copy.ok,true);
  assert.equal(copy.job.beginner_ok,false);assert.equal(copy.job.instant_approve_repeat,false);
  console.log('PASS concurrent legacy edits preserve old values; new copy flags are inactive');

  // Ordinary owner approval remains available after the automatic path is inert.
  assert.equal((await older.json(`select approve_application('${newResult.application_id}',true);`)).ok,true);
  assert.equal(await observer.json(`select to_json(status) from applications where id='${newResult.application_id}';`),'approved');
  console.log('PASS ordinary manual approval remains available');
  console.log('PASS real PostgreSQL concurrency suite');
} finally {for(const client of clients)client.close();}
