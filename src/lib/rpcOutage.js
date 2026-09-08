// RPCの失敗のうち「サーバーが一時的に応答しなかった」型を見分け、正確な文言を返す
// （2026-09-08 たきと指示「503やタイムアウトの時の文言は正確な文言に差し替え」）。
// 契機＝2026-09-08 23:22 JST に DB が約20秒応答せず（statement timeout → PostgREST 503 の連鎖）、
// コピー・移動が「コピーに失敗しました：<生の英文>」で落ちた。生の英文は利用者に何も伝えない。
// 見分けは2段（起きたことに嘘をつかないため）：
//  ・down … サーバーに届いたが処理されなかった（HTTP 5xx／PostgRESTのDB接続エラー PGRST0xx／
//    Postgres の statement timeout 57014＝トランザクションは巻き戻る）＝【処理は行われていない】と言える
//  ・noResponse … 応答が届かなかった（fetchの失敗＝status 0）＝サーバーで処理されたかどうかは
//    【分からない】。copy_job のように冪等でない操作では「されていない」と言い切らない
// 返り値：null（この型ではない＝呼び手が従来の文言を出す）／文字列（そのまま alert に出せる文）
// opts.notDone … down のときに添える状態の一言（例「求人はコピーされていません」）
// opts.unknown … noResponse のときに添える一言（例「コピーされたかどうかは確認できていません。作成中の一覧を確かめてから」）
export function rpcOutageKind(error, status) {
  if (!error && status !== 0) return null;
  const st = typeof status === "number" ? status : null;
  const code = String(error?.code || "");
  const msg = String(error?.message || "");
  if (st === 0 || /failed to fetch|load failed|networkerror|network request failed/i.test(msg)) return "noResponse";
  if ((st !== null && st >= 500) || code === "57014" || /^PGRST00[0-9]$/.test(code) ||
      /statement timeout|gateway|service unavailable|bad gateway|\b50[234]\b/i.test(msg)) return "down";
  return null;
}
export function describeRpcOutage(error, status, opts = {}) {
  const kind = rpcOutageKind(error, status);
  if (!kind) return null;
  if (kind === "down") {
    return "サーバーが一時的に応答していません（データベースが混み合うと、数十秒ほど続くことがあります）。"
      + (opts.notDone ? opts.notDone + "。" : "")
      + "少し待ってから、もう一度お試しください。";
  }
  return "サーバーからの応答が届きませんでした（通信が切れたか、混み合っています）。"
    + (opts.unknown ? opts.unknown + "、" : "")
    + "少し待ってからもう一度お試しください。";
}
