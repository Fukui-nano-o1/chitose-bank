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
async function until(fn) {
  const deadline = Date.now() + 6000;
  while (!fn()) { assert.ok(Date.now() < deadline, 'Workplace UI settled'); await pause(10); }
}

test('dedicated WorkplacePage uses existing truthful fields and protected anonymous photos', async t => {
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
    const downloads = [], revoked = [];
    let blobId = 0, releasePhoto;
    const source = name => `https://project.supabase.co/storage/v1/object/public/job-photos/fixture/${name}.jpg`;
    w.URL.createObjectURL = () => `blob:https://workplace.test/${++blobId}`;
    w.URL.revokeObjectURL = url => revoked.push(url);
    w.fetch = () => { throw new Error('Unexpected real network'); };
    w.qaPhotoClient = {auth:{getSession:async () => ({data:{session:null}}),onAuthStateChange:() => {}},storage:{from:bucket => ({download:async (key, _options, request) => {
      downloads.push({bucket,key,cache:request.cache});
      if (key.endsWith('/slow.jpg')) await new Promise(resolve => { releasePhoto = resolve; });
      return key.endsWith('/denied.jpg') ? {error:Error('403')} : {data:new w.Blob(['synthetic-image'])};
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
      assert.match(text(), /この求人の写真はまだ登録されていません/);
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
    await t.test('anonymous photos use private-bucket download and denied photos never use persisted URL', async () => {
      w.qaRenderWorkplace({job:{...job,photos:[source('allowed'),{url:source('denied')}]},employer:null,status:'ready'});
      await until(() => w.document.querySelectorAll('img[data-photo-access="authenticated"]').length === 1 && w.document.querySelectorAll('img[data-photo-access="unavailable"]').length === 1);
      assert.ok(downloads.every(request => request.bucket === 'job-photos' && request.cache === 'no-store'));
      for (const img of w.document.querySelectorAll('img')) assert.ok(!img.getAttribute('src') || img.getAttribute('src').startsWith('blob:'));
    });
    await t.test('switching jobs removes prior text/photos and drops late photo completion', async () => {
      w.qaRenderWorkplace({job:{...job,photos:[source('slow')]},employer:{intro_atmosphere:'OLD JOB COPY'},status:'ready'});
      await until(() => typeof releasePhoto === 'function');
      w.qaRenderWorkplace({job:{id:202,photos:[]},employer:null,status:'loading'});
      assert.doesNotMatch(text(), /OLD JOB COPY/); assert.equal(w.document.querySelectorAll('img').length,0);
      releasePhoto(); await pause(30);
      assert.equal(w.document.querySelectorAll('img').length,0); assert.ok(revoked.length > 0);
      w.qaRenderWorkplace({job:{id:202,photos:[]},employer:{intro_atmosphere:'NEW JOB COPY'},status:'ready'});
      assert.match(text(), /NEW JOB COPY/); assert.doesNotMatch(text(), /OLD JOB COPY/);
    });
    assert.deepEqual(errors, []);
  } finally { dom?.window.close(); await rm(output,{recursive:true,force:true}); }
});
