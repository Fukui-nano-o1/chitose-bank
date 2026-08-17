// ルート分割の自己修復（第2次構造改革2026-08-17でApp.jsxから移設・中身は不変）。
// アプリの入口の裏方＝どのfeatureにも属さないので app/ に置く。
import { lazy } from "react";
import { Dots } from "../components/ui";

// ルート分割（2026-07-25）：大物は到達時に読み込む（初期バンドル削減）。named export→lazyのdefault変換
// チャンク取りこぼしの自己修復（2026-07-26導入・2026-08-07改修）：
// 新デプロイでチャンク名（ハッシュ）が変わるため、古いページを握ったままの端末は旧チャンクを
// 404で取りに行き「Importing a module script failed」で失敗する。失敗を捕まえて再読込し、
// 新しいビルドを取りに行く。
// 【2026-08-07改修の理由＝無限リロードループの根治】旧実装は「成功時にフラグを消す」ため、
// 再読込後に別チャンクが成功→フラグ消滅→壊れたチャンクが再失敗→また即再読込…の1秒間隔の
// ループが成立していた（app_errorsに同文言が毎秒連発した真因・×94）。
// 【2026-08-08再改修＝「新しく求人を出すが遷移しない」の真因】10分に1回だけの時刻ガードは、
// デプロイが連続する日に2回目の失敗をブロックし、タップしても無反応になっていた
// （14:12のapp_errorsに同文言×4＝ガード作動中の実録）。時刻1点でなく履歴方式に変更：
// ・前回の自動再読込から20秒以内は再読込しない（毎秒ループの芯止めはこれで足りる）
// ・直近10分間で最大3回まで（連続デプロイ日でも自己修復が効き続ける。壊れたままなら3回で止まる）
const CHUNK_RELOAD_INTERVAL = 10 * 60 * 1000; // 履歴の窓
const CHUNK_RELOAD_MIN_GAP = 20 * 1000;       // 再読込どうしの最小間隔
const CHUNK_RELOAD_MAX = 3;                   // 窓内の最大回数
function chunkReloadAllowed(now) {
  let hist = [];
  try { hist = JSON.parse(sessionStorage.getItem("cb_chunkReloadHist") || "[]"); } catch {}
  if (!Array.isArray(hist)) hist = [];
  hist = hist.filter(t => Number.isFinite(t) && now - t < CHUNK_RELOAD_INTERVAL);
  if (hist.length >= CHUNK_RELOAD_MAX) return false;
  if (hist.length && now - Math.max(...hist) < CHUNK_RELOAD_MIN_GAP) return false;
  hist.push(now);
  try { sessionStorage.setItem("cb_chunkReloadHist", JSON.stringify(hist)); } catch {}
  return true;
}
// 再読込が「また古いビルド」を掴み直すのを防ぐ下ごしらえ（低速回線でNetworkFirstが3秒で諦めると
// pages-cacheの古いindex.htmlに落ちるため、再読込だけでは治らないことがある）：
// ①SWに更新チェックをさせる ②【新しいSWの有効化まで待つ】③古いページキャッシュを捨てる
// ★②が本丸（2026-08-16）：旧実装はupdate()を3秒で見切って即reloadしていたため、新SWの
// インストール（precache約1.85MB）が終わる前に再読込→また旧precacheのindex.htmlを掴み直し、
// 自己修復が「直らない再読込」を繰り返していた（10:14 #/admin・10:16 #/work/edit/1239 の実録）。
// skipWaiting+clientsClaim構成のでインストール完了＝即有効化。activated（または更新なし）を
// 確認してからreloadすれば1回で新ビルドに乗る。全体は15秒で必ず打ち切る（reloadは必ず走る）
export async function prepareFreshReload() {
  try {
    await Promise.race([
      (async () => {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (!reg) return;
        try { await reg.update(); } catch {}
        const sw = reg.installing || reg.waiting;
        if (sw && sw.state !== "activated") {
          await new Promise((resolve) => {
            const onState = () => { if (sw.state === "activated" || sw.state === "redundant") resolve(); };
            sw.addEventListener("statechange", onState);
            onState(); // 登録前に遷移済みのケースを取りこぼさない
          });
        }
        // installing/waitingが無い＝更新なし（一過性のネットワーク失敗等）→待たずに進む
      })(),
      new Promise(r => setTimeout(r, 15000)),
    ]);
  } catch {}
  try { await caches.delete("pages-cache"); } catch {}
}
// 自己修復（新SW待ち→reload）の間に出すつなぎの画面。エラーバウンダリの「表示できませんでした」を
// 見せない（壊れたのではなく更新中なので、その通りの顔を出す）。reloadはprepareFreshReloadの
// 15秒打ち切りにより必ず数秒〜15秒以内に走る＝この画面に closed 経路は不要
export function ChunkUpdating() {
  return (
    <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
      <div style={{ width: 28, height: 28, border: "3px solid #E8E8E8", borderTopColor: "#00A86B", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
      <p className="f-sans" style={{ fontSize: 14, color: "#717171", margin: 0 }}>新しいバージョンに更新しています<Dots /></p>
    </div>
  );
}
export function lazyChunk(factory) {
  return lazy(() => factory().catch(async (err) => {
    try {
      if (chunkReloadAllowed(Date.now())) {
        // reloadは裏で進め、画面には「更新中」を出す（awaitで止めるとSuspenseのfallbackが
        // 消えたまま白画面になる時間が生まれるため、先につなぎの部品を返す）
        (async () => { try { await prepareFreshReload(); } catch {} window.location.reload(); })();
        return { default: ChunkUpdating };
      }
    } catch {}
    throw err;
  }));
}
