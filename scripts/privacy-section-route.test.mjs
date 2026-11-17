import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ANALYTICS_PRIVACY_HREF, privacySectionId, observePrivacySection } from '../src/lib/privacySectionRoute.js';
import { ROUTE_CHANGED } from '../src/lib/pushRoute.js';

const marker = { cbPrivacySection: 'analytics' };
test('analytics selection is scoped to the ordinary privacy history entry', () => {
 assert.equal(privacySectionId({hash:ANALYTICS_PRIVACY_HREF},marker),'privacy-10');
 assert.equal(privacySectionId({hash:'#/privacy'},null),null);
 assert.equal(privacySectionId({hash:'#/privacy'},{cbPrivacySection:'other'}),null);
 for(const hash of ['#/privacy/unknown','#/profile','#/privacy?other=1','#/privacy/extra']) assert.equal(privacySectionId({hash},marker),null);
});
test('ordinary privacy, selected entry, Back/Forward and canceled navigation focus the current section only', () => {
 const dom=new JSDOM('<h1 data-privacy-title tabindex="-1">Privacy</h1><section id="privacy-10"><h3 tabindex="-1">Measurement</h3></section>',{url:'https://ui.test/'+ANALYTICS_PRIVACY_HREF});
 const w=dom.window, calls=[], frames=new Map(); let id=0;
 w.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};w.cancelAnimationFrame=i=>frames.delete(i);
 w.scrollTo=()=>calls.push('top');w.HTMLElement.prototype.scrollIntoView=function(){calls.push(this.id);};
 const flush=()=>{const current=[...frames.values()];frames.clear();current.forEach(fn=>fn());};
 const cleanup=observePrivacySection(w,w.document);flush();
 assert.equal(w.document.activeElement.tagName,'H1');assert.deepEqual(calls,['top']);
 w.history.replaceState(marker,'',ANALYTICS_PRIVACY_HREF);w.dispatchEvent(new w.Event(ROUTE_CHANGED));flush();
 assert.equal(w.document.activeElement.tagName,'H3');assert.equal(calls.at(-1),'privacy-10');
 w.history.replaceState(null,'','#/privacy');w.dispatchEvent(new w.Event('popstate'));flush();
 assert.equal(w.document.activeElement.tagName,'H1');assert.equal(calls.at(-1),'top');
 w.history.replaceState(marker,'',ANALYTICS_PRIVACY_HREF);w.dispatchEvent(new w.Event('popstate'));flush();assert.equal(calls.at(-1),'privacy-10');
 w.dispatchEvent(new w.Event(ROUTE_CHANGED));w.history.replaceState(marker,'','#/profile');flush();assert.equal(calls.length,4,'stale pending focus is ignored');
 cleanup();w.history.replaceState(marker,'',ANALYTICS_PRIVACY_HREF);w.dispatchEvent(new w.Event('hashchange'));flush();assert.equal(calls.length,4);dom.window.close();
});
