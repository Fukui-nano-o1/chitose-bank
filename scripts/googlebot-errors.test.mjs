import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { isGooglebot, deviceLabel, groupFacts, groupAppErrors, buildErrorReport } from '../src/lib/errorCatalog.js';

const mobile = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X) Chrome/153.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const desktop = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/153.0 Safari/537.36';
const android = 'Mozilla/5.0 (Linux; Android 14) Chrome/153.0 Mobile Safari/537.36';
const cases = [[mobile,true],[desktop,true],['googlebot/2.1',true],['Googlebot-Image/1.0',true],
  [android,false],['Mozilla/5.0 (iPhone)',false],[null,false],['',false],['NotGooglebot/1.0',false]];

test('Googlebot is labeled before Android/PC; ordinary and unknown clients remain distinct', () => {
  for (const [ua, expected] of cases) assert.equal(isGooglebot(ua), expected, String(ua));
  assert.equal(deviceLabel(mobile), 'Googlebot申告・未検証');
  assert.equal(deviceLabel(desktop), 'Googlebot申告・未検証');
  assert.equal(deviceLabel(android), 'Android');
  assert.equal(deviceLabel('Mozilla/5.0 (iPhone)'), 'iPhone/iPad');
  assert.equal(deviceLabel(null), '不明');
});

test('self-declared Googlebot records remain included in visitor impact', () => {
  const rows = [mobile,desktop,android,android,android].map((ua,i) => ({
    id:i, user_agent:ua, user_id:i>=3?'same-user':null, message:'Rejected',
    source:'unhandledrejection', component:'global', status:'open',
    created_at:'2026-10-02T09:56:26Z', page:'/search', identity_verified:true,
  }));
  const group=groupAppErrors(rows)[0].groups[0];
  const facts=groupFacts(group);
  assert.equal(facts.botN,2); assert.equal(facts.anonN,3); assert.equal(facts.userN,1); assert.equal(facts.unknownN,0);
  assert.equal(group.rows.length,5); assert.equal(group.openIds.length,5);
  const report=buildErrorReport(group,'画面の表示エラー',null,'');
  assert.match(report,/認証確認済みの利用者1人・未ログインの発生3件（うちGooglebot申告・未検証2件）/);
  assert.match(report,/端末・アクセス元: Android 3件・Googlebot申告・未検証 2件/);
  const bots=groupFacts({rows:rows.slice(0,2)});
  assert.equal(bots.anonN,2); assert.equal(bots.userN,0); assert.equal(bots.botN,2);
});

test('legacy claimed identities are not presented as verified users', () => {
  const rows=[{user_id:'claimed',identity_verified:false},{user_id:null},{user_id:'verified',identity_verified:true}]
    .map((r,i)=>({...r,id:i,message:'Legacy error',status:'open',created_at:'2026-10-26T00:00:00Z'}));
  const group=groupAppErrors(rows)[0].groups[0];
  const facts=groupFacts(group);
  assert.equal(facts.userN,1); assert.equal(facts.anonN,0); assert.equal(facts.unknownN,2);
  assert.match(buildErrorReport(group,'画面の表示エラー',null,''),/認証状態を確認できない旧記録2件/);
});

test('database notification labels match the UI and crawler throttling cannot suppress a visitor error', async () => {
  const db=new PGlite();
  try {
    await db.exec(await readFile(new URL('./fixtures/app-error-schema.sql',import.meta.url),'utf8'));
    await db.exec("insert into auth.users values('10000000-0000-4000-8000-000000000001','t5fki6643qty@gmail.com')");
    const files=await readdir(new URL('../supabase/migrations/',import.meta.url));
    await db.exec(await readFile(new URL('../supabase/migrations/'+files.find(f=>f.endsWith('_secure_app_error_ingestion.sql')),import.meta.url),'utf8'));
    await db.exec('create trigger report after insert on app_errors for each row execute function app_error_report_to_admin();');
    for (const [i,[ua,expected]] of cases.entries()) {
      await db.query("insert into app_errors(user_agent,message,component,source,page) values($1,'Rejected',$2,'unhandledrejection','/search')",[ua,'case-'+i]);
      const body=(await db.query('select body from admin_messages order by ctid desc limit 1')).rows[0].body;
      assert.equal(body.includes('端末・アクセス元：Googlebot申告・未検証'),expected,String(ua));
      assert.equal(body.includes('利用者：未ログイン'),true,String(ua));
    }
    await db.exec('truncate admin_messages;');
    for (const ua of [mobile,desktop,android,android]) {
      await db.query("insert into app_errors(user_agent,message,component,source,page) values($1,'Rejected','same','unhandledrejection','/search')",[ua]);
    }
    const messages=(await db.query('select body from admin_messages')).rows;
    assert.equal(messages.length,2);
    assert.equal(messages.filter(r=>r.body.includes('Googlebot申告・未検証')).length,1);
    assert.equal(messages.filter(r=>r.body.includes('利用者：未ログイン')).length,2);
    assert.equal((await db.query("select has_function_privilege('anon','public.app_error_report_to_admin()','execute') as allowed")).rows[0].allowed,false);
  } finally { await db.close(); }
});
