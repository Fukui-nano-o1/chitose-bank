import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../', import.meta.url));
const entry = '\0listing-review-test';
const detail = '\0listing-review-detail-probe';
// Exercise only the review presentation boundary. The real JobDetailBody and full
// LandingFlow remain covered by listing-basics/publication/schedule UI tests.
const fixture = `
  import { createElement as h } from 'react';
  import { createRoot } from 'react-dom/client';
  import { flushSync } from 'react-dom';
  import { ListingReview } from ${JSON.stringify(path.join(root, 'src/features/jobs/create/components/ListingReview.jsx'))};
  const root = createRoot(document.getElementById('root'));
  const record = name => value => window.qaEvents.push(['missing','edit'].includes(name) ? [name,value] : [name]);
  window.qaDefaults = {
    job: { photos:[], dateStart:null, dateEnd:null, jobBody:'', pay:0 },
    me: null, employer:null, trust:null, farmerDisplayName:'', hasWorkVideo:false,
    wageLookupNotice:h('aside',null,'賃金取得の案内'), recruiterStatus:'ready', missingFields:[],
    onReloadRecruiter:record('reload'), onMissingField:record('missing'), onEditPage:record('edit'),
    onOpenPerks:record('perks'), onOpenProfile:record('profile'), onOpenIntro:record('intro'),
  };
  window.qaRender = props => {
    window.qaEvents = [];
    flushSync(() => root.render(h(ListingReview, {...window.qaDefaults, ...props})));
  };
  window.qaRender({});
`;
const detailProbe = `
  import { createElement as h } from 'react';
  export function JobDetailBody(props) {
    window.qaDetail = props;
    return h('div', {'data-detail-probe':true},
      ...['写真','求人タイトル・募集タグ','作業内容','待遇','報酬・勤務条件・日程','場所・地図','持ち物・備考・危険箇所・保険','その他'].map(label =>
        h('section', {key:label,'data-section':label}, props.decorate(label,h('span',null,label+' 本文')))),
      props.reviewEditContent,
      props.onOpenIntro && h('button', {onClick:props.onOpenIntro, 'data-intro':true}, '紹介を開く'));
  }
`;

