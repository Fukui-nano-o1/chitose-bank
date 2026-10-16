// Diagnostic reproductions of KNOWN DEFECTS, not product acceptance tests.
// Success means the bad outcome is still reproducible. Never run against production.
// Uses exact handler bodies parsed from source; React rendering and RLS are not simulated.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';
import { source, nodes, namedFunction, firstEffect } from './audit-input-paths.mjs';
import { uploadJobPhoto } from '../src/lib/image.js';
import { jobFormFromRow, jobPayloadFromForm } from '../src/features/jobs/create/jobInputCodec.js';
import { jobInputSample, jobInputOptions } from './fixtures/job-input.js';

const results = [];
const clone = x => JSON.parse(JSON.stringify(x));
const failure = { message: 'Injected failure', code: 'AUDIT_FAILURE' };
const auth = { getSession: async () => ({ data: { session: { user: { id: 'audit-user', email: 'audit@example.invalid' } } } }) };
function context(extra = {}) {
  const alerts = [], timers = [];
  const ctx = vm.createContext({ alert: text => alerts.push(text), setTimeout: fn => { timers.push(fn); },
    console, Date, Object, Array, String, Number, Set, Promise, ...extra });
  return { ctx, alerts, timers, run: code => vm.runInContext(`(${code})`, ctx) };
}
function bind(h, file, name) { return h.run(namedFunction(file, name)); }
function state(h, key, value, setter = 'set' + key[0].toUpperCase() + key.slice(1)) {
  h.ctx[key] = value;
  h.ctx[setter] = next => { h.ctx[key] = typeof next === 'function' ? next(h.ctx[key]) : next; };
}
async function record(id, name, fn) { await fn(); results.push({ id, name, result: 'DEFECT_REPRODUCED' }); }
const employer = 'src/components/EmployerProfileEdit.jsx', worker = 'src/components/WorkerProfileEdit.jsx';

await record('A00','legacy sync-farmer handler writes using admin client without authentication',async()=>{
  let written,statusCode,response;
  const h=context({getClientIp:()=>null,admin:{from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:'audit-farmer'},error:null})})}),
    upsert:async row=>{written=clone(row);return {error:null};},insert:async()=>({error:null})})}});
  const res={setHeader:()=>{},status:n=>{statusCode=n;return res;},json:body=>{response=body;}};
  await bind(h,'api/sync-farmer.js','handler')({method:'POST',headers:{},body:{email:'audit@example.invalid',name:'Changed without authentication'}},res);
  assert.equal(statusCode,200);assert.equal(response.status,'ok');assert.equal(written.name,'Changed without authentication');
});

for (const [file, folder] of [[employer,'employer'], [worker,'worker']]) {
  for (const mode of ['upload-failure','db-failure','delete-db-failure']) {
    await record('A01/A02', `${folder}: ${mode}`, async () => {
      const old = `${folder}/audit-user/old.png`, stored = new Set([old]);
      const h = context({ avatarDir: folder, table: 'employer_profiles', nickname: 'audit', onAvatarChange: () => {},
        convertToJpeg: async f => f, uploadAvatarResilient: async () => {
          if (mode === 'upload-failure') return failure;
          stored.add(`${folder}/audit-user/avatar.jpg`); return null;
        }, supabase: { auth, from: () => ({ upsert: async () => ({ error: failure }) }), storage: { from: () => ({
          list: async () => ({ data: [{ name: 'old.png' }] }), remove: async paths => { paths.forEach(p => stored.delete(p)); return { error: null }; },
          getPublicUrl: p => ({ data: { publicUrl: `https://audit.invalid/${p}` } }),
        }) } } });
      state(h,'avatarUrl',old); state(h,'uploading',false);
      await bind(h,file,mode === 'delete-db-failure' ? 'handleDeleteAvatar' : 'handleAvatar')({ target: { files: [{ name: 'new.jpg', type: 'image/jpeg' }] } });
      assert.equal(stored.has(old),false,'old image deleted');
      if (mode !== 'upload-failure') { assert.notEqual(h.ctx.avatarUrl,old,'UI diverges from unchanged DB'); assert.equal(h.alerts.length,0); }
      else assert.equal(h.alerts.length,1);
    });
  }
}

await record('A02','avatar helper mistakes an old surviving file for this upload success',async()=>{
  let attempts=0;
  const h=context({setTimeout:fn=>fn(),supabase:{storage:{from:()=>({upload:async()=>{attempts++;return {error:failure};},list:async()=>({data:[{name:'avatar.jpg'}],error:null})})}}});
  const error=await bind(h,'src/lib/avatarUpload.js','uploadAvatarResilient')('worker/audit-user',{});
  assert.equal(attempts,2);assert.equal(error,null,'neither upload succeeded; existence alone clears the error');
});

