import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';
export const root = new URL('../../', import.meta.url);
export const s=JSON.parse(await fs.readFile(new URL('scripts/fixtures/authorization/schema.json',root),'utf8'));
export async function createDatabase({patched=true}={}) {
const extra=s.extra;
const db=new PGlite();
const qi=v=>'"'+v.replaceAll('"','""')+'"';
const ql=v=>"'"+v.replaceAll("'","''")+"'";
const name=o=>`${qi(o.schema)}.${qi(o.name)}`;
const errors=[];
const run=async(sql,label)=>{try {await db.exec(sql);return true;}catch(e){errors.push({label,code:e.code,message:e.message});return false;}};
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;create schema net;create schema extensions;create schema storage;
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, metadata jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to anon,authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
set check_function_bodies=off;set timezone='UTC';
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.role() returns text language sql stable as $$select coalesce(auth.jwt()->>'role','anon')$$;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',encrypted_password text,phone text,email_change text,email_change_token_new text,confirmation_token text,recovery_token text,banned_until timestamptz,created_at timestamptz default now(),last_sign_in_at timestamptz);
create table auth.identities(user_id uuid);create table auth.sessions(user_id uuid,id uuid);create table auth.one_time_tokens(user_id uuid);create table auth.mfa_factors(user_id uuid);
create function extensions.uuid_generate_v4() returns uuid language sql as $$select gen_random_uuid()$$;
create function public.uuid_generate_v4() returns uuid language sql as $$select gen_random_uuid()$$;
create table public.qa_outbound(kind text);
create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 1000) returns bigint language plpgsql as $$begin insert into public.qa_outbound values('http_post');return 1;end$$;
`);
for(const x of s.sequences||[]) await run(`create sequence ${qi(x.schemaname)}.${qi(x.sequencename)};`,'sequence '+x.sequencename);
for(const t of s.tables){
 const cols=s.columns.filter(c=>c.schema===t.schema&&c.table===t.name).sort((a,b)=>a.position-b.position);
 await run(`create table ${name(t)} (${cols.map(c=>`${qi(c.name)} ${c.type}${c.identity?` generated ${c.identity==='a'?'always':'by default'} as identity`:''}${c.notnull?' not null':''}`).join(',')});`,'table '+t.name);
}
const deferred=[];for(const f of s.functions){if(/RETURNS SETOF jobs_public/.test(f.def)){deferred.push(f);continue;}await run(f.def,'function '+f.schema+'.'+f.name);}
for(const c of s.columns.filter(c=>c.default))await run(`alter table ${qi(c.schema)}.${qi(c.table)} alter column ${qi(c.name)} set default ${c.default};`,'default '+c.table+'.'+c.name);
for(const c of [...s.constraints].sort((a,b)=>(a.type==='f')-(b.type==='f')))await run(`alter table ${qi(c.schema)}.${qi(c.table)} add constraint ${qi(c.name)} ${c.def};`,'constraint '+c.name);
for(const i of s.indexes) {if(s.constraints.some(c=>c.name===i.indexname))continue;await run(i.indexdef,'index '+i.indexname);}
for(const v of s.views)await run(`create view ${name(v)} ${v.options?`with (${v.options.join(',')})`:''} as ${v.def}`,'view '+v.name);
for(const f of deferred)await run(f.def,'deferred function '+f.name);
for(const t of s.tables){if(t.rls)await db.exec(`alter table ${name(t)} enable row level security;`);if(t.force_rls)await db.exec(`alter table ${name(t)} force row level security;`);}
for(const p of s.policies)await run(`create policy ${qi(p.policyname)} on ${qi(p.schemaname)}.${qi(p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.map(qi).join(',')} ${p.qual?'using ('+p.qual+')':''} ${p.with_check?'with check ('+p.with_check+')':''};`,'policy '+p.policyname);
for(const g of s.grants)await run(`grant ${g.privilege_type} on ${qi(g.table_schema)}.${qi(g.table_name)} to ${qi(g.grantee)};`,'grant '+g.table_name);
for(const g of s.column_grants)await run(`grant ${g.privilege_type} (${qi(g.column_name)}) on ${qi(g.table_schema)}.${qi(g.table_name)} to ${qi(g.grantee)};`,'column grant '+g.table_name);
for(const f of s.functions){const target=`${name(f)}(${f.args})`;await run(`revoke all on function ${target} from public,anon,authenticated;${f.anon?'grant execute on function '+target+' to anon;':''}${f.authenticated?'grant execute on function '+target+' to authenticated;':''}`,'func privilege '+f.name);}
for(const g of extra.schema_grants) await db.exec(`revoke all on schema ${qi(g.schema)} from ${qi(g.role)};${g.usage?`grant usage on schema ${qi(g.schema)} to ${qi(g.role)};`:''}`);
for(const g of extra.sequence_grants)for(const k of ['usage','select','update'])if(g[k])await run(`grant ${k} on sequence ${name(g)} to ${qi(g.role)};`,'seq grant '+g.name);
// Mail bodies in the baseline are stubs; no production rows are loaded.
for(const t of s.triggers)await run(t.def+';'+(t.enabled==='D'?`alter table ${qi(t.schema)}.${qi(t.table)} disable trigger ${qi(t.name)};`:''),'trigger '+t.name);
if(errors.length){await db.close();throw new Error(JSON.stringify(errors));}
if(patched) {
 const files=(await fs.readdir(new URL('supabase/migrations/',root))).filter(f=>f.endsWith('.sql')&&!Object.hasOwn(s.baselineMigrations,f)).sort();
 for(const file of files) await db.exec(await fs.readFile(new URL('supabase/migrations/'+file,root),'utf8'));
}
return db;
}
