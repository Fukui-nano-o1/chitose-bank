// 汎用UIアトム（分割・段階2後半・2026-07-24）：リボン帯・長文の省略表示。
import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { createPortal } from "react-dom";
import { APP_PHASE_LABEL, APP_PHASE_COLOR, APP_PHASE_DESC, qaShort, ROLE_ORANGE } from "../lib/utils";
import { openLoginBox } from "../lib/previewBus";
import { useSheetDragClose } from "../lib/sheetDrag";
import { useHorizontalDrag } from "../lib/hDrag";
import { readShape, writeShape, measureShape } from "../lib/skeletonShape";
import { CropIcon } from "./CropIcon";
import { NavIcon, NavIconInline } from "./NavIcons";

// チャット一覧の行の寸法（2026-08-24たきと指示「チャット一覧の空白を詰めろ。上下の余白は残す」→
// 同日「隙間ゼロにして、枠を削除。運営だけ枠あり」）。
// ★ここだけに置く＝当事者の行（ChatList）と運営の行（AdminChat）が同じ値を読む＝高さが揃う。
//   ページの外側の上下の余白（ChatListの padding:"5px 0 8px"）は指示どおり不変。
//   共有アトムに置いたのは、互いをimportし合う輪（ChatList⇄AdminChat）を作らないため
export const CHAT_ROW_GAP = 0;            // 行と行のすき間はゼロ（切れ目は下の細い線が示す）
export const CHAT_ROW_PAD = "10px 14px";
// 相手とのチャットの行は枠なし＝すき間ゼロで並べると1枚の名簿に見える。
// 行の切れ目は髪の毛ほどの線（最後の行には引かない）。運営の行だけは枠つき＝一目で別物と分かる
export const CHAT_ROW_DIVIDER = "1px solid #F0F0F0";

// メルカリSOLD風の斜めリボン（写真の右上角）。農家の求人一覧の状態表示（作成中/公開間近/公開中）
export function StatusRibbon({ label, color }) {
  return (
    <div style={{ position:"absolute", top:0, right:0, width:64, height:64, overflow:"hidden", pointerEvents:"none" }}>
      <span className="f-sans" style={{ position:"absolute", top:12, right:-30, transform:"rotate(45deg)", width:110, textAlign:"center", background:color, color:"#fff", fontSize:10, fontWeight:800, padding:"3px 0", boxShadow:"0 1px 4px rgba(0,0,0,0.25)" }}>{label}</span>
    </div>
  );
}

// 左上帯（新着用・2026-07-16）：StatusRibbonの左右反転版。白文字・赤帯で使用
export function StatusRibbonLeft({ label, color }) {
  return (
    <div style={{ position:"absolute", top:0, left:0, width:64, height:64, overflow:"hidden", pointerEvents:"none", zIndex:2 }}>
      <span className="f-sans" style={{ position:"absolute", top:12, left:-30, transform:"rotate(-45deg)", width:110, textAlign:"center", background:color, color:"#fff", fontSize:10, fontWeight:800, padding:"3px 0", boxShadow:"0 1px 4px rgba(0,0,0,0.25)" }}>{label}</span>
    </div>
  );
}

// 長文プレビュー：…で省略し、該当要素のタップで全文表示（雇い手/働き手プレビューの自己紹介など・2026-07-23）。
// 親がボタン（カード全体タップ）でも展開できるよう、クリックは伝播を止める。
export function ExpandableText({ text, limit = 100, style, moreLabel = "もっと見る", lessLabel = "閉じる", moreColor = "#00A86B" }) {
  const [open, setOpen] = useState(false);
  const s = (text == null ? "" : String(text));
  if (!s) return null;
  const truncated = s.length > limit;
  return (
    <p
      onClick={truncated ? (e) => { e.stopPropagation(); e.preventDefault(); setOpen(v => !v); } : undefined}
      role={truncated ? "button" : undefined}
      className="f-sans"
      style={{ whiteSpace:"pre-wrap", ...style, ...(truncated ? { cursor:"pointer" } : {}) }}
    >
      {open || !truncated ? s : s.slice(0, limit) + "…"}
      {truncated && <span style={{ color:moreColor, fontWeight:700 }}>{open ? `　${lessLabel}` : `　${moreLabel}`}</span>}
    </p>
  );
}

// 危険項目の表示（詳細・確認・プレビュー共通・2026-07-16）：
// タイトル=写真の上・説明=写真の内部（1枚目にグラデ帯）・全て中央配置。写真なしは⚠️色ボックス内に説明
// 入力欄の見出し＋長い説明（2026-08-19たきと指示「長文説明は？ボタンを設置してタップで展開」）。
// 画面を文字で埋めない。説明は消していない＝押せばいつでも読める（EmergencyContactBoxの作法を部品化）。
// label＝見出し／children＝説明の本文／accent＝役割色（開いている時の？の色）。
// ★短い一言（1行で収まる注記）はこれで畳まない＝畳む価値がない上に、押さないと読めない文that増えるだけ。
// プロフィール編集ページの1行（2026-08-25たきと指示「プロフィール編集ページもAirbnbをぱくれ」）。
// ★Airbnbの実物のコード・素材は複製できない（非公開・著作物）ので、見た目の言語だけを自前で写した：
//   2列の格子カード → 縦一列の行（ラベル／いまの値／右に「›」／行の間に細い区切り線）。
//   未設定は灰、必須の未設定だけ赤で示す（旧・赤影の点滅アニメは行の並びでは落ち着かないので置き換え）。
// 働き手・雇い手の両編集ページで共用＝行の見た目を2箇所に書かない。accent は役割色（橙／緑・委託は黒）。
export function ProfileEditRow({ label, value, required, flagged, accent = "#00A86B", onClick, last }) {
  return (
    <button type="button" onClick={onClick} className="f-sans"
      style={{ display:"flex", alignItems:"center", gap:12, width:"100%", textAlign:"left", background:"none",
               border:"none", borderBottom: last ? "none" : "1px solid #EBEBEB", padding:"16px 2px", cursor:"pointer" }}>
      <span style={{ minWidth:0, flex:1 }}>
        <span style={{ display:"block", fontSize:15, fontWeight:600, color:"#222" }}>{label}</span>
        <span style={{ display:"block", fontSize:13, marginTop:3, color: value ? "#717171" : (required ? "#E24B4A" : "#B0B0B0"),
                       overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{value || "未設定"}</span>
      </span>
      {flagged && (
        <span className="f-sans" style={{ flexShrink:0, background:"#E24B4A", color:"#fff", fontSize:11, fontWeight:700, borderRadius:10, padding:"3px 8px" }}>修正のお願い</span>
      )}
      {/* 未設定の目印（2026-08-28たきと指示「通知バッチつけよう」）＝下部ナビの赤バッジと同じ色・同じ意味
          （＝あなたの宿題）。名刺カードの「編集する」の数バッジと数が合うように、数え方は
          lib/utils の workerUnsetCount / employerUnsetCount に揃えてある（数の出どころを2つにしない） */}
      {!value && !flagged && (
        <span aria-label="未設定" style={{ flexShrink:0, width:8, height:8, borderRadius:"50%", background:"#E24B4A" }} />
      )}
      <span style={{ color: accent, fontSize:18, flexShrink:0 }}>›</span>
    </button>
  );
}

export function FieldHelp({ label, accent = "#00A86B", children, labelSize = 12 }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom: open ? 8 : 12 }}>
        <label className="f-sans" style={{ fontSize:labelSize, fontWeight:600, color:"#222" }}>{label}</label>
        <button type="button" onClick={()=>setOpen(v => !v)} aria-label={open ? "説明を閉じる" : "説明を見る"} aria-expanded={open}
          className="f-sans" style={{ width:22, height:22, borderRadius:"50%", flexShrink:0, cursor:"pointer",
            border:"1px solid " + (open ? accent : "#DDD"), background: open ? accent : "#fff",
            color: open ? "#fff" : "#999", fontSize:12, fontWeight:800, lineHeight:1,
            display:"flex", alignItems:"center", justifyContent:"center", padding:0 }}>?</button>
      </div>
      {open && (
        <p className="f-sans fade-in" style={{ fontSize:12, color:"#717171", marginBottom:12, lineHeight:1.6 }}>{children}</p>
      )}
    </>
  );
}