await record('A05','job photo retry after lost response creates two objects',async () => {
  const objects = new Set(); let lost = true;
  const client = { auth, storage: { from: () => ({ upload: async p => { objects.add(p); if (lost) { lost=false; throw new TypeError('response lost'); } return { error:null }; }, getPublicUrl: p => ({ data:{ publicUrl:`https://audit.invalid/${p}` } }) }) } };
  const file = { name:'photo.jpg',type:'image/jpeg' };
  await assert.rejects(uploadJobPhoto(client,file,{withThumb:false}));
  const retried = await uploadJobPhoto(client,file,{withThumb:false});
  assert.equal(objects.size,2); assert.ok(retried.url);
});

await record('A10','failed unlike deletes the visible row without rollback',async () => {
  const row = { job_number:12, liked:true };
  const query = { eq: () => query, then: resolve => resolve({ error:failure }) };
  const h = context({ me:{ id:'audit-user' }, supabase:{ from:()=>({ delete:()=>query }) } });
  state(h,'rows',[row]); state(h,'undoJob',null);
  await bind(h,'src/components/SavedJobsView.jsx','handleUnsave')(row);
  assert.equal(h.ctx.rows.length,0); assert.equal(h.alerts.length,0);
});

await record('A09','lost attendance response then retry inserts two records',async () => {
  const records=[]; let first=true; let done=0;
  const h=context({ app:{id:'audit-application'}, kind:'late', needsDetail:false, detail:'', reason:'audit', day:'2026-10-16', meId:'audit-user',
    fbError:()=>{},fbSuccess:()=>{},onDone:()=>done++,supabase:{from:()=>({insert:async row=>{records.push(clone(row));if(first){first=false;return {error:failure};}return {error:null};}})} });
  state(h,'submitting',false);
  const submit=bind(h,'src/components/DayReportSheet.jsx','submit');await submit();await submit();
  assert.equal(records.length,2);assert.equal(done,1);assert.deepEqual(records[0],records[1]);assert.equal(records[0].id,undefined);
});

await record('A08','registration committed with lost response is stuck at duplicate on retry',async()=>{
  let exists=false,done=0;
  const h=context({canSubmit:true,sess:{},fullName:'Audit',birthDateStr:'2000-01-01',postalCode:'0000000',addressAuto:'audit',addressDetail:'1',entityType:'individual',companyName:'',companyNumber:'',TERMS_VERSION:'audit',PRIVACY_VERSION:'audit',onDone:()=>done++,onSessionExpired:()=>{},
    supabase:{auth,from:()=>({insert:async()=>{if(exists)return {error:{code:'23505',message:'duplicate'}};exists=true;return {error:failure};}})} });
  state(h,'busy',false);state(h,'err','');
  const submit=bind(h,'src/components/AccountHolderForm.jsx','submit');await submit();await submit();
  assert.equal(exists,true);assert.equal(done,0);assert.match(h.ctx.err,/duplicate/);
});

function workerHarness(db, readFails=false) {
  const h=context({supabase:{auth,from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>readFails?{data:null,error:failure}:{data:clone(db),error:null}})}),upsert:async row=>{Object.assign(db,clone(row));return {error:null};}})},
    getCache:()=>null,snapGet:()=>null,setCache:()=>{},snapSet:()=>{},promotePendingApplications:async()=>0,
    onAvatarChange:()=>{},logSaveError:e=>{throw new Error(e);},onDone:()=>{},
    approvedRef:{current:{pr:'',pr_qa:[]}},pendingRef:{current:{}},editBoxOpenedRef:{current:false} });
  for(const key of ['nickname','pr','avatarUrl','residenceCity','transport','farmExperience','physicalLevel','workMood','learningPref','workPattern'])state(h,key,'');
  for(const key of ['prQa','interests','languages','selfDeclared','expEntries','experiencedTasks','revTargets'])state(h,key,[]);
  for(const key of ['saving','saved','savedInReview'])state(h,key,false);state(h,'loading',true);
  h.ctx.applyRow=bind(h,worker,'applyRow');
  h.load=async()=>{h.run(firstEffect(worker,'WorkerProfileEdit'))();for(let i=0;i<20&&h.ctx.loading;i++)await Promise.resolve();assert.equal(h.ctx.loading,false);};
  h.save=bind(h,worker,'save');return h;
}
await record('A03','two worker profile editors silently overwrite a different field',async()=>{
  const db={nickname:'Audit',transport:'car',residence_city:'old city',pr:'',pr_qa:[]};
  const a=workerHarness(db),b=workerHarness(db);await a.load();await b.load();
  a.ctx.transport='bicycle';await a.save();assert.equal(db.transport,'bicycle');
  b.ctx.residenceCity='new city';await b.save();assert.equal(db.transport,'car');assert.equal(db.residence_city,'new city');
  assert.equal(a.alerts.length+b.alerts.length,0);
});
await record('A04','failed initial worker read permits saving blanks over existing data',async()=>{
  const db={nickname:'Audit',transport:'car',residence_city:'old city',pr:'existing text',pr_qa:[],interests:['hiking']};
  const h=workerHarness(db,true);await h.load();h.ctx.nickname='Audit renamed';await h.save();
  assert.equal(db.transport,'');assert.equal(db.residence_city,'');assert.deepEqual(db.interests,[]);assert.equal(h.ctx.saved,true);
});

