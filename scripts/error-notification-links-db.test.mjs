import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const root = new URL('../', import.meta.url);
const sql = async name => readFile(new URL('supabase/migrations/' + name, root), 'utf8');
test('concise record notification preserves throttle, recipient, exclusions, fail-open and admin RLS', async () => {
  const db = new PGlite();
  const admin = '00000000-0000-4000-8000-000000000003';
  const id = '12345678-1234-4234-8234-123456789abc';
  try {
    await db.exec(await readFile(new URL('scripts/fixtures/app-error-schema.sql', root), 'utf8'));
    await db.query('insert into auth.users values ($1,$2)', [admin, 't5fki6643qty@gmail.com']);
    await db.exec(await sql('20260928095153_app_errors_rate_limit.sql'));
    await db.exec(await sql('20261026054449_secure_app_error_ingestion.sql'));
    await db.exec(await sql('20261105193108_concise_error_notification_links.sql'));
    await db.exec('create trigger trg_z_app_error_report after insert on app_errors for each row execute function app_error_report_to_admin()');
    await db.query("insert into app_errors(id,message,component,url,stack) values ($1,'secret-token contact@example.invalid','unsafe','https://unsafe.invalid/?token=secret','private stack')", [id]);
    const notices = (await db.query('select * from admin_messages')).rows;
    assert.equal(notices.length, 1); assert.equal(notices[0].user_id, admin); assert.equal(notices[0].from_admin, true);
    assert.ok(notices[0].body.includes('#/admin/system/errors/' + id));
    assert.match(notices[0].body, /#err:[0-9a-f]{8}$/);
    assert.doesNotMatch(notices[0].body, /secret|contact@|unsafe|private stack/);
    assert.ok(notices[0].body.length < 240);
    await db.exec("insert into app_errors(message,component) values ('secret-token contact@example.invalid','unsafe')");
    assert.equal((await db.query('select count(*)::int n from admin_messages')).rows[0].n, 1);
    await db.exec("insert into app_errors(message,component,user_agent) values ('secret-token contact@example.invalid','unsafe','Googlebot/2.1')");
    assert.equal((await db.query('select count(*)::int n from admin_messages')).rows[0].n, 2);
    await db.exec("insert into app_errors(message) values ('loading chunk test')");
    assert.equal((await db.query('select count(*)::int n from admin_messages')).rows[0].n, 2);
    for (const [role, email, expected] of [['anon', '', 0], ['authenticated', 'member@example.invalid', 0], ['authenticated', 't5fki6643qty@gmail.com', 1]]) {
      await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ email })]);
      await db.exec('set role ' + role);
      assert.equal((await db.query('select id from app_errors where id=$1', [id])).rows.length, expected);
      await db.exec('reset role');
    }
    assert.equal((await db.query("select has_function_privilege('anon','app_error_report_to_admin()','execute') a, has_function_privilege('authenticated','app_error_report_to_admin()','execute') b")).rows[0].a, false);
    await db.exec('drop table admin_messages');
    await db.exec("insert into app_errors(message) values ('notification storage unavailable')");
    assert.equal((await db.query("select count(*)::int n from app_errors where message='notification storage unavailable'")).rows[0].n, 1);
  } finally { await db.close(); }
});