test('listing review owns display and delegates edits without owning input or persistence', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'cb-listing-review-'));
  let dom;
  try {
    await build({ configFile:false, root, logLevel:'error', define:{'process.env.NODE_ENV':'"production"'}, plugins:[{
      name:'listing-review-unit-fixture', enforce:'pre',
      resolveId(id) {
        if (id.endsWith('listing-review-test')) return entry;
        if (id.endsWith('/components/JobDetailBody')) return detail;
      },
      load(id) { if (id === entry) return fixture; if (id === detail) return detailProbe; },
    }, react()], build:{outDir:output,lib:{entry:'listing-review-test',name:'ReviewQA',formats:['iife'],fileName:'fixture'},minify:false} });
    const errors=[];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => errors.push(error.message));
    dom = new JSDOM('<div id="root"></div>', {url:'https://review.test',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole});
    const w=dom.window;
    w.fetch = () => { throw new Error('review presentation must not request network data'); };
    w.eval(await readFile(path.join(output, 'fixture.iife.js'), 'utf8'));
    const q=selector=>w.document.querySelector(selector);
    const text=()=>w.document.body.textContent;
    const events=()=>JSON.parse(JSON.stringify(w.qaEvents));
    const button=label=>[...w.document.querySelectorAll('button')].find(el=>el.textContent===label);

    await t.test('unfilled sections and fixed payment terms remain visible without claiming completion',()=>{
      assert.match(text(),/掲載前に、内容を確認しましょう/);
      assert.match(text(),/賃金取得の案内/);
      assert.match(q('[data-section="写真"]').textContent,/写真は後から登録できます/);
      assert.equal(q('[data-section="作業内容"]').textContent,'作業内容未設定');
      assert.equal(q('[data-section="報酬・勤務条件・日程"]').textContent,'作業日程未設定');
      assert.match(text(),/報酬 未設定/);
      assert.match(text(),/現金手渡し/);
      assert.equal(w.qaDetail.hideTopButton,true);
      assert.equal(q('[data-intro]'),null);
      q('[role="button"]').click();q('[role="button"]').click();
      assert.deepEqual(events(),[['profile'],['profile']]);
    });

    await t.test('read-only job, identity, employer and trust pass through unchanged',()=>{
      const job={...w.qaDefaults.job,photos:[{url:'https://image.test/synthetic.jpg'}],dateStart:new w.Date(2026,10,1),dateEnd:new w.Date(2026,10,2),jobBody:'入力した説明',pay:10000};
      const me={id:'synthetic-owner'};const employer={nickname:'合成農園'};const trust={ok:true};
      const before=JSON.stringify(job);
      w.qaRender({job,me,employer,trust,hasWorkVideo:true});
      assert.equal(w.qaDetail.job,job);assert.equal(w.qaDetail.me,me);
      assert.equal(w.qaDetail.employer,employer);assert.equal(w.qaDetail.trust,trust);
      assert.equal(q('[data-section="作業内容"]').textContent,'作業内容 本文');
      assert.equal(q('[data-section="報酬・勤務条件・日程"]').textContent,'報酬・勤務条件・日程 本文');
      assert.doesNotMatch(q('[data-section="写真"]').textContent,/写真は後から/);
      assert.match(text(),/日給10,000円/);
      q('[data-intro]').click();assert.deepEqual(events(),[['intro']]);
      assert.equal(JSON.stringify(job),before);
    });

    await t.test('conditional edit entries follow current input and each click delegates once',()=>{
      w.qaRender({job:{...w.qaDefaults.job,photos:[{}],dateStart:new w.Date(2026,10,1),dateEnd:new w.Date(2026,10,2)},hasWorkVideo:true});
      const visible = id => q(`[data-edit-page="${id}"]`);
      for(const id of ['holidays','photo_captions','video_consent']) assert.ok(visible(id),id);
      visible('holidays').click();visible('holidays').click();visible('recruiter_name').click();
      button('待遇編集 ›').click();
      assert.deepEqual(events(),[['edit','holidays'],['edit','holidays'],['edit','recruiter_name'],['perks']]);
      w.qaRender({});
      for(const id of ['holidays','photo_captions','video_consent']) assert.equal(visible(id),null,id);
      for(const id of ['crop','schedule','headcount','photos','work_video','recruiter_address','recruiter_contact']) assert.ok(visible(id),id);
      visible('crop').click();assert.deepEqual(events(),[['edit','crop']]);
    });

    await t.test('profile loading disables retry; failure enables explicit repeated retry',()=>{
      w.qaRender({recruiterStatus:'loading'});
      assert.match(q('[role="status"]').textContent,/登録情報を確認しています/);
      const retry=button('登録情報を再確認');assert.equal(retry.disabled,true);retry.click();assert.deepEqual(events(),[]);
      w.qaRender({recruiterStatus:'error'});
      assert.match(q('[role="status"]').textContent,/確認できるまで掲載しません/);
      button('登録情報を再確認').click();button('登録情報を再確認').click();assert.deepEqual(events(),[['reload'],['reload']]);
      w.qaRender({recruiterStatus:'ready'});assert.equal(q('[role="status"]'),null);
    });

    await t.test('missing-field navigation preserves the exact field and refreshes on rerender',()=>{
      const item={label:'採用人数',step:'headcount',syntheticMarker:'unchanged'};
      w.qaRender({missingFields:[item]});button('採用人数を確認').click();button('採用人数を確認').click();
      assert.equal(w.qaEvents[0][1],item);assert.equal(w.qaEvents[1][1],item);
      assert.deepEqual(events(),[['missing',item],['missing',item]]);
      w.qaRender({});assert.equal(q('[aria-label="掲載前に確認が必要な項目"]'),null);assert.deepEqual(events(),[]);
    });
    assert.deepEqual(errors,[]);
  } finally { dom?.window.close(); await rm(output,{recursive:true,force:true}); }
});
