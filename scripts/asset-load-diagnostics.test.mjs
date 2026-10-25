import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { assetPath, isAssetLoadError, createAssetDiagnostics, assetDiagnosticLines } from '../src/lib/assetLoadDiagnostics.js';
import { explainError, errorCategoryKey, buildErrorReport } from '../src/lib/errorCatalog.js';
const origin = 'https://fixture.invalid';
const path = '/assets/JobSearchMapView-DVnSnPTl.css';
const error = new Error(`Unable to preload CSS for ${path}`);
function setup(overrides = {}) {
  const calls = [];
  const capture = createAssetDiagnostics({ origin,
    fetchResource: async (...args) => { calls.push(args); return new Response(null, { status: 200, headers: { 'content-type': 'text/css; charset=utf-8' } }); },
    navigatorObject: { onLine: true, serviceWorker: { controller: {} } },
    documentObject: { querySelector: () => ({ src: origin + '/assets/index-current.js' }) },
    performanceObject: { getEntriesByName: () => [{ entryType: 'resource', initiatorType: 'link', responseStatus: 404, duration: 24.4, workerStart: 0 }] },
    ...overrides });
  return { capture, calls };
}
const row = diagnostic => ({ message: error.message, source: 'error_boundary', metadata: { asset_load: diagnostic } });

test('only same-origin versioned JS/CSS without query strings can be probed', async () => {
  for (const raw of ['/api/private', '/assets/a.js', '/assets/x-123.css?token=secret', '/assets/x-123.css#secret', 'https://other.invalid/assets/x-123.css', '//other.invalid/assets/x-123.css']) {
    assert.equal(assetPath(raw, origin), null, raw);
  }
  assert.equal(assetPath(origin + path, origin), path);
  const { capture, calls } = setup();
  await capture(new Error('Unable to preload CSS for https://other.invalid/assets/x-123.css'));
  await capture(new Error('Unable to preload CSS for /api/private'));
  await capture(new Error('Unable to preload CSS for //other.invalid/assets/x-123.css')); 
  assert.equal(calls.length, 0);
});

test('original failure and successful subsequent check remain distinct; request is bounded and private', async () => {
  const { capture, calls } = setup();
  const d = await capture(error);
  assert.equal(d.original.status, 404);
  assert.equal(d.original.duration_ms, 24);
  assert.equal(d.recheck.status, 200);
  assert.equal(d.entry, '/assets/index-current.js');
  assert.equal(calls[0][1].method, 'HEAD');
  assert.equal(calls[0][1].credentials, 'omit');
  assert.equal(calls[0][1].cache, 'no-store');
  assert.equal(calls[0][1].redirect, 'error');
  const text = assetDiagnosticLines(row(d)).join('\n');
  assert.match(text, /発生時にファイルが見つからない応答/);
  assert.match(text, /再確認時は取得可能/);
  assert.match(text, /画面全体の復旧を意味しません/);
});

test('unsupported or zero original status is unknown, never interpreted as HTTP success or offline', async () => {
  for (const value of [undefined, 0, 99, 700]) {
    const { capture } = setup({ performanceObject: { getEntriesByName: () => [{ entryType: 'resource', initiatorType: 'link', responseStatus: value }] } });
    const d = await capture(error);
    assert.equal(d.original.status, null);
    assert.match(assetDiagnosticLines(row(d)).join('\n'), /発生時のHTTP応答：確認できません/);
  }
});

test('offline does not start extra requests', async () => {
  const { capture, calls } = setup({ navigatorObject: { onLine: false } });
  assert.equal((await capture(error)).recheck.result, 'offline_skipped');
  assert.equal(calls.length, 0);
});

