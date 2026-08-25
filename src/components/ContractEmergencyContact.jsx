// 採用成立後の緊急連絡先の開示（当事者間のみ・2026-08-03たきと指示）。
// ・保管は専用テーブル emergency_contacts（self-only＝本人しか直接読めない）。
//   worker_profiles／employer_profiles には置かない（応募段階で農家に見えてしまうため）。
// ・★出す期間は「仕事の開始から終了まで」だけ（2026-08-25たきと指示「それ以外はいかなる理由でも
//   見せない」）。呼び出し側が workWindow={isWorkWindowOpen(応募の行)} を渡す＝渡さなければ出ない
//   （既定 false＝フェイルクローズ）。DB側の contract_emergency_contact も同じ窓で拒む（二重の壁）。
// ・唯一の窓口は SECURITY DEFINER 関数 contract_emergency_contact(application_id)。
//   当事者のみ・terms_snapshot（＝採用成立）が無ければ中身を返さない＝氏名開示（裁定B）と同じ作法。
// ・返り値：{ok:true, empty:false, name, relation, phone}／{ok:true, empty:true, message}（相手が未登録・
//   未確認）／{ok:false, reason:'not_contracted'|'not_consented', message}／not_party・not_found は何も出さない。
// ・asButton（2026-08-24たきと指示「緊急連絡先ボタンを労働条件通知書の上に配置」）：
//   求人カードでは全幅のボタンにして、タップで中身を開く。取得はタップの時に1回だけ（カードが重くならない）。
//   ★終わった仕事のカード（暗幕・pointerEvents:none）でも押せるように auto を自分で戻す＝通知書と同じ扱い。
//     ★重ね順は上げない（2026-08-24たきと指示「最前線にしなくていい」）＝暗幕がタップを飲み込まない
//     （pointerEvents:none）ので、下に居ても押せる。見た目は他と同じに暗幕の下で暗くなる。
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { NavIcon, NavIconInline } from "./NavIcons";

// 採用成立後の値だけキャッシュする（相手が後から登録・修正することがあるので empty はキャッシュしない）
const CACHE = new Map(); // applicationId -> {ok:true, empty:false, ...}

export default function ContractEmergencyContact({ applicationId, showPending = false, style, asButton = false, accent = "#E24B4A", workWindow = false }) {
  const [res, setRes] = useState(() => (applicationId && CACHE.get(applicationId)) || null);
  const [open, setOpen] = useState(false);   // asButton の開閉
  const [loading, setLoading] = useState(false);
  // 取得：ボタン式は開いた時に1回だけ／従来の置き場所（今日ページ・応募者シート）は表示のたび
  const need = workWindow && (asButton ? open : true);
  useEffect(() => {
    let live = true;
    if (!applicationId || !need) return;
    if (CACHE.has(applicationId)) { setRes(CACHE.get(applicationId)); return; }
    setLoading(true);
    (async () => {
      try {
        const { data } = await supabase.rpc("contract_emergency_contact", { p_application_id: applicationId });
        if (data && data.ok && data.empty === false) CACHE.set(applicationId, data);
        if (live) setRes(data || null);
      } catch { if (live) setRes(null); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [applicationId, need]);

  // 中身（連絡先の箱／理由の一言）
  const body = (() => {
    if (loading && !res) return <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"6px 0 0" }}>読み込み中…</p>;
    if (res && res.ok && res.empty === false) {
      return (
        <div className="f-sans" style={{ background:"#FFF4F4", border:"1px solid #F3C9C9", borderRadius:10, padding:"8px 10px", margin:"6px 0 0", ...(asButton ? null : style) }}>
          <p style={{ fontSize:11, fontWeight:700, color:"#B03A3A", margin:"0 0 2px" }}><NavIconInline name="phone" size={11} style={{ verticalAlign:"-1.5px" }} />緊急連絡先（採用が決まったため表示）</p>
          <p style={{ fontSize:13, color:"#222", margin:0, lineHeight:1.6 }}>
            {res.name}{res.relation ? `（${res.relation}）` : ""}
            {res.phone && <>　<a href={`tel:${String(res.phone).replace(/[^0-9+]/g, "")}`} style={{ color:"#B03A3A", fontWeight:700 }}>{res.phone}</a></>}
          </p>
          <p style={{ fontSize:10, color:"#B0B0B0", margin:"4px 0 0", lineHeight:1.5 }}>事故など緊急時のための連絡先です。ほかの用件では使わないでください。</p>
        </div>
      );
    }
    if (res && res.message) {
      return <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"6px 0 0", lineHeight:1.7, ...(asButton ? null : style) }}>{res.message}</p>;
    }
    return null;
  })();

  // ★仕事の開始から終了までの外では、ボタンも中身も一切出さない（2026-08-25たきと指示）
  if (!workWindow) return null;

  // ボタン式：件数や登録の有無にかかわらずボタンは出す（タップ不能・非表示にしない＝2026-08-03の原則）
  if (asButton) {
    return (
      <div style={{ ...style }}>
        {/* 背景＝赤・アイコンと文字＝白（2026-08-25たきと指示）。
            NavIcon は stroke="currentColor" なので、color:"#fff" でアイコンも一緒に白くなる */}
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="f-sans"
          style={{ width:"100%", padding:"15px 12px", fontSize:14, fontWeight:800, borderRadius:12, cursor:"pointer",
                   background:accent, color:"#fff", border:"1.5px solid " + accent,
                   pointerEvents:"auto",
                   display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
          <NavIcon name="phone" size={16} />緊急連絡先
        </button>
        {open && body}
      </div>
    );
  }

  if (!res) return null;
  if (res.ok && res.empty === false) return body;
  // 相手が未登録／採用前の案内は、置き場所によっては出さない（showPending=false が既定）
  if (showPending && res.message) return body;
  return null;
}
