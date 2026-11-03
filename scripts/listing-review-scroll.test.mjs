import test from 'node:test';
import assert from 'node:assert/strict';
import { updateReviewScroll } from '../src/features/jobs/create/reviewScroll.js';
const sample = (top, extra={}) => ({ top, height:3000, viewport:600, ...extra });
const step = (state, top, extra) => updateReviewScroll(state, sample(top, extra));
test('review follows both scroll directions without jitter or slow-scroll starvation', () => {
  let state=step(null,200);
  state=step(state,208);assert.equal(state.hidden,true);
  for(const top of [207,208,207,208]) {state=step(state,top);assert.equal(state.hidden,true);}
  state=step(state,200);assert.equal(state.hidden,false);
  for(let top=201;top<=208;top++) state=step(state,top);
  assert.equal(state.hidden,true);
  for(let top=207.5;top>=200;top-=0.5) state=step(state,top);
  assert.equal(state.hidden,false);
});
test('top, bottom, short pages and overscroll expose actions without bounce toggles', () => {
  let state=step(step(null,200),220);
  for(const top of [0,-20,0,5]) {state=step(state,top);assert.equal(state.hidden,false);}
  state=step(state,150);assert.equal(state.hidden,true);
  for(const top of [2400,2450,2401,2400]) {state=step(state,top);assert.equal(state.hidden,false);}
  assert.equal(step(null,0,{height:300}).hidden,false);
});
test('restoration and viewport/content changes rebase; keyboard focus keeps actions visible', () => {
  let state=step(null,700);assert.equal(state.hidden,false);
  state=step(state,710);assert.equal(state.hidden,true);
  state=step(state,600,{viewport:750});assert.equal(state.hidden,true);
  state=step(state,500,{viewport:750,height:3200});assert.equal(state.hidden,true);
  state=step(state,492,{viewport:750,height:3200});assert.equal(state.hidden,false);
  state=step(state,600,{viewport:750,height:3200,controlsFocused:true});assert.equal(state.hidden,false);
});

test('bottom stays reachable when showing the bars shrinks the viewport again', () => {
  let state=step(step(null,2100),2200);
  state=step(state,2200,{viewport:800});assert.equal(state.hidden,false);
  state=step(state,2200,{viewport:600});assert.equal(state.hidden,false);
  for(let top=2210;top<=2400;top+=10) {state=step(state,top);assert.equal(state.hidden,false);}
  state=step(state,2300);assert.equal(state.hidden,false);
  state=step(state,2310);assert.equal(state.hidden,true,'direction behavior resumes after scrolling up');
});
