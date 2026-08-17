// 画面が真っ暗になるのを止める最後の壁（第2次構造改革2026-08-17でApp.jsxから移設・中身は不変）。
import { Component } from "react";
import { clearCache } from "../lib/viewCache";
import { prepareFreshReload } from "./chunkReload";
import { logAppError } from "./diagnostics/errorLog";

// 画面が真っ暗になるのを止める最後の壁（2026-07-31・委託ページで再発）。
// lazyChunk の自己修復は「間隔つきの自動再読込」ので、間隔内に再失敗すると
// 例外がそのまま上まで抜け、React がツリーごと外して何も描かれない＝真っ暗になる。
// ここで受け止めて、原因と次の一手（再読み込み）を必ず画面に出す。エラーは app_errors にも残す。
export class AppErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false, chunk: false }; }
  static getDerivedStateFromError(error) {
    const msg = String(error?.message || error || "");
    // 動的importの失敗＝古いチャンクを掴んだまま（デプロイ直後に起きる）。文言を分ける
    const chunk = /importing a module script failed|failed to fetch dynamically imported module|error loading dynamically imported module/i.test(msg);
    return { failed: true, chunk };
  }
  componentDidCatch(error, info) {
    logAppError({ source: "error_boundary", component: "app", action: "render_error", error, metadata: { componentStack: String(info?.componentStack || "").slice(0, 1000) } });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="f-sans" style={{ maxWidth:420, margin:"64px auto", padding:"28px 24px", textAlign:"center", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16 }}>
        <p style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 8px" }}>{this.state.chunk ? "新しい版に更新されました" : "画面を表示できませんでした"}</p>
        <p style={{ fontSize:13, color:"#717171", lineHeight:1.7, margin:"0 0 18px" }}>
          {this.state.chunk
            ? "アプリが更新されたため、古い画面のままでは開けません。再読み込みすると最新の画面になります。"
            : "一時的な不具合の可能性があります。再読み込みしても直らない場合は、この画面を報告してください。"}
        </p>
        <button onClick={async ()=>{
          // 自己修復（2026-08-03）：描画エラーの原因が永続キャッシュ（viewCache）の壊れた・古い形の
          // データだった場合、リロードだけでは同じデータで落ち続ける。再読み込み時は表示キャッシュを
          // 全部捨ててから読み直す（キャッシュは表示専用ので捨てても最新を取り直すだけ・実害なし）
          try { clearCache(); } catch {}
          try { sessionStorage.removeItem("cb_chunkReload"); } catch {}
          // 手動の再読み込みも新ビルドを確実に取りに行く（2026-08-07・古いindex.htmlの掴み直し防止）
          await prepareFreshReload();
          window.location.reload();
        }}
          style={{ padding:"12px 26px", fontSize:14, fontWeight:700, background:"#222", color:"#fff", border:"none", borderRadius:12, cursor:"pointer" }}>再読み込み</button>
      </div>
    );
  }
}
