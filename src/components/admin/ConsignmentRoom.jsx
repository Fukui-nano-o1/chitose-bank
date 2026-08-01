// 委託 準備室（#/admin/consignment・管理者専用・分割3-Aで切り出し2026-07-24）。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { ymdLocal } from "../../lib/utils";
import { Avatar, VineCorner, VINE_CORNER_STEMS, VINE_CORNER_LEAVES } from "../ui";
import { CalendarView } from "../CalendarView";

// ── 委託 準備室（#/admin/consignment・管理者専用・2026-07-19）：B2B委託レーンの手動1件（この冬・運営者自身がモデル）用の内部道具。
//    市場機能（掲載板・受託者画面・決済）は作らない——手動1件の後に判断（たきと指示）。
//    タブ2つ：仕様書（フォーム→保存→印刷ビュー）／台帳（consignment_deals一覧・行タップで編集・状態更新・メモ）
const CONSIGN_STEPS = ["下書き", "合意", "着手金", "作業中", "検収", "支払", "完了"];
const consignStepState = (d) => {
  const s = d.spec || {}; const st = d.status || "draft";
  const beyond = (arr) => arr.includes(st);
  const hasDeposit = !!(s.advance && String(s.advance).trim()) || (d.deposit_amount != null && d.deposit_amount > 0);
  const done = [
    true,                                                                    // 下書き
    beyond(["agreed","working","inspected","paid","done"]) || !!d.agreed_at,  // 合意
    (!hasDeposit) || !!s.deposit_received_at || beyond(["working","inspected","paid","done"]), // 前金
    beyond(["working","inspected","paid","done"]),                           // 作業中
    !!d.inspected_at || beyond(["inspected","paid","done"]),                 // 検収
    !!d.paid_at || beyond(["paid","done"]),                                  // 支払
    st === "done",                                                           // 完了
  ];
  return { done, active: done.findIndex(x => !x) };
};

// 状態バッジ（2026-07-31たきと指示・ブラック）：色相で分けず、進むほど濃くなる濃淡の階段にする。
// 求人・求職の帯（橙／緑）とは別の世界＝色相は持ち込まない
const CONSIGN_STATUS = [
  { k:"draft",     l:"下書き", bg:"#F5F5F5", fg:"#999999" },
  { k:"agreed",    l:"合意",   bg:"#E5E5E5", fg:"#444444" },
  { k:"working",   l:"作業中", bg:"#111111", fg:"#FFFFFF" },
  { k:"inspected", l:"検収済", bg:"#3A3A3A", fg:"#FFFFFF" },
  { k:"paid",      l:"支払済", bg:"#5C5C5C", fg:"#FFFFFF" },
  { k:"done",      l:"完了",   bg:"#F3F3F3", fg:"#999999" },
];

// 募集状況（掲載画面に出す状態）＝内部statusから自動導出（2026-07-31たきと指示・二重管理しない）。
// 内部 draft→募集中／agreed→募集終了（受託者決定）／working・inspected・paid→作業中／done→完了
const consignRecruitState = (status) => {
  if (status === "done") return { l:"完了", bg:"#F3F3F3", fg:"#999999" };
  if (["working", "inspected", "paid"].includes(status)) return { l:"作業中", bg:"#3A3A3A", fg:"#FFFFFF" };
  if (status === "agreed") return { l:"募集終了", bg:"#E5E5E5", fg:"#444444" };
  return { l:"募集中", bg:"#111111", fg:"#FFFFFF" }; // draft（既定）＝掲載中・応募受付
};

// 履行期限は開始+終了の日付範囲（2026-07-31たきと指示）。raw は spec.date_start/date_end(ymd)、
// 表示用ラベルは spec.deadline に持たせる（カード/印刷/スナップショットは deadline を読む＝据え置き）。
// 復元は raw から。文字列パースで逆算しない（day4教訓#4）
const parseYmd = (s) => { if (!s) return null; const p = String(s).split("-").map(Number); return p.length === 3 && p.every(n => !isNaN(n)) ? new Date(p[0], p[1] - 1, p[2]) : null; };
const deadlineLabel = (ds, de) => {
  const s = parseYmd(ds); if (!s) return "";
  const e = parseYmd(de) || s;
  const cy = new Date().getFullYear();
  const f = (dt) => (dt.getFullYear() === cy ? "" : dt.getFullYear() + "年") + (dt.getMonth() + 1) + "月" + dt.getDate() + "日";
  return s.getTime() === e.getTime() ? f(s) : f(s) + " 〜 " + f(e);
};

// 進行ステッパー（FlowBarと同じ視覚文法。色だけブラック：黒の✓＝完了・黒リング＝現在地・グレー＝未着手）
function ConsignStepper({ deal }) {
  const { done, active } = consignStepState(deal);
  return (
    <div style={{ display:"flex", alignItems:"flex-start", margin:"4px 0 18px" }}>
      {CONSIGN_STEPS.map((s, i) => {
        const isDone = done[i]; const isActive = i === active; const reached = isDone || isActive;
        return (
          <div key={s} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", position:"relative", minWidth:0 }}>
            {i > 0 && <div style={{ position:"absolute", top:8, right:"50%", width:"100%", height:2, background: reached ? "#111111" : "#E5E5E5" }} />}
            <div style={{ position:"relative", zIndex:1, width:18, height:18, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800, boxSizing:"border-box",
              background: isDone ? "#111111" : "#fff", border: isDone ? "none" : isActive ? "2px solid #111111" : "2px solid #E5E5E5", color: isDone ? "#fff" : isActive ? "#111111" : "#C8C8C8" }}>
              {isDone ? "✓" : ""}
            </div>
            <span className="f-sans" style={{ fontSize:9, marginTop:4, lineHeight:1.2, textAlign:"center", color: reached ? "#111111" : "#B0B0B0", fontWeight: isActive ? 700 : 500 }}>{s}</span>
          </div>
        );
      })}
    </div>
  );
}

const CONSIGN_FIXED_CLAUSES = [
  "本委託の対価は作業の実施であり、収量・収益を保証するものではありません",
  "賠償は本件報酬額を上限とし、逸失利益は対象外とします（故意・重過失を除く）",
  "作業の指揮命令は受託者の責任者が行います",
  "天候等による中止：開始◯日前までの通知は無償、以後は前金を上限に精算",
  "支払い：前金→区画ごとの検収後に残額",
];

// 作物はブロッコリー固定（2026-07-31たきと指示「作物はブロッコリーだけ」）。
// 入力欄は置かず固定表示。保存時も必ずこの値を書く（spec.crop）＝カード/印刷/スナップショットに反映
const CONSIGN_CROP = "ブロッコリー";

const CONSIGN_EMPTY = { field_name:"", region:"徳島県吉野川市", area_a:"", crop:CONSIGN_CROP, task:"", deadline:"", date_start:"", date_end:"", unit_price_10a:"", advance:"", inspection:"", field_cond:"", hazards:[], hazard_other:"", photos:[], special:"" };

const CONSIGN_BASIC_FIELDS = [
  { k:"field_name",     l:"圃場の呼び名" },
  { k:"region",         l:"地域", ph:"例：徳島県吉野川市（番地は掲載しない）" },
  { k:"area_a",         l:"面積（a）" },
  { k:"crop",           l:"作物" },
  { k:"task",           l:"作業" },
  { k:"deadline",       l:"履行期限" },
  { k:"unit_price_10a", l:"単価（10aあたり・円）" },
  { k:"advance",        l:"着手金（前払金・円）" },
];

// 作業は3択・複数選択可（2026-07-31たきと指示）。値は「・」区切りの文字列で spec.task に保存
// ＝印刷・凍結スナップショット・カード表示（いずれも spec.task を文字列で読む）を変更せずに済む
const CONSIGN_TASKS = ["収穫", "検品", "出荷"];

// 危険情報はチェック式（2026-07-31たきと指示・自由記述だと書かれず埋もれるため）。
// 選択は spec.hazards（配列）、その他の自由記述は spec.hazard_other に保存
const CONSIGN_HAZARDS = ["電柵あり", "急斜面", "ぬかるみ", "農薬散布後", "その他"];

// 新規委託ウィザード（2026-07-31たきと指示）：「入力順」でなく「契約が成立するまでの思考順」。
// 受託者の頭の中＝何やる？→できる？→いくら？→いつ？→危なくない？→応募 に合わせた5ステップ。
// 1ページ1つの問い（最低限の情報UI・最大限のUX）
const CONSIGN_WIZ_STEPS = [
  { t:"案件概要",   q:"何を頼みますか？",             d:"どんな仕事なのかを3秒で理解できるように。" },
  { t:"作業仕様",   q:"どう終われば完了ですか？",     d:"揉めない仕様をつくります。" },
  { t:"報酬",       q:"いくら払いますか？",           d:"受託者が応募するか判断する情報です。" },
  { t:"日程・安全", q:"いつやりますか？危険は？",     d:"受託可能かの判断と、事故防止のために。" },
  { t:"確認・掲載", q:"内容を確認して掲載します",     d:"掲載ミスを防ぐ最終チェックです。" },
];

const CONSIGN_TEXT_FIELDS = [
  { k:"inspection", l:"検収基準", ph:"例：2L以上・軸2cm・コンテナ渡し" },
  { k:"field_cond", l:"圃場条件", ph:"残渣・傾斜・進入路など" },
  { k:"special",    l:"特約",     ph:"あれば記入" },
];

// 草の形（2026-07-31たきと提供イメージ：茎に小さな楕円の葉が互い違いにつく枝葉のシルエット）。
// 三角形でなくSVGの手書きパスで描く。stem=茎、leaves=[中心x, 中心y, 傾き°]（viewBox 0 0 40 80・葉は楕円）
const CONSIGN_SPRIGS = [
  { stem: "M20 80 C20 58 20 32 20 6",
    leaves: [[12,64,38],[28,56,-38],[12,46,40],[28,38,-38],[13,28,36],[27,20,-36],[20,7,90]] },
  { stem: "M14 80 C16 60 24 38 29 8",
    leaves: [[9,60,40],[30,50,-35],[11,40,42],[32,30,-33],[16,22,40],[29,9,-75]] },
  { stem: "M22 80 C22 68 21 56 20 44",
    leaves: [[15,66,38],[28,60,-36],[14,52,40],[27,47,-38],[20,44,85]] },
];
// 群れの土台＝3つの縄張り（振り付けは固定：右→左→右の順に下から上へ・2026-07-31たきと指示）。
// 中央に寄って見えないよう、株の根元は必ず端の側に置く（右群れ=右端0〜38%・左群れ=左端0〜38%。
// 負値も許す＝画面外へはみ出してよい）。panel=どちらの幕に所属するか（幕が開くとき群れごと退場）。
const CONSIGN_CLUSTER_BASES = [
  { panel: "bottom", anchor: "right", bottomMin: 0,  bottomMax: 10, delay: 0.10 }, // ①右・下段（草）
  { panel: "bottom", anchor: "left",  bottomMin: 55, bottomMax: 75, delay: 0.45 }, // ②左・中段（草）
  { panel: "top",    anchor: "right", bottomMin: 0,  bottomMax: 20, delay: 0.80, kind: "sun" }, // ③上段＝夏仕様の白い太陽（2026-07-31たきと指示・草から置換）
];
// 入場のたびに草の配置を抽選する（2026-07-31たきと指示「毎回違うパターン」＝ここは意図的に乱数。
// 以前の「決め打ち＝再現性」はこの指示で上書き）。全てのパターンを毎回変える（たきと指示）：
// 群れごとの大きさの基準・株の種類・本数・高さ・左右の向き・傾き・位置ずれ・生える時間差。
// 高さは最大420px前後（3倍→実機で大きすぎたため良い塩梅に再調整・2026-07-31）＝先端の画面はみ出しは許容のまま
const makeConsignGrass = () => {
  const r = (min, max) => min + Math.random() * (max - min);
  return CONSIGN_CLUSTER_BASES.map(c => {
    // 夏仕様：上段の群れは草でなく白い太陽（2026-07-31たきと指示）。大きさ・位置だけ入室ごとに抽選
    if (c.kind === "sun") {
      return {
        panel: c.panel,
        kind: "sun",
        delay: c.delay,
        sunSize: Math.round(r(210, 280)),   // 太陽の直径px（爛々と大きめ）
        sunTop: +r(7, 17).toFixed(1),       // 上幕の上端からの位置%
        sunLeft: +r(40, 64).toFixed(1),     // 横位置%（中央やや右）
      };
    }
    const size = r(160, 300); // 群れごとの大きさの基準（実機確認で縮小・2026-07-31「良い塩梅に」）
    return {
      panel: c.panel,
      anchor: c.anchor,
      delay: c.delay,
      pos: { bottom: r(c.bottomMin, c.bottomMax).toFixed(1) + "%" },
      sprigs: Array.from({ length: 6 + Math.floor(Math.random() * 5) }, () => ({ // 6〜10株（3〜5株の倍・2026-07-31たきと指示）
        v: Math.floor(Math.random() * CONSIGN_SPRIGS.length),
        h: Math.round(Math.min(420, r(size * 0.7, size * 1.3))),
        x: +r(-8, 38).toFixed(1),           // 端からの寄せ%（負値=画面外へはみ出す）＝右左の分離
        y: Math.round(r(0, 44)),            // 根元の縦ゆらぎpx（一直線に並ばない）
        flip: Math.random() < 0.5,          // 左右反転（同じ形でも景色が変わる）
        tilt: Math.round(r(-10, 10)),       // 株ごとの傾き（°・根元を軸に）
        d: r(0, 0.12),                      // 群れの中の生える時間差（ステップの区切りを崩さない範囲）
      })),
    };
  });
};

