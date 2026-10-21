import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('all migration versions are unique, including historical migrations',async()=>{
 const files=(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql'));
 const versions=new Map();
 for(const file of files){
  assert.match(file,/^\d{14}_.+\.sql$/);
  const version=file.slice(0,14);
  assert.ok(!versions.has(version),`duplicate version ${version}: ${versions.get(version)} / ${file}`);
  versions.set(version,file);
 }
});

test('verified historical migrations retain SQL bytes and applied versions without replay aliases',async()=>{
 const history=JSON.parse(await readFile(new URL('./fixtures/historical-applied-migrations.json',import.meta.url),'utf8'));
 const root=new URL('../supabase/migrations/',import.meta.url),files=await readdir(root);
 assert.equal(history.migrations.length,59,'this snapshot covers the verified historical batch');
 for(const row of history.migrations){
  assert.equal(row.file,`${row.version}_${row.old.slice(15)}`);
  assert.ok(!files.includes(row.old),`old version would replay: ${row.old}`);
  assert.equal(files.filter(f=>f.startsWith(row.version+'_')).length,1);
  assert.equal(createHash('sha256').update(await readFile(new URL(row.file,root))).digest('hex'),row.localSha256,
   `historical SQL must remain unchanged: ${row.file}`);
 }
});

test('input-save migration files match the applied production identifiers and SQL bytes',async()=>{
 const history=JSON.parse(await readFile(new URL('./fixtures/input-save-applied-migrations.json',import.meta.url),'utf8'));
 const root=new URL('../supabase/migrations/',import.meta.url),files=await readdir(root);
 assert.equal(history.migrations.length,14,'this snapshot covers the input-save repair batch');
 for(const row of history.migrations){
  assert.equal(row.file,`${row.version}_${row.name}.sql`);
  assert.equal(files.filter(f=>f.startsWith(row.version+'_')).length,1,`applied version must not collide: ${row.version}`);
  assert.ok(!files.includes(row.old),`old version would replay: ${row.old}`);
  const bytes=await readFile(new URL(row.file,root));
  assert.equal(createHash('md5').update(bytes).digest('hex'),row.md5,`applied SQL must remain unchanged: ${row.file}`);
 }
});
