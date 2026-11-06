import { JOB_DRAFT_FIELDS } from '../../src/lib/jobInputFields.js';

// Synthetic schema shared by PGlite and real PostgreSQL CI. Never production data.
export function legacyJobFlagsSchema({farmer,worker,nextWorker,stranger}) {
  const types={headcount:'integer',draft_step:'integer',lat:'numeric',lng:'numeric',geo_radius_m:'integer',date_start:'date',date_end:'date',
      holidays:'jsonb',perks:'jsonb',danger_places:'jsonb',danger_tasks:'jsonb',photos:'jsonb',beginner_ok:'boolean',instant_approve_repeat:'boolean',experienced_preferred:'boolean',
      work_video_job_consent:'boolean',work_video_related_consent:'boolean',work_video_consent_at:'timestamptz'};
  return `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      create function auth.role() returns text language sql stable as $$select current_user::text$$;
      grant usage on schema auth to public;
      create table jobs(id uuid primary key default gen_random_uuid(),job_number serial unique,farmer_id uuid not null,status text not null default 'draft',
        full_pay_guarantee boolean,draft_step_id text,created_at timestamptz default now(),opened_at timestamptz,unlisted_reason text,
        recruiter_name text,recruiter_address text,recruiter_contact text,insurance_snapshot jsonb,profile_snapshot_at timestamptz,
        pay_method text,pay_timing text,wage_closing_rule text,contract_renewal text,retirement_terms text,labor_insurance_status text,
        ${JOB_DRAFT_FIELDS.map(k=>`${k} ${types[k]||'text'}`).join(',')});
      create table applications(id uuid primary key default gen_random_uuid(),job_number integer,farmer_id uuid,worker_id uuid,status text,
        available_dates jsonb,agreed_dates jsonb,decided_at timestamptz,terms_confirmed_worker_at timestamptz,terms_confirmed_farmer_at timestamptz);
      create unique index apps_unique on applications(job_number,worker_id) where status <> 'canceled';
      create table repeat_roster(farmer_id uuid,worker_id uuid,notify boolean default true);
      create table notifications(id bigint generated always as identity,farmer_id uuid,type text,message text);
      create table messages(id bigint generated always as identity,application_id uuid,sender_id uuid,body text);
      create table qa_mail(id bigint generated always as identity,recipient uuid,subject text,body text,html text);
      create table account_holders(auth_id uuid);
      create table app_settings(key text,value text);
      create table worker_profiles(auth_id uuid,nickname text,pr text,avatar_url text);
      create table employer_profiles(auth_id uuid,nickname text,avatar_url text);
      create table job_questions(job_number integer,answer text,hidden boolean);
      create function is_account_moderated(uuid) returns boolean language sql as $$select false$$;
      create function is_job_party(integer) returns boolean language sql security definer set search_path='' as $$select exists(select 1 from public.jobs j where j.job_number=$1 and j.farmer_id=auth.uid()) or exists(select 1 from public.applications a where a.job_number=$1 and a.worker_id=auth.uid())$$;
      create function is_worker_profile_ready(uuid) returns boolean language sql as $$select true$$;
      create function private.can_read_meeting_address(integer) returns boolean language sql as $$select false$$;
      grant usage on schema private to anon,authenticated;
      create function notify_admins(text,text) returns void language sql as $$select$$;
      create function job_ref(integer,text) returns text language sql as $$select 'job '||$1::text$$;
      create function job_link(integer) returns text language sql as $$select ' /job/'||$1::text$$;
      create function h(text) returns text language sql as $$select $1$$;
      create function send_user_email(uuid,text,text,text default null) returns bigint language plpgsql as $$
        declare n bigint;begin insert into qa_mail(recipient,subject,body,html) values($1,$2,$3,$4) returning id into n;return n;end$$;
      alter table jobs enable row level security;alter table applications enable row level security;alter table repeat_roster enable row level security;
      grant all on jobs,applications,repeat_roster to anon,authenticated,service_role;
      grant usage,select on all sequences in schema public to anon,authenticated,service_role;
      create policy "app farmer select" on applications for select using(auth.uid()=farmer_id);
      create policy "app worker select" on applications for select using(auth.uid()=worker_id);
      create policy "jobs admin write" on jobs for all to authenticated using(auth.jwt()->>'email'='admin@example.invalid') with check(auth.jwt()->>'email'='admin@example.invalid');
      create policy own_jobs on jobs for select using(auth.uid()=farmer_id);
      create policy own_draft_update on jobs for update using(auth.uid()=farmer_id and status in ('draft','pending')) with check(auth.uid()=farmer_id and status in ('draft','pending'));
      create policy own_draft_insert on jobs for insert with check(auth.uid()=farmer_id and status in ('draft','pending'));
      create policy own_roster on repeat_roster for all using(auth.uid()=farmer_id) with check(auth.uid()=farmer_id and not is_account_moderated(auth.uid()));
      create policy worker_roster on repeat_roster for select to authenticated using(auth.uid()=worker_id);
      grant select on job_questions to authenticated;
      insert into jobs(job_number,farmer_id,status,beginner_ok,instant_approve_repeat,experienced_preferred,date_start,headcount,address,town,lat,lng,work_video_url,work_video_job_consent)
        values(10,'${farmer}','open',true,true,true,'2099-01-01',10,'hidden address','hidden town',34.123,134.456,'unconsented',false),
              (11,'${farmer}','draft',true,true,false,'2099-01-02',10,null,null,null,null,null,null);
      select setval('jobs_job_number_seq',20);
      insert into account_holders values('${farmer}'),('${worker}'),('${nextWorker}'),('${stranger}');
      insert into repeat_roster values('${farmer}','${worker}',true),('${farmer}','${nextWorker}',true);
  `;
}

export const legacyJobFlagsRuntime = `revoke all on function apply_to_job(integer,jsonb),approve_application(uuid,boolean),copy_job(integer),my_farm_jobs() from public,anon,authenticated,service_role;
      grant execute on function apply_to_job(integer,jsonb),approve_application(uuid,boolean),my_farm_jobs() to authenticated,service_role;
      grant execute on function copy_job(integer) to service_role;
      grant execute on function trg_instant_approve(),trg_notify_application(),trg_notify_roster() to anon,authenticated,service_role;
      grant select on jobs_public to anon,authenticated;
      create trigger instant_approve after insert on applications for each row execute function trg_instant_approve();
      create trigger notify_application after insert on applications for each row execute function trg_notify_application();
      create trigger notify_roster after update on jobs for each row execute function trg_notify_roster();`;
