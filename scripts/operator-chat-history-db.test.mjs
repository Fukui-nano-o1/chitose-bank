import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { sendChatMessage } from '../src/lib/chatMessaging.js';

// Narrow synthetic database, not a production schema/data dump. Existing named
// definitions are used individually; email/push are inert local audit INSERTs.
// PGlite has one connection: replay tests do not claim real concurrent coverage.
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), other = id(2), admin = id(3), admin2 = id(4);
const read = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const patch = await read('20261030070800_guard_operator_chat_history.sql');
const definition = (source, name) => {
  const match = source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'i'));
  assert.ok(match, `missing selected helper ${name}`);
  return match[0];
};

async function fixture() {
  const db = new PGlite();
  await db.exec(`set timezone='UTC'; create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema net;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated,service_role;
    create table auth.users(id uuid primary key);
    create table public.app_admins(auth_id uuid primary key references auth.users(id) on delete cascade,label text,created_at timestamptz not null default now());
    alter table public.app_admins enable row level security;
    create table public.notifications(farmer_id uuid,type text,message text);
    create table public.push_subscriptions(auth_id uuid);
    create table public.push_config(id integer,trigger_secret text);
    create table public.qa_outbound(kind text);
    create function public.resolve_actor_name(uuid) returns text language sql as $$select 'synthetic user'::text$$;
    create function public.send_admin_email(text,text) returns void language sql as $$insert into public.qa_outbound values('email')$$;
    create function net.http_post(url text,headers jsonb,body jsonb) returns bigint language plpgsql as $$begin insert into public.qa_outbound values('push');return 1;end$$;
    create table public.messages(id uuid primary key,body text,read_at timestamptz);
    grant select,insert,update,delete on public.messages to authenticated;
  `);
  await db.exec(await read('20260716022759_app_admins_self_read.sql'));
  await db.exec(await read('20260717130947_admin_messages_dm.sql'));
  await db.exec(definition(await read('20260904132932_admin_dm_inbound_notify.sql'), 'notify_admin_on_user_dm'));
  await db.exec(definition(await read('20260818070135_push_payload_sender_and_snippet.sql'), 'notify_push_on_admin_message'));
  await db.exec(`create trigger trg_notify_admin_on_user_dm after insert on public.admin_messages for each row execute function public.notify_admin_on_user_dm();
    create trigger trg_notify_push_admin_message after insert on public.admin_messages for each row execute function public.notify_push_on_admin_message();
    grant all on public.admin_messages, public.app_admins to postgres,anon,authenticated,service_role;
    insert into auth.users(id) values('${owner}'),('${other}'),('${admin}'),('${admin2}');
    insert into app_admins(auth_id) values('${admin}'),('${admin2}');
    insert into push_subscriptions(auth_id) values('${owner}');
    insert into push_config values(1,'synthetic-not-a-secret');
    insert into admin_messages(id,user_id,from_admin,body,created_at) values
      ('${id(10)}','${owner}',true,'operator message','2026-01-01'),
      ('${id(11)}','${owner}',false,'user message','2026-01-02'),
      ('${id(12)}','${other}',true,'other thread','2026-01-03'),
      ('${id(13)}','${admin}',true,'system report','2026-01-04');
    insert into messages values('${id(90)}','ordinary conversation',null);
    truncate notifications,qa_outbound;
  `);
  return db;
}

