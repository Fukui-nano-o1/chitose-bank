export const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const farmer=uid(1),worker=uid(2),other=uid(3),admin=uid(4),withdrawn=uid(5);

export async function login(db,who,role='authenticated',email='qa@example.invalid',metadata={}){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[who,JSON.stringify({sub:who,email,role,user_metadata:metadata})]);await db.exec(`set role ${role}`);}
export async function seed(db){await db.exec(`set session_replication_role=replica;
insert into auth.users(id,email) values('${farmer}','farmer@example.invalid'),('${worker}','worker@example.invalid'),('${other}','other@example.invalid'),('${admin}','admin@example.invalid'),('${withdrawn}','withdrawn@example.invalid');
insert into app_admins(auth_id) values('${admin}');
insert into account_holders(auth_id,full_name,postal_code,address,birth_date,entity_type,agreed_terms_version,agreed_privacy_version,contact_email)
select id,'架空会員','0000000','架空住所','2000-01-01','individual','test','qa',email from auth.users;
insert into worker_profiles(auth_id,nickname) values('${worker}','架空働き手');
insert into employer_profiles(auth_id,nickname) values('${farmer}','架空求人者');
insert into emergency_contacts(auth_id) values('${worker}');
insert into jobs(id,farmer_id,job_number,status,crop,task,date_start,date_end,headcount,perks,insurance_snapshot,recruiter_name,recruiter_address,recruiter_contact,pay_method,pay_timing,wage_closing_rule)
select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,case when n=11 then '${other}'::uuid else '${farmer}'::uuid end,n,'open','野菜','収穫',current_date+10,current_date+10,1,'{}','{}','架空求人者','架空住所','qa@example.invalid','cash','same_day_after_work','each_workday' from generate_series(10,20) n;
insert into applications(id,job_number,worker_id,farmer_id,status,terms_confirmed_worker_at,work_completed_at,attended,agreed_dates)
select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,n-90,'${worker}','${farmer}',case n when 100 then 'approved' when 102 then 'canceled' when 103 then 'expired' when 104 then 'rejected' when 105 then 'completed' else 'approved' end,now(),case when n=105 then now()-interval '10 days' else null end,case when n=105 then false else true end,case when n=105 then jsonb_build_array((current_date-10)::text) else jsonb_build_array((current_date+10)::text) end from generate_series(100,110) n;
insert into messages(id,application_id,sender_id,body) values('${id(200)}','${id(100)}','${farmer}','架空本文');
insert into admin_messages(id,user_id,from_admin,body) values('${id(201)}','${worker}',true,'架空運営本文'),('${id(202)}','${worker}',false,'架空本人本文');
insert into records(id,farmer_id,year,month,dest_id,boxes,ppb) values('${id(203)}','${farmer}',2026,0,'fixture',1,1);
insert into feedback(id,reporter_id,page_hash,category,body) values('${id(204)}','${worker}','/qa','broken','架空問合せ');
insert into notifications(id,farmer_id,type,message) values('${id(205)}','${worker}','qa','架空通知');
insert into attendance_events(id,application_id,actor_id,kind) values('${id(206)}','${id(100)}','${worker}','late');
insert into reviews(id,application_id,reviewer_id,reviewee_id,direction) values('${id(207)}','${id(100)}','${worker}','${farmer}','worker_to_farmer');
set session_replication_role=origin;`);}