for(const [file,component,readValues,expected] of [
  ['src/components/WorkerExperiencePage.jsx','WorkerExperiencePage',{experience_entries:[{crop:'crop'}],self_declared:['license'],experienced_tasks:['harvest']},'experience_entries'],
  ['src/components/InsurancePrepBox.jsx','InsurancePrepBox',{insurance_items:['workers_comp'],insurance_notes:{workers_comp:'note'}},'insurance_items'],
])await record('A04',`${component}: failed read followed by save erases stored selections`,async()=>{
  const db=clone(readValues);
  const h=context({supabase:{auth,from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:failure})})}),upsert:async row=>{Object.assign(db,clone(row));return {error:null};}})},onSaved:()=>{}});
  for(const key of ['expEntries','selfDeclared','experiencedTasks','items'])state(h,key,[]);state(h,'notes',{});
  state(h,'loading',true);state(h,'saving',false);state(h,'saved',false);
  h.run(firstEffect(file,component))();for(let i=0;i<20&&h.ctx.loading;i++)await Promise.resolve();assert.equal(h.ctx.loading,false);
  await bind(h,file,'save')();assert.deepEqual(db[expected],[]);assert.equal(h.ctx.saved,true);
});

await record('A06','two concurrent danger uploads exceed the two-photo display limit',async()=>{
  const file='src/features/jobs/create/components/StepDanger.jsx',tree=source(file);
  const handler=nodes(tree,n=>ts.isJsxAttribute(n)&&n.name.getText(tree)==='onChange'&&n.initializer?.getText(tree).includes('Promise.all'))[0].initializer.expression;
  const h=context({place:{photos:[]},i:0,uploadPhoto:async f=>({url:f.name})});state(h,'jobDangerPlaces',[{photos:[]}]);
  const add=h.run(handler.getText(tree));
  await Promise.all([add({target:{files:[{name:'a'},{name:'b'}]}}),add({target:{files:[{name:'c'},{name:'d'}]}})]);
  assert.equal(h.ctx.jobDangerPlaces[0].photos.length,4);
});

await record('A14','null work time changes to default hours on load/save',async()=>{
  const tree=source('src/features/jobs/create/LandingFlow.jsx'),defaults={};
  for(const key of ['startHour','startMinute','endHour','endMinute']){
    const decl=nodes(tree,n=>ts.isVariableDeclaration(n)&&n.name.getText(tree).startsWith(`[${key},`))[0];
    defaults[key]=decl.initializer.arguments[0].right.text;
  }
  const form={...defaults,...jobFormFromRow({...jobInputSample(),work_time:null},jobInputOptions)};
  assert.equal(jobPayloadFromForm(form,{ownerId:'audit-user',status:'draft'}).work_time,'8:00〜16:00');
});

await record('A12','help image delete: DB rejection leaves its URL pointing at a removed object',async()=>{
  const objects=new Set(['slot.jpg']);
  const h=context({confirm:()=>true,helpImagePathFromUrl:()=> 'slot.jpg',supabase:{
    storage:{from:()=>({remove:async paths=>{paths.forEach(p=>objects.delete(p));return {error:null};}})},
    from:()=>({delete:()=>({eq:async()=>({error:failure})})}),
  }});state(h,'images',{slot:'https://audit.invalid/slot.jpg'});
  await bind(h,'src/app/help/HelpCenter.jsx','deleteSlotImage')('slot');
  assert.equal(objects.size,0);assert.ok(h.ctx.images.slot);assert.equal(h.alerts.length,1);
});

