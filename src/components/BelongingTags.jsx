// 持ち物のタグ（2026-08-28たきと指示「持ち物はタグにしよう。自由記述は極力避けよう。
// そして、Airbnbの持ち物アイコンをパクれ」）。Airbnbの実アセットは流用できないため、
// 同じ視覚言語の線画（NavIcons）を自前で描いた＝下部ナビ・待遇バッジと同じ判断（2026-08-22）。
//
// 設計：保存の形は変えない。値は従来どおり jobs.belongings の1本の文字列で、
// タグは「、」で連結して持つ（例「軍手、長靴」）＝DB・下書き（saveDraft）・掲載時凍結・
// terms_snapshot・労働条件通知書・チャット確認カードはすべて無改修で互換。
// 旧求人の自由記述も splitBelongings（従来の表示チップと同じ区切り）で割れてそのまま出る。
// タグの一覧・アイコン対応は lib/utils の BELONGING_TAGS が唯一のソース。
// ★モジュールレベル定義を維持すること（コンポーネント内定義はフォーカス消失バグの原因）。
import { useState } from "react";
import { NavIcon } from "./NavIcons";
import { BELONGING_TAGS, splitBelongings, belongingIconName } from "../lib/utils";

// 表示用：アイコンつきチップの行（求人詳細・確認ページ・審査プレビューの「持ち物」欄）。
// プリセットに無い言葉（旧求人の自由記述・追加タグ）はアイコンなしの文字チップ＝旧📌の置き換え
export function BelongingChips({ text }) {
  const tags = splitBelongings(text);
  if (!tags.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2, justifyContent: "center" }}>
      {tags.map((t, i) => {
        const icon = belongingIconName(t);
        return (
          <span key={i} className="f-sans" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 600, color: "#222", background: "#F7F7F7", borderRadius: 20, padding: "6px 12px" }}>
            {icon && <NavIcon name={icon} size={15} style={{ flexShrink: 0 }} />}
            {t}
          </span>
        );
      })}
    </div>
  );
}

// 入力用：プリセットのタグをタップで選ぶ（求人フロー step10）。
// value＝belongings文字列そのもの・onChange にも文字列を返す＝呼び出し側の state（jobNotes）は不変。
// 一覧にない持ち物は「追加」から短い言葉で足せる（自由記述は極力避ける＝文章でなくタグとして持つ）
export function BelongingTagPicker({ value, onChange }) {
  const tags = splitBelongings(value);
  const [custom, setCustom] = useState("");
  const toggle = (label) => {
    const next = tags.includes(label) ? tags.filter(t => t !== label) : [...tags, label];
    onChange(next.join("、"));
  };
  const addCustom = () => {
    // 区切り記号は連結の「、」と衝突するため空白へ（タグが勝手に割れない）
    const t = custom.replace(/[、,・\n／/]+/g, " ").trim().slice(0, 20);
    setCustom("");
    if (!t || tags.includes(t)) return;
    onChange([...tags, t].join("、"));
  };
  // プリセット外＝追加したタグ（旧求人の自由記述もここに出る＝タップで外せる）
  const customTags = tags.filter(t => !BELONGING_TAGS.some(b => b.label === t));
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: 8 }}>
        {BELONGING_TAGS.map(b => {
          const on = tags.includes(b.label);
          return (
            <button key={b.label} type="button" onClick={() => toggle(b.label)} className="f-sans"
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "12px 4px 10px", borderRadius: 12, border: "2px solid", borderColor: on ? "#00A86B" : "#EBEBEB", background: on ? "#F0FAF5" : "#fff", color: on ? "#00A86B" : "#444", cursor: "pointer" }}>
              <NavIcon name={b.icon} size={26} />
              <span style={{ fontSize: 12, fontWeight: on ? 700 : 600 }}>{b.label}</span>
            </button>
          );
        })}
      </div>
      {customTags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {customTags.map(t => (
            <button key={t} type="button" onClick={() => toggle(t)} className="f-sans" aria-label={t + " を外す"}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#00A86B", background: "#F0FAF5", border: "2px solid #00A86B", borderRadius: 20, padding: "6px 12px", cursor: "pointer" }}>
              {t}<span aria-hidden="true" style={{ fontWeight: 700 }}>×</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input value={custom} onChange={e => setCustom(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
          placeholder="一覧にない持ち物（例：替えの靴下）" maxLength={20}
          className="field f-sans" style={{ flex: 1, fontSize: 16, marginBottom: 0 }} />
        <button type="button" onClick={addCustom} disabled={!custom.trim()} className="f-sans"
          style={{ padding: "0 16px", borderRadius: 8, border: "1px solid #DADADA", background: "#fff", color: "#222", fontSize: 13, fontWeight: 600, cursor: custom.trim() ? "pointer" : "default", opacity: custom.trim() ? 1 : 0.5, whiteSpace: "nowrap" }}>追加</button>
      </div>
    </div>
  );
}
