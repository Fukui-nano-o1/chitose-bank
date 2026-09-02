// あなたの求人（お仕事タブの求人面）のカード＝Airbnbのホストの「リスティング」ページのカードの写し
// （2026-09-02たきと指示「あなたの求人ページもAirbnbをパクれ」）。
// Airbnbのホスト側のカードは、客側のカード（写真＋題名＋場所＋金額）とは別物：
//   写真（ほぼ正方形・角丸12）の左上に【状態のピル】（白い丸・色つきの点＋文字）／下に題名（太字）／
//   その下に灰色の1行（場所）。金額・報酬は出さない（自分の求人の一覧に金額は要らない）。
// ★コードは写せない（プロプライエタリ）＝写したのは構成と見た目の言語（NavIcon・TimeTree・WNと同じ判断）。
// ★本番（FarmerDashboard）と見本帳（AdminFarmerPagesRoom）が同じ部品を使う＝見本帳の写経を増やさない。
import { Avatar } from "./ui";
import { NavIcon } from "./NavIcons";
import { isJobEnded, isJobUnpublished, photoThumb } from "../lib/utils";

// 状態のピル（Airbnbの Listed / Unlisted / In progress の型）＝求人の行から導く（表示用の別状態を持たない）
//   作成中（一度も掲載していない下書き）／公開間近（掲載申請済み）／掲載中／満員／一時非公開／終了
export function ownJobState(d) {
  if (isJobEnded(d)) return { label: "終了", dot: "#9E9E9E" };
  if (d.status === "pending") return { label: "公開間近", dot: "#0E8A6B" };
  if (d.status === "open") {
    const filled = d.headcount != null && d.hired_count != null && Number(d.hired_count) >= Number(d.headcount);
    return filled ? { label: "満員", dot: "#9E9E9E" } : { label: "掲載中", dot: "#00A86B" };
  }
  if (isJobUnpublished(d)) return { label: "一時非公開", dot: "#757575" };
  return { label: "作成中", dot: "#F5A623" };
}

// title＝作物 作業（無ければ「無題の求人」）／sub＝場所・日程の1行／jobNumber＝#No.（必ず読める）
// state＝ownJobState の返り値／photo＝サムネのURL（無ければ求人者のアイコン）
// badge＝右上の小さなバッジ（未回答の質問「?N」など）。onOpen＝カードのタップ
export function OwnJobTile({ title, sub, jobNumber, state, photo, avatarUrl, avatarName, badge, onOpen, dataGuide }) {
  return (
    <div role="button" tabIndex={0} onClick={onOpen} data-guide={dataGuide}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen && onOpen(); } }}
      className="cb-btn-press" style={{ cursor: "pointer", minWidth: 0 }}>
      <div style={{ position: "relative", aspectRatio: "20 / 19", borderRadius: 12, overflow: "hidden", background: "#F0F0F0" }}>
        {photo ? (
          <img src={photo} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          // 写真が無い求人＝求人者（自分）のアイコン（2026-08-31）。ダミーの写真は置かない
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#C8C8C8" }}>
            {avatarUrl || avatarName ? <Avatar url={avatarUrl} name={avatarName || "？"} size={56} /> : <NavIcon name="image" size={32} />}
          </div>
        )}
        {state && (
          <span className="f-sans" style={{ position: "absolute", top: 10, left: 10, display: "inline-flex", alignItems: "center", gap: 6,
            background: "#fff", color: "#222", fontSize: 12, fontWeight: 700, lineHeight: 1, borderRadius: 20, padding: "6px 10px",
            boxShadow: "0 1px 4px rgba(0,0,0,0.15)" }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: state.dot, flexShrink: 0 }} />
            {state.label}
          </span>
        )}
        {badge}
      </div>
      <div style={{ marginTop: 10, minWidth: 0 }}>
        <div className="f-sans" style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#222", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: "1 1 auto" }}>{title}</span>
          {jobNumber != null && <span style={{ fontSize: 12, fontWeight: 600, color: "#717171", flexShrink: 0 }}>#{jobNumber}</span>}
        </div>
        {sub && <div className="f-sans" style={{ fontSize: 13, color: "#717171", lineHeight: 1.5, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
      </div>
    </div>
  );
}

// 一覧の器（Airbnbの Listings の格子）＝appStyles の .cb-own-jobs-grid（スマホ2列／PCは大きめのカードで幅なり）。
// 列の数は幅で変わるので CSS 側に置く（インラインでは @media が書けない）
export const OWN_JOB_GRID_CLASS = "cb-own-jobs-grid";

// サムネの取り出し（jobs の photos＝[{url,thumb,caption}] または旧 string[]）
export function ownJobPhoto(d) {
  const p = Array.isArray(d?.photos) ? d.photos[0] : null;
  return p ? photoThumb(p) : "";
}