// ページ背景の蔓（2026-07-31たきと指示・同日修正：たきと提供の蔓イラストのイメージに準拠）。
// うねる茎＋渦巻きのツル（先端と枝先がくるりと巻く）＋葉。上端から吊るす前提の向きで描く。
// stems=茎とツルのパス（複数）、leaves=[中心x, 中心y, 傾き°]（viewBox 0 0 60 120・葉は楕円）
const CONSIGN_VINES = [
  { stems: [
      "M30 0 C26 18 40 30 34 46 C28 62 42 70 36 86 C32 96 24 102 26 110 C27 116 35 118 37 112 C38 108 33 106 32 110",
      "M34 46 C46 48 54 42 52 34 C50.5 28 43 28.5 44.5 34.5 C45.5 38 50 37 49.5 33.5",
    ],
    leaves: [[22,24,-40],[40,36,35],[24,56,-38],[44,64,30],[27,84,-36],[36,96,40]] },
  { stems: [
      "M18 0 C26 16 10 30 18 46 C25 60 40 62 44 74 C48 86 38 94 30 88 C24 83 28 73 35 76 C39 78 38 83 34 83",
      "M18 46 C10 48 4 42 7 35 C9 30 15 32 13 37",
    ],
    leaves: [[26,12,35],[10,28,-40],[26,40,38],[36,58,30],[48,70,-30]] },
  { stems: [
      "M42 0 C38 14 48 22 44 34 C40 46 26 48 24 60 C22 70 32 75 36 68 C38 63 33 59 30 63",
      "M44 34 C52 36 58 30 55 23 C53 18 47 20 49 25",
    ],
    leaves: [[34,8,-35],[50,16,30],[34,28,-38],[30,44,35],[18,54,-30]] },
];
// 四隅の蔓（2026-07-31たきと指示「四隅に蔓を這わしてほしい」）：角を抱くように這う飾り蔓。
// 左上向きに1種だけ描き、他の3隅は左右・上下の反転で使い回す。viewBox 0 0 120 120。
// パスの正本は components/ui の VINE_CORNER_*（入口カードの蔓と同じ形＝二重管理しない）
const CONSIGN_CORNER_VINE = { stems: VINE_CORNER_STEMS, leaves: VINE_CORNER_LEAVES };

// 配置は入室ごとに抽選
const makeConsignVines = () => {
  const r = (min, max) => min + Math.random() * (max - min);
  return Array.from({ length: 6 + Math.floor(Math.random() * 4) }, () => ({ // 6〜9本
    v: Math.floor(Math.random() * CONSIGN_VINES.length),
    x: +r(-4, 96).toFixed(1),            // 横位置%（負値=左へ少しはみ出す）
    h: Math.round(r(120, 340)),          // 垂れる長さ
    flip: Math.random() < 0.5,
    dur: +r(4.5, 7.5).toFixed(1),        // 揺れの周期s（1本ずつ違う=風のばらつき）
    delay: +r(0, 3).toFixed(1),
  }));
};

// ── 委託者情報（2026-07-31たきと指示）：原則変更しない本人・事業者情報。
//    設定ページ（#/admin/consignment/profile）で入力し、案件作成（確認STEP5・印刷仕様書）に自動反映する。
//    保存先は consignment_profiles の consignor_* 列（管理者専用RLS）
const CONSIGNOR_FIELDS = [
  { k:"consignor_name",       l:"氏名または法人名" },
  { k:"consignor_trade_name", l:"屋号" },
  { k:"consignor_corp_no",    l:"法人番号（任意）" },
  { k:"consignor_invoice_no", l:"インボイス登録番号（任意）" },
  { k:"consignor_rep_name",   l:"代表者名" },
  { k:"consignor_zip",        l:"郵便番号", ph:"例：7793300" },
  { k:"consignor_pref",       l:"都道府県" },
  { k:"consignor_city",       l:"市区町村" },
  { k:"consignor_addr",       l:"番地・建物名" },
  { k:"consignor_phone",      l:"電話番号" },
  { k:"consignor_email",      l:"メールアドレス" },
  { k:"consignor_emergency",  l:"緊急連絡先", ph:"氏名・続柄・電話番号" },
  { k:"consignor_bank",         l:"銀行名", ph:"例：阿波銀行" },
  { k:"consignor_bank_branch",  l:"支店名", ph:"例：鴨島支店" },
  { k:"consignor_account_type", l:"口座種別", sel:["普通","当座"] },
  { k:"consignor_account_no",   l:"口座番号", ph:"例：1234567" },
  { k:"consignor_account_name", l:"口座名義（カナ）", ph:"例：フクイ タキト" },
];
// 掲載プレビュー・印刷に反映する公開系の項目（緊急連絡先・振込情報は内部用so反映しない）。
// 住所は4分割の入力から保存時に合成した consignor_address（〒＋都道府県市区町村番地）を使う
const CONSIGNOR_PUBLIC_FIELDS = [
  { k:"consignor_name",       l:"氏名または法人名" },
  { k:"consignor_trade_name", l:"屋号" },
  { k:"consignor_corp_no",    l:"法人番号" },
  { k:"consignor_invoice_no", l:"インボイス登録番号" },
  { k:"consignor_rep_name",   l:"代表者名" },
  { k:"consignor_address",    l:"住所・所在地" },
  { k:"consignor_phone",      l:"電話番号" },
  { k:"consignor_email",      l:"メールアドレス" },
];
// 住所の合成（4分割→1行）。全分割が空なら ""（保存側で既存値を残す判定に使う）
const composeConsignorAddress = (f) => {
  const body = [f.consignor_pref, f.consignor_city, f.consignor_addr].map(x => (x || "").trim()).filter(Boolean).join("");
  if (!body) return "";
  const zip = (f.consignor_zip || "").trim();
  return (zip ? "〒" + zip + " " : "") + body;
};
// 振込情報の合成（5分割→1行）。全分割が空なら ""（保存側で既存値を残す判定に使う）
const composeConsignorBilling = (f) => {
  return [f.consignor_bank, f.consignor_bank_branch, f.consignor_account_type, f.consignor_account_no, f.consignor_account_name]
    .map(x => (x || "").trim()).filter(Boolean).join(" ");
};

// 設定ページのボックス設計（2026-07-31たきと指示「ボックス設計にして。タップで入力ボックス展開」）。
// 10項目を6ボックスに束ねる。v=ボックスに出す代表値のキー
const CONSIGNOR_BOXES = [
  { k:"name",      l:"氏名・名称",   keys:["consignor_name","consignor_trade_name","consignor_rep_name"], v:"consignor_name" },
  { k:"numbers",   l:"事業者番号",   keys:["consignor_corp_no","consignor_invoice_no"], v:"consignor_invoice_no" },
  { k:"address",   l:"住所・所在地", keys:["consignor_zip","consignor_pref","consignor_city","consignor_addr"], v:"consignor_city" },
  { k:"contact",   l:"連絡先",       keys:["consignor_phone","consignor_email"], v:"consignor_phone" },
  { k:"emergency", l:"緊急連絡先",   keys:["consignor_emergency"], v:"consignor_emergency" },
  { k:"billing",   l:"振込・請求",   keys:["consignor_bank","consignor_bank_branch","consignor_account_type","consignor_account_no","consignor_account_name"], v:"consignor_bank" },
];

