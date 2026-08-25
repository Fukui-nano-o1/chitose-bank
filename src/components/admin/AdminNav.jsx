// 管理画面の共通ナビ（2026-08-02たきと指示「主要ページに全てのページ導線を新設」）。
// 管理者専用の全ページへ1タップで行き来できる横並びチップ。各主要ページの上部に設置する。
// 行き先の正はここ1箇所（ページを増減したら PAGES に足す/消すだけ・他を壊さない）。
// 遷移は window.location.hash 書き込み＝App.jsx の hashchange ルーティングに乗る（既存レール）。
// 絵文字は置かない（2026-08-03たきと指示「管理画面にアイコンは不要」）＝文字だけのチップ。
// 委託 準備室・ボックス一覧・お知らせ一覧は非表示（2026-08-07たきと指示。委託＝準備済みので導線を畳む・
// URL直打ちと雇い手プロフィール側の入口は残る／ボックス・お知らせ＝ハンバーガー☰にあるので重複導線を撤去）
const PAGES = [
  { key: "admin",       hash: "/admin",             label: "管理" },
  { key: "working",     hash: "/admin/working",     label: "仕事中" },
  { key: "upcoming",    hash: "/admin/upcoming",    label: "まもなく開始" },
  { key: "evaluation",  hash: "/admin/evaluation",  label: "評価" },
  { key: "reports",     hash: "/admin/reports",     label: "報告" },
  { key: "review-comments", hash: "/admin/review-comments", label: "コメント" },
  { key: "system",      hash: "/admin/system",      label: "システム" },
  { key: "farmer-pages", hash: "/admin/farmer-pages", label: "農家のページ" },
  { key: "animations",  hash: "/admin/animations",  label: "アニメーション" },
];

export function AdminNav({ current }) {
  return (
    <nav aria-label="管理ページ" className="admin-nav" style={{ display: "flex", gap: 6, overflowX: "auto", WebkitOverflowScrolling: "touch", padding: "2px 2px 4px", marginBottom: 14 }}>
      {PAGES.map(p => {
        const active = p.key === current;
        return (
          <button key={p.key} type="button" className="f-sans"
            onClick={() => { if (!active) window.location.hash = p.hash; }}
            aria-current={active ? "page" : undefined}
            style={{
              flexShrink: 0,
              padding: "7px 12px", borderRadius: 20, whiteSpace: "nowrap",
              border: active ? "1.5px solid #222" : "1px solid #EBEBEB",
              background: active ? "#222" : "#fff",
              color: active ? "#fff" : "#555",
              fontSize: 12, fontWeight: 700, cursor: active ? "default" : "pointer",
            }}>
            {p.label}
          </button>
        );
      })}
    </nav>
  );
}
