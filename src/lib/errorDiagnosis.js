// 保存済みの技術記録だけから分類する。確度と画面への影響は別に扱う。
// UA・スタックは端末の申告であり、接続元や利用者を認証する材料にはしない。
export const TRANSLATE_ISSUE_URL = 'https://issues.chromium.org/issues/571648515';
export const TRANSLATE_SCRIPT_URL = 'https://translate.googleapis.com/_/translate_http/_/js/k=translate_http.tr.ja.CZfhvHNGWSo.O/am=AACAAQ/d=1/ed=1/rs=AN8SPfrElSgq8-PmgKbto-A8RG_jTLzCzw/m=el_main';

export function browserLabel(ua = '') {
  const s = String(ua || '');
  if (/(?:^|[^a-z0-9_-])googlebot(?:-[a-z]+)?(?:\/|[\s;)]|$)/i.test(s)) return 'Googlebot申告・未検証';
  const ios = /iPhone|iPad|iPod/i.test(s);
  const rules = [['CriOS', 'Chrome（iOS）'], ['FxiOS', 'Firefox（iOS）'], ['EdgiOS', 'Edge（iOS）'], ['Edg', 'Edge'], ['Chrome', 'Chrome'], ['Firefox', 'Firefox']];
  for (const [token, label] of rules) {
    const match = s.match(new RegExp(`\\b${token}/(\\d+(?:\\.\\d+)*)`));
    if (match) return `${label} ${match[1]}`;
  }
  const safari = s.match(/Version\/(\d+(?:\.\d+)*).*Safari\//);
  if (safari) return `Safari${ios ? '（iOS）' : ''} ${safari[1]}`;
  return s ? 'ブラウザ名を確認できません' : '未記録';
}

function stackFrames(stack = '') {
  return String(stack).split('\n').flatMap(line => {
    const m = line.match(/(https?:\/\/[^\s)]+):(\d+):(\d+)\)?\s*$/);
    if (!m) return [];
    try { return [{ url: new URL(m[1]), line: Number(m[2]), column: Number(m[3]), text: line }]; } catch { return []; }
  });
}

export function isServiceWorkerRegistrationError(e = {}) {
  const stack = String(e.stack || '');
  return /serviceWorker\.register\b/i.test(stack) && /\bregisterSW\.js\b/i.test(stack);
}

