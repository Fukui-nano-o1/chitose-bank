import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.CB_TEST_NODE_MODULES
  ? `${process.env.CB_TEST_NODE_MODULES}/@electric-sql/pglite` : '@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const reader = id(1), sender = id(2), outsider = id(3);
const app = id(10), unrelated = id(11), privateApp = id(12), statusOnly = id(13);
const early = '2026-11-01T01:00:00.000Z', later = '2026-11-01T02:00:00.000Z';
const newest = '2026-11-01T03:00:00.000Z';
const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

// Synthetic database only. Policies below model the inspected existing receipt
// permissions; unread aggregation and immutable history use repository SQL.
// PGlite has one connection. Ordered interleavings cover response reordering,
// not real two-connection transaction/lock contention or a production deployment.
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;
    create table applications(id uuid primary key,worker_id uuid,farmer_id uuid,
      status text,status_changed_at timestamptz,status_changed_by uuid);
    create table messages(id uuid primary key,application_id uuid references applications,
      sender_id uuid,body text,created_at timestamptz,read_at timestamptz);
    create table chat_reads(application_id uuid references applications,reader_id uuid,
      last_read_at timestamptz not null,primary key(application_id,reader_id));
    create table admin_messages(user_id uuid,from_admin boolean,read_at timestamptz);
    create table app_admins(auth_id uuid);
    alter table applications enable row level security;
    alter table messages enable row level security;
    alter table chat_reads enable row level security;
    create policy app_participant on applications for select to authenticated
      using(worker_id=auth.uid() or farmer_id=auth.uid());
    create policy message_participant on messages for select to authenticated using(
      exists(select from applications a where a.id=application_id
        and (a.worker_id=auth.uid() or a.farmer_id=auth.uid())));
    create policy receipt_owner on chat_reads for all to authenticated
      using(reader_id=auth.uid() and exists(select from applications a where a.id=application_id
        and (a.worker_id=auth.uid() or a.farmer_id=auth.uid())))
      with check(reader_id=auth.uid() and exists(select from applications a where a.id=application_id
        and (a.worker_id=auth.uid() or a.farmer_id=auth.uid())));
    create policy receipt_counterpart on chat_reads for select to authenticated using(
      exists(select from applications a where a.id=application_id
        and (a.worker_id=auth.uid() or a.farmer_id=auth.uid())));
    grant select on applications,messages to authenticated;
    grant select,insert,update,delete on chat_reads to authenticated;
    insert into applications values
      ('${app}','${reader}','${sender}','working','${early}','${sender}'),
      ('${unrelated}','${reader}','${sender}','working','${early}','${sender}'),
      ('${privateApp}','${outsider}','${outsider}','working','${early}','${outsider}'),
      ('${statusOnly}','${reader}','${sender}','working','${later}','${sender}');
    insert into messages values
      ('${id(20)}','${app}','${sender}','fetched inbound','${early}',null),
      ('${id(21)}','${app}','${sender}','not fetched inbound','${newest}',null),
      ('${id(22)}','${app}','${reader}','own outbound','${early}',null),
      ('${id(23)}','${unrelated}','${sender}','another chat','${early}',null),
      ('${id(24)}','${privateApp}','${outsider}','private chat','${early}',null);
  `);
  await db.exec(await migration('20260718064550_messages_unread_tracking.sql'));
  await db.exec(await migration('20260719061123_messages_history_immutable.sql'));
  const source = await migration('20260904132932_admin_dm_inbound_notify.sql');
  const start = source.indexOf('create or replace function public.my_unread_message_counts()');
  assert.ok(start >= 0, 'real unread-count function must be present');
  await db.exec(source.slice(start));
  await login(db);
  return db;
}
async function login(db, who = reader, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who || '']);
  await db.exec(`set role ${role}`);
}
const insertReceipt = (db, applicationId, observed, who = reader) => db.query(
  'insert into chat_reads(application_id,reader_id,last_read_at) values($1,$2,$3) on conflict(application_id,reader_id) do nothing',
  [applicationId, who, observed]);
const advanceReceipt = (db, applicationId, observed, who = reader) => db.query(
  'update chat_reads set last_read_at=$3 where application_id=$1 and reader_id=$2 and last_read_at<$3::timestamptz returning last_read_at',
  [applicationId, who, observed]);
async function acknowledge(db, applicationId, observed, fetchedIds = []) {
  if (fetchedIds.length) await db.query(`update messages set read_at=$3 where application_id=$1
    and id=any($2::uuid[]) and sender_id<>auth.uid() and read_at is null`, [applicationId, fetchedIds, observed]);
  await insertReceipt(db, applicationId, observed);
  await advanceReceipt(db, applicationId, observed);
  const rows = (await db.query('select last_read_at from chat_reads where application_id=$1 and reader_id=$2', [applicationId, reader])).rows;
  assert.equal(rows.length, 1);
  assert.ok(new Date(rows[0].last_read_at) >= new Date(observed));
}
const counts = async db => (await db.query('select my_unread_message_counts() as value')).rows[0].value;
const receipt = async (db, applicationId) => (await db.query(
  'select last_read_at from chat_reads where application_id=$1 and reader_id=$2', [applicationId, reader])).rows[0]?.last_read_at;

test('opening acknowledges fetched inbound IDs only and leaves unrelated/private history intact', async () => {
  const db = await fixture();
  try {
    assert.equal((await counts(db)).by_application[app], 3);
    await acknowledge(db, app, early, [id(20), id(22), id(23), id(24)]);
    const unread = await counts(db);
    assert.equal(unread.by_application[app], 1);
    assert.equal(unread.by_application[unrelated], 2);
    assert.equal(unread.by_application[statusOnly], 1);
    assert.equal(unread.by_application[privateApp], undefined);
    const messages = (await db.query('select id,read_at from messages order by id')).rows;
    assert.deepEqual(messages.filter(row => row.read_at !== null).map(row => row.id), [id(20)]);
    await acknowledge(db, app, newest, [id(20), id(21)]);
    assert.equal((await counts(db)).by_application[app], undefined);
    assert.equal(new Date((await db.query('select read_at from messages where id=$1', [id(20)])).rows[0].read_at).toISOString(), early);
  } finally { await db.close(); }
});

test('status-only opening clears its badge; an unobserved newer status remains unread', async () => {
  const db = await fixture();
  try {
    await acknowledge(db, statusOnly, later);
    assert.equal((await counts(db)).by_application[statusOnly], undefined);
    await db.exec('reset role');
    await db.query('update applications set status_changed_at=$1 where id=$2', [newest, statusOnly]);
    await login(db);
    await acknowledge(db, statusOnly, later); // delayed response to the old observed status
    assert.equal((await counts(db)).by_application[statusOnly], 1);
    assert.equal(new Date(await receipt(db, statusOnly)).toISOString(), later);
    await acknowledge(db, statusOnly, newest);
    assert.equal((await counts(db)).by_application[statusOnly], undefined);
  } finally { await db.close(); }
});

test('all two-request insert/update interleavings and reversed retries preserve the newest receipt', async () => {
  const db = await fixture();
  try {
    // Each request inserts before its conditional UPDATE. Enumerate every legal
    // ordering across requests, including insert conflicts and a stale final write.
    const schedules = ['aAbB', 'abAB', 'abBA', 'bBaA', 'baBA', 'baAB'];
    for (const [index, schedule] of schedules.entries()) {
      const applicationId = id(100 + index);
      await db.exec('reset role');
      await db.query('insert into applications values($1,$2,$3,$4,null,null)', [applicationId, reader, sender, 'working']);
      await login(db);
      for (const step of schedule) {
        const observed = step.toLowerCase() === 'a' ? early : later;
        await (step === step.toLowerCase() ? insertReceipt : advanceReceipt)(db, applicationId, observed);
      }
      await acknowledge(db, applicationId, early);
      assert.equal(new Date(await receipt(db, applicationId)).toISOString(), later, schedule);
    }
  } finally { await db.close(); }
});

test('Postgres preserves receipt and unread ordering within one JavaScript millisecond', async () => {
  const db = await fixture();
  try {
    const old = '2026-11-01T02:00:00.654100Z';
    const seen = '2026-11-01T02:00:00.654500Z';
    const unseen = '2026-11-01T02:00:00.654600Z';
    assert.equal(Date.parse(old), Date.parse(unseen), 'JS millisecond comparison cannot distinguish these events');
    await db.exec('reset role');
    await db.query('update applications set status_changed_at=$1 where id=$2', [unseen, statusOnly]);
    await login(db);
    await acknowledge(db, statusOnly, seen);
    await acknowledge(db, statusOnly, old);
    // Do not round-trip through Date: PostgreSQL comparison verifies all six digits.
    const exact = (await db.query(`select last_read_at=$1::timestamptz as exact,
      last_read_at<$2::timestamptz as before_unseen from chat_reads
      where application_id=$3 and reader_id=$4`, [seen, unseen, statusOnly, reader])).rows[0];
    assert.deepEqual(exact, { exact: true, before_unseen: true });
    assert.equal((await counts(db)).by_application[statusOnly], 1);
    assert.equal((await advanceReceipt(db, statusOnly, old)).affectedRows, 0);
    await acknowledge(db, statusOnly, unseen);
    assert.equal((await counts(db)).by_application[statusOnly], undefined);
    const advanced = (await db.query(`select last_read_at=$1::timestamptz as exact
      from chat_reads where application_id=$2 and reader_id=$3`, [unseen, statusOnly, reader])).rows[0];
    assert.equal(advanced.exact, true);
  } finally { await db.close(); }
});

test('RLS, column grants and history trigger reject outsider, forged, sender and anonymous writes', async () => {
  const db = await fixture();
  try {
    await acknowledge(db, app, early, [id(20)]);
    await assert.rejects(() => db.query('update messages set body=$1 where id=$2', ['changed', id(20)]), /permission denied/);
    await assert.rejects(() => insertReceipt(db, app, newest, sender), /row-level security/);
    assert.equal((await advanceReceipt(db, app, newest, sender)).affectedRows, 0);
    await login(db, sender);
    assert.equal((await db.query('select * from chat_reads where application_id=$1', [app])).rows.length, 1, 'counterpart may read the receipt');
    assert.equal((await advanceReceipt(db, app, newest, reader)).affectedRows, 0, 'counterpart may not alter it');
    assert.equal((await db.query('update messages set read_at=$1 where id=$2', [newest, id(21)])).affectedRows, 0, 'sender cannot acknowledge own message');
    await login(db, outsider);
    assert.equal((await db.query('select * from messages where application_id=$1', [app])).rows.length, 0);
    assert.equal((await db.query('update messages set read_at=$1 where id=$2', [newest, id(21)])).affectedRows, 0);
    await assert.rejects(() => insertReceipt(db, app, newest, outsider), /row-level security/);
    assert.equal((await counts(db)).by_application[app], undefined);
    await login(db, null, 'anon');
    await assert.rejects(() => insertReceipt(db, app, newest), /permission denied/);
    await assert.rejects(() => db.query('update messages set read_at=$1 where id=$2', [newest, id(21)]), /permission denied/);
    await assert.rejects(() => counts(db), /permission denied/);
    await db.exec('reset role');
    await assert.rejects(() => db.query('update messages set body=$1 where id=$2', ['changed', id(20)]), /immutable history/);
    await assert.rejects(() => db.query('delete from messages where id=$1', [id(20)]), /immutable history/);
    const untouched = (await db.query('select body,read_at from messages where id=$1', [id(24)])).rows[0];
    assert.deepEqual(untouched, { body: 'private chat', read_at: null });
  } finally { await db.close(); }
});