test('a stuck fetch times out even if the fetch implementation ignores abort', async () => {
  let signal;
  const { capture } = setup({ timeoutMs: 10, fetchResource: (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  assert.equal((await capture(error)).recheck.result, 'timeout');
  assert.equal(signal.aborted, true);
});

test('rejected and synchronous failures do not escape diagnostics', async () => {
  for (const fetchResource of [() => { throw new Error('secret'); }, () => Promise.reject(new Error('secret'))]) {
    const { capture } = setup({ fetchResource });
    const d = await capture(error);
    assert.equal(d.recheck.result, 'network_or_browser_error');
    assert(!JSON.stringify(d).includes('secret'));
  }
});

test('same asset probes are shared; at most three different assets are probed per page', async () => {
  const { capture, calls } = setup();
  await Promise.all([capture(error), capture(error)]);
  for (let i = 0; i < 5; i++) await capture(new Error(`Unable to preload CSS for /assets/page-${i}.css`));
  assert.equal(calls.length, 3);
});

test('unrelated application exceptions cause no diagnostic requests', async () => {
  const { capture, calls } = setup();
  assert.equal(await capture(new Error('Cannot read properties of undefined')), null);
  assert.equal(isAssetLoadError('Failed to fetch'), false);
  assert.equal(calls.length, 0);
});

test('HTTP refusal and server errors have evidence-specific explanations', async () => {
  for (const [status, phrase] of [[403, 'アクセス拒否'], [503, '配信側のエラー']]) {
    const { capture } = setup({ performanceObject: { getEntriesByName: () => [{ entryType: 'resource', initiatorType: 'link', responseStatus: status }] } });
    assert.match(assetDiagnosticLines(row(await capture(error))).join('\n'), new RegExp(phrase));
  }
});

test('HTML fallback at HTTP 200 is not treated as a usable stylesheet', async () => {
  const { capture } = setup({ fetchResource: async () => new Response(null, { headers: { 'content-type': 'text/html' } }) });
  assert.match(assetDiagnosticLines(row(await capture(error))).join('\n'), /応答形式がJS\/CSSと一致しません/);
});

test('old records remain unknown; classification no longer assumes a deployment caused it', () => {
  assert.equal(errorCategoryKey(row()), 'asset');
  assert.match(explainError(row()).cause, /この文言だけでは判断できない/);
  assert.match(assetDiagnosticLines(row()).join('\n'), /旧記録/);
  assert.match(assetDiagnosticLines(row()).join('\n'), /攻撃の有無を判定できません/);
});

test('copy report carries the same evidence and explicit limitations', async () => {
  const latest = { ...row(await setup().capture(error)), id:'fixture', created_at:'2026-10-26T00:00:00Z', status:'open' };
  const text = buildErrorReport({ latest, first:latest, rows:[latest], openIds:['fixture'] }, 'asset', explainError(latest), '');
  assert.match(text, /■ 診断: 発生時のHTTP応答：404/);
  assert.match(text, /■ 診断: 失敗後の再確認：HTTP 200/);
});

test('actual error logger enriches asset errors using existing metadata before insertion', async () => {
  const source = readFileSync(new URL('../src/app/diagnostics/errorLog.js', import.meta.url),'utf8')
    .replace(/^import .*;$/gm,'').replace(/^export /gm,'');
  const inserts=[];
  const context=vm.createContext({ captureAssetLoadDiagnostic: async () => ({version:1,asset:path}), isAssetLoadError,
    supabase:{from:() => ({insert:async data=>{inserts.push(data);}})}, rememberSupportFailure(){},
    makeErrorThrottle:()=>()=>({ok:true}), MAX_PER_MESSAGE:5,isOpaqueScriptError:()=>false,isInjectedWalletError:()=>false,
    window:{location:{href:origin+'/#/search'}},navigator:{userAgent:'fixture'},localStorage:{getItem:()=> 'fixture'},console });
  vm.runInContext(source,context);
  await context.logAppError({error, metadata:{asset_recovery:'scheduled'}});
  assert.equal(inserts[0].metadata.asset_load.asset,path);
  assert.equal(inserts[0].metadata.asset_load.recovery,'scheduled');
});

test('admin detail and first copy load diagnostic metadata and show the same evidence', async () => {
  const [{ JSDOM }, React, { createRoot }, ts, catalog] = await Promise.all([
    import('jsdom'), import('react'), import('react-dom/client'), import('typescript'), import('../src/lib/errorCatalog.js'),
  ]);
  const dom = new JSDOM('<div id="root"></div>', { url: origin+'/#/admin/system' });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window:dom.window, document:dom.window.document,
    navigator:dom.window.navigator, sessionStorage:dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT:true })) {
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  let copied='';
  Object.defineProperty(dom.window.navigator,'clipboard',{value:{writeText:async text=>{copied=text;}}});
  const latest={id:'fixture',created_at:'2026-10-26T00:00:00Z',message:error.message,source:'error_boundary',component:'app',status:'open'};
  const metadata={asset_load:await setup().capture(error)};
  const selected=[];
  const supabase={from:()=>({select:columns=>{
    selected.push(columns);
    return {order:()=>({limit:async()=>({data:[latest]})}),eq:()=>({maybeSingle:async()=>({data:{stack:'fixture stack',metadata}})})};
  }})};
  const source=readFileSync(new URL('../src/components/admin/AdminSystemRoom.jsx',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/export function /g,'function ');
  const js=ts.default.transpileModule(source,{compilerOptions:{jsx:ts.default.JsxEmit.React,target:ts.default.ScriptTarget.ES2022}}).outputText;
  const timers=[];
  const bindings={setTimeout:fn=>{timers.push(fn);return 1;}, React, useState:React.useState,useEffect:React.useEffect,useRef:React.useRef,
    supabase,...catalog,assetDiagnosticLines,Dots:()=>null,NavIconInline:()=>null};
  const Component=new Function(...Object.keys(bindings),js+'\nreturn AdminSystemRoom;')(...Object.values(bindings));
  const root=createRoot(document.getElementById('root'));
  try {
    await React.act(async()=>{root.render(React.createElement(Component));});
    const button=[...document.querySelectorAll('button')].find(el=>el.textContent==='コピー');
    assert(button);
    await React.act(async()=>{button.click();});
    assert(selected.includes('stack,metadata'));
    assert.match(copied,/発生時のHTTP応答：404/);
    assert.match(copied,/失敗後の再確認：HTTP 200/);
    await React.act(async()=>{button.parentElement.parentElement.click();});
    assert.match(document.body.textContent,/発生時のHTTP応答：404/);
    assert.match(document.body.textContent,/画面全体の復旧を意味しません/);
  } finally {
    await React.act(async()=>{for(const fn of timers) fn();});
    await React.act(async()=>root.unmount());dom.window.close();
    for(const [key,descriptor] of originals) {if(descriptor) Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
});

test('actual route preloader records asset failure without triggering reload or rejecting navigation preload', async () => {
  const [ts, {createModuleLoader}] = await Promise.all([import('typescript'),import('../src/lib/moduleLoader.js')]);
  const source=readFileSync(new URL('../src/app/chunkReload.jsx',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
  const js=ts.default.transpileModule(source,{compilerOptions:{jsx:ts.default.JsxEmit.React,target:ts.default.ScriptTarget.ES2022}}).outputText;
  const records=[];
  const bindings={lazy:loader=>({loader}),createModuleLoader,isAssetLoadError,logAppError:async record=>{records.push(record);}};
  const lazyChunk=new Function(...Object.keys(bindings),js+'\nreturn lazyChunk;')(...Object.values(bindings));
  const component=lazyChunk(()=>Promise.reject(error));
  assert.equal(await component.preload(),null);
  assert.equal(records.length,1);
  assert.equal(records[0].action,'asset_preload_failed');
  assert.equal(records[0].metadata.asset_recovery,'not_requested');
});
