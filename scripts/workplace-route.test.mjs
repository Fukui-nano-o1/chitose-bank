import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readWorkplaceRoute, openWorkplace, returnFromWorkplace, workplaceReturnScroll} from '../src/features/jobs/search/workplace.js';
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
async function until(fn) { const end = Date.now()+2500; while (!fn()) {assert.ok(Date.now()<end,'workplace history settled'); await pause(10);} }

test('workplace route only accepts a dedicated job child route', () => {
  assert.equal(readWorkplaceRoute('#/work/job/101/workplace'),101);
  for (const hash of ['#/work/job/101','#/work/job/101/questions','#/work/job/101/apply/intro','#/work/job/101/workplace/extra','#/work/job/abc/workplace','#/search']) assert.equal(readWorkplaceRoute(hash),null,hash);
});

test('dedicated workplace roundtrip preserves same-job source history and scroll, including repeated taps and forward', async () => {
  const dom = new JSDOM('',{url:'https://workplace.test/#/work/job/101/content'});
  const oldWindow = globalThis.window, oldEvent = globalThis.Event;
  globalThis.window = dom.window; globalThis.Event = dom.window.Event;
  try {
    Object.defineProperty(window,'scrollY',{value:742,writable:true});
    window.history.replaceState({fixture:'retained'},'');
    const length = window.history.length;
    openWorkplace(101); await until(() => window.location.hash === '#/work/job/101/workplace');
    openWorkplace(101); await pause(10);
    assert.equal(window.history.length,length+1,'repeat tap creates no duplicate destination');
    returnFromWorkplace(101); await until(() => window.location.hash === '#/work/job/101/content');
    assert.equal(workplaceReturnScroll(101),742);
    assert.equal(workplaceReturnScroll(202),null,'saved scroll cannot leak to another job');
    assert.equal(window.history.state.fixture,'retained');
    assert.equal(window.history.length,length+1,'return uses history, not duplicate source');
    window.history.forward(); await until(() => window.location.hash === '#/work/job/101/workplace');
    window.history.back(); await until(() => window.location.hash === '#/work/job/101/content');
    assert.equal(workplaceReturnScroll(101),742);
  } finally {dom.window.close(); globalThis.window=oldWindow; globalThis.Event=oldEvent;}
});

test('direct link reload return falls back to same job without leaving the site or adding a loop', async () => {
  const dom = new JSDOM('',{url:'https://workplace.test/#/work/job/202/workplace'});
  const oldWindow = globalThis.window, oldEvent = globalThis.Event;
  globalThis.window = dom.window; globalThis.Event = dom.window.Event;
  try {
    const length = window.history.length;
    assert.equal(workplaceReturnScroll(202),null);
    returnFromWorkplace(202); await until(() => window.location.hash === '#/work/job/202');
    assert.equal(window.history.length,length,'direct return replaces orphan intro entry');
    assert.equal(workplaceReturnScroll(202),null);
  } finally {dom.window.close(); globalThis.window=oldWindow; globalThis.Event=oldEvent;}
});

test('return cannot follow another job stored as history metadata', async () => {
  const dom = new JSDOM('',{url:'https://workplace.test/#/work/job/202/workplace'});
  const oldWindow = globalThis.window, oldEvent = globalThis.Event;
  globalThis.window = dom.window; globalThis.Event = dom.window.Event;
  try {
    window.history.replaceState({cbRouteReturn:{from:'/work/job/101',to:'/work/job/202/workplace',label:'foreign job'}},'');
    returnFromWorkplace(202); await until(() => window.location.hash === '#/work/job/202');
    assert.equal(workplaceReturnScroll(202),null);
  } finally {dom.window.close(); globalThis.window=oldWindow; globalThis.Event=oldEvent;}
});
