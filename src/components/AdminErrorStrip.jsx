// 管理者専用エラー帯（2026-08-07たきと指示「エラーと管理者のみに限定する。エラーが発生したら
// 画面上部にエラータイトルを表示。重要度で色分け。点滅させろ。タップで、システムのエラーへ遷移」）
// 2026-08-06に撤回した🔔ボックスの教訓を反映した形：
//   ①タップ不要で見える（開いた画面の上部にそのまま出る） ②PC/モバイル共通 ③数字でなく日本語の見出し
// 【設計】表示は記録（app_errors）からの導出のみ＝独自の既読状態を持たない。片付けはシステムページの
// 「まとめて解決済み」＝解決すれば帯は自然に消える。古い残骸で埋まらないよう
// 【未解決かつ最終発生が直近7日】のグループだけを出す（記録自体は消えない・システムページには全部残る）。
// 描画ゲート（isAdmin）は呼び出し側（App.jsx）＝一般ユーザーには取得も描画も走らない。
// RLS（app_errorsのSELECT=管理者のみ）が二重の壁。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { groupAppErrors, explainError } from "../lib/errorCatalog";
import { getCache, setCache } from "../lib/viewCache";

const STRIP_WINDOW_DAYS = 7;
const STRIP_REFRESH_MS = 5 * 60 * 1000;
// 色はシステムページの重要度バッジと同じ系統（重大=赤／注意=橙／不明=灰）
const SEV_RANK = { high: 0, medium: 1, unknown: 2 };
const SEV_STYLE = {
  high:    { bg:"#FCEBEB", border:"#E24B4A", color:"#C0392B", label:"重大" },
  medium:  { bg:"#FEF3E2", border:"#F5A623", color:"#B26A00", label:"注意" },
  unknown: { bg:"#F7F7F7", border:"#B0B0B0", color:"#555",    label:"不明" },
};

export function AdminErrorStrip() {
  // viewCacheでSWR：前回の帯を即出し→裏で最新化（キャッシュはJSON安全な値のみ・表示専用の規則どおり)
  const [groups, setGroups] = useState(() => getCache("admin:errStrip") ?? null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const since = new Date(Date.now() - STRIP_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const res = await supabase.from("app_errors")
        .select("id,created_at,source,component,error_code,message,status")
        .eq("status", "open").gte("created_at", since)
        .order("created_at", { ascending: false }).limit(300);
      // 失敗時は上書きしない（supabase-jsはthrowせずerrorで返す・2026-08-07フェイルオープン規則）
      if (!alive || res.error) return;
      const flat = [];
      for (const c of groupAppErrors(res.data || [])) {
        for (const g of c.groups) {
          const ex = explainError(g.latest);
          flat.push({
            sig: g.sig, severity: c.severity, count: g.openIds.length,
            title: ex?.title || (g.latest.message || "(メッセージなし)").slice(0, 60),
            latestAt: g.latest.created_at,
          });
        }
      }
      flat.sort((a, b) => (SEV_RANK[a.severity] - SEV_RANK[b.severity]) || (new Date(b.latestAt) - new Date(a.latestAt)));
      setGroups(flat);
      setCache("admin:errStrip", flat);
    };
    load();
    const t = setInterval(load, STRIP_REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!groups || groups.length === 0) return null;   // エラーが無ければ何も出さない
  const top = groups[0];
  const rest = groups.length - 1;
  const sv = SEV_STYLE[top.severity] || SEV_STYLE.unknown;
  return (
    <button type="button" className="f-sans cb-err-strip"
      style={{ background: sv.bg, borderColor: sv.border, color: sv.color }}
      onClick={() => {
        // 着地先（システムページのエラー面）で該当種類を自動展開させる
        try { sessionStorage.setItem("cb_sysErrorFocus", top.sig); } catch {}
        window.location.hash = "/admin/system";
      }}>
      <span className="cb-err-strip-dot" style={{ background: sv.border }} />
      <span style={{ fontWeight: 800, flexShrink: 0 }}>{sv.label}</span>
      <span className="cb-err-strip-title">{top.title}</span>
      <span style={{ flexShrink: 0, fontWeight: 700 }}>×{top.count}{rest > 0 ? `・ほか${rest}種` : ""}</span>
    </button>
  );
}
