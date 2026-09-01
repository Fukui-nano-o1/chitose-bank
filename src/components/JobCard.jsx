// 求人カード（分割・段階2後半・2026-07-24）：さがす一覧・関連求人・いいね一覧で共用。
// ★Airbnbの型（2026-08-31たきと指示「求人カードの要素もパクれ」）：
//   写真は素のまま（角丸・左上に白いバッジ・右上に♥）。文字は写真に【重ねない】＝下に4行：
//   太字の題名（＋#No.）／グレーの場所／グレーの日付／太字の金額。related/wide の
//   黒グラデのオーバーレイは廃止＝全variantが同じ型（サイズだけ違う）。
import { useState } from "react";
import { payLabel, dateRangeLabel, photoThumb } from "../lib/utils";
import { Avatar } from "./ui";
import { CropIcon } from "./CropIcon";
import { NavIcon, NavIconInline } from "./NavIcons";

// 関連（横並び）カードの寸法。カードの外側に何かを重ねる時（自分の求人の状態の帯・未回答の❓）は
// 包む側も同じ幅を持たせる＝ここを変えれば包む側も一緒に変わる（幅の値を2箇所に書かない）
export const JOB_CARD_RELATED_SIZE = { width:"80vw", maxWidth:280 };

// 写真の高さ。★概要that写真の下に出る型（2026-08-31）になったので、カードの高さ＞写真の高さ。
// カードに帯などを重ねる側（自分の求人の StatusRibbon・見本帳）は inset:0 でなくこの高さで
// 切り抜くこと＝重ねものは写真の中に収める（文字の行に掛けない）
export const JOB_CARD_PHOTO_H = 220;

