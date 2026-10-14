import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, webkit } from 'playwright';

// Isolated fixture: no authentication, real job data, or database writes.
const html = '.own-job-actions-test.html';
const jsx = '.own-job-actions-test.jsx';
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CSS } from './src/appStyles.js';
import { OwnJobTile } from './src/components/OwnJobTile.jsx';
import { OwnJobActionBar } from './src/components/OwnJobActionBar.jsx';
import { useOwnJobSelection } from './src/hooks/useOwnJobSelection.js';
window.__opens = []; window.__actions = [];
function Fixture() {
  const [scope, setScope] = useState('draft');
  const [rows, setRows] = useState([
    { job_number:101, crop:'ブロッコリー', task:'播種', status:'draft' },
    { job_number:202, crop:'ナス', task:'収穫', status:'draft' },
  ]);
  window.__changeScope = () => setScope('active');
  const selection = useOwnJobSelection({ rows, scope, ownerId:'fixture-owner', enabled:true, isEnded:() => false,
    runAction: async (kind, number) => {
      window.__actions.push({ kind, number });
      await new Promise(resolve => setTimeout(resolve, 180));
      if (kind === 'delete') setRows(prev => prev.filter(row => row.job_number !== number));
      return true;
    },
  });
  return <><style>{CSS}</style><main style={{padding:'24px 14px 220px', minHeight:1300}}>
    <h1 style={{fontSize:28}}>あなたの求人</h1><p>カードを長押しして操作</p>
    <div className='cb-own-jobs-grid'>{rows.map(row => <OwnJobTile key={row.job_number}
      title={row.crop + ' ' + row.task} sub='徳島県吉野川市' jobNumber={row.job_number}
      state={{label:'下書き',dot:'#F5A623'}} avatarName='農園' actionLabel='続きを入力'
      actionHint='保存したところから再開できます。' selected={selection.selectedJob?.job_number === row.job_number}
      onActions={origin => selection.selectJob(row.job_number, origin)}
      onOpen={() => { if (selection.selectedJob) selection.clearSelection(); else window.__opens.push(row.job_number); }}
    />)}</div>
    {selection.selectedJob && <OwnJobActionBar key={selection.selectedJob.job_number} job={selection.selectedJob}
      actions={selection.actions} busy={selection.busy} error={selection.error}
      onAction={selection.runSelectedAction} onClose={selection.clearSelection} />}
    </main><nav className='app-header-mobile' style={{height:64,boxSizing:'border-box'}}>さがす　カレンダー　チャット　掲載　マイページ</nav></>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
`;
let server;
try {
  await writeFile(html, '<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/.own-job-actions-test.jsx"></script></body></html>');
  await writeFile(jsx, fixture);
  await mkdir('artifacts', { recursive: true });
  server = await createServer({ configFile: false, plugins: [react()], server: { host: '127.0.0.1', port: 5127, strictPort: true } });
  await server.listen();
  for (const [name, type] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await type.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      await page.goto('http://127.0.0.1:5127/' + html);
      const main = num => page.locator('[data-own-job-number="' + num + '"] [data-job-card-main]');
      const more = num => page.getByRole('button', { name: '求人 #' + num + ' の操作を開く', exact: true });
      const bar = page.locator('#own-job-actions');
      const hold = async num => {
        await main(num).dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', button: 0, isPrimary: true, clientX: 30, clientY: 150 });
        await page.waitForTimeout(500);
        await main(num).dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', button: 0, isPrimary: true, clientX: 30, clientY: 150 });
        await main(num).dispatchEvent('click', { detail: 1 });
      };
      await main(101).waitFor();
      assert.equal(await bar.count(), 0, 'actions must be hidden initially');
      await main(101).click();
      assert.deepEqual(await page.evaluate(() => window.__opens), [101]);
      await hold(101);
      assert.equal(await bar.getAttribute('aria-label'), '求人 #101 の操作');
      assert.deepEqual(await page.evaluate(() => window.__opens), [101], 'hold release must not navigate');
      await more(202).click();
      assert.equal(await bar.getAttribute('aria-label'), '求人 #202 の操作', 'switch exactly one selected job');
      assert.equal(await page.locator('[data-selected="true"]').count(), 1);
      await page.evaluate(() => document.body.classList.add('cb-scroll-hide'));
      await page.waitForTimeout(350); // Allow the entry animation to finish before checking painted visibility.
      const geometry = await page.evaluate(() => {
        const element = document.getElementById('own-job-actions');
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const button = element.querySelector('[data-job-action="copy"]');
        const target = button.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, barWidth: rect.width, barHeight: rect.height,
          nav: document.querySelector('.app-header-mobile').getBoundingClientRect().top,
          width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
          display: style.display, opacity: Number(style.opacity), visibility: style.visibility,
          position: style.position, transform: style.transform, pointerEvents: style.pointerEvents,
          hit: button.contains(document.elementFromPoint(target.x + target.width / 2, target.y + target.height / 2)),
          body: document.body.className };
      });
      console.log(name + ' action bar visibility: ' + JSON.stringify(geometry));
      await page.screenshot({ path: 'artifacts/listing-actions-' + name + '.png' });
      assert.ok(geometry.bottom <= geometry.nav && geometry.top >= 0, 'action bar must sit above navigation inside the viewport');
      assert.ok(geometry.barWidth > 250 && geometry.barHeight > 80, 'action bar must have a visible box');
      assert.ok(geometry.scrollWidth <= geometry.width, 'no horizontal overflow');
      assert.equal(geometry.opacity, 1, 'selected actions must be opaque');
      assert.equal(geometry.visibility, 'visible');
      assert.notEqual(geometry.display, 'none');
      assert.notEqual(geometry.pointerEvents, 'none');
      assert.equal(geometry.hit, true, 'visible action button must receive actual pointer input');
      await page.evaluate(() => { const button = document.querySelector('[data-job-action="copy"]'); button.click(); button.click(); });
      await bar.waitFor({ state: 'detached' });
      assert.deepEqual(await page.evaluate(() => window.__actions), [{ kind: 'copy', number: 202 }], 'double click runs once for selected job only');
      await more(202).click();
      await page.evaluate(() => document.body.classList.add('cb-scroll-hide'));
      await bar.locator('[data-job-action="copy"]').click();
      await bar.waitFor({ state: 'detached' });
      assert.deepEqual(await page.evaluate(() => window.__actions), [{ kind: 'copy', number: 202 }, { kind: 'copy', number: 202 }], 'real pointer click works even after navigation auto-hide');
      await page.evaluate(() => document.body.classList.remove('cb-scroll-hide'));
      await main(101).dispatchEvent('pointerdown', { pointerId: 3, pointerType: 'touch', button: 0, isPrimary: true, clientX: 30, clientY: 150 });
      await main(101).dispatchEvent('pointermove', { pointerId: 3, pointerType: 'touch', button: 0, isPrimary: true, clientX: 30, clientY: 185 });
      await page.waitForTimeout(500);
      assert.equal(await bar.count(), 0, 'scroll movement must not select');
      await main(101).dispatchEvent('pointercancel', { pointerId: 3 });
      await main(101).focus();
      await page.keyboard.press('Shift+F10');
      await bar.waitFor();
      await page.keyboard.press('Escape');
      await bar.waitFor({ state: 'detached' });
      await more(202).click();
      await bar.locator('[data-job-action="delete"]').click();
      await bar.waitFor({ state: 'detached' });
      assert.equal(await page.locator('[data-own-job-number="202"]').count(), 0);
      assert.equal(await page.locator('[data-own-job-number="101"]').count(), 1);
      await more(101).click();
      await page.evaluate(() => window.__changeScope());
      await bar.waitFor({ state: 'detached' });
      assert.deepEqual(errors, [], 'no browser runtime errors');
      console.log(name + ': normal tap, hold, selected-target switch, copy/delete isolation, double-submit guard, scroll cancel, keyboard dismissal, tab invalidation, painted visibility, hit testing and geometry passed');
    } finally { await browser.close(); }
  }
} finally {
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(jsx, { force: true })]);
}