// 委託者情報の設定フォーム（ブラック・アイコンなし）。初回は account_holders から氏名・住所・
// 電話・メールを下敷きに（空欄のみ埋める・保存は本人が押した時だけ＝雇い手プロフィールと同じ作法）
function ConsignorInfoEdit() {
  const [form, setForm] = useState(null); // null=読み込み中
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editBox, setEditBox] = useState(null); // 開いている入力ボックス（CONSIGNOR_BOXESのk）
  const [zipBusy, setZipBusy] = useState(false);
  const [zipError, setZipError] = useState("");
  // 郵便番号→住所の自動入力（zipcloud・求人フローstep3と同じ）。都道府県・市区町村を埋め、町域は番地欄の頭に
  const searchZip = async () => {
    const z = (form?.consignor_zip || "").replace(/[^0-9]/g, "");
    if (z.length !== 7) { setZipError("郵便番号は7桁で入力してください"); return; }
    setZipBusy(true); setZipError("");
    try {
      const res = await fetch("https://zipcloud.ibsnet.co.jp/api/search?zipcode=" + z);
      const j = await res.json();
      const r = j && j.results && j.results[0];
      if (!r) { setZipError("住所が見つかりませんでした"); }
      else setForm(p => ({ ...p, consignor_zip: z, consignor_pref: r.address1 || "", consignor_city: r.address2 || "", consignor_addr: (p.consignor_addr || "").trim() ? p.consignor_addr : (r.address3 || "") }));
    } catch { setZipError("検索に失敗しました。通信環境をご確認ください"); }
    setZipBusy(false);
  };
  useEffect(() => {
    (async () => {
      const empty = CONSIGNOR_FIELDS.reduce((a, f) => { a[f.k] = ""; return a; }, {});
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setForm(empty); return; }
        const { data } = await supabase.from("consignment_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        const cur = { ...empty, ...(data || {}) };
        // 初回シード（空欄のみ）：新規登録①の本人確認情報から。
        // 住所は4分割入力so郵便番号だけ下敷きに（1行住所の機械分割はしない＝day4教訓・表記ゆれで壊れる）
        if (!cur.consignor_name || !cur.consignor_zip || !cur.consignor_phone || !cur.consignor_email) {
          try {
            const { data: ah } = await supabase.from("account_holders")
              .select("full_name,company_name,postal_code,contact_phone,contact_email")
              .eq("auth_id", session.user.id).maybeSingle();
            if (ah) {
              if (!cur.consignor_name) cur.consignor_name = (ah.company_name || "").trim() || (ah.full_name || "").trim();
              if (!cur.consignor_rep_name && (ah.company_name || "").trim()) cur.consignor_rep_name = (ah.full_name || "").trim();
              if (!cur.consignor_zip) cur.consignor_zip = (ah.postal_code || "").trim().replace(/[^0-9]/g, "");
              if (!cur.consignor_phone) cur.consignor_phone = (ah.contact_phone || "").trim();
              if (!cur.consignor_email) cur.consignor_email = (ah.contact_email || "").trim() || (session.user.email || "");
            }
          } catch {}
        }
        setForm(cur);
      } catch { setForm(empty); }
    })();
  }, []);
  const save = async () => {
    if (saving || !form) return;
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSaving(false); return; }
      const payload = { auth_id: session.user.id, updated_at: new Date().toISOString() };
      CONSIGNOR_FIELDS.forEach(f => { payload[f.k] = (form[f.k] || "").trim(); });
      const composed = composeConsignorAddress(payload);
      if (composed) payload.consignor_address = composed; // 全分割が空なら既存の合成値を残す（旧データ保全）
      const composedBilling = composeConsignorBilling(payload);
      if (composedBilling) payload.consignor_billing = composedBilling; // 同上
      const { error } = await supabase.from("consignment_profiles").upsert(payload, { onConflict: "auth_id" });
      if (error) alert("保存に失敗しました：" + error.message);
      else { setSaved(true); setTimeout(() => setSaved(false), 2200); }
    } catch { alert("保存に失敗しました。"); }
    setSaving(false);
  };
  if (!form) return <p className="f-sans" style={{ fontSize:13, color:"#999999", textAlign:"center", padding:"24px 0" }}>読み込み中…</p>;
  const boxFields = editBox ? CONSIGNOR_FIELDS.filter(f => (CONSIGNOR_BOXES.find(b => b.k === editBox) || { keys:[] }).keys.includes(f.k)) : [];
  return (
    <div>
      <p className="f-sans" style={{ fontSize:13, color:"#111111", margin:"0 0 16px", lineHeight:1.7 }}>原則変更しない委託者情報です。案件の確認ページと印刷仕様書に自動で反映されます。タップして入力できます。</p>
      {/* ボックス格子（タップで入力モーダル展開・ブラック・アイコンなし） */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        {CONSIGNOR_BOXES.map(b => {
          const filled = b.keys.some(k => (form[k] || "").trim());
          const v = (form[b.v] || "").trim() || (filled ? "設定済み" : "");
          return (
            <button key={b.k} onClick={()=>setEditBox(b.k)} className="f-sans" style={{ background:"#fff", border:"1px solid #111111", borderRadius:20, padding:"20px 10px 16px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:8, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minWidth:0 }}>
              <span style={{ fontSize:14, fontWeight:700, color:"#111111" }}>{b.l}</span>
              <span style={{ fontSize:11, color: v ? "#111111" : "#B0B0B0", maxWidth:"100%", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{v || "未設定"}</span>
            </button>
          );
        })}
      </div>
      <p className="f-sans" style={{ fontSize:11, color:"#999999", margin:"12px 0 0" }}>緊急連絡先・振込情報は内部用です（掲載や印刷には出ません）。</p>
      {saved && <p className="f-sans" style={{ fontSize:12, color:"#111111", textAlign:"center", marginTop:10 }}>保存しました ✓</p>}

      {/* 入力モーダル（雇い手プロフィール編集と同じ様式・保存は全項目upsert） */}
      {editBox && (
        <div onClick={()=>setEditBox(null)} style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:"16px 16px calc(64px + 10px + env(safe-area-inset-bottom, 0px))", animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:520, width:"100%", maxHeight:"100%", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <button onClick={()=>setEditBox(null)} style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:18, color:"#111111", cursor:"pointer", zIndex:1 }}>✕</button>
            <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#111111", margin:"0 0 14px" }}>{(CONSIGNOR_BOXES.find(b => b.k === editBox) || {}).l}</p>
            {boxFields.map(f => (
              <div key={f.k} style={{ marginBottom:10 }}>
                <label className="lbl f-sans">{f.l}</label>
                {f.k === "consignor_account_no" ? (
                  <input className="field f-sans" inputMode="numeric" value={form[f.k]} onChange={e=>setForm(p=>({ ...p, [f.k]: e.target.value.replace(/[^0-9]/g, "") }))} placeholder={f.ph || ""} style={{ fontSize:14, marginBottom:0 }} />
                ) : f.k === "consignor_zip" ? (
                  <div>
                    <div style={{ display:"flex", gap:8 }}>
                      <input className="field f-sans" inputMode="numeric" value={form[f.k]} onChange={e=>setForm(p=>({ ...p, [f.k]: e.target.value.replace(/[^0-9]/g, "") }))} placeholder={f.ph || ""} style={{ fontSize:14, marginBottom:0, flex:1 }} />
                      <button type="button" onClick={searchZip} disabled={zipBusy} className="f-sans" style={{ flexShrink:0, padding:"0 14px", fontSize:13, fontWeight:700, background:"#fff", color:"#111111", border:"1px solid #111111", borderRadius:10, cursor:"pointer" }}>{zipBusy ? "検索中…" : "住所を検索"}</button>
                    </div>
                    {zipError && <p className="f-sans" style={{ fontSize:11, color:"#111111", fontWeight:700, margin:"6px 0 0" }}>{zipError}</p>}
                  </div>
                ) : f.sel ? (
                  <div style={{ display:"flex", gap:8 }}>
                    {f.sel.map(opt => {
                      const on = form[f.k] === opt;
                      return (
                        <button key={opt} type="button" onClick={()=>setForm(p=>({ ...p, [f.k]: on ? "" : opt }))} className="f-sans" style={{ padding:"9px 18px", fontSize:14, fontWeight:700, borderRadius:10, cursor:"pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>{opt}</button>
                      );
                    })}
                  </div>
                ) : f.ta ? (
                  <textarea className="field f-sans" value={form[f.k]} onChange={e=>setForm(p=>({ ...p, [f.k]: e.target.value }))} placeholder={f.ph || ""} rows={3} style={{ fontSize:13, lineHeight:1.7, marginBottom:0, resize:"vertical" }} />
                ) : (
                  <input className="field f-sans" value={form[f.k]} onChange={e=>setForm(p=>({ ...p, [f.k]: e.target.value }))} placeholder={f.ph || ""} style={{ fontSize:14, marginBottom:0 }} />
                )}
              </div>
            ))}
            {/* 旧・1行の保存値（分割入力が空のうちだけ参考表示。機械分割はしない＝day4教訓） */}
            {editBox === "address" && (form.consignor_address || "").trim() && !composeConsignorAddress(form) && (
              <p className="f-sans" style={{ fontSize:11, color:"#999999", margin:"0 0 10px" }}>現在の保存値：{form.consignor_address}（分割して入力し直すと置き換わります）</p>
            )}
            {editBox === "billing" && (form.consignor_billing || "").trim() && !composeConsignorBilling(form) && (
              <p className="f-sans" style={{ fontSize:11, color:"#999999", margin:"0 0 10px" }}>現在の保存値：{form.consignor_billing}（分割して入力し直すと置き換わります）</p>
            )}
            <button onClick={async ()=>{ await save(); setEditBox(null); }} disabled={saving} className="f-sans" style={{ width:"100%", padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor:"pointer", marginTop:4, opacity: saving ? 0.6 : 1 }}>{saving ? "保存中..." : "保存する"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// 背景の空（2026-07-31たきと指示「背景に太陽追加。朝昼夜を演出。時間によって太陽が左から右に移動」）。
// 現在のJST時刻から、太陽（昼）／月（夜）の位置（左→右）と空の色（朝昼夕夜）を決める。
// 昼＝5〜19時（14h）で太陽が左8%→右92%へ弧を描く。夜＝19〜翌5時（10h）は月が左→右。
const computeSky = (now) => {
  const jst = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 9 * 3600000);
  const h = jst.getHours() + jst.getMinutes() / 60;
  const arc = (prog) => 20 - Math.sin(prog * Math.PI) * 13; // 上端からの位置%（20→7→20＝昇って沈む）
  const leftOf = (prog) => 8 + prog * 84;                    // 横位置%（8→92）
  if (h >= 5 && h < 19) {
    const prog = (h - 5) / 14;
    let skyTop, orb, glow, chrome;
    // chrome＝skyTopを白地に重ねた不透明色。画面最上端（ステータスバー/ブラウザの帯）を空と同色に染める用
    if (h < 10)      { skyTop = "rgba(255,214,168,0.55)"; orb = "#FFC46B"; glow = "rgba(255,196,107,0.55)"; chrome = "#FFE8CF"; } // 朝
    else if (h < 15) { skyTop = "rgba(198,228,255,0.50)"; orb = "#FFE27A"; glow = "rgba(255,226,122,0.60)"; chrome = "#E3F1FF"; } // 昼
    else             { skyTop = "rgba(255,176,124,0.55)"; orb = "#FF8A4C"; glow = "rgba(255,138,76,0.55)"; chrome = "#FFD4B7"; }  // 夕
    return { isNight: false, left: leftOf(prog), top: arc(prog), skyTop, orb, glow, chrome };
  }
  const prog = (((h - 19) + 24) % 24) / 10; // 夜（19→翌5）
  return { isNight: true, left: leftOf(prog), top: arc(prog), skyTop: "rgba(28,32,60,0.60)", orb: "#E8ECF5", glow: "rgba(200,210,235,0.50)", chrome: "#77798A" };
};

export function ConsignmentRoom() {
  // 画面切替はURLで裏打ちする（2026-08-01たきと報告「スワイプで前のページに戻らない」の根治）：
  // 一覧=#/admin/consignment／新規=#/admin/consignment/new／案件=#/admin/consignment/deal/{id}／
  // 委託専用プロフィール=#/admin/consignment/profile（2026-07-31たきと指示）。
  // openDeal/newDeal/名刺タップはhashを進め、実際の画面切替はhashchangeが担う＝スワイプ・ブラウザ戻るが
  // そのまま「一覧へ戻る」になる（さがす→求人詳細と同じ作法）
  const readConsignView = () => {
    const h = window.location.hash.replace(/^#\/?/, "");
    const m = h.match(/^admin\/consignment\/deal\/([0-9a-f-]+)$/);
    if (m) return { view: "deal", id: m[1] };
    if (h === "admin/consignment/new") return { view: "new" };
    if (h === "admin/consignment/profile") return { view: "profile" };
    return { view: "list" };
  };
  const [cTab, setCTab] = useState(() => { const v = readConsignView().view; return v === "list" ? "list" : v === "profile" ? "profile" : v === "new" ? "new" : "deal"; }); // list=一覧 / deal=案件ダッシュボード / profile=委託専用プロフィール
  // 入場演出（ポケモンバトル風・2026-07-31たきと指示）：入室のたびに1回だけ再生。
  // ステップ展開（2026-07-31たきと指示）：群れ①が生え切ってから②、②の後に③＝三段のリズム。
  // 線(0.22s)→①右下(0.10s〜)→②左中(0.45s〜)→③右上(0.80s〜)→幕が開く(1.20s+0.5s)
  // ＝約1.7sで終演、1.95sでDOMから外す。
  // 動きを減らす設定の端末では最初から出さない（CSS側のprefers-reduced-motionと二重の判定）
  const [entrance, setEntrance] = useState(() => {
    try { return !window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return true; }
  });
  // 草の配置は入室ごとに抽選（毎回違うパターン・たきと指示）。再レンダーでは変えない＝useStateの初期化で1回だけ
  const [entranceGrass] = useState(makeConsignGrass);
  const [vines] = useState(makeConsignVines); // 背景の蔓も入室ごとに抽選
  const [sky] = useState(() => computeSky(new Date())); // 背景の空（朝昼夜・太陽/月の位置は入室時刻から）
  // 画面最上端（ステータスバー/ブラウザの帯）まで空に染める（2026-07-31たきと指示「背景を画面上限まで」）：
  // アプリが描けない上端の帯は theme-color と html背景から色を拾うOS/ブラウザが多い。
  // 委託ページ表示中だけ空の不透明色(chrome)に切替え、退室時に元へ戻す
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const prevMeta = meta ? meta.getAttribute("content") : null;
    const prevHtmlBg = document.documentElement.style.backgroundColor;
    const col = cTab === "new" ? "#FFFFFF" : sky.chrome; // ウィザードは背景ホワイト統一（2026-07-31たきと指示）
    if (meta) meta.setAttribute("content", col);
    document.documentElement.style.backgroundColor = col;
    return () => {
      if (meta && prevMeta != null) meta.setAttribute("content", prevMeta);
      document.documentElement.style.backgroundColor = prevHtmlBg;
    };
  }, [cTab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [wind, setWind] = useState(null); // 委託地の現在の風（Open-Meteo・{speed:km/h, dir:度(吹いてくる向き)}）
  // 四隅の蔓：大きさだけ隅ごとに抽選（140〜220px）。向きは四隅で固定＝反転で使い回す
  const [cornerSizes] = useState(() => Array.from({ length: 4 }, () => Math.round(140 + Math.random() * 80)));
  useEffect(() => {
    if (!entrance) return;
    const t = setTimeout(() => setEntrance(false), 1950);
    return () => clearTimeout(t);
  }, [entrance]);
  // 委託地（徳島県吉野川市）の現在の風を取得（Open-Meteo・無料/キー不要/CORS可）。
  // 失敗時は wind=null のまま＝既定のゆるやかな揺れにフォールバック（zipcloudと同じくクライアント取得）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=34.066&longitude=134.366&current=wind_speed_10m,wind_direction_10m");
        const j = await res.json();
        const c = j && j.current;
        if (!cancelled && c) setWind({ speed: Number(c.wind_speed_10m) || 0, dir: Number(c.wind_direction_10m) || 0 });
      } catch { /* 取得失敗は既定の揺れのまま */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const [spec, setSpec] = useState({ ...CONSIGN_EMPTY });
  const [editId, setEditId] = useState(null);
  const [curDeal, setCurDeal] = useState(null); // 開いている案件の全行（status/agreed_at/inspected_at/paid_at/spec_snapshot等）
  const [status, setStatus] = useState("draft");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [showDeadlineCal, setShowDeadlineCal] = useState(false);
  const [wizStep, setWizStep] = useState(1); // 新規ウィザードの現在ステップ（1〜5・cTab==="new"時のみ有効）
  const [leaving, setLeaving] = useState(false); // 退場演出中（新しく委託を出す→蔓→太陽→中身の順に画面外へ・2026-07-31たきと指示）
  const [returning, setReturning] = useState(false); // 帰還演出中（ウィザード→一覧に戻るとき、退場の逆再生＝中身→太陽→蔓・2026-07-31たきと指示）
  const [printOpen, setPrintOpen] = useState(false);
  const [deals, setDeals] = useState([]);
  const [progAgg, setProgAgg] = useState({}); // 台帳の要約用：deal_id→{hours,boxes,days}
  const [busy, setBusy] = useState(false);
  const todayJst = () => { try { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); } catch { return new Date().toISOString().slice(0, 10); } };
  // 日次進捗（作業中）
  const [prog, setProg] = useState([]);
  const [summary, setSummary] = useState(null);
  const [pForm, setPForm] = useState({ work_date: "", hours: "", workers: "", yield_boxes: "", note: "" });
  const [inspectNote, setInspectNote] = useState("");
  const [reflection, setReflection] = useState("");
  const dealAreaA = (d) => { const v = d?.area_a != null ? d.area_a : (d?.spec || {}).area_a; const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const hoursPer10a = (hours, area) => area ? Math.round(hours * 10 / area * 10) / 10 : null;
  const loadDeals = async () => {
    const [dl, pr] = await Promise.all([
      supabase.from("consignment_deals").select("*").order("created_at", { ascending: false }),
      supabase.from("consignment_progress").select("deal_id,hours,yield_boxes,work_date"),
    ]);
    setDeals(dl.data || []);
    const agg = {};
    (pr.data || []).forEach(r => { const a = agg[r.deal_id] || { hours: 0, boxes: 0, days: new Set() }; a.hours += Number(r.hours || 0); a.boxes += Number(r.yield_boxes || 0); if (r.work_date) a.days.add(r.work_date); agg[r.deal_id] = a; });
    const out = {}; Object.entries(agg).forEach(([k, v]) => { out[k] = { hours: v.hours, boxes: v.boxes, days: v.days.size }; });
    setProgAgg(out);
    return dl.data || [];
  };
  const loadProgress = async (id) => {
    if (!id) { setProg([]); setSummary(null); return; }
    const [{ data: rows }, { data: sum }] = await Promise.all([
      supabase.from("consignment_progress").select("*").eq("deal_id", id).order("work_date", { ascending: false }),
      supabase.rpc("consignment_summary", { p_deal_id: id }),
    ]);
    setProg(rows || []);
    setSummary(sum && sum.ok ? sum : null);
  };
  // トップの大プロフィールカード用（農家プロフィール入口と同じ構造・2026-07-31たきと指示）。
  // 名刺の中身は employer_profiles の自分の行から（このページはprops無しなので自分で引く）
  const [empMini, setEmpMini] = useState(null);
  // 委託者情報（設定ページの保存値・確認STEP5と印刷仕様書へ自動反映）。設定ページから戻るたびに再読込
  const [consignor, setConsignor] = useState(null);
  useEffect(() => {
    if (cTab === "profile") return; // 設定ページ自身はフォーム側が読む
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data } = await supabase.from("consignment_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        setConsignor(data || null);
      } catch {}
    })();
  }, [cTab]);
  // ★mount時の読み込み（loadDeals・名刺・リロード復元）は openDealState の定義より後ろに置いた
  //   effectが担う（no-use-before-define対応＝「呼ぶ側・effectを下げる」の作法・2026-07-29教訓）
  const setF = (k, v) => setSpec(p => ({ ...p, [k]: v }));
  // 写真アップロード（consignment-photos バケット・管理者のみ書込＝RLSで担保）。
  // 複数選択可・spec.photos に {url} で追記。job-photos の作法に準拠
  const handlePhotoFiles = async (files) => {
    const list = files ? Array.from(files) : [];
    if (!list.length) return;
    setPhotoUploading(true);
    try {
      for (const file of list) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `consign_${Date.now()}_${Math.round(Math.random() * 1e6)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("consignment-photos").upload(path, file, { upsert: false });
        if (upErr) { alert("写真のアップロードに失敗しました：" + upErr.message); continue; }
        const { data: pub } = supabase.storage.from("consignment-photos").getPublicUrl(path);
        setSpec(p => ({ ...p, photos: [...(p.photos || []), { url: pub.publicUrl }] }));
      }
    } catch { alert("写真のアップロードに失敗しました。"); }
    setPhotoUploading(false);
  };
  const removePhoto = (i) => setSpec(p => ({ ...p, photos: (p.photos || []).filter((_, k) => k !== i) }));
  // 履行期限のカレンダー選択（1回目=開始／2回目=終了／開始より前=選び直し）。
  // raw(date_start/date_end)とラベル(deadline)を同時に更新
  const onDeadlineSelect = (dt) => {
    const ds = parseYmd(spec.date_start);
    const de = parseYmd(spec.date_end);
    let ns, ne;
    if (!ds || de) { ns = dt; ne = null; }
    else if (dt >= ds) { ns = ds; ne = dt; }
    else { ns = dt; ne = null; }
    const nds = ymdLocal(ns);
    const nde = ne ? ymdLocal(ne) : "";
    setSpec(p => ({ ...p, date_start: nds, date_end: nde, deadline: deadlineLabel(nds, nde) }));
  };
  const refreshCur = async (id) => {
    const { data } = await supabase.from("consignment_deals").select("*").eq("id", id).maybeSingle();
    if (data) { setCurDeal(data); setStatus(data.status || "draft"); }
    await loadDeals();
  };
  const save = async () => {
    if (saving) return false;
    if ((spec.photos || []).length < 3) { alert("掲載には写真が最低3枚必要です。"); return false; }
    setSaving(true);
    try {
      const payload = { spec: { ...spec, crop: CONSIGN_CROP, fixed_clauses: CONSIGN_FIXED_CLAUSES }, status, notes: memo.trim() || null, updated_at: new Date().toISOString() };
      if (editId) {
        const { error } = await supabase.from("consignment_deals").update(payload).eq("id", editId);
        if (error) { alert("保存に失敗しました：" + error.message); setSaving(false); return false; }
        await refreshCur(editId);
      } else {
        const { data, error } = await supabase.from("consignment_deals").insert(payload).select("*").single();
        if (error) { alert("保存に失敗しました：" + error.message); setSaving(false); return false; }
        if (data) {
          setEditId(data.id); setCurDeal(data);
          // URLを /new → /deal/{id} に置換（pushしない＝スワイプ/戻る1回で一覧へ帰れるまま）
          try { window.history.replaceState(null, "", "#/admin/consignment/deal/" + data.id); } catch {}
        }
        await loadDeals();
      }
    } catch { alert("保存に失敗しました。"); setSaving(false); return false; }
    setSaving(false);
    return true;
  };
  // 状態を1つ進める共通処理（合意/前金/作業中/検収/支払/完了）。パッチをupdate→現行行を取り直す
  const advance = async (patch, confirmMsg) => {
    if (busy || !editId) return;
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    const { error } = await supabase.from("consignment_deals").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", editId);
    if (error) { alert("更新に失敗しました：" + error.message); setBusy(false); return; }
    await refreshCur(editId);
    setBusy(false);
  };
  const makeAgreed = () => advance({ status: "agreed" }, "この内容で合意にしますか？\n合意すると、いまの仕様書が「合意時の仕様書」として凍結されます。");
  const receiveDeposit = async () => advance({ spec: { ...(curDeal?.spec || spec), deposit_received_at: todayJst() } }, "着手金を受領した記録を残しますか？");
  const startWork = () => advance({ status: "working" }, "作業中にしますか？");
  const doInspect = () => advance({ status: "inspected", inspected_at: todayJst(), notes: inspectNote.trim() || (curDeal?.notes || null) }, "検収を記録しますか？");
  const doPay = () => advance({ status: "paid", paid_at: todayJst() }, "残金の支払いを記録しますか？");
  const doComplete = () => advance({ status: "done", spec: { ...(curDeal?.spec || spec), reflection: reflection.trim() } }, "この委託を完了にしますか？");
  const addProgress = async () => {
    if (busy || !editId) return;
    const p = pForm;
    if (!p.hours && !p.yield_boxes && !p.workers && !p.note.trim()) { alert("実働時間・人数・収量箱・メモのいずれかを入力してください。"); return; }
    setBusy(true);
    const { error } = await supabase.from("consignment_progress").insert({
      deal_id: editId,
      work_date: p.work_date || todayJst(),
      hours: p.hours === "" ? null : Number(p.hours),
      workers: p.workers === "" ? null : parseInt(p.workers, 10),
      yield_boxes: p.yield_boxes === "" ? null : parseInt(p.yield_boxes, 10),
      note: p.note.trim() || "",
    });
    if (error) { alert("記録に失敗しました：" + error.message); setBusy(false); return; }
    setPForm({ work_date: "", hours: "", workers: "", yield_boxes: "", note: "" });
    await loadProgress(editId);
    setBusy(false);
  };
  const openDealState = (d) => { setSpec({ ...CONSIGN_EMPTY, ...(d.spec || {}) }); setEditId(d.id); setCurDeal(d); setStatus(d.status || "draft"); setMemo(d.notes || ""); setInspectNote(d.notes || ""); setReflection((d.spec || {}).reflection || ""); setCTab("deal"); loadProgress(d.id); };
  const newDealState = () => { setSpec({ ...CONSIGN_EMPTY }); setEditId(null); setCurDeal(null); setStatus("draft"); setMemo(""); setInspectNote(""); setReflection(""); setProg([]); setSummary(null); setWizStep(1); setCTab("new"); };
  const openDeal = (d) => { openDealState(d); window.location.hash = "/admin/consignment/deal/" + d.id; };
  // 新しく委託を出す：まず蔓が画面外へ→次に太陽→最後に名刺・ボックス・文言が退場→ウィザードへ（2026-07-31たきと指示）。
  // 振り付けはCSS（.consign-leaving）。動きを減らす設定の端末は演出なしで即遷移
  const newDeal = () => {
    if (leaving) return;
    let reduce = false; try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch {}
    if (reduce) { newDealState(); window.location.hash = "/admin/consignment/new"; return; }
    setLeaving(true);
    setTimeout(() => { setLeaving(false); newDealState(); window.location.hash = "/admin/consignment/new"; }, 1250);
  };
  // mount時の読み込み：一覧＋名刺。URLが /deal/{id} のままのリロードは取得行でその案件を開き直す
  useEffect(() => {
    (async () => {
      const rows = await loadDeals();
      const c0 = readConsignView();
      if (c0.view === "deal") { const d0 = (rows || []).find(x => x.id === c0.id); if (d0) openDealState(d0); }
    })();
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data } = await supabase.from("employer_profiles").select("nickname,avatar_url").eq("auth_id", session.user.id).maybeSingle();
        setEmpMini(data || null);
      } catch {}
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // スワイプ・戻る・URL直打ちの全部をここで受ける。dealsはクロージャで凍るためrefで最新を持つ
  const dealsRef = useRef([]);
  useEffect(() => { dealsRef.current = deals; }, [deals]);
  const cTabRef = useRef(cTab);
  useEffect(() => { cTabRef.current = cTab; }, [cTab]);
  useEffect(() => {
    const onHash = () => {
      const c = readConsignView();
      if (c.view === "list") {
        // ウィザードからの帰還＝退場演出の逆再生（中身→太陽→蔓）。戻るタップも指スワイプもhash経由でここに来る
        if (cTabRef.current === "new") {
          let reduce = false; try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch {}
          if (!reduce) { setReturning(true); setTimeout(() => setReturning(false), 1300); }
        }
        setCTab("list"); loadDeals();
      }
      else if (c.view === "new") { newDealState(); }
      else if (c.view === "profile") { setCTab("profile"); }
      else { const d = dealsRef.current.find(x => x.id === c.id); if (d) openDealState(d); }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 合意後にフォームを変更したか（保存済みspec vs 凍結snapshot・基本/テキスト項目で比較）
  const specKeys = [...CONSIGN_BASIC_FIELDS.map(f => f.k), ...CONSIGN_TEXT_FIELDS.map(f => f.k)];
  const pick = (o) => specKeys.reduce((a, k) => { a[k] = (o || {})[k] || ""; return a; }, {});
  const changedAfterAgree = !!(curDeal && curDeal.spec_snapshot && JSON.stringify(pick(curDeal.spec)) !== JSON.stringify(pick(curDeal.spec_snapshot)));
  const snapAtLabel = curDeal?.snapshot_at ? new Date(curDeal.snapshot_at).toLocaleString("ja-JP") : "";
  const hasDeposit = !!(spec.advance && String(spec.advance).trim());
  // 風→蔓の靡き（2026-07-31たきと指示）：向き=東西成分で左右に傾け、強さ=風速で揺れ幅と速さを増す。
  // dir は「吹いてくる向き」so東向きの押し＝-sin(dir)（西風→右へ／東風→左へ）。未取得は0＝従来のゆるやか
  const windSpeed = wind ? wind.speed : 0;                 // km/h
  const windEast = wind ? -Math.sin(wind.dir * Math.PI / 180) : 0; // +右 / -左
  const swayAmp = Math.min(16, 2.5 + windSpeed * 0.35);   // 揺れ幅（度）
  const swayCenter = +(windEast * Math.min(14, windSpeed * 0.5)).toFixed(1); // 傾き中心（度・風向き）
  const windMult = Math.min(3, 1 + windSpeed * 0.05);     // 揺れの速さ倍率（風速で速く）

  // ── 入力部品（案件ダッシュボード(deal)と新規ウィザード(new)で共用・2026-07-31）──
  const renderBasicField = (f) => (
            <div key={f.k} style={{ marginBottom:10 }}>
              <label className="lbl f-sans">{f.l}</label>
              {f.k === "crop" ? (
                // ブロッコリー固定（入力不可）。この委託はブロッコリーのみ
                <div><span className="f-sans" style={{ display:"inline-block", padding:"9px 18px", fontSize:14, fontWeight:700, borderRadius:10, background:"#111111", color:"#fff" }}>{CONSIGN_CROP}</span></div>
              ) : f.k === "deadline" ? (
                // 履行期限＝開始+終了の日付範囲。同じ欄をタップでカレンダー展開（ブラック）
                <div>
                  <button type="button" onClick={()=>setShowDeadlineCal(v => !v)} className="field f-sans" style={{ width:"100%", textAlign:"left", fontSize:14, marginBottom:0, cursor:"pointer", background:"#fff", color: spec.date_start ? "#111111" : "#999999" }}>
                    {spec.date_start ? deadlineLabel(spec.date_start, spec.date_end) : "タップして期間を選択"}
                  </button>
                  {showDeadlineCal && (
                    <CalendarView accent="#111111" accentSoft="#EEEEEE" hideHints start={parseYmd(spec.date_start)} end={parseYmd(spec.date_end)} onSelect={onDeadlineSelect} />
                  )}
                  <p className="f-sans" style={{ fontSize:11, color:"#999999", margin:"6px 0 0" }}>1回目のタップで開始日、2回目で終了日。終了日を選ばなければ開始日のみ。</p>
                </div>
              ) : f.k === "task" ? (
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {CONSIGN_TASKS.map(t => {
                    const sel = (spec.task ? spec.task.split("・").filter(Boolean) : []).includes(t);
                    return (
                      <button key={t} type="button" onClick={()=>{
                        const cur = spec.task ? spec.task.split("・").filter(Boolean) : [];
                        const next = cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t];
                        setF("task", CONSIGN_TASKS.filter(x => next.includes(x)).join("・"));
                      }} className="f-sans" style={{ padding:"9px 18px", fontSize:14, fontWeight:700, borderRadius:10, cursor:"pointer", border: sel ? "2px solid #111111" : "1px solid #D0D0D0", background: sel ? "#111111" : "#fff", color: sel ? "#fff" : "#111111" }}>{t}</button>
                    );
                  })}
                </div>
              ) : (
                <input className="field f-sans" value={spec[f.k]} onChange={e=>setF(f.k, e.target.value)} placeholder={f.ph || ""} style={{ fontSize:14, marginBottom:0 }} />
              )}
            </div>
  );
  const renderTextField = (f) => (
            <div key={f.k} style={{ marginBottom:10 }}>
              <label className="lbl f-sans">{f.l}</label>
              <textarea className="field f-sans" value={spec[f.k]} onChange={e=>setF(f.k, e.target.value)} placeholder={f.ph} rows={3} style={{ fontSize:13, lineHeight:1.7, marginBottom:0, resize:"vertical" }} />
            </div>
  );
  const renderHazards = () => (
          <div style={{ marginBottom:10 }}>
            <label className="lbl f-sans">危険情報</label>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {CONSIGN_HAZARDS.map(h => {
                const on = (spec.hazards || []).includes(h);
                return (
                  <button key={h} type="button" onClick={()=>{
                    const cur = spec.hazards || [];
                    setF("hazards", cur.includes(h) ? cur.filter(x => x !== h) : [...cur, h]);
                  }} className="f-sans" style={{ display:"flex", alignItems:"center", gap:10, textAlign:"left", padding:"10px 14px", fontSize:14, fontWeight:600, borderRadius:10, cursor:"pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>
                    <span style={{ flexShrink:0, width:18, height:18, borderRadius:5, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, border: on ? "none" : "2px solid #C8C8C8", background: on ? "#fff" : "transparent", color:"#111111" }}>{on ? "✓" : ""}</span>
                    {h}
                  </button>
                );
              })}
              {(spec.hazards || []).includes("その他") && (
                <input className="field f-sans" value={spec.hazard_other || ""} onChange={e=>setF("hazard_other", e.target.value)} placeholder="その他の危険（自由記述）" style={{ fontSize:13, marginBottom:0 }} />
              )}
            </div>
          </div>
  );
  const renderPhotos = () => (
          <div style={{ marginBottom:10 }}>
            <label className="lbl f-sans">写真（最低3枚）</label>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {(spec.photos || []).map((ph, i) => (
                <div key={i} style={{ position:"relative", width:96, height:96, borderRadius:10, overflow:"hidden", border:"1px solid #E5E5E5" }}>
                  <img src={ph.url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} />
                  <button type="button" onClick={()=>removePhoto(i)} className="f-sans" style={{ position:"absolute", top:2, right:2, width:22, height:22, borderRadius:"50%", background:"rgba(0,0,0,0.6)", color:"#fff", border:"none", fontSize:14, lineHeight:1, cursor:"pointer" }}>×</button>
                </div>
              ))}
              <label className="f-sans" style={{ width:96, height:96, borderRadius:10, border:"1px dashed #B0B0B0", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor: photoUploading ? "default" : "pointer", fontSize:12, color:"#111111", gap:2 }}>
                {photoUploading ? "…" : (<><span style={{ fontSize:22, lineHeight:1 }}>＋</span>写真</>)}
                <input type="file" accept="image/*" multiple onChange={e=>{ handlePhotoFiles(e.target.files); e.target.value=""; }} style={{ display:"none" }} disabled={photoUploading} />
              </label>
            </div>
            <p className="f-sans" style={{ fontSize:11, margin:"6px 0 0", color: (spec.photos || []).length >= 3 ? "#999999" : "#111111", fontWeight: (spec.photos || []).length >= 3 ? 400 : 700 }}>
              {(spec.photos || []).length}枚（掲載には最低3枚必要です）
            </p>
          </div>
  );

  if (printOpen) {
    return (
      <div className="cb-consign-page" style={{ maxWidth:760, margin:"0 auto", padding:"24px 16px 120px", paddingTop:"calc(24px + env(safe-area-inset-top, 0px))" }}>
        <div className="no-print" style={{ display:"flex", gap:8, marginBottom:16 }}>
          <button onClick={()=>setPrintOpen(false)} className="f-sans" style={{ padding:"9px 16px", fontSize:13, fontWeight:600, background:"#fff", color:"#111111", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>← 戻る</button>
          <button onClick={()=>window.print()} className="f-sans" style={{ padding:"9px 20px", fontSize:13, fontWeight:700, borderRadius:10, background:"#111111", color:"#fff", border:"none", cursor:"pointer" }}>印刷する</button>
        </div>
        <div className="consign-print" style={{ background:"#fff", border:"1px solid #DDD", borderRadius:4, padding:"32px 28px", fontFamily:"serif", color:"#111" }}>
          <h1 className="f-sans" style={{ fontSize:22, fontWeight:800, textAlign:"center", margin:"0 0 4px" }}>農作業委託 仕様書</h1>
          <p className="f-sans" style={{ fontSize:11, color:"#666", textAlign:"center", margin:"0 0 20px" }}>chitose-bank 委託準備室</p>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, marginBottom:18 }}>
            <tbody>
              {CONSIGN_BASIC_FIELDS.map(f => [f.l, spec[f.k]]).map(([l, v]) => (
                <tr key={l}>
                  <td style={{ border:"1px solid #999", padding:"7px 10px", width:170, background:"#F5F5F5", fontWeight:700 }}>{l}</td>
                  <td style={{ border:"1px solid #999", padding:"7px 10px" }}>{v || "　"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {CONSIGN_TEXT_FIELDS.map(f => (
            <div key={f.k} style={{ marginBottom:14 }}>
              <p className="f-sans" style={{ fontSize:13, fontWeight:700, margin:"0 0 4px" }}>■ {f.l}</p>
              <p style={{ fontSize:13, lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", border:"1px solid #999", padding:"8px 10px", minHeight:36 }}>{spec[f.k] || "　"}</p>
            </div>
          ))}
          <div style={{ marginBottom:14 }}>
            <p className="f-sans" style={{ fontSize:13, fontWeight:700, margin:"0 0 4px" }}>■ 危険情報</p>
            <p style={{ fontSize:13, lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", border:"1px solid #999", padding:"8px 10px", minHeight:36 }}>{(spec.hazards || []).length ? (spec.hazards || []).map(h => h === "その他" && spec.hazard_other ? "その他（" + spec.hazard_other + "）" : h).join("・") : "特になし"}</p>
          </div>
          {consignor && CONSIGNOR_PUBLIC_FIELDS.some(f => (consignor[f.k] || "").trim()) && (
            <div style={{ marginBottom:14 }}>
              <p className="f-sans" style={{ fontSize:13, fontWeight:700, margin:"0 0 4px" }}>■ 委託者（発注者）</p>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <tbody>
                  {CONSIGNOR_PUBLIC_FIELDS.filter(f => (consignor[f.k] || "").trim()).map(f => (
                    <tr key={f.k}>
                      <td style={{ border:"1px solid #999", padding:"7px 10px", width:170, background:"#F5F5F5", fontWeight:700 }}>{f.l}</td>
                      <td style={{ border:"1px solid #999", padding:"7px 10px" }}>{consignor[f.k]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop:18 }}>
            <p className="f-sans" style={{ fontSize:13, fontWeight:700, margin:"0 0 6px" }}>■ 定型条項（全仕様書共通）</p>
            {CONSIGN_FIXED_CLAUSES.map(c => (
              <p key={c} style={{ fontSize:12, lineHeight:1.9, margin:0 }}>・{c}</p>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={"cb-consign-page fade-in" + (leaving ? " consign-leaving" : "") + (returning ? " consign-returning" : "")} style={{ maxWidth:640, margin:"0 auto", padding:"24px 16px 120px", paddingTop:"calc(24px + env(safe-area-inset-top, 0px))" }}>
      {/* 背景の空（2026-07-31たきと指示）：朝昼夜の色＋太陽/月が時刻で左→右に移動。
          蔓より奥（z-index:-2）に敷く。上端から色が差し込み、下は透明に抜ける */}
      {cTab !== "new" && (
      <div className="consign-sky" aria-hidden="true" style={{ background: `linear-gradient(to bottom, ${sky.skyTop} 0%, rgba(255,255,255,0) 44%)` }}>
        <div className="consign-sky-orb" style={{ left: sky.left + "%", top: sky.top + "%", background: sky.orb, boxShadow: `0 0 44px 12px ${sky.glow}` }} />
      </div>
      )}
      {/* 背景の環境：画面上端から垂れ下がる黒い草の蔓（2026-07-31たきと指示）。
          z-index:-1でページ内容の下に敷く（白いカードの裏に自然に隠れる）。ゆっくり揺れる */}
      {cTab !== "new" && (
      <div className="consign-vines" aria-hidden="true" style={{ "--sway-center": swayCenter, "--sway-amp": swayAmp }}>
        {vines.map((sp, i) => {
          const d = CONSIGN_VINES[sp.v];
          return (
            <svg key={i} viewBox="0 0 60 120" style={{ left: sp.x + "%", height: sp.h, width: sp.h / 2, animationDuration: (sp.dur / windMult).toFixed(2) + "s", animationDelay: "-" + sp.delay + "s" }}>
              <g transform={sp.flip ? "translate(60 0) scale(-1 1)" : undefined}>
                {d.stems.map((st, k) => (
                  <path key={k} d={st} fill="none" stroke="#D0D0D0" strokeWidth="2.4" strokeLinecap="round" />
                ))}
                {d.leaves.map(([x, y, a], k) => (
                  <ellipse key={k} rx="7" ry="3" fill="#D0D0D0" transform={`translate(${x} ${y}) rotate(${a})`} />
                ))}
              </g>
            </svg>
          );
        })}
      </div>
      )}
      {/* 四隅の蔓（2026-07-31たきと指示）：角を抱くように這う。左上の形を反転で4隅に配る。
          -6pxのはみ出し＝紙の外から蔓が入り込んでいる見え方。揺らさない（額縁は静かに） */}
      {cTab !== "new" && (
      <div className="consign-corners" aria-hidden="true">
        {[
          { pos: { top: -6, left: -6 },     tr: "" },
          { pos: { top: -6, right: -6 },    tr: "scaleX(-1)" },
          { pos: { bottom: -6, left: -6 },  tr: "scaleY(-1)" },
          { pos: { bottom: -6, right: -6 }, tr: "scale(-1,-1)" },
        ].map((cn, i) => (
          <svg key={i} viewBox="0 0 120 120" style={{ ...cn.pos, width: cornerSizes[i], height: cornerSizes[i], transform: cn.tr || undefined }}>
            {CONSIGN_CORNER_VINE.stems.map((st, k) => (
              <path key={k} d={st} fill="none" stroke="#D0D0D0" strokeWidth="2.4" strokeLinecap="round" />
            ))}
            {CONSIGN_CORNER_VINE.leaves.map(([x, y, a], k) => (
              <ellipse key={k} rx="6.5" ry="2.8" fill="#D0D0D0" transform={`translate(${x} ${y}) rotate(${a})`} />
            ))}
          </svg>
        ))}
      </div>
      )}
      {/* 入場演出：黒幕＋白線→草の群れが右→左→右と下から上へ→幕が上下に開いてフィールド展開。
          群れは所属する幕の中に描く＝幕が開くと群れごと退場する */}
      {entrance && (
        <div className="consign-entrance" aria-hidden="true">
          {["top", "bottom"].map(panel => (
            <div key={panel} className={"consign-entrance-" + panel}>
              {panel === "bottom" && <div className="consign-entrance-line" />}
              {entranceGrass.filter(c => c.panel === panel).map((c, ci) => (
                c.kind === "sun" ? (
                  // 夏仕様：一番上の群れ＝白い太陽が爛々と輝く（2026-07-31たきと指示）。
                  // 円盤＋放射する光条（長短交互＝きらめき）＋脈打つ光輪(glow)。回転と脈動はCSS側。
                  // 上幕の中に居るので、幕が開くと太陽ごとスライド退場する（草と同じ片付け不要の仕組み）
                  <div key={ci} className="consign-sun" style={{ top: c.sunTop + "%", left: c.sunLeft + "%", width: c.sunSize, height: c.sunSize, marginLeft: -c.sunSize / 2, animationDelay: c.delay + "s" }}>
                    <div className="consign-sun-glow" />
                    <svg className="consign-sun-rays" viewBox="-100 -100 200 200">
                      {Array.from({ length: 16 }, (_, k) => {
                        const long = k % 2 === 0;
                        return <line key={k} x1="0" y1={long ? -58 : -54} x2="0" y2={long ? -97 : -80} stroke="#fff" strokeWidth={long ? 5 : 3.4} strokeLinecap="round" transform={`rotate(${k * 22.5})`} />;
                      })}
                    </svg>
                    <svg className="consign-sun-disc" viewBox="-100 -100 200 200">
                      <circle cx="0" cy="0" r="40" fill="#fff" />
                    </svg>
                  </div>
                ) : (
                <div key={ci} className="consign-entrance-cluster" style={c.pos}>
                  {c.sprigs.map((sp, i) => {
                    const d = CONSIGN_SPRIGS[sp.v];
                    return (
                      // 株は群れの帯の中に絶対配置（根元は端の側=右左の分離・2026-07-31たきと指示）。
                      // flip/tiltはsvg内の<g>で行う（外のtransformはscaleYの生えるアニメが上書きしてしまうため）
                      <svg key={i} viewBox="0 0 40 80" style={{ position: "absolute", bottom: sp.y, [c.anchor]: sp.x + "%", height: sp.h, width: sp.h / 2, animationDelay: (c.delay + sp.d).toFixed(2) + "s" }}>
                        <g transform={`${sp.flip ? "translate(40 0) scale(-1 1) " : ""}rotate(${sp.tilt} 20 80)`}>
                          <path d={d.stem} fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
                          {d.leaves.map(([x, y, a], k) => (
                            <ellipse key={k} rx="6.4" ry="2.6" fill="#fff" transform={`translate(${x} ${y}) rotate(${a})`} />
                          ))}
                        </g>
                      </svg>
                    );
                  })}
                </div>
                )
              ))}
            </div>
          ))}
        </div>
      )}
      {/* トップ画=一覧（さがすページと同じ設計・2026-07-31たきと指示）：カードの一覧→タップで
          案件ダッシュボード(deal)へ。←戻る・見出し・入口カードは一覧側だけに出す */}
      {cTab === "list" && (<div className="consign-list-content">
      {/* 戻り先は雇い手プロフィール入口（2026-07-31たきと指示・管理タブではない）：
          入口カード「新しく委託を出す」が置いてある場所へ帰る。ラベルも「← 戻る」に */}
      <button onClick={()=>{ window.location.hash = "/profile/employer"; }} className="f-sans" style={{ display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:12, fontWeight:600, color:"#111111", cursor:"pointer", padding:"7px 14px", marginBottom:16 }}>← 戻る</button>
      {/* 大プロフィールカード（農家プロフィール入口と同じ構造・2026-07-31たきと指示。カラーはブラック：
          緑2px枠→黒2px枠・役割ピル「農家」→「委託主」。反転⇄はプレビュー相当が無いので置かない） */}
      {/* 名刺タップで委託専用プロフィールページへ遷移（2026-07-31たきと指示・雇い手プロフィールではない） */}
      <button type="button" onClick={()=>{ setCTab("profile"); window.location.hash = "/admin/consignment/profile"; }} className="f-sans" style={{ position:"relative", width:"100%", background:"#fff", border:"2px solid #111111", borderRadius:24, padding:"28px 20px", display:"flex", flexDirection:"column", alignItems:"center", gap:12, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minHeight:180, boxSizing:"border-box", marginBottom:12, cursor:"pointer" }}>
        <Avatar url={empMini?.avatar_url} name={empMini?.nickname} size={84} bg="#111111" />
        <span style={{ textAlign:"center" }}>
          <span className="f-sans" style={{ display:"block", fontSize:22, fontWeight:800, color:"#111111" }}>{empMini?.nickname || "名称未設定"}</span>
          <span className="f-sans" style={{ display:"inline-block", marginTop:6, fontSize:13, fontWeight:800, color:"#fff", background:"#111111", borderRadius:20, padding:"3px 14px" }}>委託主</span>
        </span>
      </button>

      {/* 新しく委託を出す（2026-07-31たきと指示・農家の「新しく求人を出す」と同じワイドカード）。
          配色はブラック＝委託・受託の世界（求人・求職のオレンジ／ミドリとは分ける）。アイコンは置かない。
          管理者のみ：この部屋自体が admin ゲートの内側で、consignment_deals のRLSも app_admins 限定。
          行き先は新規委託ウィザード（#/admin/consignment/new・思考順5ステップ） */}
      <button onClick={newDeal} className="f-sans" style={{ position:"relative", overflow:"hidden", width:"100%", margin:"0 0 16px", background:"#111111", border:"none", borderRadius:20, padding:"20px 18px", cursor:"pointer", display:"block", textAlign:"left" }}>
        {/* カードの角を這う白い蔓（2026-07-31たきと指示）。文字はzIndexで蔓の上に */}
        <VineCorner flip size={110} style={{ top:-6, right:-6, opacity:0.5 }} />
        <span className="f-sans" style={{ position:"relative", zIndex:1, display:"block", fontSize:16, fontWeight:800, color:"#fff", letterSpacing:".02em" }}>新しく委託を出す</span>
        <span className="f-sans" style={{ position:"relative", zIndex:1, display:"block", fontSize:13, color:"#B9B9B9", marginTop:4, lineHeight:1.6 }}>5つのステップで掲載まで進みます。</span>
      </button>
      </div>)}

      {/* 委託者情報の設定ページ（#/admin/consignment/profile・2026-07-31たきと指示）。
          原則変更しない本人・事業者情報を入力し、案件作成（確認STEP5・印刷仕様書）に自動反映する。
          保存先は consignment_profiles の consignor_* 列（雇い手プロフィールとは独立） */}
      {cTab === "profile" && (
        <div className="fade-in">
          <button onClick={()=>{ setCTab("list"); window.location.hash = "/admin/consignment"; }} className="f-sans" style={{ display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:12, fontWeight:600, color:"#111111", cursor:"pointer", padding:"7px 14px", marginBottom:16 }}>← 委託一覧</button>
          <ConsignorInfoEdit />
        </div>
      )}

      {/* ═══ 新規委託ウィザード（#/admin/consignment/new・2026-07-31たきと指示）═══
          「入力順」でなく「契約が成立するまでの思考順」＝受託者の頭の中
          （何やる？→できる？→いくら？→いつ？→危なくない？→応募）に合わせた5ステップ。
          1ページ1つの問い。入力部品は案件ダッシュボードと共用（renderBasicField等） */}
      {cTab === "new" && (
        <div className="fade-in">
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
            <button onClick={()=>{ if (wizStep === 1) { window.location.hash = "/admin/consignment"; } else setWizStep(v => v - 1); }} className="f-sans" style={{ display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:12, fontWeight:600, color:"#111111", cursor:"pointer", padding:"7px 14px", flexShrink:0 }}>← 戻る</button>
            <span className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#111111" }}>{wizStep}/5　{CONSIGN_WIZ_STEPS[wizStep-1].t}</span>
          </div>
          {/* 進捗（5分割の黒バー） */}
          <div style={{ display:"flex", gap:4, marginBottom:18 }}>
            {CONSIGN_WIZ_STEPS.map((st, i) => (
              <div key={st.t} style={{ flex:1, height:4, borderRadius:2, background: i < wizStep ? "#111111" : "#E5E5E5" }} />
            ))}
          </div>
          {/* 1ページ1つの問い */}
          <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#111111", margin:"0 0 4px" }}>{CONSIGN_WIZ_STEPS[wizStep-1].q}</h2>
          <p className="f-sans" style={{ fontSize:12, color:"#999999", margin:"0 0 18px" }}>{CONSIGN_WIZ_STEPS[wizStep-1].d}</p>

          {/* STEP1 案件概要：何を頼むのか */}
          {wizStep === 1 && (<>
            {["crop","task","field_name","region","area_a"].map(k => renderBasicField(CONSIGN_BASIC_FIELDS.find(f => f.k === k)))}
            {renderPhotos()}
          </>)}
          {/* STEP2 作業仕様：どう終われば完了か */}
          {wizStep === 2 && (<>{CONSIGN_TEXT_FIELDS.map(renderTextField)}</>)}
          {/* STEP3 報酬：いくら払うのか */}
          {wizStep === 3 && (<>
            {["unit_price_10a","advance"].map(k => renderBasicField(CONSIGN_BASIC_FIELDS.find(f => f.k === k)))}
            {/* 報酬イメージ（単価×面積の自動計算・派生表示so保存しない） */}
            {(() => { const u = Number(spec.unit_price_10a), a = Number(spec.area_a);
              return (u > 0 && a > 0) ? (
                <div style={{ background:"#111111", borderRadius:12, padding:"14px 16px", marginTop:4 }}>
                  <p className="f-sans" style={{ fontSize:11, color:"#B9B9B9", margin:"0 0 2px" }}>報酬イメージ（単価 × 面積{a}a）</p>
                  <p className="f-sans" style={{ fontSize:22, fontWeight:800, color:"#fff", margin:0 }}>約 {Math.round(u * a / 10).toLocaleString()}円</p>
                </div>
              ) : (
                <p className="f-sans" style={{ fontSize:12, color:"#999999", margin:"4px 0 0" }}>単価を入れると、面積（{spec.area_a ? spec.area_a + "a" : "未入力"}）から報酬イメージを自動計算します。</p>
              ); })()}
          </>)}
          {/* STEP4 日程・安全：いつ・危険情報 */}
          {wizStep === 4 && (<>
            {renderBasicField(CONSIGN_BASIC_FIELDS.find(f => f.k === "deadline"))}
            {renderHazards()}
          </>)}
          {/* STEP5 確認・掲載：公開前チェック（プレビュー＋定型条項＋掲載） */}
          {wizStep === 5 && (<>
            {(spec.photos || []).length > 0 && (
              <div style={{ display:"flex", gap:6, overflowX:"auto", marginBottom:12 }}>
                {(spec.photos || []).map((ph, i) => (
                  <img key={i} src={ph.url} alt="" style={{ width:84, height:84, objectFit:"cover", borderRadius:10, flexShrink:0, border:"1px solid #E5E5E5" }} />
                ))}
              </div>
            )}
            <div style={{ background:"#fff", border:"1px solid #111111", borderRadius:14, padding:"14px 16px", marginBottom:12, display:"grid", gap:8 }}>
              {[...CONSIGN_BASIC_FIELDS.map(f => [f.l, spec[f.k]]),
                ...CONSIGN_TEXT_FIELDS.map(f => [f.l, spec[f.k]]),
                ["危険情報", (spec.hazards || []).map(h => h === "その他" && spec.hazard_other ? "その他（" + spec.hazard_other + "）" : h).join("・")],
                ["写真", (spec.photos || []).length > 0 ? (spec.photos || []).length + "枚" : ""],
              ].map(([l, v]) => (
                <div key={l} style={{ display:"flex", gap:10 }}>
                  <span className="f-sans" style={{ fontSize:11, color:"#999999", minWidth:96, flexShrink:0 }}>{l}</span>
                  <span className="f-sans" style={{ fontSize:12, color: v ? "#111111" : "#C0C0C0", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{v || "未入力"}</span>
                </div>
              ))}
            </div>
            {/* 委託者情報（設定ページから自動反映・2026-07-31たきと指示。緊急連絡先・振込情報は内部用so出さない） */}
            {consignor && CONSIGNOR_PUBLIC_FIELDS.some(f => (consignor[f.k] || "").trim()) && (
              <div style={{ background:"#fff", border:"1px solid #111111", borderRadius:14, padding:"14px 16px", marginBottom:12 }}>
                <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#111111", margin:"0 0 8px" }}>委託者情報（設定ページから自動反映）</p>
                <div style={{ display:"grid", gap:6 }}>
                  {CONSIGNOR_PUBLIC_FIELDS.filter(f => (consignor[f.k] || "").trim()).map(f => (
                    <div key={f.k} style={{ display:"flex", gap:10 }}>
                      <span className="f-sans" style={{ fontSize:11, color:"#999999", minWidth:96, flexShrink:0 }}>{f.l}</span>
                      <span className="f-sans" style={{ fontSize:12, color:"#111111", overflowWrap:"break-word", wordBreak:"break-word" }}>{consignor[f.k]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ background:"#F7F7F7", borderRadius:12, padding:"12px 14px", marginBottom:12 }}>
              <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#111111", margin:"0 0 6px" }}>定型条項（編集不可・全仕様書に印字）</p>
              {CONSIGN_FIXED_CLAUSES.map(c => (
                <p key={c} className="f-sans" style={{ fontSize:12, color:"#111111", lineHeight:1.8, margin:0 }}>・{c}</p>
              ))}
            </div>
          </>)}

          <div style={{ marginTop:20 }}>
            {wizStep < 5 ? (
              <button onClick={()=>setWizStep(v => v + 1)} className="f-sans" style={{ width:"100%", padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor:"pointer" }}>次へ →</button>
            ) : (
              <button onClick={async ()=>{ const ok = await save(); if (ok) window.location.hash = "/admin/consignment"; }} disabled={saving} className="f-sans" style={{ width:"100%", padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor:"pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "掲載中..." : "掲載する（募集を開始）"}</button>
            )}
          </div>
        </div>
      )}

      {cTab === "deal" && (
        <div className="fade-in">
          {/* ダッシュボードの戻り＝一覧へ（さがすの詳細→一覧と同じ動線）。一覧は開き直しで最新化 */}
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
            <button onClick={()=>{ window.location.hash = "/admin/consignment"; }} className="f-sans" style={{ display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:12, fontWeight:600, color:"#111111", cursor:"pointer", padding:"7px 14px" }}>← 一覧</button>
            <span className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#111111", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{editId ? ((spec.field_name || "（圃場未記入）") + "　" + [spec.crop, spec.task].filter(Boolean).join(" ")) : "新しい委託"}</span>
          </div>

          {/* ── 全行程の進行（保存済みの案件のみ）：ステッパー＋現在の状態に応じたアクション ── */}
          {editId && curDeal && (
            <div style={{ border:"1px solid #EBEBEB", borderRadius:14, padding:"14px 16px", marginBottom:16, background:"#fff" }}>
              <ConsignStepper deal={curDeal} />

              {/* 合意（下書き→合意）：仕様書を凍結 */}
              {curDeal.status === "draft" && (
                <button onClick={makeAgreed} disabled={busy} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, background:"#111111", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{busy ? "..." : "合意にする（仕様書を凍結）"}</button>
              )}

              {/* 合意時の仕様書（凍結・契約記録と同じ方式） */}
              {curDeal.spec_snapshot && (
                <details style={{ marginTop: curDeal.status === "draft" ? 12 : 0 }}>
                  <summary className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#111111", cursor:"pointer" }}>合意時の仕様書（凍結・{snapAtLabel}）</summary>
                  <div style={{ marginTop:10, background:"#FAFAFA", border:"1px solid #E5E5E5", borderRadius:10, padding:"10px 12px", display:"grid", gap:6 }}>
                    {[...CONSIGN_BASIC_FIELDS, ...CONSIGN_TEXT_FIELDS].map(f => {
                      const v = (curDeal.spec_snapshot || {})[f.k];
                      return v ? (
                        <div key={f.k} style={{ display:"flex", gap:10 }}>
                          <span className="f-sans" style={{ fontSize:11, color:"#999999", minWidth:96, flexShrink:0 }}>{f.l}</span>
                          <span className="f-sans" style={{ fontSize:12, color:"#111111", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{v}</span>
                        </div>
                      ) : null;
                    })}
                  </div>
                  {changedAfterAgree && (
                    <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#111111", margin:"8px 0 0" }}>※ 合意後の変更あり（上のフォームは凍結内容と異なります）</p>
                  )}
                </details>
              )}

              {/* 前金：deposit入力済みなら受領ボタン（合意〜作業前） */}
              {(curDeal.status === "agreed") && hasDeposit && (
                <div style={{ marginTop:12 }}>
                  {curDeal.spec?.deposit_received_at ? (
                    <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#111111", margin:0 }}>✓ 着手金 受領済み（{curDeal.spec.deposit_received_at}）</p>
                  ) : (
                    <button onClick={receiveDeposit} disabled={busy} className="f-sans" style={{ width:"100%", padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#111111", border:"1px solid #111111", borderRadius:10, cursor:"pointer" }}>着手金を受領した（{Number(spec.advance).toLocaleString()}円）</button>
                  )}
                </div>
              )}

              {/* 作業を開始（合意→作業中） */}
              {curDeal.status === "agreed" && (
                <button onClick={startWork} disabled={busy} className="f-sans" style={{ width:"100%", marginTop:12, padding:"12px", fontSize:14, fontWeight:700, background:"#111111", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>作業を開始する（作業中にする）</button>
              )}

              {/* 検収（作業中→検収済） */}
              {curDeal.status === "working" && (
                <div style={{ marginTop:12 }}>
                  <input className="field f-sans" value={inspectNote} onChange={e=>setInspectNote(e.target.value)} placeholder="検収メモ（任意・基準の可否など）" style={{ fontSize:13, marginBottom:8 }} />
                  <button onClick={doInspect} disabled={busy} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, background:"#111111", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>✓ 検収した</button>
                </div>
              )}

              {/* 支払（検収済→支払済） */}
              {curDeal.status === "inspected" && (
                <button onClick={doPay} disabled={busy} className="f-sans" style={{ width:"100%", marginTop:12, padding:"12px", fontSize:14, fontWeight:700, background:"#111111", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>残金を支払った</button>
              )}

              {/* 完了（支払済→完了）＋振り返り */}
              {curDeal.status === "paid" && (
                <div style={{ marginTop:12 }}>
                  <textarea className="field f-sans" value={reflection} onChange={e=>setReflection(e.target.value)} placeholder="振り返りメモ（次回への気づき・任意）" rows={2} style={{ fontSize:13, marginBottom:8, resize:"vertical" }} />
                  <button onClick={doComplete} disabled={busy} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, background:"#222", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>完了にする</button>
                </div>
              )}
              {curDeal.status === "done" && (
                <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#111111", margin:0, textAlign:"center" }}>この委託は完了しています{curDeal.spec?.reflection ? "" : ""}</p>
              )}
              {curDeal.status === "done" && curDeal.spec?.reflection && (
                <p className="f-sans" style={{ fontSize:12, color:"#111111", margin:"8px 0 0", whiteSpace:"pre-wrap" }}>振り返り：{curDeal.spec.reflection}</p>
              )}
            </div>
          )}

          {/* ── 日次進捗（作業中以降）：履行サマリー＋1行フォーム＋日別一覧 ── */}
          {editId && curDeal && ["working","inspected","paid","done"].includes(curDeal.status) && (
            <div style={{ border:"1px solid #EBEBEB", borderRadius:14, padding:"14px 16px", marginBottom:16, background:"#fff" }}>
              <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:"#111111", margin:"0 0 10px" }}>日次進捗</p>
              {summary && (
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:12 }}>
                  {[
                    ["実働合計", summary.total_hours != null ? `${summary.total_hours}h` : "—"],
                    ["稼働日数", `${summary.work_days ?? 0}日`],
                    ["延べ人数", `${summary.total_workers ?? 0}人`],
                    ["収量", `${summary.total_boxes ?? 0}箱`],
                    ["10aあたり", summary.hours_per_10a != null ? `${summary.hours_per_10a}h` : "—"],
                  ].map(([l, v]) => (
                    <div key={l} style={{ flex:"1 0 30%", background:"#F7F7F7", borderRadius:10, padding:"8px 10px", textAlign:"center" }}>
                      <span className="f-sans" style={{ display:"block", fontSize:10, color:"#B0B0B0" }}>{l}</span>
                      <span className="f-sans" style={{ display:"block", fontSize:14, fontWeight:800, color:"#111111" }}>{v}</span>
                    </div>
                  ))}
                </div>
              )}
              {curDeal.status === "working" && (
                <div style={{ background:"#F9FAFB", border:"1px solid #EBEBEB", borderRadius:10, padding:"10px 12px", marginBottom:12 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
                    <div><label className="lbl f-sans" style={{ fontSize:11 }}>日付</label><input type="date" className="field f-sans" value={pForm.work_date} onChange={e=>setPForm(p=>({...p, work_date:e.target.value}))} style={{ fontSize:13, marginBottom:0 }} /></div>
                    <div><label className="lbl f-sans" style={{ fontSize:11 }}>実働時間(h)</label><input inputMode="decimal" className="field f-sans" value={pForm.hours} onChange={e=>setPForm(p=>({...p, hours:e.target.value.replace(/[^0-9.]/g,"")}))} placeholder="例：6.5" style={{ fontSize:13, marginBottom:0 }} /></div>
                    <div><label className="lbl f-sans" style={{ fontSize:11 }}>人数</label><input inputMode="numeric" className="field f-sans" value={pForm.workers} onChange={e=>setPForm(p=>({...p, workers:e.target.value.replace(/[^0-9]/g,"")}))} placeholder="例：3" style={{ fontSize:13, marginBottom:0 }} /></div>
                    <div><label className="lbl f-sans" style={{ fontSize:11 }}>収量（箱）</label><input inputMode="numeric" className="field f-sans" value={pForm.yield_boxes} onChange={e=>setPForm(p=>({...p, yield_boxes:e.target.value.replace(/[^0-9]/g,"")}))} placeholder="例：40" style={{ fontSize:13, marginBottom:0 }} /></div>
                  </div>
                  <input className="field f-sans" value={pForm.note} onChange={e=>setPForm(p=>({...p, note:e.target.value}))} placeholder="メモ（任意）" style={{ fontSize:13, marginBottom:8 }} />
                  <button onClick={addProgress} disabled={busy} className="f-sans" style={{ width:"100%", padding:"11px", fontSize:13, fontWeight:700, background:"#111111", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>＋ 進捗を記録</button>
                </div>
              )}
              {prog.length === 0 ? (
                <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", textAlign:"center", padding:"12px 0", margin:0 }}>日次の記録はまだありません</p>
              ) : (
                <div style={{ display:"grid", gap:6 }}>
                  {prog.map(r => (
                    <div key={r.id} style={{ display:"flex", gap:10, alignItems:"baseline", borderBottom:"1px solid #F7F7F7", paddingBottom:6 }}>
                      <span className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#111111", minWidth:78, flexShrink:0 }}>{r.work_date}</span>
                      <span className="f-sans" style={{ fontSize:12, color:"#111111", flex:1, minWidth:0 }}>
                        {[r.hours != null ? `${r.hours}h` : null, r.workers != null ? `${r.workers}人` : null, r.yield_boxes != null ? `${r.yield_boxes}箱` : null].filter(Boolean).join("・")}
                        {r.note ? `　${r.note}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {CONSIGN_BASIC_FIELDS.map(renderBasicField)}
          {/* 検収基準・圃場条件（特約は危険情報の後・掲載順どおり） */}
          {CONSIGN_TEXT_FIELDS.filter(f => f.k !== "special").map(renderTextField)}
          {/* 危険情報（チェック式・その他は自由記述を展開） */}
          {renderHazards()}
          {/* 写真（最低3枚・掲載の顔。consignment-photos バケット） */}
          {renderPhotos()}
          {/* 特約（掲載順の最後） */}
          {CONSIGN_TEXT_FIELDS.filter(f => f.k === "special").map(renderTextField)}
          <div style={{ background:"#F7F7F7", borderRadius:12, padding:"12px 14px", margin:"14px 0" }}>
            <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#111111", margin:"0 0 6px" }}>定型条項（編集不可・全仕様書に印字）</p>
            {CONSIGN_FIXED_CLAUSES.map(c => (
              <p key={c} className="f-sans" style={{ fontSize:12, color:"#111111", lineHeight:1.8, margin:0 }}>・{c}</p>
            ))}
          </div>
          <div style={{ display:"flex", gap:8, marginBottom:10 }}>
            <div style={{ flex:1 }}>
              <label className="lbl f-sans">状態（手動上書き・通常は上のボタンで進める）</label>
              <select className="field f-sans" value={status} onChange={e=>setStatus(e.target.value)} style={{ fontSize:13, marginBottom:0 }}>
                {CONSIGN_STATUS.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom:14 }}>
            <label className="lbl f-sans">メモ（内部用・仕様書には印字されない）</label>
            <textarea className="field f-sans" value={memo} onChange={e=>setMemo(e.target.value)} rows={2} style={{ fontSize:13, marginBottom:0, resize:"vertical" }} />
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={save} disabled={saving} className="f-sans" style={{ flex:1, padding:"13px", fontSize:14, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor:"pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "保存中..." : (editId ? "更新を保存" : "保存")}</button>
            <button onClick={()=>setPrintOpen(true)} className="f-sans" style={{ flex:1, padding:"13px", fontSize:14, fontWeight:700, background:"#fff", color:"#111111", border:"1px solid #222", borderRadius:12, cursor:"pointer" }}>印刷ビュー</button>
          </div>
        </div>
      )}

      {cTab === "list" && (
        <div className="fade-in consign-list-content">
          {deals.length === 0 ? (
            <p className="f-sans" style={{ fontSize:13, color:"#111111", textAlign:"center", padding:"32px 0" }}>まだ委託がありません。「新しく委託を出す」から始めましょう。</p>
          ) : (
          <div style={{ display:"grid", gap:14 }}>
          {deals.map(d => {
            const s = d.spec || {};
            const st = consignRecruitState(d.status);
            const ag = progAgg[d.id]; const area = dealAreaA(d);
            const hpa = ag && area ? hoursPer10a(ag.hours, area) : null;
            return (
              <button key={d.id} onClick={()=>openDeal(d)} className="f-sans" style={{ width:"100%", textAlign:"left", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px 16px 10px", cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,0.04)", overflow:"hidden" }}>
                {s.photos && s.photos[0] && s.photos[0].url && (
                  <div style={{ margin:"-16px -16px 12px", height:150, overflow:"hidden" }}>
                    <img src={s.photos[0].url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} />
                  </div>
                )}
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                  <span style={{ flexShrink:0, padding:"3px 10px", borderRadius:8, fontSize:11, fontWeight:700, background:st.bg, color:st.fg }}>{st.l}</span>
                  <span className="f-sans" style={{ fontSize:11, color:"#111111" }}>{new Date(d.created_at).toLocaleDateString("ja-JP")}</span>
                  <span style={{ marginLeft:"auto", fontSize:14, color:"#B0B0B0" }}>›</span>
                </div>
                <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:"#111", margin:"0 0 2px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {s.field_name || "（圃場未記入）"}
                  <span style={{ fontWeight:600, fontSize:13, color:"#111111" }}>　{[s.crop, s.task].filter(Boolean).join(" ")}</span>
                </p>
                <p className="f-sans" style={{ fontSize:12, color:"#111111", margin:"0 0 12px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {[s.region, s.area_a ? s.area_a + "a" : "", s.deadline ? "期限 " + s.deadline : "", s.unit_price_10a ? "単価 " + Number(s.unit_price_10a).toLocaleString() + "円/10a" : ""].filter(Boolean).join("　") || "詳細未記入"}
                </p>
                {(s.hazards || []).length > 0 && (
                  <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#111111", margin:"0 0 12px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    ⚠ {(s.hazards || []).map(h => h === "その他" && s.hazard_other ? "その他（" + s.hazard_other + "）" : h).join("・")}
                  </p>
                )}
                <ConsignStepper deal={d} />
                {ag && (ag.hours > 0 || ag.days > 0) && (
                  <p className="f-sans" style={{ fontSize:11, color:"#111111", fontWeight:700, margin:"-8px 0 6px" }}>履行：実働{ag.hours}h・{ag.days}日{ag.boxes > 0 ? `・${ag.boxes}箱` : ""}{hpa != null ? `　10aあたり ${hpa}h` : ""}</p>
                )}
              </button>
            );
          })}
          </div>
          )}
        </div>
      )}
    </div>
  );
}
