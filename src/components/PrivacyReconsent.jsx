// プライバシーポリシーの再同意（2026-08-19たきと指示）。
// ・現行版（lib/utils.js PRIVACY_VERSION）と account_holders.agreed_privacy_version が違う人に出す。
// ・同意すると agreed_privacy_version を現行版に更新する＝DB側のゲート
//   （contract_emergency_contact の not_consented・app_settings.privacy_version）が開く。
// ・同意するまで閉じられない。閉じられるお知らせは、2026-07-21のバナーが期限切れのまま
//   誰にも届かなかった前例があるため採らない。
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { PRIVACY_VERSION } from "../lib/utils";
import { Dots } from "./ui";

export default function PrivacyReconsent({ authId, onAgreed, onShowPrivacy }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const agree = async () => {
    if (busy) return;
    setBusy(true); setErr("");
    const { error } = await supabase.from("account_holders")
      .update({ agreed_privacy_version: PRIVACY_VERSION })
      .eq("auth_id", authId);
    setBusy(false);
    if (error) { setErr("保存できませんでした。通信の状態をご確認のうえ、もう一度お試しください。"); return; }
    onAgreed();
  };

  return (
    <div className="f-sans" style={{ maxWidth:560, margin:"0 auto", padding:"8px 0 40px" }}>
      <h1 style={{ fontSize:22, fontWeight:800, color:"#222", margin:"0 0 10px" }}>プライバシーポリシーを改訂しました</h1>
      <p style={{ fontSize:14, color:"#444", lineHeight:1.9, margin:"0 0 18px" }}>
        お使いいただくには、改訂後の内容へのご同意が必要です。内容をご確認のうえ、下のボタンを押してください。
      </p>

      <div style={{ background:"#F7F7F7", border:"1px solid #EBEBEB", borderRadius:16, padding:"18px 20px", marginBottom:18 }}>
        <p style={{ fontSize:13, fontWeight:700, color:"#222", margin:"0 0 10px" }}>おもな改訂の内容</p>
        <ul style={{ margin:0, paddingLeft:18, fontSize:13, color:"#444", lineHeight:1.9 }}>
          <li>取得する情報ごとに、利用目的を一覧表に明記しました。</li>
          <li>緊急連絡先は、新規登録の氏名と電話番号を初期値として登録し、いつでも変更と削除ができます。</li>
          <li>緊急連絡先は、採用が成立した相手方にのみ表示します。求人一覧や公開されるプロフィールには表示しません。</li>
          <li>情報ごとの保存期間を、具体的な期間で定めました。</li>
          <li>ご本人の請求（開示・訂正・利用停止など）の手続を定めました。</li>
        </ul>
      </div>

      <button onClick={onShowPrivacy} style={{
        width:"100%", padding:"13px", marginBottom:12, background:"#fff", border:"1px solid #EBEBEB",
        borderRadius:12, fontSize:14, fontWeight:600, color:"#222", cursor:"pointer", fontFamily:"inherit",
      }}>プライバシーポリシーの全文を読む</button>

      {err && <p style={{ fontSize:13, color:"#E24B4A", lineHeight:1.7, margin:"0 0 12px" }}>{err}</p>}

      <button onClick={agree} disabled={busy} style={{
        width:"100%", padding:"15px", background:"#00A86B", border:"none", borderRadius:12,
        fontSize:15, fontWeight:700, color:"#fff", cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1, fontFamily:"inherit",
      }}>{busy ? <>保存しています<Dots /></> : "同意して続ける"}</button>

      <p style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.7, margin:"12px 0 0" }}>
        ご同意いただいた版数と日時を記録します。
      </p>
    </div>
  );
}