export function DangerItem({ icon, label, desc, photos, onPhotoClick }) {
  const list = (photos || []).map(p => (typeof p === "string" ? p : p?.url)).filter(Boolean);
  return (
    <div style={{ width:"100%" }}>
      <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", margin:"0 0 8px", textAlign:"center", overflowWrap:"break-word" }}>{label}</p>
      {list.length > 0 ? (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {list.map((src, k) => (
            <div key={k} style={{ position:"relative", borderRadius:8, overflow:"hidden" }}>
              <img loading="lazy" src={src} alt="" onClick={onPhotoClick ? () => onPhotoClick(src) : undefined} style={{ width:"100%", height:190, objectFit:"cover", display:"block", cursor: onPhotoClick ? "pointer" : "default" }} />
              {k === 0 && desc && String(desc).trim() && (
                <div className="f-sans" style={{ position:"absolute", bottom:0, left:0, right:0, padding:"26px 16px 12px", background:"linear-gradient(transparent, rgba(0,0,0,0.65))", color:"#fff", fontSize:13, fontWeight:600, textAlign:"center", lineHeight:1.6, boxSizing:"border-box" }}>{desc}</div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ width:"100%", minHeight:130, borderRadius:8, background:"#FEF3E2", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6, padding:"14px 16px", boxSizing:"border-box", textAlign:"center" }}>
          <span style={{ fontSize:40, lineHeight:1 }}>{icon}</span>
          {desc && String(desc).trim() && <p className="f-sans" style={{ fontSize:12, color:"#8A6D1D", margin:0, lineHeight:1.6, overflowWrap:"break-word" }}>{desc}</p>}
        </div>
      )}
    </div>
  );
}

// 共通アバター部品：写真あり→円形サムネ／写真なし→緑丸＋頭文字2字。
// 全画面（ヘッダー・応募者カード・チャット・求人詳細の紹介・プロフィール）でこれに統一する。
// ring（任意）：アイコンに役割色の枠を付ける（チャットで使用・働き手=橙／雇い手=緑・第11弾）
export const Avatar = ({ url, name, size = 40, ring, bg }) => {
  const ringStyle = ring ? { border: "2px solid " + ring, boxSizing: "border-box" } : {};
  return url
    ? <img loading="lazy" src={url} alt="" width={size} height={size}
        style={{ width:size, height:size, borderRadius:"50%", objectFit:"cover", flexShrink:0, ...ringStyle }} />
    : <div style={{ width:size, height:size, borderRadius:"50%", background: bg || ring || "#00A86B",
        color:"#fff", display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:size*0.38, fontWeight:700, flexShrink:0, ...ringStyle }}>
        {(name||"？").replace(/\s/g,"").slice(0,2)}
      </div>;
};

// プロフィールプレビューの面ページャー（タブ＋指追従スワイプ）＝唯一の実装（2026-08-21）。
// 使い手：WorkerPreviewSheet（PreviewSheets）／ProfileHubの働き手名刺カード裏面。
// 規則はボックス一覧・農家プロ作成中⇄公開中と同じ作法：横と分かってから（8px）transformを直接書く＝
// 毎フレームの再描画なしで指に付いてくる。縦の指は奪わない（touchAction:pan-y）。端は1/3の抵抗。
// タブのタップは stopPropagation＝名刺カード（タップ=反転）の中に置いても反転を起こさない
export function SwipeTabPages({ tabs, page, onPage, children }) {
  const n = tabs.length;
  const step = 100 / n;
  const trackRef = useRef(null);
  const dragRef = useRef(null); // {x, y, dx, lock:"h"|"v"|null, w}
  const basePct = () => -page * step;
  const onStart = (e) => {
    // 求人カードの横並び（.carousel-scroll）の中で始まったタッチは掴まない（2026-08-31）＝
    // 農家プレビュー「記録」のカードを送る指が面の切り替えに取られない。はみ出していない
    // （1枚だけの）列は従来どおり面の切り替えに譲る（FarmerDashboard onPagerStart と同じ判定・2026-08-23）
    const hs = e.target.closest && e.target.closest(".carousel-scroll");
    if (hs && hs.scrollWidth > hs.clientWidth + 1) { dragRef.current = null; return; }
    dragRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, lock: null, w: e.currentTarget.clientWidth || 1 };
  };
  const onMove = (e) => {
    const s = dragRef.current, el = trackRef.current;
    if (!s || !el) return;
    const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
    if (!s.lock) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.lock = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
    }
    if (s.lock !== "h") return;
    const atEdge = (page === 0 && dx > 0) || (page === n - 1 && dx < 0); // 端は1/3の抵抗
    s.dx = atEdge ? dx / 3 : dx;
    el.style.transition = "none";
    el.style.transform = `translateX(calc(${basePct()}% + ${s.dx}px))`;
  };
  const onEnd = () => {
    const s = dragRef.current, el = trackRef.current;
    dragRef.current = null;
    if (!s || !el || s.lock !== "h") return;
    el.style.transition = "transform .3s ease";
    const threshold = Math.min(80, s.w / 4);
    let next = page;
    if (s.dx < -threshold && page < n - 1) next = page + 1;
    else if (s.dx > threshold && page > 0) next = page - 1;
    el.style.transform = `translateX(${-next * step}%)`;
    if (next !== page) onPage(next);
  };
  const kids = Array.isArray(children) ? children : [children];
  return (
    <>
      {/* どの面を見ているかの目印。タップでも切り替わる（スワイプがあることに気づけるように） */}
      <div style={{ display:"flex", gap:8, margin:"0 0 14px" }}>
        {tabs.map((l, i) => (
          <button key={i} type="button" onClick={(e)=>{ e.stopPropagation(); onPage(i); }} className="f-sans"
            style={{ flex:1, padding:"9px 0", borderRadius:10, cursor:"pointer", background:"#fff",
              border: page===i ? "2px solid #222" : "1px solid #EBEBEB",
              fontSize:12, fontWeight: page===i ? 800 : 600, color: page===i ? "#222" : "#999" }}>
            {l}
          </button>
        ))}
      </div>
      <div onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} style={{ overflow:"hidden", touchAction:"pan-y" }}>
        <div ref={trackRef} style={{ display:"flex", alignItems:"flex-start", width:(n*100)+"%", transform:`translateX(${basePct()}%)`, transition:"transform .3s ease" }}>
          {kids.map((c, i) => (
            <div key={i} style={{ width:(100/n)+"%", flexShrink:0, boxSizing:"border-box",
              paddingRight: i < n-1 ? 5 : 0, paddingLeft: i > 0 ? 5 : 0 }}>
              {c}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// 読み込み中の「…」（2026-07-30たきと指示・遊び心）：点が1つずつ跳ねる。
// 読み上げには「…」1文字だけ渡す（点3つを読み上げさせない）
// 待遇のバッジ列（2026-08-24たきと指示「待遇はすべてバッジ化」）。
// 中身の正は lib/utils の perkBadges＝送迎・駐車場・通勤手当・賞与・昇給・退職手当・作業用品・
// アクセサリー・受動喫煙を、内容（時期・台数・エリア等）つきの1行ラベルで返す。
// ★ここは並べるだけ＝項目を足す・言い方を変えるときは perkBadges を直す（画面ごとに書かない）。
// 未設定の項目はバッジを作らない＝旧・待遇表の「ー」の行は出ない（記録が無いものを欄で見せない）。
// muted＝記録なしの知らせ（受動喫煙だけ・求人詳細で使う）
export function PerkBadgeRow({ badges, style }) {
  const list = Array.isArray(badges) ? badges : [];
  if (list.length === 0) return null;
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:6, justifyContent:"center", ...style }}>
      {list.map(b => (
        <span key={b.label} className="f-sans"
          style={{ fontSize:12, fontWeight:600, color: b.muted ? "#B0B0B0" : "#222",
            background: b.muted ? "#FAFAFA" : "#F7F7F7", border: b.muted ? "1px dashed #EBEBEB" : "none",
            borderRadius:999, padding:"6px 12px", lineHeight:1.5 }}>
          {b.icon && <NavIconInline name={b.icon} size={12} style={{ verticalAlign:"-2px", marginRight:3 }} />}
          {b.emoji ? b.emoji + " " : ""}{b.label}
        </span>
      ))}
    </div>
  );
}

export const Dots = () => (
  <span className="cb-dots" aria-label="…" role="img"><span aria-hidden="true">.</span><span aria-hidden="true">.</span><span aria-hidden="true">.</span></span>
);

// 写真が1枚も登録されていない求人の表紙（2026-07-30たきと指示）：求人者のアイコンを1枚だけ大きく出す。
// ダミー写真・絵文字の水増しはしない（憲法3条＝実データ／未設定／非表示の三択）。
// アイコン未設定の雇い手は Avatar が名前の頭文字の丸を出す＝これも実データ
export const JobPhotoFallback = ({ url, name }) => (
  <div style={{ width:"100%", height:392, borderRadius:12, background:"#F7F7F7", display:"flex", alignItems:"center", justifyContent:"center" }}>
    <Avatar url={url} name={name} size={168} />
  </div>
);

// ── Carousel ─────────────────────────────────────────────────
// arrowInset（任意・2026-08-31）：‹ › の左右の位置。既定は -16＝容器の外へ半分はみ出す見た目。
// ★ページャー（作成中⇄公開中）の中で使う時は 0 にする：はみ出した矢印が【隣のページ】の領域に
//   入り込み、切り替え後もその矢印だけ画面に残って見えるため（2026-08-31たきと報告
//   「作成中の〉ボタンが公開中まで来てしまっている」）。トラックは幅200%so、外側の
//   overflow:hidden では隣のページに入った16pxを切り落とせない
export function Carousel({ children, style, className, wrapperStyle, onScroll, scrollerRef, arrowInset = -16 }) {
  const ref = useRef(null);
  const [atLeft, setAtLeft] = useState(true);
  const [atRight, setAtRight] = useState(true);

  const updatePos = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setAtLeft(el.scrollLeft <= 1);
    setAtRight(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    updatePos();
    window.addEventListener('resize', updatePos);
    return () => window.removeEventListener('resize', updatePos);
  }, [updatePos]);

  useEffect(() => { updatePos(); });

  // ‹ › は「隣の1枚を画面の中央へ寄せる」（2026-08-19たきと指示）。
  // ★旧実装は固定300pxずつ動かしていたso、カードの幅（＋gap）と合わずタップのたびにズレていった。
  //   位置は getBoundingClientRect で測る＝offsetParent（この容器thaが position:relative かどうか）に
  //   左右されない。いま中央に一番近い子を現在地とし、その隣を中央に置く。
  //   写真カルーセルのような全幅スライドでは「中央に寄せる＝スライドの頭に合わせる」と同じ結果になる。
  const scroll = dir => {
    const el = ref.current; if (!el) return;
    const kids = Array.from(el.children).filter(n => n.nodeType === 1);
    if (kids.length === 0) { el.scrollBy({ left: dir * 300, behavior: 'smooth' }); return; }
    const box = el.getBoundingClientRect();
    const mid = box.left + box.width / 2;
    const offsetOf = n => { const r = n.getBoundingClientRect(); return r.left + r.width / 2 - mid; }; // 中央からのズレ
    let idx = 0, best = Infinity;
    kids.forEach((n, i) => { const d = Math.abs(offsetOf(n)); if (d < best - 0.5) { best = d; idx = i; } });
    const next = Math.max(0, Math.min(kids.length - 1, idx + dir));
    const left = el.scrollLeft + offsetOf(kids[next]);
    el.scrollTo({ left: Math.max(0, Math.min(left, el.scrollWidth - el.clientWidth)), behavior: 'smooth' });
  };

  const handleScroll = e => { updatePos(); onScroll && onScroll(e); };

  const btnStyle = {
    position:'absolute', top:'50%', transform:'translateY(-50%)',
    width:36, height:36, borderRadius:'50%',
    background:'#fff', border:'1px solid #EBEBEB',
    boxShadow:'0 2px 4px rgba(0,0,0,0.1)',
    cursor:'pointer', fontSize:18,
    display:'flex', alignItems:'center', justifyContent:'center',
    zIndex:2, padding:0, lineHeight:1,
  };

  return (
    <div style={{ position:'relative', ...wrapperStyle }}>
      {!atLeft && (
        <button onClick={() => scroll(-1)} className="f-sans"
          style={{ ...btnStyle, left:arrowInset }}>‹</button>
      )}
      {/* touchAction:pan-x pan-y（2026-07-16）：横ドラッグ=カルーセル／縦ドラッグ=ページスクロールに変換。
          最初の指の向きでブラウザが軸を1つに確定するため、斜めに両方動く事故は起きない */}
      <div ref={(el)=>{ ref.current = el; if (scrollerRef) scrollerRef.current = el; }} className={className} style={{ touchAction:"pan-x pan-y", overscrollBehaviorX:"contain", overflowY:"hidden", ...style }} onScroll={handleScroll}>
        {children}
      </div>
      {!atRight && (
        <button onClick={() => scroll(1)} className="f-sans"
          style={{ ...btnStyle, right:arrowInset }}>›</button>
      )}
    </div>
  );
}

// あなたの求人の1グループ＝横に並べて指でスライド（2026-08-23たきと指示「グループごとに横にスライド」）。
// 「その他の求人」と同じ Carousel（‹ › は隣の1枚を画面中央へ）＝並べ方もカードと同じ設計に揃える。
// ★指の追従は useHorizontalDrag（lib/hDrag）thatが要る：親の作成中⇄公開中ページャーthat
//   touch-action:pan-y so、ブラウザの横スクロールthat子孫まで丸ごと止まる（保険カード・2026-08-19と同じ理由）。
//   ページャー側は onPagerStart で「はみ出している .carousel-scroll の中で始まったタッチ」を掴まない
//   ＝同じ横スワイプでカードの送りとタブ切替thatが取り合いにならない。
// ★モジュールレベル定義を維持すること（コンポーネント内定義はフォーカス消失バグの原因）
export function JobRow({ children, count }) {
  const ref = useRef(null);
  useHorizontalDrag(ref, count);
  return (
    <Carousel className="carousel-scroll" scrollerRef={ref}
      /* 矢印は容器の内側に置く（arrowInset:0）＝ページャーの隣のページへはみ出させない */
      arrowInset={0}
      wrapperStyle={{ minWidth:0 }}
      style={{ display:"flex", gap:12, overflowX:"auto", paddingBottom:4 }}>
      {children}
    </Carousel>
  );
}

// ── AdminTab ─────────────────────────────────────────────────
// 初心者大歓迎・リピート即決バッジ（2026-07-17）：タップで1〜2行の説明コメントを展開（もう一度タップで閉じる）。
// 詳細・確認・プレビューの3画面共通。flexWrap行内でコメント(width:100%)が次の行に折り返して出る構造
const JOB_FLAG_INFO = {
  beginner: { iconName:"sparkle", label:"初心者大歓迎",   bg:"#E6F7EF", fg:"#00A86B", desc:"農業がはじめての方も歓迎の求人です。経験がなくても応募できます。" },
  expert:   { iconName:"medal", label:"経験者優遇",   bg:"#E8F0FE", fg:"#1A56C5", desc:"農作業の経験がある方を優先したい求人です。経験の浅い方も応募はできます。承認するかどうかは農家が判断します。" },
  repeat:   { iconName:"repeat", label:"リピート即決", bg:"#FFF8E7", fg:"#8A6D1D", desc:"以前この農家で働き、農家が「また呼びたい」とお気に入り登録した方だけが、再応募すると自動で承認されます（承認は採用ではありません。採用は打ち合わせ・面接のあとに決まります）。" },
};

export function JobFlagBadges({ beginner, expert, repeat }) {
  const [open, setOpen] = useState(null); // "beginner"|"expert"|"repeat"|null
  const keys = [beginner && "beginner", expert && "expert", repeat && "repeat"].filter(Boolean);
  if (keys.length === 0) return null;
  return (
    <>
      {keys.map(k => {
        const b = JOB_FLAG_INFO[k];
        return (
          <button key={k} onClick={()=>setOpen(o => (o === k ? null : k))} className="f-sans"
            style={{ fontSize:12, fontWeight:700, color:b.fg, background:b.bg, padding:"4px 12px", borderRadius:20, border:"none", cursor:"pointer" }}>
            <NavIconInline name={b.iconName} size={12} style={{ verticalAlign:"-2px", marginRight:3 }} />{b.label} {open === k ? "▴" : "▾"}
          </button>
        );
      })}
      {open && (
        <span className="f-sans fade-in" style={{ display:"block", width:"100%", fontSize:12, color:JOB_FLAG_INFO[open].fg, background:JOB_FLAG_INFO[open].bg, borderRadius:10, padding:"8px 12px", lineHeight:1.6 }}>
          {JOB_FLAG_INFO[open].desc}
        </span>
      )}
    </>
  );
}

export const NOTICE_JUMP_WAVE = 0.9;
// お知らせ規定（2026-07-17追加）：タイトルとリンクは頭文字から順に1文字ずつ上へジャンプし、
// 尻の文字まで届いたら約2秒おいて先頭からループする。
// 尻までの到達時間は文字数によらず固定0.9s＝タイトルとリンクで同じ（周期も共通ので波とループが同期する）
export function NoticeJumpText({ text }) {
  const chars = Array.from(String(text || ""));
  const dur = NOTICE_JUMP_WAVE + 2.5; // 走破0.9s＋ジャンプ＋約2秒の休止
  const denom = Math.max(1, chars.length - 1);
  return chars.map((ch, i) => (
    <span key={i} style={{ display:"inline-block", whiteSpace:"pre", animation:`cbCharJump ${dur}s ease-in-out ${(i / denom) * NOTICE_JUMP_WAVE}s infinite` }}>{ch}</span>
  ));
}

// DM本文のURLをタップ可能なリンクにする（2026-07-19）：修正依頼の「▶ 修正はこちら」等。
// chitose-bank.comの#リンクはアプリ内遷移（hash変更・リロードなし）、外部URLは新規タブ。
// onNavigate＝アプリ内リンクを踏んだ時に呼ぶ（DMポップアップを閉じる用）
export function LinkifiedText({ text, onNavigate }) {
  const parts = String(text || "").split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) => {
    if (!/^https?:\/\//.test(p)) return p;
    const m = p.match(/^https?:\/\/(?:www\.)?chitose-bank\.com\/(#\/[^\s]*)$/);
    if (m) return <a key={i} href={m[1]} onClick={()=>{ if (typeof onNavigate === "function") onNavigate(); }} style={{ color:"inherit", fontWeight:700, textDecoration:"underline" }}>{p}</a>;
    return <a key={i} href={p} target="_blank" rel="noopener noreferrer" style={{ color:"inherit", fontWeight:700, textDecoration:"underline" }}>{p}</a>;
  });
}

// 分割3-B（2026-07-25）：App.jsxから移動。ピル型の単一選択（LandingFlow・WorkerProfileEditで共用）
// ── 求人フロー（LandingFlow）由来の共有UI（分割・2026-07-31：委託フローと共用するため ui へ移動）──
// ★モジュールレベル定義を維持すること：使う側のコンポーネント内で定義すると再レンダーのたびに
//   関数参照が変わり、React が別コンポーネントと判定して input のフォーカスが失われる
export function LFWizCard({ children }) {
  return (
    <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"20px", marginBottom:14, boxShadow:"0 2px 8px rgba(0,0,0,0.04)" }}>
      {children}
    </div>
  );
}
export function LFCardBtn({ selected, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      width:"100%", textAlign:"left", padding:"20px 22px", borderRadius:16, display:"block", marginBottom:10,
      border: selected ? "2px solid #00A86B" : "2px solid #EBEBEB",
      background: selected ? "#E6F7EF" : "#fff",
      fontSize:15, fontWeight: selected ? 600 : 400, color:"#222", cursor:"pointer", transition:"all .15s",
    }}>{children}</button>
  );
}



