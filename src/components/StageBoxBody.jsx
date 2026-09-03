// 段階お祝いボックスの中身（アイコン・見出し・本文・つぎに起きること・リンク）。
// 本番（App.jsx の stageBox）と管理の見本帳（AdminBoxRegistryPage）が同じ部品で描く＝見た目を二重に持たない。
// steps＝「つぎに起きること」の行（アイコン＋太字＋灰色の説明・この画面の説明 PageGuide と同じ言語）。
// 2026-09-02たきと指示「承認された時の説明を追加」で w:approved に3行を足した。無いボックスは従来どおり本文だけ。
import React from "react";
import { NavIcon } from "./NavIcons";
import { NoticeJumpText } from "./ui";

export function StageBoxBody({ box, onLink }) {
  if (!box) return null;
  const steps = Array.isArray(box.steps) ? box.steps : [];
  return (<>
    <div style={{ marginBottom:8, color:"#00A86B" }}><NavIcon name={box.iconName} size={34} /></div>
    <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", lineHeight:1.4, margin:0 }}><NoticeJumpText text={box.head} /></p>
    <div style={{ height:1, background:"#E5E5E5", margin:"14px 0" }} />
    <p className="f-sans" style={{ fontSize:18, color:"#444", lineHeight:1.7, margin:0 }}>{box.body}</p>
    {steps.length > 0 && (
      <div style={{ display:"grid", gap:14, marginTop:16, textAlign:"left" }}>
        {steps.map((s) => (
          <div key={s.t} style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
            <span style={{ flexShrink:0, color:"#222", marginTop:1 }}><NavIcon name={s.icon} size={24} /></span>
            <span style={{ minWidth:0 }}>
              <span className="f-sans" style={{ display:"block", fontSize:15, fontWeight:700, color:"#222", lineHeight:1.5 }}>{s.t}</span>
              <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", lineHeight:1.6, marginTop:2 }}>{s.d}</span>
            </span>
          </div>
        ))}
      </div>
    )}
    {onLink
      ? <button onClick={onLink} className="f-sans" style={{ marginTop:16, background:"none", border:"none", borderBottom:"2px solid #00A86B", padding:"0 0 2px", fontSize:18, fontWeight:700, color:"#00A86B", cursor:"pointer" }}>{box.link}</button>
      : <span className="f-sans" style={{ display:"inline-block", marginTop:16, borderBottom:"2px solid #00A86B", padding:"0 0 2px", fontSize:18, fontWeight:700, color:"#00A86B" }}>{box.link}</span>}
  </>);
}

// 承認された時の「つぎに起きること」（w:approved・本番と見本帳で共用）
export const APPROVED_STEPS = [
  { icon:"hourglass", t:"承認は、まだ採用ではありません", d:"農家が「採用する」を押すと、はたらくことが決まります" },
  { icon:"chats",     t:"チャットで面接します",           d:"農家から質問や日程の相談が届きます。返事をしましょう" },
  { icon:"calendar",  t:"はたらく日は農家が決めます",     d:"採用が決まると、カレンダーに確定の予定として並びます" },
];

// 新しい応募が届いた時（f:applied・農家）＝見る→決める→期限（2026-09-02たきと指示「優先度高いものから実装」）
export const APPLIED_STEPS = [
  { icon:"views",     t:"応募者を見ます",                 d:"名前・実績・来られる日が並びます" },
  { icon:"check",     t:"承認するか見送るかを決めます",   d:"承認は採用ではありません。あとで決める（保留）もできます" },
  { icon:"hourglass", t:"作業の開始日までに決めます",     d:"決めないまま開始日が来ると、応募は自動で失効します" },
];
// 作業が完了した時（w:worked・働き手）＝評価する→相手の評価→記録に残る
export const WORKED_STEPS = [
  { icon:"star",      t:"仕事の評価をします",             d:"求人との違い・報酬・またはたらきたいか、の3問です" },
  { icon:"views",     t:"相手の評価は揃うと見られます",   d:"お互いの評価が揃うか、完了から3日たつと表示されます" },
  { icon:"clipboard", t:"はたらいた記録に残ります",       d:"日数と時間が、あなたの実績に加わります" },
];
// 作業が完了した時（f:worked・農家）＝評価する→また呼びたい→相手の評価
export const F_WORKED_STEPS = [
  { icon:"star",      t:"バイトの評価をします",           d:"仕事は完了したか・またこの人と働きたいか、などの3問です" },
  { icon:"heart",     t:"また呼びたい登録ができます",     d:"登録すると次の求人のお知らせが届き、即決ONの求人では自動で承認されます" },
  { icon:"views",     t:"相手の評価は揃うと見られます",   d:"お互いの評価が揃うか、完了から3日たつと表示されます" },
];
