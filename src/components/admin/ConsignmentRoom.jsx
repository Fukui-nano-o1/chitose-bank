// 委託 準備室（#/admin/consignment・管理者専用・分割3-Aで切り出し2026-07-24）。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { ymdLocal } from "../../lib/utils";
import { Avatar, VineCorner, VINE_CORNER_STEMS, VINE_CORNER_LEAVES } from "../ui";
import { CalendarView } from "../CalendarView";
import { AdminNav } from "./AdminNav";

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

const CONSIGN_EMPTY = { field_name:"", region:"徳島県吉野川市", area_a:"", crop:CONSIGN_CROP, task:"", deadline:"", date_start:"", date_end:"", unit_price_10a:"", advance:"", pay_method:"", onsite_contact_mode:"", onsite_name:"", onsite_phone:"", inspection:"", field_cond:"", facility_parking:"", facility_toilet:"", facility_rest:"", facility_lend:"", hazards:[], hazard_other:"", photos:[], special:"" };

const CONSIGN_BASIC_FIELDS = [
  { k:"field_name",     l:"圃場の呼び名", ph:"例：川向こうの畑" },
  { k:"region",         l:"地域", ph:"例：徳島県吉野川市（番地は掲載しない）" },
  { k:"area_a",         l:"面積（a）", ph:"例：30" },
  { k:"crop",           l:"作物" },
  { k:"task",           l:"作業" },
  { k:"deadline",       l:"履行期限" },
  { k:"unit_price_10a", l:"単価（10aあたり・円）", ph:"例：15000" },
  { k:"advance",        l:"着手金（前払金・円）", ph:"例：10000" },
  // 支払いは案件ごとの取引条件（2026-08-02たきと指示・利用者の属性ではない）。文言は希望でなく断定形
  { k:"pay_method",     l:"この案件の支払方法" },
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
// 順番はまず太陽→次に草（2026-07-31たきと指示「まず太陽を出してから草を出そう」）
const CONSIGN_CLUSTER_BASES = [
  { panel: "top",    anchor: "right", bottomMin: 0,  bottomMax: 20, delay: 0.10, kind: "sun" }, // ①上段＝白い太陽が先
  { panel: "bottom", anchor: "right", bottomMin: 0,  bottomMax: 10, delay: 0.45 }, // ②右・下段（草）
  { panel: "bottom", anchor: "left",  bottomMin: 55, bottomMax: 75, delay: 0.80 }, // ③左・中段（草）
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

// ── 委託者情報 v2（2026-07-31たきと指示・種別分岐）──
// 最初に「個人事業者／法人」を選び、入力ページを完全に分岐する。個人名と法人名を同じ列に
// 混ぜない（consignor_type ＋ consignor_data jsonb・ind_*/corp_*/staff_*/cmn_* のキー空間で分離）。
// ページ順：委託者の種類 → 個人事業者情報 or 法人情報 → 連絡担当者（法人のみ・個人は本人が兼ねるso省略）
// → 標準取引条件（共通）→ 登録内容確認。契約書の当事者欄は種別で印字を出し分ける
const CORP_KINDS = ["株式会社", "合同会社", "農事組合法人", "その他"];

// 入力欄の定義（h=小見出し/ta=複数行/sel=ピル選択/num=数字のみ/zip=郵便番号検索付き/note=補足）
// 個人事業者が委託掲載で新たに聞くのは原則これだけ（2026-07-31たきと指示）：
// 屋号の有無・屋号／電話番号（新規登録に無い場合のみ）／事業所所在地（自宅と異なる場合のみ）／
// インボイス登録の有無・登録番号。氏名・フリガナ・生年月日・住所・メールは新規登録①から引き継ぐ（聞き直さない）
const CONSIGNOR_IND_FIELDS = [
  { h:"屋号" },
  { k:"ind_has_trade", l:"屋号の有無", sel:["屋号あり","屋号なし"] },
  { k:"ind_trade", l:"屋号", ph:"例：千歳農園", tradeOnly:true },
  { k:"ind_trade_kana", l:"屋号フリガナ", ph:"例：チトセノウエン", tradeOnly:true },
  { k:"ind_phone", l:"電話番号", ph:"例：090-1234-5678", phoneIfMissing:true },
  { h:"事業所所在地" },
  { k:"ind_biz_same", l:"事業所所在地は自宅と異なりますか？", sel:["自宅と同じ","自宅と異なる"] },
  { k:"ind_biz_zip",         l:"事業所の郵便番号", zip:{ main:"ind_biz_addr_main" }, ph:"例：7793300", bizDiff:true },
  { k:"ind_biz_addr_main",   l:"事業所の住所", ph:"例：徳島県吉野川市鴨島町鴨島", bizDiff:true },
  { k:"ind_biz_addr_detail", l:"事業所の番地・建物名", ph:"例：337-4", bizDiff:true },
  { h:"インボイス" },
  { k:"ind_has_invoice", l:"インボイス登録の有無", sel:["登録あり","登録なし"], help:"消費税のインボイス制度に登録した事業者かどうかです。登録していなければ「登録なし」で構いません。登録番号を記載すると、受託者（相手）が消費税の仕入税額控除を受けられるため、請求書に印字されます。" },
  { k:"ind_invoice", l:"適格請求書発行事業者登録番号", ph:"例：T1234567890123", invoiceOnly:true, help:"「T」＋13桁の番号です。国税庁「インボイス制度適格請求書発行事業者公表サイト」で確認できます。" },
];

// 法人が委託掲載で新たに聞くのは原則これだけ（2026-07-31たきと指示）：
// 代表者役職・氏名／担当者電話番号／登録者を連絡担当者として使用するか（初期選択=使用する）／
// 別担当者の場合のみ担当者名・電話・メール／インボイス登録の有無・登録番号。
// 法人名・法人番号・本店郵便番号・本店所在地・登録担当者名・登録メールは新規登録①から自動反映（聞き直さない）
const CONSIGNOR_CORP_FIELDS = [
  { h:"代表者" },
  { k:"corp_rep_title", l:"代表者役職", ph:"例：代表取締役" },
  { k:"corp_rep_name",  l:"代表者氏名", ph:"例：千歳 太郎" },
  // 連絡担当者（2026-07-31たきと指示）：登録者を使用＝自動反映のみ（担当者名=登録者氏名・
  // メール=登録メール・電話番号は入力させない）／別の担当者＝名前とメールだけ入力（電話は初期設定では不要）
  { h:"連絡担当者" },
  { k:"staff_use_registrant", l:"連絡担当者", sel:["登録者を使用","別の担当者"], note:"新規登録した本人が窓口なら「登録者を使用」のままで構いません" },
  { k:"staff_auto", staffAuto:true },
  { k:"staff_name",  l:"担当者名", ph:"例：千歳 花子", staffDiff:true },
  { k:"staff_email", l:"担当者メールアドレス", ph:"例：hanako@example.com", staffDiff:true },
  { h:"インボイス" },
  { k:"corp_has_invoice", l:"インボイス登録の有無", sel:["登録あり","登録なし"], help:"消費税のインボイス制度に登録した事業者かどうかです。登録していなければ「登録なし」で構いません。登録番号を記載すると、受託者（相手）が消費税の仕入税額控除を受けられるため、請求書に印字されます。" },
  { k:"corp_invoice", l:"適格請求書発行事業者登録番号", ph:"例：T1234567890123", corpInvoiceOnly:true, help:"「T」＋13桁の番号です。国税庁「インボイス制度適格請求書発行事業者公表サイト」で確認できます。" },
];

// ③連絡設定ページは廃止（2026-08-02たきと指示「このページは初期設定から削除してよい」）。
// 恒久的な連絡情報＝新規登録から自動引き継ぎ（個人=登録者氏名・電話・登録メール／法人=登録担当者）。
// 案件当日の現場連絡先＝委託ごとに必要なら変更（新規委託ウィザードの日程・安全に設置）。
// 通知メール＝登録メールを自動使用（委託ごとに変える実益はほぼ無い）。
// 同じ情報をもう一度書かせるページは記憶力試験でしかなく、委託の品質を上げない。

// 旧v1（一枚フォーム）の公開項目＝種別未選択の既存データ表示用フォールバック
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

// 法人番号の検査用数字（チェックデジット）検証＝公的情報との照合（2026-07-31たきと指示）。
// 国税庁の算式：13桁の先頭1桁＝9−（基礎番号12桁の偶数位の和×2＋奇数位の和）mod 9（位は右から数える）。
// 13桁でない場合は null（判定対象外）を返す
const corpNoCheckOk = (v) => {
  const t = (v || "").replace(/[^0-9]/g, "");
  if (t.length !== 13) return null;
  let even = 0, odd = 0;
  t.slice(1).split("").forEach((c, i) => { const pos = 12 - i; if (pos % 2 === 0) even += Number(c); else odd += Number(c); });
  return 9 - ((even * 2 + odd) % 9) === Number(t[0]);
};

// 契約書の当事者欄（確認STEP5・印刷仕様書に自動反映）。種別で印字を出し分ける（2026-07-31たきと指示）：
// 個人事業者＝住所・氏名・屋号／法人＝所在地・法人名・代表者（役職＋氏名）。担当者は当事者欄に出さない
const consignorPartyRows = (row) => {
  if (!row) return [];
  const d = row.consignor_data || {};
  const compose = (zip, main, detail) => {
    const body = [(d[main] || "").trim(), (d[detail] || "").trim()].filter(Boolean).join(" ");
    if (!body) return "";
    const z = (d[zip] || "").trim();
    return (z ? "〒" + z + " " : "") + body;
  };
  if (row.consignor_type === "individual") {
    return [["住所", compose("ind_zip","ind_addr_main","ind_addr_detail")], ["氏名", (d.ind_name || "").trim()], ["屋号", (d.ind_trade || "").trim()]].filter(r => r[1]);
  }
  if (row.consignor_type === "corporate") {
    const rep = [(d.corp_rep_title || "").trim(), (d.corp_rep_name || "").trim()].filter(Boolean).join(" ");
    return [["所在地", compose("corp_zip","corp_addr_main","corp_addr_detail")], ["法人名", (d.corp_name || "").trim()], ["代表者", rep]].filter(r => r[1]);
  }
  // 種別未選択＝旧v1データのフォールバック
  return CONSIGNOR_PUBLIC_FIELDS.filter(f => (row[f.k] || "").trim()).map(f => [f.l, row[f.k]]);
};

// 登録情報の委託機能での利用同意（2026-08-02たきと指示）：曖昧な「引き継いでよいですか」ではなく、
// 何の情報を・何の目的で・誰に・いつ見せるかまで示して同意を取る。同意文を変えたら版数を更新（再同意）
const CONSIGNOR_CONSENT_VERSION = "consignment-data-v1-2026-08";
const CONSIGNOR_CONSENT_TEXT = "新規登録時に登録した氏名・法人名、住所、メールアドレスその他の登録情報を、委託者情報の作成、委託案件の掲載、取引条件の明示、契約書の作成および取引相手への必要な範囲での開示に利用します。";
// 開示範囲は段階別に明示：掲載と同時に全登録者へ詳細を公開しない。必要な相手へ必要になった段階で開示する
const CONSIGNOR_DISCLOSURE_STAGES = [
  { t:"掲載時", items:["【個人事業者】氏名または屋号・市町村までの所在地・サイト内連絡手段", "【法人】法人名・本店所在地の市町村・サイト内連絡手段"] },
  { t:"受注申込後・条件調整時", items:["委託者の名称", "担当者名", "メールまたはサイト内連絡先", "案件に必要な圃場情報"] },
  { t:"発注確定後", items:["法的氏名または法人名", "詳細住所・所在地", "代表者情報", "連絡先", "正確な圃場所在地", "契約書記載事項"] },
];

// 委託者情報の設定フロー（ブラック・アイコンなし・1ページ1つの問い）
function ConsignorInfoEdit() {
  const [ctype, setCtype] = useState("");   // "individual" | "corporate" | ""
  const [d, setD] = useState(null);         // consignor_data（null=読み込み中）
  const [cstep, setCstep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [zipBusy, setZipBusy] = useState("");
  const [zipError, setZipError] = useState("");
  const [helpKey, setHelpKey] = useState(null); // ？を開いている項目（helpの説明コメント表示）
  const [confirmAgree, setConfirmAgree] = useState(false); // 確認ページの同意チェック（2026-07-31たきと指示・未チェックでは保存不可）
  // 登録情報の利用同意（初回ゲート）：チェックは初期未選択・版数一致の同意が無ければフローに入れない
  const [consentOk, setConsentOk] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [consentSaving, setConsentSaving] = useState(false);
  const rowRef = useRef(null); // 旧v1列（種別選択時の下敷きに使う）
  const [ahInfo, setAhInfo] = useState(null); // 新規登録①（account_holders）＝引き継ぎの下敷き（2026-07-31たきと指示）
  const steps = ["type", ctype === "corporate" ? "corp" : "ind", "confirm"]; // 連絡設定ページは廃止・担当者は法人ページに統合
  const stepKey = steps[Math.min(cstep, steps.length - 1)];
  const STEP_META = {
    type:    { t:"委託者の種類",   q:"個人事業者ですか、法人ですか？", de:"種類によって入力ページが分かれます。" },
    ind:     { t:"個人事業者情報", q:"委託で新しく必要な情報だけ入力してください", de:"氏名・住所・メールは新規登録から引き継ぎます。契約書には法的な氏名が印字されます。" },
    corp:    { t:"法人情報",       q:"委託で新しく必要な情報だけ入力してください", de:"法人名・法人番号・本店所在地・メールは新規登録から引き継ぎます。契約の当事者は法人です。" },
    confirm: { t:"登録内容確認",   q:"内容を確認して保存します", de:"案件の確認ページと印刷仕様書に自動で反映されます。" },
  };
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setD({}); return; }
        const { data } = await supabase.from("consignment_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        rowRef.current = data || null;
        setConsentOk(!!(data && data.consignment_data_consent && data.consignment_data_consent_version === CONSIGNOR_CONSENT_VERSION));
        // 新規登録①の本人確認情報を引き継ぎの下敷きに（2026-07-31たきと指示）。
        // ★黙って書面へ流し込まない：フォームの初期値に入れるだけで、確認ページを経て
        //   本人が「保存する」を押した時に確定する＝本人の意思で契約書面に載せる形（2026-07-27作法）
        let ahRow = null;
        try {
          const { data: ah } = await supabase.from("account_holders")
            .select("full_name,postal_code,address,birth_date,entity_type,contact_email,contact_phone,company_name,company_number")
            .eq("auth_id", session.user.id).maybeSingle();
          ahRow = ah || null;
          setAhInfo(ahRow);
        } catch {}
        const nd = { ...((data && data.consignor_data) || {}) };
        // 旧v2キー（4分割 pref/city/addr）からの移行：住所(main)へ併合。旧addrには町域が
        // 入っていた（番地ではない）ため main 側に寄せる。番地・建物名は本人が入力し直す
        const mig = (mainK, prefK, cityK, addrK) => {
          if (!(nd[mainK] || "").trim()) {
            const m = [nd[prefK], nd[cityK], nd[addrK]].map(x => (x || "").trim()).filter(Boolean).join("");
            if (m) nd[mainK] = m;
          }
        };
        mig("ind_addr_main", "ind_pref", "ind_city", "ind_addr");
        mig("ind_biz_addr_main", "ind_biz_pref", "ind_biz_city", "ind_biz_addr");
        mig("corp_addr_main", "corp_pref", "corp_city", "corp_addr");
        // 有無フラグの導出（値があるのに未選択のとき）と、旧「自宅住所と同じ」表記の移行
        if (!(nd.ind_has_trade || "").trim() && (nd.ind_trade || "").trim()) nd.ind_has_trade = "屋号あり";
        if (!(nd.ind_has_invoice || "").trim() && (nd.ind_invoice || "").trim()) nd.ind_has_invoice = "登録あり";
        if (nd.ind_biz_same === "自宅住所と同じ") nd.ind_biz_same = "自宅と同じ";
        else if (!(nd.ind_biz_same || "").trim() && (nd.ind_biz_addr_main || "").trim()) nd.ind_biz_same = "自宅と異なる";
        if (!(nd.corp_has_invoice || "").trim() && (nd.corp_invoice || "").trim()) nd.corp_has_invoice = "登録あり";
        if (!(nd.staff_use_registrant || "").trim()) nd.staff_use_registrant = (nd.staff_name || "").trim() ? "別の担当者" : "登録者を使用";
        // 旧v1の分割振込・緊急連絡先を下敷きに（空欄のみ・保存は本人が押した時だけ）
        if (data) {
          if (!nd.cmn_bank && data.consignor_bank) { nd.cmn_bank = data.consignor_bank; nd.cmn_bank_branch = data.consignor_bank_branch || ""; nd.cmn_account_type = data.consignor_account_type || ""; nd.cmn_account_no = data.consignor_account_no || ""; nd.cmn_account_name = data.consignor_account_name || ""; }
          if (!nd.cmn_emergency && data.consignor_emergency) nd.cmn_emergency = data.consignor_emergency;
        }
        // リロード対策（2026-07-31たきと報告「リロードしたとき入力内容がクリアされる」）：
        // 入力中の下書き（localStorage・自動保存）があればDB値の上に重ねて復元。
        // ステップと種別も戻す＝中断した場所から再開（求人フローと同じ作法）
        let draft = null;
        try { draft = JSON.parse(localStorage.getItem("cb_consignorDraft_v1") || "null"); } catch {}
        if (draft && draft.d) {
          setCtype(draft.t || (data && data.consignor_type) || "");
          if (draft.t && Number.isInteger(draft.s)) setCstep(draft.s);
          setD({ ...nd, ...draft.d });
        } else {
          setCtype((data && data.consignor_type) || "");
          setD(nd);
        }
      } catch { setD({}); }
    })();
  }, []);
  // 自動下書き保存：入力・ステップ移動のたびにlocalStorageへ（保存成功で消す）
  useEffect(() => {
    if (!d) return;
    try { localStorage.setItem("cb_consignorDraft_v1", JSON.stringify({ t: ctype, s: cstep, d })); } catch {}
  }, [d, ctype, cstep]);
  useEffect(() => { if (stepKey !== "confirm") setConfirmAgree(false); }, [stepKey]); // 確認のたびに改めてチェックさせる
  // 同意ログの保存（consent/at/version/user_id・行動記録の憲法＝時刻列の追記）
  const agreeConsent = async () => {
    if (consentSaving || !consentChecked) return;
    setConsentSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setConsentSaving(false); return; }
      const { error } = await supabase.from("consignment_profiles").upsert({
        auth_id: session.user.id,
        consignment_data_consent: true,
        consignment_data_consent_at: new Date().toISOString(),
        consignment_data_consent_version: CONSIGNOR_CONSENT_VERSION,
        consignment_data_consent_user_id: session.user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "auth_id" });
      if (error) alert("同意の記録に失敗しました：" + error.message);
      else setConsentOk(true);
    } catch { alert("同意の記録に失敗しました。"); }
    setConsentSaving(false);
  };
  const setV = (k, v) => setD(p => ({ ...p, [k]: v }));
  // 種別を選ぶ：旧v1列を下敷きに（空欄のみ）→次ページへ
  const pickType = (t) => {
    const row = rowRef.current || {};
    const ah = ahInfo || {};
    const ahZip = (ah.postal_code || "").replace(/[^0-9]/g, "");
    setD(p => {
      const n = { ...p };
      const put = (k, v) => { if (!(n[k] || "").trim() && (v || "").trim()) n[k] = v; };
      // 新規登録の住所は「住所(〜町名) ＋ 半角スペース ＋ 番地・建物名」で保存されている（AccountHolderFormの
      // 保存形式）。既知の区切りなので最初のスペースで2分割して引き継ぐ＝番地まで正確に渡る
      const ahAddr = (ah.address || "").trim();
      const sp = ahAddr.indexOf(" ");
      const ahMain = sp > 0 ? ahAddr.slice(0, sp) : ahAddr;
      const ahDetail = sp > 0 ? ahAddr.slice(sp + 1) : "";
      const v1Main = [row.consignor_pref, row.consignor_city, row.consignor_addr].map(x => (x || "").trim()).filter(Boolean).join("");
      if (t === "individual") {
        put("ind_name", row.consignor_name); put("ind_name", ah.full_name);
        put("ind_trade", row.consignor_trade_name);
        put("ind_birth", ah.birth_date);
        put("ind_zip", row.consignor_zip); put("ind_zip", ahZip);
        put("ind_addr_main", v1Main); put("ind_addr_main", ahMain); put("ind_addr_detail", ahDetail);
        put("ind_phone", row.consignor_phone); put("ind_phone", ah.contact_phone);
        put("ind_email", row.consignor_email); put("ind_email", ah.contact_email);
        put("ind_invoice", row.consignor_invoice_no);
        if (!(n.ind_has_trade || "").trim() && (n.ind_trade || "").trim()) n.ind_has_trade = "屋号あり";
        if (!(n.ind_has_invoice || "").trim() && (n.ind_invoice || "").trim()) n.ind_has_invoice = "登録あり";
      } else {
        put("corp_name", row.consignor_name); put("corp_name", ah.company_name);
        put("corp_no", row.consignor_corp_no); put("corp_no", ah.company_number);
        put("corp_zip", row.consignor_zip); put("corp_zip", ahZip);
        put("corp_addr_main", v1Main); put("corp_addr_main", ahMain); put("corp_addr_detail", ahDetail);
        put("corp_phone", row.consignor_phone); put("corp_phone", ah.contact_phone);
        put("corp_email", row.consignor_email); put("corp_email", ah.contact_email);
        put("corp_invoice", row.consignor_invoice_no);
        put("corp_rep_name", row.consignor_rep_name); // 登録者≠代表者のことがあるso登録者名では埋めない
        if (!(n.staff_use_registrant || "").trim()) n.staff_use_registrant = "登録者を使用"; // 初期選択（2026-07-31たきと指示）
        if (!(n.corp_has_invoice || "").trim() && (n.corp_invoice || "").trim()) n.corp_has_invoice = "登録あり";
      }
      return n;
    });
    setCtype(t); setCstep(1); window.scrollTo(0, 0);
  };
  const searchZipInto = async (f) => {
    const z = (d[f.k] || "").replace(/[^0-9]/g, "");
    if (z.length !== 7) { setZipError("郵便番号は7桁で入力してください"); return; }
    setZipBusy(f.k); setZipError("");
    try {
      const res = await fetch("https://zipcloud.ibsnet.co.jp/api/search?zipcode=" + z);
      const j = await res.json();
      const r = j && j.results && j.results[0];
      if (!r) setZipError("住所が見つかりませんでした");
      else setD(p => ({ ...p, [f.k]: z, [f.zip.main]: (r.address1 || "") + (r.address2 || "") + (r.address3 || "") }));
    } catch { setZipError("検索に失敗しました。通信環境をご確認ください"); }
    setZipBusy("");
  };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSaving(false); return; }
      const { error } = await supabase.from("consignment_profiles").upsert({
        auth_id: session.user.id, consignor_type: ctype, consignor_data: d, updated_at: new Date().toISOString(),
      }, { onConflict: "auth_id" });
      if (error) alert("保存に失敗しました：" + error.message);
      else {
        try { localStorage.removeItem("cb_consignorDraft_v1"); } catch {} // 保存成功＝DBが真実の座so下書きは消す
        // 保存したら委託のトップ（一覧）へ戻る（2026-07-31たきと指示）。✓を一瞬見せてから
        setSaved(true);
        setTimeout(() => { window.location.hash = "/admin/consignment"; }, 600);
      }
    } catch { alert("保存に失敗しました。"); }
    setSaving(false);
  };
  // 条件表示の一元判定（入力欄と登録内容確認の両方が使う）：
  // tradeOnly=屋号ありのみ／phoneIfMissing=新規登録に電話が無い場合のみ／
  // bizDiff=事業所が自宅と異なる場合のみ／invoiceOnly=インボイス登録ありのみ／bankOnly=銀行振込のみ
  const cfHidden = (f) => (
    (f.tradeOnly && (d.ind_has_trade || "") !== "屋号あり") ||
    (f.phoneIfMissing && !!(ahInfo?.contact_phone || "").trim()) ||
    (f.bizDiff && (d.ind_biz_same || "") !== "自宅と異なる") ||
    (f.invoiceOnly && (d.ind_has_invoice || "") !== "登録あり") ||
    (f.staffDiff && (d.staff_use_registrant || "登録者を使用") !== "別の担当者") ||
    (f.corpInvoiceOnly && (d.corp_has_invoice || "") !== "登録あり")
  );
  // 公的情報との照合（2026-07-31たきと指示）：インボイス番号の形式・法人番号との一致・チェックデジット
  const cfWarn = (k) => {
    const v = (d[k] || "").trim();
    if (!v) return "";
    if (k === "ind_invoice" || k === "corp_invoice") {
      if (!/^T\d{13}$/.test(v)) return "「T」＋13桁の形式で入力してください（例：T1234567890123）";
      if (k === "corp_invoice") {
        const digits = v.slice(1);
        const cn = (d.corp_no || "").trim();
        if (/^\d{13}$/.test(cn) && digits !== cn) return "法人の登録番号は「T＋法人番号」です。引き継いだ法人番号と一致していません";
        if (corpNoCheckOk(digits) === false) return "番号の検査用数字（チェックデジット）が合いません。公表サイトでご確認ください";
      }
    }
    return "";
  };
  // 入力欄1つの描画（sel=ピル・zip=検索ボタン付き・num=数字のみ・ta=複数行・help=？で説明開閉）
  const renderCF = (f) => {
    if (f.h) return <p key={"h" + f.h} className="f-sans" style={{ fontSize:13, fontWeight:800, color:"#111111", margin:"18px 0 8px" }}>{f.h}</p>;
    if (!f.h && !f.info && cfHidden(f)) return null;
    if (f.info) return (
      <div key={f.k} className="f-sans" style={{ fontSize:12, color:"#111111", background:"#F7F7F7", border:"1px solid #111111", borderRadius:10, padding:"12px 14px", lineHeight:1.7, margin:"0 0 10px" }}>{f.info}</div>
    );
    if (f.staffAuto) {
      if ((d.staff_use_registrant || "登録者を使用") === "別の担当者") return null;
      return (
        <div key={f.k} className="f-sans" style={{ fontSize:12, color:"#111111", background:"#F7F7F7", border:"1px solid #111111", borderRadius:10, padding:"12px 14px", lineHeight:1.9, margin:"0 0 10px" }}>
          <span style={{ display:"block", fontWeight:800, marginBottom:2 }}>登録者を連絡担当者として使用（自動反映・入力不要）</span>
          <span style={{ display:"block" }}>担当者名：{(ahInfo?.full_name || "").trim() || "未登録"}</span>
          <span style={{ display:"block" }}>担当者メール：{(ahInfo?.contact_email || d.corp_email || "").trim() || "未登録"}</span>
        </div>
      );
    }
    return (
      <div key={f.k} style={{ marginBottom:10 }}>
        {f.help ? (
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <button type="button" onClick={()=>setHelpKey(v => v === f.k ? null : f.k)} aria-label="説明を表示" className="f-sans" style={{ flexShrink:0, width:18, height:18, borderRadius:"50%", border:"1.5px solid #111111", background: helpKey === f.k ? "#111111" : "#fff", color: helpKey === f.k ? "#fff" : "#111111", fontSize:11, fontWeight:800, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", padding:0 }}>？</button>
              <label className="lbl f-sans" style={{ marginBottom:0 }}>{f.l}</label>
            </div>
            {helpKey === f.k && (
              <p className="f-sans" style={{ fontSize:11, color:"#111111", background:"#F7F7F7", borderRadius:10, padding:"10px 12px", margin:"6px 0 8px", lineHeight:1.7 }}>{f.help}</p>
            )}
          </div>
        ) : (
        <label className="lbl f-sans">{f.l}</label>
        )}
        {f.sel ? (
          <div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {f.sel.map(opt => {
                const on = (d[f.k] || "") === opt;
                return (
                  <button key={opt} type="button" onClick={()=>setV(f.k, on ? "" : opt)} className="f-sans" style={{ padding:"9px 18px", fontSize:14, fontWeight:700, borderRadius:10, cursor:"pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>{opt}</button>
                );
              })}
            </div>
            {f.note && <p className="f-sans" style={{ fontSize:11, color:"#999999", margin:"6px 0 0" }}>{f.note}</p>}
          </div>
        ) : f.zip ? (
          <div>
            <div style={{ display:"flex", gap:8 }}>
              <input className="field f-sans" inputMode="numeric" value={d[f.k] || ""} onChange={e=>setV(f.k, e.target.value.replace(/[^0-9]/g, ""))} placeholder={f.ph || ""} style={{ fontSize:14, marginBottom:0, flex:1 }} />
              <button type="button" onClick={()=>searchZipInto(f)} disabled={zipBusy === f.k} className="f-sans" style={{ flexShrink:0, padding:"0 14px", fontSize:13, fontWeight:700, background:"#fff", color:"#111111", border:"1px solid #111111", borderRadius:10, cursor:"pointer" }}>{zipBusy === f.k ? "検索中…" : "住所を検索"}</button>
            </div>
            {zipError && <p className="f-sans" style={{ fontSize:11, color:"#111111", fontWeight:700, margin:"6px 0 0" }}>{zipError}</p>}
          </div>
        ) : f.num ? (
          <input className="field f-sans" inputMode="numeric" value={d[f.k] || ""} onChange={e=>setV(f.k, e.target.value.replace(/[^0-9]/g, ""))} placeholder={f.ph || ""} style={{ fontSize:14, marginBottom:0 }} />
        ) : f.ta ? (
          <textarea className="field f-sans" value={d[f.k] || ""} onChange={e=>setV(f.k, e.target.value)} placeholder={f.ph || ""} rows={3} style={{ fontSize:13, lineHeight:1.7, marginBottom:0, resize:"vertical" }} />
        ) : (
          <input className="field f-sans" value={d[f.k] || ""} onChange={e=>setV(f.k, e.target.value)} placeholder={f.ph || ""} style={{ fontSize:14, marginBottom:0 }} />
        )}
        {(() => { const w = cfWarn(f.k); return w ? <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#111111", margin:"6px 0 0" }}>⚠ {w}</p> : null; })()}
      </div>
    );
  };
  // 読み込み中は画面中央に配置（2026-07-31たきと指示）
  if (!d) return (
    <div style={{ minHeight:"55vh", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <p className="f-sans" style={{ fontSize:13, color:"#999999", margin:0 }}>読み込み中…</p>
    </div>
  );
  // ── 初回同意ゲート（2026-08-02たきと指示）：①引き継ぐ登録情報 ②公開・開示範囲 ③必須チェック1個
  //    ④「委託掲載を始める」。再入力は不要だが、無言で転用もしない ──
  if (!consentOk) {
    const isCorp = ahInfo?.entity_type === "corporate";
    const inheritRows = [
      ["区分", isCorp ? "法人" : "個人事業者"],
      isCorp ? ["法人名", ahInfo?.company_name] : ["氏名", ahInfo?.full_name],
      ...(isCorp ? [["登録者氏名", ahInfo?.full_name], ["法人番号", ahInfo?.company_number]] : []),
      ["住所", ahInfo?.address],
      ["メールアドレス", ahInfo?.contact_email],
      ...((ahInfo?.contact_phone || "").trim() ? [["電話番号", ahInfo?.contact_phone]] : []),
    ].filter(r => (r[1] || "").trim());
    return (
      <div>
        <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#111111", margin:"0 0 4px" }}>登録情報の利用について</h2>
        <p className="f-sans" style={{ fontSize:13, color:"#111111", lineHeight:1.8, margin:"0 0 16px" }}>{CONSIGNOR_CONSENT_TEXT}</p>
        {/* ① 引き継ぐ登録情報 */}
        <div className="f-sans" style={{ fontSize:12, color:"#111111", background:"#F7F7F7", border:"1px solid #111111", borderRadius:10, padding:"12px 14px", lineHeight:1.9, margin:"0 0 12px" }}>
          <span style={{ display:"block", fontWeight:800, marginBottom:2 }}>引き継ぐ登録情報</span>
          {inheritRows.map(([l, v]) => <span key={l} style={{ display:"block" }}>{l}：{v}</span>)}
          {inheritRows.length === 0 && <span style={{ display:"block", color:"#999999" }}>新規登録の情報が見つかりませんでした</span>}
        </div>
        {/* ② 公開・開示範囲（段階別）：タップで展開 */}
        <button type="button" onClick={()=>setScopeOpen(v => !v)} className="f-sans" style={{ width:"100%", textAlign:"left", padding:"12px 14px", fontSize:13, fontWeight:700, borderRadius:10, cursor:"pointer", border:"1px solid #111111", background:"#fff", color:"#111111", marginBottom: scopeOpen ? 8 : 12 }}>
          {scopeOpen ? "▾" : "▸"} 表示・開示される情報を確認
        </button>
        {scopeOpen && (
          <div style={{ border:"1px solid #111111", borderRadius:10, padding:"12px 14px", marginBottom:12 }}>
            {CONSIGNOR_DISCLOSURE_STAGES.map(st => (
              <div key={st.t} style={{ marginBottom:10 }}>
                <p className="f-sans" style={{ fontSize:12, fontWeight:800, color:"#111111", margin:"0 0 4px" }}>{st.t}</p>
                {st.items.map(it => <p key={it} className="f-sans" style={{ fontSize:12, color:"#111111", lineHeight:1.7, margin:0 }}>・{it}</p>)}
              </div>
            ))}
            <p className="f-sans" style={{ fontSize:11, color:"#999999", lineHeight:1.7, margin:0 }}>詳細な住所や電話番号を掲載と同時に公開することはありません。必要な相手へ、必要になった段階で開示します。</p>
          </div>
        )}
        {/* ③ 必須チェック（初期未選択） */}
        <button type="button" onClick={()=>setConsentChecked(v => !v)} className="f-sans" style={{ display:"flex", alignItems:"center", gap:10, width:"100%", textAlign:"left", padding:"12px 14px", fontSize:13, fontWeight:700, borderRadius:10, cursor:"pointer", border: consentChecked ? "2px solid #111111" : "1px solid #D0D0D0", background: consentChecked ? "#111111" : "#fff", color: consentChecked ? "#fff" : "#111111", marginBottom:12 }}>
          <span style={{ flexShrink:0, width:18, height:18, borderRadius:5, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, border: consentChecked ? "none" : "2px solid #C8C8C8", background: consentChecked ? "#fff" : "transparent", color:"#111111" }}>{consentChecked ? "✓" : ""}</span>
          登録情報を委託機能で利用することと、表示・開示される範囲を確認し、同意します
        </button>
        {/* ④ 開始 */}
        <button onClick={agreeConsent} disabled={consentSaving || !consentChecked} className="f-sans" style={{ width:"100%", padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor: consentChecked ? "pointer" : "not-allowed", opacity: (consentSaving || !consentChecked) ? 0.4 : 1 }}>{consentSaving ? "記録中..." : "委託掲載を始める"}</button>
      </div>
    );
  }
  const meta = STEP_META[stepKey];
  const confirmGroups = ctype === "corporate"
    ? [["代表者・連絡担当者・インボイス", CONSIGNOR_CORP_FIELDS]]
    : [["個人事業者情報", CONSIGNOR_IND_FIELDS]];
  return (
    <div>
      {/* 進捗（黒バー）＋ステップ見出し */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
        {cstep > 0 && <button onClick={()=>{ setCstep(v => v - 1); window.scrollTo(0, 0); }} className="f-sans" style={{ display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:12, fontWeight:600, color:"#111111", cursor:"pointer", padding:"7px 14px", flexShrink:0 }}>← 前へ</button>}
        <span className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#111111" }}>{cstep + 1}/{steps.length}　{meta.t}</span>
      </div>
      <div style={{ display:"flex", gap:4, marginBottom:18 }}>
        {steps.map((st, i) => <div key={st} style={{ flex:1, height:4, borderRadius:2, background: i <= cstep ? "#111111" : "#E5E5E5" }} />)}
      </div>
      <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#111111", margin:"0 0 4px" }}>{meta.q}</h2>
      <p className="f-sans" style={{ fontSize:12, color:"#999999", margin:"0 0 18px" }}>{meta.de}</p>

      {/* 1. 委託者の種類（消費者としての個人と混ざらないよう「個人事業者」と表記） */}
      {stepKey === "type" && (
        <div style={{ display:"grid", gap:12 }}>
          {ahInfo?.entity_type && (
            <p className="f-sans" style={{ fontSize:12, color:"#999999", margin:0 }}>新規登録の区分：{ahInfo.entity_type === "corporate" ? "法人" : "個人事業者"}（選び直せます）</p>
          )}
          {[["individual","個人事業者","氏名で契約し、屋号を持てます。担当者ページは省略されます。"],["corporate","法人","契約の当事者は法人。法人情報は新規登録から引き継ぎます。"]].map(([t, l, de]) => (
            <button key={t} onClick={()=>pickType(t)} className="f-sans" style={{ textAlign:"left", background: ctype === t ? "#111111" : "#fff", border:"2px solid #111111", borderRadius:20, padding:"20px 18px", cursor:"pointer" }}>
              <span style={{ display:"block", fontSize:17, fontWeight:800, color: ctype === t ? "#fff" : "#111111" }}>{l}</span>
              <span style={{ display:"block", fontSize:12, color: ctype === t ? "#B9B9B9" : "#717171", marginTop:4, lineHeight:1.6 }}>{de}</span>
            </button>
          ))}
        </div>
      )}

      {stepKey === "ind" && (<>
        {/* 引き継ぎボックスは削除（2026-08-02たきと指示）＝引き継ぎ内容は初回の同意ゲートで提示済み */}
        {CONSIGNOR_IND_FIELDS.map(renderCF)}
      </>)}
      {stepKey === "corp" && (<>
        {/* 引き継ぎボックスは削除（2026-08-02たきと指示）＝引き継ぎ内容は初回の同意ゲートで既に提示済み。
            法人番号のチェックデジット警告だけは残す（公的情報との照合・不一致時のみ表示） */}
        {corpNoCheckOk(d.corp_no) === false && (
          <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#111111", margin:"0 0 10px" }}>⚠ 引き継いだ法人番号（{d.corp_no}）の検査用数字が合いません。新規登録の情報をご確認ください。</p>
        )}
        {CONSIGNOR_CORP_FIELDS.map(renderCF)}
      </>)}
      {/* 登録内容確認（入力済みのみ表示）＋契約書の当事者欄プレビュー */}
      {stepKey === "confirm" && (
        <div>
          <div style={{ background:"#111111", borderRadius:14, padding:"14px 16px", marginBottom:12 }}>
            <p className="f-sans" style={{ fontSize:11, color:"#B9B9B9", margin:"0 0 6px" }}>契約書の委託者欄（印字イメージ）</p>
            {consignorPartyRows({ consignor_type: ctype, consignor_data: d }).map(([l, v]) => (
              <p key={l} className="f-sans" style={{ fontSize:13, color:"#fff", margin:"0 0 2px" }}>{l}：{v}</p>
            ))}
          </div>
          {confirmGroups.map(([gl, fields]) => {
            // 登録内容は全て出す（2026-07-31たきと指示）：未入力もグレーで明示。
            // 条件で無効な項目（事業所=自宅と同じ・現金払いの振込欄）と案内文は出さない
            const rows = fields.filter(f => !f.h && !f.info && !f.staffAuto && !cfHidden(f)).map(f => [f.l, d[f.k]]);
            if (!rows.length) return null;
            return (
              <div key={gl} style={{ background:"#fff", border:"1px solid #111111", borderRadius:14, padding:"14px 16px", marginBottom:12 }}>
                <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#111111", margin:"0 0 8px" }}>{gl}</p>
                <div style={{ display:"grid", gap:6 }}>
                  {rows.map(([l, v]) => (
                    <div key={l} style={{ display:"flex", gap:10 }}>
                      <span className="f-sans" style={{ fontSize:11, color:"#999999", minWidth:110, flexShrink:0 }}>{l}</span>
                      <span className="f-sans" style={{ fontSize:12, color: (v || "").trim() ? "#111111" : "#C0C0C0", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{(v || "").trim() || "未入力"}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {/* 連絡先・通知先＝登録情報から自動（このフローでは聞かない・2026-08-02たきと指示）。
              当日の現場連絡先の上書きは委託案件ごと（ウィザードの日程・安全） */}
          {(() => {
            const diffStaff = ctype === "corporate" && (d.staff_use_registrant || "登録者を使用") === "別の担当者";
            const cName = diffStaff ? (d.staff_name || "").trim() : (ahInfo?.full_name || "").trim();
            const cPhone = ctype === "corporate" ? ((ahInfo?.contact_phone || "").trim()) : (((ahInfo?.contact_phone || "").trim()) || (d.ind_phone || "").trim());
            const cMail = diffStaff ? (d.staff_email || "").trim() : "";
            return (
              <div style={{ background:"#F7F7F7", borderRadius:10, padding:"12px 14px", marginBottom:12 }}>
                <p className="f-sans" style={{ fontSize:11, fontWeight:800, color:"#111111", margin:"0 0 2px" }}>連絡先</p>
                <p className="f-sans" style={{ fontSize:12, color:"#111111", margin:0 }}>{cName || "未登録"}</p>
                {(cPhone || cMail) && <p className="f-sans" style={{ fontSize:12, color:"#111111", margin:0 }}>{cPhone || cMail}</p>}
                <p className="f-sans" style={{ fontSize:11, fontWeight:800, color:"#111111", margin:"8px 0 2px" }}>通知先</p>
                <p className="f-sans" style={{ fontSize:12, color:"#111111", margin:0 }}>登録メールアドレス</p>
                <p className="f-sans" style={{ fontSize:10, color:"#999999", margin:"6px 0 0" }}>変更は登録情報から行います。案件当日だけ別の連絡先を使う場合は、委託の作成時に指定できます。</p>
              </div>
            );
          })()}
        </div>
      )}

      {/* ナビ（次へ／保存する） */}
      {stepKey !== "type" && (
        <div style={{ marginTop:20 }}>
          {stepKey !== "confirm" ? (
            <button onClick={()=>{ setCstep(v => v + 1); window.scrollTo(0, 0); }} className="f-sans" style={{ width:"100%", padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor:"pointer" }}>次へ →</button>
          ) : (<>
            {/* 最終同意（2026-07-31たきと指示）：チェックするまで保存できない */}
            <button type="button" onClick={()=>setConfirmAgree(v => !v)} className="f-sans" style={{ display:"flex", alignItems:"center", gap:10, width:"100%", textAlign:"left", padding:"12px 14px", fontSize:13, fontWeight:700, borderRadius:10, cursor:"pointer", border: confirmAgree ? "2px solid #111111" : "1px solid #D0D0D0", background: confirmAgree ? "#111111" : "#fff", color: confirmAgree ? "#fff" : "#111111", marginBottom:10 }}>
              <span style={{ flexShrink:0, width:18, height:18, borderRadius:5, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, border: confirmAgree ? "none" : "2px solid #C8C8C8", background: confirmAgree ? "#fff" : "transparent", color:"#111111" }}>{confirmAgree ? "✓" : ""}</span>
              この情報を委託者情報として使用します
            </button>
            <button onClick={save} disabled={saving || !confirmAgree} className="f-sans" style={{ width:"100%", padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor: confirmAgree ? "pointer" : "not-allowed", opacity: (saving || !confirmAgree) ? 0.4 : 1 }}>{saving ? "保存中..." : "保存する"}</button>
          </>)}
          {saved && <p className="f-sans" style={{ fontSize:12, color:"#111111", textAlign:"center", marginTop:10 }}>保存しました ✓</p>}
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
  // 月齢（実際の欠け加減を再現・2026-07-31たきと指示）：既知の新月（2000-01-06 18:14 UTC）からの
  // 経過日数を朔望月（29.530589日）で割った端数。0=新月・0.5=満月
  const synodic = 29.530588853;
  let moonPhase = ((now.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000) % synodic / synodic;
  if (moonPhase < 0) moonPhase += 1;
  return { isNight: true, left: leftOf(prog), top: arc(prog), skyTop: "rgba(28,32,60,0.60)", orb: "#E8ECF5", glow: "rgba(200,210,235,0.50)", chrome: "#77798A", moonPhase };
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
  // ステップ展開（2026-07-31たきと指示・順序改定「まず太陽→草」）：
  // 線(0.22s)→①太陽・上段(0.10s〜)→②草・右下(0.45s〜)→③草・左中(0.80s〜)→幕が開く(1.20s+0.5s)
  // ＝約1.7sで終演、1.95sでDOMから外す。
  // 動きを減らす設定の端末では最初から出さない（CSS側のprefers-reduced-motionと二重の判定）
  const [entrance, setEntrance] = useState(() => {
    try { return !window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return true; }
  });
  // 草の配置は入室ごとに抽選（毎回違うパターン・たきと指示）。再レンダーでは変えない＝useStateの初期化で1回だけ
  const [entranceGrass] = useState(makeConsignGrass);
  const [vines] = useState(makeConsignVines); // 背景の蔓も入室ごとに抽選
  const [sky, setSky] = useState(() => computeSky(new Date())); // 背景の空（朝昼夜・太陽/月の位置）
  // 時間経過で太陽/月を動かす（2026-07-31たきと指示）：毎分再計算。移動はCSS transitionで滑らかに
  useEffect(() => {
    const iv = setInterval(() => setSky(computeSky(new Date())), 60000);
    return () => clearInterval(iv);
  }, []);
  // 入力中に背景がずれない固定（2026-07-31たきと報告「入力するとき背景が上にずれて太陽が見えない」）：
  // iOSはキーボードが開くと画面ごと上にパンし、fixedの背景（空・蔓）も一緒に押し上げられる。
  // visualViewport の offsetTop分だけ背景を下へ平行移動し、見えている画面に貼り付け直す＝背景は変わらない。
  // 四隅の蔓は容器をtransformするとfixedな子の基準が壊れるため対象外（額縁so実害なし）
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const move = () => {
      const y = vv.offsetTop || 0;
      document.querySelectorAll(".consign-sky, .consign-vines").forEach(el => { el.style.transform = y ? `translateY(${y}px)` : ""; });
    };
    vv.addEventListener("resize", move);
    vv.addEventListener("scroll", move);
    return () => {
      vv.removeEventListener("resize", move);
      vv.removeEventListener("scroll", move);
      document.querySelectorAll(".consign-sky, .consign-vines").forEach(el => { el.style.transform = ""; });
    };
  }, []);
  // 夜の星（月を煌びやかに・2026-07-31たきと指示）：上空に瞬く星を入室ごとに抽選
  const [skyStars] = useState(() => Array.from({ length: 14 }, () => ({
    x: +(2 + Math.random() * 96).toFixed(1), y: +(2 + Math.random() * 30).toFixed(1),
    s: +(1.5 + Math.random() * 2.2).toFixed(1), dur: +(1.8 + Math.random() * 2.2).toFixed(1), delay: +(Math.random() * 3).toFixed(1),
  })));
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
  }, [cTab, sky.chrome]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // 標準取引条件（支払期限・手数料負担・検収期間・キャンセル条件）は委託掲載を初めて行うときに
  // ウィザード内で設定する（2026-07-31たきと指示）。未設定の項目だけSTEP3に出し、掲載時に委託者情報へ保存
  const [stdTerms, setStdTerms] = useState({});
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
  // 初回掲載で入力した標準取引条件を委託者情報(consignor_data)へ保存（空欄は書かない・既存値は上書きしない）
  const saveStdTerms = async () => {
    const entries = Object.entries(stdTerms).filter(([, v]) => (v || "").trim());
    if (!entries.length) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const merged = { ...((consignor && consignor.consignor_data) || {}) };
      entries.forEach(([k, v]) => { if (!(merged[k] || "").trim()) merged[k] = v.trim(); });
      await supabase.from("consignment_profiles").upsert({ auth_id: session.user.id, consignor_data: merged, updated_at: new Date().toISOString() }, { onConflict: "auth_id" });
      setConsignor(c => c ? { ...c, consignor_data: merged } : { consignor_data: merged });
    } catch {}
  };
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

  // 当日の現場連絡先（2026-08-02たきと指示）：恒久連絡先は登録情報から自動＝案件ごとに必要なときだけ上書き。
  // 法人では登録担当者と圃場へ来る担当者が違うことがある。個人でも当日だけ家族・従業員を連絡先にする場合がある
  const renderOnsiteContact = () => {
    const mode = spec.onsite_contact_mode || "登録情報を使用";
    return (
      <div style={{ marginBottom:10 }}>
        <label className="lbl f-sans">当日の現場連絡先</label>
        <div style={{ display:"flex", gap:8, marginBottom: mode === "別の連絡先を使用" ? 8 : 0 }}>
          {["登録情報を使用", "別の連絡先を使用"].map(opt => {
            const on = mode === opt;
            return (
              <button key={opt} type="button" onClick={()=>setF("onsite_contact_mode", opt)} className="f-sans" style={{ padding:"9px 14px", fontSize:13, fontWeight:700, borderRadius:10, cursor:"pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>{opt}</button>
            );
          })}
        </div>
        {mode === "別の連絡先を使用" && (<>
          <label className="lbl f-sans">氏名</label>
          <input className="field f-sans" value={spec.onsite_name || ""} onChange={e=>setF("onsite_name", e.target.value)} placeholder="例：千歳 花子" style={{ fontSize:14, marginBottom:8 }} />
          <label className="lbl f-sans">電話番号</label>
          <input className="field f-sans" value={spec.onsite_phone || ""} onChange={e=>setF("onsite_phone", e.target.value)} placeholder="例：090-1234-5678" style={{ fontSize:14, marginBottom:0 }} />
        </>)}
      </div>
    );
  };
  // 圃場設備（2026-07-31たきと指示「圃場設備は圃場登録時に設定」＝案件ごと・spec保存）
  const renderFacilities = () => (
    <div style={{ marginBottom:10 }}>
      <label className="lbl f-sans">圃場の設備</label>
      <div style={{ display:"grid", gap:8, marginBottom:10 }}>
        {[["facility_parking","駐車場"],["facility_toilet","トイレ"],["facility_rest","休憩場所"]].map(([k, l]) => (
          <div key={k} style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span className="f-sans" style={{ fontSize:13, color:"#111111", minWidth:72 }}>{l}</span>
            {["あり","なし"].map(opt => {
              const on = spec[k] === opt;
              return (
                <button key={opt} type="button" onClick={()=>setF(k, on ? "" : opt)} className="f-sans" style={{ padding:"7px 16px", fontSize:13, fontWeight:700, borderRadius:10, cursor:"pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>{opt}</button>
              );
            })}
          </div>
        ))}
      </div>
      <label className="lbl f-sans">貸与できる道具・機械</label>
      <textarea className="field f-sans" value={spec.facility_lend || ""} onChange={e=>setF("facility_lend", e.target.value)} placeholder="例：軽トラ・コンテナ・収穫ナイフ" rows={2} style={{ fontSize:13, lineHeight:1.7, marginBottom:0, resize:"vertical" }} />
    </div>
  );
  // ── 入力部品（案件ダッシュボード(deal)と新規ウィザード(new)で共用・2026-07-31）──
  const renderBasicField = (f) => (
            <div key={f.k} style={{ marginBottom:10 }}>
              <label className="lbl f-sans">{f.l}</label>
              {f.k === "pay_method" ? (
                <div style={{ display:"flex", gap:8 }}>
                  {["銀行振込", "現金"].map(opt => {
                    const on = spec.pay_method === opt;
                    return (
                      <button key={opt} type="button" onClick={()=>setF("pay_method", on ? "" : opt)} className="f-sans" style={{ padding:"9px 18px", fontSize:14, fontWeight:700, borderRadius:10, cursor:"pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>{opt}</button>
                    );
                  })}
                </div>
              ) : f.k === "crop" ? (
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
                  <img loading="lazy" src={ph.url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} />
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
          {consignorPartyRows(consignor).length > 0 && (
            <div style={{ marginBottom:14 }}>
              <p className="f-sans" style={{ fontSize:13, fontWeight:700, margin:"0 0 4px" }}>■ 委託者（発注者）</p>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <tbody>
                  {consignorPartyRows(consignor).map(([l, v]) => (
                    <tr key={l}>
                      <td style={{ border:"1px solid #999", padding:"7px 10px", width:170, background:"#F5F5F5", fontWeight:700 }}>{l}</td>
                      <td style={{ border:"1px solid #999", padding:"7px 10px" }}>{v}</td>
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
        {sky.isNight && skyStars.map((st, i) => (
          <span key={i} className="consign-star" style={{ left: st.x + "%", top: st.y + "%", width: st.s, height: st.s, animationDuration: st.dur + "s", animationDelay: "-" + st.delay + "s" }} />
        ))}
        <div className={"consign-sky-orb" + (sky.isNight ? " consign-sky-orb--moon" : "")} style={{ left: sky.left + "%", top: sky.top + "%", background: sky.isNight ? "transparent" : sky.orb,
          boxShadow: sky.isNight
            ? `0 0 16px 4px rgba(255,255,255,0.55), 0 0 60px 18px ${sky.glow}, 0 0 130px 46px rgba(185,205,255,0.28)`
            : `0 0 44px 12px ${sky.glow}` }}>
          {/* 月の欠け加減（実際の月齢を再現）：右半円＋明暗境界の楕円弧で照面だけを描く。
              上弦（満ちる側）は右が照り、下弦（欠ける側）は左右反転。新月付近は地球照のうっすら円盤だけ残る */}
          {sky.isNight && (() => {
            const ph = sky.moonPhase;
            const k = Math.cos(2 * Math.PI * ph);      // 1=新月・-1=満月
            const rx = (Math.abs(k) * 30).toFixed(2);  // 明暗境界（楕円）の横半径
            return (
              <svg viewBox="-32 -32 64 64" style={{ position:"absolute", inset:0, width:"100%", height:"100%", overflow:"visible" }}>
                <g transform={ph < 0.5 ? undefined : "scale(-1 1)"}>
                  <circle r="30" fill="rgba(232,236,245,0.28)" />
                  <path d={`M 0 -30 A 30 30 0 0 1 0 30 A ${rx} 30 0 0 ${k > 0 ? 0 : 1} 0 -30 Z`} fill={sky.orb} />
                </g>
              </svg>
            );
          })()}
        </div>
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
      {/* 管理ページの共通ナビ（全ページ導線・2026-08-02）。一覧側だけに出す（ウィザード・印刷は出さない） */}
      <AdminNav current="consignment" />
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
            <button onClick={()=>{ if (wizStep === 1) { window.location.hash = "/admin/consignment"; } else { setWizStep(v => v - 1); window.scrollTo(0, 0); } }} className="f-sans" style={{ display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:12, fontWeight:600, color:"#111111", cursor:"pointer", padding:"7px 14px", flexShrink:0 }}>← 戻る</button>
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
          {/* STEP2 作業仕様：どう終われば完了か（圃場設備は圃場登録時＝ここで案件ごとに設定） */}
          {wizStep === 2 && (<>
            {CONSIGN_TEXT_FIELDS.filter(f => f.k !== "special").map(renderTextField)}
            {renderFacilities()}
            {CONSIGN_TEXT_FIELDS.filter(f => f.k === "special").map(renderTextField)}
          </>)}
          {/* STEP3 報酬：いくら払うのか */}
          {wizStep === 3 && (<>
            {["unit_price_10a","advance","pay_method"].map(k => renderBasicField(CONSIGN_BASIC_FIELDS.find(f => f.k === k)))}
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
          {/* 標準取引条件（初回のみ・2026-07-31たきと指示）：委託者情報では聞かず、
              初めての掲載時にここで設定→掲載と同時に委託者情報(consignor_data)へ保存＝次回から出ない */}
          {wizStep === 3 && (() => {
            const cd = (consignor && consignor.consignor_data) || {};
            const STD = [
              { k:"cmn_pay_due",    l:"標準支払期限", ph:"例：検収後7日以内" },
              { k:"cmn_fee_bearer", l:"振込手数料の負担", sel:["委託者負担","受託者負担"], cashSkip:true },
              { k:"cmn_inspect",    l:"標準検収期間", ph:"例：作業完了から3日以内" },
              { k:"cmn_cancel",     l:"標準キャンセル条件", ta:true, ph:"例：開始3日前までの通知は無償、以後は着手金を上限に精算" },
            ].filter(f => !(cd[f.k] || "").trim() && !(f.cashSkip && spec.pay_method === "現金"));
            if (!STD.length) return null;
            return (
              <div style={{ marginTop:18 }}>
                <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:"#111111", margin:"0 0 2px" }}>標準取引条件（初回のみ設定）</p>
                <p className="f-sans" style={{ fontSize:11, color:"#999999", margin:"0 0 10px" }}>今後の委託にも自動で適用されます。</p>
                {STD.map(f => (
                  <div key={f.k} style={{ marginBottom:10 }}>
                    <label className="lbl f-sans">{f.l}</label>
                    {f.sel ? (
                      <div style={{ display:"flex", gap:8 }}>
                        {f.sel.map(opt => {
                          const on = (stdTerms[f.k] || "") === opt;
                          return (
                            <button key={opt} type="button" onClick={()=>setStdTerms(p2 => ({ ...p2, [f.k]: on ? "" : opt }))} className="f-sans" style={{ padding:"9px 18px", fontSize:14, fontWeight:700, borderRadius:10, cursor:"pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>{opt}</button>
                          );
                        })}
                      </div>
                    ) : f.ta ? (
                      <textarea className="field f-sans" value={stdTerms[f.k] || ""} onChange={e=>setStdTerms(p2 => ({ ...p2, [f.k]: e.target.value }))} placeholder={f.ph || ""} rows={3} style={{ fontSize:13, lineHeight:1.7, marginBottom:0, resize:"vertical" }} />
                    ) : (
                      <input className="field f-sans" value={stdTerms[f.k] || ""} onChange={e=>setStdTerms(p2 => ({ ...p2, [f.k]: e.target.value }))} placeholder={f.ph || ""} style={{ fontSize:14, marginBottom:0 }} />
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
          {/* STEP4 日程・安全：いつ・危険情報 */}
          {wizStep === 4 && (<>
            {renderBasicField(CONSIGN_BASIC_FIELDS.find(f => f.k === "deadline"))}
            {renderHazards()}
            {renderOnsiteContact()}
          </>)}
          {/* STEP5 確認・掲載：公開前チェック（プレビュー＋定型条項＋掲載） */}
          {wizStep === 5 && (<>
            {(spec.photos || []).length > 0 && (
              <div style={{ display:"flex", gap:6, overflowX:"auto", marginBottom:12 }}>
                {(spec.photos || []).map((ph, i) => (
                  <img loading="lazy" key={i} src={ph.url} alt="" style={{ width:84, height:84, objectFit:"cover", borderRadius:10, flexShrink:0, border:"1px solid #E5E5E5" }} />
                ))}
              </div>
            )}
            <div style={{ background:"#fff", border:"1px solid #111111", borderRadius:14, padding:"14px 16px", marginBottom:12, display:"grid", gap:8 }}>
              {[...CONSIGN_BASIC_FIELDS.map(f => [f.l, spec[f.k]]),
                ...CONSIGN_TEXT_FIELDS.map(f => [f.l, spec[f.k]]),
                ["圃場の設備", [["駐車場", spec.facility_parking], ["トイレ", spec.facility_toilet], ["休憩場所", spec.facility_rest]].filter(([, v]) => v).map(([l, v]) => l + v).join("・")],
                ["貸与できる道具・機械", spec.facility_lend],
                ["危険情報", (spec.hazards || []).map(h => h === "その他" && spec.hazard_other ? "その他（" + spec.hazard_other + "）" : h).join("・")],
                ["当日の現場連絡先", spec.onsite_contact_mode === "別の連絡先を使用" ? [spec.onsite_name, spec.onsite_phone].map(x => (x || "").trim()).filter(Boolean).join(" ") : "登録情報を使用"],
                ["写真", (spec.photos || []).length > 0 ? (spec.photos || []).length + "枚" : ""],
              ].map(([l, v]) => (
                <div key={l} style={{ display:"flex", gap:10 }}>
                  <span className="f-sans" style={{ fontSize:11, color:"#999999", minWidth:96, flexShrink:0 }}>{l}</span>
                  <span className="f-sans" style={{ fontSize:12, color: v ? "#111111" : "#C0C0C0", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{v || "未入力"}</span>
                </div>
              ))}
            </div>
            {/* 委託者情報（設定ページから自動反映・2026-07-31たきと指示。緊急連絡先・振込情報は内部用so出さない） */}
            {consignorPartyRows(consignor).length > 0 && (
              <div style={{ background:"#fff", border:"1px solid #111111", borderRadius:14, padding:"14px 16px", marginBottom:12 }}>
                <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#111111", margin:"0 0 8px" }}>委託者（設定ページから自動反映・種別で印字を出し分け）</p>
                <div style={{ display:"grid", gap:6 }}>
                  {consignorPartyRows(consignor).map(([l, v]) => (
                    <div key={l} style={{ display:"flex", gap:10 }}>
                      <span className="f-sans" style={{ fontSize:11, color:"#999999", minWidth:96, flexShrink:0 }}>{l}</span>
                      <span className="f-sans" style={{ fontSize:12, color:"#111111", overflowWrap:"break-word", wordBreak:"break-word" }}>{v}</span>
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
              <button onClick={()=>{ setWizStep(v => v + 1); window.scrollTo(0, 0); }} className="f-sans" style={{ width:"100%", padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor:"pointer" }}>次へ →</button>
            ) : (
              <button onClick={async ()=>{ const ok = await save(); if (ok) { await saveStdTerms(); window.location.hash = "/admin/consignment"; } }} disabled={saving} className="f-sans" style={{ width:"100%", padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor:"pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "掲載中..." : "掲載する（募集を開始）"}</button>
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
          {renderFacilities()}
          {/* 危険情報（チェック式・その他は自由記述を展開） */}
          {renderHazards()}
          {renderOnsiteContact()}
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
                    <img loading="lazy" src={s.photos[0].url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} />
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