export function diagnoseError(e = {}) {
  const raw = String(e.message || '').trim();
  const msg = raw.toLowerCase();
  const code = String(e.error_code || '').toLowerCase();
  const source = e.source || '';
  const frames = stackFrames(e.stack);
  const first = frames[0];
  let origin = '発生元を確認できません';
  let sameDocument = false;
  try {
    const page = new URL(e.url);
    sameDocument = frames.length > 0 && frames.every(f => f.url.origin === page.origin && f.url.pathname === page.pathname);
    if (first) origin = first.url.origin === page.origin
      ? (sameDocument ? 'ページURL上のスクリプト（注入元は未特定）' : `サイト配信ファイル：${first.url.pathname}`)
      : `別ドメインのスクリプト：${first.url.hostname}`;
  } catch { /* 旧記録にURLがない時は発生元を断定しない */ }
  const impact = source === 'error_boundary'
    ? '描画失敗を検知（エラー案内への切替を記録）'
    : '画面の表示停止は確認できません';
  const result = (key, category, title, cause, action, evidence, confidence = '原因未特定', extra = {}) => ({
    key, category: source === 'error_boundary' ? 'render' : category,
    title, cause, action, evidence, confidence, origin, impact,
    location: first ? `${first.url.origin}${first.url.pathname}:${first.line}:${first.column}` : '未記録',
    browser: browserLabel(e.user_agent), ...extra,
  });

  if (isServiceWorkerRegistrationError(e)) return result('service_worker_registration', 'browser',
    'Service Workerの登録失敗', 'Service Worker登録APIで失敗した記録です。拒否の詳しい理由は確認できません。',
    '読み込まれたregisterSW.jsの版と、登録失敗後のオンライン表示を確認する。',
    'スタックにserviceWorker.registerとregisterSW.jsの両方があります。', '発生処理を確認', { origin: 'Service Worker登録処理' });

  // 2026-10-27にGoogle配信の日本語版el_mainを照合。詳細はdocs/error-cause-2026-10-27.md。
  // Laだけでは断定しない。3フレーム・Li関数・iOS Chrome・ページURLの全条件を要求する。
  if (raw === 'La' && source === 'unhandledrejection' && /\bCriOS\//.test(e.user_agent || '') &&
      /iPhone|iPad|iPod/.test(e.user_agent || '') && frames.length >= 3 && sameDocument) {
    const positions = [[518, 344], [196, 221], [197, 338]];
    const matched = frames.length === 3 && positions.every(([line, column], i) => frames[i].line === line && frames[i].column === column) && /^Li@/.test(frames[1].text);
    if (matched) return result('chrome_ios_translate_request', 'browser', 'Chrome翻訳の通信処理失敗',
      'Google配信の翻訳スクリプトにある、翻訳リクエストの実行・応答処理の失敗後にLaを返す経路と3か所のスタックが一致しました。通信失敗の詳細（回線・拒否・応答内容など）はこの記録から確認できません。',
      '翻訳を無効にして再読み込みし、通常表示と操作を確認する。再発時は翻訳の通信結果を確認する。サイトの障害や解決済みと自動判定せず、記録を保持する。',
      'Google翻訳の日本語版el_mainの518:344、Liの196:221、197:338と一致（2026-10-27照合）。',
      '発生元をコード照合済み', { origin: 'Chromeが挿入したGoogle翻訳スクリプト', reference: TRANSLATE_SCRIPT_URL });
    return result('chrome_ios_translate_candidate', 'browser', 'Chrome翻訳の通信失敗候補',
      'Chromeの翻訳スクリプトには、翻訳リクエストの実行・応答処理の失敗後にLaを返す経路があります。今回の記録は同型ですが、端末で実行された翻訳スクリプトと通信結果がないため原因の確定はできません。',
      'iPhone版Chromeで翻訳の有効・無効を切り替えて同じ操作を確認する。翻訳中の通信失敗と実行スクリプトを照合する。記録は保持する。',
      'iOS版Chrome・La・未処理Promise・ページURL上の3フレーム以上が一致。Chromium #571648515に同型の報告があります。',
      '原因候補（未確定）', { reference: TRANSLATE_ISSUE_URL });
  }

  if (/importing a module script failed|dynamically imported module|loading (?:css )?chunk|unable to preload css/.test(msg)) {
    const css = /css/.test(msg);
    return result(css ? 'css_resource' : 'js_resource', 'deploy', css ? 'CSSの読み込み失敗' : 'JavaScriptの読み込み失敗',
      '画面に必要なファイルを取得・読み込みできませんでした。更新時の版違い、通信、配信のどれが原因かは記録だけでは確認できません。',
      '対象ファイルの応答と、公開中の版・端末が読んだ版を照合する。再読み込み後の復帰を確認する。',
      'メッセージにファイルの読み込み失敗が記録されています。', '失敗した処理を確認');
  }
  if (/row-level security|permission denied/.test(msg) || code === '42501') return result('db_permission', 'db',
    'DBの権限による拒否', 'DBが操作を拒否しています。意図した制限か設定不備かは未確定です。',
    '対象操作・本人の権限・DBの許可条件を照合する。', '権限エラーのコードまたはメッセージがあります。', '拒否の種類を確認');
  if (/duplicate key|unique constraint/.test(msg) || code === '23505') return result('db_duplicate', 'db',
    'DBの重複制約による拒否', '同じキーの記録が存在するため書き込みが拒否されています。',
    '保存済みの内容と今回の操作を照合する。成功扱いにする前に保存結果を確認する。', '重複エラーのコードまたはメッセージがあります。', '拒否の種類を確認');
  if (/statement timeout/.test(msg) || code === '57014') return result('db_timeout', 'db',
    'DB処理のタイムアウト・取消', 'DB処理が時間切れまたは取り消されました。負荷やロックの有無は未確認です。',
    '同時刻のDBログ・処理時間・保存結果を確認する。', 'SQLSTATEまたはDBの時間切れメッセージがあります。', '失敗した処理を確認');
  if (/violates/.test(msg) || ['42p13', '22p02'].includes(code) || code.startsWith('pgrst')) return result('db_other', 'db',
    'DB・データAPIのエラー', 'データ処理が失敗しています。エラーコードと対象操作の確認が必要です。',
    'エラーコード、入力形式、対象テーブルの条件を確認する。', `エラーコード：${e.error_code || '未記録'}`);
  if (/smtp|gomail|magic link|otp|error sending/.test(msg) || e.component === 'LoginScreen') return result('auth_failure', 'auth',
    'ログイン・メール処理の失敗', '認証またはメール送信に関連する処理が失敗しています。',
    '操作名と認証サービスの応答を照合する。', '認証部品・認証関連メッセージに基づく分類です。');
  if (/failed to fetch|load failed|networkerror|network error|fetch is aborted/.test(msg) || ['aborterror', 'timeouterror', 'request_timeout'].includes(code)) return result('network_failure', 'network',
    '通信結果の取得失敗・中断', '通信結果を取得できませんでした。端末・回線・サーバーのどこに原因があるかは未確定です。',
    '対象通信の応答と同時刻の発生状況を確認する。保存操作は保存結果を確認してから再実行する。',
    '通信失敗・中断を示すメッセージまたはコードがあります。', '失敗の種類を確認');
  if (/window\.(?:ethereum|solana|phantom|web3|tronlink|coinbasewalletextension|braveethereum)/.test(msg)) return result('browser_wallet', 'browser',
    'ウォレット連携コードのエラー', '暗号資産ウォレット用の変数を扱うコードで失敗しています。注入元は記録だけでは確認できません。',
    '端末のウォレット・拡張機能と発生スクリプトを照合する。', 'メッセージにウォレット用の変数名があります。', '原因候補（未確定）');
  if (source === 'error_boundary') return result('react_render_failure', 'render', '画面の描画失敗',
    '画面の描画中にエラーが捕捉されました。根本原因はメッセージとスタックを照合して調べます。',
    '該当部品のスタックと直前の操作を確認する。', 'AppErrorBoundaryが描画失敗を捕捉した記録です。', '描画失敗を検知');
  if (source === 'unhandledrejection') return result('unhandled_promise', 'async', '非同期処理の未処理エラー（原因未特定）',
    '非同期処理の失敗が処理されず、全体の監視に届きました。これだけでは失敗した機能や画面停止を特定できません。',
    '発生スクリプト、操作名、同時刻の通信結果を確認する。メッセージだけで除外しない。',
    '発生源がunhandledrejectionです。');
  if (source === 'window.onerror' || /minified react error|is not a function|is not defined|can't find variable|cannot read propert|undefined is not an object|before initialization/.test(msg)) return result('runtime_exception', 'runtime',
    'JavaScript実行中のエラー', 'スクリプトの実行中に失敗しました。描画失敗の記録とは区別しています。',
    '発生ファイルと行番号、操作、実際の表示を照合する。', '実行時例外の発生源またはメッセージがあります。');
  return result('unknown', 'other', '原因未特定のエラー', '原因を判断する情報が不足しています。',
    '操作名・エラーコード・スタックを確認する。解決や影響なしと断定しない。', '既知の判定条件に一致していません。');
}
