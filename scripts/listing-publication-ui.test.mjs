import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { jobInputSample } from './fixtures/job-input.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const owner='00000000-0000-4000-8000-000000000001';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label) {const end=Date.now()+5000;while(!fn()){assert.ok(Date.now()<end,`timed out: ${label}`);await pause(10);}}
const initialForm=()=>({role:'farmer',farmerStep:4,farmerCropPill:'ブロッコリー',farmerTaskPill:'収穫',farmerPurpose:'post',
  farmerZip:'7793401',farmerPref:'徳島県',farmerCity:'吉野川市',farmerTown:'山川町',farmerAddr:'123番地',
  jobDateStart:'2026-11-01',jobDateEnd:null,jobHolidays:[],jobCount:'',dailyWageInput:'10000',breakTime:'60分',
  overtimePolicy:'なし',jobDescription:'保持する説明',workVideoUrl:''});
const dbRow=(extra={})=>({...jobInputSample(),id:'00000000-0000-4000-8000-000000000042',job_number:42,farmer_id:owner,status:'draft',draft_step:4,draft_step_id:'schedule',...extra});

test('stage 5 real listing: recruiter pages, review returns and explicit publication',async t=>{
  const output=await mkdtemp(path.join(tmpdir(),'cb-listing-schedule-'));let dom;
  const errors=[];
  try {
    await build({configFile:false,root,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
      name:'listing-schedule-fixture',enforce:'pre',resolveId(id){if(/(?:^|\/)supabase(?:\.js)?$/.test(id)||/(?:jobCreateGeo|lib\/zipLookup)(?:\.js)?$/.test(id))return path.join(root,'scripts/fixtures/offline/client.js');},
    },react()],build:{outDir:output,lib:{entry:path.join(root,'scripts/fixtures/offline/entry.jsx'),name:'ScheduleQA',formats:['iife'],fileName:'fixture'},minify:false}});
    const script=await readFile(path.join(output,'fixture.iife.js'),'utf8');
    async function mount({url='https://ui.test/#/work/new/page/schedule',form,storage={},session={},job=null,offline=true,minimumWage=1100,profile=null,profileReadError=false,profileWriteError=false,registration=null}={}) {
      dom?.window.close();const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Could not load|Not implemented: navigation/.test(e.message))errors.push(e.message);});
      dom=new JSDOM('<div id="root"></div>',{url,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});
      const w=dom.window;w.Response=Response;w.Request=Request;w.Headers=Headers;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
      w.fetch=()=>Promise.reject(new Error('No live requests'));w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
      w.scrollTo=()=>{};w.HTMLElement.prototype.scrollTo=function(x,y){this.scrollTop=typeof x==='object'?x.top:y;};
      w.ResizeObserver=class{observe(){}disconnect(){}unobserve(){}};w.IntersectionObserver=class{observe(){}disconnect(){}unobserve(){}};
      w.alert=m=>errors.push(m);w.confirm=()=>true;w.qaOffline=offline;w.qaConsent=true;w.qaJob=job;w.qaListingForm=form;w.qaMinimumWage=minimumWage;w.qaProfile=profile;w.qaProfileReadError=profileReadError;w.qaProfileWriteError=profileWriteError;w.qaRegistration=registration;
      for(const[k,v]of Object.entries(storage))w.localStorage.setItem(k,v);for(const[k,v]of Object.entries(session))w.sessionStorage.setItem(k,v);
      w.eval(script);await until(()=>w.document.querySelector('[data-step-id],#listing-workplace-form')||/再開するページを確認できません|保存した求人を読み込めませんでした/.test(w.document.body.textContent),'initial listing');return w;
    }
    const q=(w,s)=>w.document.querySelector(s);
    const button=(w,label)=>{const b=[...w.document.querySelectorAll('button')].find(x=>x.textContent.trim()===label);assert.ok(b,`button: ${label}`);return b;};
    const page=async(w,id)=>{await until(()=>q(w,'[data-step-id]')?.dataset.stepId===id,`page ${id}`);await pause(180);};
    const next=async(w,id)=>{button(w,'次へ').click();await page(w,id);};
    const storage=w=>Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]));
    const record=w=>w.qaDrafts.listDeviceDrafts(owner)[0];
    const _setCount=async(w,value)=>{const input=q(w,'#listing-headcount');assert.ok(input);Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new w.Event('input',{bubbles:true}));await until(()=>record(w)?.form.jobCount===value,'count persisted');};

    const topics=['task','task_scope','workplace','place_scope','access','work_time','break_time','overtime','daily_wage'];
    const plain=v=>JSON.parse(JSON.stringify(v));
    const route=async(w,id,scope='work/new')=>{w.location.hash=`/${scope}/page/${id}`;await page(w,id);};
    const input=async(w,selector,value)=>{const el=q(w,selector);assert.ok(el,selector);const proto=el.tagName==='TEXTAREA'?w.HTMLTextAreaElement.prototype:el.tagName==='SELECT'?w.HTMLSelectElement.prototype:w.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new w.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));await pause(35);};
    const form=()=>({...initialForm(),farmerStep:5,jobCount:'3',startHour:'8',startMinute:'00',endHour:'16',endMinute:'00',taskChangeScope:'変更なし',placeChangeScope:'変更なし',nearestStation:'山瀬',commuteTime:'車10分以内'});


    const registered={auth_id:owner,nickname:'登録農園',recruiter_name:'登録農園',recruiter_address:'登録住所',recruiter_contact:'000-0000',smoking_policy:'敷地内禁煙'};
    const writes=w=>w.qaCalls.filter(call=>call.path==='employer_profiles' && call.body);
    const publications=w=>w.qaCalls.filter(call=>call.path==='rpc/publish_my_job_with_check');
    const ready=async(w)=>{await until(()=>!w.document.body.textContent.includes('登録情報を確認しています'),'profile read');await pause(60);};
    await t.test('normal input visits only missing recruiter page and does not publish on profile save',async()=>{
      const w=await mount({url:'https://ui.test/#/work/new/page/repeat_approval',form:form(),offline:false,profile:{...registered,recruiter_contact:''}});
      await ready(w);button(w,'確認へ').click();await page(w,'recruiter_contact');
      assert.equal(q(w,'#listing-recruiter_name'),null);assert.equal(q(w,'#listing-recruiter_address'),null);
      await input(w,'#listing-recruiter_contact','088-111-2222');button(w,'保存して次へ').click();await page(w,'review');
      assert.equal(w.qaProfile.recruiter_contact,'088-111-2222');assert.equal(writes(w).length,1);
      assert.deepEqual(Object.keys(writes(w)[0].body).sort(),['auth_id','recruiter_contact','updated_at']);assert.equal(publications(w).length,0);
    });
    await t.test('three recruiter questions use separate pages and retain edited values across browser reload',async()=>{
      let w=await mount({url:'https://ui.test/#/work/new/page/recruiter_name',form:form(),offline:false,profile:{...registered,recruiter_name:'',recruiter_address:'',recruiter_contact:''}});
      await ready(w);await input(w,'#listing-recruiter_name','保持する募集者名');const saved=storage(w);
      w=await mount({url:'https://ui.test/#/work/new/page/recruiter_name',storage:saved,offline:false,profile:{...registered,recruiter_name:'',recruiter_address:'',recruiter_contact:''}});
      await ready(w);assert.equal(q(w,'#listing-recruiter_name').value,'保持する募集者名');
      button(w,'保存して次へ').click();await page(w,'recruiter_address');
      await input(w,'#listing-recruiter_address','入力した住所');button(w,'保存して次へ').click();await page(w,'recruiter_contact');
      await input(w,'#listing-recruiter_contact','088-123-4567');button(w,'保存して次へ').click();await page(w,'review');
      assert.equal(w.qaProfile.recruiter_name,'保持する募集者名');assert.equal(w.qaProfile.recruiter_address,'入力した住所');assert.equal(publications(w).length,0);
      assert.equal(record(w).payload.photos.length,0);assert.equal(Object.hasOwn(record(w).payload,'recruiter_name'),false);
    });
    await t.test('profile write denial keeps input and route; explicit retry verifies the stored field before returning',async()=>{
      const w=await mount({url:'https://ui.test/#/work/new/page/recruiter_name?return=review',form:form(),offline:false,profile:registered,profileWriteError:true});
      await ready(w);await input(w,'#listing-recruiter_name','保存する名称');button(w,'保存して確認に戻る').click();
      await until(()=>/募集者情報の保存を確認できませんでした/.test(w.document.body.textContent),'visible failed save');
      assert.equal(q(w,'[data-step-id]').dataset.stepId,'recruiter_name');assert.equal(q(w,'#listing-recruiter_name').value,'保存する名称');
      assert.equal(record(w).form.listingRecruiterDraft.recruiter_name.value,'保存する名称');assert.equal(publications(w).length,0);
      w.qaProfileWriteError=false;button(w,'保存して確認に戻る').click();await page(w,'review');assert.equal(w.qaProfile.recruiter_name,'保存する名称');
    });
    await t.test('a lost profile response is reconciled by read without duplicate profile write or publication',async()=>{
      const w=await mount({url:'https://ui.test/#/work/new/page/recruiter_address?return=review',form:form(),offline:false,profile:registered});await ready(w);
      await input(w,'#listing-recruiter_address','応答紛失でも残る住所');w.qaLoseProfileResponse=true;button(w,'保存して確認に戻る').click();await page(w,'review');
      assert.equal(writes(w).length,1);assert.equal(w.qaProfile.recruiter_address,'応答紛失でも残る住所');assert.equal(w.qaProfile.recruiter_contact,registered.recruiter_contact);assert.equal(publications(w).length,0);
    });
    await t.test('conflicting profile field is not overwritten and selecting latest is explicit',async()=>{
      const w=await mount({url:'https://ui.test/#/work/new/page/recruiter_name?return=review',form:form(),offline:false,profile:registered});await ready(w);
      await input(w,'#listing-recruiter_name','この画面の入力');w.qaProfile={...registered,recruiter_name:'他の画面の変更'};
      button(w,'保存して確認に戻る').click();await until(()=>/別の操作で変更/.test(w.document.body.textContent),'conflict visible');
      assert.equal(writes(w).length,0);assert.equal(q(w,'#listing-recruiter_name').value,'この画面の入力');
      button(w,'最新の登録内容を使う').click();await until(()=>q(w,'#listing-recruiter_name').value==='他の画面の変更','explicit latest');
    });
    await t.test('changed session cannot save recruiter data under another owner',async()=>{
      const w=await mount({url:'https://ui.test/#/work/new/page/recruiter_contact',form:form(),offline:false,profile:registered});await ready(w);
      await input(w,'#listing-recruiter_contact','088-777-8888');w.qaSessionOwner='00000000-0000-4000-8000-000000000099';button(w,'保存して次へ').click();
      await until(()=>/ログイン状態を確認できません/.test(w.document.body.textContent),'auth failure visible');assert.equal(writes(w).length,0);assert.equal(publications(w).length,0);
    });
    await t.test('registration data is only copied on request and still needs explicit profile save',async()=>{
      const w=await mount({url:'https://ui.test/#/work/new/page/recruiter_name',form:form(),offline:false,profile:{...registered,recruiter_name:''},registration:{full_name:'登録時の名称'}});await ready(w);
      assert.equal(q(w,'#listing-recruiter_name').value,'');button(w,'新規登録の情報から入力').click();await until(()=>q(w,'#listing-recruiter_name').value==='登録時の名称','requested prefill');
      assert.equal(writes(w).length,0);assert.equal(publications(w).length,0);
    });
    await t.test('slow registration prefill cannot overwrite newer typing',async()=>{
      const w=await mount({url:'https://ui.test/#/work/new/page/recruiter_name',form:form(),offline:false,profile:{...registered,recruiter_name:''},registration:{full_name:'古い登録内容'}});await ready(w);
      w.qaDelayRegistration=true;button(w,'新規登録の情報から入力').click();await until(()=>w.qaReleaseRegistration,'prefill pending');
      await input(w,'#listing-recruiter_name','読み込み中に入力した名称');w.qaReleaseRegistration();await pause(80);
      assert.equal(q(w,'#listing-recruiter_name').value,'読み込み中に入力した名称');assert.equal(writes(w).length,0);
    });
    await t.test('unknown profile read is not missing data and cannot cause publication; retry recovers',async()=>{
      const w=await mount({url:'https://ui.test/#/work/new/page/review',form:form(),offline:false,profileReadError:true});
      await until(()=>/登録情報を確認できませんでした/.test(w.document.body.textContent),'profile unavailable');button(w,'掲載する').click();
      assert.equal(q(w,'[data-step-id]').dataset.stepId,'review');assert.equal(publications(w).length,0);
      w.qaProfileReadError=false;button(w,'登録情報を再確認').click();await ready(w);button(w,'掲載する').click();await page(w,'publish_consent');
      assert.equal(q(w,'#listing-publish-confirmed').checked,false);
    });
    await t.test('existing smoking prerequisite has an actual one-topic missing-input page',async()=>{
      const w=await mount({url:'https://ui.test/#/work/new/page/review',form:form(),offline:false,profile:{...registered,smoking_policy:''}});await ready(w);
      button(w,'掲載する').click();await page(w,'smoking_policy');assert.equal(publications(w).length,0);
      button(w,'禁煙（喫煙場所なし）').click();await until(()=>!button(w,'保存して確認に戻る').disabled,'smoking selected');button(w,'保存して確認に戻る').click();await page(w,'review');
      assert.equal(w.qaProfile.smoking_policy,'禁煙（喫煙場所なし）');assert.equal(publications(w).length,0);
    });
    await t.test('all detail review links go to their own question and return to review after reload',async()=>{
      let w=await mount({url:'https://ui.test/#/work/edit/42',job:dbRow({draft_step:12}),offline:false});await page(w,'review');
      const details=['photos','photo_captions','description','work_video','video_consent','danger_places','danger_tasks','belongings','cautions','worker_preferences','repeat_approval'];
      for(const id of details){
        assert.ok(q(w,`[data-edit-page="${id}"]`),id);q(w,`[data-edit-page="${id}"]`).click();await page(w,id);assert.match(w.location.hash,/return=review/);
        w=await mount({url:w.location.href,storage:storage(w),job:w.qaJob,offline:false});await page(w,id);
        button(w,'確認に戻る').click();await page(w,'review');assert.equal(publications(w).length,0);
      }
      assert.equal(q(w,'[data-step-id="review"] input'),null);
    });
    await t.test('consent is a real page, starts unchecked and revokes agreement after back, edit or reload',async()=>{
      let w=await mount({url:'https://ui.test/#/work/new/page/review',form:form(),offline:false});await ready(w);button(w,'掲載する').click();await page(w,'publish_consent');
      assert.equal(q(w,'.cb-box-overlay'),null);assert.equal(q(w,'#listing-publish-confirmed').checked,false);assert.equal(button(w,'同意して掲載する').disabled,true);
      assert.match(w.document.body.textContent,/農業に関連する作業/);q(w,'#listing-publish-confirmed').click();await pause(20);assert.equal(publications(w).length,0);
      button(w,'戻る').click();await page(w,'review');button(w,'掲載する').click();await page(w,'publish_consent');assert.equal(q(w,'#listing-publish-confirmed').checked,false);
      q(w,'#listing-publish-confirmed').click();await pause(20);
      w=await mount({url:w.location.href,storage:storage(w),offline:false});await page(w,'publish_consent');assert.equal(q(w,'#listing-publish-confirmed').checked,false);assert.equal(publications(w).length,0);
    });
    await t.test('publication errors remain on consent page; explicit retry keeps one receipt and successful completion only',async()=>{
      const w=await mount({url:'https://ui.test/#/work/new/page/review',form:form(),offline:false});await ready(w);button(w,'掲載する').click();await page(w,'publish_consent');
      w.qaCheckError=true;q(w,'#listing-publish-confirmed').click();await pause(20);button(w,'同意して掲載する').click();
      await until(()=>/保存を受け付けられませんでした/.test(w.document.body.textContent),'inline publish failure');assert.equal(q(w,'[data-step-id]').dataset.stepId,'publish_consent');assert.equal(w.qaJob.status,'draft');
      w.qaCheckError=false;button(w,'同意して掲載する').click();await until(()=>/掲載完了/.test(w.document.body.textContent),'confirmed publication');assert.equal(w.qaJob.status,'open');assert.equal(Object.keys(w.qaPublicationReceipts).length,1);
    });
    assert.deepEqual(errors,[]);
  } catch (error) { console.error('Stage5 screen:', dom?.window.document.body.textContent); throw error; }
  finally { dom?.window.close(); await rm(output,{recursive:true,force:true}); }
});