// 選択カードグリッド（Airbnb型・汎用）。options=[{name,icon}], value=選択中, onSelect=カード選択, otherText=自由入力値, onOtherChange=自由入力
// noIcon＝絵を出さず文字だけのカードにする（2026-08-09たきと指示「作業カードにアイコンは必要ない」）。
//   作業（収穫・準備…）は作物と違って絵で見分ける必要がなく、CropIconの既定の🌱が全カードに並んでいた。
//   作物グリッドは従来どおり絵つき＝呼び出し側で切り替える
export function LFCropGrid({ options, value, onSelect, otherText, onOtherChange, otherPlaceholder, noIcon }) {
  const isOther = value === "__other__";
  // 絵つきのカード（作物）は絵と名前をカードの中央に置く（2026-08-22たきと指示・あわせて絵を28→56の2倍に）。
  // 絵なしのカード（作業・noIcon）は文字だけので従来の左寄せのまま。
  const centered = !noIcon;
  const cardStyle = (sel) => ({
    display:"flex", flexDirection:"column", alignItems: centered ? "center" : "flex-start",
    justifyContent: centered ? "center" : "flex-start", gap:8,
    // ★minWidth:0＝カードが列より小さくなれるようにする。付けないと絵の56pxが列の下限を作り、
    //   狭い画面（内側幅312px未満）でグリッドが親を突き抜けて左に張り付く（2026-08-22に実機で発生）。
    minWidth:0,
    padding:"16px", borderRadius:12, cursor:"pointer", border:"2px solid",
    borderColor: sel ? "#00A86B" : "#EBEBEB",
    background: sel ? "#E6F7EF" : "#fff",
  });
  return (
    <div style={{ marginBottom:8 }}>
      {/* minmax(0, 1fr)＝1fr のままだと列は min-content より縮まず、狭い画面で3列が親からはみ出す */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3, minmax(0, 1fr))", gap:12 }}>
        {options.map(c => {
          const sel = value === c.name;
          return (
            <button key={c.name} onClick={() => onSelect(c.name)} className="f-sans crop-card" style={cardStyle(sel)}>
              {/* 絵文字が無い作物は既製アイコン（2026-08-08・アイコン重複の解消）。CropIconが出し分ける */}
              {/* 上限56pxで、カードが狭いときは列幅に合わせて縮む（縦横比は保つ） */}
              {!noIcon && <CropIcon crop={c.name} size={56} style={{ maxWidth:"100%", height:"auto" }} />}
              <span className="f-sans" style={{ fontSize:14, fontWeight:600, color: sel ? "#00A86B" : "#222", textAlign: centered ? "center" : "left" }}>{c.name}</span>
            </button>
          );
        })}
        <button onClick={() => onSelect("__other__")} className="f-sans crop-card" style={cardStyle(isOther)}>
          {!noIcon && <span style={{ display:"flex", color:"#717171" }}><NavIcon name="edit" size={52} /></span>}
          <span className="f-sans" style={{ fontSize:14, fontWeight:600, color: isOther ? "#00A86B" : "#222", textAlign: centered ? "center" : "left" }}>その他</span>
        </button>
      </div>
      {isOther && (
        <input value={otherText} onChange={e => onOtherChange(e.target.value)}
          placeholder={otherPlaceholder} className="field f-sans"
          style={{ fontSize:16, marginTop:12 }} />
      )}
    </div>
  );
}
export function LFSummaryRow({ label, value }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:"1px solid #F7F7F7" }}>
      <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0" }}>{label}</span>
      <span className="f-sans" style={{ fontSize:13, color:"#222", fontWeight:600 }}>{value}</span>
    </div>
  );
}

