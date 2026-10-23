import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const files = await readdir(new URL('supabase/migrations/', root));
const migration = await read('supabase/migrations/' + files.find(f => f.endsWith('_emergency_contact_explicit_confirmation.sql')));
const worker = '00000000-0000-4000-8000-000000000001';
const farmer = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
const application = '00000000-0000-4000-8000-000000000004';
const confirmed = '2026-10-23T00:00:00Z';

test('emergency contacts require explicit confirmation and return only saved values', async t => {
  const db = new PGlite();
  try {
    await db.exec(await read('scripts/fixtures/emergency-contact-schema.sql'));
    await db.exec(await read('supabase/migrations/20261018141532_profile_section_compare_and_save.sql'));
    await db.exec(await read('supabase/migrations/20261018150428_profile_save_owner_guard.sql'));
    const login = async (uid, role = 'authenticated') => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid || '']);
      await db.exec('set role ' + role);
    };
    const rpc = async (id = application) => (await db.query('select contract_emergency_contact($1) result', [id])).rows[0].result;
    const hidden = (result, reason) => {
      if (reason) assert.equal(result.reason, reason);
      assert.notEqual(result.empty, false);
      for (const key of ['name', 'phone', 'relation']) assert.equal(key in result, false, key + ' must be omitted');
      assert.equal(JSON.stringify(result).includes('SECRET'), false);
    };
    const reset = async () => {
      await db.exec('reset role; truncate applications,account_holders,app_settings,emergency_contacts');
      await db.query("insert into applications values($1,$2,$3,'{}',now(),null)", [application,worker,farmer]);
      await db.exec("insert into app_settings values('privacy_version','current')");
      for (const uid of [worker,farmer]) {
        await db.query("insert into account_holders values($1,'SECRET-account-name','SECRET-account-phone','current')", [uid]);
        await db.query("insert into emergency_contacts(auth_id,name,relation,phone) values($1,'SECRET-saved-name','本人','SECRET-saved-phone')", [uid]);
      }
    };
    await reset(); await login(farmer);
    assert.equal((await rpc()).phone, 'SECRET-saved-phone', 'reproduce unconfirmed self disclosure before migration');
    await db.exec('reset role'); await db.exec(migration);

    for (const caller of [worker,farmer]) {
      const counterpart = caller === worker ? farmer : worker;
      for (const relation of ['本人',' 本人 ','家族','']) await t.test('unconfirmed '+relation+' is hidden from '+(caller===worker?'worker':'farmer'), async () => {
        await reset();
        await db.query('update emergency_contacts set relation=$1 where auth_id=$2', [relation,counterpart]);
        await login(caller); hidden(await rpc(), 'not_confirmed');
      });
      await t.test('confirmed self is visible to '+(caller===worker?'worker':'farmer'), async () => {
        await reset(); await db.query('update emergency_contacts set confirmed_at=$1 where auth_id=$2', [confirmed,counterpart]);
        await login(caller);
        assert.deepEqual(await rpc(), {ok:true,empty:false,name:'SECRET-saved-name',relation:'本人',phone:'SECRET-saved-phone'});
        assert.equal((await db.query('select count(*)::int n from emergency_contacts where auth_id=$1',[counterpart])).rows[0].n,0,'direct reads remain owner-only');
      });
    }
    await t.test('confirmed family contact is visible', async () => {
      await reset(); await db.query("update emergency_contacts set relation='家族',confirmed_at=$1", [confirmed]);
      await login(farmer); assert.equal((await rpc()).relation,'家族');
    });
    await t.test('confirming the caller does not confirm the counterpart', async () => {
      await reset(); await db.query('update emergency_contacts set confirmed_at=$1 where auth_id=$2',[confirmed,farmer]);
      await login(farmer); hidden(await rpc(),'not_confirmed');
    });
    for (const [label, sql, reason] of [
      ['not contracted', 'update applications set terms_snapshot=null', 'not_contracted'],
      ['not started', 'update applications set started_at=null', 'not_working'],
      ['completed', 'update applications set work_completed_at=now()', 'not_working'],
      ['missing consent', 'update account_holders set agreed_privacy_version=null', 'not_consented'],
      ['old consent', "update account_holders set agreed_privacy_version='old'", 'not_consented'],
      ['missing current policy', 'delete from app_settings', 'not_consented'],
    ]) await t.test(label+' still blocks confirmed contacts', async () => {
      await reset(); await db.query('update emergency_contacts set confirmed_at=$1',[confirmed]); await db.exec(sql);
      await login(farmer); hidden(await rpc(),reason);
    });
    await t.test('unrelated and anonymous callers cannot obtain contact fields', async () => {
      await reset(); await db.query('update emergency_contacts set confirmed_at=$1',[confirmed]);
      await login(other); hidden(await rpc(),'not_party'); hidden(await rpc(other),'not_found');
      await login(null); hidden(await rpc(),'not_party');
      await login(null,'anon'); await assert.rejects(rpc(),/permission denied/);
    });
    await t.test('missing row never falls back to account details', async () => {
      await reset(); await db.exec('delete from emergency_contacts'); await login(farmer); hidden(await rpc(),'not_confirmed');
    });
    for (const [name,phone] of [['   ','   '],['SECRET-saved-name',''],['','SECRET-saved-phone']]) await t.test('saved blanks stay blank: '+JSON.stringify([name,phone]), async () => {
      await reset(); await db.query('update emergency_contacts set name=$1,phone=$2,confirmed_at=$3',[name,phone,confirmed]);
      await login(farmer); const result=await rpc();
      assert.equal(JSON.stringify(result).includes('SECRET-account'),false);
      if (!name.trim() && !phone.trim()) hidden(result);
      else {assert.equal(result.name,name.trim()||null);assert.equal(result.phone,phone.trim()||null);}
    });
    await t.test('owner save confirms exactly the displayed values; clearing and revocation take effect', async () => {
      await reset(); await login(worker);
      const save = async patch => {
        const row=(await db.query('select to_jsonb(e) result from emergency_contacts e')).rows[0].result;
        const expected=Object.fromEntries(Object.keys(patch).map(key=>[key,row[key]]));
        return (await db.query("select save_my_profile_fields('emergency_contacts',$1,$2,$3) result",[expected,patch,worker])).rows[0].result;
      };
      assert.equal((await save({name:'SECRET-confirmed',relation:'本人',phone:'SECRET-confirmed-phone',confirmed_at:confirmed})).ok,true);
      await login(farmer); assert.equal((await rpc()).phone,'SECRET-confirmed-phone');
      // The other party cannot confirm or replace this contact.
      assert.equal((await db.query("select save_my_profile_fields('emergency_contacts',null,$1,$2) result",[{confirmed_at:confirmed},worker])).rows[0].result.reason,'not_logged_in');
      await login(worker); assert.equal((await save({name:'',phone:'',confirmed_at:confirmed})).ok,true);
      await login(farmer); hidden(await rpc());
      await login(worker); assert.equal((await save({name:'SECRET-revoked',phone:'SECRET-revoked-phone',confirmed_at:null})).ok,true);
      await login(farmer); hidden(await rpc(),'not_confirmed');
    });
    await t.test('migration is repeatable and does not mark existing contacts confirmed', async () => {
      await reset(); await db.exec(migration);
      assert.equal((await db.query('select count(*)::int n from emergency_contacts where confirmed_at is not null')).rows[0].n,0);
      await login(farmer); hidden(await rpc(),'not_confirmed');
    });
  } finally { await db.close(); }
});
