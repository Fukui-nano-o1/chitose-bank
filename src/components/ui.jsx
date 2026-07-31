// 汎用UIアトム（分割・段階2後半・2026-07-24）：リボン帯・長文の省略表示。
import { useState, useEffect, useRef, useCallback } from "react";
import { APP_PHASE_LABEL, APP_PHASE_COLOR, APP_PHASE_DESC, punchDivergence, PUNCH_GAP_MIN } from "../lib/utils";
import { readShape, writeShape, measureShape } from "../lib/skeletonShape";

// メルカリSOLD風の斜めリボン（写真の右上角）。農家の求人一覧の状態表示（作成中/審査中/公開中）
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
export function ExpandableText({ text, limit = 100, style }) {
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
      {truncated && <span style={{ color:"#00A86B", fontWeight:700 }}>{open ? "　閉じる" : "　もっと見る"}</span>}
    </p>
  );
}

// 危険項目の表示（詳細・確認・プレビュー共通・2026-07-16）：
// タイトル=写真の上・説明=写真の内部（1枚目にグラデ帯）・全て中央配置。写真なしは⚠️色ボックス内に説明
export function DangerItem({ icon, label, desc, photos, onPhotoClick }) {
  const list = (photos || []).map(p => (typeof p === "string" ? p : p?.url)).filter(Boolean);
  return (
    <div style={{ width:"100%" }}>
      <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", margin:"0 0 8px", textAlign:"center", overflowWrap:"break-word" }}>{label}</p>
      {list.length > 0 ? (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {list.map((src, k) => (
            <div key={k} style={{ position:"relative", borderRadius:8, overflow:"hidden" }}>
              <img src={src} alt="" onClick={onPhotoClick ? () => onPhotoClick(src) : undefined} style={{ width:"100%", height:190, objectFit:"cover", display:"block", cursor: onPhotoClick ? "pointer" : "default" }} />
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
    ? <img src={url} alt="" width={size} height={size}
        style={{ width:size, height:size, borderRadius:"50%", objectFit:"cover", flexShrink:0, ...ringStyle }} />
    : <div style={{ width:size, height:size, borderRadius:"50%", background: bg || ring || "#00A86B",
        color:"#fff", display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:size*0.38, fontWeight:700, flexShrink:0, ...ringStyle }}>
        {(name||"？").replace(/\s/g,"").slice(0,2)}
      </div>;
};

// 読み込み中の「…」（2026-07-30たきと指示・遊び心）：点が1つずつ跳ねる。
// 読み上げには「…」1文字だけ渡す（点3つを読み上げさせない）
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
export function Carousel({ children, style, className, wrapperStyle, onScroll, scrollerRef }) {
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

  const scroll = dir => ref.current?.scrollBy({ left: dir * 300, behavior: 'smooth' });

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
          style={{ ...btnStyle, left:-16 }}>‹</button>
      )}
      {/* touchAction:pan-x pan-y（2026-07-16）：横ドラッグ=カルーセル／縦ドラッグ=ページスクロールに変換。
          最初の指の向きでブラウザが軸を1つに確定するため、斜めに両方動く事故は起きない */}
      <div ref={(el)=>{ ref.current = el; if (scrollerRef) scrollerRef.current = el; }} className={className} style={{ touchAction:"pan-x pan-y", overscrollBehaviorX:"contain", overflowY:"hidden", ...style }} onScroll={handleScroll}>
        {children}
      </div>
      {!atRight && (
        <button onClick={() => scroll(1)} className="f-sans"
          style={{ ...btnStyle, right:-16 }}>›</button>
      )}
    </div>
  );
}

// ── AdminTab ─────────────────────────────────────────────────
// はじめてOK・リピート即決バッジ（2026-07-17）：タップで1〜2行の説明コメントを展開（もう一度タップで閉じる）。
// 詳細・確認・プレビューの3画面共通。flexWrap行内でコメント(width:100%)が次の行に折り返して出る構造
const JOB_FLAG_INFO = {
  beginner: { icon:"🌱", label:"はじめてOK",   bg:"#E6F7EF", fg:"#00A86B", desc:"農業がはじめての方も歓迎の求人です。経験がなくても応募できます。" },
  expert:   { icon:"💪", label:"経験者優遇",   bg:"#E8F0FE", fg:"#1A56C5", desc:"農作業の経験がある方を優先したい求人です。経験の浅い方も応募はできます。承認するかどうかは農家が判断します。" },
  repeat:   { icon:"🌟", label:"リピート即決", bg:"#FFF8E7", fg:"#8A6D1D", desc:"以前この農家で働き、農家が「また呼びたい」とお気に入り登録した方だけが、再応募すると自動で承認されます（承認は採用ではありません。採用は打ち合わせ・面接のあとに決まります）。" },
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
            {b.icon} {b.label} {open === k ? "▴" : "▾"}
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
// 尻までの到達時間は文字数によらず固定0.9s＝タイトルとリンクで同じ（周期も共通so波とループが同期する）
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
export function LFCropGrid({ options, value, onSelect, otherText, onOtherChange, otherPlaceholder }) {
  const isOther = value === "__other__";
  return (
    <div style={{ marginBottom:8 }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:12 }}>
        {options.map(c => {
          const sel = value === c.name;
          return (
            <button key={c.name} onClick={() => onSelect(c.name)} className="f-sans crop-card" style={{
              display:"flex", flexDirection:"column", alignItems:"flex-start", gap:8,
              padding:"16px", borderRadius:12, cursor:"pointer", border:"2px solid",
              borderColor: sel ? "#00A86B" : "#EBEBEB",
              background: sel ? "#E6F7EF" : "#fff",
            }}>
              {c.icon && <span style={{ fontSize:28 }}>{c.icon}</span>}
              <span className="f-sans" style={{ fontSize:14, fontWeight:600, color: sel ? "#00A86B" : "#222" }}>{c.name}</span>
            </button>
          );
        })}
        <button onClick={() => onSelect("__other__")} className="f-sans crop-card" style={{
          display:"flex", flexDirection:"column", alignItems:"flex-start", gap:8,
          padding:"16px", borderRadius:12, cursor:"pointer", border:"2px solid",
          borderColor: isOther ? "#00A86B" : "#EBEBEB",
          background: isOther ? "#E6F7EF" : "#fff",
        }}>
          <span style={{ fontSize:28 }}>✏️</span>
          <span className="f-sans" style={{ fontSize:14, fontWeight:600, color: isOther ? "#00A86B" : "#222" }}>その他</span>
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

export function LFPillSelect({ options, value, onSelect }) {
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:8 }}>
      {options.map(o => (
        <button key={o} onClick={() => onSelect(o)} className="f-sans" style={{
          padding:"7px 14px", borderRadius:20, fontSize:12, cursor:"pointer", fontWeight:600, border:"2px solid",
          borderColor: value===o ? "#00A86B" : "#EBEBEB",
          background: value===o ? "#E6F7EF" : "#fff", color: value===o ? "#00A86B" : "#222",
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
  if (!pk || !APP_PHASE_LABEL[pk]) return null;
  return (
    <div onClick={()=>setPk(null)} style={{ position:"fixed", inset:0, zIndex:9800, background:"rgba(0,0,0,0.35)", display:"flex", alignItems:"flex-end", justifyContent:"center", animation:"fadeIn .15s ease" }}>
      <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:"16px 16px 0 0", padding:"20px 20px calc(env(safe-area-inset-bottom, 0px) + 24px)", maxWidth:560, width:"100%", boxSizing:"border-box" }}>
        <span className="f-sans" style={{ display:"inline-block", background:APP_PHASE_COLOR[pk] || "#999", color:"#fff", fontSize:12, fontWeight:800, borderRadius:8, padding:"4px 14px", marginBottom:10 }}>{APP_PHASE_LABEL[pk]}</span>
        <p className="f-sans" style={{ fontSize:13, color:"#555", lineHeight:1.8, margin:0 }}>{APP_PHASE_DESC[pk] || ""}</p>
      </div>
    </div>
  );
}

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
        /* 横いっぱいだった行は仮配置でも横いっぱいに（応募者ページのカードは1行1件so、
           列に詰めるとモザイク状になっていた・2026-07-29修理） */
        <div key={i} className="ghost-line"
          style={{ height: h, borderRadius: 14, gridColumn: shape && shape.spans && shape.spans[i] ? "1 / -1" : undefined }} />
      ))}
    </div>
  );
}

// ── 打刻の事実の質を出す部品（第13弾・追補・2026-07-30たきと判断）──
// 「記録は改変しない・事実の質は表示する」の原則どおり、隠さずに小さく添える。
// 申告打刻も実績には算入する（作業は本当に行われている）。フラグは永久に残す。

// 圏外で申告された打刻であることの印。修正済みバッジと同じ思想・同じ大きさ
export const DeclaredBadge = ({ show, label = "圏外で申告された時刻" }) => (
  show ? <span className="f-sans" style={{ marginLeft:6, fontSize:10, fontWeight:700, color:"#C77700", background:"#FFF4E0", borderRadius:4, padding:"1px 5px", whiteSpace:"nowrap" }}>{label}</span> : null
);

// 双方の署名時刻の乖離。打刻は双方署名なので、開きが大きい＝どちらかの時刻が実態と違う手がかり。
// 隠さず両方を並べ、修正申請への道を添える（押し付けはしない）
// 導線は双方に出す（2026-07-30たきと訂正「申請権の非対称を解消」）。文言だけ立場で変える
export function PunchGapNotice({ app, onRequestCorrection, correctionLabel = "🕐 実際と違う場合は修正を申請" }) {
  const gaps = punchDivergence(app);
  if (!gaps.start && !gaps.end) return null;
  const hm = (ts) => new Date(ts).toLocaleTimeString("ja-JP", { hour:"2-digit", minute:"2-digit" });
  const rows = [
    gaps.start && { k:"開始", a:["働き手の打刻", hm(gaps.start.worker)], b:["雇い手の確認", hm(gaps.start.farmer)], m:gaps.start.minutes },
    gaps.end   && { k:"終了", a:["雇い手の記録", hm(gaps.end.farmer)],   b:["働き手の確認", hm(gaps.end.worker)],   m:gaps.end.minutes },
  ].filter(Boolean);
  return (
    <div style={{ background:"#FFF9EE", border:"1px solid #F5A623", borderRadius:10, padding:"9px 11px", margin:"0 0 8px" }}>
      <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#8A6D1D", margin:"0 0 6px" }}>⚠️ 時刻に開きがあります</p>
      {rows.map(r => (
        <p key={r.k} className="f-sans" style={{ fontSize:11, color:"#444", margin:"0 0 3px", lineHeight:1.7 }}>
          {r.k}：{r.a[0]} {r.a[1]} ／ {r.b[0]} {r.b[1]}（{r.m}分の開き）
        </p>
      ))}
      <p className="f-sans" style={{ fontSize:10, color:"#8A6D1D", margin:"4px 0 0", lineHeight:1.6 }}>
        {PUNCH_GAP_MIN}分以上の開きがある時に出ます。実態と違う場合は修正を申請できます。
      </p>
      {onRequestCorrection && (
        <button onClick={onRequestCorrection} className="f-sans" style={{ marginTop:6, background:"none", border:"none", padding:0, fontSize:11, fontWeight:700, color:"#00A86B", textDecoration:"underline", textUnderlineOffset:2, cursor:"pointer" }}>
          {correctionLabel}
        </button>
      )}
    </div>
  );
}
