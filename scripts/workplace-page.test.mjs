import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {JSDOM, VirtualConsole} from 'jsdom';
import {build} from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
test('dedicated WorkplacePage uses truthful fields without borrowing job photos or avatars', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'cb-workplace-ui-'));
  let dom;
  try {
    await build({configFile:false, root, logLevel:'error', define:{'process.env.NODE_ENV':'"production"', 'import.meta.env.VITE_SUPABASE_URL':'"https://project.supabase.co"'},
      plugins:[{name:'workplace-photo-fixture', enforce:'pre', resolveId(id) {
        if (/(?:^|\/)lib\/supabase(?:\.js)?$/.test(id)) return path.join(root, 'scripts/fixtures/listing-photo-client.js');
      }}, react()], build:{outDir:output, lib:{entry:path.join(root,'scripts/fixtures/workplace-page-entry.jsx'), name:'WorkplaceQA', formats:['iife'], fileName:'fixture'}, minify:false}});
    const errors = [];
    const console = new VirtualConsole();
    console.on('jsdomError', error => errors.push(error.message));
    dom = new JSDOM('<div id="root"></div>', {url:'https://workplace.test/#/work/job/101/workplace',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console});
    const w = dom.window;
    const downloads = [];
    const source = name => `https://project.supabase.co/storage/v1/object/public/job-photos/fixture/${name}.jpg`;
    w.fetch = () => { throw new Error('Unexpected real network'); };
    w.qaPhotoClient = {auth:{getSession:async () => ({data:{session:null}}),onAuthStateChange:() => {}},storage:{from:bucket => ({download:async key => {
      downloads.push({bucket,key});
      throw new Error('Workplace must not request job photos');
    }})}};
    const job = {id:101, crop:'合成作物', task:'合成作業', photos:[], workAddress:'SECRET STREET',workVideoUrl:'https://youtube.com/watch?v=secret', employerName:'合成募集主'};
    w.qaWorkplaceProps = {job,employer:null,status:'loading'};
    w.eval(await readFile(path.join(output,'fixture.iife.js'),'utf8'));
    const text = () => w.document.body.textContent;
    await t.test('loading, error and empty are distinct, without invented negative claims', () => {
      assert.match(text(), /職場紹介を読み込んでいます/);
      w.qaRenderWorkplace({job:null,employer:null,status:'loading'});
      assert.doesNotMatch(text(), /写真はまだ登録されていません/);
      w.qaRenderWorkplace({job,employer:null,status:'loading'});
      assert.doesNotMatch(text(), /職場紹介はまだ登録されていません/);
      w.qaRenderWorkplace({job,employer:null,status:'error'});
      assert.match(text(), /職場紹介を読み込めませんでした/);
      assert.doesNotMatch(text(), /職場紹介はまだ登録されていません/);
      w.qaRenderWorkplace({job,employer:{intro_atmosphere:'  ', teaching_style:'unknown-code'},status:'ready'});
      assert.match(text(), /職場紹介はまだ登録されていません/);
      assert.match(text(), /職場紹介の写真は準備中です。求人の写真はここには表示しません。/);
      assert.doesNotMatch(text(), /トイレなし|休憩所なし|unknown-code/);
    });
    await t.test('existing values render with no private fields, video or modal', () => {
      w.qaRenderWorkplace({job, status:'ready', employer:{nickname:'合成農園', intro_atmosphere:'合成の雰囲気', teaching_style:'show_first,learn_by_doing', question_style:'anytime',always_do:'合成の声かけ',break_style:'合成の休憩', recruiter_contact:'SECRET CONTACT',recruiter_address:'SECRET ADDRESS',texts_pending:{intro_atmosphere:'PENDING COPY'}}});
      for (const value of ['合成の雰囲気','やって見せてから任せる','一緒にやりながら覚えてもらう','いつでもその場で聞いてOK','合成の声かけ','合成の休憩']) assert.ok(text().includes(value), value);
      assert.doesNotMatch(text(), /SECRET|PENDING COPY/);
      assert.equal(w.document.querySelector('iframe,[role="dialog"],.cb-sheet-up'),null);
      const back = [...w.document.querySelectorAll('button')].find(button => button.textContent.includes('求人詳細に戻る'));
      assert.ok(back); back.click(); assert.equal(w.qaBackCount,1);
    });
    await t.test('anonymous job photos, external photos, avatar and video never become workplace media', async () => {
      w.qaRenderWorkplace({job:{...job,photos:[source('allowed'),{url:source('denied'),caption:'JOB CAPTION'},'/job-static.jpg'],employerAvatar:'/job-avatar.jpg'},employer:{avatar_url:'/employer-avatar.jpg'},status:'ready'});
      await pause(30);
      assert.equal(w.document.querySelector('img,video,iframe,source'),null);
      assert.equal(w.document.querySelector('[style*="background-image"]'),null);
      assert.doesNotMatch(text(), /JOB CAPTION/);
      assert.match(text(), /職場紹介の写真は準備中です。求人の写真はここには表示しません。/);
      assert.deepEqual(downloads,[],'no job Storage requests, including anonymous access');
    });
    await t.test('switching jobs removes prior text without introducing photo fallback', async () => {
      w.qaRenderWorkplace({job:{...job,photos:[source('old')]},employer:{intro_atmosphere:'OLD JOB COPY',avatar_url:'/old-avatar.jpg'},status:'ready'});
      assert.match(text(), /OLD JOB COPY/);
      w.qaRenderWorkplace({job:{id:202,photos:[source('new')]},employer:null,status:'loading'});
      assert.doesNotMatch(text(), /OLD JOB COPY/); assert.equal(w.document.querySelectorAll('img').length,0);
      await pause(30);
      assert.deepEqual(downloads,[]);
      w.qaRenderWorkplace({job:{id:202,photos:[]},employer:{intro_atmosphere:'NEW JOB COPY'},status:'ready'});
      assert.match(text(), /NEW JOB COPY/); assert.doesNotMatch(text(), /OLD JOB COPY/);
    });
    await t.test('only explicitly ready independent published photos render through dedicated storage', async () => {
      const owner='11111111-1111-4111-8111-111111111111', id='a'.repeat(64), path=`${owner}/${id}.jpg`;
      w.URL.createObjectURL=()=> 'blob:https://workplace.test/independent';
      w.URL.revokeObjectURL=()=>{};
      w.qaPhotoClient.storage.from=bucket=>({download:async key=>{downloads.push({bucket,key});return {data:new w.Blob(['independent-bytes'])};}});
      const props={job:{...job,photos:[source('should-not-load')]},employer:null,status:'ready',photos:[{id,path},{path:source('not-an-independent-path')}]};
      for(const photoStatus of ['loading','error','unconfigured']){
        w.qaRenderWorkplace({...props,photoStatus});await pause(10);assert.equal(w.document.querySelector('img'),null);
      }
      assert.deepEqual(downloads,[]);
      w.qaRenderWorkplace({...props,photoStatus:'ready'});
      const end=Date.now()+5000;
      while(!w.document.querySelector('[data-workplace-photo="ready"]')){assert.ok(Date.now()<end,'published photo ready');await pause(10);}
      assert.equal(w.document.querySelectorAll('img').length,1);
      assert.equal(w.document.querySelector('img').getAttribute('src'),'blob:https://workplace.test/independent');
      assert.deepEqual(downloads,[{bucket:'workplace-photos',key:path}]);
      w.qaRenderWorkplace({...props,photos:[],photoStatus:'ready'});
      assert.equal(w.document.querySelector('img'),null);assert.match(text(),/職場の写真はまだ公開されていません/);
    });
    assert.deepEqual(errors, []);
  } finally { dom?.window.close(); await rm(output,{recursive:true,force:true}); }
});
