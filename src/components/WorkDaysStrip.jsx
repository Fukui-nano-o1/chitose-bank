// 働く日の帯（2026-08-23たきと指示「働く日と応募の進み具合を労働条件通知書の下に配置。
// 働く日は横にスクロールできるようにして。当日または次の日は中央に配置」）。
// ・雇い手の求人カード（FarmerDashboard）と働き手のカード（SavedJobsView）で共用＝日の出し方・
//   見た目を二重に作らない。色だけ役割色（accent）で受ける。
// ・日の集合とラベルは lib/utils の workDaysStripData（確定 ＞ 来られる日の申告 ＞ 求人の期間・
//   holidays を除く）＝カレンダーの塗りと同じ優先順。ここで独自に日を作らない（2026-08-31：
//   契約の物差し appWorkDates を表示に流用していて、申告で日を絞った応募だけカレンダーと食い違っていた）。
// ・中央に置く日＝今日が働く日に含まれればその日／無ければ今日より後の最初の日／
//   全部過去なら最後の日（＝直近の実績）。
// ★中央寄せは offsetLeft で測るので、スクロール要素に position:relative を必ず付ける
//   （chip の offsetParent がこの要素になる。付けないと基準がずれる）。
import { useRef, useLayoutEffect, forwardRef } from "react";
import { ymdLocal } from "../lib/utils";

const WD = ["日", "月", "火", "水", "木", "金", "土"];
// チップの器：onPick があればボタン、無ければただの箱（refを親から受けるので forwardRef）
const Chip = forwardRef(function Chip(props, ref) {
  const Tag = props.onClick ? "button" : "div";
  return <Tag ref={ref} {...props} />;
});

// onPick（任意・2026-08-23たきと指示「日程タップで応募ボックス展開」）：渡すとチップがボタンになり、
// タップした日（"YYYY-MM-DD"）を返す。渡さなければ従来どおり表示だけ
export function WorkDaysStrip({ days, accent = "#00A86B", label = "働く日", onPick }) {
  const scRef = useRef(null);
  const focusRef = useRef(null);
  const list = Array.isArray(days) ? days : [];
  const today = ymdLocal(new Date());
  const focus = list.includes(today)
    ? today
    : (list.find(d => d > today) ?? list[list.length - 1] ?? null);

  useLayoutEffect(() => {
    const el = scRef.current, chip = focusRef.current;
    if (!el || !chip) return;
    const left = chip.offsetLeft - (el.clientWidth - chip.offsetWidth) / 2;
    el.scrollLeft = Math.max(0, left);
  }, [focus, list.length]);

  if (list.length === 0) return null;

  return (
    // ★minWidth:0 / maxWidth:100%（必須）：この部品は display:grid の中に置かれる。grid の子は既定が
    //   min-width:auto ので、中の「width:max-content」の列がそのまま列幅を押し広げ、カード全体が
    //   はみ出して隣のボタンが切れる（打刻シートの time 入力と同じ型・2026-08-16）
    <div style={{ minWidth:0, maxWidth:"100%" }}>
      <p className="f-sans" style={{ fontSize:11, fontWeight:800, color:"#717171", margin:"0 0 6px" }}>
        {label}　<span style={{ color:"#B0B0B0", fontWeight:700 }}>全{list.length}日</span>
      </p>
      {/* 横スクロール（列がはみ出して実際に動く時だけ、親のスワイプに渡さない＝
          応募者アイコンの列と同じ作法）。overflowX:auto は縦も切り取るので paddingTop で逃げを確保 */}
      <div ref={scRef}
        onTouchStart={e=>{ const el = e.currentTarget; if (el.scrollWidth > el.clientWidth + 1) e.stopPropagation(); }}
        onTouchEnd={e=>{ const el = e.currentTarget; if (el.scrollWidth > el.clientWidth + 1) e.stopPropagation(); }}
        style={{ position:"relative", width:"100%", minWidth:0, maxWidth:"100%", overflowX:"auto", WebkitOverflowScrolling:"touch", overscrollBehaviorX:"contain", paddingBottom:2 }}>
        <div style={{ display:"flex", gap:6, width:"max-content", margin:"0 auto" }}>
          {list.map(d => {
            const dt = new Date(d + "T00:00:00");
            const isToday = d === today;
            const isPast = d < today;
            const isFocus = d === focus;
            return (
              <Chip key={d} ref={isFocus ? focusRef : undefined} className="f-sans"
                {...(onPick ? { onClick: () => onPick(d), type: "button" } : {})}
                style={{ flexShrink:0, minWidth:52, textAlign:"center", borderRadius:10, padding:"6px 8px", boxSizing:"border-box",
                  cursor: onPick ? "pointer" : "default", appearance:"none",
                  background: isToday ? accent : "#fff",
                  border: "1px solid " + (isToday ? accent : isFocus ? accent : "#EBEBEB"),
                  opacity: isPast && !isToday ? 0.45 : 1 }}>
                <span style={{ display:"block", fontSize:9, fontWeight:700, color: isToday ? "rgba(255,255,255,0.85)" : "#B0B0B0" }}>{WD[dt.getDay()]}</span>
                <span style={{ display:"block", fontSize:13, fontWeight:800, color: isToday ? "#fff" : isPast ? "#999" : "#222", lineHeight:1.3 }}>
                  {dt.getMonth() + 1}/{dt.getDate()}
                </span>
              </Chip>
            );
          })}
        </div>
      </div>
    </div>
  );
}