// 集合場所の番地（2026-08-03たきと指示「詳細と求人プレビューにも番地を明記。訪問者にはモザイクを徹底」）。
// ★モザイクは見た目の飾りではない。本体の遮断はDB側で完了している：
//   jobs_public.work_address は anon に NULL マスクので、未ログイン端末には番地の文字が1文字も届かない。
//   ここで描くのは伏せ字（●）＝CSSのblurを外そうがDOMを覗こうが本物は存在しない。
//   伏せ字にしているのは憲法3条（表示にダミー禁止）のため＝それらしい偽の番地を描かない。
// ★描くのは「番地が設定されている求人」のときだけ（has_work_address）。未設定の求人に
//   モザイクを出すと「無い情報をあるように見せる」ことになる。
// value=番地（会員のみ届く）／unlocked=表示してよいか（ログイン済み）／exists=番地の有無
export function MaskedAddress({ value, unlocked, exists }) {
  if (unlocked && value) return <>{value}</>;
  if (!exists) return null;
  return <MaskedText label="番地・建物名" chars={5} />;
}

// 伏せ字の共通部品（2026-08-17たきと指示「文言を非表示にするな。モザイク処理にしろ」）。
// 訪問者に伏せる項目は、行ごと消すのではなく「ここに情報がある・ログインすると読める」と分かる形で出す。
// ★MaskedAddress と同じく、遮断の本体はDB側：jobs_public は anon に値をNULLで返し、
//   「その項目に値が入っているか」だけを masked_fields で伝える。ここで描く●は伏せ字であって
//   本物の文字を隠しているのではない（DOMを覗いても本物は存在しない）。
//   それらしい偽の値を描かない＝憲法3条（表示にダミー禁止）。
// label=項目名（読み上げ・説明に使う）／chars=伏せ字の長さの目安
// ★タップで説明を出す（2026-08-17たきと指示「モザイクタップでログイン後に表示される旨を説明」）＝
//   伏せ字を見た人が「読めない字」ではなく「ログインすれば読める字」だと分かるようにする。
//   説明ボックスからそのままログイン・新規登録へ進める（openLoginBox＝どの画面からでも開く共通の窓口）。
//   createPortalでbody直下へ＝祖先のtransformに影響されず画面中央に出る（AdminJobPreviewと同じ手法）
export function MaskedText({ label, chars = 4 }) {
  const [open, setOpen] = useState(false);
  const note = `${label}は、ログインすると表示されます`;
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(true); }}
        aria-label={note}
        className="f-sans"
        style={{ background:"none", border:"none", padding:0, margin:0, font:"inherit", color:"inherit", cursor:"pointer", whiteSpace:"nowrap", verticalAlign:"baseline" }}
      >
        <span aria-hidden="true" style={{ filter:"blur(4px)", opacity:0.5, userSelect:"none", letterSpacing:1 }}>
          {"●".repeat(Math.max(1, chars))}
        </span>
      </button>
      {open && createPortal(
        <div onClick={()=>setOpen(false)} className="cb-box-overlay cb-lock-scroll"
          style={{ position:"fixed", inset:0, zIndex:10400, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div onClick={(e)=>e.stopPropagation()} className="f-sans"
            style={{ background:"#fff", borderRadius:18, padding:"22px 20px", maxWidth:400, width:"100%", maxHeight:"100%", overflowY:"auto", textAlign:"center", boxShadow:"0 8px 32px rgba(0,0,0,0.2)" }}>
            <p style={{ margin:"0 0 10px", display:"flex", justifyContent:"center", color:"#717171" }} aria-hidden="true"><NavIcon name="lock" size={26} /></p>
            <p style={{ fontSize:16, fontWeight:800, color:"#222", margin:"0 0 8px" }}>{label}は、ログインすると表示されます</p>
            <p style={{ fontSize:13, color:"#555", lineHeight:1.8, margin:"0 0 18px" }}>
              ここにはこの求人の{label}が入っています。ぼかしているのは表示だけの話ではなく、
              ログインしていない間は{label}そのものが端末に届いていません。
              会員登録・ログインをすると、この場所に{label}が表示されます。
            </p>
            <button onClick={()=>{ setOpen(false); openLoginBox(); }} className="btn-primary f-sans"
              style={{ width:"100%", padding:"14px", fontSize:15, fontWeight:700, borderRadius:12, marginBottom:8 }}>
              ログイン・新規登録
            </button>
            <button onClick={()=>setOpen(false)} className="f-sans"
              style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:600, background:"none", border:"none", color:"#717171", cursor:"pointer" }}>
              閉じる
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// accent＝選んだ時の色（既定は緑）。働き手の画面は橙を渡す（役割色・2026-08-19たきと指示）。
// accentSoft を渡さない時は accent の薄い塗りを自動で作る
// values（配列）を渡すと複数選択の点灯になる（2026-08-28・希望する働き方の複数選択）。
// onSelect は従来どおり押した選択肢を1つ渡すだけ＝入り切りの持ち方は呼び出し側の仕事
export function LFPillSelect({ options, value, values, onSelect, accent = "#00A86B", accentSoft }) {
  const soft = accentSoft || (accent === "#00A86B" ? "#E6F7EF" : "#FFF1E8");
  const isOn = (o) => Array.isArray(values) ? values.includes(o) : value === o;
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:8 }}>
      {options.map(o => (
        <button key={o} onClick={() => onSelect(o)} className="f-sans" style={{
          padding:"7px 14px", borderRadius:20, fontSize:12, cursor:"pointer", fontWeight:600, border:"2px solid",
          borderColor: isOn(o) ? accent : "#EBEBEB",
          background: isOn(o) ? soft : "#fff", color: isOn(o) ? accent : "#222",
        }}>{o}</button>
      ))}
    </div>
  );
}