// 求人カード（さがす一覧・関連求人で共通使用。variantでサイズのみ切り替え）
// saved/onToggleSaveを渡すと右上に♡ボタンを表示（未指定なら非表示＝呼び出し元は変更不要）
// variant="wide"（2026-08-07）：関連カードと同じ「写真に情報を重ねる」型を全幅で。
//   ステータスページの展開ボックス等、シート内の求人要約用（要約の顔を独自に作らない＝このカードが唯一のソース）
// onOpen（任意）：渡すと新しいタブでなくその場の遷移をonOpenに任せる（シート内から同一タブで開く用）
// hideEndLabel（任意）：終了帯（募集終了/掲載終了/募集期間終了）を出さない。段階を別に語る場所（ステータス
//   ページの展開ボックス）専用。既定は従来どおり表示ので、渡していない呼び出し元は無変更
// views（任意・2026-08-21たきと指示）：この求人thatタップされた総数。❤️の左横に 👀N で出す。
//   渡さない／0以下なら何も出さない＝呼び出し元は無変更（数字thatゼロの求人に0を出さない・憲法3条）
export function JobCard({ job, variant, saved, onToggleSave, onOpen, hideEndLabel, views }) {
  const isList = variant === "list";
  const isWide = variant === "wide";
  // タップポップ（2026-08-07たきと指示）：タップの瞬間、写真が少し拡大して元に戻る。
  // 発火はonClick（スクロール開始のタッチでは鳴らない）。ハートはstopPropagationでカードに
  // 伝わらないため、ハート側からも同じトリガーを呼ぶ。アニメ終了でclass解除＝次のタップで再生
  const [photoPop, setPhotoPop] = useState(false);
  const popPhoto = () => setPhotoPop(true);
  const photoAnim = photoPop ? { animation: "cbPhotoTapZoom .35s ease" } : {};
  const p0 = job.photos?.[0];
  const topSrc = photoThumb(p0); // カードは軽量サムネ（thumbが無い古い写真は原寸へフォールバック）
  const photoHeight = JOB_CARD_PHOTO_H;
  // Airbnb風：写真は四隅を丸く（枠なしカード・2026-07-19）
  const photoRadius = 16;
  const cardStyle = isList
    ? { display:"block", width:"100%", padding:0, textAlign:"left", cursor:"pointer", textDecoration:"none", background:"transparent", border:"none", marginBottom:22, position:"relative" }
    : isWide
    ? { display:"block", width:"100%", padding:0, textAlign:"left", cursor:"pointer", textDecoration:"none", background:"transparent", border:"none", position:"relative" }
    // ★display:"block" は必須（2026-08-23修理）：<a>の既定は inline so、width/maxWidth thatが効かない。
    //   さがす・関連求人ではカードthat flex コンテナの【直接の子】so自動でblock化され、たまたま効いていた。
    //   カードを<div>で包む使い方（自分の求人＝帯や❓を重ねる）では inline のまま潰れ、
    //   絶対配置の概要（金額・バッジ）thatが1文字ずつ折り返して縦書きに見える不具合になった
    : { display:"block", flexShrink:0, ...JOB_CARD_RELATED_SIZE, padding:0, textAlign:"left", cursor:"pointer", textDecoration:"none", background:"transparent", position:"relative" };
  return (
    <a
      data-guide="job-card"
      href={"#/work/job/" + job.id}
      target={onOpen ? undefined : "_blank"}
      rel="noopener noreferrer"
      style={cardStyle}
      onClick={onOpen ? (e) => { e.preventDefault(); popPhoto(); onOpen(); } : popPhoto}
    >
      {/* 👀 閲覧数（2026-08-21たきと指示）：❤️の左横。❤️thatが出ない求人（終了中・いいね不可の面）では
          その場所（右端）に寄る＝どちらの場合も写真の右上に1つの群れとして収まる。
          数字は job_view_counts の集計＝誰that見たかは持たない。0件のうちは出さない（ダミー禁止・憲法3条） */}
      {Number(views) > 0 && (() => {
        const hasHeart = typeof onToggleSave === "function" && !(job.filled || job.expired || job.closed);
        return (
          <span className="f-sans" aria-label={`閲覧数 ${views}`}
            style={{ position:"absolute", top:10, right: hasHeart ? 62 : 10, zIndex:2, height:44,
                     display:"flex", alignItems:"center", gap:4, padding:"0 12px", borderRadius:22,
                     background:"rgba(255,255,255,0.92)", boxShadow:"0 1px 4px rgba(0,0,0,.18)",
                     fontSize:13, fontWeight:700, color:"#555", whiteSpace:"nowrap", pointerEvents:"none" }}>
            <NavIcon name="views" size={15} />{views}
          </span>
        );
      })()}
      {typeof onToggleSave === "function" && !(job.filled || job.expired || job.closed) && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); popPhoto(); onToggleSave(job); }}
          aria-label={saved ? "いいねを解除" : "いいね"}
          style={{ position:"absolute", top:10, right:10, zIndex:2, width:44, height:44, borderRadius:"50%",
                   background:"rgba(255,255,255,0.92)", border:"none", cursor:"pointer",
                   display:"flex", alignItems:"center", justifyContent:"center",
                   boxShadow:"0 1px 4px rgba(0,0,0,.18)", fontSize:24,
                   color: saved ? "#E24B4A" : "#717171" }}>
          {/* グリフだけspanに包む＝ぷるんぷるん（cb-like-heart・スクロール連動）のtransformをボタン円に波及させない */}
          <span className="cb-like-heart" style={{ display:"inline-block" }}><NavIcon name={saved ? "heartFill" : "heart"} size={22} /></span>
        </button>
      )}
      {/* 新着：左上の白いピル（Airbnbの「ゲストのお気に入り」バッジの写し・旧＝赤いリボン帯）。
          終了中（満員/期間終了）は出さない。日付は写真に重ねず下の文字の行へ（同2026-08-31） */}
      {job.isNew && !(job.filled || job.expired || job.closed) && (
        <span className="f-sans" style={{ position:"absolute", top:10, left:10, zIndex:2, background:"rgba(255,255,255,0.95)", color:"#222", fontSize: isList?12:11, fontWeight:800, padding:"5px 12px", borderRadius:20, boxShadow:"0 1px 4px rgba(0,0,0,.18)", pointerEvents:"none" }}>新着</span>
      )}
      {/* 終了帯（2026-07-21）：採用人数を満たした＝募集終了／作業日程が過ぎた＝募集期間終了。
          探すからは除外せず、写真に半透明の帯を掛けて知らせる（充足を優先表示）。
          ★hideEndLabel＝この帯を出さない（2026-08-17たきと指示「このボックスの求人にラベルは必要ない」）：
            ステータスページの展開ボックスは、上の現在地バナー（採用・作業中等）と応募の進み具合が
            自分の段階を語る場ので、求人側の「掲載終了（満員）」は要らない（自分が採用された求人に
            掲載終了と出て読み違える）。一覧・さがす等では従来どおり出す＝既定は表示 */}
      {!hideEndLabel && (job.filled || job.expired || job.closed) && (
        <div style={{ position:"absolute", top:0, left:0, right:0, height:photoHeight, borderRadius:photoRadius, background:"rgba(0,0,0,0.34)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1, pointerEvents:"none" }}>
          <span className="f-sans" style={{ background:"rgba(30,30,30,0.88)", color:"#fff", fontSize: isList?14:12, fontWeight:800, letterSpacing:".04em", padding:"7px 18px", borderRadius:8, boxShadow:"0 2px 8px rgba(0,0,0,0.3)" }}>
            {/* 満員の2段階（2026-08-14たきと指示）：満員でまだ期間中＝募集終了（満員）／
                満員かつ終了済み（closed or 期間経過）＝掲載終了（満員） */}
            {job.filled ? ((job.closed || job.expired) ? "掲載終了（満員）" : "募集終了（満員）") : job.closed ? "募集終了" : "募集期間終了"}
          </span>
        </div>
      )}
      {topSrc ? (
        <img loading="lazy" src={topSrc} alt="" onAnimationEnd={()=>setPhotoPop(false)} style={{ width:"100%", height:photoHeight, objectFit:"cover", display:"block", borderRadius:photoRadius, ...photoAnim }} />
      ) : (
        /* 写真が無い求人は求人者のアイコンを大きく出す（2026-07-30たきと指示・詳細/確認ページと同じ扱い）。
           アイコン未設定なら Avatar が名前の頭文字の丸を出し、名前も無ければ作物の絵文字に落とす */
        <div onAnimationEnd={()=>setPhotoPop(false)} style={{ width:"100%", height:photoHeight, borderRadius:photoRadius, background:"#F7F7F7", display:"flex", alignItems:"center", justifyContent:"center", fontSize:48, ...photoAnim }}>
          {(job.employerAvatar || job.employerName)
            ? <Avatar url={job.employerAvatar} name={job.employerName || "？"} size={isList ? 112 : 88} />
            : <CropIcon crop={job.crop} size={48} />}
        </div>
      )}
      {/* 概要＝写真の下（Airbnbの型・2026-08-31）：どのvariantも重ねない。
          行の並びはAirbnbのカードの写し＝太字の題名（＋#No.）／グレーの場所／グレーの日付／太字の金額。
          ★#No.は必ず読める（flexShrink:0・題名側を…で省略）＝No.検索と対 */}
      <div style={{ padding: isList ? "10px 4px 0" : "8px 2px 0" }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
          <p className="f-sans" style={{ fontSize: isList?15:14, fontWeight:700, color:"#222", margin:0, flex:"1 1 auto", minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{job.crop} {job.task}</p>
          <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", flexShrink:0, whiteSpace:"nowrap" }}>#{job.id}</span>
        </div>
        {job.region && (
          <p className="f-sans" style={{ fontSize: isList?13:12, color:"#717171", margin:"2px 0 0", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{job.region}</p>
        )}
        {job.dateStartRaw && (
          <p className="f-sans" style={{ fontSize: isList?13:12, color:"#717171", margin:"2px 0 0", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {dateRangeLabel(job.dateStartRaw, job.dateEndRaw)}
          </p>
        )}
        {/* 報酬が取れていない行（非公開求人フォールバック等）は0円を出さない（ダミー禁止・憲法3条）。
            金額はAirbnbの価格行の写し＝黒の太字（旧＝緑） */}
        {job.pay > 0 && (
          <p className="f-mono" style={{ fontSize: isList?15:14, fontWeight:800, color:"#222", margin:"5px 0 0" }}>{payLabel(job)}</p>
        )}
        {(job.beginnerOk || job.experiencedPreferred || job.instantApproveRepeat) && (
          <div style={{ display:"flex", gap:4, marginTop:6, flexWrap:"wrap" }}>
            {job.beginnerOk && <span className="f-sans" style={{ fontSize: isList?11:10, fontWeight:700, color:"#00A86B", background:"#E6F7EF", padding:"2px 8px", borderRadius:20 }}><NavIconInline name="sparkle" size={isList?11:10} style={{ verticalAlign:"-1.5px", marginRight:3 }} />初心者大歓迎</span>}
            {job.experiencedPreferred && <span className="f-sans" style={{ fontSize: isList?11:10, fontWeight:700, color:"#1A56C5", background:"#E8F0FE", padding:"2px 8px", borderRadius:20 }}><NavIconInline name="medal" size={isList?11:10} style={{ verticalAlign:"-1.5px", marginRight:3 }} />経験者優遇</span>}
            {job.instantApproveRepeat && <span className="f-sans" style={{ fontSize: isList?11:10, fontWeight:700, color:"#8A6D1D", background:"#FFF8E7", padding:"2px 8px", borderRadius:20 }}><NavIconInline name="repeat" size={isList?11:10} style={{ verticalAlign:"-1.5px", marginRight:3 }} />リピート即決</span>}
          </div>
        )}
      </div>
    </a>
  );
}
