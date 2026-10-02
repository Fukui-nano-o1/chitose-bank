import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { isGooglebot, deviceLabel, groupFacts, groupAppErrors, buildErrorReport } from '../src/lib/errorCatalog.js';

const mobile = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X) Chrome/153.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const desktop = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/153.0 Safari/537.36';
const android = 'Mozilla/5.0 (Linux; Android 14) Chrome/153.0 Mobile Safari/537.36';
const cases = [[mobile,true],[desktop,true],['googlebot/2.1',true],['Googlebot-Image/1.0',true],
  [android,false],['Mozilla/5.0 (iPhone)',false],[null,false],['',false],['NotGooglebot/1.0',false]];

test('Googlebot is labeled before Android/PC; ordinary and unknown clients remain distinct', () => {
  for (const [ua, expected] of cases) assert.equal(isGooglebot(ua), expected, String(ua));
  assert.equal(deviceLabel(mobile), 'Googlebot（自動巡回）');
  assert.equal(deviceLabel(desktop), 'Googlebot（自動巡回）');
  assert.equal(deviceLabel(android), 'Android');
  assert.equal(deviceLabel('Mozilla/5.0 (iPhone)'), 'iPhone/iPad');
  assert.equal(deviceLabel(null), '不明');
});

test('mixed error groups retain all records but separate Googlebot from visitor impact', () => {
  const rows = [mobile,desktop,android,android,android].map((ua,i) => ({
    id:i, user_agent:ua, user_id:i>=3?'same-user':null, message:'Rejected',
    source:'unhandledrejection', component:'global', status:'open',
    created_at:'2026-10-02T09:56:26Z', page:'/search',
  }));
  const group=groupAppErrors(rows)[0].groups[0];
  const facts=groupFacts(group);
  assert.equal(facts.botN,2); assert.equal(facts.anonN,1); assert.equal(facts.userN,1);
  assert.equal(group.rows.length,5); assert.equal(group.openIds.length,5);
  const report=buildErrorReport(group,'画面の表示エラー',null,'');
  assert.match(report,/ログイン利用者1人・未ログインの発生1件・Googlebot（自動巡回）2件/);
  assert.match(report,/端末・アクセス元: Googlebot（自動巡回） 2件|端末・アクセス元: Android 3件・Googlebot（自動巡回） 2件/);
  const bots=groupFacts({rows:rows.slice(0,2)});
  assert.equal(bots.anonN,0); assert.equal(bots.userN,0); assert.equal(bots.botN,2);
});

test('database notification labels match the UI and crawler throttling cannot suppress a visitor error', async () => {
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid, email text);
      insert into auth.users values('10000000-0000-4000-8000-000000000001','t5fki6643qty@gmail.com');
      create table public.admin_messages(user_id uuid, from_admin boolean, body text, created_at timestamptz default now());
      create table public.app_errors(user_agent text, user_id uuid, message text, component text, source text,
        page text, url text, error_code text, created_at timestamptz default now());`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261002153118_distinguish_googlebot_error_reports.sql',import.meta.url),'utf8'));
    await db.exec('create trigger report after insert on app_errors for each row execute function app_error_report_to_admin();');
    for (const [i,[ua,expected]] of cases.entries()) {
      await db.query("insert into app_errors(user_agent,message,component,source,page) values($1,'Rejected',$2,'unhandledrejection','/search')",[ua,'case-'+i]);
      const body=(await db.query('select body from admin_messages order by ctid desc limit 1')).rows[0].body;
      assert.equal(body.includes('利用者：自動巡回（Googlebot）'),expected,String(ua));
      assert.equal(body.includes('利用者：未ログイン'),!expected,String(ua));
      if (expected) assert.match(body,/端末・アクセス元：Googlebot（自動巡回）/);
    }
    await db.exec('truncate admin_messages;');
    for (const ua of [mobile,desktop,android,android]) {
      await db.query("insert into app_errors(user_agent,message,component,source,page) values($1,'Rejected','same','unhandledrejection','/search')",[ua]);
    }
    const messages=(await db.query('select body from admin_messages')).rows;
    assert.equal(messages.length,2);
    assert.equal(messages.filter(r=>r.body.includes('利用者：自動巡回（Googlebot）')).length,1);
    assert.equal(messages.filter(r=>r.body.includes('利用者：未ログイン')).length,1);
    assert.equal((await db.query("select has_function_privilege('anon','public.app_error_report_to_admin()','execute') as allowed")).rows[0].allowed,false);
  } finally { await db.close(); }
});