// 分割3-B（2026-07-25）：App.jsxから移動。評価・完了報告モーダルで共用

// 評価モーダルの「はい/いいえ」2択ピル。reviews.want_again等のbool列と1対1で対応
export function YesNoPill({ label, value, onChange }) {
  return (
    <div style={{ marginBottom:12 }}>
      <p className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", marginBottom:6 }}>{label}</p>
      <div style={{ display:"flex", gap:8 }}>
        {[["はい",true],["いいえ",false]].map(([l,v]) => (
          <button key={l} type="button" onClick={()=>onChange(v)} className="f-sans" style={{
            flex:1, padding:"9px", borderRadius:10, fontSize:13, cursor:"pointer", fontWeight:600, border:"2px solid",
            borderColor: value===v ? "#00A86B" : "#EBEBEB",
            background: value===v ? "#E6F7EF" : "#fff", color: value===v ? "#00A86B" : "#222",
          }}>{l}</button>
        ))}
      </div>
    </div>
  );
}

// 分割3-C（2026-07-25）：App.jsxから移動（LandingFlow・App双方で使用）
// ── DEV バッジ（原因特定用・確認後削除） ─────────────────────
const DEV_V = "2026-06-04";

function isAdminDebugEnabled() {
  try {
    return localStorage.getItem("cb_admin_debug") === "1";
  } catch {
    return false;
  }
}

