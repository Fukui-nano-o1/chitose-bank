// Failure-only diagnostics. Never fetch arbitrary URLs or store input/query values.
const ASSET = /^\/assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]+\.(css|js)$/;
export function assetPath(raw, origin) {
  try {
    const url = new URL(raw, origin);
    return url.origin === origin && !url.search && !url.hash && ASSET.test(url.pathname) ? url.pathname : null;
  } catch { return null; }
}
export function isAssetLoadError(error) {
  return /unable to preload css|importing a module script failed|failed to fetch dynamically imported module|error loading dynamically imported module|loading (?:css )?chunk/i.test(String(error?.message || error || ''));
}
function errorAsset(error, origin) {
  const message = String(error?.message || error || '');
  for (const candidate of message.match(/https?:\/\/[^\s'"<>]+|\/\/[^\s'"<>]+|\/assets\/[^\s'"<>]+/g) || []) {
    const path = assetPath(candidate, origin);
    if (path) return path;
  }
  return null;
}
const httpStatus = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
const duration = value => Number.isFinite(value) && value >= 0 ? Math.min(300000, Math.round(value)) : null;

export function createAssetDiagnostics({ origin, fetchResource, performanceObject, documentObject, navigatorObject, timeoutMs = 1200 } = {}) {
  const pending = new Map();
  return function capture(error) {
    if (!isAssetLoadError(error)) return Promise.resolve(null);
    const path = errorAsset(error, origin);
    const key = path || 'unknown';
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 3) return Promise.resolve({ version: 1, asset: path, recheck: { result: 'budget_exhausted' } });
    const task = (async () => {
      const result = { version: 1, captured_at: new Date().toISOString(), asset: path, original: { status: null }, recheck: { result: 'not_available' } };
      // Snapshot before the HEAD request: its result must not replace the original observation.
      try {
        result.online = typeof navigatorObject?.onLine === 'boolean' ? navigatorObject.onLine : null;
        result.service_worker_controlled = !!navigatorObject?.serviceWorker?.controller;
        result.entry = assetPath(documentObject?.querySelector('script[type="module"][src]')?.src, origin);
        const entries = path ? performanceObject?.getEntriesByName(new URL(path, origin).href) || [] : [];
        const entry = entries.filter(item => item.entryType === 'resource' && ['link', 'script'].includes(item.initiatorType)).at(-1);
        if (entry) result.original = { status: httpStatus(entry.responseStatus), duration_ms: duration(entry.duration), via_service_worker: entry.workerStart > 0 };
      } catch { /* Browser privacy restrictions must not break recovery. */ }
      if (!path || !fetchResource) return result;
      if (result.online === false) { result.recheck = { result: 'offline_skipped' }; return result; }
      const controller = new AbortController();
      let timer;
      try {
        result.recheck = await Promise.race([
          Promise.resolve().then(() => fetchResource(new URL(path, origin).href, {
            method: 'HEAD', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
          })).then(response => ({ result: 'response', status: httpStatus(response.status),
            mime: String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase().slice(0, 80) })),
          new Promise(resolve => { timer = setTimeout(() => { resolve({ result: 'timeout' }); controller.abort(); }, timeoutMs); }),
        ]);
      } catch { result.recheck = { result: 'network_or_browser_error' }; }
      finally { clearTimeout(timer); }
      return result;
    })();
    pending.set(key, task);
    return task;
  };
}

let capture;
export async function captureAssetLoadDiagnostic(error) {
  try {
    if (!capture) capture = createAssetDiagnostics({ origin: window.location.origin,
      fetchResource: window.fetch.bind(window), performanceObject: window.performance,
      documentObject: document, navigatorObject: navigator });
    return await capture(error);
  } catch { return null; }
}

export function assetDiagnosticLines(row = {}) {
  if (!isAssetLoadError(row.message)) return [];
  const d = row.metadata?.asset_load;
  const lines = ['安全性：この記録だけでは攻撃の有無を判定できません。アクセス元の名乗りは未検証です。'];
  if (!d || d.version !== 1) return [...lines, '診断情報：旧記録のため取得時のHTTP応答・再確認結果は確認できません。'];
  const safePath = value => assetPath(value, 'https://diagnostic.invalid') || '確認できません';
  if (typeof d.captured_at === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(d.captured_at)) lines.push(`観測日時：${d.captured_at}（同じページ内の再発は最初の観測を再利用）`);
  const status = httpStatus(d.original?.status);
  lines.push(`対象：${safePath(d.asset)}`, `実行中の版：${safePath(d.entry)}`,
    `発生時のHTTP応答：${status || '確認できません（未対応・未取得・通信失敗など）'}`,
    `端末の接続申告：${d.online === true ? 'オンライン' : d.online === false ? 'オフライン' : '不明'}`);
  if (status === 404) lines.push('判明した事実：発生時にファイルが見つからない応答（404）。削除・経路設定などの原因は別途調査。');
  else if (status >= 500) lines.push('判明した事実：発生時に配信側のエラー応答（5xx）。攻撃が原因とは断定できません。');
  else if (status === 401 || status === 403) lines.push('判明した事実：発生時にアクセス拒否の応答。拒否理由は別途調査。');
  const r = d.recheck || {};
  if (r.result === 'response') {
    const code = httpStatus(r.status);
    const expected = String(d.asset || '').endsWith('.css') ? 'text/css' : /^(?:text|application)\/(?:javascript|ecmascript)$/;
    const correctMime = typeof expected === 'string' ? r.mime === expected : expected.test(r.mime || '');
    lines.push(`失敗後の再確認：HTTP ${code || '不明'}／${String(r.mime || 'MIME不明').slice(0, 80)}`);
    if (code === 200 && correctMime) lines.push('再確認時は取得可能。元の通信成功や画面全体の復旧を意味しません。');
    else if (code === 200) lines.push('再確認時の応答形式がJS/CSSと一致しません。HTMLへの置換などを調査してください。');
  } else {
    const labels = { timeout: '時間切れ', offline_skipped: 'オフライン申告のため省略', network_or_browser_error: '通信またはブラウザ側で失敗', budget_exhausted: 'このページの診断回数上限', not_available: '対象URLを特定できないため省略' };
    lines.push(`失敗後の再確認：${labels[r.result] || '確認できません'}`);
  }
  lines.push(`自動再読み込み：${d.recovery === 'scheduled' ? '実行予定（復旧成功は未確認）' : d.recovery === 'not_requested' ? '先読みの失敗のみのため実行しない' : '結果未確認'}`);
  return lines;
}