test('operator DM history, recipient receipts and retry stay within their authorization boundary', async t => {
  const db = await fixture();
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
  const login = async (who = owner, role = 'authenticated') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [who || '', JSON.stringify({ sub: who || '', role })]);
    await db.exec(`set role ${role}`);
  };
  const state = async () => {
    await db.exec('reset role');
    return (await rows(`select jsonb_build_object(
      'messages',(select jsonb_agg(to_jsonb(m) order by id) from admin_messages m),
      'ordinary',(select jsonb_agg(to_jsonb(m) order by id) from messages m),
      'notifications',(select jsonb_agg(to_jsonb(n) order by farmer_id) from notifications n),
      'outbound',(select jsonb_agg(to_jsonb(q) order by kind) from qa_outbound q),
      'updates',(select count(*) from qa_updates)) value`))[0].value;
  };
  const scenario = async (name, fn) => t.test(name, async () => {
    await db.exec('reset role; begin');
    try { await fn(); } finally { await db.exec('rollback; reset role'); }
  });
  const denied = async (who, sql, role = 'authenticated', code = '42501') => {
    const before = await state();
    await login(who, role);
    await db.exec('savepoint attempt');
    await assert.rejects(rows(sql), e => e.code === code);
    await db.exec('rollback to savepoint attempt');
    assert.deepEqual(await state(), before);
  };
  const unchanged = async (who, sql, role = 'authenticated') => {
    const before = await state();
    await login(who, role);
    assert.deepEqual(await rows(sql), []);
    assert.deepEqual(await state(), before);
  };
  try {
    // No audit trigger yet: the migration preflight must see only existing triggers.
    await t.test('baseline reproduces user history edits without crossing thread ownership', async () => {
      await db.exec('begin');
      try {
        await login(owner);
        assert.equal((await rows(`update admin_messages set body='rewritten',from_admin=false,created_at='2000-01-01',id='${id(15)}' where id='${id(10)}' returning id`)).length, 1);
        assert.equal((await rows(`update admin_messages set from_admin=true where id='${id(11)}' returning id`)).length, 1);
        assert.equal((await rows(`update admin_messages set body='unrelated' where id='${id(12)}' returning id`)).length, 0);
      } finally { await db.exec('rollback; reset role'); }
    });
    for (const [label, mutation] of [
      ['missing primary key', 'alter table admin_messages drop constraint admin_messages_pkey'],
      ['new column', 'alter table admin_messages add column unexpected text'],
      ['changed policy', 'alter policy "am update" on admin_messages using (true)'],
      ['changed grant', 'revoke update on admin_messages from authenticated'],
      ['changed trigger', 'alter table admin_messages disable trigger trg_notify_admin_on_user_dm'],
      ['changed notification function', "create or replace function public.notify_push_on_admin_message() returns trigger language plpgsql as $$begin return new;end$$"],
    ]) await t.test(`preflight refuses ${label} before making any change`, async () => {
      await db.exec('begin');
      try {
        await db.exec(mutation);
        await assert.rejects(db.exec(patch), /ADMIN_MESSAGE_SCHEMA_DRIFT/);
      } finally { await db.exec('rollback; reset role'); }
      assert.equal((await rows("select to_regprocedure('public.guard_admin_message_update()') value"))[0].value, null);
    });
    await t.test('preflight refuses an existing guard function rather than replacing it', async () => {
      await db.exec('begin');
      try {
        await db.exec("create function public.guard_admin_message_update() returns trigger language plpgsql as $$begin return new;end$$");
        await assert.rejects(db.exec(patch), /ADMIN_MESSAGE_GUARD_ALREADY_EXISTS/);
      } finally { await db.exec('rollback; reset role'); }
    });
    await t.test('unchanged full migration passes its exact catalog preflight', async () => {
      await db.exec('begin');
      try { await db.exec(patch); await db.exec('commit'); }
      catch (error) { await db.exec('rollback'); throw error; }
    });
    await db.exec(`create table qa_updates(id uuid);
      create function qa_audit_admin_update() returns trigger language plpgsql security definer set search_path='' as $$begin insert into public.qa_updates values(new.id);return new;end$$;
      create trigger qa_audit_admin_update after update on admin_messages for each row execute function qa_audit_admin_update();`);

    for (const [label, who, target] of [['user receives operator', owner, 10], ['operator receives user', admin, 11], ['second operator receives user', admin2, 11], ['operator receives own system report', admin, 13]]) {
      await scenario(label + ': first receipt uses server time, replay is no-write', async () => {
        const before = await state();
        await login(who);
        const receipt = (await rows(`update admin_messages set read_at='1900-01-01' where id='${id(target)}' returning read_at`))[0].read_at;
        assert.ok(Math.abs(Date.now() - new Date(receipt).getTime()) < 60000);
        const after = await state();
        assert.equal(after.updates, 1);
        assert.deepEqual(after.notifications, before.notifications);
        assert.deepEqual(after.outbound, before.outbound);
        for (const value of ["'1900-01-01'", "'infinity'", "now()"] ) {
          await unchanged(who, `update admin_messages set read_at=${value} where id='${id(target)}' returning id`);
        }
        await denied(who, `update admin_messages set read_at=null where id='${id(target)}'`);
        assert.deepEqual(await state(), after);
      });
    }
    await scenario('mixed bulk receipt updates only rows received by the user', async () => {
      await login(owner);
      assert.deepEqual((await rows(`update admin_messages set read_at=now() where id in ('${id(10)}','${id(11)}','${id(12)}') returning id`)).map(row => row.id), [id(10)]);
      const after = await state();
      assert.equal(after.updates, 1);
      assert.equal(after.messages.find(row => row.id === id(11)).read_at, null);
      assert.equal(after.messages.find(row => row.id === id(12)).read_at, null);
      assert.equal(after.notifications, null);
      assert.equal(after.outbound, null);
    });
    await scenario('null-to-null receipt is no-write', () => unchanged(owner, `update admin_messages set read_at=null where id='${id(10)}' returning id`));
    for (const [label, who, target] of [['user sender', owner, 11], ['operator sender', admin, 10], ['unrelated user', other, 10], ['missing identity', '', 10]]) {
      await scenario(label + ' cannot mark another recipient read', () => unchanged(who, `update admin_messages set read_at=now() where id='${id(target)}' returning id`));
    }
    await scenario('anonymous cannot update', () => denied('', `update admin_messages set read_at=now() where id='${id(10)}'`, 'anon'));
    for (const [field, value] of [['id', `'${id(21)}'`], ['user_id', `'${other}'`], ['from_admin', 'false'], ['body', "'changed'"], ['created_at', "'1900-01-01'"]]) {
      for (const [label, who] of [['user', owner], ['operator', admin]]) await scenario(`${label} cannot update history field ${field}`, () => denied(who, `update admin_messages set ${field}=${value} where id='${id(10)}'`));
      await scenario(`privileged update cannot rewrite ${field}`, () => denied('', `update admin_messages set ${field}=${value} where id='${id(10)}'`, 'postgres'));
    }
    await scenario('combined history and receipt edit is atomic', () => denied(owner, `update admin_messages set body='changed',read_at=now() where id='${id(10)}'`));
    for (const [label, role, who] of [['user', 'authenticated', owner], ['operator', 'authenticated', admin], ['anonymous', 'anon', '']]) {
      await scenario(`${label} cannot delete history`, () => denied(who, `delete from admin_messages where id='${id(10)}'`, role));
      await scenario(`${label} cannot truncate history`, () => denied(who, 'truncate admin_messages', role));
    }
    for (const [label, who, target, fromAdmin] of [['user', owner, owner, false], ['operator', admin, other, true], ['operator own user-side message', admin, admin, false]]) {
      await scenario(`${label} can send using existing columns and receive defaults`, async () => {
        await login(who);
        const saved = (await rows(`insert into admin_messages(id,user_id,from_admin,body) values('${id(30)}','${target}',${fromAdmin},'synthetic new') returning *`))[0];
        assert.equal(saved.read_at, null);
        assert.ok(Math.abs(Date.now() - new Date(saved.created_at).getTime()) < 60000);
        assert.equal(saved.body, 'synthetic new');
      });
    }
    await scenario('legacy admin composer may omit UUID and still send', async () => {
      await login(admin);
      assert.equal((await rows(`insert into admin_messages(user_id,from_admin,body) values('${owner}',true,'legacy composer') returning id`)).length, 1);
      const after = await state();
      assert.deepEqual(after.outbound, [{ kind: 'push' }]);
      assert.equal(after.notifications, null);
    });
    for (const [label, who, target, fromAdmin, role] of [['user spoofs operator', owner, owner, true, 'authenticated'], ['user spoofs another owner', owner, other, false, 'authenticated'], ['operator spoofs user', admin, other, false, 'authenticated'], ['anonymous', '', owner, false, 'anon'], ['missing identity', '', owner, false, 'authenticated']]) {
      await scenario(`${label} cannot insert`, () => denied(who, `insert into admin_messages(user_id,from_admin,body) values('${target}',${fromAdmin},'forged')`, role));
    }
    for (const [field, value] of [['created_at', "'1900-01-01'"], ['read_at', 'now()']]) for (const [label, who, fromAdmin] of [['user', owner, false], ['operator', admin, true]]) {
      await scenario(`${label} cannot supply ${field} on insert`, () => denied(who, `insert into admin_messages(user_id,from_admin,body,${field}) values('${owner}',${fromAdmin},'forged',${value})`));
    }
    await scenario('trusted server-generated insert remains supported', async () => {
      await login('', 'service_role');
      assert.equal((await rows(`insert into admin_messages(user_id,from_admin,body) values('${owner}',true,'server report') returning id`)).length, 1);
      assert.deepEqual((await state()).outbound, [{ kind: 'push' }]);
    });
    await scenario('duplicate UUID insert fails without repeating notifications', async () => {
      await login(owner);
      await rows(`insert into admin_messages(id,user_id,from_admin,body) values('${id(30)}','${owner}',false,'retry')`);
      const before = await state();
      assert.equal(before.notifications.length, 2);
      assert.equal(before.outbound.length, 1);
      await denied(owner, `insert into admin_messages(id,user_id,from_admin,body) values('${id(30)}','${owner}',false,'retry')`, 'authenticated', '23505');
      await login(owner);
      const found = (await rows(`select * from admin_messages where id='${id(30)}'`))[0];
      let requests = 0;
      const client = { from: table => {
        assert.equal(table, 'admin_messages');
        return { insert: row => { assert.equal(row.id, id(30)); requests++; return { select: () => ({ single: () => Promise.resolve({ error: { code: '23505' } }) }) }; },
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: found, error: null }) }) }) };
      } };
      assert.equal((await sendChatMessage(client, 'admin_messages', { id: id(30), user_id: owner, from_admin: false, body: 'retry' })).id, id(30));
      await assert.rejects(sendChatMessage(client, 'admin_messages', { id: id(30), user_id: owner, from_admin: false, body: 'different' }));
      assert.equal(requests, 2);
      assert.deepEqual(await state(), before);
    });
    await scenario('client cannot install a trigger after the history guard', () => denied(owner, 'create trigger z_client_rewrite before update on admin_messages for each row execute function qa_audit_admin_update()'));
    await scenario('guard automatically protects future columns', async () => {
      await db.exec('alter table admin_messages add column future_history text');
      await denied('', `update admin_messages set future_history='changed' where id='${id(10)}'`, 'postgres');
    });
    await scenario('ordinary messages remain untouched by operator DM migration', async () => {
      await login(owner);
      assert.equal((await rows(`update messages set body='ordinary update',read_at=now() where id='${id(90)}' returning id`)).length, 1);
    });
    await scenario('trigger is not a public definer RPC and only expected grants survive', async () => {
      const fn = (await rows("select prosecdef,proconfig from pg_proc where oid='public.guard_admin_message_update()'::regprocedure"))[0];
      assert.equal(fn.prosecdef, false);
      assert.deepEqual(fn.proconfig, ['search_path=""']);
      for (const role of ['anon', 'authenticated', 'service_role']) assert.equal((await rows(`select has_function_privilege('${role}','public.guard_admin_message_update()','execute') allowed`))[0].allowed, false);
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER']) assert.equal((await rows(`select has_table_privilege('authenticated','public.admin_messages','${privilege}') allowed`))[0].allowed, false);
      assert.equal((await rows("select has_column_privilege('authenticated','public.admin_messages','read_at','update') allowed"))[0].allowed, true);
    });
  } finally { await db.close(); }
});