// 委託世界の飾り蔓（角を抱く形・2026-07-31たきと指示「委託ボックスにも蔓を這わして」）。
// 黒い入口カードの角に這わせる装飾。色は地に合わせて指定（黒地=白）。装飾専用＝pointer-events無効。
// 形は委託ページ四隅の蔓と同じパス（世界の道具は増やさない）
export const VINE_CORNER_STEMS = [
  "M6 84 C4 48 24 12 82 8",
  "M30 34 C44 30 52 38 48 48 C45 55 37 53 39 46 C40 42 45 43 44 47",
  "M82 8 C92 6 100 12 97 20 C95 26 88 24 90 18",
  "M14 60 C22 58 26 64 23 70",
];
export const VINE_CORNER_LEAVES = [[10,70,-70],[8,46,-80],[16,28,-45],[34,16,-20],[56,10,-8],[74,12,10],[24,44,-50],[46,26,-15],[23,70,60]];
export function VineCorner({ size = 100, color = "#fff", flip, style }) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" style={{ position:"absolute", width:size, height:size, pointerEvents:"none", ...style }}>
      <g transform={flip ? "translate(120 0) scale(-1 1)" : undefined}>
        {VINE_CORNER_STEMS.map((d, k) => <path key={k} d={d} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" />)}
        {VINE_CORNER_LEAVES.map(([x, y, a], k) => <ellipse key={k} rx="6.5" ry="2.8" fill={color} transform={`translate(${x} ${y}) rotate(${a})`} />)}
      </g>
    </svg>
  );
}