await record('A11','consignment reports success while canonical phone remains unsaved',async()=>{
  let draftRemoved=false,profile;
  const model=source('src/features/consignment/model.js');
  const strip=nodes(model,n=>ts.isVariableDeclaration(n)&&n.name.getText(model)==='stripConsignorIdentity')[0];
  const keys=nodes(model,n=>ts.isVariableDeclaration(n)&&n.name.getText(model)==='CONSIGNOR_IDENTITY_KEYS')[0];
  const h=context({ctype:'individual',d:{ind_phone:'0000000000'},ahInfo:{},localStorage:{removeItem:()=>{draftRemoved=true;}},
    supabase:{auth,rpc:async()=>({data:null,error:failure}),from:()=>({upsert:async row=>{profile=clone(row);return {error:null};}})} });
  h.ctx.CONSIGNOR_IDENTITY_KEYS=h.run(keys.initializer.getText(model));
  if(strip)h.ctx.stripConsignorIdentity=h.run(strip.initializer.getText(model));
  else h.ctx.stripConsignorIdentity=bind(h,'src/features/consignment/model.js','stripConsignorIdentity');
  state(h,'saving',false);state(h,'saved',false);state(h,'ahInfo',{});
  await bind(h,'src/features/consignment/editor/ConsignorInfoEdit.jsx','save')();
  assert.equal(h.ctx.saved,true);assert.equal(draftRemoved,true);assert.equal(h.alerts.length,0);
  assert.equal(profile.consignor_data.ind_phone,'0000000000');assert.equal(h.ctx.ahInfo.contact_phone,undefined);
});

await record('A07/A16','real copy_job SQL duplicates retries and drops newer input columns',async()=>{
  const db=new PGlite();
  try{
    const sample={...jobInputSample(),farmer_id:'00000000-0000-4000-8000-000000000001',status:'draft',full_pay_guarantee:true};
    const columns=Object.entries(sample).map(([k,v])=>`"${k}" ${k==='farmer_id'?'uuid':Array.isArray(v)||typeof v==='object'?'jsonb':typeof v==='boolean'?'boolean':typeof v==='number'?'numeric':'text'}`).join(',');
    await db.exec(`create schema auth;create function auth.uid() returns text language sql as $$ select '00000000-0000-4000-8000-000000000001'::text $$;create table jobs(id uuid default gen_random_uuid() primary key,job_number serial,${columns});`);
    const entries=Object.entries(sample);await db.query(`insert into jobs(${entries.map(([k])=>`"${k}"`).join(',')}) values(${entries.map((_,i)=>'$'+(i+1)).join(',')})`,entries.map(([,v])=>typeof v==='object'?JSON.stringify(v):v));
    const sql=fs.readFileSync(new URL('../supabase/migrations/20260816033347_copy_job_always_reset_dates.sql',import.meta.url),'utf8');
    await db.exec(sql);
    const a=(await db.query('select copy_job(1) result')).rows[0].result;
    const b=(await db.query('select copy_job(1) result')).rows[0].result;
    assert.equal(a.ok,true);assert.equal(b.ok,true);assert.notEqual(a.job_number,b.job_number);
    for(const field of ['place_change_scope','task_change_scope','work_video_url','work_video_job_consent','work_video_consent_at','work_video_consent_version'])assert.equal(a.job[field],null,field);
    assert.equal(a.job.crop,sample.crop);assert.equal(a.job.date_start,null,'intentional date reset is separate from lost fields');
  }finally{await db.close();}
});

await record('A15','terms confirmation succeeds while the automatic chat message fails silently',async()=>{
  let confirmCount=0,chatCount=0;
  const h=context({activeAppId:'audit',isWorkerSide:true,appIds:['audit'],chatDeadline:x=>x,load:async()=>{},
    supabase:{auth,rpc:async()=>{confirmCount++;return {data:{ok:true,worker_confirmed:true},error:null};},from:()=>({insert:async()=>{chatCount++;return {error:failure};}})} });
  state(h,'confirmingTerms',false);state(h,'workerConfirmed',false);
  await bind(h,'src/components/ChatView.jsx','confirmTerms')();assert.equal(confirmCount,1);assert.equal(chatCount,1);assert.equal(h.ctx.workerConfirmed,true);assert.equal(h.alerts.length,0);
});

console.log(JSON.stringify({ warning:'These are reproduced defects, NOT product passes. Handler-level mocks; no real network or production writes.', cases:results.length, results },null,2));