export function DevBadge({ label }) {
  if (!isAdminDebugEnabled()) return null;

  return (
    <div style={{
      position:"fixed",
      top:8,
      left:8,
      zIndex:99999,
      background:"#111",
      color:"#fff",
      fontSize:11,
      padding:"4px 8px",
      borderRadius:999,
      pointerEvents:"none",
    }}>
      DEV: {label} v{DEV_V}
    </div>
  );
}

// 段階の説明シート（2026-07-25たきと指示）：ステータス（帯・チップ・段階ラベル）のタップで、
// その段階の説明を画面下シートで展開。openPhaseInfo（lib/previewBus）で開き、どこタップでも閉じる。
// App.jsxに1つだけマウント（プレビューシートと同じ常駐方式）
export function PhaseInfoSheet() {
  const [pk, setPk] = useState(null);
  useEffect(() => {
    const f = (e) => setPk(e.detail || null);
    window.addEventListener("cb:openPhaseInfo", f);
    return () => window.removeEventListener("cb:openPhaseInfo", f);
  }, []);
  // 下スワイプで閉じる（指に連動・応募者ページのボックスと同じ規則）。★フックは早期returnより前
  const phaseSheetRef = useRef(null);
  useSheetDragClose(phaseSheetRef, null, () => setPk(null), !!pk && !!APP_PHASE_LABEL[pk]);
  if (!pk || !APP_PHASE_LABEL[pk]) return null;
  return (
    <div className="cb-lock-scroll" onClick={()=>setPk(null)} style={{ position:"fixed", inset:0, zIndex:9800, background:"rgba(0,0,0,0.35)", display:"flex", alignItems:"flex-end", justifyContent:"center", animation:"fadeIn .15s ease" }}>
      <div ref={phaseSheetRef} onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:"16px 16px 0 0", padding:"20px 20px calc(env(safe-area-inset-bottom, 0px) + 24px)", maxWidth:560, width:"100%", boxSizing:"border-box" }}>
        <span className="f-sans" style={{ display:"inline-block", background:APP_PHASE_COLOR[pk] || "#999", color:"#fff", fontSize:12, fontWeight:800, borderRadius:8, padding:"4px 14px", marginBottom:10 }}>{APP_PHASE_LABEL[pk]}</span>
        <p className="f-sans" style={{ fontSize:13, color:"#555", lineHeight:1.8, margin:0 }}>{APP_PHASE_DESC[pk] || ""}</p>
      </div>
    </div>
  );
}

// お仕事の流れバー（応募→承認→面接→採用→仕事→評価・2026-07-19／07-22／07-25）。
// ★「完了報告」の段は削除（2026-08-28たきと指示「自動で打刻を打つようにしたから、完了報告のバーは不要」）
//   ＝完了は自動（最終作業日の終了時刻の auto_complete_work）が記録するので、利用者の段ではない。
//   「仕事」に✓が付く条件（status='completed'）は従来の完了報告の判定をそのまま引き継いだ。
// 2026-08-16にWorkerApplications内からここへ移設（ステータスページのボックスでも展開表示するため＝
// 進み具合の見た目・段の定義はこの1箇所が唯一のソース。変えるときは両画面に効く）。
// 「打合せ」はトリガーを定義できないため段として置かない（2026-07-25たきと判断）。
// 承認段は「statusがappliedより先に進んだか」で判定（旧実装の常時✓は、承認済みしか並ばない
// 一覧では同値。応募中も並ぶ画面で正しく未達に見えるよう一般化・終端status は承認扱いにしない）
export const FLOW_STEPS = ["応募", "承認", "面接", "採用", "仕事", "評価"];
export const flowState = (a) => {
  const bothConfirmed = !!(a.terms_confirmed_worker_at && a.terms_confirmed_farmer_at); // 採用（双方確認）＝面接も済んだ扱い
  const approved = bothConfirmed || !["applied", "rejected", "expired", "canceled"].includes(a.status);
  // ★「仕事」に✓が付くのは仕事が終わってから（2026-08-18たきと指示「仕事まで進めてチェックは入れるな」）。
  //   作業中（working）は仕事が“現在地”＝丸のまま。以前は開始した時点で✓が付き、まだ働いている求人が
  //   「仕事は済んだ」に見えていた（＝完了していない求人の進み具合が実態とずれる）
  const reported = a.status === "completed"; // 作業完了が記録された（自動完了含む）＝仕事の段が済みになる
  const reviewed = !!a._reviewed || (a.status === "completed" && a.attended === false); // 評価（評価の行があるか＝呼び出し側が _reviewed で渡す）
  const done = [true, approved, bothConfirmed, bothConfirmed, reported, reviewed];
  return { done, active: done.findIndex(d => !d) };
};
export const FlowBar = ({ a }) => {
  const { done, active } = flowState(a);
  return (
    <div style={{ display:"flex", alignItems:"flex-start", marginTop:12 }}>
      {FLOW_STEPS.map((s, i) => {
        const isDone = done[i]; const isActive = i === active;
        const reached = isDone || isActive;
        const isNow = isActive && s === "仕事"; // いま作業中＝塗りつぶしの緑＋上下に跳ねて明滅
        return (
          <div key={s} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", position:"relative", minWidth:0 }}>
            {i > 0 && <div style={{ position:"absolute", top:8, right:"50%", width:"100%", height:2, background: reached ? "#00A86B" : "#E5E5E5" }} />}
            {/* 現在地が「仕事」の時だけ上下に跳ねながら明滅（2026-08-18たきと指示
                「仕事のところだけ、アップダウンに点滅を追加」）＝いま作業中であることの目印 */}
            {/* ★現在地が「仕事」の丸は塗りつぶしの緑（✓は入れない・2026-08-19たきと指示
                「●は緑で透けないようにしろ」）＝白抜きの輪だと後ろの横棒が見えてしまう */}
            <div className={isNow ? "cb-flow-now" : undefined}
              style={{ position:"relative", zIndex:1, width:18, height:18, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800, boxSizing:"border-box",
              background: (isDone || isNow) ? "#00A86B" : "#fff", border: (isDone || isNow) ? "none" : isActive ? "2px solid #00A86B" : "2px solid #E5E5E5", color: isDone ? "#fff" : isActive ? "#00A86B" : "#C8C8C8" }}>
              {isDone ? <NavIcon name="tick" size={10} /> : ""}
            </div>
            <span className="f-sans" style={{ fontSize:9, marginTop:4, lineHeight:1.2, textAlign:"center", color: reached ? "#00A86B" : "#B0B0B0", fontWeight: isActive ? 700 : 500 }}>{s}</span>
          </div>
        );
      })}
    </div>
  );
};

// 読み込み中の仮配置（2026-07-27たきと指示「先にボックスを置いて、読み込んでいることを表現する」
// →同日改定「各ページの構造に自動依存させて」）。
//
// ページごとに形を書き分けない。前回そのページが実際に描いた骨（並べ方と子の高さ）を覚えておき、
// 次に開いた時それをそのまま仮配置にする。ページの構造を変えれば、次の描画から自動で追従する。
//
// 使い方：一覧を包む要素に useSkeletonProbe(key) のrefを付け、読み込み中は <AutoSkeleton shapeKey={key} /> を出す。
export function useSkeletonProbe(key) {
  const ref = useRef(null);
  useSkeletonProbeOn(ref, key);
  return ref;
}

// 既にrefが付いている要素を測りたい時（1要素に2つrefは付けられないため）。
// keyにnull/falseを渡すと何もしない＝「今この形は覚えない」の意思表示に使える
export function useSkeletonProbeOn(ref, key) {
  useEffect(() => {
    if (!key || !ref.current) return;
    // 描画直後だと画像の高さが未確定なことがあるので、1フレーム置いてから測る
    const id = setTimeout(() => {
      const shape = measureShape(ref.current);
      if (shape) writeShape(key, shape);
    }, 120);
    return () => clearTimeout(id);
  });
}

export function AutoSkeleton({ shapeKey, fallbackHeight = 96, fallbackCount = 4 }) {
  const shape = shapeKey ? readShape(shapeKey) : null;
  const heights = shape ? shape.heights : Array.from({ length: fallbackCount }, () => fallbackHeight);
  const style = shape && shape.display === "grid"
    ? { display: "grid", gridTemplateColumns: shape.columns || "repeat(3, 1fr)", gap: shape.gap }
    : { display: "grid", gap: shape ? shape.gap : "10px" };
  return (
    <div style={style} aria-busy="true" aria-label="読み込み中">
      {heights.map((h, i) => (
        /* 横いっぱいだった行は仮配置でも横いっぱいに（応募者ページのカードは1行1件ので、
           列に詰めるとモザイク状になっていた・2026-07-29修理） */
        <div key={i} className="ghost-line"
          style={{ height: h, borderRadius: 14, gridColumn: shape && shape.spans && shape.spans[i] ? "1 / -1" : undefined }} />
      ))}
    </div>
  );
}

// 働き手Q&A（pr_qa）の表示：チャットと同じコメント（吹き出し）形式（2026-08-06たきと指示）。
// 質問＝左・グレーの吹き出し（サイトからの問いかけ）／回答＝右・役割色の吹き出し（本人の言葉）＝
// ChatView のメッセージと同じ作法（alignSelf・borderRadius14・maxWidth75%・pre-wrap）。
// 質問は表示だけ簡易型（qaShort）にする＝保存されている質問文は書き換えない。
// accent＝回答側の色。既定は働き手の役割色（橙）。雇い手側で使うときは緑を渡す
export function QaChat({ items, accent = ROLE_ORANGE, style }) {
  const list = Array.isArray(items) ? items.filter(x => x && (x.q || x.a)) : [];
  if (list.length === 0) return null;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:16, ...style }}>
      {list.map(({ q, a }, i) => (
        <Fragment key={i}>
          {/* 🛡運営の名乗りは削除（2026-08-08たきと指示「🛡 運営はいらない。削除」）＝
              質問はグレーの吹き出しだけで出す（2026-08-07の名乗り付与を撤回） */}
          <div className="f-sans" style={{ alignSelf:"flex-start", maxWidth:"75%", padding:"8px 12px", borderRadius:14, fontSize:12, background:"#F0F0F0", color:"#717171", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{qaShort(q)}</div>
          {a && (
            <div className="f-sans" style={{ alignSelf:"flex-end", maxWidth:"75%", padding:"10px 14px", borderRadius:14, fontSize:14, background:accent, color:"#fff", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{a}</div>
          )}
        </Fragment>
      ))}
    </div>
  );
}
